'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, CheckCircle2, ChevronRight, Circle, Clock, DoorOpen, Loader2, Plus,
  Settings as SettingsIcon, SlidersHorizontal, Trash2, Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePermissions } from '@/lib/usePermissions'
import { classesApi } from '@/lib/api'
import { cn } from '@/lib/utils'

import { timetableApi, timetableError, DAY_NAMES } from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton, subjectClasses } from '../components'

// ═══════════════════════════════════════════════════════════════
// Setup: the part schools skip, and why they must not.
// ═══════════════════════════════════════════════════════════════
//
// A grid with no notion of who can teach what, how much anyone is
// allowed to teach, or what shape the day is can be drawn but cannot be
// reasoned about — no generation, no meaningful conflict detection, and
// substitute suggestions no better than "whoever happens to be free".
//
// The importer fills nearly all of this in, so the job here is reviewing
// rather than typing. The checklist leads with what is still MISSING for
// exactly that reason: a school that imports a grid, sees it render, and
// assumes it is finished will discover on the first sick day that nobody
// has subject capability set.

export default function SetupPage() {
  const { can, isLoading: permsLoading } = usePermissions()
  const canEdit = can('timetable.setup_manage')

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>

  if (!can('timetable.view')) {
    return (
      <div className="p-6">
        <EmptyState icon={AlertTriangle} title="You don't have access to timetable setup" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Timetable setup"
        description="The shape of the day, who teaches what, and how much."
        icon={SlidersHorizontal}
        centered
      />

      <Tabs defaultValue="checklist">
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="day">School day</TabsTrigger>
          <TabsTrigger value="teachers">Teachers</TabsTrigger>
          <TabsTrigger value="subjects">Subjects</TabsTrigger>
          <TabsTrigger value="plan">Weekly plan</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="checklist"><ChecklistTab /></TabsContent>
        <TabsContent value="day"><DayTemplatesTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="teachers"><TeachersTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="subjects"><SubjectsTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="plan"><PlanTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="rooms"><RoomsTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="rules"><RulesTab canEdit={canEdit} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ── checklist ───────────────────────────────────────────────────

function ChecklistTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable-readiness'],
    queryFn: () => timetableApi.readiness(),
  })

  if (isLoading || !data) return <TableSkeleton rows={6} cols={2} />

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {data.complete ? 'Everything is set up' : data.ready ? 'Ready to run' : 'Not ready yet'}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {data.complete
                  ? 'Nothing outstanding.'
                  : data.ready
                    ? 'The essentials are in place. The rest improves how good the suggestions are.'
                    : 'Some essentials are missing — the timetable cannot work properly until they are done.'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums text-foreground">{data.percent}%</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', data.ready ? 'bg-success' : 'bg-warning')}
              style={{ width: `${data.percent}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {data.items.map(item => (
          <Card key={item.key} className={cn(!item.done && item.blocking && 'border-destructive/40')}>
            <CardContent className="flex items-start gap-3 p-4">
              {item.done
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                : <Circle className={cn('mt-0.5 h-5 w-5 shrink-0', item.blocking ? 'text-destructive' : 'text-muted-foreground')} />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={cn('text-sm font-medium', item.done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                    {item.label}
                  </p>
                  {!item.done && item.blocking && <Chip tone="bad">Required</Chip>}
                  <span className="text-xs tabular-nums text-muted-foreground">{item.detail}</span>
                </div>
                {!item.done && <p className="mt-1 text-sm text-muted-foreground">{item.why}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── day templates ───────────────────────────────────────────────

function DayTemplatesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['day-templates'],
    queryFn: () => timetableApi.dayTemplates(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => timetableApi.deleteDayTemplate(id),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['day-templates'] }) },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading) return <TableSkeleton rows={3} cols={4} />

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          A school rarely has one day shape: junior classes usually finish earlier than seniors, and
          Saturday is often shorter. Breaks are part of the shape because a double period may not
          run across one.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing({ name: '', periods: defaultPeriods() })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {!data?.length ? (
        <EmptyState
          icon={Clock}
          title="No day shapes defined"
          description="Import a timetable, or add one here, before anything else."
        />
      ) : (
        <div className="space-y-3">
          {data.map((template: any) => (
            <Card key={template.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{template.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {template.teaching_periods} teaching periods
                      {template.sections_using > 0 && ` · used by ${template.sections_using} section(s)`}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing({
                        id: template.id,
                        name: template.name,
                        periods: template.period_slot_defs.map((p: any) => ({
                          slotIndex: p.slot_index, kind: p.kind, periodNumber: p.period_number,
                          startTime: p.start_time.slice(0, 5), endTime: p.end_time.slice(0, 5), label: p.label,
                        })),
                      })}>Edit</Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => remove.mutate(template.id)}
                        disabled={remove.isPending || template.sections_using > 0}
                        title={template.sections_using > 0 ? 'Sections still follow this shape' : 'Remove'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {template.period_slot_defs.map((p: any) => (
                    <span
                      key={p.id}
                      title={p.time_label}
                      className={cn(
                        'rounded px-2 py-1 text-[11px] tabular-nums',
                        p.kind === 'period' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {p.kind === 'period' ? `P${p.period_number}` : (p.label || p.kind)}
                      <span className="ml-1 opacity-70">{p.start_time.slice(0, 5)}</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <DayTemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['day-templates'] }) }}
        />
      )}
    </div>
  )
}

function defaultPeriods() {
  return [
    { slotIndex: 1, kind: 'period', periodNumber: 1, startTime: '08:00', endTime: '08:40', label: null },
    { slotIndex: 2, kind: 'period', periodNumber: 2, startTime: '08:40', endTime: '09:20', label: null },
    { slotIndex: 3, kind: 'break', periodNumber: null, startTime: '09:20', endTime: '09:40', label: 'Break' },
    { slotIndex: 4, kind: 'period', periodNumber: 3, startTime: '09:40', endTime: '10:20', label: null },
  ]
}

function DayTemplateDialog({ template, onClose, onDone }: { template: any; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(template.name)
  const [periods, setPeriods] = useState<any[]>(template.periods)

  const save = useMutation({
    mutationFn: () => timetableApi.saveDayTemplate({ id: template.id, name, periods: renumber(periods) }),
    onSuccess: () => { toast.success('Saved'); onDone() },
    onError: (e) => toast.error(timetableError(e)),
  })

  /**
   * Teaching periods must be numbered 1..N with nothing missing — every
   * other part of the module addresses a slot by that number. Rather than
   * making the user maintain it by hand, it is recomputed from the row
   * order each time the list changes.
   */
  function renumber(rows: any[]) {
    let n = 0
    return rows.map((row, i) => ({
      ...row,
      slotIndex: i + 1,
      periodNumber: row.kind === 'period' ? ++n : null,
    }))
  }

  const update = (index: number, patch: any) => {
    setPeriods(rows => renumber(rows.map((r, i) => (i === index ? { ...r, ...patch } : r))))
  }
  const addRow = (kind: string) => {
    const last = periods[periods.length - 1]
    setPeriods(rows => renumber([...rows, {
      slotIndex: rows.length + 1, kind, periodNumber: null,
      startTime: last?.endTime ?? '08:00',
      endTime: addMinutes(last?.endTime ?? '08:00', kind === 'period' ? 40 : 20),
      label: kind === 'period' ? null : kind === 'lunch' ? 'Lunch' : 'Break',
    }]))
  }

  const numbered = renumber(periods)

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{template.id ? 'Edit' : 'Add'} a day shape</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="dt-name">Name</Label>
            <Input
              id="dt-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. 9-period day (Classes I–IV)" className="mt-1.5"
            />
          </div>

          <div>
            <Label>Periods and breaks, in order</Label>
            <div className="mt-1.5 space-y-1.5">
              {numbered.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  <span className={cn(
                    'w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium',
                    row.kind === 'period' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {row.kind === 'period' ? `P${row.periodNumber}` : row.kind}
                  </span>
                  <Input
                    type="time" value={row.startTime}
                    onChange={e => update(i, { startTime: e.target.value })}
                    className="h-8 w-28"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="time" value={row.endTime}
                    onChange={e => update(i, { endTime: e.target.value })}
                    className="h-8 w-28"
                  />
                  {row.kind !== 'period' && (
                    <Input
                      value={row.label ?? ''} onChange={e => update(i, { label: e.target.value })}
                      placeholder="Label" className="h-8 w-28"
                    />
                  )}
                  <Button
                    size="sm" variant="ghost" className="ml-auto"
                    onClick={() => setPeriods(rows => renumber(rows.filter((_, x) => x !== i)))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => addRow('period')}>+ Period</Button>
              <Button size="sm" variant="outline" onClick={() => addRow('break')}>+ Break</Button>
              <Button size="sm" variant="outline" onClick={() => addRow('lunch')}>+ Lunch</Button>
              <Button size="sm" variant="outline" onClick={() => addRow('assembly')}>+ Assembly</Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ── teachers ────────────────────────────────────────────────────

function TeachersTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)
  const [filter, setFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['timetable-teacher-setup'],
    queryFn: () => timetableApi.teacherSetup(),
  })

  const teachers = useMemo(() => {
    const list = data?.teachers ?? []
    const q = filter.trim().toLowerCase()
    return q ? list.filter((t: any) => t.full_name.toLowerCase().includes(q)) : list
  }, [data, filter])

  if (isLoading) return <TableSkeleton rows={8} cols={4} />

  const withoutFallback = (data?.teachers ?? []).filter((t: any) =>
    !t.capabilities.some((c: any) => c.priority > 1)).length

  return (
    <div>
      {withoutFallback > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${withoutFallback} teachers have no fallback subject recorded`}>
            A fallback subject — something they can teach at a push, or supervise — is the one thing
            a spreadsheet cannot tell us, and it is what decides whether cover suggestions are any
            good. Without it, a Maths absence with no other Maths teacher free falls back to
            "anyone".
          </Banner>
        </div>
      )}

      <div className="mb-3">
        <Input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Find a teacher…" className="max-w-xs"
        />
      </div>

      <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground lg:hidden">
        Swipe left to see subjects, limits and edit <ChevronRight className="h-3 w-3" />
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm" style={{ minWidth: 800 }}>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Load</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Subjects they can take</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Limits</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {teachers.map((teacher: any) => (
              <tr key={teacher.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <p className="font-medium text-foreground">{teacher.full_name}</p>
                  {teacher.needs_login && <Chip tone="warn">No login yet</Chip>}
                </td>
                <td className="px-3 py-2 tabular-nums">{teacher.periods_per_week}/wk</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {teacher.capabilities.length ? teacher.capabilities.map((c: any) => (
                      <span
                        key={c.id}
                        className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', subjectClasses(c.subject_name))}
                        title={`${c.priority === 1 ? 'Main subject' : c.priority === 2 ? 'Can teach' : 'Can supervise'}${
                          c.min_class_level != null ? ` · classes ${c.min_class_level}–${c.max_class_level}` : ''}`}
                      >
                        {c.subject_name}
                        {c.priority > 1 && <span className="ml-0.5 opacity-60">{c.priority === 2 ? '²' : '³'}</span>}
                      </span>
                    )) : <span className="text-xs text-warning">none recorded</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                  {teacher.constraints
                    ? `${teacher.constraints.max_periods_per_day}/day · ${teacher.constraints.max_periods_per_week}/wk · ${teacher.constraints.max_consecutive} in a row`
                    : <span className="text-warning">defaults</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(teacher)}>Edit</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <TeacherDialog
          teacher={editing}
          subjects={data?.subjects ?? []}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['timetable-teacher-setup'] }) }}
        />
      )}
    </div>
  )
}

function TeacherDialog({ teacher, subjects, onClose, onDone }: any) {
  const [capabilities, setCapabilities] = useState<any[]>(
    teacher.capabilities.map((c: any) => ({
      subjectId: c.subject_id, priority: c.priority,
      minClassLevel: c.min_class_level, maxClassLevel: c.max_class_level,
    })),
  )
  const c = teacher.constraints ?? {}
  const [limits, setLimits] = useState({
    maxPeriodsPerDay: c.max_periods_per_day ?? 8,
    maxPeriodsPerWeek: c.max_periods_per_week ?? 45,
    minPeriodsPerWeek: c.min_periods_per_week ?? 0,
    maxConsecutive: c.max_consecutive ?? 4,
    arrangementCapPerDay: c.arrangement_cap_per_day ?? 2,
    arrangementCapPerWeek: c.arrangement_cap_per_week ?? 6,
    exemptFromArrangements: c.exempt_from_arrangements ?? false,
  })

  const save = useMutation({
    mutationFn: async () => {
      await timetableApi.saveCapabilities(teacher.id, capabilities.filter(x => x.subjectId))
      await timetableApi.saveConstraints(teacher.id, limits)
    },
    onSuccess: () => { toast.success(`${teacher.full_name} updated`); onDone() },
    onError: (e) => toast.error(timetableError(e)),
  })

  const used = new Set(capabilities.map(x => x.subjectId))

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{teacher.full_name}</DialogTitle></DialogHeader>

        <div className="space-y-5">
          <div>
            <Label>Subjects they can take</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Main = what they teach. Can teach = comfortable covering it. Can supervise = able to
              hold the class. Ranked in that order when finding cover.
            </p>
            <div className="mt-2 space-y-1.5">
              {capabilities.map((cap, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={cap.subjectId ?? ''}
                    onValueChange={v => setCapabilities(rows => rows.map((r, x) => x === i ? { ...r, subjectId: v } : r))}
                  >
                    <SelectTrigger className="h-8 w-52 text-sm"><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      {subjects.filter((s: any) => s.id === cap.subjectId || !used.has(s.id)).map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(cap.priority)}
                    onValueChange={v => setCapabilities(rows => rows.map((r, x) => x === i ? { ...r, priority: Number(v) } : r))}
                  >
                    <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Main subject</SelectItem>
                      <SelectItem value="2">Can teach</SelectItem>
                      <SelectItem value="3">Can supervise</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" placeholder="From class" value={cap.minClassLevel ?? ''}
                    onChange={e => setCapabilities(rows => rows.map((r, x) => x === i ? { ...r, minClassLevel: e.target.value ? Number(e.target.value) : null } : r))}
                    className="h-8 w-24"
                  />
                  <Input
                    type="number" placeholder="To class" value={cap.maxClassLevel ?? ''}
                    onChange={e => setCapabilities(rows => rows.map((r, x) => x === i ? { ...r, maxClassLevel: e.target.value ? Number(e.target.value) : null } : r))}
                    className="h-8 w-24"
                  />
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setCapabilities(rows => rows.filter((_, x) => x !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              size="sm" variant="outline" className="mt-2"
              onClick={() => setCapabilities(rows => [...rows, { subjectId: '', priority: 2, minClassLevel: null, maxClassLevel: null }])}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a subject
            </Button>
          </div>

          <div>
            <Label>Teaching limits</Label>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberField label="Max per day" value={limits.maxPeriodsPerDay} onChange={v => setLimits(l => ({ ...l, maxPeriodsPerDay: v }))} />
              <NumberField label="Max per week" value={limits.maxPeriodsPerWeek} onChange={v => setLimits(l => ({ ...l, maxPeriodsPerWeek: v }))} />
              <NumberField label="Min per week" value={limits.minPeriodsPerWeek} onChange={v => setLimits(l => ({ ...l, minPeriodsPerWeek: v }))} />
              <NumberField label="Max in a row" value={limits.maxConsecutive} onChange={v => setLimits(l => ({ ...l, maxConsecutive: v }))} />
              <NumberField label="Cover per day" value={limits.arrangementCapPerDay} onChange={v => setLimits(l => ({ ...l, arrangementCapPerDay: v }))} />
              <NumberField label="Cover per week" value={limits.arrangementCapPerWeek} onChange={v => setLimits(l => ({ ...l, arrangementCapPerWeek: v }))} />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2">
              <Checkbox
                checked={limits.exemptFromArrangements}
                onChange={e => setLimits(l => ({ ...l, exemptFromArrangements: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm text-foreground">Never ask them to cover</span>
                <span className="block text-xs text-muted-foreground">For medical, senior or exam-duty staff.</span>
              </span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number" min={0} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-1 h-8"
      />
    </div>
  )
}

// ── subjects ────────────────────────────────────────────────────

const ROOM_TYPES = [
  { value: '__none__', label: 'Their own classroom' },
  { value: 'science_lab', label: 'Science lab' },
  { value: 'computer_lab', label: 'Computer lab' },
  { value: 'library', label: 'Library' },
  { value: 'ground', label: 'Ground' },
  { value: 'music_room', label: 'Music room' },
  { value: 'art_room', label: 'Art room' },
  { value: 'av_room', label: 'AV room' },
  { value: 'auditorium', label: 'Auditorium' },
]

function SubjectsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tt-subjects'], queryFn: () => timetableApi.subjects() })

  const save = useMutation({
    mutationFn: (input: { id: string; body: any }) => timetableApi.saveSubjectScheduling(input.id, input.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tt-subjects'] }) },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={4} />
  if (!data?.length) return <EmptyState title="No subjects yet" description="Import a timetable, or add subjects in settings." />

  return (
    <div>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
        Where a subject has to happen, and when it is best placed. Placement preferences are
        suggestions the generator weighs, never hard rules — a school that needs Maths first thing
        gets it more often, not always.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm" style={{ minWidth: 780 }}>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="px-3 py-2 font-medium">Scheduled</th>
              <th className="px-3 py-2 font-medium">Needs</th>
              <th className="px-3 py-2 font-medium">Prefer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((subject: any) => (
              <tr key={subject.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', subjectClasses(subject.name))}>
                    {subject.name}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{subject.periods_scheduled}</td>
                <td className="px-3 py-2">
                  <Select
                    value={subject.room_type ?? '__none__'}
                    onValueChange={v => save.mutate({ id: subject.id, body: { roomType: v === '__none__' ? null : v } })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROOM_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {([
                      ['preferMorning', 'Morning'],
                      ['avoidPeriod1', 'Not first'],
                      ['avoidPostLunch', 'Not after break'],
                      ['preferLast', 'Late in the day'],
                    ] as const).map(([key, label]) => {
                      const active = !!subject.placement?.[key]
                      return (
                        <button
                          key={key}
                          disabled={!canEdit}
                          onClick={() => save.mutate({
                            id: subject.id,
                            body: { placement: { ...(subject.placement ?? {}), [key]: !active } },
                          })}
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors disabled:opacity-50',
                            active
                              ? 'bg-primary/10 text-primary ring-primary/25'
                              : 'bg-muted text-muted-foreground ring-border hover:text-foreground',
                          )}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── weekly plan ─────────────────────────────────────────────────

function PlanTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [classId, setClassId] = useState('')

  // Unwrapped to the array, like every other holder of this key.
  // React Query caches by key alone, and two dozen components share
  // ['classes']; this one stored the whole { success, data } envelope, so
  // whichever page loaded first decided the shape everyone else got.
  // Opening Setup and then Class View crashed the latter on .find.
  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list().then((r: any) => r.data),
  })

  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id)
  }, [classes, classId])

  const { data, isLoading } = useQuery({
    queryKey: ['class-plan', classId],
    queryFn: () => timetableApi.classPlan(classId),
    enabled: !!classId,
  })

  const { data: setup } = useQuery({
    queryKey: ['timetable-teacher-setup'],
    queryFn: () => timetableApi.teacherSetup(),
  })

  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    if (data) {
      setRows(data.rows.map((r: any) => ({
        sectionId: r.section_id, subjectId: r.subject_id,
        weeklyPeriods: r.weekly_periods, doublePeriods: r.double_periods,
        teacherId: r.teacher_id,
      })))
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => timetableApi.saveClassPlan(classId, rows),
    onSuccess: () => { toast.success('Plan saved'); qc.invalidateQueries({ queryKey: ['class-plan', classId] }) },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (!classes.length) return <EmptyState title="No classes yet" />

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="plan-class" className="text-xs">Class</Label>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger id="plan-class" className="mt-1 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save plan
          </Button>
        )}
      </div>

      {isLoading || !data ? <TableSkeleton rows={6} cols={4} /> : (
        <>
          {/* Whether the maths adds up, said before generation fails. */}
          <div className="mb-4 flex flex-wrap gap-2">
            {data.sections.map((section: any) => (
              <div
                key={section.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  section.shortfall == null ? 'border-border'
                    : section.shortfall === 0 ? 'border-success/40 bg-success/5'
                    : section.shortfall > 0 ? 'border-warning/40 bg-warning/5'
                    : 'border-destructive/40 bg-destructive/5',
                )}
              >
                <span className="font-medium text-foreground">Section {section.name}</span>
                <span className="ml-2 tabular-nums text-muted-foreground">
                  {section.allocated}
                  {section.weeklyCapacity != null && ` / ${section.weeklyCapacity}`} periods
                </span>
                {section.shortfall != null && section.shortfall !== 0 && (
                  <span className={cn('ml-2 text-xs font-medium', section.shortfall > 0 ? 'text-warning' : 'text-destructive')}>
                    {section.shortfall > 0 ? `${section.shortfall} unallocated` : `${-section.shortfall} over`}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Section</th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium">Periods/week</th>
                  <th className="px-3 py-2 font-medium">Doubles</th>
                  <th className="px-3 py-2 font-medium">Teacher</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      <Select
                        value={row.sectionId ?? '__all__'}
                        onValueChange={v => setRows(rs => rs.map((r, x) => x === i ? { ...r, sectionId: v === '__all__' ? null : v } : r))}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All sections</SelectItem>
                          {data.sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={row.subjectId ?? ''}
                        onValueChange={v => setRows(rs => rs.map((r, x) => x === i ? { ...r, subjectId: v } : r))}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Subject" /></SelectTrigger>
                        <SelectContent>
                          {data.subjects.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number" min={0} value={row.weeklyPeriods}
                        onChange={e => setRows(rs => rs.map((r, x) => x === i ? { ...r, weeklyPeriods: Number(e.target.value) } : r))}
                        className="h-8 w-20" disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number" min={0} value={row.doublePeriods ?? 0}
                        onChange={e => setRows(rs => rs.map((r, x) => x === i ? { ...r, doublePeriods: Number(e.target.value) } : r))}
                        className="h-8 w-20" disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={row.teacherId ?? '__none__'}
                        onValueChange={v => setRows(rs => rs.map((r, x) => x === i ? { ...r, teacherId: v === '__none__' ? null : v } : r))}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not assigned</SelectItem>
                          {(setup?.teachers ?? []).map((t: any) => (
                            <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {canEdit && (
                        <Button size="sm" variant="ghost" onClick={() => setRows(rs => rs.filter((_, x) => x !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <Button
              size="sm" variant="outline" className="mt-3"
              onClick={() => setRows(rs => [...rs, { sectionId: null, subjectId: '', weeklyPeriods: 0, doublePeriods: 0, teacherId: null }])}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a row
            </Button>
          )}
        </>
      )}
    </div>
  )
}

// ── rooms ───────────────────────────────────────────────────────

function RoomsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tt-rooms'], queryFn: () => timetableApi.rooms() })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [roomType, setRoomType] = useState('classroom')

  const save = useMutation({
    mutationFn: () => timetableApi.saveRoom({ name, roomType }),
    onSuccess: () => {
      toast.success('Room added')
      setAdding(false); setName('')
      qc.invalidateQueries({ queryKey: ['tt-rooms'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading) return <TableSkeleton rows={4} cols={3} />

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Most classes sit in their own room, so only the shared spaces matter here — the labs, the
          ground, the library. Those are the ones that genuinely clash when five sections need them
          in the same period.
        </p>
        {canEdit && <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add</Button>}
      </div>

      {!data?.length ? (
        <EmptyState icon={DoorOpen} title="No shared rooms recorded" description="Add a computer lab or science lab if the school has one." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((room: any) => (
            <Card key={room.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{room.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROOM_TYPES.find(r => r.value === room.room_type)?.label ?? room.room_type}
                    {room.capacity_groups > 1 && ` · holds ${room.capacity_groups} groups`}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <Dialog open onOpenChange={open => !open && setAdding(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add a room</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="room-name">Name</Label>
                <Input id="room-name" value={name} onChange={e => setName(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="room-type">Type</Label>
                <Select value={roomType} onValueChange={setRoomType}>
                  <SelectTrigger id="room-type" className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classroom">Classroom</SelectItem>
                    {ROOM_TYPES.filter(r => r.value !== '__none__').map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── rules ───────────────────────────────────────────────────────

function RulesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tt-settings'], queryFn: () => timetableApi.settings() })
  const [form, setForm] = useState<any>(null)

  useEffect(() => {
    if (data && !form) {
      setForm({
        ackReminderMinutes: data.ack_reminder_minutes,
        ackEscalateMinutes: data.ack_escalate_minutes,
        bookingLeadHours: data.booking_lead_hours,
        bookingWeeklyCap: data.booking_weekly_cap,
        workingDays: data.working_days,
        enforceMaxConsecutive: data.enforce_max_consecutive,
        autoDetectAbsence: data.auto_detect_absence,
        longAbsenceThresholdDays: data.long_absence_threshold_days,
      })
    }
  }, [data, form])

  const save = useMutation({
    mutationFn: () => timetableApi.saveSettings(form),
    onSuccess: () => { toast.success('Rules saved'); qc.invalidateQueries({ queryKey: ['tt-settings'] }) },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading || !form) return <TableSkeleton rows={5} cols={2} />

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }))

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Working days</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6].map(day => {
              const on = form.workingDays.includes(day)
              return (
                <button
                  key={day}
                  disabled={!canEdit}
                  onClick={() => set({
                    workingDays: on
                      ? form.workingDays.filter((d: number) => d !== day)
                      : [...form.workingDays, day].sort(),
                  })}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  {DAY_NAMES[day].slice(0, 3)}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Chasing cover</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How long to wait before reminding a substitute, and before telling the manager and
            principal that nobody has answered.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField label="Remind after (minutes)" value={form.ackReminderMinutes} onChange={v => set({ ackReminderMinutes: v })} />
            <NumberField label="Escalate after (minutes)" value={form.ackEscalateMinutes} onChange={v => set({ ackEscalateMinutes: v })} />
          </div>
          {form.ackEscalateMinutes <= form.ackReminderMinutes && (
            <p className="mt-2 text-xs text-destructive">
              Escalation must come after the reminder, or the manager is told before the teacher has been chased.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Teachers reserving free periods</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A reserved period is never given a regular class, and is only used for cover as an
            absolute last resort — and then only by someone with permission to override it. The
            notice period stops a teacher reserving a period reactively once they can see an absence
            coming.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField label="Notice needed (hours)" value={form.bookingLeadHours} onChange={v => set({ bookingLeadHours: v })} />
            <NumberField label="Max reserved per week" value={form.bookingWeeklyCap} onChange={v => set({ bookingWeeklyCap: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-foreground">Other</h3>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox checked={form.autoDetectAbsence} onChange={e => set({ autoDetectAbsence: e.target.checked })} disabled={!canEdit} className="mt-0.5" />
            <span>
              <span className="block text-sm text-foreground">Flag teachers who have not checked in</span>
              <span className="block text-xs text-muted-foreground">
                Cross-checks staff attendance against today's timetable and proposes an absence.
                Always a proposal — never confirmed automatically.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox checked={form.enforceMaxConsecutive} onChange={e => set({ enforceMaxConsecutive: e.target.checked })} disabled={!canEdit} className="mt-0.5" />
            <span>
              <span className="block text-sm text-foreground">Treat too many periods in a row as an error, not a warning</span>
              <span className="block text-xs text-muted-foreground">
                Schools differ. Leave this off if the timetable already runs long stretches.
              </span>
            </span>
          </label>
          <div className="max-w-xs">
            <NumberField
              label="Redistribute after this many days away"
              value={form.longAbsenceThresholdDays}
              onChange={v => set({ longAbsenceThresholdDays: v })}
            />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save rules
        </Button>
      )}
    </div>
  )
}
