import { supabase } from '../../../shared/db/client'
import { money } from '../../../shared/utils/feeMoney'

// The ledger.
//
// Every movement of money gets a double-sided pair of rows. This is the thing
// that cannot be retrofitted: bolting accounting on later means re-deriving
// journal entries for every payment ever taken, from data that no longer records
// which account they belonged to.
//
// Deliberately NOT a full chart of accounts. The account is a stable code, so a
// real COA can be layered on top later by mapping codes to accounts — without
// touching a single posting site.

export type Account =
  | 'cash' | 'bank'
  | 'fee_income' | 'late_fee_income'
  | 'receivable' | 'advance' | 'refund'

export type LedgerSource = 'invoice' | 'payment' | 'refund' | 'waiver' | 'writeoff'

interface Side { account: Account; debit?: number; credit?: number; memo?: string }

/** Which asset account a payment method lands in. */
export function accountForMethod(method: string): Account {
  return method === 'cash' ? 'cash' : 'bank'
}

/**
 * Post a balanced set of entries.
 *
 * Refuses to write anything unless debits equal credits — an unbalanced journal
 * is worse than no journal, because it looks authoritative while being wrong.
 * Postings are best-effort at the call site (a failed posting must never fail a
 * payment the family has already handed over), so the error is logged loudly
 * rather than thrown into the request.
 */
export async function post(
  schoolId: string,
  source: { type: LedgerSource; id: string; studentId?: string | null },
  sides: Side[],
): Promise<boolean> {
  const debit = money(sides.reduce((s, x) => s + (x.debit ?? 0), 0))
  const credit = money(sides.reduce((s, x) => s + (x.credit ?? 0), 0))

  if (Math.abs(debit - credit) > 0.01) {
    console.error(`[ledger] refused unbalanced posting for ${source.type}:${source.id} — Dr ${debit} vs Cr ${credit}`)
    return false
  }
  if (debit === 0) return true // nothing to record

  const { error } = await supabase.from('fee_ledger_entries').insert(
    sides
      .filter(s => (s.debit ?? 0) > 0 || (s.credit ?? 0) > 0)
      .map(s => ({
        school_id: schoolId,
        source_type: source.type,
        source_id: source.id,
        student_id: source.studentId ?? null,
        account_code: s.account,
        debit: money(s.debit ?? 0),
        credit: money(s.credit ?? 0),
        memo: s.memo ?? null,
      })),
  )

  if (error) {
    console.error(`[ledger] failed to post ${source.type}:${source.id}:`, error.message)
    return false
  }
  return true
}

/**
 * An invoice raised: the school is now owed money, and has earned income.
 *
 * This posting did not exist. Invoices were recorded nowhere in the ledger, so
 * `receivable` was only ever credited — by waivers and write-offs — and ran
 * permanently negative, which is why nothing could read this table usefully.
 *
 * Income is recognised HERE, when the bill goes out, not when it is paid. That
 * is what makes the ledger accrual, which is the correct basis for a school that
 * bills in advance and collects late, and it is what postWriteOff has always
 * assumed.
 */
export async function postInvoice(opts: {
  schoolId: string
  invoiceId: string
  studentId: string
  netAmount: number
  lateFee?: number
  memo?: string
}): Promise<boolean> {
  const net = money(opts.netAmount)
  const lateFee = money(opts.lateFee ?? 0)

  return post(opts.schoolId, { type: 'invoice', id: opts.invoiceId, studentId: opts.studentId }, [
    { account: 'receivable', debit: money(net + lateFee), memo: opts.memo ?? 'Invoice raised' },
    ...(net > 0 ? [{ account: 'fee_income' as Account, credit: net }] : []),
    ...(lateFee > 0 ? [{ account: 'late_fee_income' as Account, credit: lateFee }] : []),
  ])
}

/** An invoice voided: the exact mirror of postInvoice. */
export async function postInvoiceReversal(opts: {
  schoolId: string
  invoiceId: string
  studentId: string
  netAmount: number
  lateFee?: number
  memo?: string
}): Promise<boolean> {
  const net = money(opts.netAmount)
  const lateFee = money(opts.lateFee ?? 0)

  return post(opts.schoolId, { type: 'invoice', id: opts.invoiceId, studentId: opts.studentId }, [
    ...(net > 0 ? [{ account: 'fee_income' as Account, debit: net, memo: opts.memo ?? 'Invoice cancelled' }] : []),
    ...(lateFee > 0 ? [{ account: 'late_fee_income' as Account, debit: lateFee }] : []),
    { account: 'receivable', credit: money(net + lateFee) },
  ])
}

/**
 * A late fine levied: more is owed, and the school has earned penalty income.
 *
 * Recognised once, when the fine is applied. It used to be credited on every
 * PAYMENT that touched the invoice instead, reading `invoice.late_fee` — which
 * is the total fine, not the unrecovered remainder — so two payments against one
 * ₹500 fine posted ₹1,000 of late-fee income. Debits still equalled credits, so
 * nothing anywhere looked wrong.
 */
export async function postLateFee(opts: {
  schoolId: string; invoiceId: string; studentId: string; amount: number
}): Promise<boolean> {
  const amount = money(opts.amount)
  if (amount === 0) return true

  // A negative delta is a fine being REDUCED — a re-sweep after a part payment
  // on a percentage rule. It unwinds rather than posting a negative number,
  // because the one-side CHECK on fee_ledger_entries forbids those outright.
  return amount > 0
    ? post(opts.schoolId, { type: 'invoice', id: opts.invoiceId, studentId: opts.studentId }, [
        { account: 'receivable', debit: amount, memo: 'Late fine' },
        { account: 'late_fee_income', credit: amount },
      ])
    : post(opts.schoolId, { type: 'invoice', id: opts.invoiceId, studentId: opts.studentId }, [
        { account: 'late_fee_income', debit: money(-amount), memo: 'Late fine reduced' },
        { account: 'receivable', credit: money(-amount) },
      ])
}

/**
 * Money received: the asset account is debited, and the credit is split between
 * the debt it settled and what was taken in advance (a liability — the school
 * owes the family that value in future schooling).
 *
 * Credits RECEIVABLE, not income. The income was recognised when the invoice was
 * raised; crediting it again here counted every rupee twice the moment invoices
 * started being posted, and left `receivable` with nothing to work against.
 */
export async function postPayment(opts: {
  schoolId: string
  paymentId: string
  studentId: string
  method: string
  allocated: number
  unallocated: number
}): Promise<boolean> {
  const asset = accountForMethod(opts.method)

  return post(opts.schoolId, { type: 'payment', id: opts.paymentId, studentId: opts.studentId }, [
    { account: asset, debit: money(opts.allocated + opts.unallocated), memo: `Receipt via ${opts.method}` },
    ...(opts.allocated > 0 ? [{ account: 'receivable' as Account, credit: money(opts.allocated) }] : []),
    ...(opts.unallocated > 0 ? [{ account: 'advance' as Account, credit: money(opts.unallocated), memo: 'Paid ahead' }] : []),
  ])
}

/**
 * A dishonoured payment: the exact mirror of postPayment.
 *
 * Not the same as a refund. A refund debits income because the school chose to
 * give money back; a bounce says the credit was never good, so the asset account
 * gives up what it was told it received and both income and any advance held are
 * unwound. Posting it as a refund would understate income and overstate cash
 * returned to families, and the two are reported separately.
 */
export async function postBounce(opts: {
  schoolId: string
  paymentId: string
  studentId: string
  method: string
  allocated: number
  unallocated: number
}): Promise<boolean> {
  const asset = accountForMethod(opts.method)
  const allocated = money(opts.allocated)
  const unallocated = money(opts.unallocated)

  return post(opts.schoolId, { type: 'payment', id: opts.paymentId, studentId: opts.studentId }, [
    ...(allocated > 0 ? [{ account: 'receivable' as Account, debit: allocated, memo: 'Cheque dishonoured' }] : []),
    ...(unallocated > 0 ? [{ account: 'advance' as Account, debit: unallocated, memo: 'Advance reversed' }] : []),
    { account: asset, credit: money(allocated + unallocated), memo: `Bounced ${opts.method}` },
  ])
}

/**
 * Money returned: the asset account is credited and the debt comes back.
 *
 * Debits RECEIVABLE, not income. The school did not un-earn the fee by handing
 * the money back — the invoice is still outstanding, and the family owes it
 * again. Debiting income here understated what the school had billed and left
 * the receivable balance disagreeing with the invoices it is supposed to mirror.
 */
export async function postRefund(opts: {
  schoolId: string; paymentId: string; studentId: string; method: string; amount: number
}): Promise<boolean> {
  return post(opts.schoolId, { type: 'refund', id: opts.paymentId, studentId: opts.studentId }, [
    { account: 'receivable', debit: money(opts.amount), memo: 'Refund' },
    { account: accountForMethod(opts.method), credit: money(opts.amount) },
  ])
}

/** A waived late fee or written-off balance: income reverses against receivable. */
export async function postWriteOff(opts: {
  schoolId: string; sourceId: string; studentId: string; amount: number
  kind: 'waiver' | 'writeoff'; memo?: string
}): Promise<boolean> {
  const account: Account = opts.kind === 'waiver' ? 'late_fee_income' : 'fee_income'
  return post(opts.schoolId, { type: opts.kind, id: opts.sourceId, studentId: opts.studentId }, [
    { account, debit: money(opts.amount), memo: opts.memo ?? opts.kind },
    { account: 'receivable', credit: money(opts.amount) },
  ])
}
