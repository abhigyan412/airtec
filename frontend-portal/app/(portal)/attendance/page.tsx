'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarOff, CalendarClock } from 'lucide-react'
import { studentsApi, academicYearsApi } from '@/lib/api'
import { cn, attendanceTone } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatTile } from '@/components/shared/StatTile'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const todayStr = new Date().toISOString().slice(0, 10)

// attendanceTone names the tone; these map it onto the two places the page
// paints it — the headline figure and the bar under it.
const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' }
const TONE_BAR = { success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive' }

// Same helper as the staff Report tab (frontend/app/(app)/attendance/page.tsx)
// — kept local rather than shared since it's a few lines and this is the
// only other place that needs "today, or the year's end if that's already
// past" as the year-to-date cutoff.
function useCurrentAcademicYear() {
  const { data } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const current = (data ?? []).find((y: any) => y.is_current) ?? data?.[0]
  if (!current) return null
  return { ...current, effective_end: current.end_date < todayStr ? current.end_date : todayStr }
}

export default function PortalAttendancePage() {
  const now = new Date()
  const [scope, setScope] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const academicYear = useCurrentAcademicYear()

  // class_id is ignored server-side for a parent/student account — the
  // backend always resolves and scopes to their own child regardless
  // of what's passed here (see the ownership-scoping fix on
  // GET /students/attendance/report).
  const monthQuery = useQuery({
    queryKey: ['portal-attendance-month', month, year],
    queryFn: () => studentsApi.getAttendanceReport('', month, year).then(r => r.data),
    enabled: scope === 'month',
  })
  const yearQuery = useQuery({
    queryKey: ['portal-attendance-year', academicYear?.start_date, academicYear?.effective_end],
    queryFn: () => studentsApi.getAttendanceReportRange('', academicYear!.start_date, academicYear!.effective_end).then(r => r.data),
    enabled: scope === 'year' && !!academicYear,
  })
  const { data, isLoading } = scope === 'month' ? monthQuery : yearQuery

  const student = (data?.students ?? [])[0]
  const workingDays = data?.working_days ?? 0
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)
  const periodLabel = scope === 'month' ? `${MONTHS[month - 1]} ${year}` : (academicYear ? `Academic Year ${academicYear.name}` : 'Academic Year')

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description="How many days were attended, and whether that clears the 75% most boards need for exams."
      />

      {/* Period controls sit full-width under the title rather than crammed
          beside it — on a phone that keeps every target thumb-sized. */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {([['month', 'This month'], ['year', 'Academic year']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              aria-pressed={scope === value}
              className={cn(
                'h-11 rounded-md px-3 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                scope === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'month' && (
          <div className="flex items-center gap-2 rounded-lg border bg-card p-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => changeMonth(-1)}>
              <ChevronLeft />
            </Button>
            <span className="flex-1 text-center text-sm font-semibold text-foreground">
              {MONTHS[month - 1]} {year}
            </span>
            <Button variant="ghost" size="icon" aria-label="Next month" disabled={isFutureMonth} onClick={() => changeMonth(1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {scope === 'year' && !academicYear ? (
        <Card>
          <EmptyState
            icon={CalendarOff}
            title="No academic year set up yet"
            description={'Your school hasn’t recorded its academic year dates, so there’s nothing to total up across the year. Month by month still works.'}
            action={<Button variant="outline" onClick={() => setScope('month')}>Show this month</Button>}
          />
        </Card>
      ) : isLoading ? (
        <div className="space-y-5">
          <Skeleton className="h-44 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-[6.5rem] rounded-lg" />
            <Skeleton className="h-[6.5rem] rounded-lg" />
            <Skeleton className="h-[6.5rem] rounded-lg" />
            <Skeleton className="h-[6.5rem] rounded-lg" />
          </div>
        </div>
      ) : !student || workingDays === 0 ? (
        <Card>
          <EmptyState
            icon={isFutureMonth ? CalendarClock : CalendarOff}
            title={isFutureMonth ? `${periodLabel} hasn't happened yet` : `Nothing marked for ${periodLabel}`}
            description={
              isFutureMonth
                ? 'Attendance appears here once school has run and the class teacher has marked the register.'
                : 'The class teacher hasn’t marked the register for any day in this period — school may have been closed. Try another month, or ask the school office.'
            }
          />
        </Card>
      ) : (
        <>
          {/* The percentage leads: it's the one figure that decides whether a
              child can sit their exams, so it gets the size and the colour. */}
          <Card className="p-5 sm:p-6">
            <p className="text-sm font-medium text-muted-foreground">Overall attendance · {periodLabel}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className={cn('text-5xl font-bold tabular-nums tracking-tight', TONE_TEXT[attendanceTone(student.percentage)])}>
                {student.percentage}%
              </p>
              <p className="text-sm text-muted-foreground">
                <span className="tabular-nums">{student.present}</span> of{' '}
                <span className="tabular-nums">{workingDays}</span> working day{workingDays !== 1 ? 's' : ''} present
              </p>
            </div>

            {/* 75% is marked on the track rather than left for a parent to work
                out from the number alone. */}
            <div className="relative mt-5 h-2.5 w-full rounded-full bg-muted" aria-hidden>
              <div
                className={cn('absolute inset-y-0 left-0 rounded-full', TONE_BAR[attendanceTone(student.percentage)])}
                style={{ width: `${Math.min(Math.max(student.percentage, 0), 100)}%` }}
              />
              <span className="absolute -inset-y-1 left-[75%] w-0.5 -translate-x-1/2 rounded-full bg-foreground/40" />
            </div>
            <div className="relative mt-2 h-4">
              <span className="absolute left-[75%] -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                75% needed
              </span>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              {student.percentage >= 75
                ? 'Clears the 75% attendance most boards require to sit exams.'
                : 'Below the 75% attendance most boards require to sit exams.'}
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Present', count: student.present, tone: 'success' as const },
              { label: 'Absent', count: student.absent, tone: 'destructive' as const },
              { label: 'Late', count: student.late, tone: 'warning' as const },
              { label: 'On leave', count: student.leave, tone: 'default' as const },
            ].map(s => (
              <StatTile
                key={s.label}
                label={s.label}
                value={s.count}
                // A zero stays neutral — a red "0 absent" reads as a problem.
                tone={s.count > 0 ? s.tone : 'default'}
                hint={`of ${workingDays} day${workingDays !== 1 ? 's' : ''}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
