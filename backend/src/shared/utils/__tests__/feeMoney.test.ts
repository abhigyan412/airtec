import { describe, it, expect } from 'vitest'
import {
  money, discountForLine, discountsForHead, buildLineItems, recomputeLineItems,
  invoiceTotal, amountDue, lateFineFor, daysOverdue, agingBucket,
} from '../feeMoney'

// Pure arithmetic, no database — which is the point. These calculations used to
// live inline in route handlers, in two copies that disagreed, and the
// disagreement was invisible until a school's late fines vanished.

describe('money', () => {
  it('rounds to paise', () => {
    expect(money(1234.567)).toBe(1234.57)
    expect(money(1234.564)).toBe(1234.56)
  })

  it('does not leave float dust on a percentage split', () => {
    // 10% of 1,234.55 is 123.455 in real arithmetic and 123.45500000000001 in
    // binary floating point. Left unrounded it propagates into total_amount and
    // an invoice paid in full compares as 0.000000001 short.
    expect(money((1234.55 * 10) / 100)).toBe(123.46)
    expect(money(0.1 + 0.2)).toBe(0.3)
  })
})

describe('discountForLine', () => {
  it('applies a fixed discount', () => {
    expect(discountForLine(5000, [{ fee_head_id: null, discount_type: 'fixed', discount_value: 500 }])).toBe(500)
  })

  it('applies a percentage discount', () => {
    expect(discountForLine(5000, [{ fee_head_id: null, discount_type: 'percentage', discount_value: 10 }])).toBe(500)
  })

  it('sums several concessions on the same line', () => {
    // A student can hold a sibling discount AND a staff-ward discount. The
    // original code took only the first match, so the second was silently
    // ignored and the family was overbilled.
    const total = discountForLine(5000, [
      { fee_head_id: null, discount_type: 'fixed', discount_value: 500 },
      { fee_head_id: null, discount_type: 'percentage', discount_value: 10 },
    ])
    expect(total).toBe(1000)
  })

  it('never discounts more than the line is worth', () => {
    expect(discountForLine(5000, [
      { fee_head_id: null, discount_type: 'percentage', discount_value: 60 },
      { fee_head_id: null, discount_type: 'percentage', discount_value: 50 },
    ])).toBe(5000)

    expect(discountForLine(5000, [
      { fee_head_id: null, discount_type: 'fixed', discount_value: 3000 },
      { fee_head_id: null, discount_type: 'fixed', discount_value: 3000 },
    ])).toBe(5000)
  })

  it('is zero with no discounts', () => {
    expect(discountForLine(5000, [])).toBe(0)
  })

  it('accepts numeric strings, which is how Postgres returns numeric', () => {
    expect(discountForLine(5000, [
      { fee_head_id: null, discount_type: 'fixed', discount_value: '500' as any },
    ])).toBe(500)
  })
})

describe('discountsForHead', () => {
  const all = [
    { fee_head_id: null, discount_type: 'fixed' as const, discount_value: 100 },
    { fee_head_id: 'tuition', discount_type: 'fixed' as const, discount_value: 200 },
    { fee_head_id: 'transport', discount_type: 'fixed' as const, discount_value: 300 },
  ]

  it('includes head-specific and school-wide discounts', () => {
    expect(discountsForHead(all, 'tuition')).toHaveLength(2)
  })

  it('excludes discounts for other heads', () => {
    expect(discountsForHead(all, 'tuition').map(d => d.discount_value)).toEqual([100, 200])
  })

  it('returns only the null-head discount for an unrelated head', () => {
    expect(discountsForHead(all, 'exam')).toEqual([all[0]])
  })
})

describe('buildLineItems', () => {
  const structures = [
    { fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition' },
    { fee_head_id: 'transport', amount: 1500, fee_head_name: 'Transport' },
  ]

  it('bills the full amount when there are no discounts', () => {
    const r = buildLineItems(structures, [])
    expect(r.subtotal).toBe(6500)
    expect(r.total_discount).toBe(0)
    expect(r.net_amount).toBe(6500)
  })

  it('applies a head-specific discount only to that head', () => {
    const r = buildLineItems(structures, [
      { fee_head_id: 'transport', discount_type: 'fixed', discount_value: 1500 },
    ])
    expect(r.line_items[0].net_amount).toBe(5000)
    expect(r.line_items[1].net_amount).toBe(0)
    expect(r.net_amount).toBe(5000)
  })

  it('applies a school-wide discount to every head', () => {
    const r = buildLineItems(structures, [
      { fee_head_id: null, discount_type: 'percentage', discount_value: 10 },
    ])
    expect(r.total_discount).toBe(650)
    expect(r.net_amount).toBe(5850)
  })

  it('carries the fee head name onto the line', () => {
    expect(buildLineItems(structures, []).line_items[0].name).toBe('Tuition')
  })

  it('handles an empty structure list', () => {
    const r = buildLineItems([], [])
    expect(r).toEqual({ line_items: [], subtotal: 0, total_discount: 0, net_amount: 0 })
  })
})

describe('recomputeLineItems', () => {
  it('re-prices against the invoice snapshot, not against current fee structures', () => {
    // The school raised the tuition fee to 6,000 after this invoice was issued.
    // Recomputing a discount must not retroactively rebill the student at the
    // new rate — only the discount portion may move.
    const snapshot = [{ fee_head_id: 'tuition', name: 'Tuition', amount: 5000 }]
    const r = recomputeLineItems(snapshot, [
      { fee_head_id: null, discount_type: 'fixed', discount_value: 500 },
    ])
    expect(r.subtotal).toBe(5000)
    expect(r.net_amount).toBe(4500)
  })

  it('accepts numeric strings from the database', () => {
    const r = recomputeLineItems([{ fee_head_id: 't', amount: '5000' }], [])
    expect(r.subtotal).toBe(5000)
  })

  it('falls back to a generic name when the snapshot has none', () => {
    expect(recomputeLineItems([{ fee_head_id: 't', amount: 100 }], []).line_items[0].name).toBe('Fee')
  })
})

describe('invoiceTotal', () => {
  it('adds the late fine to the discounted fee', () => {
    expect(invoiceTotal(4500, 250)).toBe(4750)
  })

  it('KEEPS the late fine when a discount is applied afterwards', () => {
    // The regression this exists to prevent: the old discount recompute wrote
    // `subtotal - discount` into total_amount with no fine term, so approving a
    // concession erased every rupee of fine the school had accrued — and the
    // sweep never restored it, because it only writes when the COMPUTED fine
    // changes, and it hadn't.
    const feeAfterDiscount = 4500
    const accruedFine = 250
    expect(invoiceTotal(feeAfterDiscount, accruedFine)).toBe(4750)
    expect(invoiceTotal(feeAfterDiscount, accruedFine)).not.toBe(feeAfterDiscount)
  })

  it('handles a zero fine', () => {
    expect(invoiceTotal(4500, 0)).toBe(4500)
  })
})

describe('amountDue', () => {
  it('is the bill minus what has been paid', () => {
    expect(amountDue(5000, 2000)).toBe(3000)
  })

  it('is zero on a settled invoice', () => {
    expect(amountDue(5000, 5000)).toBe(0)
  })

  it('accepts the numeric strings Postgres returns', () => {
    expect(amountDue('5000.00', '1234.56')).toBe(3765.44)
  })
})

describe('lateFineFor', () => {
  const lines = [{ fee_head_id: 'tuition' }, { fee_head_id: 'transport' }]
  const rates: Record<string, number> = { tuition: 10, transport: 0 }
  const rateFor = (id: string) => rates[id] ?? 0

  it('charges each line at its own daily rate', () => {
    expect(lateFineFor(lines, 5, rateFor)).toBe(50)
  })

  it('charges nothing before the due date', () => {
    expect(lateFineFor(lines, 0, rateFor)).toBe(0)
    expect(lateFineFor(lines, -3, rateFor)).toBe(0)
  })

  it('ignores heads with no fine configured', () => {
    expect(lateFineFor([{ fee_head_id: 'transport' }], 30, rateFor)).toBe(0)
  })

  it('skips line items with no fee head', () => {
    expect(lateFineFor([{}, { fee_head_id: 'tuition' }], 2, rateFor)).toBe(20)
  })
})

describe('daysOverdue', () => {
  const asOf = new Date('2026-08-08T12:00:00Z')

  it('counts whole days past the due date', () => {
    expect(daysOverdue('2026-08-01', asOf)).toBe(7)
  })

  it('is negative before the due date', () => {
    expect(daysOverdue('2026-08-20', asOf)).toBeLessThan(0)
  })

  it('accepts a Date as well as a string', () => {
    expect(daysOverdue(new Date('2026-08-01T00:00:00Z'), asOf)).toBe(7)
  })
})

describe('agingBucket', () => {
  it('buckets by how late the invoice is', () => {
    expect(agingBucket(-5)).toBe('current')
    expect(agingBucket(0)).toBe('current')
    expect(agingBucket(1)).toBe('1_30')
    expect(agingBucket(30)).toBe('1_30')
    expect(agingBucket(31)).toBe('31_60')
    expect(agingBucket(60)).toBe('31_60')
    expect(agingBucket(61)).toBe('61_90')
    expect(agingBucket(90)).toBe('61_90')
    expect(agingBucket(91)).toBe('90_plus')
  })
})

describe('an invoice end to end', () => {
  it('bills, discounts, fines and settles without drift', () => {
    const structures = [
      { fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition' },
      { fee_head_id: 'exam', amount: 750, fee_head_name: 'Exam' },
    ]

    // Raised with a 10% sibling concession.
    const issued = buildLineItems(structures, [
      { fee_head_id: null, discount_type: 'percentage', discount_value: 10 },
    ])
    expect(issued.net_amount).toBe(5175)

    // Two weeks late at ₹10/day on tuition only.
    const fine = lateFineFor(issued.line_items, 14, id => (id === 'tuition' ? 10 : 0))
    const withFine = invoiceTotal(issued.net_amount, fine)
    expect(withFine).toBe(5315)

    // A further fixed concession is approved on tuition. The fine must survive.
    const recomputed = recomputeLineItems(issued.line_items, [
      { fee_head_id: null, discount_type: 'percentage', discount_value: 10 },
      { fee_head_id: 'tuition', discount_type: 'fixed', discount_value: 200 },
    ])
    const afterApproval = invoiceTotal(recomputed.net_amount, fine)
    expect(afterApproval).toBe(5115)
    expect(afterApproval - recomputed.net_amount).toBe(fine)

    // Paid in two instalments; the balance lands exactly on zero.
    expect(amountDue(afterApproval, 3000)).toBe(2115)
    expect(amountDue(afterApproval, 5115)).toBe(0)
  })
})
