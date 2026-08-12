import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { amountDue, money } from '../../shared/utils/feeMoney'
import { postInvoiceReversal } from './lib/ledger'
import { FeeRequest, attachFeeScope, requireFeeInvoiceGenerate, scopeInvoiceQuery, studentsEmbed } from './lib/guards'

const router = Router()
const STUDENT_COLUMNS = 'id, first_name, last_name, admission_number, class_id, section_id, classes(name), sections(name)'

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { page = '1', limit = '20', student_id, status, academic_year_id, period_key, search } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const scope = req.feeScope!

  let q = supabase.from('fee_invoices')
    .select(`*, ${studentsEmbed(scope, STUDENT_COLUMNS)}, academic_years(id, name)`, { count: 'exact' })
    .eq('school_id', req.user!.school_id).range(from, to).order('created_at', { ascending: false })

  q = scopeInvoiceQuery(q, scope)
  if (student_id) q = q.eq('student_id', student_id as string)
  if (status) q = q.eq('status', status as string)
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
  if (period_key) q = q.eq('period_key', period_key as string)
  if (search) q = q.ilike('invoice_number', `%${search}%`)

  const { data, error, count } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  // amount_due is a subtraction against a maintained column, not a second query
  // summing payments — which is what lets this route paginate at all.
  res.json({
    success: true,
    data: (data ?? []).map((i: any) => ({ ...i, amount_due: amountDue(i.total_amount, i.amount_paid) })),
    meta: { total: count ?? 0, page: pg, limit: lim },
  })
}))

router.get('/:id', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const scope = req.feeScope!
  let q = supabase.from('fee_invoices')
    .select(`*, ${studentsEmbed(scope, STUDENT_COLUMNS)}, academic_years(id, name)`)
    .eq('id', req.params.id).eq('school_id', req.user!.school_id)
  q = scopeInvoiceQuery(q, scope)

  const { data: invoice, error } = await q.maybeSingle()
  if (error) return res.status(500).json({ success: false, error: error.message })
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })

  // Payments reach an invoice through allocations now, so the ledger for one
  // invoice is "which transactions put money against it, and how much".
  const { data: allocations, error: allocationsErr } = await supabase.from('fee_payment_allocations')
    .select('amount, fee_payments(id, receipt_number, payment_date, method, status, collected_by, users:collected_by(full_name))')
    .eq('invoice_id', invoice.id)
  if (allocationsErr) return res.status(500).json({ success: false, error: allocationsErr.message })

  res.json({
    success: true,
    data: {
      ...invoice,
      amount_due: amountDue(invoice.total_amount, invoice.amount_paid),
      payments: (allocations ?? []).map((a: any) => ({ ...a.fee_payments, allocated: Number(a.amount) })),
    },
  })
}))

// Voiding a mistake. Cancelled rather than deleted so the invoice number stays
// accounted for, and the partial unique index excludes it so the period can be
// billed again correctly.
router.patch('/:id/cancel', requireFeeInvoiceGenerate, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: invoice, error: readErr } = await supabase.from('fee_invoices')
    .select('id, student_id, amount_paid, total_amount, late_fee, status')
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (readErr) return res.status(500).json({ success: false, error: readErr.message })
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })

  if (Number(invoice.amount_paid) > 0) {
    return res.status(409).json({
      success: false,
      error: 'Money has been allocated to this invoice. Cancel or reallocate the payment first — voiding it now would leave receipts pointing at a void invoice.',
    })
  }
  if (invoice.status === 'cancelled') return res.json({ success: true, data: invoice })

  const { data, error } = await supabase.from('fee_invoices').update({ status: 'cancelled' })
    .eq('id', req.params.id).eq('school_id', school_id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  // Reverse the receivable this invoice raised. Without it, cancelling a bill
  // left the income recognised and the debt on the books forever — the invoice
  // vanished from every report while the ledger went on insisting the family
  // owed it.
  await postInvoiceReversal({
    schoolId: school_id,
    invoiceId: invoice.id,
    studentId: invoice.student_id,
    netAmount: money(Number(invoice.total_amount) - Number(invoice.late_fee ?? 0)),
    lateFee: money(Number(invoice.late_fee ?? 0)),
    memo: 'Invoice cancelled',
  })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'INVOICE_CANCELLED',
    entity_type: 'fee_invoice', entity_id: req.params.id,
    new_values: { reason: req.body?.reason ?? null },
  })
  res.json({ success: true, data })
}))

export default router
