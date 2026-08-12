import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { amountDue, daysOverdue, money } from '../../shared/utils/feeMoney'
import { amountInWords } from '../../shared/utils/amountInWords'
import { FeeRequest, attachFeeScope, assertCanReadStudent } from './lib/guards'

// The printed receipt.
//
// One payment = one document, with a line per invoice it settled. That falls out
// of the allocation model for free; under the old shape it had to be reassembled
// by string-matching receipt-number suffixes.
//
// Two figures are deliberately distinct, and conflating them is the classic fee
// dispute: what is PAYABLE TODAY versus what falls due later. A family told they
// owe the whole year this afternoon will (rightly) complain.

const router = Router()

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** "quarterly:Q2" -> "Quarter 2"; "monthly:2026-07" -> "Jul 2026". */
function periodLabel(key?: string | null): string | null {
  if (!key) return null
  const [freq, token] = key.split(':')
  if (!token) return null
  if (freq === 'monthly') {
    const [y, m] = token.split('-').map(Number)
    return m ? `${MONTHS[m - 1]} ${y}` : token
  }
  if (freq === 'annually' || freq === 'one_time') return 'Full year'
  const n = token.replace(/^[A-Za-z]+/, '')
  return freq === 'quarterly' ? `Quarter ${n}` : freq === 'half_yearly' ? `Half ${n}` : token
}

router.get('/:paymentId', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id

  const { data: payment, error } = await supabase.from('fee_payments')
    .select(`id, receipt_number, payment_date, amount, refunded_amount, unallocated_amount,
             method, status, reference, cheque_number, bank_name, notes, student_id,
             users:collected_by(full_name)`)
    .eq('id', req.params.paymentId).eq('school_id', school_id).maybeSingle()

  if (error) return res.status(500).json({ success: false, error: error.message })
  if (!payment) return res.status(404).json({ success: false, error: 'Receipt not found' })

  const denied = await assertCanReadStudent(req.feeScope!, payment.student_id, school_id)
  if (denied) return res.status(403).json({ success: false, error: denied })

  const [schoolRes, studentRes, allocRes, allInvoicesRes] = await Promise.all([
    supabase.from('schools').select('name, city, state, address, phone, email').eq('id', school_id).maybeSingle(),
    supabase.from('students')
      .select('id, first_name, last_name, admission_number, classes(name), sections(name), parents(father_name, mother_name)')
      .eq('id', payment.student_id).maybeSingle(),
    supabase.from('fee_payment_allocations')
      .select('amount, fee_invoices(id, invoice_number, due_date, period_key, line_items, total_amount, amount_paid, late_fee, academic_years(name))')
      .eq('payment_id', payment.id),
    supabase.from('fee_invoices').select('total_amount, amount_paid, due_date, status')
      .eq('student_id', payment.student_id).eq('school_id', school_id).neq('status', 'cancelled'),
  ])

  // All four checked. None of them were.
  //
  // The one that matters is allInvoicesRes: it is where the receipt's
  // "balance remaining" comes from, and a failed read silently printed ₹0 —
  // a document handed to a parent saying they owe nothing, on a day they owe
  // ₹40,000. A receipt is the one artefact here that leaves the building.
  const legFailure = [schoolRes, studentRes, allocRes, allInvoicesRes].find(r => r.error)
  if (legFailure?.error) {
    return res.status(500).json({
      success: false,
      error: `Could not assemble the receipt: ${legFailure.error.message}`,
    })
  }

  const student = studentRes.data
  const parent = (student?.parents as any)?.[0]

  // Each line says WHAT was paid for — the fee heads on that invoice — with the
  // filing detail underneath. An invoice number alone tells a parent nothing.
  const lines = (allocRes.data ?? []).map((a: any, i: number) => {
    const inv = a.fee_invoices
    const items = (inv?.line_items as any[]) ?? []
    const names = items.map((l: any) => l.name).filter(Boolean)
    const stillOwed = inv ? amountDue(inv.total_amount, inv.amount_paid) : 0
    return {
      seq: i + 1,
      // Every head, named. "+2 more" hides exactly the lines a family queries —
      // transport they stopped taking, a fee they don't recognise — and a
      // receipt that won't name them cannot settle the argument it exists for.
      description: names.length ? names.join(', ') : 'School fee',
      // Why anything came off, snapshotted on the invoice when it was raised.
      // A reduced line with no explanation is the other half of the same
      // argument: a parent can see the number is lower and not why.
      concessions: Array.from(new Set(
        items.flatMap((l: any) => (l.discount_sources ?? []) as string[]),
      )),
      period: periodLabel(inv?.period_key),
      invoice_number: inv?.invoice_number ?? null,
      due_date: inv?.due_date ?? null,
      still_due: stillOwed > 0.01 ? money(stillOwed) : 0,
      amount: money(Number(a.amount)),
    }
  })

  const today = new Date()
  const live = allInvoicesRes.data ?? []
  const open = live.filter(i => i.status === 'unpaid' || i.status === 'partial')
  const remaining = money(open.reduce((s, i) => s + amountDue(i.total_amount, i.amount_paid), 0))
  const dueNow = money(open
    .filter(i => !i.due_date || daysOverdue(i.due_date, today) >= 0)
    .reduce((s, i) => s + amountDue(i.total_amount, i.amount_paid), 0))

  const effective = money(Number(payment.amount) - Number(payment.refunded_amount ?? 0))

  res.json({
    success: true,
    data: {
      receipt_number: payment.receipt_number,
      issued_at: payment.payment_date,
      status: payment.status,
      method: payment.method,
      reference: payment.reference ?? payment.cheque_number ?? null,
      collected_by: (payment.users as any)?.full_name ?? null,
      notes: payment.notes ?? null,

      amount: money(Number(payment.amount)),
      refunded_amount: money(Number(payment.refunded_amount ?? 0)),
      advance: money(Number(payment.unallocated_amount ?? 0)),
      effective_amount: effective,
      // In words OF THE FIGURE PRINTED BESIDE IT. This was computed from
      // `effective` while the receipt printed `amount`, so a partially refunded
      // receipt showed a figure and a wording that disagreed by the refund — on
      // the one field the words exist to make tamper-evident.
      amount_in_words: amountInWords(money(Number(payment.amount))),
      effective_amount_in_words: amountInWords(effective),

      school: {
        name: schoolRes.data?.name ?? 'School',
        address: [schoolRes.data?.address, schoolRes.data?.city, schoolRes.data?.state].filter(Boolean).join(', '),
        phone: schoolRes.data?.phone ?? null,
      },
      student: {
        name: `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim(),
        admission_number: student?.admission_number ?? null,
        class_section: [(student?.classes as any)?.name, (student?.sections as any)?.name].filter(Boolean).join('-') || null,
        father_name: parent?.father_name ?? null,
      },
      session: (allocRes.data ?? [])[0]?.fee_invoices?.academic_years?.name ?? null,
      lines,
      settled_invoices: lines.length,
      /** True when this payment did not clear everything it touched. */
      partial: lines.some((l: any) => l.still_due > 0),
      summary: {
        total_billed: money(live.reduce((s, i) => s + Number(i.total_amount), 0)),
        paid_to_date: money(live.reduce((s, i) => s + Number(i.amount_paid), 0)),
        balance_due_now: dueNow,
        balance_remaining: remaining,
        not_yet_due: money(Math.max(0, remaining - dueNow)),
      },
    },
  })
}))

export default router
