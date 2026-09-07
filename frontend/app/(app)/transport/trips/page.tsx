'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarClock, Loader2, Plus, Play, CheckCircle2, XCircle, Users, Trash2 } from 'lucide-react'
import { transportApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

function todayStr() { return new Date().toISOString().slice(0, 10) }

const STATUS_BADGE: Record<string, { label: string; variant: any }> = {
  scheduled: { label: 'Scheduled', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export default function TransportTripsPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('transport.manage_trips')
  const canMark = can('transport.mark_boarding')

  const [date, setDate] = useState(todayStr())
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [rosterTrip, setRosterTrip] = useState<any | null>(null)
  const [form, setForm] = useState({ route_id: '', shift: 'morning' })

  const { data: trips, isLoading } = useQuery({
    queryKey: ['transport-trips', date],
    queryFn: () => transportApi.trips.list(date).then(r => r.data),
  })
  const { data: routes } = useQuery({ queryKey: ['transport-routes'], queryFn: () => transportApi.routes.list().then(r => r.data) })

  const scheduleMutation = useMutation({
    mutationFn: () => transportApi.trips.schedule({ route_id: form.route_id, trip_date: date, shift: form.shift }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-trips', date] })
      setScheduleOpen(false)
      setForm({ route_id: '', shift: 'morning' })
      toast.success('Trip scheduled')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to schedule trip'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => transportApi.trips.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport-trips', date] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update trip'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => transportApi.trips.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transport-trips', date] }); toast.success('Trip removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove trip'),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trips & Boarding"
        description="Schedule a route's runs for the day and mark students as they board or alight."
        icon={CalendarClock}
        className="mb-0"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
            {canManage && <Button size="sm" onClick={() => setScheduleOpen(true)}><Plus className="h-4 w-4" /> Schedule Trip</Button>}
          </div>
        }
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-5"><Skeleton className="h-32 w-full rounded-xl" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(trips ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No trips scheduled for this date.</TableCell></TableRow>
              )}
              {(trips ?? []).map((t: any) => {
                const badge = STATUS_BADGE[t.status]
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.routes?.name}</TableCell>
                    <TableCell className="capitalize">{t.shift}</TableCell>
                    <TableCell>{t.vehicles?.registration_no ?? '—'}</TableCell>
                    <TableCell>{t.drivers?.full_name ?? '—'}</TableCell>
                    <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canMark && (
                          <Button variant="ghost" size="icon" onClick={() => setRosterTrip(t)} aria-label="Roster & boarding">
                            <Users className="h-4 w-4" />
                          </Button>
                        )}
                        {canManage && t.status === 'scheduled' && (
                          <Button variant="ghost" size="icon" onClick={() => statusMutation.mutate({ id: t.id, status: 'in_progress' })} aria-label="Start"><Play className="h-4 w-4" /></Button>
                        )}
                        {canManage && t.status === 'in_progress' && (
                          <Button variant="ghost" size="icon" onClick={() => statusMutation.mutate({ id: t.id, status: 'completed' })} aria-label="Complete"><CheckCircle2 className="h-4 w-4" /></Button>
                        )}
                        {canManage && (t.status === 'scheduled' || t.status === 'in_progress') && (
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => statusMutation.mutate({ id: t.id, status: 'cancelled' })} aria-label="Cancel"><XCircle className="h-4 w-4" /></Button>
                        )}
                        {canManage && t.status === 'scheduled' && (
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(t.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Trip</DialogTitle><DialogDescription>For {date}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Route</Label>
              <Select value={form.route_id || undefined} onValueChange={v => setForm(f => ({ ...f, route_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a route" /></SelectTrigger>
                <SelectContent>{(routes ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Shift</Label>
              <Select value={form.shift} onValueChange={v => setForm(f => ({ ...f, shift: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="morning">Morning</SelectItem><SelectItem value="afternoon">Afternoon</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)} disabled={scheduleMutation.isPending}>Cancel</Button>
            <Button onClick={() => scheduleMutation.mutate()} disabled={!form.route_id || scheduleMutation.isPending}>
              {scheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rosterTrip && <RosterDialog open={!!rosterTrip} onOpenChange={o => !o && setRosterTrip(null)} trip={rosterTrip} />}
    </div>
  )
}

const EVENT_LABEL: Record<string, string> = { boarded: 'Boarded', alighted: 'Alighted', absent_no_show: 'No-show' }

function RosterDialog({ open, onOpenChange, trip }: { open: boolean; onOpenChange: (o: boolean) => void; trip: any }) {
  const qc = useQueryClient()
  const { data: roster, isLoading } = useQuery({
    queryKey: ['transport-trip-roster', trip.id],
    queryFn: () => transportApi.trips.roster(trip.id).then(r => r.data),
    enabled: open,
  })

  const markMutation = useMutation({
    mutationFn: ({ student_id, stop_id, event }: any) => transportApi.trips.markBoarding(trip.id, { student_id, stop_id, event }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport-trip-roster', trip.id] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{trip.routes?.name} — Roster</DialogTitle>
          <DialogDescription>Mark each student as they board or alight.</DialogDescription>
        </DialogHeader>

        {isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(roster ?? []).length === 0 && <p className="text-sm text-muted-foreground">No students assigned to this route yet.</p>}
            {(roster ?? []).map((r: any) => {
              const latest = r.events[r.events.length - 1]
              return (
                <div key={r.student_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.student?.first_name} {r.student?.last_name}</div>
                    <div className="text-xs text-muted-foreground">{r.stop_name} · {r.direction}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {latest && <Badge variant="secondary">{EVENT_LABEL[latest.event]}</Badge>}
                    <Button size="sm" variant="outline" disabled={markMutation.isPending}
                      onClick={() => markMutation.mutate({ student_id: r.student_id, stop_id: r.stop_id, event: 'boarded' })}>Board</Button>
                    <Button size="sm" variant="outline" disabled={markMutation.isPending}
                      onClick={() => markMutation.mutate({ student_id: r.student_id, stop_id: r.stop_id, event: 'alighted' })}>Alight</Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={markMutation.isPending}
                      onClick={() => markMutation.mutate({ student_id: r.student_id, stop_id: r.stop_id, event: 'absent_no_show' })}>No-show</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
