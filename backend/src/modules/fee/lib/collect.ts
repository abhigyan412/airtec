import { supabase } from '../../../shared/db/client'
import { amountDue, money } from '../../../shared/utils/feeMoney'

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
  /**
   * A repeat of this key returns the original receipt instead of taking the
   * money again. The gateway keys on the provider's payment id; the counter
   * keys on whatever the client sends, so a cashier double-clicking on a slow
   * connection cannot produce two receipts for one handover.
   */
  idempotencyKey?: string | null
}

export interface CollectResult {
  payment_id: string
  receipt_number: string
  amount: number
  settled_invoices: { invoice_id: string; invoice_number: string; allocated: number }[]
  advance: number
  remaining_outstanding: number
  /** True when an idempotency key matched an existing receipt and no money moved. */
  replayed?: boolean
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

/**
 * Take a payment. One transaction, in Postgres.
 *
 * This used to be FIVE separate transactions — receipt number, payment row,
 * allocations, ledger pair, re-read — each an independent HTTP call to
 * PostgREST, with no way to roll any of them back as a group. A failure between
 * the payment insert and the allocation insert left a ₹10,000 receipt settling
 * nothing, which the unallocated trigger then converted into a ₹10,000 advance
 * credit that does not exist: the same money reported simultaneously as
 * advance_held and as outstanding, and spendable by a cashier.
 *
 * The manual `delete the payment again` compensation below it was the tell. It
 * could itself fail, and when it did there was nothing left to try.
 *
 * The other half of the win is inside the function: it locks the open invoices
 * BEFORE deciding the split. Working the allocation out from an unlocked read is
 * what let two cashiers take the same fee at the same moment and both believe
 * the invoice was unpaid.
 */
export async function collectPayment(input: CollectInput): Promise<CollectOutcome> {
  const { data, error } = await supabase.rpc('fee_collect_payment', {
    p_school_id: input.schoolId,
    p_student_id: input.studentId,
    p_amount: money(input.amount),
    p_method: input.method,
    p_reference: input.reference ?? null,
    p_cheque_number: input.chequeNumber ?? null,
    p_cheque_date: input.chequeDate ?? null,
    p_bank_name: input.bankName ?? null,
    p_notes: input.notes ?? null,
    p_invoice_ids: input.invoiceIds?.length ? input.invoiceIds : null,
    p_collected_by: input.collectedBy ?? null,
    p_allow_advance: input.allowAdvance ?? true,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) {
    // The overpayment and advance guards raise check_violation, which is the
    // caller's fault; anything else is ours.
    const isCallerError = error.code === '23514' || /check_violation|more than the/i.test(error.message)
    return { ok: false, status: isCallerError ? 400 : 500, error: error.message }
  }

  const result = data as any
  return {
    ok: true,
    data: {
      payment_id: result.payment_id,
      receipt_number: result.receipt_number,
      amount: Number(result.amount),
      settled_invoices: (result.settled_invoices ?? []).map((s: any) => ({
        invoice_id: s.invoice_id, invoice_number: s.invoice_number, allocated: Number(s.allocated),
      })),
      advance: Number(result.advance ?? 0),
      remaining_outstanding: Number(result.remaining_outstanding ?? 0),
      replayed: Boolean(result.replayed),
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
