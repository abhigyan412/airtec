'use client'
import { useMemo, useState } from 'react'
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
import { DAY_SHORT } from '../shared'
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
  const [layout, setLayout] = useState<'day' | 'class'>('day')
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

  // Which cells a conflict touches, so the grid can mark them.
  const flagged = useMemo(() => {
    const map = new Map<string, 'block' | 'warn'>()
    for (const c of data?.conflicts ?? []) {
      for (const id of c.cellIds ?? []) {
        if (c.severity === 'block' || !map.has(id)) map.set(id, c.severity)
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

          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['day', 'class'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setLayout(mode)}
                className={cn('px-3 py-1.5 text-sm transition-colors',
                  layout === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {mode === 'day' ? 'All classes, one day' : 'One class, whole week'}
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
              <Printer className="mr-1.5 h-4 w-4" /> Print all classes
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

            {layout === 'day'
              ? <DayBlock data={data} day={day} flagged={flagged} editable={editable}
                  onEdit={setEditing} />
              : <ClassWeeks data={data} flagged={flagged} editable={editable} onEdit={setEditing} />}
          </>
        )}
      </div>

      {/* The printable artefact: one class per page, whole week. */}
      {data && <PrintSheets data={data} />}

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
          <ul className="mt-3 space-y-1.5">
            {[...blocking, ...warnings].slice(0, 40).map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  c.severity === 'block' ? 'bg-destructive' : 'bg-warning')} />
                <span className="text-muted-foreground">{c.message}</span>
              </li>
            ))}
            {conflicts.length > 40 && (
              <li className="text-xs text-muted-foreground">…and {conflicts.length - 40} more.</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── all classes, one day ────────────────────────────────────────

function DayBlock({ data, day, flagged, editable, onEdit }: {
  data: any; day: number; flagged: Map<string, string>; editable: boolean; onEdit: (c: any) => void
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
                const cell = data.cells[`${section.sectionId}:${day}:${slot.periodNumber}`]
                return (
                  <Cell key={slot.periodNumber} cell={cell} flagged={flagged}
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

function ClassWeeks({ data, flagged, editable, onEdit }: {
  data: any; flagged: Map<string, string>; editable: boolean; onEdit: (c: any) => void
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
                  const cell = data.cells[`${sectionId}:${d}:${slot.periodNumber}`]
                  return <Cell key={d} cell={cell} flagged={flagged} editable={editable} onEdit={onEdit} />
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── a cell ──────────────────────────────────────────────────────

function Cell({ cell, flagged, editable, onEdit, compact }: {
  cell: any; flagged: Map<string, string>; editable: boolean; onEdit: (c: any) => void; compact?: boolean
}) {
  if (!cell) {
    return (
      <td className="border-b border-l border-border p-1.5 align-top">
        <div className="px-1.5 py-1 text-xs text-muted-foreground/50">—</div>
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
