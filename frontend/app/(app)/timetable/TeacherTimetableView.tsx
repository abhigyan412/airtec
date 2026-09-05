'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, GraduationCap, Maximize2, Minimize2, User } from 'lucide-react'
import { timetableApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { DAYS, DAY_SHORT, getColor } from './shared'

type Tab = 'mine' | 'homeroom'

// A teacher's own timetable: just their taught periods, plus — only if
// they're a class teacher — a second tab with the FULL homeroom
// timetable (every period in that section, not only the ones they
// personally teach). No class/teacher picker: there's nothing to pick,
// this is always their own. Server-side enforcement lives in GET
// /students/timetable (see backend/src/modules/sis/routes.ts).
export function TeacherTimetableView() {
  const { user } = useAuth()
  const { data: dashboard } = useTeacherDashboard()
  const isClassTeacher = dashboard?.header?.is_class_teacher ?? false
  const homeroom = dashboard?.header?.homeroom_section
  const [tab, setTab] = useState<Tab>('mine')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Synced from the browser's own fullscreen state, not just our toggle —
  // a phone's back gesture or the system Escape key exits fullscreen
  // without going through toggleFullscreen, and the button/overlay must
  // follow that or they'll disagree with what's actually on screen.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try { await contentRef.current?.requestFullscreen() } catch { /* unsupported browser */ }
      try { await (screen.orientation as any)?.lock?.('landscape') } catch { /* iOS / desktop */ }
    } else {
      try { await document.exitFullscreen() } catch { /* already exited */ }
      try { (screen.orientation as any)?.unlock?.() } catch { /* no-op */ }
    }
  }

  const { data: ownPeriods, isLoading: ownLoading } = useQuery({
    queryKey: ['timetable-mine', user?.id],
    queryFn: () => timetableApi.get({ teacher_id: user!.id }).then(r => r.data),
    enabled: !!user?.id,
  })
  const { data: homeroomPeriods, isLoading: homeroomLoading } = useQuery({
    queryKey: ['timetable-homeroom', homeroom?.section_id],
    queryFn: () => timetableApi.get({ section_id: homeroom!.section_id }).then(r => r.data),
    enabled: tab === 'homeroom' && !!homeroom?.section_id,
  })

  const showingHomeroom = tab === 'homeroom' && isClassTeacher
  const periods = showingHomeroom ? homeroomPeriods : ownPeriods
  const isLoading = showingHomeroom ? homeroomLoading : ownLoading

  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of periods ?? []) {
    byDay[p.day_of_week] = byDay[p.day_of_week] ?? []
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }
  const allPeriods = Array.from(new Set<number>((periods ?? []).map((p: any) => p.period_number as number))).sort((a, b) => a - b)
  const timeByPeriod: Record<number, string> = {}
  for (const p of periods ?? []) timeByPeriod[p.period_number] = `${p.start_time?.slice(0, 5)}–${p.end_time?.slice(0, 5)}`

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Timetable"
        description={showingHomeroom ? `Full weekly timetable for ${homeroom?.class_name} ${homeroom?.section_name}` : 'Your own teaching periods this week'}
        icon={Clock}
        centered
        actions={
          isClassTeacher ? (
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <button
                onClick={() => setTab('mine')}
                className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  tab === 'mine' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <User className="h-3.5 w-3.5" /> My Schedule
              </button>
              <button
                onClick={() => setTab('homeroom')}
                className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  tab === 'homeroom' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <GraduationCap className="h-3.5 w-3.5" /> {homeroom?.class_name} {homeroom?.section_name} (Homeroom)
              </button>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : !periods || periods.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={Clock} title="No periods scheduled" description="Nothing on the timetable here yet." />
        </div>
      ) : (
        <>
          {!isFullscreen && (
            <div className="mb-2 flex justify-end sm:hidden">
              <Button
                variant="outline" size="icon"
                onClick={toggleFullscreen} title="Full screen (landscape)"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div
            ref={contentRef}
            className={cn(isFullscreen && 'fixed inset-0 z-50 overflow-auto bg-background p-3')}
          >
            {isFullscreen && (
              <div className="mb-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={toggleFullscreen}>
                  <Minimize2 className="mr-1.5 h-4 w-4" /> Exit full screen
                </Button>
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="sticky left-0 z-10 w-28 border-b border-r border-border bg-muted px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">
                        Period
                      </th>
                      {DAYS.map((day, idx) => (
                        <th key={day} className="min-w-[150px] border-b border-r border-border px-3 py-3 last:border-r-0">
                          <span className="text-xs font-bold text-foreground">{DAY_SHORT[idx]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allPeriods.map(periodNum => (
                      <tr key={periodNum} className="border-b border-border last:border-b-0">
                        <td className="sticky left-0 z-10 border-r border-border bg-card px-4 py-2">
                          <p className="text-xs font-bold text-foreground">P{periodNum}</p>
                          <p className="text-xs text-muted-foreground">{timeByPeriod[periodNum]}</p>
                        </td>
                        {[1, 2, 3, 4, 5, 6].map(dayNum => {
                          const period = (byDay[dayNum] ?? []).find((p: any) => p.period_number === periodNum)
                          return (
                            <td key={dayNum} className="border-r border-border px-2 py-2 align-top last:border-r-0">
                              {period ? (
                                <div className={cn('rounded-lg px-2.5 py-2', getColor(period.subject_name))}>
                                  <p className="text-xs font-semibold">{period.subject_name}</p>
                                  {showingHomeroom && (
                                    <p className="mt-0.5 text-[11px] opacity-80">{period.users?.full_name ?? 'Unassigned'}</p>
                                  )}
                                  {!showingHomeroom && (
                                    <p className="mt-0.5 text-[11px] opacity-80">{period.classes?.name} {period.sections?.name}</p>
                                  )}
                                  {period.room && <p className="text-[11px] opacity-70">Room {period.room}</p>}
                                </div>
                              ) : (
                                <div className="h-full min-h-[44px]" />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
