'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Eye } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { timetableApi, timetableError } from '@/lib/timetableApi'
import { cn } from '@/lib/utils'

import { DAY_SHORT } from '../shared'
import { Banner, Chip, GridShell, TableSkeleton, subjectClasses } from '../components'

// ═══════════════════════════════════════════════════════════════
// Looking at a draft before it becomes the school's week.
// ═══════════════════════════════════════════════════════════════
//
// This screen used to end at a summary — periods placed, a score, a
// conflict count — and then offer a Publish button. That is not enough
// to decide with. A score of 42 tells you nothing about whether 6B has
// three Maths lessons in a row on Thursday, and the only way anybody
// found out was by publishing and hearing about it.
//
// So: the actual grid, section by section, before anything goes live.
// Teacher clashes are computed across the WHOLE draft and marked in
// every section they touch, because a clash is by definition two
// sections at once and looking at one of them alone hides it.

const fmt = (t: string | null | undefined) =>
  !t ? '' : t.slice(0, 5)

export function DraftPreview({
  versionId, label, open, onOpenChange,
}: {
  versionId: string
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [sectionId, setSectionId] = useState<string | null>(null)

  const grid = useQuery({
    queryKey: ['tt-draft-grid', versionId],
    queryFn: () => timetableApi.versionGrid(versionId),
    enabled: open,
  })

  const data: any = grid.data
  const periods: any[] = data?.periods ?? []
  const sections: any[] = data?.sections ?? []
  const slots: any[] = data?.slots ?? []
  const days: number[] = data?.days ?? []

  const active = sectionId ?? sections[0]?.id ?? null

  // A teacher standing in two rooms at once, found across the whole
  // draft rather than the section on screen.
  const clashKeys = useMemo(() => {
    const seen = new Map<string, any[]>()
    for (const p of periods) {
      if (!p.teacher_id || p.is_break) continue
      const key = `${p.teacher_id}|${p.day_of_week}|${p.period_number}`
      const list = seen.get(key)
      if (list) list.push(p)
      else seen.set(key, [p])
    }
    const clashing = new Set<string>()
    const detail: { teacher: string; day: number; period: number; where: string[] }[] = []
    for (const list of Array.from(seen.values())) {
      if (list.length < 2) continue
      for (const p of list) clashing.add(p.id)
      detail.push({
        teacher: list[0].teacher_name ?? 'Unknown teacher',
        day: list[0].day_of_week,
        period: list[0].period_number,
        where: list.map(p => [p.class_name, p.section_name].filter(Boolean).join(' ')),
      })
    }
    return { clashing, detail }
  }, [periods])

  const cellFor = (day: number, period: number) =>
    periods.find(p => p.section_id === active && p.day_of_week === day && p.period_number === period)

  const sectionClashes = clashKeys.detail.filter(d =>
    periods.some(p => p.section_id === active && p.day_of_week === d.day && p.period_number === d.period
      && clashKeys.clashing.has(p.id)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview — {label}</DialogTitle>
          <DialogDescription>
            Exactly what will go live if this draft is published. Nothing here is live yet.
          </DialogDescription>
        </DialogHeader>

        {grid.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : grid.error ? (
          <Banner tone="bad" title="Could not load the draft">{timetableError(grid.error)}</Banner>
        ) : !periods.length ? (
          <Banner tone="warn" title="This draft has no periods in it">
            Nothing was written for this version. It is safe to discard.
          </Banner>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={active ?? undefined} onValueChange={setSectionId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Choose a class" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} · {s.periods} periods
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Chip>{sections.length} classes</Chip>
              <Chip>{periods.length} periods</Chip>
              {clashKeys.detail.length > 0
                ? <Chip tone="bad">{clashKeys.detail.length} teacher clashes</Chip>
                : <Chip tone="good">No teacher clashes</Chip>}
            </div>

            {clashKeys.detail.length > 0 && (
              <Banner
                tone="bad"
                title={`${clashKeys.detail.length} teacher clash${clashKeys.detail.length === 1 ? '' : 'es'} in this draft`}
              >
                <ul className="mt-1 space-y-1">
                  {clashKeys.detail.slice(0, 8).map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.teacher}</span> is in {c.where.join(' and ')} at
                      the same time — {DAY_SHORT[c.day - 1] ?? `day ${c.day}`}, period {c.period}.
                    </li>
                  ))}
                  {clashKeys.detail.length > 8 && (
                    <li className="text-xs">…and {clashKeys.detail.length - 8} more.</li>
                  )}
                </ul>
              </Banner>
            )}

            {sectionClashes.length === 0 && clashKeys.detail.length > 0 && (
              <p className="text-xs text-muted-foreground">
                None of those clashes fall in this class — switch class to see them.
              </p>
            )}

            <GridShell
              columns={
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Period
                  </th>
                  {days.map(d => (
                    <th key={d} className="border-b border-l border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {DAY_SHORT[d - 1] ?? `Day ${d}`}
                    </th>
                  ))}
                </tr>
              }
            >
              {slots.map(slot => (
                <tr key={slot.periodNumber}>
                  <td className="border-b border-border px-3 py-2 align-top">
                    <div className="text-sm font-medium text-foreground">{slot.periodNumber}</div>
                    {slot.startTime && (
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(slot.startTime)}–{fmt(slot.endTime)}
                      </div>
                    )}
                  </td>
                  {days.map(day => {
                    const cell = cellFor(day, slot.periodNumber)
                    const clash = cell && clashKeys.clashing.has(cell.id)
                    return (
                      <td key={day} className="border-b border-l border-border p-1.5 align-top">
                        {!cell ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground/60">—</div>
                        ) : cell.is_break ? (
                          <div className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                            {cell.subject_name ?? 'Break'}
                          </div>
                        ) : (
                          <div className={cn(
                            'rounded-md px-2 py-1.5',
                            clash
                              ? 'bg-destructive/10 ring-1 ring-inset ring-destructive/40'
                              : subjectClasses(cell.subject_name),
                          )}>
                            <div className="flex items-start gap-1 text-xs font-medium">
                              {clash && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
                              <span className="min-w-0 break-words">{cell.subject_name ?? '—'}</span>
                            </div>
                            {cell.teacher_name && (
                              <div className="mt-0.5 text-[11px] opacity-80">{cell.teacher_name}</div>
                            )}
                            {cell.room_name && (
                              <div className="text-[11px] opacity-60">{cell.room_name}</div>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </GridShell>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export const PreviewIcon = Eye
