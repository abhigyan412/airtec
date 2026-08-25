'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timetableApi, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Loader2, Clock, AlertTriangle, UserCheck, BookOpen, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

import { DAYS } from './shared'

// ═══════════════════════════════════════════════════════════════
// What is going wrong in the school right now, and who is free
// ═══════════════════════════════════════════════════════════════
//
// Lifted out of the class-timetable page so it can live on the
// arrangements screen, which is where somebody sorting out cover
// actually is. Kept in one file rather than copied, so the two can
// never drift into disagreeing about who is free.

// ── ATTENTION REQUIRED — periods happening RIGHT NOW where the
// assigned teacher's check-in doesn't line up: no check-in recorded
// yet, marked absent/on leave, or checked in after the period had
// already started. Cross-references the timetable against today's
// staff check-in/out times (HR → Attendance), which otherwise never
// talk to each other. Polls every 60s since "right now" keeps moving.
export function AttentionRequiredPanel({ onFindSubstitute }: { onFindSubstitute: (dayOfWeek: number, flagged: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable-attention-required'],
    queryFn: () => timetableApi.attentionRequired().then((r: any) => r.data),
    refetchInterval: 60_000,
  })

  const REASON_STYLES: Record<string, string> = {
    not_checked_in: 'bg-destructive/10 text-destructive',
    absent: 'bg-destructive/10 text-destructive',
    on_leave: 'bg-warning/10 text-warning',
    no_checkin_time: 'bg-warning/10 text-warning',
    checked_in_late: 'bg-warning/10 text-warning',
    // Not a today problem — the timetable itself is wrong.
    departed: 'bg-destructive/15 text-destructive font-semibold',
  }

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-2xl" />
  }

  // Sunday — nothing scheduled, nothing to check.
  if (!data?.day_of_week) {
    return (
      <div className="bg-muted/50 border border-border rounded-2xl px-5 py-4 flex items-center gap-3">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No school today — nothing to check.</p>
      </div>
    )
  }

  const flagged: any[] = data?.flagged ?? []
  const morningNoCheckin: any[] = data?.morning_no_checkin ?? []
  const periodsInProgress: number = data?.periods_in_progress ?? 0

  // Nothing live right now AND nothing lingering from this morning either
  // — the two states below stay distinct rather than collapsing into one
  // generic "nothing to see," since "no class running this minute" and
  // "everything running right now is covered" mean different things.
  if (flagged.length === 0 && morningNoCheckin.length === 0) {
    if (periodsInProgress === 0) {
      return (
        <div className="bg-muted/50 border border-border rounded-2xl px-5 py-4 flex items-center gap-3">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No class is in session right now — check back once periods start.</p>
        </div>
      )
    }
    return (
      <div className="bg-success/10 border border-success/30 rounded-2xl px-5 py-4 flex items-center gap-3">
        <UserCheck className="w-4 h-4 text-success" />
        <p className="text-sm text-success">All {periodsInProgress} class{periodsInProgress !== 1 ? 'es' : ''} in session right now {periodsInProgress !== 1 ? 'are' : 'is'} covered.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {flagged.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h3 className="font-semibold text-destructive">Classes Needing Immediate Attention</h3>
            <span className="text-xs text-destructive/70">({flagged.length} right now)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {flagged.map((f: any) => (
              <div key={f.period_id} className="bg-card rounded-xl border border-destructive/20 p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {f.class_name}{f.section_name ? ` - ${f.section_name}` : ''} · {f.subject_name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    P{f.period_number} · {f.start_time?.slice(0, 5)}–{f.end_time?.slice(0, 5)} · {f.teacher_name}{f.room ? ` · ${f.room}` : ''}
                  </p>
                  <span className={cn('inline-block mt-2 px-2 py-0.5 rounded-full text-[11px] font-semibold', REASON_STYLES[f.reason] ?? 'bg-muted text-muted-foreground')}>
                    {f.reason_label}
                  </span>
                </div>
                <Button size="sm" onClick={() => onFindSubstitute(data.day_of_week, f)}>
                  Find Substitute
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cumulative, unlike the block above — stays listed past their own
          period ending, since "never showed up this morning" doesn't stop
          being true just because a later period started. Someone whose
          absence is confirmed AND fully covered is dropped by the API:
          that is a question already answered, and a panel that keeps
          asking it is one people learn to scroll past. */}
      {morningNoCheckin.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h3 className="font-semibold text-warning">Not Checked In Since This Morning</h3>
            <span className="text-xs text-warning/70">({morningNoCheckin.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {morningNoCheckin.map((m: any) => {
              const uncovered = m.uncovered_count ?? m.periods_missed.length
              return (
                <div key={m.teacher_id} className="bg-card rounded-xl border border-warning/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{m.teacher_name}</p>
                    {m.absence_status === 'confirmed' && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        absence confirmed
                      </span>
                    )}
                    {uncovered > 0 ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                        {uncovered} still need{uncovered === 1 ? 's' : ''} cover
                      </span>
                    ) : (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                        all covered
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Missed {m.periods_missed.length} period{m.periods_missed.length !== 1 ? 's' : ''} this morning:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {m.periods_missed.map((p: any, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        P{p.period_number} {p.subject_name}
                        {p.class_name ? ` (${p.class_name}${p.section_name ? ` - ${p.section_name}` : ''})` : ''}
                        {p.covered
                          ? <span className="text-success"> · covered{p.covered_by ? ` by ${p.covered_by}` : ''}</span>
                          : <span className="text-destructive"> · no cover</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── FREE FACULTY VIEW — who's free at a given day + period, for
// finding a substitute. Principal/Admin only (the page already hides
// the tab for other roles, and the backend enforces the same gate).
//
// Defaults to "right now" when viewing today: once the day's periods
// load, it finds whichever period's start/end window contains the
// current time and auto-selects it — the common case is "someone's
// out RIGHT NOW, who can cover," not browsing a hypothetical slot.
export function FreeFacultyView() {
  const jsDay = new Date().getDay() // 0=Sun..6=Sat; this schema's day_of_week is 1=Mon..6=Sat
  const todayDayOfWeek = jsDay === 0 ? 1 : jsDay
  const todayDateStr = new Date().toISOString().split('T')[0]
  const [day, setDay] = useState(todayDayOfWeek)
  const [period, setPeriod] = useState<number | ''>('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [autoPicked, setAutoPicked] = useState(false)
  const [substituteFor, setSubstituteFor] = useState<any | null>(null)

  // Attendance only tells us who's actually in today — browsing a
  // hypothetical Wednesday from some other day has no attendance to
  // check against, so only send it when the day being viewed IS today.
  const attendanceDate = day === todayDayOfWeek ? todayDateStr : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['free-faculty', day, period, attendanceDate],
    queryFn: () => timetableApi.freeFaculty(day, period === '' ? undefined : period, attendanceDate).then((r: any) => r.data),
  })

  useEffect(() => {
    if (autoPicked || period !== '' || !data?.available_periods?.length) return
    if (day === todayDayOfWeek) {
      const nowStr = new Date().toTimeString().slice(0, 8)
      const current = data.available_periods.find((p: any) => p.start_time <= nowStr && nowStr <= p.end_time)
      if (current) setPeriod(current.period_number)
    }
    setAutoPicked(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const availablePeriods = data?.available_periods ?? []
  const freeTeachers: any[] = data?.free ?? []
  const busyTeachers: any[] = data?.busy ?? []
  const allSubjects = Array.from(new Set(freeTeachers.flatMap((t: any) => t.subjects_today as string[]))).sort()
  const shownFree = subjectFilter ? freeTeachers.filter(t => t.subjects_today.includes(subjectFilter)) : freeTeachers
  const selectedPeriodInfo = availablePeriods.find((p: any) => p.period_number === period)
  // The day/period pickers let you browse ANY slot — yesterday's last
  // period, next Friday, whatever — so "Teaching Right Now" is only true
  // when the slot being shown actually contains this exact moment. Saying
  // "right now" unconditionally is what made a 2:34pm view of a 9:40am
  // period (school already let out for the day) read as a live, actionable
  // substitute search when it's really just browsing history.
  const nowStr = new Date().toTimeString().slice(0, 8)
  const isLiveSlot = day === todayDayOfWeek && !!selectedPeriodInfo &&
    selectedPeriodInfo.start_time <= nowStr && nowStr <= selectedPeriodInfo.end_time
  const periodLabel = selectedPeriodInfo ? `P${selectedPeriodInfo.period_number} (${selectedPeriodInfo.start_time?.slice(0, 5)}–${selectedPeriodInfo.end_time?.slice(0, 5)})` : ''

  return (
    <div className="space-y-5">
      <AttentionRequiredPanel onFindSubstitute={(d, f) => { setDay(d); setPeriod(f.period_number); setAutoPicked(true); setSubstituteFor({ ...f, day_of_week: d }) }} />

      {substituteFor && (
        <SubstituteModal flagged={substituteFor} onClose={() => setSubstituteFor(null)} />
      )}

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Day</Label>
          <Select value={String(day)} onValueChange={v => { setDay(Number(v)); setPeriod(''); setAutoPicked(false) }}>
            <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Period</Label>
          <Select value={period === '' ? 'all' : String(period)} onValueChange={v => setPeriod(v === 'all' ? '' : Number(v))}>
            <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole day (any period)</SelectItem>
              {availablePeriods.map((p: any) => (
                <SelectItem key={p.period_number} value={String(p.period_number)}>
                  P{p.period_number} · {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {allSubjects.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Subject</Label>
            <Select value={subjectFilter || 'any'} onValueChange={v => setSubjectFilter(v === 'any' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any subject</SelectItem>
                {allSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {period !== '' && (
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{shownFree.length}</p>
              <p className="text-xs text-muted-foreground">Free</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">{busyTeachers.length}</p>
              <p className="text-xs text-muted-foreground">Teaching</p>
            </div>
          </div>
        )}
      </div>

      {period !== '' && !isLiveSlot && (
        <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {day === todayDayOfWeek
            ? `You're viewing ${periodLabel}, not the current time — this isn't a live "who's free right now" picture.`
            : `You're viewing ${DAYS[day - 1]} ${periodLabel} — a different day, not live attendance.`}
        </div>
      )}

      {isLoading ? (
        // Two side-by-side panels (Free / Teaching) land here.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : availablePeriods.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Clock}
            title={`No periods scheduled on ${DAYS[day - 1]} yet`}
            description="Who's free is worked out from the timetable — build this day's schedule first, then come back."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Free */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-success" />
                Free {periodLabel ? `— ${periodLabel}` : ''}
              </h3>
              <span className="text-xs text-muted-foreground">{shownFree.length}</span>
            </div>
            {period === '' ? (
              <EmptyState icon={Clock} title="Pick a period" description="Choose a period above to see which teachers are free at that time." className="py-10" />
            ) : shownFree.length === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="No one's free at this period"
                description={subjectFilter
                  ? `Every ${subjectFilter} teacher is already teaching. Clear the subject filter to widen the search.`
                  : 'Every teacher is already teaching this period. Try a neighbouring period.'}
                className="py-10"
              />
            ) : (
              <div className="divide-y divide-border">
                {shownFree.map((t: any) => (
                  <div key={t.id} className="px-5 py-3">
                    <p className="text-sm font-semibold text-foreground">{t.full_name}</p>
                    {t.subjects_today.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> {t.subjects_today.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Busy */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                {isLiveSlot ? 'Teaching Right Now' : `Teaching ${periodLabel ? `— ${periodLabel}` : ''}`}
              </h3>
              <span className="text-xs text-muted-foreground">{busyTeachers.length}</span>
            </div>
            {period === '' ? (
              <EmptyState icon={Clock} title="Pick a period" description="Choose a period above to see who is teaching at that time." className="py-10" />
            ) : busyTeachers.length === 0 ? (
              <EmptyState icon={User} title="No one is teaching" description="Nothing is scheduled for this period — it's free for everyone." className="py-10" />
            ) : (
              <div className="divide-y divide-border">
                {busyTeachers.map((b: any) => (
                  <div key={b.teacher_id} className="px-5 py-3">
                    <p className="text-sm font-semibold text-foreground">{b.full_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {b.subject_name} · {b.class_name}{b.section_name ? ` - ${b.section_name}` : ''}
                      {b.room ? ` · ${b.room}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SUBSTITUTE SUGGESTIONS MODAL — the actual answer behind "Find
// Substitute": who's present today, free this exact period, and
// qualified (teaches this subject somewhere on their weekly timetable).
// Falls back to "free but different subject" when no qualified match
// exists, rather than a dead end.
function SubstituteModal({ flagged, onClose }: { flagged: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable-substitutes', flagged.day_of_week, flagged.period_number, flagged.subject_name, flagged.teacher_id],
    queryFn: () => timetableApi.substitutes(flagged.day_of_week, flagged.period_number, flagged.subject_name, flagged.teacher_id).then((r: any) => r.data),
  })

  const suggestions: any[] = data?.suggestions ?? []
  const otherFree: any[] = data?.other_free ?? []

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Find a Substitute</DialogTitle>
        </DialogHeader>
        <div className="mb-3 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="font-semibold text-foreground">
            {flagged.class_name}{flagged.section_name ? ` - ${flagged.section_name}` : ''} · {flagged.subject_name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            P{flagged.period_number} · {flagged.start_time?.slice(0, 5)}–{flagged.end_time?.slice(0, 5)} · usually {flagged.teacher_name}
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : suggestions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teaches {flagged.subject_name} · free now</p>
            {suggestions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.full_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> {t.subjects.join(', ')}
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-success bg-success/10 rounded-full px-2 py-0.5">Free</span>
              </div>
            ))}
          </div>
        ) : otherFree.length > 0 ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-warning/10 text-warning text-xs px-3 py-2">
              No one who teaches {flagged.subject_name} is free right now. Other staff free this period:
            </div>
            {otherFree.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.full_name}</p>
                  {t.subjects.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" /> {t.subjects.join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-success bg-success/10 rounded-full px-2 py-0.5">Free</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={UserCheck} title="No one is available" description="Every present teacher is already teaching this period." className="py-8" />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

