import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string | null | undefined) {
  // A missing or unparseable figure renders as ₹0, never "₹NaN". Intl formats
  // NaN happily, so a single stale field name — a renamed column, a typo'd key —
  // used to surface as ₹NaN on a fees screen in front of a parent. ₹0 is wrong
  // in the same way but does not look like the software is broken; the real
  // defect still has to be fixed at the source.
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)
}

/** Alias for the same INR formatter, matching the reference design system. */
export const formatINR = formatCurrency

/** Compact Indian-notation number: 12.3L, 4.5Cr, 8.1K. */
export function formatCompact(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(date))
}

/** Today's date as YYYY-MM-DD in the LOCAL timezone (toISOString is UTC and
 * lands a day behind for IST mornings — a bad default for date inputs). */
export function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Semantic status → badge classes. Token-driven and dark-mode aware so a single
// map styles every pill in the app consistently in both themes.
export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  inactive: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  transferred: 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
  suspended: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  new: 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
  follow_up: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  interested: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20',
  admitted: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  rejected: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  paid: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  unpaid: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  partial: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  pending: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
}

/**
 * admission_applications.status only ever moves pending -> admitted/rejected
 * in the live app now (the approval workflow, not this column, tracks
 * everything in between) — the four granular values below are read-only
 * leftovers a couple of old seed rows still carry. Given a row's status
 * plus the live workflow fields GET /admission/applications now returns
 * (workflow_status, current_step_name), this resolves what a status badge
 * should actually show: the live stage while in progress, not a status
 * that never changes until the very end.
 */
export function admissionApplicationStatusBadge(app: { status: string; current_step_name?: string | null }): {
  label: string
  variant: 'success' | 'destructive' | 'info' | 'secondary'
} {
  if (app.status === 'admitted') return { label: 'Admitted', variant: 'success' }
  if (app.status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (app.status === 'pending') {
    return app.current_step_name
      ? { label: app.current_step_name, variant: 'info' }
      : { label: 'Not Started', variant: 'secondary' }
  }
  // Legacy values (counselor_approved, documents_verified, fee_paid,
  // principal_approved) — no live code writes these anymore, just a
  // cosmetic fallback so old seed rows still render legibly.
  return { label: app.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), variant: 'secondary' }
}
