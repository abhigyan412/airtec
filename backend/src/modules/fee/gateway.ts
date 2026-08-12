import { Router, Response, Request, NextFunction } from 'express'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { collectPayment, outstandingFor } from './lib/collect'
import { getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { activeProvider, mockProvider, paymentConfigError } from './lib/providers'
import { FeeRequest, attachFeeScope, assertCanReadStudent, requireFeeCollect } from './lib/guards'

// Paying online.
//
// The counter was the only way money could reach the school. This is the other
// way, and it deliberately converges on the SAME capture path: an online payment
// produces one fee_payment, N allocations and one receipt, exactly as a payment
// at the desk does. Nothing downstream — receipts, the ledger, recovery, the
// parent's own history — can tell the difference, which is the point.
//
// Three properties this flow has to have and which the shape here enforces:
//
//   * A family can only pay for THEIR OWN child. The order takes its student
//     from the caller's fee scope, never from the request body.
//   * The AMOUNT is re-derived server-side from what is actually outstanding.
//     A posted amount is a suggestion, not an instruction.
//   * Capture is idempotent. Providers re-deliver webhooks; the unique index on
//     (provider, provider_payment_id) plus the paid-implies-payment constraint
//     mean the second delivery finds the work already done.

const router = Router()

/**
 * Refuse rather than improvise when the gateway is misconfigured.
 *
 * A 503 here is the honest answer: the school's problem is a missing
 * environment variable, and a pay button that silently falls back to a
 * simulator is how a family ends up with a receipt for money nobody took.
 */
function gatewayReady(res: Response): boolean {
  const problem = paymentConfigError()
  if (problem) {
    console.error(`[gateway] refusing to serve — ${problem}`)
    res.status(503).json({
      success: false,
      error: 'Online payment is not configured on this deployment. Please pay at the school office.',
    })
    return false
  }
  return true
}

const CreateOrderSchema = z.object({
  /** Optional narrowing; omitted means everything open. */
  invoice_ids: z.array(z.string().uuid()).optional(),
  /** Part payment. Capped server-side at what is outstanding. */
  amount: z.number().positive().optional(),
})

/** The student this caller is allowed to pay for. */
async function payerStudentId(req: FeeRequest): Promise<string | null> {
  const scope = req.feeScope!
  if (scope.kind === 'student') return scope.studentId
  // Staff taking a payment online on someone's behalf must say who for, and the
  // usual read guard applies.
  const requested = String(req.query.student_id ?? req.body?.student_id ?? '')
  if (!requested) return null
  const denied = await assertCanReadStudent(scope, requested, req.user!.school_id)
  return denied ? null : requested
}

// ── POST /orders ──────────────────────────────────────────────────────
router.post('/orders', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  if (!gatewayReady(res)) return

  const body = CreateOrderSchema.parse(req.body ?? {})
  const school_id = req.user!.school_id

  const studentId = await payerStudentId(req)
  if (!studentId) {
    return res.status(403).json({ success: false, error: 'You can only pay for your own student' })
  }

  const { outstanding } = await outstandingFor(school_id, studentId, body.invoice_ids)
  if (outstanding <= 0) {
    return res.status(400).json({ success: false, error: 'There is nothing outstanding to pay' })
  }

  // Never trust the posted figure. A tampered amount would otherwise let a family
  // clear a ₹50,000 bill by paying ₹1 — the provider only knows what it was told
  // to charge.
  const amount = body.amount ? money(Math.min(body.amount, outstanding)) : outstanding
  if (amount <= 0) return res.status(400).json({ success: false, error: 'Enter an amount above zero' })

  const provider = activeProvider()

  const { data: order, error } = await supabase.from('fee_payment_orders').insert({
    school_id,
    student_id: studentId,
    amount,
    invoice_ids: body.invoice_ids?.length ? body.invoice_ids : null,
    provider: provider.name,
    status: 'created',
    created_by: req.user!.id,
  }).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  try {
    const created = await provider.createOrder({
      orderId: order.id,
      // Providers work in the minor unit. Rounding here, once, rather than
      // letting a float reach the gateway.
      amountPaise: Math.round(amount * 100),
      currency: 'INR',
      notes: { order_id: order.id, student_id: studentId },
    })

    await supabase.from('fee_payment_orders')
      .update({ provider_order_id: created.providerOrderId, updated_at: new Date().toISOString() })
      .eq('id', order.id)

    // Can THIS caller finish what they just started?
    //
    // A simulated order is completed through /simulate, which in production
    // takes fee.collect — a staff permission a parent cannot hold. Without
    // saying so here, the portal cheerfully showed a Pay button that 403s at the
    // last step, which is the worst possible moment to find out.
    const canComplete = !provider.isSimulated
      || process.env.NODE_ENV !== 'production'
      || (await getPermissionsForUser(req.user!.id, school_id)).permissionCodes.has('fee.collect')

    res.status(201).json({
      success: true,
      data: {
        order_id: order.id,
        amount,
        outstanding,
        checkout: created.checkout,
        simulated: provider.isSimulated,
        can_complete: canComplete,
      },
      meta: provider.isSimulated
        ? {
            note: canComplete
              ? 'No payment provider is configured, so this order is simulated and moves no money.'
              : 'No payment provider is configured, so online payment is not available. Pay at the school office.',
          }
        : undefined,
    })
  } catch (e: any) {
    await supabase.from('fee_payment_orders')
      .update({ status: 'failed', failure_reason: e.message }).eq('id', order.id)
    return res.status(502).json({ success: false, error: `Could not reach the payment provider: ${e.message}` })
  }
}))

// ── GET /orders ───────────────────────────────────────────────────────
//
// Money in flight. The reason a desk needs this: a parent who started paying on
// their phone five minutes ago has an order sitting at 'created', and a cashier
// who cannot see it will take the same fee again in cash.
router.get('/orders', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const scope = req.feeScope!
  const { student_id, status } = req.query

  let q = supabase.from('fee_payment_orders')
    .select(`id, student_id, amount, status, provider, failure_reason, created_at, payment_id,
             ${scope.kind === 'section' ? 'students!inner' : 'students'}(id, first_name, last_name, section_id),
             fee_payments:payment_id(receipt_number)`)
    .eq('school_id', school_id).order('created_at', { ascending: false }).limit(50)

  if (scope.kind === 'student') q = q.eq('student_id', scope.studentId)
  if (scope.kind === 'section') q = q.eq('students.section_id', scope.sectionId)
  if (student_id) {
    const denied = await assertCanReadStudent(scope, student_id as string, school_id)
    if (denied) return res.status(403).json({ success: false, error: denied })
    q = q.eq('student_id', student_id as string)
  }
  if (status) q = q.eq('status', status as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── GET /orders/:id ───────────────────────────────────────────────────
// Polled by the portal after the checkout closes, because a webhook may land
// before or after the browser comes back and neither order can be assumed.
router.get('/orders/:id', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: order } = await supabase.from('fee_payment_orders')
    .select('id, student_id, amount, status, failure_reason, payment_id, created_at')
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()

  if (!order) return res.status(404).json({ success: false, error: 'Order not found' })

  const denied = await assertCanReadStudent(req.feeScope!, order.student_id, school_id)
  if (denied) return res.status(403).json({ success: false, error: denied })

  let receipt: any = null
  if (order.payment_id) {
    const { data } = await supabase.from('fee_payments')
      .select('id, receipt_number, amount, payment_date').eq('id', order.payment_id).maybeSingle()
    receipt = data
  }

  res.json({ success: true, data: { ...order, receipt } })
}))

// ── Capture ───────────────────────────────────────────────────────────
//
// Shared by the webhook and by the simulator, so the code that turns a
// provider's "paid" into money in the ledger exists exactly once.
async function capture(event: {
  providerOrderId: string; providerPaymentId: string
  status: 'paid' | 'failed'; amountPaise: number; method?: string; failureReason?: string
}, providerName: string) {
  const { data: order, error: readErr } = await supabase.from('fee_payment_orders')
    .select('*').eq('provider', providerName).eq('provider_order_id', event.providerOrderId).maybeSingle()

  if (readErr) return { status: 500, body: { success: false, error: readErr.message } }
  if (!order) return { status: 404, body: { success: false, error: 'Unknown order' } }

  // Already resolved. A re-delivered webhook is normal, not an error — answering
  // 200 stops the provider retrying forever.
  if (order.status === 'paid' && order.payment_id) {
    return { status: 200, body: { success: true, data: { order_id: order.id, already: true } } }
  }

  // Another delivery of the same event is mid-flight. Also a 200: the provider
  // must stop retrying, and the delivery that holds the claim will finish.
  if (order.status === 'capturing') {
    return { status: 200, body: { success: true, data: { order_id: order.id, already: true, in_progress: true } } }
  }

  if (event.status !== 'paid') {
    await supabase.from('fee_payment_orders').update({
      status: 'failed',
      provider_payment_id: event.providerPaymentId,
      failure_reason: event.failureReason ?? 'Payment failed at the provider',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id)
    return { status: 200, body: { success: true, data: { order_id: order.id, status: 'failed' } } }
  }

  // Charge what the provider actually took, not what we asked for. If a family
  // paid a different amount through the gateway, the receipt must match the bank.
  const paid = money(event.amountPaise / 100)

  // ── Claim the order ──────────────────────────────────────────────
  //
  // Everything above this line is a READ, and a read cannot make two deliveries
  // of the same event exclusive. Providers retry aggressively — Razorpay fires
  // payment.captured more than once as normal behaviour — and both deliveries
  // used to pass the status check and both call collectPayment: ₹18,000 charged
  // once by the provider, ₹36,000 recorded, two receipts, one an orphan. The
  // unique index that exists is on the orders table, and both writers target the
  // same order row, so it never fired.
  //
  // A conditional UPDATE is atomic. Of two concurrent deliveries exactly one
  // matches `status = 'created'` and gets a row back; the other gets nothing and
  // returns 200 without touching money.
  const { data: claimed, error: claimErr } = await supabase.from('fee_payment_orders')
    .update({ status: 'capturing', updated_at: new Date().toISOString() })
    .eq('id', order.id).eq('status', 'created').is('payment_id', null)
    .select('id').maybeSingle()

  if (claimErr) return { status: 500, body: { success: false, error: claimErr.message } }
  if (!claimed) {
    return { status: 200, body: { success: true, data: { order_id: order.id, already: true } } }
  }

  const result = await collectPayment({
    schoolId: order.school_id,
    studentId: order.student_id,
    amount: paid,
    method: event.method && ['upi', 'card', 'neft', 'wallet'].includes(event.method) ? event.method : 'online',
    reference: event.providerPaymentId,
    notes: 'Paid online',
    invoiceIds: order.invoice_ids ?? undefined,
    // The provider's own payment id is the natural idempotency key: two
    // deliveries of one capture carry the same one. Belt to the order claim's
    // braces — the claim serialises deliveries of the same ORDER, this catches
    // the same PAYMENT arriving by any route at all.
    idempotencyKey: `gw:${providerName}:${event.providerPaymentId}`,
    // Nobody handled it. Leaving this null is what distinguishes an online
    // payment from one a named cashier took.
    collectedBy: null,
  })

  if (!result.ok) {
    // The money is with the provider but we could not record it. Loudly, because
    // this needs a human — silently failing here is a family charged for nothing.
    console.error(`[gateway] CAPTURED BUT NOT RECORDED order=${order.id} payment=${event.providerPaymentId}: ${result.error}`)
    // The claim goes back. Safe to release only because collectPayment is now a
    // single Postgres transaction: it either wrote the payment, the allocations
    // and the ledger pair, or it wrote nothing. There is no half-recorded state
    // for a retry to land on top of.
    await supabase.from('fee_payment_orders').update({
      status: 'created',
      provider_payment_id: event.providerPaymentId,
      failure_reason: `Captured at provider but not recorded: ${result.error}`,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id)
    return { status: 500, body: { success: false, error: result.error } }
  }

  await supabase.from('fee_payment_orders').update({
    status: 'paid',
    provider_payment_id: event.providerPaymentId,
    payment_id: result.data.payment_id,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)

  await supabase.from('audit_logs').insert({
    school_id: order.school_id, user_id: order.created_by, action: 'PAYMENT_ONLINE_CAPTURED',
    entity_type: 'fee_payment', entity_id: result.data.payment_id,
    new_values: {
      order_id: order.id, provider: providerName, provider_payment_id: event.providerPaymentId,
      amount: paid, receipt_number: result.data.receipt_number,
    },
  })

  return { status: 200, body: { success: true, data: { order_id: order.id, ...result.data } } }
}

// ── POST /webhook ─────────────────────────────────────────────────────
//
// UNAUTHENTICATED by design — a provider has no login. Trust comes from the
// signature over the RAW body, which is why this lives on its own router mounted
// ahead of both the JSON parser and `authenticate` in index.ts. Parsing the body
// first would re-serialise it, and a re-serialised body does not hash to the
// signature the provider computed.
export const webhookRouter = Router()

webhookRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  if (!gatewayReady(res)) return

  // The driver is OURS to choose, never the caller's.
  //
  // This used to read `req.query.provider ?? ...`, so even a correctly
  // configured Razorpay deployment could be addressed as `?provider=mock` and
  // verified against the mock's key instead of Razorpay's. An attacker picking
  // which lock their key has to open is not a lock.
  const provider = activeProvider()

  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {})
  const signature =
    (req.headers['x-razorpay-signature'] as string | undefined) ??
    (req.headers['x-webhook-signature'] as string | undefined)

  const event = provider.verifyWebhook(raw, signature)
  if (!event) {
    // Logged, because the innocent explanation for a burst of these is a rotated
    // PAYMENT_WEBHOOK_SECRET or a mistyped provider dashboard — in which case
    // EVERY payment in the school is silently 400ing and orders are piling up at
    // 'created' with nobody told. That is the exact shape of "a parent says they
    // paid and it isn't showing", and it used to be completely unobservable.
    console.error(
      `[gateway] webhook signature rejected provider=${provider.name} ` +
      `signature=${signature ? 'present' : 'absent'} bytes=${raw.length} ip=${req.ip}`,
    )
    // The RESPONSE stays terse. Telling an unverified caller why it failed helps
    // them iterate towards a valid forgery.
    return res.status(400).json({ success: false, error: 'Invalid signature' })
  }

  const out = await capture(event, provider.name)
  res.status(out.status).json(out.body)
}))

// ── POST /orders/:id/simulate ─────────────────────────────────────────
//
// The mock driver's stand-in for a checkout page: it signs an event exactly as a
// provider would and runs it through the same verification and capture path.
//
// Which is precisely the danger. `capture()` cannot tell a simulated event from
// a real one — by design — so this route produces a real fee_payments row with a
// sequential receipt number, real allocations, real ledger entries and an audit
// log. Nothing downstream distinguishes it from money.
//
// It used to be guarded by `if (!provider.isSimulated)` alone. Since no provider
// was configured anywhere, that check never fired, and the route was reachable by
// any authenticated caller for any student in their fee scope — which for a
// parent is their own child. Two requests, no tooling, and a family's bill was
// clear:
//
//     POST /api/fees/gateway/orders            {}
//     POST /api/fees/gateway/orders/<id>/simulate {"outcome":"paid"}
//
// In production it now takes fee.collect — a staff permission a parent cannot
// hold. Locally it stays open to the caller's own scope, because the whole point
// of the mock is that a developer can walk the parent's flow end to end.
async function simulateGuard(req: FeeRequest, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') return next()
  return requireFeeCollect(req, res, next)
}

router.post('/orders/:id/simulate', attachFeeScope, simulateGuard, asyncHandler(async (req: FeeRequest, res: Response) => {
  if (!gatewayReady(res)) return

  const provider = activeProvider()
  if (!provider.isSimulated) {
    return res.status(400).json({ success: false, error: 'A real payment provider is configured; use its checkout' })
  }

  const school_id = req.user!.school_id
  const { data: order } = await supabase.from('fee_payment_orders')
    .select('id, student_id, amount, provider, provider_order_id, status')
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()

  if (!order) return res.status(404).json({ success: false, error: 'Order not found' })

  const denied = await assertCanReadStudent(req.feeScope!, order.student_id, school_id)
  if (denied) return res.status(403).json({ success: false, error: denied })
  if (order.status !== 'created') {
    return res.status(409).json({ success: false, error: `This order is already ${order.status}` })
  }

  const outcome = req.body?.outcome === 'failed' ? 'failed' : 'paid'
  const payload = JSON.stringify({
    order_id: order.provider_order_id,
    payment_id: `mock_pay_${randomBytes(12).toString('hex')}`,
    status: outcome,
    amount: Math.round(Number(order.amount) * 100),
    method: 'upi',
    failure_reason: outcome === 'failed' ? 'Simulated failure' : undefined,
  })

  // Round-trips through the same signature check a real webhook faces, so the
  // verification path is exercised in development rather than bypassed.
  const event = provider.verifyWebhook(payload, mockProvider.sign(payload))
  if (!event) return res.status(500).json({ success: false, error: 'Simulated event failed verification' })

  const out = await capture(event, provider.name)
  res.status(out.status).json(out.body)
}))

// ── The reaper ────────────────────────────────────────────────────────
//
// Orders that were started and never resolved.
//
// Nothing ever swept these, so they sat at 'created' forever — and that is the
// silent half of "a parent says they paid and it isn't showing": if the webhook
// secret is rotated or the provider dashboard is misconfigured, EVERY payment in
// the school stops being captured and the only trace is a growing pile of
// unresolved orders nobody was looking at.
//
// Expiring them is not the point; noticing them is. A run that expires anything
// at all logs loudly, because the interesting number is not "how many expired"
// but "why did any".
export async function reapStaleOrders(olderThanMinutes = 60) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

  const { data, error } = await supabase.from('fee_payment_orders')
    .update({ status: 'expired', failure_reason: 'Abandoned — never confirmed by the provider' })
    .in('status', ['created', 'capturing'])
    .is('payment_id', null)
    .lt('created_at', cutoff)
    .select('id, school_id, status, amount')

  if (error) {
    console.error('[gateway] could not reap stale orders:', error.message)
    return { expired: 0 }
  }

  const expired = data ?? []
  if (expired.length) {
    // A 'capturing' order that timed out is a different and worse animal than an
    // abandoned checkout: it means capture started and never finished, so the
    // provider may hold money we did not record.
    const stuck = expired.filter((o: any) => o.status === 'capturing')
    console.warn(
      `[gateway] expired ${expired.length} unresolved payment order(s) older than ${olderThanMinutes}m` +
      (stuck.length ? ` — ${stuck.length} were mid-capture and need a human: ${stuck.map((o: any) => o.id).join(', ')}` : ''),
    )
  }
  return { expired: expired.length }
}

export default router
