// Fee arithmetic, with no database in it.
//
// Every one of these calculations used to live inline in a route handler, and
// several of them lived inline in TWO route handlers with different answers.
// The invoice generator and the retroactive-discount recompute both build line
// items from structures and discounts; before this they were separate copies,
// and they disagreed about late fines — the generator kept them, the recompute
// silently dropped them, so approving a discount erased every fine the school
// had accrued.
//
// Pulling them out here means there is one implementation to be right, and it
// can be tested without a Supabase instance.

/**
 * Rupees, rounded the way the numeric(12,2) columns store them.
 *
 * Half away from zero, on the DECIMAL value a person typed rather than on the
 * binary float that approximates it.
 *
 * This used to be `Math.round((n + Number.EPSILON) * 100) / 100`, and the
 * epsilon nudge did nothing above about 2.0. Number.EPSILON is the gap between
 * 1.0 and the next representable double; by 4.475 the gap is four times larger,
 * so adding it does not move the value at all and money(4.475) returned 4.47.
 * It worked at 1.005 and silently stopped working as the amounts got real.
 *
 * toPrecision(12) is the fix: it renders the scaled value to twelve significant
 * digits, which discards the 4.474999999999999645 representation error while
 * keeping every digit a rupee amount can legitimately have — numeric(12,2) tops
 * out at ten integer digits plus two decimals, so nothing real is lost.
 */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0

  const scaled = Number((Math.abs(n) * 100).toPrecision(12))
  // Math.round is half-UP, which rounds -0.5 to -0 and biases every negative
  // amount towards zero. Refunds and reversals are negative here, so the sign is
  // taken off and put back to keep the two directions symmetrical.
  return Math.sign(n) * Math.round(scaled) / 100
}

export type DiscountType = 'percentage' | 'fixed'

export interface ApplicableDiscount {
  fee_head_id: string | null
  discount_type: DiscountType
  discount_value: number
  /**
   * Why this concession exists, for the receipt. A parent looking at a reduced
   * line asks what it is, and "Sibling concession (policy)" answers it where a
   * bare deduction does not. Optional: hand-granted concessions predate this and
   * carry no label.
   */
  label?: string
  /**
   * A ceiling across the WHOLE invoice rather than per line.
   *
   * A scholarship is awarded as one figure — "₹4,000 from the trust" — and
   * treating it like an ordinary fixed discount spends it once per line: ₹4,000
   * off tuition AND ₹500 off the exam fee, forgiving ₹4,500 of a ₹4,000 award.
   * With a budget it is spent down across the lines in order and stops when it
   * runs out. `discount_value` is ignored when this is set.
   */
  budget?: number
}

export interface BillableStructure {
  fee_head_id: string
  amount: number
  fee_head_name: string
}

export interface LineItem {
  fee_head_id: string
  name: string
  amount: number
  discount: number
  net_amount: number
  /**
   * The labelled concessions that reduced this line, snapshotted with it.
   *
   * Written into the invoice's line_items JSON, so the reason survives even if
   * the rule is later edited or deleted — the same principle that keeps the
   * amounts here rather than recomputing them from today's structures. Absent
   * when nothing labelled applied.
   */
  discount_sources?: string[]
}

export interface InvoiceTotals {
  line_items: LineItem[]
  subtotal: number
  total_discount: number
  /** subtotal - total_discount. Late fine is added separately, see invoiceTotal. */
  net_amount: number
}

/**
 * Discount for one line, summing every discount passed in.
 *
 * A student can hold more than one approved concession — sibling plus staff-ward,
 * say — and all of them reduce the fee. Callers select which ones apply with
 * discountsForHead().
 *
 * Capped at the line's own amount: a 60% and a 50% discount on the same head
 * must not produce a negative fee, and two fixed discounts of 3,000 against a
 * 5,000 tuition line must not either.
 */
export function discountForLine(baseAmount: number, discounts: ApplicableDiscount[]): number {
  let total = 0
  for (const d of discounts) {
    total += d.discount_type === 'percentage'
      ? (baseAmount * Number(d.discount_value)) / 100
      : Number(d.discount_value)
  }
  return money(Math.min(total, baseAmount))
}

/** The discounts from `all` that apply to a given fee head. */
export function discountsForHead(all: ApplicableDiscount[], feeHeadId: string): ApplicableDiscount[] {
  return all.filter(d => !d.fee_head_id || d.fee_head_id === feeHeadId)
}

/**
 * Build an invoice's line items from the class's fee structures and the
 * student's approved discounts.
 *
 * Used by the single-student invoice endpoint, the bulk billing preview, and
 * the bulk billing generate — so a preview can never show a figure the generate
 * step wouldn't produce.
 */
export function buildLineItems(
  structures: BillableStructure[],
  approvedDiscounts: ApplicableDiscount[],
): InvoiceTotals {
  // Per-line concessions first: a percentage means "of this line", and a fixed
  // grant against a head means "off that head".
  const perLine = approvedDiscounts.filter(d => d.budget == null)
  const budgeted = approvedDiscounts.filter(d => d.budget != null)

  const line_items: LineItem[] = structures.map(s => {
    const amount = money(Number(s.amount))
    const applied = discountsForHead(perLine, s.fee_head_id)
    const discount = discountForLine(amount, applied)
    // Only the ones that actually reduced something get named. A rule matching a
    // head with a zero-value discount is not a reason worth printing.
    const sources = discount > 0
      ? Array.from(new Set(applied.map(d => d.label).filter((l): l is string => !!l)))
      : []
    return {
      fee_head_id: s.fee_head_id,
      name: s.fee_head_name,
      amount,
      discount,
      net_amount: money(amount - discount),
      ...(sources.length ? { discount_sources: sources } : {}),
    }
  })

  // Then the whole-invoice ones, spent down across the lines in order until the
  // award runs out. A ₹4,000 scholarship must take ₹4,000 off the invoice, not
  // ₹4,000 off every line it happens to match.
  for (const b of budgeted) {
    let remaining = money(Number(b.budget))
    for (const line of line_items) {
      if (remaining <= 0) break
      if (b.fee_head_id && b.fee_head_id !== line.fee_head_id) continue
      const take = money(Math.min(remaining, line.net_amount))
      if (take <= 0) continue
      line.discount = money(line.discount + take)
      line.net_amount = money(line.net_amount - take)
      remaining = money(remaining - take)
      if (b.label) {
        line.discount_sources = Array.from(new Set([...(line.discount_sources ?? []), b.label]))
      }
    }
  }

  const subtotal = money(line_items.reduce((s, l) => s + l.amount, 0))
  const total_discount = money(line_items.reduce((s, l) => s + l.discount, 0))

  return { line_items, subtotal, total_discount, net_amount: money(subtotal - total_discount) }
}

/**
 * Recompute an existing invoice's line items against the student's current set
 * of approved discounts.
 *
 * Differs from buildLineItems in that the base amounts come from the invoice's
 * own snapshot, not from today's fee structures — a fee revision must not
 * retroactively change what an already-issued invoice billed. Only the discount
 * portion moves.
 */
export function recomputeLineItems(
  existing: Array<{ fee_head_id: string; name?: string; amount: number | string }>,
  approvedDiscounts: ApplicableDiscount[],
): InvoiceTotals {
  return buildLineItems(
    existing.map(item => ({
      fee_head_id: item.fee_head_id,
      amount: Number(item.amount),
      fee_head_name: item.name ?? 'Fee',
    })),
    approvedDiscounts,
  )
}

/**
 * What the invoice is actually worth: the discounted fee plus any late fine.
 *
 * The late fine term is the whole point of this function existing. It was
 * missing from the discount recompute, which wrote `subtotal - discount`
 * straight into total_amount and wiped the fine.
 */
export function invoiceTotal(netAmount: number, lateFine: number): number {
  return money(netAmount + money(lateFine))
}

/** Remaining balance. Negative is impossible in practice — the DB refuses overpayment. */
export function amountDue(totalAmount: number | string, amountPaid: number | string): number {
  return money(Number(totalAmount) - Number(amountPaid))
}

/**
 * Late fine for one invoice: each line's daily rate times days overdue.
 *
 * Rates come from the fee structure for that head IN THAT INVOICE'S ACADEMIC
 * YEAR — a head's fine rate can change between years, and an old invoice must
 * keep accruing at the rate it was issued under.
 */
export function lateFineFor(
  lineItems: Array<{ fee_head_id?: string }>,
  daysOverdue: number,
  dailyRateFor: (feeHeadId: string) => number,
): number {
  if (daysOverdue <= 0) return 0
  let total = 0
  for (const item of lineItems) {
    if (!item.fee_head_id) continue
    const rate = dailyRateFor(item.fee_head_id)
    if (rate > 0) total += rate * daysOverdue
  }
  return money(total)
}

/** Whole days between a due date and today. Negative means not yet due. */
export function daysOverdue(dueDate: string | Date, asOf: Date): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
  return Math.floor((asOf.getTime() - due.getTime()) / 86_400_000)
}

export type AgingBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus'

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  if (days <= 90) return '61_90'
  return '90_plus'
}
