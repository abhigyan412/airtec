import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavRowProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  /** Optional right-aligned summary: "94% this month", "2 due this week". */
  detail?: string
  className?: string
}

/**
 * A plain "go here" row. This exists so navigation never has to masquerade as a
 * metric — the overview used to render stat cards whose big value was the word
 * "View", which looks like data and isn't. If there's a number worth showing,
 * use StatTile; if there isn't, use this.
 */
export function NavRow({ href, icon: Icon, label, detail, className }: NavRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'pressable flex min-h-[3.25rem] items-center gap-3 rounded-surface border bg-card px-4 py-3',
        'transition-colors hover:border-primary/40 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-sm font-semibold text-foreground">{label}</span>
      {detail && <span className="shrink-0 text-sm text-muted-foreground">{detail}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </Link>
  )
}
