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
 * Money received: the asset account is debited, and the credit is split between
 * what settled invoices (income) and what was taken in advance (a liability —
 * the school owes the family that value in future schooling).
 */
export async function postPayment(opts: {
  schoolId: string
  paymentId: string
  studentId: string
  method: string
  allocated: number
  unallocated: number
  lateFee?: number
}): Promise<boolean> {
  const asset = accountForMethod(opts.method)
  const lateFee = money(opts.lateFee ?? 0)
  const feeIncome = money(opts.allocated - lateFee)

  return post(opts.schoolId, { type: 'payment', id: opts.paymentId, studentId: opts.studentId }, [
    { account: asset, debit: money(opts.allocated + opts.unallocated), memo: `Receipt via ${opts.method}` },
    ...(feeIncome > 0 ? [{ account: 'fee_income' as Account, credit: feeIncome }] : []),
    ...(lateFee > 0 ? [{ account: 'late_fee_income' as Account, credit: lateFee }] : []),
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
    ...(allocated > 0 ? [{ account: 'fee_income' as Account, debit: allocated, memo: 'Cheque dishonoured' }] : []),
    ...(unallocated > 0 ? [{ account: 'advance' as Account, debit: unallocated, memo: 'Advance reversed' }] : []),
    { account: asset, credit: money(allocated + unallocated), memo: `Bounced ${opts.method}` },
  ])
}

/** Money returned: income reverses, the asset account is credited. */
export async function postRefund(opts: {
  schoolId: string; paymentId: string; studentId: string; method: string; amount: number
}): Promise<boolean> {
  return post(opts.schoolId, { type: 'refund', id: opts.paymentId, studentId: opts.studentId }, [
    { account: 'fee_income', debit: money(opts.amount), memo: 'Refund' },
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
