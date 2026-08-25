'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { admissionApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const STAGE_LABELS: Record<string, string> = {
  new: 'New', follow_up: 'Follow Up', interested: 'Interested',
  documents_submitted: 'Docs Submitted', entrance_exam: 'Entrance Exam',
  approved: 'Approved', waitlisted: 'Waitlisted', fee_pending: 'Fee Pending',
}

// Phase 9 of admission/plan.md: nothing shows here unless something
// actually needs attention — a quiet pipeline renders nothing at all,
// deliberately, rather than an empty "0 alerts" card taking up space.
export function AdmissionAlerts() {
  const { data } = useQuery({
    queryKey: ['admission-alerts'],
    queryFn: () => admissionApi.alerts().then(r => r.data),
  })

  const staleGroups: { status: string; count: number }[] = data?.stage_aging_by_status ?? []
  const occupancyWarnings: any[] = data?.occupancy_warnings ?? []
  if (!staleGroups.length && !occupancyWarnings.length) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {staleGroups.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-warning" /> Stuck in Pipeline
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              No stage change in {data?.stage_aging_days_threshold} days
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {staleGroups.map(g => (
                <Badge key={g.status} variant="warning">{STAGE_LABELS[g.status] ?? g.status}: {g.count}</Badge>
              ))}
            </div>
            <div className="divide-y divide-border -mx-1">
              {(data?.stage_aging_examples ?? []).slice(0, 5).map((inq: any) => (
                <Link key={inq.id} href={`/admission/${inq.id}`}
                  className="flex items-center justify-between px-1 py-2 text-sm hover:bg-muted/50 rounded-lg transition-colors">
                  <span className="text-foreground truncate">{inq.student_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {STAGE_LABELS[inq.status] ?? inq.status} since {formatDate(inq.status_changed_at)}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {occupancyWarnings.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Occupancy Risk
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Below {data?.occupancy_warning_percent_threshold}% filled, cycle closes {formatDate(data.cycle_closes_at)}
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border -mx-1">
              {occupancyWarnings.map((w: any) => (
                <Link key={w.class_id} href="/admission/seats"
                  className="flex items-center justify-between px-1 py-2 text-sm hover:bg-muted/50 rounded-lg transition-colors">
                  <span className="text-foreground">{w.class_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {w.confirmed}/{w.capacity} confirmed — <span className="font-semibold text-destructive">{w.occupancy_percent}%</span>
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
