'use client'
import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Wallet, MessageSquareWarning } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { usePrincipalDashboard } from '@/lib/usePrincipalDashboard'

function Tile({ label, value, icon: Icon, accent, children }: {
  label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }>
  accent: 'primary' | 'success' | 'warning' | 'destructive'
  children?: React.ReactNode
}) {
  const ACCENT: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ACCENT[accent])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <div className="mt-1 flex items-center gap-2">{children}</div>
      </CardContent>
    </Card>
  )
}

// A more-complaints-is-worse metric, so the up/down arrow's color is
// intentionally inverted from StatCard's default (where "up" always
// reads as good) — a rise in new complaints has to read as a warning,
// not a win.
function ComplaintsTrendBadge({ thisWeek, priorWeek }: { thisWeek: number; priorWeek: number }) {
  const delta = thisWeek - priorWeek
  const flat = delta === 0
  const worse = delta > 0
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-xs font-semibold',
      flat ? 'text-muted-foreground' : worse ? 'text-destructive' : 'text-success',
    )}>
      {flat ? <Minus className="h-3 w-3" /> : worse ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(delta)} vs last week
    </span>
  )
}

// School-wide aggregates only — no invoice list, no admission funnel, no
// student names. Today's Attendance and Staff Attendance used to live
// here as percentage tiles; they're now the concrete, list-based
// ClassAttendanceStatus and StaffAttendanceList sections below instead.
export function HealthSummary() {
  const { data, isLoading } = usePrincipalDashboard()
  const h = data?.health

  if (isLoading || !h) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Tile label="Fee Collection" value={h.fee_collection_pct != null ? `${h.fee_collection_pct}%` : '—'} icon={Wallet} accent="success">
        <span className="text-xs text-muted-foreground">{h.fee_collection_pct != null ? 'of amount invoiced this year' : 'No invoices yet this year'}</span>
      </Tile>
      <Tile label="Unresolved Complaints" value={h.unresolved_complaints_count} icon={MessageSquareWarning} accent={h.unresolved_complaints_count > 0 ? 'warning' : 'success'}>
        <ComplaintsTrendBadge thisWeek={h.complaints_new_this_week} priorWeek={h.complaints_new_prior_week} />
      </Tile>
    </div>
  )
}
