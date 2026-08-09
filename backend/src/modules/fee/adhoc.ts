import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { money } from '../../shared/utils/feeMoney'
import { FeeRequest, attachFeeScope, requireFeeManage, scopeInvoiceQuery, studentsEmbed } from './lib/guards'

// One-off charges — a trip, a lost book, a re-exam.
//
// The charge row records WHY; the invoice records what is owed. Raising the
// invoice is the point: settling a charge by flipping a status field meant cash
// could cross the counter with no receipt and no payment row.

const router = Router()

const CreateSchema = z.object({
  student_id: z.string().uuid().optional(),
  class_id: z.string().uuid().optional(),
  fee_head_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
  due_date: z.string().optional(),
  bill_now: z.boolean().default(true),
}).refine(v => v.student_id || v.class_id, { message: 'Either a student or a class is required' })

/** Raise a one-line invoice for a charge and link the two. */
async function bill(charge: any, schoolId: string, userId: string) {
  const { data: year } = await supabase.from('academic_years')
    .select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
  if (!year) return null

  const amount = money(Number(charge.amount))
  const { data: invoice, error } = await supabase.from('fee_invoices').insert({
    school_id: schoolId,
    student_id: charge.student_id,
    academic_year_id: year.id,
    invoice_number: await nextDocumentNumber(schoolId, 'INV'),
    due_date: charge.due_date,
    // No period_key: a one-off belongs to no billing period, and giving it one
    // would collide with the unique index when the term is billed properly.
    line_items: [{
      fee_head_id: charge.fee_head_id ?? null, name: charge.title,
      amount, discount: 0, net_amount: amount, adhoc_charge_id: charge.id,
    }],
    subtotal: amount, discount_total: 0, late_fee: 0, total_amount: amount,
    status: 'unpaid', created_by: userId,
  }).select('id, invoice_number, total_amount, due_date').single()

  if (error || !invoice) return null
  await supabase.from('fee_adhoc_charges')
    .update({ invoice_id: invoice.id, status: 'billed' }).eq('id', charge.id)
  return invoice
}

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { student_id, class_id, status } = req.query
  const scope = req.feeScope!

  let q = supabase.from('fee_adhoc_charges')
    .select(`*, ${studentsEmbed(scope, 'id, first_name, last_name, admission_number, section_id')},
             classes(name), fee_invoices(invoice_number, status, amount_paid, total_amount), users:created_by(full_name)`)
    .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })

  q = scopeInvoiceQuery(q, scope)
  if (student_id) q = q.eq('student_id', student_id as string)
  if (class_id) q = q.eq('class_id', class_id as string)
  if (status) q = q.eq('status', status as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CreateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data: charge, error } = await supabase.from('fee_adhoc_charges').insert({
    school_id,
    student_id: body.student_id ?? null,
    class_id: body.class_id ?? null,
    fee_head_id: body.fee_head_id ?? null,
    title: body.title, description: body.description,
    amount: body.amount, due_date: body.due_date ?? null,
    created_by: req.user!.id,
  }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  const invoice = body.bill_now && body.student_id ? await bill(charge, school_id, req.user!.id) : null
  res.status(201).json({ success: true, data: { ...charge, invoice_id: invoice?.id ?? null }, invoice })
}))

router.post('/:id/bill', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: charge } = await supabase.from('fee_adhoc_charges')
    .select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()

  if (!charge) return res.status(404).json({ success: false, error: 'Charge not found' })
  if (charge.invoice_id) return res.status(409).json({ success: false, error: 'Already on an invoice' })
  if (charge.status === 'cancelled') return res.status(400).json({ success: false, error: 'This charge was cancelled' })
  if (!charge.student_id) {
    return res.status(400).json({ success: false, error: 'Class-wide charges cannot be billed to a single invoice yet' })
  }

  const invoice = await bill(charge, school_id, req.user!.id)
  if (!invoice) return res.status(400).json({ success: false, error: 'Could not raise an invoice — is there a current academic year?' })
  res.status(201).json({ success: true, data: invoice })
}))

router.patch('/:id/cancel', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { data: charge } = await supabase.from('fee_adhoc_charges')
    .select('id, invoice_id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
  if (!charge) return res.status(404).json({ success: false, error: 'Charge not found' })

  // Cancelling the charge must cancel its bill too, or the family keeps owing
  // for something the school has withdrawn.
  if (charge.invoice_id) {
    const { data: inv } = await supabase.from('fee_invoices')
      .select('amount_paid').eq('id', charge.invoice_id).maybeSingle()
    if (Number(inv?.amount_paid ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        error: 'Money has been paid against this charge. Refund it before cancelling.',
      })
    }
    await supabase.from('fee_invoices').update({ status: 'cancelled' }).eq('id', charge.invoice_id)
  }

  const { data, error } = await supabase.from('fee_adhoc_charges')
    .update({ status: 'cancelled' }).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

export default router
