'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, Download, Loader2,
  RefreshCw, ScanLine, UserMinus, UserPlus, Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

import {
  timetableApi, timetableError, todayISO, prettyDate, relativeDate,
  dayOfWeekFor, addDaysISO, DAY_NAMES, Arrangement, Candidate,
} from '@/lib/timetableApi'
import { Banner, Chip, DateNav, StatusPill, TableSkeleton, subjectClasses } from '../components'
import { ReturnedDialog } from './ReturnedDialog'
import { FreeFacultyView } from '../CoverNow'

// ═══════════════════════════════════════════════════════════════
// The morning screen.
// ═══════════════════════════════════════════════════════════════
//
// This is what the timetable manager opens at 07:40 with a queue of
// absences and forty minutes before the first bell. Everything on it is
// arranged around that: the count of uncovered periods is the largest
// thing on the page, finding a substitute is one click from the row that
// needs one, and the reason a candidate is being suggested is written
// out in words rather than left as a score.

export default function ArrangementsPage() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { can, isLoading: permsLoading } = usePermissions()

  const [date, setDateState] = useState(() => params.get('date') || todayISO())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAbsentForm, setShowAbsentForm] = useState(false)
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const [gapsExpanded, setGapsExpanded] = useState(false)

  useEffect(() => {
    const fromUrl = params.get('date')
    if (fromUrl && fromUrl !== date) setDateState(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const setDate = (next: string) => {
    setDateState(next)
    setExpanded(null)
    router.replace(next === todayISO() ? '/timetable/arrangements' : `/timetable/arrangements?date=${next}`)
  }

  const canManage = can('arrangement.manage')

  const arrangementsQuery = useQuery({
    queryKey: ['arrangements', date],
    queryFn: () => timetableApi.arrangements(date),
  })
  const absencesQuery = useQuery({
    queryKey: ['absences', date],
    queryFn: () => timetableApi.absences(date),
  })

  const rows = arrangementsQuery.data ?? []
  const absences = absencesQuery.data ?? []

  const summary = useMemo(() => {
    const live = rows.filter(r => r.status !== 'cancelled')
    return {
      total: live.length,
      needsCover: live.filter(r => r.status === 'unassigned' || r.status === 'declined').length,
      awaiting: live.filter(r => r.status === 'assigned').length,
      confirmed: live.filter(r => r.status === 'acknowledged').length,
      escalated: live.filter(r => r.escalated_at && r.status === 'assigned').length,
    }
  }, [rows])

  const proposedAll = absences.filter((a: any) => a.status === 'proposed')
  // Somebody off sick today, versus a timetable that still names a
  // teacher who left in June. Same list until now, and they want
  // opposite answers: one is settled by finding cover, the other comes
  // back every single day until the periods are reassigned.
  const proposed = proposedAll.filter((a: any) => !a.needs_timetable_fix)
  const staffingGaps = proposedAll.filter((a: any) => a.needs_timetable_fix)

  const byTeacher = useMemo(() => {
    const groups = new Map<string, { name: string; teacherId: string; rows: Arrangement[] }>()
    for (const row of rows) {
      if (row.status === 'cancelled') continue
      const key = row.absent_teacher_id
      if (!groups.has(key)) {
        groups.set(key, { name: row.absent_teacher_name ?? 'Unknown', teacherId: key, rows: [] })
      }
      groups.get(key)!.rows.push(row)
    }
    // Whoever has the most uncovered periods first — that is the problem
    // to solve, not the alphabet.
    return Array.from(groups.values()).sort((a, b) => {
      const uncovered = (g: typeof a) => g.rows.filter(r => r.status === 'unassigned' || r.status === 'declined').length
      return uncovered(b) - uncovered(a) || a.name.localeCompare(b.name)
    })
  }, [rows])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['arrangements', date] })
    qc.invalidateQueries({ queryKey: ['absences', date] })
  }

  // Bring the queue up to date for whichever day is open.
  //
  // This screen used to show only what a background sweep had already
  // written. Open a date the sweep had not reached — next Tuesday, say —
  // and it said "Nobody is away" while three teachers who had left still
  // held periods that day and a fourth was on approved leave. The page
  // was reporting the state of a cron job, not the state of the school.
  //
  // So opening a day works it out. Both calls are the same ones behind
  // the Sync leave and Check attendance buttons and both are idempotent:
  // a teacher who already has an absence for that date is skipped, so
  // this settles after one pass and re-running changes nothing. Only for
  // somebody who could press those buttons anyway.
  const [caughtUp, setCaughtUp] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!canManage || caughtUp[date]) return
    setCaughtUp(prev => ({ ...prev, [date]: true }))
    ;(async () => {
      try {
        await Promise.all([
          timetableApi.syncLeave(date).catch(() => null),
          timetableApi.detectAbsences(date).catch(() => null),
        ])
      } finally {
        invalidate()
      }
    })()
    // invalidate closes over `date`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, canManage])

  const syncLeave = useMutation({
    mutationFn: () => timetableApi.syncLeave(date),
    onSuccess: (r: any) => {
      toast.success(r.created
        ? `${r.created} teacher${r.created === 1 ? '' : 's'} on approved leave added to the queue`
        : 'No approved leave to add for this date')
      invalidate()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const detect = useMutation({
    mutationFn: () => timetableApi.detectAbsences(date),
    onSuccess: (r: any) => {
      if (r.disabled) toast.info('Attendance checking is switched off in settings')
      else if (r.proposed) toast.success(`${r.proposed} possible absence${r.proposed === 1 ? '' : 's'} found — confirm below`)
      // Somebody who has just marked two people absent and is told
      // "nothing found" concludes the check is broken. Say what was
      // found and why it produced nothing.
      else if (r.absentButDayOver) {
        toast.info(`${r.absentButDayOver} teacher${r.absentButDayOver === 1 ? ' is' : 's are'} marked absent, but all their lessons today have already finished — there is nothing left to cover`)
      }
      else if (!r.withPeriodsLeft) toast.info('No classes left today, so there is nothing to arrange cover for')
      // "Nobody is missing" and "nobody has been marked yet" are
      // different answers, and reporting the second as the first is how
      // a school stops trusting the check.
      else if (r.registerTaken === false) {
        toast.info('Staff attendance has not been marked yet today — nothing to compare the timetable against')
      }
      else if (r.registerUsable === false) {
        toast.info('Staff attendance is only part-marked, so only people explicitly marked absent were checked')
      }
      else toast.success('Everyone with a class still to come is marked in')
      invalidate()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>

  if (!can('arrangement.view')) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="You don't have access to arrangements"
          description="Ask an administrator for the Arrangements permission."
        />
      </div>
    )
  }

  const dayNumber = dayOfWeekFor(date)
  const isSunday = dayNumber === 7

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Arrangements"
        description="Cover for absent teachers, period by period."
        icon={Users}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateNav value={date} onChange={setDate} relativeLabel={relativeDate(date)} />
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => syncLeave.mutate()} disabled={syncLeave.isPending}>
                  {syncLeave.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="mr-1.5 h-3.5 w-3.5" />}
                  Sync leave
                </Button>
                <Button variant="outline" size="sm" onClick={() => detect.mutate()} disabled={detect.isPending}>
                  {detect.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanLine className="mr-1.5 h-3.5 w-3.5" />}
                  Check attendance
                </Button>
                <Button size="sm" onClick={() => setShowAbsentForm(true)}>
                  <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                  Mark absent
                </Button>
              </>
            )}
          </div>
        }
      />

      {isSunday ? (
        <EmptyState
          icon={CalendarDays}
          title="Sunday"
          description="No classes are scheduled, so there is nothing to arrange."
        />
      ) : (
        <>
          {/* The four numbers that decide what to do next. */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile
              label="Need cover" value={summary.needsCover}
              tone={summary.needsCover ? 'bad' : 'good'}
              hint={summary.needsCover ? 'Nobody assigned yet' : 'Everything is covered'}
            />
            <SummaryTile
              label="Awaiting reply" value={summary.awaiting}
              tone={summary.escalated ? 'bad' : summary.awaiting ? 'warn' : 'neutral'}
              hint={summary.escalated ? `${summary.escalated} escalated` : 'Assigned, not yet confirmed'}
            />
            <SummaryTile label="Confirmed" value={summary.confirmed} tone="good" hint="Substitute has accepted" />
            <SummaryTile label="Teachers away" value={byTeacher.length} tone="neutral" hint={`${summary.total} periods affected`} />
          </div>

          {staffingGaps.length > 0 && canManage && (
            <div className="mb-4">
              <Banner
                tone="bad"
                title={`${staffingGaps.length} class group${staffingGaps.length === 1 ? '' : 's'} on the timetable have no teacher`}
              >
                These are not absences. The timetable still gives periods to people who will
                not be teaching them, so this will come back tomorrow and every day after
                until the periods are reassigned. Cover is a stopgap.
                <div className="mt-2 space-y-2">
                  {(gapsExpanded ? staffingGaps : staffingGaps.slice(0, 2)).map((a: any) => (
                    <div key={a.id}
                      className="flex flex-col gap-2 rounded-lg border border-destructive/20 bg-background px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 truncate text-sm font-medium text-foreground">{a.teacher_name}</p>
                          <Chip tone={a.permanently_gone ? 'bad' : 'warn'}>
                            {a.permanently_gone ? 'fix the timetable' : 'needs a stand-in teacher'}
                          </Chip>
                          {a.periods_affected > 0 && (
                            <Chip>{a.periods_affected} period{a.periods_affected === 1 ? '' : 's'} today</Chip>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{a.reason}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Link
                          href="/timetable/block"
                          className="rounded-md border border-border px-2.5 py-1.5 text-center text-xs font-medium hover:bg-accent max-sm:w-full"
                        >
                          Reassign their periods →
                        </Link>
                      </div>
                    </div>
                  ))}
                  {staffingGaps.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setGapsExpanded(v => !v)}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', gapsExpanded && 'rotate-180')} />
                      {gapsExpanded ? 'Show less' : `Show ${staffingGaps.length - 2} more`}
                    </button>
                  )}
                </div>
              </Banner>
            </div>
          )}

          {proposed.length > 0 && canManage && (
            <div className="mb-5">
              <Banner
                tone="warn"
                title={`${proposed.length} teacher${proposed.length === 1 ? '' : 's'} may need cover on ${prettyDate(date)}`}
              >
                {/* The heading stays neutral because the reasons differ:
                    one may be marked absent in staff attendance, another
                    has resigned and still holds periods, a third is
                    suspended. Saying "a class running with no check-in"
                    for all of them contradicted the row underneath it,
                    and "today" was simply wrong whenever another date was
                    open. Each row carries its own reason instead. */}
                Their periods are still on the timetable but they will not be taking them.
                Confirm to send those periods to the cover queue.
                <div className="mt-2 space-y-2">
                  {proposed.map((a: any) => (
                    <ProposedAbsenceRow key={a.id} absence={a} date={date} onDone={invalidate} />
                  ))}
                </div>
              </Banner>
            </div>
          )}

          <Tabs defaultValue="queue">
            <TabsList className="mb-4 h-auto flex-wrap">
              <TabsTrigger value="queue">
                Queue{summary.needsCover > 0 && (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                    {summary.needsCover}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="free">Who's free</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
              <TabsTrigger value="fairness">Fairness</TabsTrigger>
            </TabsList>

            <TabsContent value="queue">
              {arrangementsQuery.isLoading ? (
                <TableSkeleton rows={5} cols={4} />
              ) : !byTeacher.length ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nobody is away"
                  description={`No absences recorded for ${prettyDate(date)}. Mark someone absent, or sync approved leave, to build the queue.`}
                  action={canManage ? (
                    <Button size="sm" onClick={() => setShowAbsentForm(true)}>
                      <UserMinus className="mr-1.5 h-3.5 w-3.5" /> Mark absent
                    </Button>
                  ) : undefined}
                />
              ) : (
                <div className="space-y-4">
                  {byTeacher.map(group => (
                    <TeacherGroup
                      key={group.teacherId}
                      group={group}
                      absence={absences.find((a: any) => a.teacher_id === group.teacherId)}
                      date={date}
                      canManage={canManage}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      showAll={showAllCandidates}
                      setShowAll={setShowAllCandidates}
                      onChange={invalidate}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="free">
              {/* The per-period summary answers "how much slack is there
                  on Thursday"; the finder answers "who can take period 4
                  right now, and can teach Maths". Both are wanted, and
                  they were on two different screens. */}
              <FreeTeachersTab day={dayNumber} date={date} />
              <div className="mt-6 border-t border-border pt-6">
                <FreeFacultyView />
              </div>
            </TabsContent>

            <TabsContent value="register">
              <RegisterTab />
            </TabsContent>

            <TabsContent value="fairness">
              <FairnessTab month={date.slice(0, 7)} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {showAbsentForm && (
        <MarkAbsentDialog date={date} onClose={() => setShowAbsentForm(false)} onDone={invalidate} />
      )}
    </div>
  )
}

// ── summary tile ────────────────────────────────────────────────

function SummaryTile({ label, value, tone, hint }: {
  label: string; value: number; tone: 'good' | 'warn' | 'bad' | 'neutral'; hint: string
}) {
  const tones = {
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-destructive',
    neutral: 'text-foreground',
  }
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-3xl font-bold tabular-nums', tones[tone])}>{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

// ── proposed absence ────────────────────────────────────────────

function ProposedAbsenceRow({ absence, date, onDone }: { absence: any; date: string; onDone: () => void }) {
  const confirm = useMutation({
    mutationFn: () => timetableApi.createAbsence({
      teacherId: absence.teacher_id, date, scope: 'full_day', reason: absence.reason,
    }),
    onSuccess: (r: any) => {
      toast.success(`${absence.teacher_name} marked absent — ${r.arrangementsCreated} period(s) need cover`)
      onDone()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const dismiss = useMutation({
    mutationFn: () => timetableApi.cancelAbsence(absence.id, 'Dismissed — teacher is present'),
    onSuccess: () => { toast.success(`Dismissed for ${absence.teacher_name}`); onDone() },
    onError: (e) => toast.error(timetableError(e)),
  })

  const busy = confirm.isPending || dismiss.isPending

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{absence.teacher_name}</p>
        <p className="truncate text-xs text-muted-foreground">{absence.reason}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={busy}>
          They're here
        </Button>
        <Button size="sm" onClick={() => confirm.mutate()} disabled={busy}>
          {confirm.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Confirm absent
        </Button>
      </div>
    </div>
  )
}

// ── one absent teacher and their periods ────────────────────────

function TeacherGroup({
  group, absence, date, canManage, expanded, setExpanded, showAll, setShowAll, onChange,
}: {
  group: { name: string; teacherId: string; rows: Arrangement[] }
  absence: any
  date: string
  canManage: boolean
  expanded: string | null
  setExpanded: (id: string | null) => void
  showAll: boolean
  setShowAll: (v: boolean) => void
  onChange: () => void
}) {
  const uncovered = group.rows.filter(r => r.status === 'unassigned' || r.status === 'declined').length

  // Opens the per-period chooser rather than standing everything down:
  // which cover survives a teacher's return is the manager's call.
  const [returning, setReturning] = useState(false)
  // Collapsed by default — with several absent teachers on the same day,
  // every one of their periods rendered open at once made this screen a
  // long, bulky scroll on a phone. The header's own summary (period
  // count, how many still need cover, the reason) already carries enough
  // to decide whether to open it.
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {initials(group.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{group.name}</p>
            <p className="text-xs text-muted-foreground">
              {group.rows.length} period{group.rows.length === 1 ? '' : 's'}
              {uncovered > 0 && <span className="text-destructive"> · {uncovered} still uncovered</span>}
              {absence?.reason && <span> · {absence.reason}</span>}
              {absence?.source === 'leave' && <span> · from approved leave</span>}
              {absence?.scope === 'early_leave' && <span> · leaving from period {absence.from_period}</span>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && absence && (
            // stopPropagation so tapping this doesn't also toggle the
            // group open/closed underneath it.
            <span
              role="button" tabIndex={0}
              onClick={e => { e.stopPropagation(); setReturning(true) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setReturning(true) } }}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              They're back
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {isOpen && (
        <div className="divide-y divide-border">
          {group.rows.map(row => (
            <ArrangementRow
              key={row.id}
              row={row}
              canManage={canManage}
              isExpanded={expanded === row.id}
              onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              showAll={showAll}
              setShowAll={setShowAll}
              onChange={onChange}
            />
          ))}
        </div>
      )}

      {returning && absence && (
        <ReturnedDialog
          absenceId={absence.id}
          teacherName={group.name}
          open
          onOpenChange={setReturning}
          onDone={onChange}
        />
      )}
    </Card>
  )
}

function ArrangementRow({
  row, canManage, isExpanded, onToggle, showAll, setShowAll, onChange,
}: {
  row: Arrangement
  canManage: boolean
  isExpanded: boolean
  onToggle: () => void
  showAll: boolean
  setShowAll: (v: boolean) => void
  onChange: () => void
}) {
  const needsCover = row.status === 'unassigned' || row.status === 'declined'

  const unassign = useMutation({
    mutationFn: () => timetableApi.unassign(row.id),
    onSuccess: () => { toast.success('Cover removed'); onChange() },
    onError: (e) => toast.error(timetableError(e)),
  })

  return (
    <div className={cn('px-6 py-3 sm:px-8', needsCover && 'bg-destructive/[0.03]')}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-14 shrink-0 text-center">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Period</p>
          <p className="text-lg font-bold tabular-nums leading-none text-foreground">{row.period_number}</p>
        </div>

        <div className="min-w-[8rem] shrink-0">
          <p className="text-sm font-semibold text-foreground">
            {[row.class_name, row.section_name].filter(Boolean).join('-') || '—'}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{row.time_label}</p>
        </div>

        <span className={cn('rounded-md px-2 py-1 text-xs font-medium', subjectClasses(row.subject_name))}>
          {row.subject_name || 'No subject'}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {row.substitute_teacher_name && (
            <span className="text-sm text-foreground">
              <span className="text-muted-foreground">Covered by </span>
              <span className="font-medium">{row.substitute_teacher_name}</span>
            </span>
          )}
          <StatusPill status={row.status} escalated={!!row.escalated_at && row.status === 'assigned'} />

          {canManage && (
            needsCover ? (
              <Button size="sm" onClick={onToggle}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                Find cover
                <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
              </Button>
            ) : row.status !== 'cancelled' ? (
              <Button size="sm" variant="ghost" onClick={() => unassign.mutate()} disabled={unassign.isPending}>
                {unassign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Change
              </Button>
            ) : null
          )}
        </div>
      </div>

      {row.reason && !needsCover && (
        <p className="mt-1.5 pl-[4.75rem] text-xs text-muted-foreground">Chosen because: {row.reason}</p>
      )}
      {row.status === 'declined' && row.decline_reason && (
        <p className="mt-1.5 pl-[4.75rem] text-xs text-destructive">
          Declined: {row.decline_reason}
        </p>
      )}

      {isExpanded && canManage && (
        <div className="mt-3 pl-0 sm:pl-[4.75rem]">
          <CandidateList
            arrangementId={row.id}
            showAll={showAll}
            setShowAll={setShowAll}
            onAssigned={() => { onToggle(); onChange() }}
          />
        </div>
      )}
    </div>
  )
}

// ── the ranked list ─────────────────────────────────────────────

function CandidateList({
  arrangementId, showAll, setShowAll, onAssigned,
}: {
  arrangementId: string
  showAll: boolean
  setShowAll: (v: boolean) => void
  onAssigned: () => void
}) {
  const [overrideFor, setOverrideFor] = useState<Candidate | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidates', arrangementId, showAll],
    queryFn: () => timetableApi.candidates(arrangementId, showAll),
  })

  const assign = useMutation({
    mutationFn: (input: { teacherId: string; reason?: string }) =>
      timetableApi.assign(arrangementId, input.teacherId, input.reason),
    onSuccess: (_r, input) => {
      const name = data?.find(c => c.teacherId === input.teacherId)?.fullName ?? 'Substitute'
      toast.success(`${name} assigned — they've been notified and asked to confirm`)
      setOverrideFor(null)
      onAssigned()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading) return <TableSkeleton rows={3} cols={2} />
  if (error) {
    return <p className="text-sm text-destructive">{timetableError(error)}</p>
  }

  const candidates = data ?? []

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-2 sm:p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5 sm:mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Suggested cover · best first
        </p>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Include teachers over their limits
        </label>
      </div>

      {!candidates.length ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium text-foreground">Nobody is available for this period</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everyone free is either teaching, already covering, over their limit or away.
            Tick the box above to see who could be asked anyway.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {candidates.map((candidate, index) => (
            <div
              key={candidate.teacherId}
              className={cn(
                'flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2',
                index === 0 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border',
              )}
            >
              <div className="min-w-[9rem] flex-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <p className="text-sm font-medium text-foreground">{candidate.fullName}</p>
                  {index === 0 && <Chip tone="info">Best match</Chip>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 sm:mt-1">
                  {candidate.reasons.map((reason, i) => (
                    <Chip key={i} tone={i === 0 ? 'good' : 'neutral'}>{reason}</Chip>
                  ))}
                  {candidate.warnings.map((warning, i) => (
                    <Chip key={`w${i}`} tone="warn">{warning}</Chip>
                  ))}
                </div>
              </div>

              <Button
                size="sm"
                variant={index === 0 ? 'default' : 'outline'}
                disabled={assign.isPending}
                onClick={() => {
                  if (candidate.hasBooking) setOverrideFor(candidate)
                  else assign.mutate({ teacherId: candidate.teacherId })
                }}
              >
                {assign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {candidate.hasBooking ? 'Override…' : 'Assign'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {overrideFor && (
        <OverrideBookingDialog
          candidate={overrideFor}
          pending={assign.isPending}
          onCancel={() => setOverrideFor(null)}
          onConfirm={(reason) => assign.mutate({ teacherId: overrideFor.teacherId, reason })}
        />
      )}
    </div>
  )
}

/**
 * Taking a teacher's reserved free period.
 *
 * A confirmation step with a mandatory reason, because this is the one
 * action in the module that overrides a promise the school made to a
 * member of staff — and they are told about it by name, with the reason
 * attached.
 */
function OverrideBookingDialog({
  candidate, pending, onCancel, onConfirm,
}: {
  candidate: Candidate
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take {candidate.fullName}'s reserved period?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Banner tone="warn" title={`They reserved this period for ${candidate.bookingPurpose?.replace(/_/g, ' ')}`}>
            {candidate.fullName} will be told their reserved time was taken, and the reason you give below.
          </Banner>
          <div>
            <Label htmlFor="override-reason">Why is this necessary?</Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Four teachers are away and no one else can take Class VIII Maths"
              className="mt-1.5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Override and assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── mark absent ─────────────────────────────────────────────────

function MarkAbsentDialog({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [teacherId, setTeacherId] = useState('')
  const [scope, setScope] = useState('full_day')
  const [fromPeriod, setFromPeriod] = useState('')
  const [periods, setPeriods] = useState<number[]>([])
  const [reason, setReason] = useState('')

  const { data: setup } = useQuery({
    queryKey: ['timetable-teacher-setup'],
    queryFn: () => timetableApi.teacherSetup(),
  })
  const { data: free } = useQuery({
    queryKey: ['free-teachers', date],
    queryFn: () => timetableApi.freeTeachers(dayOfWeekFor(date), date),
    enabled: dayOfWeekFor(date) <= 6,
  })

  const periodNumbers: number[] = (free?.columns ?? []).map((c: any) => c.periodNumber)

  const create = useMutation({
    mutationFn: () => timetableApi.createAbsence({
      teacherId, date, scope,
      periods: scope === 'periods' ? periods : undefined,
      fromPeriod: scope === 'early_leave' || scope === 'late_arrival' ? Number(fromPeriod) : undefined,
      reason: reason || null,
    }),
    onSuccess: (r: any) => {
      toast.success(r.arrangementsCreated
        ? `${r.arrangementsCreated} period${r.arrangementsCreated === 1 ? '' : 's'} added to the queue`
        : 'Marked absent — they have no classes on this day')
      onDone()
      onClose()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const needsFromPeriod = scope === 'early_leave' || scope === 'late_arrival'
  const valid = teacherId && (scope !== 'periods' || periods.length) && (!needsFromPeriod || fromPeriod)

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark a teacher absent — {prettyDate(date)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="absent-teacher">Teacher</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger id="absent-teacher" className="mt-1.5">
                <SelectValue placeholder="Choose a teacher" />
              </SelectTrigger>
              <SelectContent>
                {(setup?.teachers ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.full_name} · {t.periods_per_week} periods/week
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="absent-scope">How much of the day?</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="absent-scope" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_day">Whole day</SelectItem>
                <SelectItem value="first_half">Morning only (up to the break)</SelectItem>
                <SelectItem value="second_half">Afternoon only (after the break)</SelectItem>
                <SelectItem value="early_leave">Leaving early, from a period</SelectItem>
                <SelectItem value="late_arrival">Arriving late, back by a period</SelectItem>
                <SelectItem value="periods">Specific periods</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsFromPeriod && (
            <div>
              <Label htmlFor="from-period">
                {scope === 'early_leave' ? 'Leaving from period' : 'Back for period'}
              </Label>
              <Select value={fromPeriod} onValueChange={setFromPeriod}>
                <SelectTrigger id="from-period" className="mt-1.5">
                  <SelectValue placeholder="Choose a period" />
                </SelectTrigger>
                <SelectContent>
                  {periodNumbers.map(n => <SelectItem key={n} value={String(n)}>Period {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {scope === 'periods' && (
            <div>
              <Label>Which periods?</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {periodNumbers.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPeriods(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n])}
                    className={cn(
                      'h-9 w-9 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      periods.includes(n)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="absent-reason">Reason (optional)</Label>
            <Input
              id="absent-reason" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Sick leave" className="mt-1.5"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Mark absent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── tabs ────────────────────────────────────────────────────────

function FreeTeachersTab({ day, date }: { day: number; date: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['free-teachers', day, date],
    queryFn: () => timetableApi.freeTeachers(day, date),
  })

  if (isLoading) return <TableSkeleton rows={4} cols={6} />
  if (!data) return null

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        {DAY_NAMES[day]} · {data.totalTeachers} teachers
        {data.absentToday > 0 && ` · ${data.absentToday} away today`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.columns.map((column: any) => (
          <Card key={column.periodNumber}>
            <CardContent className="p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-semibold text-foreground">Period {column.periodNumber}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{column.timeLabel}</p>
              </div>
              <p className={cn(
                'mb-2 text-2xl font-bold tabular-nums',
                column.freeCount === 0 ? 'text-destructive' : column.freeCount <= 2 ? 'text-warning' : 'text-success',
              )}>
                {column.freeCount}
                <span className="ml-1 text-xs font-normal text-muted-foreground">free</span>
                {column.reservedCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    +{column.reservedCount} reserved
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-1">
                {column.free.map((t: any) => (
                  <Chip key={t.teacherId} tone={t.reserved ? 'warn' : 'neutral'} title={t.reservedFor ?? undefined}>
                    {t.fullName}
                  </Chip>
                ))}
                {!column.free.length && <span className="text-xs text-muted-foreground">Nobody free</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function RegisterTab() {
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -30))
  const [to, setTo] = useState(todayISO())

  const { data, isLoading } = useQuery({
    queryKey: ['arrangement-register', from, to],
    queryFn: () => timetableApi.register(from, to),
  })

  const download = () => {
    const rows = data ?? []
    const header = ['Date', 'Period', 'Time', 'Class', 'Subject', 'Absent teacher', 'Substitute', 'Status', 'Reason']
    const csv = [header, ...rows.map((r: any) => [
      r.date, r.period, r.time, r.class, r.subject, r.absent, r.substitute, r.status, r.reason ?? '',
    ])].map(cols => cols.map((c: any) => {
      const s = String(c ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arrangement-register-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="reg-from" className="text-xs">From</Label>
          <Input id="reg-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-40" />
        </div>
        <div>
          <Label htmlFor="reg-to" className="text-xs">To</Label>
          <Input id="reg-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-40" />
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={!data?.length}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {isLoading ? <TableSkeleton /> : !data?.length ? (
        <EmptyState title="No arrangements in this period" description="Nothing has needed cover between these dates." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" style={{ minWidth: 800 }}>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Absent</th>
                <th className="px-3 py-2 font-medium">Covered by</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row: any, i: number) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{prettyDate(row.date)}</td>
                  {/* An absence that needed no cover still belongs in the
                      register — it is a record of who was away, not only
                      of cover that was arranged. It spans the lesson
                      columns rather than showing four empty cells. */}
                  {row.note ? (
                    <td className="px-3 py-2 text-muted-foreground" colSpan={3}>{row.note}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 tabular-nums">{row.period}</td>
                      <td className="px-3 py-2">{row.class}</td>
                      <td className="px-3 py-2">{row.subject}</td>
                    </>
                  )}
                  <td className="px-3 py-2">{row.absent}</td>
                  <td className="px-3 py-2 font-medium">
                    {row.note ? <span className="text-muted-foreground">—</span>
                      : row.substitute || <span className="text-destructive">Nobody</span>}
                  </td>
                  <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FairnessTab({ month }: { month: string }) {
  const [selected, setSelected] = useState(month)
  const { data, isLoading } = useQuery({
    queryKey: ['arrangement-fairness', selected],
    queryFn: () => timetableApi.fairness(selected),
  })

  if (isLoading) return <TableSkeleton />
  if (!data) return null

  const maxCovered = Math.max(1, ...data.teachers.map((t: any) => t.covered))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="fair-month" className="text-xs">Month</Label>
          <Input id="fair-month" type="month" value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 w-44" />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Periods needing cover" value={data.totals.arrangements} tone="neutral" hint="This month" />
        <SummaryTile label="Covered" value={data.totals.covered} tone="good" hint="Substitute assigned" />
        <SummaryTile label="Never filled" value={data.totals.unfilled} tone={data.totals.unfilled ? 'bad' : 'good'} hint="Nobody assigned" />
        <SummaryTile label="Declined" value={data.totals.declined} tone={data.totals.declined ? 'warn' : 'neutral'} hint="Turned down" />
      </div>

      {!data.teachers.length ? (
        <EmptyState title="No cover this month" description="Nothing to compare yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Teacher</th>
                <th className="px-3 py-2 font-medium">Periods covered</th>
                <th className="px-3 py-2 font-medium">Confirmed</th>
                <th className="px-3 py-2 font-medium">Subject match</th>
                <th className="px-3 py-2 font-medium">Typical reply</th>
                <th className="px-3 py-2 font-medium">Own absences</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.teachers.map((t: any) => (
                <tr key={t.teacherId} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(t.covered / maxCovered) * 100}%` }} />
                      </div>
                      <span className="tabular-nums">{t.covered}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {t.acknowledgeRate == null ? '—' : (
                      <span className={cn(t.acknowledgeRate < 50 && 'text-destructive font-medium')}>
                        {t.acknowledgeRate}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{t.subjectMatchRate == null ? '—' : `${t.subjectMatchRate}%`}</td>
                  <td className="px-3 py-2 tabular-nums">{t.medianAckMinutes == null ? '—' : `${t.medianAckMinutes} min`}</td>
                  <td className="px-3 py-2 tabular-nums">{t.absences}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}
