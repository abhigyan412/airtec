'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpen, CalendarClock, Check, Clock, LogOut, Loader2, Lock, Maximize2, Minimize2, X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'

import {
  timetableApi, timetableError, prettyDate, relativeDate, todayISO, addDaysISO, DAY_SHORT,
} from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton, subjectClasses } from '../components'

// ═══════════════════════════════════════════════════════════════
// What a teacher opens on their phone.
// ═══════════════════════════════════════════════════════════════
//
// Three things, in this order of urgency:
//   1. cover they have been handed and not yet answered — the only
//      genuinely time-critical item, so it sits above everything;
//   2. their own week;
//   3. free periods they want to keep for themselves.
//
// The acknowledgement flow is the whole reason this page exists. A
// substitute who was notified but never confirmed looks, from the
// office, exactly like one who is on their way.

export default function MyWeekPage() {
  const qc = useQueryClient()
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [showEarlyLeave, setShowEarlyLeave] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['my-week'],
    queryFn: () => timetableApi.myWeek(),
  })

  const acknowledge = useMutation({
    mutationFn: (id: string) => timetableApi.acknowledge(id),
    onSuccess: () => {
      toast.success('Confirmed — thank you')
      qc.invalidateQueries({ queryKey: ['my-week'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading || !data) return <div className="p-6"><TableSkeleton rows={6} cols={6} /></div>

  const pending = data.cover.filter((c: any) => c.needsAcknowledgement)

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="My week"
        description="Your timetable, the classes you are covering, and your reserved periods."
        icon={CalendarClock}
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowEarlyLeave(true)}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            I'm leaving early
          </Button>
        }
      />

      {/* Unanswered cover, above everything else. */}
      {pending.length > 0 && (
        <div className="mb-5 space-y-3">
          <Banner
            tone="warn"
            title={`You have ${pending.length} class${pending.length === 1 ? '' : 'es'} to confirm`}
          >
            The timetable manager cannot tell whether you have seen these until you confirm.
          </Banner>

          {pending.map((cover: any) => (
            <Card key={cover.id} className="border-warning/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {cover.className} · Period {cover.periodNumber}
                    </span>
                    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', subjectClasses(cover.subjectName))}>
                      {cover.subjectName}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {relativeDate(cover.date) ?? prettyDate(cover.date)} · {cover.timeLabel}
                    {cover.coveringFor && <> · standing in for {cover.coveringFor}</>}
                  </p>
                  {cover.whyYou && (
                    <p className="mt-1 text-xs text-muted-foreground">Why you: {cover.whyYou}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDecliningId(cover.id)}>
                    <X className="mr-1.5 h-3.5 w-3.5" /> Can't take it
                  </Button>
                  <Button size="sm" onClick={() => acknowledge.mutate(cover.id)} disabled={acknowledge.isPending}>
                    {acknowledge.isPending
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <Check className="mr-1.5 h-3.5 w-3.5" />}
                    I'll take it
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="week">
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="week">Timetable</TabsTrigger>
          <TabsTrigger value="cover">
            Cover
            {data.cover.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                {data.cover.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="bookings">My free periods</TabsTrigger>
        </TabsList>

        <TabsContent value="week">
          <MyGrid grid={data.grid} today={data.today} />
        </TabsContent>

        <TabsContent value="cover">
          <CoverList cover={data.cover} onAcknowledge={id => acknowledge.mutate(id)} onDecline={setDecliningId} />
        </TabsContent>

        <TabsContent value="bookings">
          <BookingsTab settings={data.settings} />
        </TabsContent>
      </Tabs>

      {decliningId && (
        <DeclineDialog
          id={decliningId}
          onClose={() => setDecliningId(null)}
          onDone={() => { setDecliningId(null); qc.invalidateQueries({ queryKey: ['my-week'] }) }}
        />
      )}
      {showEarlyLeave && (
        <EarlyLeaveDialog
          grid={data.grid}
          onClose={() => setShowEarlyLeave(false)}
          onDone={() => { setShowEarlyLeave(false); qc.invalidateQueries({ queryKey: ['my-week'] }) }}
        />
      )}
    </div>
  )
}

// ── the grid ────────────────────────────────────────────────────

function MyGrid({ grid, today }: { grid: any; today: string }) {
  const periods = grid.periods ?? []
  const cells = grid.cells ?? []
  const todayDow = new Date(today).getDay() || 7

  const [isFullscreen, setIsFullscreen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Synced from the browser's own fullscreen state, not just our toggle —
  // a phone's back gesture or the system Escape key exits fullscreen
  // without going through toggleFullscreen, and the button/overlay must
  // follow that or they'll disagree with what's actually on screen.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try { await contentRef.current?.requestFullscreen() } catch { /* unsupported browser */ }
      try { await (screen.orientation as any)?.lock?.('landscape') } catch { /* iOS / desktop */ }
    } else {
      try { await document.exitFullscreen() } catch { /* already exited */ }
      try { (screen.orientation as any)?.unlock?.() } catch { /* no-op */ }
    }
  }

  if (!periods.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No classes on your timetable yet"
        description="Once the school's timetable is published, your week will appear here."
      />
    )
  }

  const byKey = new Map<string, any>()
  for (const cell of cells) byKey.set(`${cell.dayOfWeek}:${cell.periodNumber}`, cell)

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground">{grid.load.totalPerWeek}</span> periods a week
        </span>
        <span className="text-muted-foreground">
          Busiest: <span className="font-semibold text-foreground">{grid.load.busiestDay.dayName}</span>
          {' '}({grid.load.busiestDay.periods})
        </span>
      </div>

      {!isFullscreen && (
        <div className="mb-2 flex justify-end sm:hidden">
          <Button
            variant="outline" size="icon"
            onClick={toggleFullscreen} title="Full screen (landscape)"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={contentRef}
        className={cn(isFullscreen && 'fixed inset-0 z-50 overflow-auto bg-background p-3')}
      >
        {isFullscreen && (
          <div className="mb-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={toggleFullscreen}>
              <Minimize2 className="mr-1.5 h-4 w-4" /> Exit full screen
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 640 }}>
            <thead className="bg-muted/50">
              <tr>
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Period
                </th>
                {[1, 2, 3, 4, 5, 6].map(day => (
                  <th
                    key={day}
                    className={cn(
                      'px-2 py-2 text-center text-xs font-medium uppercase tracking-wide',
                      day === todayDow ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {DAY_SHORT[day]}
                    {day === todayDow && <span className="ml-1 text-[10px] normal-case">today</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {periods.map((period: any) => (
                <tr key={period.periodNumber}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                    <p className="text-sm font-semibold text-foreground">{period.periodNumber}</p>
                    <p className="text-[10px] tabular-nums text-muted-foreground">{period.timeLabel}</p>
                  </td>
                  {[1, 2, 3, 4, 5, 6].map(day => {
                    const cell = byKey.get(`${day}:${period.periodNumber}`)
                    return (
                      <td key={day} className={cn('p-1', day === todayDow && 'bg-primary/[0.03]')}>
                        {cell ? (
                          <div className={cn('rounded-md px-2 py-1.5 text-center', subjectClasses(cell.subjectName))}>
                            <p className="truncate text-xs font-medium">{cell.subjectName}</p>
                            <p className="truncate text-[10px] opacity-80">
                              {[cell.className, cell.sectionName].filter(Boolean).join('-')}
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-md py-1.5 text-center text-[10px] text-muted-foreground/50">free</div>
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
    </div>
  )
}

// ── cover list ──────────────────────────────────────────────────

function CoverList({ cover, onAcknowledge, onDecline }: {
  cover: any[]; onAcknowledge: (id: string) => void; onDecline: (id: string) => void
}) {
  if (!cover.length) {
    return <EmptyState icon={Check} title="No cover assigned" description="You have no classes to stand in for." />
  }
  return (
    <div className="space-y-2">
      {cover.map(item => (
        <Card key={item.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {relativeDate(item.date) ?? prettyDate(item.date)} · Period {item.periodNumber}
                </span>
                <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', subjectClasses(item.subjectName))}>
                  {item.subjectName}
                </span>
                <span className="text-sm text-muted-foreground">{item.className}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.timeLabel}{item.coveringFor && ` · for ${item.coveringFor}`}
              </p>
            </div>
            {item.needsAcknowledgement ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={() => onDecline(item.id)}>Can't take it</Button>
                <Button size="sm" onClick={() => onAcknowledge(item.id)}>I'll take it</Button>
              </div>
            ) : (
              <Chip tone="good">Confirmed</Chip>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── bookings ────────────────────────────────────────────────────

function BookingsTab({ settings }: { settings: { bookingWeeklyCap: number; bookingLeadHours: number } }) {
  const qc = useQueryClient()
  const [from] = useState(() => todayISO())
  const [to] = useState(() => addDaysISO(todayISO(), 13))
  const [booking, setBooking] = useState<{ date: string; periodNumber: number } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['bookable', from, to],
    queryFn: () => timetableApi.bookable(from, to),
  })

  const release = useMutation({
    mutationFn: (id: string) => timetableApi.releaseBooking(id),
    onSuccess: () => {
      toast.success('Period released — it can be used for cover again')
      qc.invalidateQueries({ queryKey: ['bookable'] })
      qc.invalidateQueries({ queryKey: ['my-week'] })
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  if (isLoading || !data) return <TableSkeleton rows={5} cols={6} />

  const used = data.days.flatMap((d: any) => d.slots).filter((s: any) => s.state === 'booked').length

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-sm text-foreground">
          You can keep <span className="font-semibold">{data.weeklyCap} periods a week</span> for
          your own work — marking, planning, event duties. A reserved period will not be given a
          regular class, and will only be used for cover as an absolute last resort.
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Reserve at least {data.leadHours} hours ahead. You currently have {used} period{used === 1 ? '' : 's'} reserved.
        </p>
      </div>

      <div className="space-y-3">
        {data.days.map((day: any) => {
          const anyBookable = day.slots.some((s: any) => s.state === 'available' || s.state === 'booked')
          if (!anyBookable) return null
          return (
            <div key={day.date}>
              <p className="mb-1.5 text-sm font-medium text-foreground">
                {relativeDate(day.date) ?? prettyDate(day.date)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {day.slots.map((slot: any) => (
                  <SlotButton
                    key={slot.periodNumber}
                    slot={slot}
                    onBook={() => setBooking({ date: day.date, periodNumber: slot.periodNumber })}
                    onRelease={() => release.mutate(slot.bookingId)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {booking && (
        <BookDialog
          date={booking.date}
          periodNumber={booking.periodNumber}
          purposes={data.purposes}
          onClose={() => setBooking(null)}
          onDone={() => {
            setBooking(null)
            qc.invalidateQueries({ queryKey: ['bookable'] })
            qc.invalidateQueries({ queryKey: ['my-week'] })
          }}
        />
      )}
    </div>
  )
}

/**
 * One period, in whichever of five states it is in.
 *
 * Unavailable slots are shown greyed with the reason on hover rather
 * than hidden, so the grid keeps the same shape every day and a teacher
 * can see *why* Tuesday period 3 is not offered instead of wondering
 * where it went.
 */
function SlotButton({ slot, onBook, onRelease }: { slot: any; onBook: () => void; onRelease: () => void }) {
  if (slot.state === 'booked') {
    return (
      <button
        onClick={onRelease}
        title={`Reserved for ${slot.purposeLabel} — click to release`}
        className="group flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Lock className="h-3 w-3 group-hover:hidden" />
        <X className="hidden h-3 w-3 group-hover:block" />
        P{slot.periodNumber}
        <span className="hidden sm:inline">· {slot.purposeLabel}</span>
      </button>
    )
  }

  if (slot.state === 'available') {
    return (
      <button
        onClick={onBook}
        title={`${slot.timeLabel} — reserve this period`}
        className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        + P{slot.periodNumber}
      </button>
    )
  }

  const label = slot.state === 'teaching' ? 'teaching' : slot.state === 'covering' ? 'cover' : null
  return (
    <span
      title={slot.why ?? undefined}
      className="cursor-help rounded-md border border-transparent bg-muted px-2.5 py-1.5 text-xs text-muted-foreground/70"
    >
      P{slot.periodNumber}{label && <span className="hidden sm:inline"> · {label}</span>}
    </span>
  )
}

function BookDialog({ date, periodNumber, purposes, onClose, onDone }: {
  date: string; periodNumber: number; purposes: { value: string; label: string }[]
  onClose: () => void; onDone: () => void
}) {
  const [purpose, setPurpose] = useState('copy_correction')
  const [notes, setNotes] = useState('')

  const book = useMutation({
    mutationFn: () => timetableApi.book({ date, periodNumber, purpose, notes: notes || null }),
    onSuccess: (r: any) => {
      toast.success(`Period ${periodNumber} reserved. ${r.remaining_this_week} left this week.`)
      onDone()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reserve period {periodNumber} on {prettyDate(date)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="purpose">What is it for?</Label>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger id="purpose" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {purposes.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} className="mt-1.5" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => book.mutate()} disabled={book.isPending}>
            {book.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Reserve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── decline ─────────────────────────────────────────────────────

function DeclineDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const decline = useMutation({
    mutationFn: () => timetableApi.decline(id, reason.trim()),
    onSuccess: () => { toast.success('The timetable manager has been told'); onDone() },
    onError: (e) => toast.error(timetableError(e)),
  })

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Why can't you take this class?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          The manager needs to find somebody else quickly, so a short reason helps.
        </p>
        <Textarea
          value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="e.g. I have a parent meeting scheduled in that period"
          className="mt-2"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || decline.isPending}
            onClick={() => decline.mutate()}
          >
            {decline.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── early leave ─────────────────────────────────────────────────

function EarlyLeaveDialog({ grid, onClose, onDone }: { grid: any; onClose: () => void; onDone: () => void }) {
  const [fromPeriod, setFromPeriod] = useState('')
  const [reason, setReason] = useState('')

  const report = useMutation({
    mutationFn: () => timetableApi.reportEarlyLeave(Number(fromPeriod), reason),
    onSuccess: (r: any) => {
      toast.success(r.arrangementsCreated
        ? `Reported. ${r.arrangementsCreated} period${r.arrangementsCreated === 1 ? '' : 's'} sent for cover.`
        : 'Reported — you have no further classes today.')
      onDone()
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const periods = grid.periods ?? []

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Leaving early today</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your remaining classes go straight into the cover queue and the timetable manager is
          told immediately. If your plans change you can cancel this from the same place.
        </p>
        <div className="space-y-4 pt-2">
          <div>
            <Label htmlFor="from-period">Leaving from</Label>
            <Select value={fromPeriod} onValueChange={setFromPeriod}>
              <SelectTrigger id="from-period" className="mt-1.5">
                <SelectValue placeholder="Choose a period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p: any) => (
                  <SelectItem key={p.periodNumber} value={String(p.periodNumber)}>
                    Period {p.periodNumber} · {p.timeLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="early-reason">Reason</Label>
            <Textarea
              id="early-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="e.g. Medical appointment" className="mt-1.5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!fromPeriod || report.isPending} onClick={() => report.mutate()}>
            {report.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
