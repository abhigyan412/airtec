import { describe, it, expect } from 'vitest'
import { lineBillsInPeriod } from '../../../modules/fee/lib/resolve'

// Which installments a structure line is charged in.
//
// The default matters more than the feature: every line written before
// period_tokens existed has NULL there, and any reading of NULL other than
// "every period" would silently change what a school bills.

describe('lineBillsInPeriod', () => {
  it('bills every period when the line names none', () => {
    expect(lineBillsInPeriod(null, 'Q1')).toBe(true)
    expect(lineBillsInPeriod(undefined, 'Q3')).toBe(true)
  })

  it('treats an empty array like "every period" rather than "never"', () => {
    // The column's check constraint refuses an empty array, but a caller can
    // still send one. "Bills nowhere" is a line no one can ever be charged for,
    // so it is read as the default instead.
    expect(lineBillsInPeriod([], 'Q2')).toBe(true)
  })

  it('bills only in the periods it names', () => {
    expect(lineBillsInPeriod(['Q1'], 'Q1')).toBe(true)
    expect(lineBillsInPeriod(['Q1'], 'Q2')).toBe(false)
    expect(lineBillsInPeriod(['Q1'], 'Q3')).toBe(false)
    expect(lineBillsInPeriod(['Q1'], 'Q4')).toBe(false)
  })

  it('handles several named periods', () => {
    expect(lineBillsInPeriod(['Q1', 'Q3'], 'Q3')).toBe(true)
    expect(lineBillsInPeriod(['Q1', 'Q3'], 'Q4')).toBe(false)
  })

  it('speaks the same tokens as monthly and half-yearly plans', () => {
    expect(lineBillsInPeriod(['2026-04'], '2026-04')).toBe(true)
    expect(lineBillsInPeriod(['2026-04'], '2026-05')).toBe(false)
    expect(lineBillsInPeriod(['H1'], 'H2')).toBe(false)
  })

  it('bills everything when the caller does not say which period', () => {
    // A caller with no period cannot decide, and dropping charges is the worse
    // direction to fail in.
    expect(lineBillsInPeriod(['Q1'], undefined)).toBe(true)
  })

  it('is not fooled by a token that merely contains another', () => {
    expect(lineBillsInPeriod(['Q1'], 'Q11')).toBe(false)
  })
})
