'use client'
import { AlertOctagon, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePrincipalDashboard, type PrincipalDashboardData } from '@/lib/usePrincipalDashboard'

type EscalationItem = PrincipalDashboardData['escalations']['sla_escalations'][number]

const PRIORITY_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  urgent: 'destructive', high: 'destructive', medium: 'warning', low: 'secondary',
}

// Deliberately never the complaining student's name — class/section
// context is enough to decide whether to intervene, without duplicating
// the full operational Complaints page.
function EscalationRow({ row }: { row: EscalationItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{row.subject}</p>
        <p className="text-xs text-muted-foreground">
          {row.class_name ? `${row.class_name}${row.section_name ? ` ${row.section_name}` : ''} · ` : ''}{row.category}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right">
        <Badge variant={PRIORITY_VARIANT[row.priority] ?? 'secondary'}>{row.priority}</Badge>
        <span className="text-xs font-semibold text-muted-foreground">{row.days_open}d</span>
      </div>
    </div>
  )
}

function EscalationList({ rows, emptyLabel }: { rows: EscalationItem[]; emptyLabel: string }) {
  if (rows.length === 0) return <EmptyState icon={ShieldCheck} title={emptyLabel} className="py-12" />
  return (
    <div className="max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
      {rows.map(r => <EscalationRow key={r.id} row={r} />)}
    </div>
  )
}

// Escalations only — SLA-breach complaints and disciplinary/conflict
// flags, never TC-request or fee-followup counts (those stay operational
// task items on the Admin dashboard).
export function Escalations() {
  const { data, isLoading } = usePrincipalDashboard()
  const esc = data?.escalations

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-muted-foreground" /> SLA Escalations
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Unresolved beyond {esc?.sla_days ?? 3} days</p>
        </CardHeader>
        <CardContent>
          {isLoading || !esc ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
          ) : (
            <EscalationList rows={esc.sla_escalations} emptyLabel="No complaints past the SLA window" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" /> Disciplinary &amp; Conflict Flags
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Behavioral, bullying, or high/urgent priority — open for review</p>
        </CardHeader>
        <CardContent>
          {isLoading || !esc ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
          ) : (
            <EscalationList rows={esc.disciplinary_flagged} emptyLabel="Nothing flagged for review" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
