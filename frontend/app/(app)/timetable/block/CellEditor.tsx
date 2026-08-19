'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { timetableApi, timetableError } from '@/lib/timetableApi'

import { Banner } from '../components'
import { DAY_SHORT } from '../shared'

// Changing one cell of a draft: who teaches it, and where it sits.
//
// Both actions are refused server-side if they would put a teacher in
// two rooms at once, and the refusal names the other class — so the
// error is worth showing verbatim rather than replacing with "failed".

export function CellEditor({
  versionId, cell, data, open, onOpenChange, onSaved,
}: {
  versionId: string
  cell: any
  data: any
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [teacherId, setTeacherId] = useState<string>(cell.teacherId ?? 'none')
  const [subjectId, setSubjectId] = useState<string>(cell.subjectId ?? 'none')
  const [moveTo, setMoveTo] = useState<string>('')

  const teachers = useQuery({
    queryKey: ['tt-teacher-setup'],
    queryFn: () => timetableApi.teacherSetup(),
    enabled: open,
  })

  const subjects = useQuery({
    queryKey: ['tt-subjects'],
    queryFn: () => timetableApi.subjects(),
    enabled: open,
  })

  const section = data.sections.find((s: any) =>
    Object.keys(data.cells).some((k: string) =>
      data.cells[k]?.id === cell.id && k.startsWith(s.sectionId)))

  const save = useMutation({
    mutationFn: () => timetableApi.updateDraftCell(versionId, cell.id, {
      teacherId: teacherId === 'none' ? null : teacherId,
      subjectId: subjectId === 'none' ? null : subjectId,
    }),
    onSuccess: (r: any) => {
      // Warnings are advice, not failure — "nobody has this teacher down
      // as teaching Art" is worth saying and not worth blocking.
      for (const w of r?.warnings ?? []) toast.warning(w)
      toast.success('Draft updated')
      onSaved()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const move = useMutation({
    mutationFn: () => {
      const [day, periodNumber] = moveTo.split(':').map(Number)
      return timetableApi.moveDraftCell(versionId, cell.id, { day, periodNumber })
    },
    onSuccess: (r: any) => {
      toast.success(r?.swapped ? 'Swapped with what was already there' : 'Moved')
      onSaved()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const teachingSlots = (data.slots ?? []).filter((s: any) => !s.isBreak)
  const busy = save.isPending || move.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cell.subjectName || 'Period'}</DialogTitle>
          <DialogDescription>
            {section?.label ? `${section.label} · ` : ''}
            {DAY_SHORT[cell.dayOfWeek - 1] ?? `Day ${cell.dayOfWeek}`}, period {cell.periodNumber}
            {cell.timeLabel ? ` · ${cell.timeLabel}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Banner tone="info" title="You are editing a draft">
            Nothing changes for teachers until this version is published.
          </Banner>

          <div>
            <Label htmlFor="cell-subject">What is taught</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger id="cell-subject" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing (free period)</SelectItem>
                {(subjects.data ?? []).map((sub: any) => (
                  <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="cell-teacher">Who teaches it</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger id="cell-teacher" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody assigned</SelectItem>
                {(teachers.data?.teachers ?? []).map((t: any) => (
                  <SelectItem key={t.teacherId ?? t.id} value={t.teacherId ?? t.id}>
                    {t.fullName ?? t.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="mt-2" size="sm"
              onClick={() => save.mutate()}
              disabled={busy || (teacherId === (cell.teacherId ?? 'none')
                && subjectId === (cell.subjectId ?? 'none'))}
            >
              {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <Label htmlFor="cell-move">Move it to another slot</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Within this class. Whatever is already there swaps into this one.
            </p>
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger id="cell-move" className="mt-1.5">
                <SelectValue placeholder="Choose a day and period" />
              </SelectTrigger>
              <SelectContent>
                {(data.days ?? []).flatMap((d: number) =>
                  teachingSlots
                    .filter((s: any) => !(d === cell.dayOfWeek && s.periodNumber === cell.periodNumber))
                    .map((s: any) => (
                      <SelectItem key={`${d}:${s.periodNumber}`} value={`${d}:${s.periodNumber}`}>
                        {DAY_SHORT[d - 1] ?? `Day ${d}`} · period {s.periodNumber}
                      </SelectItem>
                    )))}
              </SelectContent>
            </Select>
            <Button
              className="mt-2" size="sm" variant="outline"
              onClick={() => move.mutate()}
              disabled={busy || !moveTo}
            >
              {move.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Move
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
