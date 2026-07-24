import * as React from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Accent = 'primary' | 'success' | 'warning' | 'destructive' | 'info'

const ACCENT: Record<Accent, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
}

interface StatCardProps {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  accent?: Accent
  /** Positive/negative percentage change vs. previous period. */
  trend?: number
  hint?: string
  className?: string
}

/** Compact KPI tile: label, big value, optional icon chip and trend pill. */
export function StatCard({ label, value, icon: Icon, accent = 'primary', trend, hint, className }: StatCardProps) {
  const up = (trend ?? 0) >= 0
  return (
    <Card className={cn('overflow-hidden transition-shadow hover:shadow-md', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && (
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ACCENT[accent])}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <div className="mt-1 flex items-center gap-2">
          {typeof trend === 'number' && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-semibold',
                up ? 'text-success' : 'text-destructive',
              )}
            >
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trend)}%
            </span>
          )}
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
