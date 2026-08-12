import { supabase } from '../db/client'

// Single source of truth for "is this date a real working day" — used by
// both the student attendance report and staff leave so the two never
// disagree about what counts as a holiday/weekly-off day.

export type NonWorkingDaySets = { weeklyOff: Set<number>; holidays: Set<string> }

export async function getNonWorkingDaySets(schoolId: string, fromDate: string, toDate: string): Promise<NonWorkingDaySets> {
  const [{ data: school }, { data: holidays }] = await Promise.all([
    supabase.from('schools').select('weekly_off_days').eq('id', schoolId).single(),
    supabase.from('holidays').select('date').eq('school_id', schoolId).gte('date', fromDate).lte('date', toDate),
  ])
  return {
    weeklyOff: new Set<number>((school as any)?.weekly_off_days ?? [0]),
    holidays: new Set<string>((holidays ?? []).map(h => h.date)),
  }
}

export function isWorkingDate(dateStr: string, sets: NonWorkingDaySets): boolean {
  if (sets.holidays.has(dateStr)) return false
  return !sets.weeklyOff.has(new Date(`${dateStr}T00:00:00`).getDay())
}

// Formats a Date's LOCAL calendar date as 'YYYY-MM-DD'. Deliberately not
// `date.toISOString().slice(0, 10)` — that converts to UTC first, which
// silently shifts the date backward for any timezone ahead of UTC (e.g.
// IST, UTC+5:30): local midnight becomes 18:30 the *previous* day in UTC.
// That off-by-one broke every day-by-day date-range iteration in this
// file until it was caught via a live leave-exclusion test.
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today, as the school's calendar date. */
export function todayLocalISO(): string {
  return toLocalDateStr(new Date())
}

/**
 * The two ends of one school day, as timestamps Postgres cannot misread.
 *
 * Every range query in the fee module used to build its bounds as
 * `${date}T00:00:00` — a naive string with no offset. Postgres resolves those in
 * the DATABASE's timezone, which on Supabase is UTC, no matter what this process
 * believes. So a "day book for 10 August" actually asked for 05:30 IST on the
 * 10th to 05:30 IST on the 11th: it dropped the morning counter's first five and
 * a half hours and swept up the next morning's takings instead.
 *
 * Pinning TZ on the process does not fix that on its own — it fixes which date
 * we ask FOR, not which instants that date means. Hence an explicit offset,
 * derived from the school's zone rather than hardcoded, so the pair stays
 * correct if the zone ever changes.
 */
function offsetFor(dateStr: string): string {
  // The offset the school was on at noon on that date — noon so a DST boundary
  // (none in IST, but this is not IST-only code) resolves to the day's own rule.
  const noonUtc = new Date(`${dateStr}T12:00:00Z`)
  const asLocal = new Date(noonUtc.toLocaleString('en-US', { timeZone: process.env.TZ || 'Asia/Kolkata' }))
  const asUtc = new Date(noonUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  const minutes = Math.round((asLocal.getTime() - asUtc.getTime()) / 60_000)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

export function dayStartISO(dateStr: string): string {
  return `${dateStr}T00:00:00.000${offsetFor(dateStr)}`
}

export function dayEndISO(dateStr: string): string {
  return `${dateStr}T23:59:59.999${offsetFor(dateStr)}`
}

// Every 'YYYY-MM-DD' calendar date from fromDate to toDate inclusive.
export function dateRangeStrings(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${fromDate}T00:00:00`)
  const end = new Date(`${toDate}T00:00:00`)
  while (cur <= end) {
    dates.push(toLocalDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// Inclusive day-count between fromDate/toDate (both 'YYYY-MM-DD'),
// counting only actual working days per the sets above.
export function countWorkingDays(fromDate: string, toDate: string, sets: NonWorkingDaySets): number {
  return dateRangeStrings(fromDate, toDate).filter(d => isWorkingDate(d, sets)).length
}
