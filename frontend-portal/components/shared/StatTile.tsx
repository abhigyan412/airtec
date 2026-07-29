import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'success' | 'warning' | 'destructive'

const TONE: Record<Tone, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

interface StatTileProps {
  /** What the number means. Always present — a bare number teaches nothing. */
  label: string
  /**
   * The measurement itself. This slot is for a quantity: "₹12,400", "94%", "3".
   * It is NOT a place for "View" or "Open" — a tile whose big number is a verb
   * looks like data and carries none, which is worse than no tile at all. If
   * there is no number to show, use NavRow instead.
   */
  value: string | number
  /** Short qualifier under the value: "due 15 Aug", "this month", "of 22 days". */
  hint?: string
  tone?: Tone
  href?: string
  className?: string
}

export function StatTile({ label, value, hint, tone = 'default', href, className }: StatTileProps) {
  const body = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {/* tabular-nums keeps digits from reflowing as values update */}
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums tracking-tight', TONE[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  )

  const base = 'block rounded-surface border bg-card p-4 text-left'

  if (!href) return <div className={cn(base, className)}>{body}</div>

  return (
    <Link
      href={href}
      className={cn(
        base,
        'pressable transition-colors hover:border-primary/40 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {body}
    </Link>
  )
}
