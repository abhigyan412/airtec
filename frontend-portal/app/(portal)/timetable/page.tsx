'use client'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { timetableApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Subject colours are categorical — they tell two subjects apart, they don't
// mean "good" or "late" — so they stay off the semantic tokens. The tint/ring
// form works in both themes; the old `bg-<hue>-50 text-<hue>-800` was invisible
// on a dark background. Break and Lunch aren't subjects, so they get no hue.
const SUBJECT_TINT = 'ring-1 ring-inset'
const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics': 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20',
  'English': 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20',
  'Science': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
  'Hindi': 'bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/20',
  'Social Studies': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-purple-500/20',
  'Break': 'bg-muted text-muted-foreground ring-border',
  'Lunch': 'bg-muted text-muted-foreground ring-border',
}
const getColor = (s: string) =>
  cn(SUBJECT_TINT, SUBJECT_COLORS[s] ?? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/20')

export default function PortalTimetablePage() {
  // `day_of_week` is 1..6 for Monday..Saturday, and JS `getDay()` happens to
  // agree on exactly that span (Sun=0, Mon=1, … Sat=6). Sunday returns 0, which
  // matches no school day — the week then renders unhighlighted, in order.
  const todayDayOfWeek = new Date().getDay()

  // No params — the backend auto-scopes to this student's own
  // class/section for a parent/student login.
  const { data, isLoading } = useQuery({
    queryKey: ['portal-timetable'],
    queryFn: () => timetableApi.get().then(r => r.data),
  })

  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of data ?? []) {
    byDay[p.day_of_week] = byDay[p.day_of_week] ?? []
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  // Today first: opening the timetable is nearly always "what do I have now?".
  // The rest of the week keeps its Monday..Saturday order behind it.
  const dayNumbers = [1, 2, 3, 4, 5, 6]
  const orderedDays = [
    ...dayNumbers.filter(d => d === todayDayOfWeek),
    ...dayNumbers.filter(d => d !== todayDayOfWeek),
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Timetable" description="Your class schedule for the week." />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : !(data ?? []).length ? (
        <Card>
          <EmptyState
            icon={Clock}
            title="No timetable published yet"
            description="The school hasn't published a schedule for this class yet. It'll show up here as soon as they do."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {orderedDays.map(dayNum => {
            const periods = byDay[dayNum] ?? []
            if (!periods.length) return null
            const isToday = dayNum === todayDayOfWeek

            return (
              <Card key={dayNum} className={cn('overflow-hidden', isToday && 'border-primary/40')}>
                <div
                  className={cn(
                    'flex items-center justify-between gap-2 border-b px-5 py-3',
                    isToday ? 'bg-primary/5' : 'bg-muted',
                  )}
                >
                  <h2 className="text-sm font-semibold text-foreground">{DAYS[dayNum - 1]}</h2>
                  {isToday && <Badge>Today</Badge>}
                </div>
                <div className="divide-y divide-border">
                  {periods.map((p: any) => {
                    // Teacher is hidden on breaks — nobody teaches lunch.
                    const teacher = !p.is_break && p.users?.full_name ? p.users.full_name : null
                    const meta = [teacher, p.room].filter(Boolean).join(' · ')
                    return (
                      <div key={p.id} className="flex items-start gap-3 px-5 py-3">
                        <span className="w-[4.5rem] shrink-0 pt-1 text-xs tabular-nums text-muted-foreground">
                          {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'inline-block rounded-md px-2.5 py-1 text-sm font-medium',
                              getColor(p.subject_name),
                            )}
                          >
                            {p.subject_name}
                          </span>
                          {meta && <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
