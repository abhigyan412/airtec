// CSV, done properly once.
//
// The fee module had no export at all, and a school needs one for trust audits,
// board packs and Tally imports. Hand-rolling `rows.join(',')` at each call site
// is how a student named "Mehta, Rajesh" silently becomes two columns and every
// figure after it shifts left.

export interface CsvColumn<T> {
  key: string
  label: string
  value?: (row: T) => unknown
}

/**
 * Quote a field per RFC 4180: wrap in quotes when it contains a delimiter, a
 * quote or a newline, and double any embedded quotes.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // A leading =, +, - or @ is executed as a formula by Excel and Sheets. Prefixing
  // a tab neutralises it without changing what a human reads — a fee note of
  // "=cmd|..." must not become a command on an accountant's laptop.
  const safe = /^[=+\-@]/.test(s) ? `\t${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => cell(c.label)).join(',')
  const body = rows.map(row =>
    columns.map(c => cell(c.value ? c.value(row) : (row as any)[c.key])).join(','))
  // CRLF, because Excel on Windows treats a bare LF as one long line.
  // The BOM makes it read ₹ and non-ASCII names as UTF-8 rather than mojibake.
  return '﻿' + [header, ...body].join('\r\n') + '\r\n'
}

/** Content-Disposition value with a date-stamped, filesystem-safe name. */
export function csvFilename(base: string, stamp?: string): string {
  const safe = base.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${safe}${stamp ? `-${stamp}` : ''}.csv`
}
