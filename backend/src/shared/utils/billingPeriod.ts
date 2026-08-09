// Billing periods, derived from the academic year.
//
// This schema has no terms table (the academic_calendar migration is holidays
// only), so "which period am I billing?" has to come from somewhere. It comes
// from fee_structures.frequency plus the academic year's own start and end
// dates — which is also the only definition a school would recognise: an Indian
// school year starting in April has Q1 = April-June, not January-March.
//
// The resulting period_key is stored on the invoice and carries the unique
// index that makes a billing run idempotent. It deliberately does NOT include
// the academic year's *name*: the unique index already scopes by
// academic_year_id, and folding a renameable text field into the key would mean
// renaming "2025-26" to "2025-2026" silently unlocks billing every student a
// second time.

export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annually' | 'one_time'

export const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'half_yearly', 'annually', 'one_time']

export interface BillingPeriod {
  /** Identifier within the frequency, e.g. '2025-07', 'Q2', 'H1', 'full'. */
  token: string
  /** Stored on the invoice: `${frequency}:${token}`. */
  key: string
  /** For humans: 'July 2025', 'Quarter 2 (Jul–Sep)', 'Full year'. */
  label: string
  /** Inclusive YYYY-MM-DD bounds, for defaulting the due date. */
  start: string
  end: string
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function periodKey(frequency: Frequency, token: string): string {
  return `${frequency}:${token}`
}

export function parsePeriodKey(key: string): { frequency: Frequency; token: string } | null {
  const idx = key.indexOf(':')
  if (idx < 1) return null
  const frequency = key.slice(0, idx) as Frequency
  if (!FREQUENCIES.includes(frequency)) return null
  const token = key.slice(idx + 1)
  return token ? { frequency, token } : null
}

/** YYYY-MM-DD for a UTC-safe date built from parts. */
function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Number of whole months the academic year spans, at least 1. */
function monthSpan(startISO: string, endISO: string): number {
  const [sy, sm] = startISO.split('-').map(Number)
  const [ey, em] = endISO.split('-').map(Number)
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1)
}

/**
 * Every period a school could bill for this frequency, in order.
 *
 * Windows are cut from the academic year's own start date, so a school running
 * April–March gets Q1 = Apr–Jun and a school running June–May gets Q1 = Jun–Aug,
 * with no configuration.
 */
export function periodsForFrequency(
  frequency: Frequency,
  yearStart: string,
  yearEnd: string,
): BillingPeriod[] {
  const [startYear, startMonth] = yearStart.split('-').map(Number)
  const startMonthIndex = startMonth - 1
  const span = monthSpan(yearStart, yearEnd)

  const window = (offsetMonths: number, lengthMonths: number) => {
    const s = new Date(Date.UTC(startYear, startMonthIndex + offsetMonths, 1))
    const eMonth = startMonthIndex + offsetMonths + lengthMonths - 1
    const e = new Date(Date.UTC(startYear, eMonth, 1))
    return {
      start: ymd(s.getUTCFullYear(), s.getUTCMonth(), 1),
      end: ymd(e.getUTCFullYear(), e.getUTCMonth(), lastDayOfMonth(e.getUTCFullYear(), e.getUTCMonth())),
    }
  }

  const chunked = (lengthMonths: number, prefix: string, labelFor: (n: number, w: { start: string; end: string }) => string) => {
    const out: BillingPeriod[] = []
    const count = Math.ceil(span / lengthMonths)
    for (let i = 0; i < count; i++) {
      const w = window(i * lengthMonths, lengthMonths)
      const token = `${prefix}${i + 1}`
      out.push({ token, key: periodKey(frequency, token), label: labelFor(i + 1, w), ...w })
    }
    return out
  }

  const monthRange = (w: { start: string; end: string }) => {
    const sm = MONTH_NAMES[Number(w.start.split('-')[1]) - 1]
    const em = MONTH_NAMES[Number(w.end.split('-')[1]) - 1]
    return `${sm}–${em}`
  }

  switch (frequency) {
    case 'monthly': {
      const out: BillingPeriod[] = []
      for (let i = 0; i < span; i++) {
        const d = new Date(Date.UTC(startYear, startMonthIndex + i, 1))
        const y = d.getUTCFullYear()
        const m = d.getUTCMonth()
        const token = `${y}-${String(m + 1).padStart(2, '0')}`
        out.push({
          token,
          key: periodKey('monthly', token),
          label: `${MONTH_NAMES[m]} ${y}`,
          start: ymd(y, m, 1),
          end: ymd(y, m, lastDayOfMonth(y, m)),
        })
      }
      return out
    }
    case 'quarterly':
      return chunked(3, 'Q', (n, w) => `Quarter ${n} (${monthRange(w)})`)
    case 'half_yearly':
      return chunked(6, 'H', (n, w) => `${n === 1 ? 'First' : 'Second'} half (${monthRange(w)})`)
    case 'annually':
      return [{
        token: 'full', key: periodKey('annually', 'full'), label: 'Full year',
        start: yearStart, end: yearEnd,
      }]
    case 'one_time':
      return [{
        token: 'full', key: periodKey('one_time', 'full'), label: 'One-time charge',
        start: yearStart, end: yearEnd,
      }]
  }
}

/**
 * Tokens that are NOT installments of this cadence — the ones that would bill
 * nowhere.
 *
 * A line pinned to `2025-04` on a plan later versioned to quarterly names a
 * period the plan can never raise, so the charge silently disappears for the
 * whole year. Callers use this to refuse the save and say which line is wrong,
 * rather than storing a token nothing will ever match.
 */
export function unknownPeriodTokens(
  frequency: Frequency,
  tokens: string[],
  yearStart: string,
  yearEnd: string,
): string[] {
  const valid = new Set(periodsForFrequency(frequency, yearStart, yearEnd).map(p => p.token))
  return Array.from(new Set(tokens)).filter(t => !valid.has(t))
}

/** Look up one period, or null if the token isn't valid for that frequency. */
export function findPeriod(
  frequency: Frequency,
  token: string,
  yearStart: string,
  yearEnd: string,
): BillingPeriod | null {
  return periodsForFrequency(frequency, yearStart, yearEnd).find(p => p.token === token) ?? null
}
