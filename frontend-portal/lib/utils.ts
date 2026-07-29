import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

/** "12 Aug" — for dates inside the current year, where the year is noise. */
export function formatDateShort(date: string | Date) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(date))
}

/** Today as YYYY-MM-DD in the LOCAL timezone. `toISOString()` is UTC and lands
 *  a day behind through an IST morning, which silently mis-sorts "due today". */
export function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Plain-language due dates. A parent scanning homework needs "Due tomorrow",
 * not "Due 30 Jul 2026" — relative phrasing answers "is this urgent?" without
 * making them do date arithmetic.
 */
export function formatRelativeDue(dueISO: string): { label: string; overdue: boolean } {
  const today = todayLocalISO()
  if (dueISO < today) return { label: `Overdue — was due ${formatDateShort(dueISO)}`, overdue: true }
  if (dueISO === today) return { label: 'Due today', overdue: false }

  const days = Math.round((new Date(dueISO).getTime() - new Date(today).getTime()) / 86_400_000)
  if (days === 1) return { label: 'Due tomorrow', overdue: false }
  if (days <= 6) return { label: `Due in ${days} days`, overdue: false }
  return { label: `Due ${formatDateShort(dueISO)}`, overdue: false }
}

// Semantic status → Badge variant. Returning a variant name rather than a class
// string keeps the colour decision inside <Badge>, so a status pill can never
// drift from the rest of the system the way the old light-only `bg-green-100`
// map did (it was invisible in dark mode).
export type BadgeVariant = 'default' | 'neutral' | 'success' | 'warning' | 'destructive'

export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  inactive: 'neutral',
  transferred: 'default',
  suspended: 'destructive',
  new: 'default',
  follow_up: 'warning',
  interested: 'default',
  admitted: 'success',
  rejected: 'destructive',
  paid: 'success',
  unpaid: 'destructive',
  partial: 'warning',
  pending: 'neutral',
}

export const statusVariant = (status?: string): BadgeVariant =>
  (status && STATUS_VARIANT[status]) || 'neutral'

/**
 * Attendance percentage → tone. 75% is the threshold most Indian boards use for
 * exam eligibility, so it's the line that actually matters to a parent.
 */
export function attendanceTone(pct: number): 'success' | 'warning' | 'destructive' {
  if (pct >= 75) return 'success'
  if (pct >= 60) return 'warning'
  return 'destructive'
}
