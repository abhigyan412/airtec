'use client'
import { TrendingDown, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePrincipalDashboard } from '@/lib/usePrincipalDashboard'

// Flagged as narrative insights, not a raw scores table — each card
// reads as a sentence a principal can act on directly. Teacher name only
// appears when exactly one teacher is timetabled for that class+subject;
// otherwise it's left unattributed rather than guessed at.
export function PerformanceConcerns() {
  const { data, isLoading } = usePrincipalDashboard()
  const rows = data?.staff_oversight.performance_concerns ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" /> Performance Concerns
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Classes whose scores dropped more than 10pp test-over-test</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No declining classes flagged" description="Every class held steady or improved test-over-test." className="py-12" />
        ) : (
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3.5 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <TrendingDown className="h-3.5 w-3.5" />
                </div>
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{r.class_name} · {r.subject_name}</span> dropped from{' '}
                  <span className="font-semibold">{r.prior_pct}%</span> to <span className="font-semibold">{r.latest_pct}%</span>{' '}
                  ({r.drop}pp) on the most recent test
                  {r.teacher_name ? <> — taught by <span className="font-semibold">{r.teacher_name}</span></> : ' — taught across multiple teachers'}.
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
