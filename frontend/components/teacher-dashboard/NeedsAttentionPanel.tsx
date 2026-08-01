'use client'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

// Every flag here is computed server-side (GET /teacher/dashboard) from
// attendance/homework/marks the teacher already has access to for their
// own sections — nothing is derived client-side, and a subject-only
// teacher only ever sees their own taught sections' students, same as
// every other widget on this dashboard.
export function NeedsAttentionPanel() {
  const { data, isLoading } = useTeacherDashboard()
  const flagged = data?.needs_attention ?? []

  return (
    <Card className={flagged.length > 0 ? 'border-warning/30' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" /> Needs Attention
        </CardTitle>
        <p className="text-xs text-muted-foreground">Low attendance, missed homework streaks, or a sharp drop in test scores</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : flagged.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No students flagged right now" className="py-8" />
        ) : (
          <div className="space-y-2">
            {flagged.map(s => (
              <div key={s.student_id} className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{s.first_name} {s.last_name}</p>
                  <span className="text-xs text-muted-foreground">{s.class_name} {s.section_name}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.reasons.map((r, i) => (
                    <Badge key={i} variant="warning" className="font-normal">{r}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
