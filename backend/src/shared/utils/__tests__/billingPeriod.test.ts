import { describe, it, expect } from 'vitest'
import {
  FREQUENCIES, periodKey, parsePeriodKey, periodsForFrequency, findPeriod, unknownPeriodTokens,
} from '../billingPeriod'

// The period key is what stops a bulk billing run charging the same student
// twice — it carries the unique index on fee_invoices. If these windows or keys
// shift, a school can re-bill a term it has already billed.

const APRIL_YEAR = { start: '2025-04-01', end: '2026-03-31' } // typical Indian school year
const JUNE_YEAR = { start: '2025-06-01', end: '2026-05-31' }

describe('periodKey / parsePeriodKey', () => {
  it('round-trips', () => {
    expect(parsePeriodKey(periodKey('quarterly', 'Q2'))).toEqual({ frequency: 'quarterly', token: 'Q2' })
  })

  it('formats as frequency:token', () => {
    expect(periodKey('monthly', '2025-07')).toBe('monthly:2025-07')
  })

  it('rejects an unknown frequency', () => {
    expect(parsePeriodKey('termly:T1')).toBeNull()
  })

  it('rejects a malformed key', () => {
    expect(parsePeriodKey('quarterly')).toBeNull()
    expect(parsePeriodKey(':Q1')).toBeNull()
    expect(parsePeriodKey('quarterly:')).toBeNull()
  })

  it('does not encode the academic year name', () => {
    // Deliberate: the unique index already scopes by academic_year_id. Folding a
    // renameable name into the key would mean renaming "2025-26" to "2025-2026"
    // silently unlocks billing every student a second time.
    expect(periodKey('annually', 'full')).not.toContain('2025')
  })
})

describe('periodsForFrequency — quarterly', () => {
  it('cuts quarters from the academic year start, not the calendar year', () => {
    const q = periodsForFrequency('quarterly', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(q).toHaveLength(4)
    expect(q[0].start).toBe('2025-04-01')
    expect(q[0].end).toBe('2025-06-30')
    expect(q[1].start).toBe('2025-07-01')
    expect(q[3].end).toBe('2026-03-31')
  })

  it('follows a school whose year starts in June', () => {
    const q = periodsForFrequency('quarterly', JUNE_YEAR.start, JUNE_YEAR.end)
    expect(q[0].start).toBe('2025-06-01')
    expect(q[0].end).toBe('2025-08-31')
  })

  it('labels the months each quarter covers', () => {
    const q = periodsForFrequency('quarterly', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(q[0].label).toBe('Quarter 1 (Apr–Jun)')
    expect(q[1].label).toBe('Quarter 2 (Jul–Sep)')
  })

  it('keys each quarter distinctly', () => {
    const keys = periodsForFrequency('quarterly', APRIL_YEAR.start, APRIL_YEAR.end).map(p => p.key)
    expect(new Set(keys).size).toBe(4)
    expect(keys).toEqual(['quarterly:Q1', 'quarterly:Q2', 'quarterly:Q3', 'quarterly:Q4'])
  })
})

describe('periodsForFrequency — monthly', () => {
  const m = periodsForFrequency('monthly', APRIL_YEAR.start, APRIL_YEAR.end)

  it('produces one period per month of the year', () => {
    expect(m).toHaveLength(12)
  })

  it('starts at the academic year start and rolls into the next calendar year', () => {
    expect(m[0].token).toBe('2025-04')
    expect(m[0].label).toBe('Apr 2025')
    expect(m[9].token).toBe('2026-01')
    expect(m[11].token).toBe('2026-03')
  })

  it('ends each period on the real last day of the month', () => {
    expect(m[0].end).toBe('2025-04-30')  // 30 days
    expect(m[6].end).toBe('2025-10-31')  // 31 days
    expect(m[10].end).toBe('2026-02-28') // non-leap February
  })

  it('gets February right in a leap year', () => {
    const leap = periodsForFrequency('monthly', '2024-01-01', '2024-12-31')
    expect(leap[1].end).toBe('2024-02-29')
  })
})

describe('periodsForFrequency — half-yearly, annual, one-time', () => {
  it('splits the year in two halves', () => {
    const h = periodsForFrequency('half_yearly', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(h).toHaveLength(2)
    expect(h[0].start).toBe('2025-04-01')
    expect(h[0].end).toBe('2025-09-30')
    expect(h[1].start).toBe('2025-10-01')
    expect(h[0].label).toBe('First half (Apr–Sep)')
    expect(h[1].label).toBe('Second half (Oct–Mar)')
  })

  it('gives an annual fee a single full-year period', () => {
    const a = periodsForFrequency('annually', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(a).toHaveLength(1)
    expect(a[0].key).toBe('annually:full')
    expect(a[0].start).toBe(APRIL_YEAR.start)
    expect(a[0].end).toBe(APRIL_YEAR.end)
  })

  it('gives a one-time charge a single period, keyed separately from annual', () => {
    const o = periodsForFrequency('one_time', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(o).toHaveLength(1)
    expect(o[0].key).toBe('one_time:full')
    expect(o[0].key).not.toBe('annually:full')
  })
})

describe('periodsForFrequency — odd year lengths', () => {
  it('handles a single-month year without dividing by zero', () => {
    expect(periodsForFrequency('monthly', '2025-04-01', '2025-04-30')).toHaveLength(1)
    expect(periodsForFrequency('quarterly', '2025-04-01', '2025-04-30')).toHaveLength(1)
  })

  it('rounds a part-quarter up rather than dropping the remainder', () => {
    // A 14-month year must still offer a period covering months 13–14, or those
    // months could never be billed.
    const q = periodsForFrequency('quarterly', '2025-04-01', '2026-05-31')
    expect(q).toHaveLength(5)
  })
})

describe('findPeriod', () => {
  it('finds a valid period', () => {
    const p = findPeriod('quarterly', 'Q3', APRIL_YEAR.start, APRIL_YEAR.end)
    expect(p?.start).toBe('2025-10-01')
  })

  it('returns null for a token that is not valid for the frequency', () => {
    expect(findPeriod('quarterly', 'Q9', APRIL_YEAR.start, APRIL_YEAR.end)).toBeNull()
    expect(findPeriod('quarterly', '2025-07', APRIL_YEAR.start, APRIL_YEAR.end)).toBeNull()
    expect(findPeriod('annually', 'Q1', APRIL_YEAR.start, APRIL_YEAR.end)).toBeNull()
  })
})

describe('unknownPeriodTokens', () => {
  // A line pinned to a token this cadence has no installment for bills in NO
  // period at all — silently, for the whole year. This is what stops that
  // reaching the database.

  it('accepts tokens the cadence actually has', () => {
    expect(unknownPeriodTokens('quarterly', ['Q1', 'Q4'], APRIL_YEAR.start, APRIL_YEAR.end)).toEqual([])
    expect(unknownPeriodTokens('monthly', ['2025-04'], APRIL_YEAR.start, APRIL_YEAR.end)).toEqual([])
  })

  it('treats no restriction as valid — it means every installment', () => {
    expect(unknownPeriodTokens('quarterly', [], APRIL_YEAR.start, APRIL_YEAR.end)).toEqual([])
  })

  it('catches monthly tokens carried onto a quarterly plan', () => {
    // The exact case: a version raised to change tuition, on a plan whose cadence
    // also changed. Without this the admission fee just stops being charged.
    expect(unknownPeriodTokens('quarterly', ['2025-04'], APRIL_YEAR.start, APRIL_YEAR.end))
      .toEqual(['2025-04'])
  })

  it('catches quarterly tokens carried onto a monthly plan', () => {
    expect(unknownPeriodTokens('monthly', ['Q1'], APRIL_YEAR.start, APRIL_YEAR.end)).toEqual(['Q1'])
  })

  it('catches a quarter the year is too short to reach', () => {
    // A six-month year has Q1 and Q2 only; Q3 would bill nowhere.
    expect(unknownPeriodTokens('quarterly', ['Q1', 'Q3'], '2025-04-01', '2025-09-30'))
      .toEqual(['Q3'])
  })

  it('reports each bad token once', () => {
    expect(unknownPeriodTokens('quarterly', ['Q9', 'Q9'], APRIL_YEAR.start, APRIL_YEAR.end))
      .toEqual(['Q9'])
  })

  it('is anchored on the academic year, not the calendar', () => {
    // June–May school: Q1 is Jun–Aug, so 2025-06 is its first month and 2025-04
    // is not a month of the year at all.
    expect(unknownPeriodTokens('monthly', ['2025-06'], JUNE_YEAR.start, JUNE_YEAR.end)).toEqual([])
    expect(unknownPeriodTokens('monthly', ['2025-04'], JUNE_YEAR.start, JUNE_YEAR.end)).toEqual(['2025-04'])
  })
})

describe('FREQUENCIES', () => {
  it('matches the fee_structures frequency check constraint', () => {
    expect(FREQUENCIES).toEqual(['monthly', 'quarterly', 'half_yearly', 'annually', 'one_time'])
  })

  it('produces at least one billable period for every frequency', () => {
    for (const f of FREQUENCIES) {
      expect(periodsForFrequency(f, APRIL_YEAR.start, APRIL_YEAR.end).length).toBeGreaterThan(0)
    }
  })
})
