'use client'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { studentsApi } from '@/lib/api'

// Reuses the exact same GET /students/attendance/today call the Admin
// dashboard's "Needs Attention Today" widget already makes — same
// service, same query, just rendered as a full per-section list here
// instead of a count-plus-tag-cloud. Not-marked sections sort first.
export function ClassAttendanceStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-attendance-today'],
    queryFn: () => studentsApi.attendanceToday().then(r => r.data),
  })

  const sections: any[] = data?.sections ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-muted-foreground" /> Class Attendance Status
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data && !data.is_working_day ? 'Holiday / weekly off' : 'Not-marked sections first'}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : data && !data.is_working_day ? (
          <EmptyState icon={CalendarCheck} title="No school today" description="Holiday or weekly off — nothing to mark." className="py-10" />
        ) : sections.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No sections found" className="py-10" />
        ) : (
          <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
            {sections.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                <p className="text-sm font-medium text-foreground">{s.class_name} {s.section_name}</p>
                {s.is_marked ? (
                  <Badge variant={s.present === s.enrolled ? 'success' : 'secondary'}>{s.present}/{s.enrolled} present</Badge>
                ) : (
                  <Badge variant="destructive">Not marked</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
