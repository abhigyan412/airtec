import { Router, Response, Request } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { collectPayment, outstandingFor } from './lib/collect'
import { activeProvider, providerByName, mockProvider } from './lib/providers'
import { FeeRequest, attachFeeScope, assertCanReadStudent } from './lib/guards'

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

    res.status(201).json({
      success: true,
      data: {
        order_id: order.id,
        amount,
        outstanding,
        checkout: created.checkout,
        simulated: provider.isSimulated,
      },
      meta: provider.isSimulated
        ? { note: 'No payment provider is configured, so this order is simulated and moves no money.' }
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
  const { data: order } = await supabase.from('fee_payment_orders')
    .select('*').eq('provider', providerName).eq('provider_order_id', event.providerOrderId).maybeSingle()

  if (!order) return { status: 404, body: { success: false, error: 'Unknown order' } }

  // Already resolved. A re-delivered webhook is normal, not an error — answering
  // 200 stops the provider retrying forever.
  if (order.status === 'paid' && order.payment_id) {
    return { status: 200, body: { success: true, data: { order_id: order.id, already: true } } }
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

  const result = await collectPayment({
    schoolId: order.school_id,
    studentId: order.student_id,
    amount: paid,
    method: event.method && ['upi', 'card', 'neft', 'wallet'].includes(event.method) ? event.method : 'online',
    reference: event.providerPaymentId,
    notes: 'Paid online',
    invoiceIds: order.invoice_ids ?? undefined,
    // Nobody handled it. Leaving this null is what distinguishes an online
    // payment from one a named cashier took.
    collectedBy: null,
  })

  if (!result.ok) {
    // The money is with the provider but we could not record it. Loudly, because
    // this needs a human — silently failing here is a family charged for nothing.
    console.error(`[gateway] CAPTURED BUT NOT RECORDED order=${order.id} payment=${event.providerPaymentId}: ${result.error}`)
    await supabase.from('fee_payment_orders').update({
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
  const providerName = String(req.query.provider ?? process.env.PAYMENT_PROVIDER ?? 'mock')
  const provider = providerByName(providerName)
  if (!provider) return res.status(400).json({ success: false, error: 'Unknown provider' })

  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {})
  const signature =
    (req.headers['x-razorpay-signature'] as string | undefined) ??
    (req.headers['x-webhook-signature'] as string | undefined)

  const event = provider.verifyWebhook(raw, signature)
  if (!event) {
    // Deliberately terse. Telling an unverified caller WHY it failed helps them
    // iterate towards a valid forgery.
    return res.status(400).json({ success: false, error: 'Invalid signature' })
  }

  const out = await capture(event, provider.name)
  res.status(out.status).json(out.body)
}))

// ── POST /orders/:id/simulate ─────────────────────────────────────────
//
// The mock driver's stand-in for a checkout page. Refuses outright when a real
// provider is configured — otherwise it would be a route that marks any order
// paid without money, which is a fraud button.
router.post('/orders/:id/simulate', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
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
    payment_id: `mock_pay_${Date.now().toString(36)}${Math.round(Number(order.amount) * 100)}`,
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

export default router
