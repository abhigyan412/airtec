'use client'
import { Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export function TodaySchedule() {
  const { data, isLoading } = useTeacherDashboard()
  const schedule = data?.schedule_today ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" /> Today&apos;s Schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : schedule.length === 0 ? (
          <EmptyState icon={Clock} title="No periods scheduled for you today" className="py-10" />
        ) : (
          <div className="space-y-2">
            {schedule.map(p => (
              <div
                key={p.period_id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                  p.is_current ? 'border-primary/40 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-20 shrink-0 text-xs font-medium text-muted-foreground">
                    {fmtTime(p.start_time)} – {fmtTime(p.end_time)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.subject_name} · {p.class_name} {p.section_name}</p>
                    <p className="text-xs text-muted-foreground">{p.room ? `Room ${p.room}` : 'No room assigned'}</p>
                  </div>
                </div>
                {p.is_current && <Badge variant="info">Now</Badge>}
                {p.is_next && <Badge variant="secondary">Next</Badge>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
