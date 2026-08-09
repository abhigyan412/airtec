import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { collectPayment } from './lib/collect'
import { postBounce } from './lib/ledger'
import { FeeRequest, attachFeeScope, requireFeeCollect, scopeInvoiceQuery } from './lib/guards'

// Taking money at the counter.
//
// ONE payment row per transaction, with allocations saying which invoices it
// settled. The old model put invoice_id on the payment itself, so a parent
// paying ₹1,000 against three invoices produced three payment rows and three
// receipt numbers for a single handover — a bug that took three attempts to
// paper over and is simply absent from this shape.
//
// Allocation is oldest-first, because that clears the debt accruing late fees
// first. Anything left over is kept as an advance credit rather than refused:
// a parent paying ahead is normal, and rejecting it sends them away.

const router = Router()

const METHODS = ['cash', 'cheque', 'neft', 'card', 'upi', 'online', 'dd', 'wallet'] as const

const CollectSchema = z.object({
  student_id: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum(METHODS),
  reference: z.string().optional(),
  cheque_number: z.string().optional(),
  cheque_date: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
  /** Restrict settlement to these invoices; default is everything open. */
  invoice_ids: z.array(z.string().uuid()).optional(),
  /** Refuse rather than hold change as advance credit. */
  allow_advance: z.boolean().default(true),
})

const BounceSchema = z.object({
  reason: z.string().optional(),
  bounced_on: z.string().optional(),
  /** The bank's charge, passed on to the family. */
  bounce_fee: z.number().min(0).default(0),
})

router.post('/', requireFeeCollect, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CollectSchema.parse(req.body)
  const school_id = req.user!.school_id

  const result = await collectPayment({
    schoolId: school_id,
    studentId: body.student_id,
    amount: body.amount,
    method: body.method,
    reference: body.reference,
    chequeNumber: body.cheque_number,
    chequeDate: body.cheque_date,
    bankName: body.bank_name,
    notes: body.notes,
    invoiceIds: body.invoice_ids,
    collectedBy: req.user!.id,
    allowAdvance: body.allow_advance,
  })

  if (!result.ok) return res.status(result.status).json({ success: false, error: result.error })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'PAYMENT_RECORDED',
    entity_type: 'fee_payment', entity_id: result.data.payment_id,
    new_values: {
      amount: body.amount, method: body.method,
      invoices: result.data.settled_invoices.length, advance: result.data.advance,
    },
  })

  res.status(201).json({ success: true, data: result.data })
}))

// ── Cheque bounce ─────────────────────────────────────────────────────
//
// A DIFFERENT event from cancellation, and the distinction is the whole point:
// cancelling says the money never came, bouncing says it came, was credited, and
// the bank took it back. Conflating them makes a day's collection irreconcilable.
//
// Reversing means undoing the allocations — which restores amount_paid on every
// invoice the cheque touched, because that column is maintained by trigger from
// the allocation rows — and posting the mirror-image ledger entries.
router.post('/:id/bounce', requireFeeCollect, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = BounceSchema.parse(req.body ?? {})
  const school_id = req.user!.school_id

  const { data: payment } = await supabase.from('fee_payments')
    .select('id, student_id, amount, refunded_amount, unallocated_amount, method, status, receipt_number')
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()

  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' })
  if (payment.status === 'bounced') {
    return res.status(409).json({ success: false, error: 'Already marked bounced' })
  }
  if (payment.status !== 'captured') {
    return res.status(409).json({
      success: false,
      error: `This payment is ${payment.status}. Only a captured payment can bounce.`,
    })
  }
  if (Number(payment.refunded_amount ?? 0) > 0) {
    return res.status(409).json({
      success: false,
      error: 'Part of this payment has been refunded. Sort the refund out before recording a bounce.',
    })
  }

  const { data: allocations } = await supabase.from('fee_payment_allocations')
    .select('amount, invoice_id').eq('payment_id', payment.id)
  const allocated = money((allocations ?? []).reduce((s, a) => s + Number(a.amount), 0))
  const advance = money(Number(payment.unallocated_amount ?? 0))

  // Allocations first. If this fails the payment stays captured, which is the
  // safe direction — a bounce recorded against invoices that were never
  // un-settled would show the family as paid up on money the bank took back.
  const { error: delErr } = await supabase.from('fee_payment_allocations')
    .delete().eq('payment_id', payment.id)
  if (delErr) return res.status(400).json({ success: false, error: delErr.message })

  await supabase.from('fee_payments').update({
    status: 'bounced',
    bounced_on: body.bounced_on ?? new Date().toISOString().slice(0, 10),
    bounce_reason: body.reason ?? null,
    bounce_fee: body.bounce_fee ?? 0,
  }).eq('id', payment.id)

  await postBounce({
    schoolId: school_id,
    paymentId: payment.id,
    studentId: payment.student_id,
    method: payment.method,
    allocated,
    unallocated: advance,
  })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'PAYMENT_BOUNCED',
    entity_type: 'fee_payment', entity_id: payment.id,
    new_values: {
      receipt_number: payment.receipt_number, amount: Number(payment.amount),
      reversed_allocations: (allocations ?? []).length,
      reason: body.reason ?? null, bounce_fee: body.bounce_fee ?? 0,
    },
  })

  res.json({
    success: true,
    data: {
      payment_id: payment.id,
      reversed: money(allocated + advance),
      restored_invoices: (allocations ?? []).length,
      bounce_fee: body.bounce_fee ?? 0,
    },
    meta: {
      note: (body.bounce_fee ?? 0) > 0
        ? 'The dues are back on the account. Raise the bounce charge as a one-off charge on the student to bill it.'
        : 'The dues are back on the account.',
    },
  })
}))

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { page = '1', limit = '25', student_id, method, from, to, search, status } = req.query
  const { from: rf, to: rt, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const scope = req.feeScope!

  let q = supabase.from('fee_payments')
    // The allocation COUNT comes back with each row: one receipt settling three
    // invoices is the shape this model exists to support, and a receipts list
    // that cannot say so makes a ₹5,000 payment look like a single-invoice one.
    .select(`id, receipt_number, payment_date, amount, refunded_amount, unallocated_amount, method, status, notes,
             ${scope.kind === 'section' ? 'students!inner' : 'students'}(id, first_name, last_name, admission_number, section_id, classes(name)),
             users:collected_by(full_name),
             fee_payment_allocations(count)`, { count: 'exact' })
    .eq('school_id', req.user!.school_id).range(rf, rt).order('payment_date', { ascending: false })

  q = scopeInvoiceQuery(q, scope)
  if (student_id) q = q.eq('student_id', student_id as string)
  if (method) q = q.eq('method', method as string)
  if (from) q = q.gte('payment_date', `${from}T00:00:00`)
  if (to) q = q.lte('payment_date', `${to}T23:59:59`)
  if (status) q = q.eq('status', status as string)
  // Receipt number is what a parent reads off the paper in their hand, so it is
  // the only thing worth searching this list by.
  if (search) q = q.ilike('receipt_number', `%${search}%`)

  const { data, error, count } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = (data ?? []).map((p: any) => ({
    ...p,
    settled_invoices: p.fee_payment_allocations?.[0]?.count ?? 0,
  }))

  res.json({
    success: true, data: rows,
    meta: {
      total: count ?? 0, page: pg, limit: lim,
      // Bounced money never stayed, so it is excluded alongside cancelled —
      // otherwise a page total claims cash the school does not have.
      collected: money(rows
        .filter((p: any) => !['cancelled', 'bounced'].includes(p.status))
        .reduce((s: number, p: any) => s + Number(p.amount) - Number(p.refunded_amount ?? 0), 0)),
    },
  })
}))

export default router
