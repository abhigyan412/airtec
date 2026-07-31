import { describe, it, expect, vi, beforeEach } from 'vitest'

const schoolSingle = vi.fn()
const holidaysQuery = vi.fn()
vi.mock('../../db/client', () => ({
  supabase: {
    from: (table: string) => table === 'schools'
      ? { select: () => ({ eq: () => ({ single: () => schoolSingle() }) }) }
      : { select: () => ({ eq: () => ({ gte: () => ({ lte: () => holidaysQuery() }) }) }) },
  },
  createUserClient: vi.fn(),
}))

const {
  getNonWorkingDaySets, isWorkingDate, toLocalDateStr, dateRangeStrings, countWorkingDays,
} = await import('../academicCalendar')

const sets = (weeklyOff: number[], holidays: string[] = []) => ({
  weeklyOff: new Set(weeklyOff), holidays: new Set(holidays),
})

describe('toLocalDateStr', () => {
  it('formats the LOCAL calendar date', () => {
    expect(toLocalDateStr(new Date(2026, 6, 29))).toBe('2026-07-29')
  })

  it('zero-pads month and day', () => {
    expect(toLocalDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('does not shift the date backwards at local midnight', () => {
    // The bug this replaced: toISOString() converts to UTC first, so in
    // any timezone ahead of UTC local midnight becomes 18:30 the previous
    // day — every date-range iteration was off by one.
    const midnight = new Date(2026, 6, 29, 0, 0, 0)
    expect(toLocalDateStr(midnight)).toBe('2026-07-29')
  })

  it('handles the last instant of a day', () => {
    expect(toLocalDateStr(new Date(2026, 6, 29, 23, 59, 59))).toBe('2026-07-29')
  })
})

describe('dateRangeStrings', () => {
  it('is inclusive at both ends', () => {
    expect(dateRangeStrings('2026-07-01', '2026-07-03'))
      .toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
  })

  it('returns a single day when from === to', () => {
    expect(dateRangeStrings('2026-07-01', '2026-07-01')).toEqual(['2026-07-01'])
  })

  it('returns nothing when the range is inverted', () => {
    expect(dateRangeStrings('2026-07-05', '2026-07-01')).toEqual([])
  })

  it('crosses a month boundary', () => {
    expect(dateRangeStrings('2026-07-30', '2026-08-02'))
      .toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'])
  })

  it('crosses a year boundary', () => {
    expect(dateRangeStrings('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('handles a leap day', () => {
    expect(dateRangeStrings('2028-02-28', '2028-03-01'))
      .toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })
})

describe('isWorkingDate', () => {
  it('excludes a holiday', () => {
    expect(isWorkingDate('2026-08-15', sets([0], ['2026-08-15']))).toBe(false)
  })

  it('excludes the weekly off day', () => {
    // 2026-07-26 is a Sunday.
    expect(isWorkingDate('2026-07-26', sets([0]))).toBe(false)
  })

  it('accepts an ordinary weekday', () => {
    expect(isWorkingDate('2026-07-29', sets([0]))).toBe(true)
  })

  it('supports a school with a non-Sunday weekly off', () => {
    // Friday = 5. 2026-07-31 is a Friday.
    expect(isWorkingDate('2026-07-31', sets([5]))).toBe(false)
    expect(isWorkingDate('2026-07-26', sets([5]))).toBe(true)
  })

  it('supports multiple weekly off days', () => {
    expect(isWorkingDate('2026-07-25', sets([0, 6]))).toBe(false)  // Saturday
    expect(isWorkingDate('2026-07-26', sets([0, 6]))).toBe(false)  // Sunday
  })
})

describe('countWorkingDays', () => {
  it('counts only working days across a full week', () => {
    // Mon 2026-07-27 .. Sun 2026-08-02, Sunday off → 6.
    expect(countWorkingDays('2026-07-27', '2026-08-02', sets([0]))).toBe(6)
  })

  it('subtracts holidays too', () => {
    expect(countWorkingDays('2026-07-27', '2026-08-02', sets([0], ['2026-07-29']))).toBe(5)
  })

  it('returns 0 when every day is excluded', () => {
    expect(countWorkingDays('2026-07-25', '2026-07-26', sets([0, 6]))).toBe(0)
  })

  it('counts a single working day as 1', () => {
    expect(countWorkingDays('2026-07-29', '2026-07-29', sets([0]))).toBe(1)
  })
})

describe('getNonWorkingDaySets', () => {
  beforeEach(() => { schoolSingle.mockReset(); holidaysQuery.mockReset() })

  it('reads the school weekly-off config and holidays in range', async () => {
    schoolSingle.mockResolvedValue({ data: { weekly_off_days: [0, 6] } })
    holidaysQuery.mockResolvedValue({ data: [{ date: '2026-08-15' }, { date: '2026-10-02' }] })
    const s = await getNonWorkingDaySets('school-1', '2026-08-01', '2026-10-31')
    expect([...s.weeklyOff].sort()).toEqual([0, 6])
    expect(s.holidays.has('2026-08-15')).toBe(true)
    expect(s.holidays.has('2026-10-02')).toBe(true)
  })

  it('defaults to Sunday when the school has no weekly-off configured', async () => {
    schoolSingle.mockResolvedValue({ data: { weekly_off_days: null } })
    holidaysQuery.mockResolvedValue({ data: [] })
    expect([...(await getNonWorkingDaySets('s', 'a', 'b')).weeklyOff]).toEqual([0])
  })

  it('defaults to Sunday when the school row is missing entirely', async () => {
    schoolSingle.mockResolvedValue({ data: null })
    holidaysQuery.mockResolvedValue({ data: null })
    const s = await getNonWorkingDaySets('s', 'a', 'b')
    expect([...s.weeklyOff]).toEqual([0])
    expect(s.holidays.size).toBe(0)
  })
})
