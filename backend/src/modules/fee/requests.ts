import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { postRefund, postWriteOff } from './lib/ledger'
import { FeeRequest, attachFeeScope, requireFeeView, requireFeeCollect, requireFeeManage } from './lib/guards'

// Actions that give money back or take a charge away.
//
// Raised by whoever collects, decided by whoever manages the structure, and the
// APPROVAL performs the action — so a pending request changes nothing and a
// rejected one leaves no trace on the money.

const router = Router()

const KINDS = ['late_fee_waiver', 'payment_cancel', 'refund', 'writeoff'] as const
type Kind = typeof KINDS[number]

const SELECT = '*, students(id, first_name, last_name, admission_number, classes(name)), requester:requested_by(full_name), decider:decided_by(full_name)'

const KIND_LABEL: Record<Kind, string> = {
  late_fee_waiver: 'Late fee waiver',
  payment_cancel: 'Cancel a payment',
  refund: 'Refund',
  writeoff: 'Write off a balance',
}

const CreateSchema = z.object({
  kind: z.enum(KINDS),
  target_id: z.string().uuid(),
  reason: z.string().min(3, 'Give a reason — it is what the approver decides on'),
  amount: z.number().positive().optional(),
})

async function resolveTarget(kind: Kind, targetId: string, schoolId: string) {
  if (kind === 'late_fee_waiver' || kind === 'writeoff') {
    const { data } = await supabase.from('fee_invoices')
      .select('id, student_id, invoice_number, late_fee, total_amount, amount_paid, status')
      .eq('id', targetId).eq('school_id', schoolId).maybeSingle()
    if (!data) return { error: 'Invoice not found' } as const
    if (data.status === 'cancelled') return { error: 'This invoice has been cancelled' } as const

    if (kind === 'late_fee_waiver') {
      if (Number(data.late_fee) <= 0) return { error: 'This invoice has no late fee to waive' } as const
      return { studentId: data.student_id, amount: money(Number(data.late_fee)) } as const
    }
    const owed = money(Number(data.total_amount) - Number(data.amount_paid))
    if (owed <= 0) return { error: 'Nothing outstanding to write off' } as const
    return { studentId: data.student_id, amount: owed, max: owed } as const
  }

  const { data } = await supabase.from('fee_payments')
    .select('id, student_id, receipt_number, amount, refunded_amount, status, method')
    .eq('id', targetId).eq('school_id', schoolId).maybeSingle()
  if (!data) return { error: 'Payment not found' } as const
  if (data.status === 'cancelled') return { error: 'Already cancelled' } as const

  const remaining = money(Number(data.amount) - Number(data.refunded_amount ?? 0))
  if (remaining <= 0) return { error: 'Already fully refunded' } as const
  return { studentId: data.student_id, amount: remaining, max: remaining } as const
}

router.post('/', requireFeeCollect, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CreateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const target = await resolveTarget(body.kind, body.target_id, school_id)
  if ('error' in target) return res.status(400).json({ success: false, error: target.error })

  let amount = target.amount
  if (body.amount != null && 'max' in target) {
    if (body.amount > (target as any).max + 0.01) {
      return res.status(400).json({ success: false, error: `Only ₹${(target as any).max} is available` })
    }
    amount = money(body.amount)
  }

  const { data, error } = await supabase.from('fee_action_requests').insert({
    school_id, kind: body.kind, target_id: body.target_id,
    student_id: target.studentId, amount, reason: body.reason,
    requested_by: req.user!.id,
  }).select(SELECT).single()

  if (error) {
    // The partial unique index on open requests: clicking twice must not queue
    // two identical waivers, because approving both applies it twice.
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'There is already a pending request for this.' })
    }
    return res.status(400).json({ success: false, error: error.message })
  }
  res.status(201).json({ success: true, data })
}))

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { status, kind, student_id } = req.query
  const scope = req.feeScope!

  let q = supabase.from('fee_action_requests')
    .select(scope.kind === 'section' ? SELECT.replace('students(', 'students!inner(section_id, ') : SELECT)
    .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })

  if (scope.kind === 'student') q = q.eq('student_id', scope.studentId)
  if (scope.kind === 'section') q = q.eq('students.section_id', scope.sectionId)
  if (status) q = q.eq('status', status as string)
  if (kind) q = q.eq('kind', kind as string)
  if (student_id) q = q.eq('student_id', student_id as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/:id/decide', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const decision = String(req.body?.decision ?? '')
  const note = req.body?.note ?? null
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be approved or rejected' })
  }
  const school_id = req.user!.school_id

  const { data: request, error: readErr } = await supabase.from('fee_action_requests')
    .select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (readErr) return res.status(500).json({ success: false, error: readErr.message })
  if (!request) return res.status(404).json({ success: false, error: 'Request not found' })
  if (request.status !== 'pending') {
    return res.status(400).json({ success: false, error: `Already ${request.status}` })
  }
  if (request.requested_by === req.user!.id) {
    return res.status(403).json({ success: false, error: 'You raised this — someone else has to decide it.' })
  }

  // ── Claim the request BEFORE performing the action ────────────────
  //
  // apply() used to run first and the row was marked decided afterwards, with
  // nothing in between making the pair exclusive. Two clicks — or one
  // double-click on a slow connection — both read 'pending', both passed the
  // check above, and both applied: a ₹3,000 refund approved twice posted ₹6,000
  // to the ledger against a ₹3,000 payment.
  //
  // A conditional UPDATE is atomic, so exactly one caller gets the row. The
  // action then runs having already won the claim, and a failure inside it
  // releases the claim below.
  const { data, error } = await supabase.from('fee_action_requests').update({
    status: decision, decision_note: note,
    decided_by: req.user!.id, decided_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('status', 'pending').select(SELECT).maybeSingle()

  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(409).json({ success: false, error: 'Somebody else decided this a moment ago.' })

  if (decision === 'approved') {
    const applied = await apply(request, school_id)
    if (applied.error) {
      // Put it back. The claim exists to make the action happen once, not to
      // consume the request when the action could not be performed at all.
      await supabase.from('fee_action_requests').update({
        status: 'pending', decision_note: null, decided_by: null, decided_at: null,
      }).eq('id', req.params.id)
      return res.status(400).json({ success: false, error: applied.error })
    }
  }

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: `FEE_REQUEST_${decision.toUpperCase()}`,
    entity_type: 'fee_action_request', entity_id: req.params.id,
    new_values: { kind: request.kind, amount: request.amount, note },
  })

  res.json({ success: true, data })
}))

/** The approval performs the action; each kind writes one thing and lets the triggers do the rest. */
async function apply(request: any, schoolId: string): Promise<{ error?: string }> {
  const amount = money(Number(request.amount ?? 0))

  if (request.kind === 'late_fee_waiver') {
    const { data: inv, error: invErr } = await supabase.from('fee_invoices')
      .select('total_amount, late_fee, late_fee_waived').eq('id', request.target_id).maybeSingle()
    if (invErr) return { error: invErr.message }
    if (!inv) return { error: 'The invoice no longer exists' }
    const fee = money(Number(inv.late_fee))
    if (fee <= 0) return { error: 'The late fee has already been removed' }

    // late_fee_waived is the whole point. Zeroing late_fee recorded the
    // forgiveness NOWHERE, so the nightly sweep recomputed the identical fine
    // from the identical overdue date and applied it again — the family was
    // chased for money the school had formally written off, and the ledger and
    // the invoice disagreed about whether it existed.
    const { error } = await supabase.from('fee_invoices')
      .update({
        late_fee: 0,
        late_fee_waived: money(Number(inv.late_fee_waived ?? 0) + fee),
        total_amount: money(Number(inv.total_amount) - fee),
      })
      .eq('id', request.target_id)
    if (error) return { error: error.message }
    await postWriteOff({ schoolId, sourceId: request.id, studentId: request.student_id, amount: fee, kind: 'waiver' })
    return {}
  }

  if (request.kind === 'writeoff') {
    // Re-derived, not taken from the request. `amount` is a snapshot from when
    // the request was RAISED; a payment made in between would make it larger
    // than what is actually outstanding, and the ledger would write off money
    // the family had since paid.
    const { data: inv, error: invErr } = await supabase.from('fee_invoices')
      .select('total_amount, amount_paid, status').eq('id', request.target_id).maybeSingle()
    if (invErr) return { error: invErr.message }
    if (!inv) return { error: 'The invoice no longer exists' }
    if (['cancelled', 'waived'].includes(inv.status)) return { error: `This invoice is already ${inv.status}` }

    const owed = money(Number(inv.total_amount) - Number(inv.amount_paid))
    if (owed <= 0) return { error: 'That balance has since been paid — nothing to write off.' }

    const { error } = await supabase.from('fee_invoices')
      .update({ status: 'waived' }).eq('id', request.target_id)
    if (error) return { error: error.message }
    await postWriteOff({ schoolId, sourceId: request.id, studentId: request.student_id, amount: owed, kind: 'writeoff' })
    return {}
  }

  const { data: pay, error: payErr } = await supabase.from('fee_payments')
    .select('amount, refunded_amount, method').eq('id', request.target_id).maybeSingle()
  if (payErr) return { error: payErr.message }
  if (!pay) return { error: 'The payment no longer exists' }

  if (request.kind === 'payment_cancel') {
    const { error } = await supabase.from('fee_payments')
      .update({ status: 'cancelled' }).eq('id', request.target_id)
    if (error) return { error: error.message }
    await postRefund({
      schoolId, paymentId: request.target_id, studentId: request.student_id,
      method: pay.method, amount: money(Number(pay.amount)),
    })
    return {}
  }

  // refund
  const next = money(Number(pay.refunded_amount ?? 0) + amount)
  if (next > Number(pay.amount) + 0.01) return { error: 'That would refund more than was paid' }

  const { error } = await supabase.from('fee_payments').update({
    refunded_amount: next,
    status: next >= Number(pay.amount) - 0.01 ? 'refunded' : 'captured',
  }).eq('id', request.target_id)
  if (error) return { error: error.message }

  await postRefund({
    schoolId, paymentId: request.target_id, studentId: request.student_id, method: pay.method, amount,
  })
  return {}
}

// ── The queue ─────────────────────────────────────────────────────────
// Everything awaiting a decision in one list. An approver does not care that
// concessions live in a different table; splitting them across two screens is
// how a request sits for a week.
export const approvalsRouter = Router()

approvalsRouter.get('/', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id

  const [reqRes, discRes] = await Promise.all([
    supabase.from('fee_action_requests').select(SELECT)
      .eq('school_id', school_id).eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('fee_discounts')
      .select('id, student_id, discount_type, discount_value, reason, created_at, students(id, first_name, last_name, admission_number, classes(name)), fee_heads(name), requester:requested_by(full_name)')
      .eq('school_id', school_id).eq('approval_status', 'pending').order('created_at', { ascending: false }),
  ])
  if (reqRes.error) return res.status(500).json({ success: false, error: reqRes.error.message })

  const items = [
    ...(discRes.data ?? []).map((d: any) => ({
      id: d.id, source: 'discount' as const, kind: 'discount',
      label: d.fee_heads?.name ? `Concession on ${d.fee_heads.name}` : 'Concession on all fees',
      amount: d.discount_type === 'percentage' ? null : money(Number(d.discount_value)),
      display_amount: d.discount_type === 'percentage' ? `${d.discount_value}%` : null,
      reason: d.reason, student: d.students,
      requested_by: d.requester?.full_name ?? null, created_at: d.created_at,
    })),
    ...(reqRes.data ?? []).map((r: any) => ({
      id: r.id, source: 'request' as const, kind: r.kind,
      label: KIND_LABEL[r.kind as Kind] ?? r.kind,
      amount: r.amount == null ? null : money(Number(r.amount)),
      display_amount: null,
      reason: r.reason, student: r.students,
      requested_by: r.requester?.full_name ?? null, created_at: r.created_at,
    })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  res.json({
    success: true, data: items,
    meta: {
      total: items.length,
      by_kind: items.reduce<Record<string, number>>((a, i) => { a[i.kind] = (a[i.kind] ?? 0) + 1; return a }, {}),
    },
  })
}))

export default router
