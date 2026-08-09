import { supabase } from '../../../shared/db/client'
import { nextDocumentNumber } from '../../../shared/utils/documentNumbers'
import { amountDue, money } from '../../../shared/utils/feeMoney'
import { postPayment } from './ledger'

// Taking money — once, for every channel.
//
// A payment at the counter and a payment through a gateway differ only in how
// the school learned the money arrived. Everything after that is identical:
// allocate oldest-first, hold the excess as advance, issue ONE receipt, post a
// balanced pair of ledger entries.
//
// Extracted because the online flow was about to be a second implementation of
// it, and two implementations of "how money settles invoices" is how the two
// drift until a receipt exists that no ledger entry explains.

export interface CollectInput {
  schoolId: string
  studentId: string
  amount: number
  method: string
  reference?: string
  chequeNumber?: string
  chequeDate?: string
  bankName?: string
  notes?: string
  /** Restrict settlement to these invoices; default is everything open. */
  invoiceIds?: string[]
  /** Who took it. Null for an online payment nobody handled. */
  collectedBy?: string | null
  /** Refuse rather than hold change as advance credit. */
  allowAdvance?: boolean
}

export interface CollectResult {
  payment_id: string
  receipt_number: string
  amount: number
  settled_invoices: { invoice_id: string; invoice_number: string; allocated: number }[]
  advance: number
  remaining_outstanding: number
}

export type CollectOutcome =
  | { ok: true; data: CollectResult }
  | { ok: false; status: number; error: string }

/** The open invoices this payment may settle, in the order it will settle them. */
async function openInvoices(schoolId: string, studentId: string, invoiceIds?: string[]) {
  let q = supabase.from('fee_invoices')
    .select('id, invoice_number, total_amount, amount_paid, late_fee, due_date, invoice_date')
    .eq('school_id', schoolId).eq('student_id', studentId)
    .in('status', ['unpaid', 'partial'])
    // Nulls last — an invoice with no due date is not more urgent than one with.
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('invoice_date', { ascending: true })
  if (invoiceIds?.length) q = q.in('id', invoiceIds)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function collectPayment(input: CollectInput): Promise<CollectOutcome> {
  const { schoolId, studentId } = input
  const allowAdvance = input.allowAdvance ?? true

  let invoices: any[]
  try {
    invoices = await openInvoices(schoolId, studentId, input.invoiceIds)
  } catch (e: any) {
    return { ok: false, status: 500, error: e.message }
  }

  const outstanding = money(invoices.reduce((s, i) => s + amountDue(i.total_amount, i.amount_paid), 0))
  const advance = money(Math.max(0, input.amount - outstanding))

  if (advance > 0 && !allowAdvance) {
    return {
      ok: false, status: 400,
      error: `That is ₹${advance} more than the ₹${outstanding} outstanding.`,
    }
  }

  // Work the split out BEFORE writing anything, so a shortfall is caught before
  // any money is recorded rather than halfway through a sequence of inserts.
  let left = money(input.amount)
  const split: { invoice: any; amount: number }[] = []
  for (const inv of invoices) {
    if (left <= 0.001) break
    const due = amountDue(inv.total_amount, inv.amount_paid)
    if (due <= 0) continue
    const take = money(Math.min(due, left))
    split.push({ invoice: inv, amount: take })
    left = money(left - take)
  }

  const receiptNumber = await nextDocumentNumber(schoolId, 'RCP')

  const { data: payment, error: payErr } = await supabase.from('fee_payments').insert({
    school_id: schoolId,
    student_id: studentId,
    receipt_number: receiptNumber,
    amount: money(input.amount),
    method: input.method,
    reference: input.reference,
    cheque_number: input.chequeNumber,
    cheque_date: input.chequeDate,
    bank_name: input.bankName,
    notes: input.notes,
    collected_by: input.collectedBy ?? null,
  }).select().single()

  if (payErr) return { ok: false, status: 400, error: payErr.message }

  if (split.length) {
    const { error: allocErr } = await supabase.from('fee_payment_allocations').insert(
      split.map(s => ({ payment_id: payment.id, invoice_id: s.invoice.id, amount: s.amount })))

    if (allocErr) {
      // The receipt exists but settles nothing — worse than no receipt, so the
      // whole transaction is rolled back by hand and the caller told plainly.
      await supabase.from('fee_payments').delete().eq('id', payment.id)
      return { ok: false, status: 400, error: `Could not allocate the payment: ${allocErr.message}` }
    }
  }

  // Late fee is credited to its own account so fee income is not overstated by
  // penalties, which a school reports separately.
  const lateFeePortion = money(split.reduce(
    (s, p) => s + Math.min(Number(p.invoice.late_fee ?? 0), p.amount), 0))

  await postPayment({
    schoolId,
    paymentId: payment.id,
    studentId,
    method: input.method,
    allocated: money(input.amount - advance),
    unallocated: advance,
    lateFee: lateFeePortion,
  })

  const { data: settled } = await supabase.from('fee_payments')
    .select('unallocated_amount').eq('id', payment.id).single()

  return {
    ok: true,
    data: {
      payment_id: payment.id,
      receipt_number: receiptNumber,
      amount: money(input.amount),
      settled_invoices: split.map(s => ({
        invoice_id: s.invoice.id, invoice_number: s.invoice.invoice_number, allocated: s.amount,
      })),
      advance: Number(settled?.unallocated_amount ?? advance),
      remaining_outstanding: money(Math.max(0, outstanding - (input.amount - advance))),
    },
  }
}

/** What a student currently owes across open invoices. Drives the pay screen. */
export async function outstandingFor(
  schoolId: string, studentId: string, invoiceIds?: string[],
): Promise<{ outstanding: number; invoices: any[] }> {
  const invoices = await openInvoices(schoolId, studentId, invoiceIds)
  return {
    outstanding: money(invoices.reduce((s, i) => s + amountDue(i.total_amount, i.amount_paid), 0)),
    invoices,
  }
}
