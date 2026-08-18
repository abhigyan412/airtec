'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, Check, Clock, ShieldAlert, X } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// Small pieces shared across the timetable screens.
// ═══════════════════════════════════════════════════════════════

// ── status ──────────────────────────────────────────────────────

type ArrangementStatus =
  | 'unassigned' | 'assigned' | 'acknowledged' | 'declined' | 'cancelled' | 'unfilled'

const STATUS: Record<ArrangementStatus, { label: string; className: string; icon?: React.ComponentType<{ className?: string }> }> = {
  // Deliberately the loudest thing on the page: an uncovered period is a
  // class about to sit with nobody in front of it.
  unassigned: {
    label: 'Needs cover',
    className: 'bg-destructive/10 text-destructive ring-destructive/25',
    icon: AlertTriangle,
  },
  assigned: {
    label: 'Awaiting reply',
    className: 'bg-warning/10 text-warning ring-warning/25',
    icon: Clock,
  },
  acknowledged: {
    label: 'Confirmed',
    className: 'bg-success/10 text-success ring-success/25',
    icon: Check,
  },
  declined: {
    label: 'Declined',
    className: 'bg-destructive/10 text-destructive ring-destructive/25',
    icon: X,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-muted text-muted-foreground ring-border',
  },
  unfilled: {
    label: 'Unfilled',
    className: 'bg-destructive/10 text-destructive ring-destructive/25',
    icon: AlertTriangle,
  },
}

export function StatusPill({ status, escalated }: { status: string; escalated?: boolean }) {
  const meta = STATUS[status as ArrangementStatus] ?? STATUS.unassigned
  const Icon = escalated ? ShieldAlert : meta.icon
  return (
    <span className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
      escalated ? 'bg-destructive/15 text-destructive ring-destructive/40' : meta.className,
    )}>
      {Icon && <Icon className="h-3 w-3" />}
      {escalated ? 'Escalated' : meta.label}
    </span>
  )
}

// ── chips ───────────────────────────────────────────────────────

export function Chip({
  children, tone = 'neutral', title,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
  title?: string
}) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground ring-border',
    good: 'bg-success/10 text-success ring-success/25',
    warn: 'bg-warning/10 text-warning ring-warning/25',
    bad: 'bg-destructive/10 text-destructive ring-destructive/25',
    info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/25',
  }
  return (
    <span title={title} className={cn(
      'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
      tones[tone],
    )}>
      {children}
    </span>
  )
}

// ── subject colour ──────────────────────────────────────────────
//
// Categorical, not semantic: the hue identifies a subject, so it must
// stay distinguishable from its neighbours in both themes rather than
// carry meaning. A hue is chosen by hashing the subject name, so a
// school with subjects nobody anticipated — EVS, Robotics, Presentation,
// Remedial-Hindi — still gets stable, distinct colours instead of every
// unrecognised subject collapsing into the same fallback grey.
//
// The class strings are written out in full and never assembled from
// parts. Tailwind builds its stylesheet by scanning source text for
// literal class names, so `bg-${hue}-500/10` produces no CSS at all —
// and it fails only in a production build, where the grid renders
// colourless and nobody finds out until it is in front of the school.

const SUBJECT_TONES: Record<string, string> = {
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/20',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-inset ring-orange-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-inset ring-purple-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/20',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 ring-1 ring-inset ring-pink-500/20',
  lime: 'bg-lime-500/10 text-lime-700 dark:text-lime-300 ring-1 ring-inset ring-lime-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 ring-1 ring-inset ring-yellow-500/20',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-500/20',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/20',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/20',
  green: 'bg-green-500/10 text-green-700 dark:text-green-300 ring-1 ring-inset ring-green-500/20',
}

const SUBJECT_DOTS: Record<string, string> = {
  indigo: 'bg-indigo-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
  pink: 'bg-pink-500',
  lime: 'bg-lime-500',
  yellow: 'bg-yellow-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  fuchsia: 'bg-fuchsia-500',
  green: 'bg-green-500',
}

const HUES = Object.keys(SUBJECT_TONES)

const FIXED: Record<string, string> = {
  maths: 'indigo', mathematics: 'indigo', math: 'indigo',
  english: 'blue',
  science: 'emerald',
  hindi: 'orange',
  sst: 'purple', 'social studies': 'purple', 'social science': 'purple',
  computer: 'cyan', 'computer lab': 'cyan',
  art: 'pink',
  games: 'lime', sports: 'lime', 'physical ed': 'lime',
  sanskrit: 'yellow',
  evs: 'teal',
  dance: 'fuchsia',
  gk: 'sky', 'general knowledge': 'sky',
}

function hueFor(subject: string): string {
  const key = subject.toLowerCase().trim()
  if (FIXED[key]) return FIXED[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return HUES[hash % HUES.length]
}

const BREAKISH = /^(break|lunch|recess|interval|assembly|prayer|tiffin)$/i

const NEUTRAL = 'bg-muted text-muted-foreground ring-1 ring-inset ring-border'

export function subjectClasses(subject: string | null | undefined): string {
  if (!subject) return 'bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border'
  // A break is a gap in the day, not a subject — neutral, so the eye
  // skips it and the teaching periods stand out.
  if (BREAKISH.test(subject.trim())) return NEUTRAL
  return SUBJECT_TONES[hueFor(subject)] ?? NEUTRAL
}

/** A single dot of the subject's colour, for legends and dense lists. */
export function subjectDot(subject: string | null | undefined): string {
  if (!subject || BREAKISH.test(subject.trim())) return 'bg-muted-foreground/40'
  return SUBJECT_DOTS[hueFor(subject)] ?? 'bg-muted-foreground/40'
}

// ── grid ────────────────────────────────────────────────────────

export function GridShell({
  columns, children, stickyFirst = true, minWidth = 720,
}: {
  columns: React.ReactNode
  children: React.ReactNode
  stickyFirst?: boolean
  minWidth?: number
}) {
  return (
    // Wide grids scroll inside their own box rather than pushing the page
    // sideways — sixteen sections by ten periods does not fit a laptop.
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead className="bg-muted/50">{columns}</thead>
        <tbody className={cn(stickyFirst && '[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-background')}>
          {children}
        </tbody>
      </table>
    </div>
  )
}

// ── loading ─────────────────────────────────────────────────────

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── date navigation ─────────────────────────────────────────────

export function DateNav({
  value, onChange, relativeLabel,
}: {
  value: string
  onChange: (next: string) => void
  relativeLabel?: string | null
}) {
  const shift = (delta: number) => {
    const [y, m, d] = value.split('-').map(Number)
    const dt = new Date(y, m - 1, d + delta)
    onChange(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`)
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
      <button
        onClick={() => shift(-1)}
        aria-label="Previous day"
        className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ‹
      </button>
      <div className="relative">
        <input
          type="date"
          value={value}
          onChange={e => e.target.value && onChange(e.target.value)}
          className="w-[9.5rem] rounded-md bg-transparent px-2 py-1 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {relativeLabel && (
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {relativeLabel}
        </span>
      )}
      <button
        onClick={() => shift(1)}
        aria-label="Next day"
        className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ›
      </button>
    </div>
  )
}

// ── inline banner ───────────────────────────────────────────────

export function Banner({
  tone = 'info', title, children, action,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good'
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  const tones = {
    info: 'border-blue-500/30 bg-blue-500/5',
    warn: 'border-warning/30 bg-warning/5',
    bad: 'border-destructive/30 bg-destructive/5',
    good: 'border-success/30 bg-success/5',
  }
  const icons = {
    info: 'text-blue-600 dark:text-blue-400',
    warn: 'text-warning',
    bad: 'text-destructive',
    good: 'text-success',
  }
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between', tones[tone])}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', icons[tone])} />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {children && <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
