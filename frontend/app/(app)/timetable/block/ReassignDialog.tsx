'use client'
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Loader2, UserCog, AlertTriangle, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { timetableApi, timetableError } from '@/lib/timetableApi'
import { DAYS } from '../shared'

// ── Reassign a teacher's periods (permanent, draft-scoped) ───────────
//
// The permanent counterpart to arrangement cover: cover stands somebody in
// for a day and leaves the base grid alone; this rewrites the grid, so it
// only runs on a draft. The "find" filters (day / period / class / section /
// subject) AND together — leave them all on "Any" to move everything the
// source teacher holds. Nothing is written until Apply; Preview shows the
// exact set and every clash (a slot the new teacher already teaches) first.

const ANY = '__any__'

export function ReassignDialog({ versionId, data, open, onOpenChange, onDone }: {
  versionId: string
  data: any
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const cells: any[] = useMemo(() => Object.values(data?.cells ?? {}), [data])

  // Option lists, derived from the grid so no extra fetch is needed.
  const teachers = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cells) if (c.teacherId && !c.isBreak) m.set(c.teacherId, c.teacherName || 'Unknown')
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [cells])

  const subjects = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cells) if (c.subjectId && !c.isBreak) m.set(c.subjectId, c.subjectName || '—')
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [cells])

  // sections carry classId + label ("Class-Section"); build a class list and a
  // section list so "a whole class" and "one section" are both selectable.
  const classes = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of data?.sections ?? []) if (s.classId) m.set(s.classId, String(s.label).split('-')[0])
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])
  const sections = useMemo(
    () => (data?.sections ?? []).map((s: any) => ({ id: s.sectionId, label: s.label })).filter((s: any) => s.id),
    [data])

  const periods = useMemo(() => {
    const set = new Set<number>()
    for (const s of data?.slots ?? []) if (s.periodNumber != null) set.add(s.periodNumber)
    return [...set].sort((a, b) => a - b)
  }, [data])

  const [fromT, setFromT] = useState('')
  const [toT, setToT] = useState('')
  const [day, setDay] = useState(ANY)
  const [period, setPeriod] = useState(ANY)
  const [where, setWhere] = useState(ANY) // "class:<id>" | "section:<id>" | ANY
  const [subject, setSubject] = useState(ANY)
  const [preview, setPreview] = useState<any>(null)

  const buildBody = (dryRun: boolean) => {
    const filter: any = {}
    if (day !== ANY) filter.dayOfWeek = Number(day)
    if (period !== ANY) filter.periodNumber = Number(period)
    if (where.startsWith('class:')) filter.classId = where.slice(6)
    if (where.startsWith('section:')) filter.sectionId = where.slice(8)
    if (subject !== ANY) filter.subjectId = subject
    return { fromTeacherId: fromT, toTeacherId: toT, dryRun, filter }
  }

  const previewMut = useMutation({
    mutationFn: () => timetableApi.reassignTeacher(versionId, buildBody(true)),
    onSuccess: (r: any) => setPreview(r),
    onError: (e) => toast.error(timetableError(e)),
  })

  const applyMut = useMutation({
    mutationFn: () => timetableApi.reassignTeacher(versionId, buildBody(false)),
    onSuccess: (r: any) => {
      toast.success(
        `Reassigned ${r.reassigned} period${r.reassigned === 1 ? '' : 's'} to ${r.to.name}` +
        (r.skipped ? ` — ${r.skipped} skipped (clash)` : ''))
      onDone()
      onOpenChange(false)
      reset()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const reset = () => { setPreview(null); setFromT(''); setToT(''); setDay(ANY); setPeriod(ANY); setWhere(ANY); setSubject(ANY) }
  const ready = fromT && toT && fromT !== toT
  // Any filter change invalidates a stale preview.
  const onFilterChange = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPreview(null) }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCog className="h-4 w-4" /> Reassign a teacher's periods</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Select value={fromT} onValueChange={onFilterChange(setFromT)}>
                <SelectTrigger><SelectValue placeholder="Teacher" /></SelectTrigger>
                <SelectContent>
                  {teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" />
            <div className="space-y-1.5">
              <Label>To</Label>
              <Select value={toT} onValueChange={onFilterChange(setToT)}>
                <SelectTrigger><SelectValue placeholder="Teacher" /></SelectTrigger>
                <SelectContent>
                  {teachers.filter(t => t.id !== fromT).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Which periods (leave as Any to move all of theirs)</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <Select value={day} onValueChange={onFilterChange(setDay)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any day</SelectItem>
                  {DAYS.map((d, i) => <SelectItem key={i} value={String(i + 1)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={onFilterChange(setPeriod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any period</SelectItem>
                  {periods.map(p => <SelectItem key={p} value={String(p)}>Period {p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={where} onValueChange={onFilterChange(setWhere)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any class</SelectItem>
                  {classes.map(c => <SelectItem key={c.id} value={`class:${c.id}`}>Class {c.name}</SelectItem>)}
                  {sections.map((s: any) => <SelectItem key={s.id} value={`section:${s.id}`}>Section {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={subject} onValueChange={onFilterChange(setSubject)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any subject</SelectItem>
                  {subjects.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {preview.matched === 0 ? (
                <p className="text-muted-foreground">No periods match this — {preview.from.name} teaches nothing in that scope.</p>
              ) : (
                <>
                  <p className="font-medium text-foreground">
                    {preview.willReassign} of {preview.matched} will move to {preview.to.name}
                    {preview.skipped > 0 && <span className="text-warning-foreground"> · {preview.skipped} skipped (clash)</span>}
                  </p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {preview.periods.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {p.clash
                          ? <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />
                          : <Check className="h-3 w-3 shrink-0 text-success" />}
                        <span className={p.clash ? 'text-muted-foreground line-through' : 'text-foreground'}>
                          {p.day} P{p.periodNumber} · {p.subject} · {p.where}
                        </span>
                        {p.clash && <span className="text-destructive">already teaches {p.clash.subject} ({p.clash.where})</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => previewMut.mutate()} disabled={!ready || previewMut.isPending}>
            {previewMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Preview
          </Button>
          <Button onClick={() => applyMut.mutate()} disabled={!ready || !preview || preview.willReassign === 0 || applyMut.isPending}>
            {applyMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply{preview?.willReassign ? ` (${preview.willReassign})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
