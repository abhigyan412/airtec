'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { timetableApi, timetableError } from '@/lib/timetableApi'

import { Banner, Chip, subjectClasses } from '../components'
import { DAYS } from '../shared'

// ═══════════════════════════════════════════════════════════════
// Editing a day
// ═══════════════════════════════════════════════════════════════
//
// The grids are for reading. This is for changing: one class, one day,
// its periods as a list, each with what is taught and who teaches it,
// saved as you go. Rearranging a day is the commonest edit a school
// makes — a subject swapped out, a teacher changed — and doing it by
// opening a dialog on each cell of a 60-column grid is the slow way.
//
// Beside it, what the change costs. The weekly plan says how many
// periods of each subject a class should get; changing a subject in a
// day quietly moves those counts, and without seeing it you find out
// weeks later that Maths is a period short. Scheduled against planned,
// live, as you edit.

const fmt = (t?: string | null) => (t ? t.slice(0, 5) : '')

export function DayEditor({ data, versionId, editable, onChanged }: {
  data: any
  versionId: string
  editable: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [sectionId, setSectionId] = useState<string>(data.sections[0]?.sectionId ?? '')
  const [day, setDay] = useState<number>(data.days[0] ?? 1)

  const section = data.sections.find((s: any) => s.sectionId === sectionId) ?? data.sections[0]
  const teaching = data.slots.filter((s: any) => !s.isBreak)

  const subjects = useQuery({
    queryKey: ['tt-subjects'],
    queryFn: () => timetableApi.subjects(),
  })

  const teachers = useQuery({
    queryKey: ['tt-teacher-setup'],
    queryFn: () => timetableApi.teacherSetup(),
  })

  const plan = useQuery({
    queryKey: ['tt-plan', section?.classId],
    queryFn: () => timetableApi.classPlan(section.classId),
    enabled: !!section?.classId,
  })

  // Scheduled this week for this section, per subject.
  const scheduled = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [key, cell] of Object.entries(data.cells) as [string, any][]) {
      if (!key.startsWith(`${sectionId}:`)) continue
      if (cell.isBreak || !cell.subjectName) continue
      counts.set(cell.subjectName, (counts.get(cell.subjectName) ?? 0) + 1)
    }
    return counts
  }, [data, sectionId])

  // Planned, for this section. getClassPlan answers
  // { classId, sections, subjects, rows } — the allocations are in rows,
  // and a row with a null section_id is a class-wide allocation that
  // applies to every section of the class.
  //
  // Array.isArray rather than a bare ?? default: reading a shape that
  // turned out not to be a list is what crashed this component once
  // already, and rendering an empty tally beats taking the page down.
  const planned = useMemo(() => {
    const counts = new Map<string, number>()
    const rows = Array.isArray(plan.data?.rows) ? plan.data.rows : []
    for (const item of rows as any[]) {
      if (item.section_id && item.section_id !== sectionId) continue
      const name = item.subject_name
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + (item.weekly_periods ?? 0))
    }
    return counts
  }, [plan.data, sectionId])

  // What the plan says about this section as a whole: how many teaching
  // periods its week actually has, and how many are spoken for.
  const sectionPlan = useMemo(() => {
    const list = Array.isArray(plan.data?.sections) ? plan.data.sections : []
    return (list as any[]).find(s => s.id === sectionId) ?? null
  }, [plan.data, sectionId])

  const tally = useMemo(() => {
    const names = new Set([...Array.from(scheduled.keys()), ...Array.from(planned.keys())])
    return Array.from(names).map(name => ({
      name,
      scheduled: scheduled.get(name) ?? 0,
      planned: planned.get(name) ?? 0,
    })).sort((a, b) => (b.scheduled - b.planned) - (a.scheduled - a.planned) || a.name.localeCompare(b.name))
  }, [scheduled, planned])

  const save = useMutation({
    mutationFn: (args: { cellId: string; patch: any }) =>
      timetableApi.updateDraftCell(versionId, args.cellId, args.patch),
    onSuccess: (r: any) => {
      for (const w of r?.warnings ?? []) toast.warning(w)
      qc.invalidateQueries({ queryKey: ['tt-block', versionId] })
      onChanged()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (!section) return <Banner tone="warn" title="No classes in this timetable" />

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.sections.map((s: any) => (
                <SelectItem key={s.sectionId} value={s.sectionId}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(day)} onValueChange={v => setDay(Number(v))}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.days.map((d: number) => (
                <SelectItem key={d} value={String(d)}>{DAYS[d - 1] ?? `Day ${d}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!editable && (
            <span className="text-xs text-muted-foreground">
              Read-only — this is the live timetable. Make a copy to change it.
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          {teaching.map((slot: any) => {
            const cell = data.cells[`${sectionId}:${day}:${slot.periodNumber}`]
            return (
              <PeriodRow
                key={slot.periodNumber}
                slot={slot}
                cell={cell}
                editable={editable}
                subjects={subjects.data ?? []}
                teachers={teachers.data?.teachers ?? []}
                saving={save.isPending}
                onSave={(patch) => cell && save.mutate({ cellId: cell.id, patch })}
              />
            )
          })}
        </div>
      </div>

      <Card className="h-fit">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground">This week, against the plan</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{section.label}</p>

          {sectionPlan?.weeklyCapacity != null && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>{sectionPlan.allocated ?? 0} of {sectionPlan.weeklyCapacity} allocated</Chip>
              {typeof sectionPlan.shortfall === 'number' && sectionPlan.shortfall !== 0 && (
                <Chip tone={sectionPlan.shortfall > 0 ? 'warn' : 'bad'}>
                  {sectionPlan.shortfall > 0
                    ? `${sectionPlan.shortfall} unallocated`
                    : `${Math.abs(sectionPlan.shortfall)} over capacity`}
                </Chip>
              )}
            </div>
          )}

          {plan.isLoading ? (
            <p className="mt-3 text-xs text-muted-foreground">Loading the plan…</p>
          ) : !tally.length ? (
            <p className="mt-3 text-xs text-muted-foreground">Nothing scheduled or planned.</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {tally.map(row => {
                const delta = row.scheduled - row.planned
                const off = row.planned > 0 && delta !== 0
                return (
                  <li key={row.name} className="flex items-center gap-2 text-xs">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full',
                      off ? (delta > 0 ? 'bg-warning' : 'bg-destructive') : 'bg-success')} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{row.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.scheduled}
                      {row.planned > 0 && <span className="opacity-60">/{row.planned}</span>}
                    </span>
                    {off && (
                      <span className={cn('w-8 text-right font-medium tabular-nums',
                        delta > 0 ? 'text-warning' : 'text-destructive')}>
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            A subject with no planned figure isn't in the weekly plan — that isn't wrong, it just
            means nobody set a target for it.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PeriodRow({ slot, cell, editable, subjects, teachers, saving, onSave }: {
  slot: any
  cell: any
  editable: boolean
  subjects: any[]
  teachers: any[]
  saving: boolean
  onSave: (patch: any) => void
}) {
  const [subjectId, setSubjectId] = useState<string>(cell?.subjectId ?? 'none')
  const [teacherId, setTeacherId] = useState<string>(cell?.teacherId ?? 'none')

  // The row is keyed by slot, so switching class or day remounts it and
  // these reset with it rather than showing the previous day's values.
  const dirty = cell && (subjectId !== (cell.subjectId ?? 'none') || teacherId !== (cell.teacherId ?? 'none'))

  if (!cell) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2">
        <div className="w-16 shrink-0">
          <div className="text-sm font-semibold text-foreground">P{slot.periodNumber}</div>
          <div className="text-[11px] text-muted-foreground">{fmt(slot.startTime)}</div>
        </div>
        <span className="text-xs text-muted-foreground">Nothing scheduled</span>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
      dirty ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <div className="w-16 shrink-0">
        <div className="text-sm font-semibold text-foreground">P{slot.periodNumber}</div>
        <div className="text-[11px] text-muted-foreground">{fmt(slot.startTime)}</div>
      </div>

      {editable ? (
        <>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nothing (free)</SelectItem>
              {subjects.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody</SelectItem>
              {teachers.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {dirty && (
            <button
              onClick={() => onSave({
                subjectId: subjectId === 'none' ? null : subjectId,
                teacherId: teacherId === 'none' ? null : teacherId,
              })}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
          )}
        </>
      ) : (
        <>
          <span className={cn('rounded-md px-2 py-1 text-xs font-medium', subjectClasses(cell.subjectName))}>
            {cell.subjectName || '—'}
          </span>
          <span className="text-sm text-muted-foreground">{cell.teacherName ?? 'nobody assigned'}</span>
        </>
      )}

      {!cell.teacherName && (
        <span className="flex items-center gap-1 text-[11px] font-medium text-destructive">
          <AlertTriangle className="h-3 w-3" /> nobody assigned
        </span>
      )}
      {cell.roomName && <Chip>{cell.roomName}</Chip>}
    </div>
  )
}
