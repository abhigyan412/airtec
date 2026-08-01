'use client'
import Link from 'next/link'
import { CalendarCheck2, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

// Only ever rendered for a class teacher — homeroom_section is null for a
// subject-only teacher, in which case this renders nothing at all rather
// than a disabled/hidden card.
export function AttendanceActionCard() {
  const { data, isLoading } = useTeacherDashboard()

  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />
  const action = data?.attendance_action
  if (!action) return null

  return (
    <Card className={action.marked ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${action.marked ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
            {action.marked ? <CheckCircle2 className="h-5 w-5" /> : <CalendarCheck2 className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {action.class_name} {action.section_name} — {action.marked ? 'Attendance marked' : 'Attendance not marked yet'}
            </p>
            <p className="text-xs text-muted-foreground">
              {action.marked ? `${action.present_count}/${action.total_count} present today` : `${action.total_count} students in your homeroom`}
            </p>
          </div>
        </div>
        <Button asChild variant={action.marked ? 'outline' : 'default'}>
          <Link href="/attendance">{action.marked ? 'Review attendance' : 'Take attendance'}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
