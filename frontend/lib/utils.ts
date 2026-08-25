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

/**
 * The same formatter, to the paisa.
 *
 * formatCurrency rounds to whole rupees, which is right on a dashboard tile and
 * wrong on a receipt: ₹1,234.50 printed as "₹1,235" beside the words "…and
 * fifty paise" is a document that contradicts itself on the one field it exists
 * to make tamper-evident. Anything a parent keeps, or that has to reconcile
 * against a bank statement, uses this.
 */
export function formatCurrencyExact(amount: number | string | null | undefined) {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)
}

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

// Class-numbering display style — school-wide single source of truth
// (schools.class_display_style, GET/PATCH /admission/class-display-style).
// Only converts 1-12 (AIRTEC's class range); anything else, or a missing
// numeric_level, falls back to the class's stored name unchanged rather
// than guessing.
const ROMAN_NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
  7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII',
}

/**
 * Renders a class's display label given the school's chosen style.
 * Pass the class's `name` (used as the fallback and for anything outside
 * 1-12) and its `numeric_level`. Style is whatever
 * GET /admission/class-display-style last returned — components read it
 * via the `useClassDisplayStyle` hook in lib/useClassDisplayStyle.ts.
 */
export function classLabel(name: string | null | undefined, numericLevel: number | null | undefined, style: 'numeric' | 'roman'): string {
  if (style === 'roman' && numericLevel != null && ROMAN_NUMERALS[numericLevel]) {
    return `Class ${ROMAN_NUMERALS[numericLevel]}`
  }
  return name ?? (numericLevel != null ? `Class ${numericLevel}` : '')
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
  fee_pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20',
  rejected: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  paid: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  unpaid: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  partial: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  pending: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
}

/**
 * Workflow approval completing no longer means admitted — it means the
 * application moves to Fee Pending; only paying the admission fee (POST
 * .../collect-fee) actually admits, so `status` itself is now the
 * authoritative signal for the fee_pending/admitted/rejected outcomes,
 * not the workflow instance. The workflow (`workflow_status`,
 * `current_step_name`) is only consulted for what WorkflowPipeline itself
 * shows while the Counselor → Principal → Admin chain is still in
 * progress — the two must never disagree on what's currently happening.
 */
export function admissionApplicationStatusBadge(app: {
  status: string
  current_step_name?: string | null
  workflow_status?: string | null
}): {
  label: string
  variant: 'success' | 'destructive' | 'info' | 'secondary' | 'warning'
} {
  if (app.status === 'admitted') return { label: 'Admitted', variant: 'success' }
  if (app.status === 'fee_pending') return { label: 'Fee Pending', variant: 'warning' }
  if (app.status === 'rejected' || app.workflow_status === 'rejected') return { label: 'Rejected', variant: 'destructive' }
  if (app.workflow_status === 'cancelled') return { label: 'Cancelled', variant: 'secondary' }
  if (app.workflow_status === 'in_progress') {
    return app.current_step_name
      ? { label: app.current_step_name, variant: 'info' }
      : { label: 'In Progress', variant: 'info' }
  }

  // No workflow instance — fall back to the plain column.
  if (app.status === 'pending') return { label: 'Not Started', variant: 'secondary' }
  // Legacy values (counselor_approved, documents_verified, fee_paid,
  // principal_approved) — no live code writes these anymore, just a
  // cosmetic fallback so old seed rows still render legibly.
  return { label: app.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), variant: 'secondary' }
}
