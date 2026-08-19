'use client'
import { Fragment, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, Check, Copy, Grid3x3, Loader2, Lock, Printer, X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

import { timetableApi, timetableError } from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton, subjectClasses } from '../components'
import { DAYS, DAY_SHORT } from '../shared'
import { CellEditor } from './CellEditor'
import { PrintSheets } from './PrintSheets'

// ═══════════════════════════════════════════════════════════════
// The block view — every class's week, in one place
// ═══════════════════════════════════════════════════════════════
//
// The wall grid answers "what is 6B doing on Tuesday". This answers "is
// this timetable any good", which is a question about all of it at once
// and is asked of a draft at least as often as of the live one. So the
// same screen reads both, carries the summary and the conflicts at the
// top where they are seen before anything else, and prints the lot.
//
// The live timetable is deliberately read-only here. It is what the
// whole school is working from this minute; editing it in place changes
// what a teacher is looking at mid-glance, with no version behind it.
// The edit button copies it to a draft instead — conflicts and summary
// update as you go, and publishing snapshots what it replaced.

const fmt = (t?: string | null) => (t ? t.slice(0, 5) : '')

export default function BlockViewPage() {
  const qc = useQueryClient()
  const { can, isLoading: permsLoading } = usePermissions()
  const [versionId, setVersionId] = useState<string>('active')
  const [layout, setLayout] = useState<'day' | 'week' | 'class' | 'teachers' | 'teacher'>('week')
  const [day, setDay] = useState(1)
  const [editing, setEditing] = useState<any>(null)
  const [showConflicts, setShowConflicts] = useState(true)

  const canEdit = can('timetable.manage')

  const versions = useQuery({
    queryKey: ['tt-versions'],
    queryFn: () => timetableApi.versions(),
    enabled: !permsLoading,
  })

  const block = useQuery({
    queryKey: ['tt-block', versionId],
    queryFn: () => timetableApi.block(versionId === 'active' ? null : versionId),
    enabled: !permsLoading,
  })

  const clone = useMutation({
    mutationFn: () => timetableApi.cloneActive(),
    onSuccess: (r: any) => {
      toast.success(`Copied to "${r.label}" — ${r.rowsCopied} periods. Edit freely; nothing is live until you publish.`)
      setVersionId(r.versionId)
      qc.invalidateQueries({ queryKey: ['tt-versions'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const data: any = block.data
  const isDraft = data?.source === 'draft'
  const editable = isDraft && canEdit

  const drafts = (versions.data ?? []).filter((v: any) => v.status === 'draft')

  // Which cells a conflict touches, so the grid can mark them — and
  // which EMPTY slots, since a gap has no cell to point at and would
  // otherwise be listed but invisible in the grid you opened to find it.
  const flagged = useMemo(() => {
    const map = new Map<string, 'block' | 'warn'>()
    for (const c of data?.conflicts ?? []) {
      for (const id of c.cellIds ?? []) {
        if (c.severity === 'block' || !map.has(id)) map.set(id, c.severity)
      }
    }
    return map
  }, [data])

  const flaggedSlots = useMemo(() => {
    const map = new Map<string, 'block' | 'warn'>()
    for (const c of data?.conflicts ?? []) {
      for (const key of c.slotKeys ?? []) {
        if (c.severity === 'block' || !map.has(key)) map.set(key, c.severity)
      }
    }
    return map
  }, [data])

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>
  if (!can('timetable.view')) {
    return <div className="p-6"><EmptyState icon={AlertTriangle} title="You don't have access to the timetable" /></div>
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Chrome is hidden when printing — see PrintSheets. */}
      <div className="print:hidden">
        <PageHeader
          title="Block view"
          description="Every class's week at once — check it over, then print the lot."
          icon={Grid3x3}
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={versionId} onValueChange={v => { setVersionId(v); setEditing(null) }}>
            <SelectTrigger className="w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Live timetable</SelectItem>
              {drafts.map((v: any) => (
                <SelectItem key={v.id} value={v.id}>Draft — {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap overflow-hidden rounded-lg border border-border">
            {([
              ['week', 'All classes, whole week'],
              ['day', 'All classes, one day'],
              ['teachers', 'All teachers, whole week'],
              ['class', 'One class, whole week'],
              ['teacher', 'One teacher, whole week'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setLayout(mode)}
                className={cn('px-3 py-1.5 text-sm transition-colors',
                  layout === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {label}
              </button>
            ))}
          </div>

          {layout === 'day' && data?.days?.length > 0 && (
            <Select value={String(day)} onValueChange={v => setDay(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.days.map((d: number) => (
                  <SelectItem key={d} value={String(d)}>{DAY_SHORT[d - 1] ?? `Day ${d}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            {!isDraft && canEdit && (
              <Button variant="outline" onClick={() => clone.mutate()} disabled={clone.isPending}>
                {clone.isPending
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <Copy className="mr-1.5 h-4 w-4" />}
                Make a copy to edit
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>
              <Printer className="mr-1.5 h-4 w-4" />
              {layout === 'teachers' || layout === 'teacher' ? 'Print all teachers' : 'Print all classes'}
            </Button>
          </div>
        </div>

        {block.isLoading ? (
          <TableSkeleton rows={10} cols={6} />
        ) : block.error ? (
          <Banner tone="bad" title="Could not load the timetable">{timetableError(block.error)}</Banner>
        ) : !data?.sections?.length ? (
          <EmptyState icon={Grid3x3} title="Nothing to show"
            description="This timetable has no periods in it yet." />
        ) : (
          <>
            <SummaryStrip data={data} isDraft={isDraft} editable={editable} />

            {data.conflicts.length > 0 && (
              <ConflictPanel
                conflicts={data.conflicts}
                open={showConflicts}
                onToggle={() => setShowConflicts(v => !v)}
              />
            )}

            {!isDraft && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                This is the live timetable and is read-only. Make a copy to change anything.
              </p>
            )}

            {layout === 'week' && (
              <WeekBlock data={data} flagged={flagged} flaggedSlots={flaggedSlots}
                editable={editable} onEdit={setEditing} />
            )}
            {layout === 'day' && (
              <DayBlock data={data} day={day} flagged={flagged} flaggedSlots={flaggedSlots}
                editable={editable} onEdit={setEditing} />
            )}
            {layout === 'teachers' && (
              <TeacherBlock data={data} flagged={flagged} editable={editable} onEdit={setEditing} />
            )}
            {layout === 'class' && (
              <ClassWeeks data={data} flagged={flagged} flaggedSlots={flaggedSlots}
                editable={editable} onEdit={setEditing} />
            )}
            {layout === 'teacher' && (
              <TeacherWeek data={data} flagged={flagged} editable={editable} onEdit={setEditing} />
            )}
          </>
        )}
      </div>

      {/* The printable artefact: one class per page, whole week. */}
      {data && <PrintSheets data={data} mode={layout === 'teachers' || layout === 'teacher' ? 'teacher' : 'class'} />}

      {editing && editable && (
        <CellEditor
          versionId={versionId}
          cell={editing}
          data={data}
          open
          onOpenChange={(o: boolean) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['tt-block', versionId] })
          }}
        />
      )}
    </div>
  )
}

// ── summary ─────────────────────────────────────────────────────

function SummaryStrip({ data, isDraft, editable }: { data: any; isDraft: boolean; editable: boolean }) {
  const s = data.summary
  const stat = (label: string, value: any, tone?: 'bad' | 'warn' | 'good') => (
    <div key={label} className="min-w-[86px]">
      <p className={cn('text-xl font-bold tabular-nums leading-none',
        tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-warning'
          : tone === 'good' ? 'text-success' : 'text-foreground')}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            {data.version?.label ?? 'Timetable'}
          </p>
          <Chip tone={isDraft ? 'info' : 'good'}>{isDraft ? 'draft' : 'live'}</Chip>
          {data.version?.origin && <Chip>{data.version.origin}</Chip>}
          {editable && <Chip tone="info">editable</Chip>}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {stat('Classes', s.sections)}
          {stat('Days', s.days)}
          {stat('Periods placed', s.periodsPlaced)}
          {stat('Teachers used', s.teachers)}
          {stat('Subjects', s.subjects)}
          {stat('Teacher clashes', s.teacherClashes, s.teacherClashes ? 'bad' : 'good')}
          {stat('Room clashes', s.roomClashes, s.roomClashes ? 'bad' : 'good')}
          {stat('Unstaffed', s.unstaffed, s.unstaffed ? 'warn' : 'good')}
          {stat('Empty slots', s.gaps, s.gaps ? 'warn' : 'good')}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {s.blocking === 0 && s.warnings === 0
            ? 'No problems found anywhere in this timetable.'
            : `${s.blocking} thing${s.blocking === 1 ? '' : 's'} that must be fixed, ${s.warnings} worth a look.`}
        </p>
      </CardContent>
    </Card>
  )
}

// ── conflicts ───────────────────────────────────────────────────

function ConflictPanel({ conflicts, open, onToggle }: { conflicts: any[]; open: boolean; onToggle: () => void }) {
  const blocking = conflicts.filter(c => c.severity === 'block')
  const warnings = conflicts.filter(c => c.severity === 'warn')

  return (
    <Card className={cn('mb-4', blocking.length ? 'border-destructive/40' : 'border-warning/40')}>
      <CardContent className="p-4">
        <button onClick={onToggle} className="flex w-full items-center gap-2 text-left">
          <AlertTriangle className={cn('h-4 w-4', blocking.length ? 'text-destructive' : 'text-warning')} />
          <span className="text-sm font-semibold text-foreground">
            {blocking.length > 0
              ? `${blocking.length} problem${blocking.length === 1 ? '' : 's'} to fix`
              : `${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look`}
            {blocking.length > 0 && warnings.length > 0 && `, and ${warnings.length} worth a look`}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{open ? 'hide' : 'show'}</span>
        </button>

        {open && (
          // Every problem, not the first forty. A list that says "and 58
          // more" is a list that has decided which of your problems you
          // are allowed to see; it scrolls instead, and the count in the
          // header always matches what is in the box.
          <div className="mt-3 max-h-80 overflow-y-auto pr-1">
            <ul className="space-y-1.5">
              {[...blocking, ...warnings].map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    c.severity === 'block' ? 'bg-destructive' : 'bg-warning')} />
                  <span className="text-muted-foreground">{c.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── all classes, one day ────────────────────────────────────────

function DayBlock({ data, day, flagged, flaggedSlots, editable, onEdit }: {
  data: any; day: number; flagged: Map<string, string>; flaggedSlots: Map<string, string>
  editable: boolean; onEdit: (c: any) => void
}) {
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 900 }}>
        <thead className="bg-muted/50">
          <tr>
            <th className="sticky left-0 z-10 border-b border-border bg-muted/50 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Class
            </th>
            {teaching.map((slot: any) => (
              <th key={slot.periodNumber}
                className="border-b border-l border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                <div className="uppercase tracking-wide">P{slot.periodNumber}</div>
                <div className="font-normal normal-case">{fmt(slot.startTime)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.sections.map((section: any) => (
            <tr key={section.sectionId}>
              <td className="sticky left-0 z-10 border-b border-border bg-background px-3 py-2 text-sm font-medium text-foreground">
                {section.label}
              </td>
              {teaching.map((slot: any) => {
                const key = `${section.sectionId}:${day}:${slot.periodNumber}`
                return (
                  <Cell key={slot.periodNumber} cell={data.cells[key]} flagged={flagged}
                    slotSeverity={flaggedSlots.get(key)}
                    editable={editable} onEdit={onEdit} compact />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── one class, whole week ───────────────────────────────────────

function ClassWeeks({ data, flagged, flaggedSlots, editable, onEdit }: {
  data: any; flagged: Map<string, string>; flaggedSlots: Map<string, string>
  editable: boolean; onEdit: (c: any) => void
}) {
  const [sectionId, setSectionId] = useState<string>(data.sections[0]?.sectionId ?? '')
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  return (
    <div className="space-y-3">
      <Select value={sectionId} onValueChange={setSectionId}>
        <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {data.sections.map((s: any) => (
            <SelectItem key={s.sectionId} value={s.sectionId}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 720 }}>
          <thead className="bg-muted/50">
            <tr>
              <th className="border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Period
              </th>
              {data.days.map((d: number) => (
                <th key={d} className="border-b border-l border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {DAY_SHORT[d - 1] ?? `Day ${d}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teaching.map((slot: any) => (
              <tr key={slot.periodNumber}>
                <td className="border-b border-border px-3 py-2 align-top">
                  <div className="text-sm font-medium text-foreground">{slot.periodNumber}</div>
                  <div className="text-[11px] text-muted-foreground">{fmt(slot.startTime)}–{fmt(slot.endTime)}</div>
                </td>
                {data.days.map((d: number) => {
                  const key = `${sectionId}:${d}:${slot.periodNumber}`
                  return <Cell key={d} cell={data.cells[key]} flagged={flagged}
                    slotSeverity={flaggedSlots.get(key)} editable={editable} onEdit={onEdit} />
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ── all classes, whole week ─────────────────────────────────────
//
// The master sheet. Rows are a time — day then period — and columns are
// classes, so a row is a snapshot of the whole school at one moment and
// a clash is two cells in the same row naming the same teacher. Reading
// down is one class's day; reading across is "who is where, right now",
// which is the question the office actually asks.

function WeekBlock({ data, flagged, flaggedSlots, editable, onEdit }: {
  data: any; flagged: Map<string, string>; flaggedSlots: Map<string, string>
  editable: boolean; onEdit: (c: any) => void
}) {
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  return (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: '75vh' }}>
      <table className="w-full border-collapse text-sm" style={{ minWidth: Math.max(760, data.sections.length * 108 + 90) }}>
        <thead className="sticky top-0 z-20 bg-muted">
          <tr>
            <th className="sticky left-0 z-30 border-b border-r border-border bg-muted px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Time
            </th>
            {data.sections.map((s: any) => (
              <th key={s.sectionId}
                className="border-b border-l border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((day: number) => (
            <Fragment key={day}>
              <tr>
                <td colSpan={data.sections.length + 1}
                  className="sticky left-0 border-y border-border bg-accent/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                  {DAYS[day - 1] ?? `Day ${day}`}
                </td>
              </tr>
              {teaching.map((slot: any) => (
                <tr key={`${day}:${slot.periodNumber}`}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-background px-2 py-1.5 align-top">
                    <div className="text-xs font-semibold text-foreground">P{slot.periodNumber}</div>
                    <div className="text-[10px] text-muted-foreground">{fmt(slot.startTime)}</div>
                  </td>
                  {data.sections.map((section: any) => {
                    const key = `${section.sectionId}:${day}:${slot.periodNumber}`
                    return (
                      <Cell key={section.sectionId} cell={data.cells[key]} flagged={flagged}
                        slotSeverity={flaggedSlots.get(key)}
                        editable={editable} onEdit={onEdit} compact />
                    )
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Both teacher views read this. One pivot, so the single-teacher sheet
// and the all-teachers grid can never disagree about who is where.
function pivotByTeacher(data: any) {
  const names = new Map<string, string>()
  const index = new Map<string, any[]>()
  const load = new Map<string, number>()
  for (const cell of Object.values(data.cells) as any[]) {
    if (cell.isBreak || !cell.teacherId) continue
    names.set(cell.teacherId, cell.teacherName ?? 'Unknown')
    const key = `${cell.teacherId}:${cell.dayOfWeek}:${cell.periodNumber}`
    index.set(key, [...(index.get(key) ?? []), cell])
    load.set(cell.teacherId, (load.get(cell.teacherId) ?? 0) + 1)
  }
  return {
    teachers: Array.from(names.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    index, load,
  }
}

// ── one teacher, whole week ─────────────────────────────────────
//
// What gets handed to the teacher, and what you look at before asking
// them to cover something. Free periods are left visibly blank: on this
// sheet the gaps are the information.

function TeacherWeek({ data, flagged, editable, onEdit }: {
  data: any; flagged: Map<string, string>; editable: boolean; onEdit: (c: any) => void
}) {
  const { teachers, index, load } = useMemo(() => pivotByTeacher(data), [data])
  const [teacherId, setTeacherId] = useState<string>(teachers[0]?.id ?? '')
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  if (!teachers.length) {
    return <Banner tone="warn" title="Nobody is assigned to any period in this timetable" />
  }

  const chosen = teachers.find(t => t.id === teacherId) ?? teachers[0]
  const mine = teaching.length * data.days.length
  const taught = load.get(chosen.id) ?? 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={chosen.id} onValueChange={setTeacherId}>
          <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {teachers.map(t => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} · {load.get(t.id) ?? 0}/wk
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Chip>{taught} periods a week</Chip>
        <Chip tone={mine - taught > 0 ? 'info' : 'neutral'}>{mine - taught} free</Chip>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 720 }}>
          <thead className="bg-muted/50">
            <tr>
              <th className="border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Period
              </th>
              {data.days.map((d: number) => (
                <th key={d} className="border-b border-l border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {DAY_SHORT[d - 1] ?? `Day ${d}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teaching.map((slot: any) => (
              <tr key={slot.periodNumber}>
                <td className="border-b border-border px-3 py-2 align-top">
                  <div className="text-sm font-medium text-foreground">{slot.periodNumber}</div>
                  <div className="text-[11px] text-muted-foreground">{fmt(slot.startTime)}–{fmt(slot.endTime)}</div>
                </td>
                {data.days.map((d: number) => {
                  const here = index.get(`${chosen.id}:${d}:${slot.periodNumber}`) ?? []
                  const clash = here.length > 1
                  return (
                    <td key={d} className="border-b border-l border-border p-1.5 align-top">
                      {!here.length ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground/50">free</div>
                      ) : (
                        <div className="space-y-1">
                          {here.map((cell: any) => (
                            <button
                              key={cell.id}
                              onClick={() => editable && onEdit(cell)}
                              disabled={!editable}
                              className={cn('block w-full rounded-md px-2 py-1.5 text-left',
                                clash || flagged.get(cell.id) === 'block'
                                  ? 'bg-destructive/10 ring-1 ring-inset ring-destructive/40'
                                  : subjectClasses(cell.subjectName),
                                editable && 'hover:opacity-80')}
                            >
                              <span className="block text-xs font-semibold">{cell.sectionLabel}</span>
                              <span className="block text-[11px] opacity-80">{cell.subjectName}</span>
                              {cell.roomName && <span className="block text-[10px] opacity-60">{cell.roomName}</span>}
                            </button>
                          ))}
                          {clash && (
                            <div className="flex items-center gap-1 text-[10px] font-semibold text-destructive">
                              <AlertTriangle className="h-3 w-3" /> two classes at once
                            </div>
                          )}
                        </div>
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
  )
}

// ── all teachers, whole week ────────────────────────────────────
//
// The same grid pivoted onto the people rather than the classes, which
// is what a timetable manager is actually looking at when they ask "can
// Sunita take period 4". Built from the same payload — a cell already
// names its teacher and its class — so it cannot disagree with the
// class view about who is where.
//
// A blank is a free period and is left blank on purpose: the whole value
// of this view is that the gaps are the answer. Where a teacher somehow
// has two lessons in one slot, both are shown stacked and marked, since
// hiding one would hide the very thing that makes it a clash.

function TeacherBlock({ data, flagged, editable, onEdit }: {
  data: any; flagged: Map<string, string>; editable: boolean; onEdit: (c: any) => void
}) {
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  const { teachers, index: byTeacherSlot, load } = useMemo(() => pivotByTeacher(data), [data])

  if (!teachers.length) {
    return <Banner tone="warn" title="Nobody is assigned to any period in this timetable" />
  }

  return (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: '75vh' }}>
      <table className="w-full border-collapse text-sm" style={{ minWidth: Math.max(760, teachers.length * 112 + 90) }}>
        <thead className="sticky top-0 z-20 bg-muted">
          <tr>
            <th className="sticky left-0 z-30 border-b border-r border-border bg-muted px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Time
            </th>
            {teachers.map(t => (
              <th key={t.id}
                className="border-b border-l border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                <div className="text-foreground">{t.name}</div>
                <div className="font-normal">{load.get(t.id) ?? 0}/wk</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((day: number) => (
            <Fragment key={day}>
              <tr>
                <td colSpan={teachers.length + 1}
                  className="sticky left-0 border-y border-border bg-accent/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                  {DAYS[day - 1] ?? `Day ${day}`}
                </td>
              </tr>
              {teaching.map((slot: any) => (
                <tr key={`${day}:${slot.periodNumber}`}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-background px-2 py-1.5 align-top">
                    <div className="text-xs font-semibold text-foreground">P{slot.periodNumber}</div>
                    <div className="text-[10px] text-muted-foreground">{fmt(slot.startTime)}</div>
                  </td>
                  {teachers.map(t => {
                    const here = byTeacherSlot.get(`${t.id}:${day}:${slot.periodNumber}`) ?? []
                    const clash = here.length > 1
                    return (
                      <td key={t.id} className="border-b border-l border-border p-1 align-top">
                        {here.length === 0 ? (
                          <div className="px-1 py-1 text-[10px] text-muted-foreground/40">free</div>
                        ) : (
                          <div className="space-y-0.5">
                            {here.map((cell: any) => (
                              <button
                                key={cell.id}
                                onClick={() => editable && onEdit(cell)}
                                disabled={!editable}
                                className={cn('block w-full rounded-md px-1.5 py-1 text-left',
                                  clash || flagged.get(cell.id) === 'block'
                                    ? 'bg-destructive/10 ring-1 ring-inset ring-destructive/40'
                                    : subjectClasses(cell.subjectName),
                                  editable && 'hover:opacity-80')}
                                title={`${cell.sectionLabel} · ${cell.subjectName}`}
                              >
                                <span className="block text-[11px] font-semibold">{cell.sectionLabel}</span>
                                <span className="block text-[10px] opacity-80">{cell.subjectName}</span>
                              </button>
                            ))}
                            {clash && (
                              <div className="flex items-center gap-1 text-[10px] font-semibold text-destructive">
                                <AlertTriangle className="h-3 w-3" /> two at once
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── a cell ──────────────────────────────────────────────────────

function Cell({ cell, flagged, slotSeverity, editable, onEdit, compact }: {
  cell: any; flagged: Map<string, string>; slotSeverity?: string
  editable: boolean; onEdit: (c: any) => void; compact?: boolean
}) {
  if (!cell) {
    // An empty slot is only a fault if the day carries on past it; the
    // server decides that, and says so through slotKeys.
    return (
      <td className="border-b border-l border-border p-1.5 align-top">
        <div className={cn('rounded-md px-1.5 py-1 text-xs',
          slotSeverity
            ? 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/30'
            : 'text-muted-foreground/50')}
          title={slotSeverity ? 'Nothing scheduled, but the day continues' : undefined}>
          {slotSeverity ? 'empty' : '—'}
        </div>
      </td>
    )
  }

  const severity = flagged.get(cell.id)
  const body = (
    <div className={cn('rounded-md px-1.5 py-1',
      severity === 'block' ? 'bg-destructive/10 ring-1 ring-inset ring-destructive/40'
        : severity === 'warn' ? 'bg-warning/10 ring-1 ring-inset ring-warning/30'
        : cell.isBreak ? 'bg-muted text-muted-foreground'
        : subjectClasses(cell.subjectName))}>
      <div className="flex items-start gap-1">
        {severity === 'block' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
        <span className={cn('min-w-0 break-words font-medium', compact ? 'text-[11px]' : 'text-xs')}>
          {cell.subjectName || '—'}
        </span>
      </div>
      {cell.teacherName && (
        <div className={cn('opacity-80', compact ? 'text-[10px]' : 'text-[11px]')}>{cell.teacherName}</div>
      )}
      {!cell.teacherName && !cell.isBreak && (
        <div className="text-[10px] font-medium text-destructive">nobody assigned</div>
      )}
    </div>
  )

  return (
    <td className="border-b border-l border-border p-1.5 align-top">
      {editable && !cell.isBreak ? (
        <button onClick={() => onEdit(cell)} className="w-full text-left hover:opacity-80">
          {body}
        </button>
      ) : body}
    </td>
  )
}
