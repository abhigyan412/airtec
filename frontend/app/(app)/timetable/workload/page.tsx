'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRightLeft, Gauge, Loader2, TrendingUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

import { timetableApi, timetableError, TeacherWorkload } from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton, subjectClasses } from '../components'

// ═══════════════════════════════════════════════════════════════
// Teaching load, and what to do about it.
// ═══════════════════════════════════════════════════════════════
//
// The page exists because of a number: at the school this was built for
// the weekly load runs from 5 periods to 48, and one teacher does eight
// back to back every day with a single free period. Nobody had ever seen
// those two facts side by side, because they only appear when you add up
// six separate spreadsheet tabs.
//
// So the spread is the headline, the heatmap is the evidence, and every
// breach has a "who else could take this" button next to it. A report
// that only diagnoses gets read once.

export default function WorkloadPage() {
  const { can, isLoading: permsLoading } = usePermissions()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [redistributing, setRedistributing] = useState<TeacherWorkload | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workload', month],
    queryFn: () => timetableApi.workload(month),
    enabled: !permsLoading,
  })

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>

  if (!can('timetable.workload_view')) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="You don't have access to workload"
          description="Ask an administrator for the Workload permission."
        />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Teacher workload"
        description="Who is carrying how much, and where it needs rebalancing."
        icon={Gauge}
        actions={
          <div>
            <Label htmlFor="wl-month" className="sr-only">Month</Label>
            <Input
              id="wl-month" type="month" value={month}
              onChange={e => setMonth(e.target.value)} className="w-44"
            />
          </div>
        }
      />

      {isLoading || !data ? <TableSkeleton rows={8} cols={5} /> : (
        <>
          <DistributionStrip data={data} />

          {data.breachCounts.blocking > 0 && (
            <div className="mb-5">
              <Banner
                tone="bad"
                title={`${data.breachCounts.blocking} teacher${data.breachCounts.blocking === 1 ? ' is' : 's are'} over their teaching limit`}
              >
                Their limits were set from the timetable as it stood when it was imported, so anything
                over means the load has grown since — usually from reassignments or a new section.
              </Banner>
            </div>
          )}

          <Tabs defaultValue="heatmap">
            <TabsList className="mb-4 h-auto flex-wrap">
              <TabsTrigger value="heatmap">Week at a glance</TabsTrigger>
              <TabsTrigger value="table">Every teacher</TabsTrigger>
              <TabsTrigger value="breaches">
                Needs attention
                {(data.breachCounts.blocking + data.breachCounts.warning) > 0 && (
                  <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[10px] font-bold text-warning-foreground">
                    {data.breachCounts.blocking + data.breachCounts.warning}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="heatmap">
              <Heatmap data={data} onPick={setRedistributing} />
            </TabsContent>

            <TabsContent value="table">
              <WorkloadTable data={data} onRedistribute={setRedistributing} />
            </TabsContent>

            <TabsContent value="breaches">
              <BreachList data={data} onRedistribute={setRedistributing} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {redistributing && (
        <RedistributeDialog teacher={redistributing} onClose={() => setRedistributing(null)} />
      )}
    </div>
  )
}

// ── the headline numbers ────────────────────────────────────────

function DistributionStrip({ data }: { data: any }) {
  const d = data.distribution
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Spread</p>
          <p className={cn(
            'mt-1 text-3xl font-bold tabular-nums',
            d.spread > 25 ? 'text-destructive' : d.spread > 15 ? 'text-warning' : 'text-foreground',
          )}>
            {d.spread}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {d.min} to {d.max} periods a week
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Median load</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{d.median}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Average {d.mean}/week</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Over limit</p>
          <p className={cn('mt-1 text-3xl font-bold tabular-nums', data.breachCounts.blocking ? 'text-destructive' : 'text-success')}>
            {data.breachCounts.blocking}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Teachers</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Warnings</p>
          <p className={cn('mt-1 text-3xl font-bold tabular-nums', data.breachCounts.warning ? 'text-warning' : 'text-success')}>
            {data.breachCounts.warning}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">No free period, long runs</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Not teaching</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{d.idle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Of {d.teaching + d.idle} staff</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── heatmap ─────────────────────────────────────────────────────

/**
 * Periods taught per teacher per day.
 *
 * A sequential ramp, not a categorical palette: the value is one
 * quantity on one scale, so the colour has to be readable as "more" and
 * "less" at a glance. Anything at or over the teacher's own daily limit
 * breaks out of the ramp into the destructive colour, because that is a
 * different kind of fact.
 */
function Heatmap({ data, onPick }: { data: any; onPick: (t: TeacherWorkload) => void }) {
  const { dayNames, periodsPerDay } = data.axis
  const teachers: TeacherWorkload[] = data.teachers.filter((t: TeacherWorkload) => t.totalPerWeek > 0)

  const cellTone = (value: number, limit: number) => {
    if (value === 0) return 'bg-muted/40 text-muted-foreground'
    if (value > limit) return 'bg-destructive text-destructive-foreground font-semibold'
    const ratio = value / Math.max(1, periodsPerDay)
    if (ratio >= 0.9) return 'bg-primary text-primary-foreground font-semibold'
    if (ratio >= 0.7) return 'bg-primary/70 text-primary-foreground'
    if (ratio >= 0.5) return 'bg-primary/45 text-foreground'
    if (ratio >= 0.3) return 'bg-primary/25 text-foreground'
    return 'bg-primary/10 text-foreground'
  }

  if (!teachers.length) {
    return <EmptyState title="No teaching load recorded" description="Import or build a timetable first." />
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Periods taught per day</span>
        <div className="flex items-center gap-1">
          <span>Lighter</span>
          {['bg-primary/10', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'].map(c => (
            <span key={c} className={cn('h-3 w-5 rounded-sm', c)} />
          ))}
          <span>Heavier</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-3 w-5 rounded-sm bg-destructive" />
          <span>Over their daily limit</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 640 }}>
          <thead className="bg-muted/50">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Teacher
              </th>
              {dayNames.map((d: string) => (
                <th key={d} className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {d.slice(0, 3)}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Week</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Free</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {teachers.map(teacher => (
              <tr key={teacher.teacherId} className="group hover:bg-muted/30">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5 group-hover:bg-muted/30">
                  <button
                    onClick={() => onPick(teacher)}
                    className="text-left text-sm font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {teacher.name}
                  </button>
                  {teacher.breaches.some(b => b.severity === 'block') && (
                    <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-destructive" />
                  )}
                </td>
                {teacher.perDay.map((value, i) => (
                  <td key={i} className="p-1 text-center">
                    <div
                      className={cn('mx-auto flex h-8 w-full min-w-[2rem] items-center justify-center rounded-md text-xs tabular-nums', cellTone(value, teacher.limits.maxPerDay))}
                      title={`${dayNames[i]}: ${value} period${value === 1 ? '' : 's'} (limit ${teacher.limits.maxPerDay})`}
                    >
                      {value || ''}
                    </div>
                  </td>
                ))}
                <td className={cn(
                  'px-3 py-1.5 text-right text-sm font-semibold tabular-nums',
                  teacher.totalPerWeek > teacher.limits.maxPerWeek && 'text-destructive',
                )}>
                  {teacher.totalPerWeek}
                </td>
                <td className={cn(
                  'px-3 py-1.5 text-right text-sm tabular-nums',
                  teacher.freePeriodsPerWeek <= 6 ? 'text-warning' : 'text-muted-foreground',
                )}>
                  {teacher.freePeriodsPerWeek}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── table ───────────────────────────────────────────────────────

function WorkloadTable({ data, onRedistribute }: { data: any; onRedistribute: (t: TeacherWorkload) => void }) {
  const [sort, setSort] = useState<'load' | 'name' | 'free'>('load')

  const teachers = useMemo(() => {
    const list: TeacherWorkload[] = [...data.teachers]
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'free') return list.sort((a, b) => b.freePeriodsPerWeek - a.freePeriodsPerWeek)
    return list.sort((a, b) => b.totalPerWeek - a.totalPerWeek)
  }, [data.teachers, sort])

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Sort by</span>
        {(['load', 'free', 'name'] as const).map(key => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              sort === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {key === 'load' ? 'Heaviest first' : key === 'free' ? 'Most free time' : 'Name'}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm" style={{ minWidth: 860 }}>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="px-3 py-2 font-medium">Per week</th>
              <th className="px-3 py-2 font-medium">Busiest day</th>
              <th className="px-3 py-2 font-medium">Longest run</th>
              <th className="px-3 py-2 font-medium">Free/week</th>
              <th className="px-3 py-2 font-medium">Cover done</th>
              <th className="px-3 py-2 font-medium">Subjects</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {teachers.map(t => (
              <tr key={t.teacherId} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <p className="font-medium text-foreground">{t.name}</p>
                  {t.limits.exempt && <Chip tone="info">Exempt from cover</Chip>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', t.utilization > 1 ? 'bg-destructive' : t.utilization > 0.9 ? 'bg-warning' : 'bg-primary')}
                        style={{ width: `${Math.min(100, t.utilization * 100)}%` }}
                      />
                    </div>
                    <span className={cn('tabular-nums', t.totalPerWeek > t.limits.maxPerWeek && 'font-semibold text-destructive')}>
                      {t.totalPerWeek}
                    </span>
                    <span className="text-xs text-muted-foreground">/ {t.limits.maxPerWeek}</span>
                  </div>
                </td>
                <td className={cn('px-3 py-2 tabular-nums', t.maxPerDay > t.limits.maxPerDay && 'font-semibold text-destructive')}>
                  {t.maxPerDay}
                </td>
                <td className={cn('px-3 py-2 tabular-nums', t.maxConsecutive > t.limits.maxConsecutive && 'font-semibold text-warning')}>
                  {t.maxConsecutive}
                </td>
                <td className="px-3 py-2 tabular-nums">{t.freePeriodsPerWeek}</td>
                <td className="px-3 py-2 tabular-nums">{t.arrangementsThisMonth}</td>
                <td className="px-3 py-2 tabular-nums">{t.subjectCount || <span className="text-warning">none set</span>}</td>
                <td className="px-3 py-2 text-right">
                  {t.totalPerWeek > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => onRedistribute(t)}>
                      <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Rebalance
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── breaches ────────────────────────────────────────────────────

function BreachList({ data, onRedistribute }: { data: any; onRedistribute: (t: TeacherWorkload) => void }) {
  const flagged: TeacherWorkload[] = data.teachers.filter((t: TeacherWorkload) => t.breaches.length)

  if (!flagged.length) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Nothing is over its limit"
        description="Every teacher is inside the daily, weekly and consecutive-period limits set for them."
      />
    )
  }

  return (
    <div className="space-y-3">
      {flagged.map(teacher => (
        <Card key={teacher.teacherId}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{teacher.name}</p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {teacher.totalPerWeek} periods/week
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {teacher.breaches.map((breach, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      breach.severity === 'block' ? 'bg-destructive' : 'bg-warning',
                    )} />
                    <span className={breach.severity === 'block' ? 'text-destructive' : 'text-muted-foreground'}>
                      {breach.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button size="sm" onClick={() => onRedistribute(teacher)}>
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Find someone to take a class
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── redistribution ──────────────────────────────────────────────

function RedistributeDialog({ teacher, onClose }: { teacher: TeacherWorkload; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['redistribute', teacher.teacherId],
    queryFn: () => timetableApi.redistribute(teacher.teacherId),
  })

  const reassign = useMutation({
    mutationFn: (input: { periodId: string; teacherId: string }) =>
      timetableApi.reassign(input.periodId, input.teacherId),
    onSuccess: () => {
      toast.success('Class reassigned — both teachers have been told')
      qc.invalidateQueries({ queryKey: ['workload'] })
      qc.invalidateQueries({ queryKey: ['redistribute', teacher.teacherId] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const periods = data ?? []
  const withOptions = periods.filter((p: any) => p.candidates.length)

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rebalance {teacher.name}'s week</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {teacher.totalPerWeek} periods a week against a limit of {teacher.limits.maxPerWeek}.
          Only colleagues who teach the subject, are free in that slot, and have room within
          their own limits are offered — moving a breach is not fixing it.
        </p>

        {isLoading ? <TableSkeleton rows={5} cols={3} /> : !withOptions.length ? (
          <EmptyState
            title="No safe swaps available"
            description="Nobody else who teaches these subjects is free in these slots with capacity to spare. Recording second and third subjects on the setup page usually opens options up."
          />
        ) : (
          <div className="space-y-2">
            {withOptions.map((period: any) => (
              <div key={period.periodId} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {period.dayName} · period {period.periodNumber}
                  </span>
                  <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', subjectClasses(period.subjectName))}>
                    {period.subjectName}
                  </span>
                  <span className="text-sm text-muted-foreground">{period.className}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {period.candidates.map((candidate: any) => (
                    <Button
                      key={candidate.teacherId}
                      size="sm"
                      variant="outline"
                      disabled={reassign.isPending}
                      onClick={() => reassign.mutate({ periodId: period.periodId, teacherId: candidate.teacherId })}
                    >
                      {reassign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      {candidate.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {candidate.periodsThisWeek}/wk
                        {candidate.priority > 1 && ' · fallback subject'}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
