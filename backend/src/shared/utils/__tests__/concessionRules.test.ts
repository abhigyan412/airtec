import { describe, it, expect } from 'vitest'
import {
  buildLineItems, discountForLine, discountsForHead, ApplicableDiscount,
} from '../feeMoney'
import { ruleLabel, CATEGORY_LABELS } from '../../../modules/fee/lib/resolve'

// Concession rules turning a fee category into money.
//
// The resolver needs a database, so what is asserted here is the arithmetic it
// hands off to — which is where a wrong answer would actually reach a family's
// invoice. The stacking and clamping cases matter most: a policy concession and
// a hand-granted one now apply to the same line, which was not previously
// possible, and the failure mode is a negative fee.

const pct = (v: number, label?: string, head: string | null = null): ApplicableDiscount =>
  ({ fee_head_id: head, discount_type: 'percentage', discount_value: v, label })
const rs = (v: number, label?: string, head: string | null = null): ApplicableDiscount =>
  ({ fee_head_id: head, discount_type: 'fixed', discount_value: v, label })

describe('a policy rule stacked with a granted concession', () => {
  it('applies both and never bills a negative amount', () => {
    // 50% sibling policy + a 60% hardship grant on a 5,000 line.
    const total = discountForLine(5000, [pct(50), pct(60)])
    expect(total).toBe(5000)
  })

  it('caps two fixed concessions at the line, not below zero', () => {
    expect(discountForLine(5000, [rs(3000), rs(3000)])).toBe(5000)
  })

  it('adds a policy percentage to a granted fixed amount', () => {
    // 10% of 5,000 = 500, plus a 1,500 grant.
    expect(discountForLine(5000, [pct(10), rs(1500)])).toBe(2000)
  })

  it('leaves a line alone when no rule matches it', () => {
    expect(discountForLine(5000, [])).toBe(0)
  })
})

describe('a rule scoped to one fee head', () => {
  it('reduces that head and no other', () => {
    const rules = [pct(100, 'RTE concession', 'tuition')]
    const totals = buildLineItems([
      { fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' },
      { fee_head_id: 'transport', amount: 1500, fee_head_name: 'Transport Fee' },
    ], rules)

    expect(totals.line_items[0].net_amount).toBe(0)
    // The bus still costs money. Schools waive tuition and keep charging for
    // transport, and a rule that ignored the head would give away the fleet.
    expect(totals.line_items[1].net_amount).toBe(1500)
    expect(totals.net_amount).toBe(1500)
  })

  it('an every-head rule reaches every line', () => {
    const totals = buildLineItems([
      { fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' },
      { fee_head_id: 'exam', amount: 500, fee_head_name: 'Exam Fee' },
    ], [pct(10, 'Staff ward concession')])

    expect(totals.total_discount).toBe(550)
    expect(totals.net_amount).toBe(4950)
  })
})

describe('discountsForHead', () => {
  it('selects the every-head rules plus the ones naming this head', () => {
    const all = [pct(10, 'all'), pct(50, 'tuition only', 'tuition'), pct(25, 'other', 'transport')]
    const forTuition = discountsForHead(all, 'tuition')
    expect(forTuition.map(d => d.label)).toEqual(['all', 'tuition only'])
  })
})

describe('why a line was reduced', () => {
  it('names the concessions that actually took money off', () => {
    const totals = buildLineItems(
      [{ fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' }],
      [pct(10, 'Sibling concession'), rs(500, 'Hardship')],
    )
    expect(totals.line_items[0].discount_sources).toEqual(['Sibling concession', 'Hardship'])
  })

  it('says nothing when nothing was reduced', () => {
    const totals = buildLineItems(
      [{ fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' }],
      [pct(0, 'A rule set to zero')],
    )
    // A rule worth nothing is not a reason worth printing on a receipt.
    expect(totals.line_items[0].discount_sources).toBeUndefined()
  })

  it('does not repeat a label that applied twice', () => {
    const totals = buildLineItems(
      [{ fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' }],
      [pct(5, 'Sibling concession'), pct(5, 'Sibling concession')],
    )
    expect(totals.line_items[0].discount_sources).toEqual(['Sibling concession'])
  })
})

describe('ruleLabel', () => {
  it('names a category rule', () => {
    expect(ruleLabel({ fee_category: 'rte' })).toBe('RTE concession')
    expect(ruleLabel({ fee_category: 'staff_ward' })).toBe('Staff ward concession')
  })

  it('names a sibling-order rule in words a parent reads', () => {
    expect(ruleLabel({ min_sibling_order: 2 })).toBe('Concession from the second child')
    expect(ruleLabel({ min_sibling_order: 3 })).toBe('Concession from the third child')
  })

  it('combines both conditions', () => {
    expect(ruleLabel({ fee_category: 'sibling', min_sibling_order: 2 }))
      .toBe('Sibling concession from the second child')
  })

  it('falls back rather than printing an empty string', () => {
    expect(ruleLabel({})).toBe('Concession')
  })

  it('has a label for every category the assignment table allows', () => {
    for (const c of ['general', 'rte', 'staff_ward', 'sibling', 'scholarship']) {
      expect(CATEGORY_LABELS[c]).toBeTruthy()
    }
  })
})

// A scholarship is awarded as ONE figure. Spending it per line — which is what a
// plain fixed discount does — forgave ₹4,500 of a ₹4,000 award.
const award = (v: number, label: string): ApplicableDiscount =>
  ({ fee_head_id: null, discount_type: 'fixed', discount_value: v, budget: v, label })

describe('a scholarship is a budget for the whole invoice', () => {
  it('spends down across the lines and stops when the award runs out', () => {
    const totals = buildLineItems([
      { fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' },
      { fee_head_id: 'exam', amount: 500, fee_head_name: 'Exam Fee' },
    ], [award(4000, 'State Merit Scholarship')])

    expect(totals.line_items[0].discount).toBe(4000)
    expect(totals.line_items[1].discount).toBe(0)   // award exhausted
    expect(totals.total_discount).toBe(4000)        // exactly what was awarded
    expect(totals.net_amount).toBe(1500)
  })

  it('spills onto the next line when the first cannot absorb it', () => {
    const totals = buildLineItems([
      { fee_head_id: 'tuition', amount: 3000, fee_head_name: 'Tuition Fee' },
      { fee_head_id: 'exam', amount: 2000, fee_head_name: 'Exam Fee' },
    ], [award(4000, 'Trust grant')])

    expect(totals.line_items[0].discount).toBe(3000)
    expect(totals.line_items[1].discount).toBe(1000)
    expect(totals.total_discount).toBe(4000)
  })

  it('never forgives more than the invoice is worth', () => {
    const totals = buildLineItems(
      [{ fee_head_id: 'tuition', amount: 1000, fee_head_name: 'Tuition Fee' }],
      [award(9999, 'Oversized award')],
    )
    expect(totals.total_discount).toBe(1000)
    expect(totals.net_amount).toBe(0)
  })

  it('stacks after a policy rule without double-spending the line', () => {
    // 10% policy takes 500 off a 5,000 line; the award can then take at most the
    // remaining 4,500.
    const totals = buildLineItems(
      [{ fee_head_id: 'tuition', amount: 5000, fee_head_name: 'Tuition Fee' }],
      [pct(10, 'Sibling concession'), award(9999, 'Trust grant')],
    )
    expect(totals.total_discount).toBe(5000)
    expect(totals.net_amount).toBe(0)
    expect(totals.line_items[0].discount_sources).toEqual(['Sibling concession', 'Trust grant'])
  })
})
