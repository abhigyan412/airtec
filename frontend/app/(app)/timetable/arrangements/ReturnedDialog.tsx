'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Clock, Loader2, RefreshCw } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { timetableApi, timetableError } from '@/lib/timetableApi'

import { Banner, TableSkeleton } from '../components'

// ═══════════════════════════════════════════════════════════════
// "They're back" — which cover stands down, and which stays
// ═══════════════════════════════════════════════════════════════
//
// Pressing this used to stand down everything the clock said had not
// started yet and report a total afterwards. That is one decision made
// on the manager's behalf when it is really one decision per period: a
// teacher who walks in at eleven takes their afternoon back, but period
// 3 was taught by somebody else an hour ago, and they may still want
// period 7 covered because they are going into a meeting.
//
// So every period is listed, the ones that have already gone are shown
// as gone and cannot be un-taught, and the manager ticks the rest.

const fmt = (t?: string | null) => (t ? t.slice(0, 5) : '')

export function ReturnedDialog({
  absenceId, teacherName, open, onOpenChange, onDone,
}: {
  absenceId: string
  teacherName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const preview = useQuery({
    queryKey: ['tt-cancel-preview', absenceId],
    queryFn: () => timetableApi.cancelPreview(absenceId),
    enabled: open,
  })

  const data: any = preview.data
  const periods: any[] = useMemo(() => data?.periods ?? [], [data])

  // Which covers to cancel. Seeded from the server's recommendation:
  // everything still to come, plus anything nobody was covering anyway.
  const [cancelIds, setCancelIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!periods.length) return
    setCancelIds(new Set(periods.filter(p => p.defaultCancel).map(p => p.arrangementId)))
  }, [periods])

  const cancellable = periods.filter(p => p.canCancel)
  const locked = periods.filter(p => !p.canCancel)
  const keepIds = periods.filter(p => !cancelIds.has(p.arrangementId)).map(p => p.arrangementId)

  const submit = useMutation({
    mutationFn: () => timetableApi.cancelAbsence(absenceId, 'Teacher returned', keepIds),
    onSuccess: (r: any) => {
      const bits = [`${r.cancelledArrangements} stood down`]
      if (r.keptByChoice) bits.push(`${r.keptByChoice} kept in place`)
      if (r.keptInRegister - (r.keptByChoice ?? 0) > 0) {
        bits.push(`${r.keptInRegister - (r.keptByChoice ?? 0)} already taught`)
      }
      toast.success(`${teacherName} is back — ${bits.join(', ')}.`)
      onOpenChange(false)
      onDone()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const toggle = (id: string) => setCancelIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{teacherName} is back</DialogTitle>
          <DialogDescription>
            Choose which cover to stand down. Anything you leave ticked off stays in place and the
            substitute keeps the period.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <TableSkeleton rows={5} cols={2} />
        ) : preview.error ? (
          <Banner tone="bad" title="Could not load the periods">{timetableError(preview.error)}</Banner>
        ) : !periods.length ? (
          <Banner tone="info" title="Nothing to stand down">
            There is no cover recorded against this absence.
          </Banner>
        ) : (
          <div className="space-y-4">
            {locked.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Already gone — stays on the register
                </p>
                <div className="space-y-1.5">
                  {locked.map(p => (
                    <div key={p.arrangementId}
                      className="rounded-lg border border-border bg-muted/40 px-3 py-2 opacity-80">
                      <p className="text-sm text-foreground">
                        P{p.periodNumber} {p.subjectName}
                        {p.className && <span className="text-muted-foreground"> · {p.className}</span>}
                        {p.startTime && <span className="text-muted-foreground"> · {fmt(p.startTime)}–{fmt(p.endTime)}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cancellable.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Still to come — tick what to stand down
                  </p>
                  <div className="flex gap-2">
                    <button type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setCancelIds(new Set(cancellable.map(p => p.arrangementId)))}>
                      Stand down all
                    </button>
                    <button type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setCancelIds(new Set())}>
                      Keep all
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {cancellable.map(p => {
                    const checked = cancelIds.has(p.arrangementId)
                    return (
                      <label key={p.arrangementId}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                          checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-accent',
                        )}>
                        <Checkbox
                          checked={checked}
                          onChange={() => toggle(p.arrangementId)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-foreground">
                            P{p.periodNumber} {p.subjectName}
                            {p.className && <span className="text-muted-foreground"> · {p.className}</span>}
                            {p.startTime && <span className="text-muted-foreground"> · {fmt(p.startTime)}–{fmt(p.endTime)}</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {p.why}
                            {p.acknowledged && ' · they have accepted it'}
                          </span>
                        </span>
                        <span className={cn('shrink-0 text-xs font-medium',
                          checked ? 'text-primary' : 'text-muted-foreground')}>
                          {checked ? 'stand down' : 'keep'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || preview.isLoading}>
            {submit.isPending
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {cancelIds.size === 0
              ? 'Mark back, keep all cover'
              : `Stand down ${cancelIds.size} period${cancelIds.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
