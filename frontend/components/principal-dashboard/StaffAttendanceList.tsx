'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserCheck, CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { principalApi } from '@/lib/api'

type StaffType = 'teaching' | 'non_teaching'

const STATUS_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  absent: 'destructive', on_leave: 'warning', not_marked: 'secondary',
}

// List-based, deliberately not a percentage: who's actually absent, on
// leave, or never got marked in today, by name — a principal acting on
// this needs names, not a ratio.
export function StaffAttendanceList() {
  const [type, setType] = useState<StaffType>('teaching')
  const { data, isLoading } = useQuery({
    queryKey: ['principal-staff-attendance', type],
    queryFn: () => principalApi.staffAttendance(type).then(r => r.data),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-muted-foreground" /> Staff Attendance
        </CardTitle>
        <Select value={type} onValueChange={(v) => setType(v as StaffType)}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="teaching">Teaching staff</SelectItem>
            <SelectItem value="non_teaching">Non-teaching staff</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-5 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle2 className="h-4 w-4" /> {data.present_count} present
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-destructive">
                <XCircle className="h-4 w-4" /> {data.absent_count} absent
              </span>
              <span className="text-xs text-muted-foreground">of {data.total_count} total</span>
            </div>

            {data.staff.length === 0 ? (
              <EmptyState icon={UserCheck} title="Everyone's accounted for" description="No absences, leave, or missed marks today." className="py-10" />
            ) : (
              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {data.staff.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{s.full_name}</p>
                      {s.context && <p className="text-xs text-muted-foreground">{s.context}</p>}
                    </div>
                    <Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="shrink-0">{s.status_label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
