'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Route as RouteIcon, Loader2, Plus, Trash2, MapPin, ArrowUp, ArrowDown, UserPlus } from 'lucide-react'
import { transportApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { StudentSearch, StudentLite, studentLabel } from '@/components/shared/StudentSearch'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export default function TransportRoutesPage() {
  const { can } = usePermissions()
  const canManage = can('transport.manage_routes')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routes & Stops"
        description="Define routes, order their stops, and assign students to a pickup/drop point."
        icon={RouteIcon}
        className="mb-0"
      />
      <Tabs defaultValue="Routes">
        <TabsList>
          <TabsTrigger value="Routes">Routes</TabsTrigger>
          <TabsTrigger value="Stops">Stops</TabsTrigger>
        </TabsList>
        <TabsContent value="Routes" className="mt-6">
          <RoutesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="Stops" className="mt-6">
          <StopsTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StopsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', lat: '', lng: '' })

  const { data: stops, isLoading } = useQuery({ queryKey: ['transport-stops'], queryFn: () => transportApi.stops.list().then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: () => transportApi.stops.create({ name: form.name.trim(), lat: form.lat ? Number(form.lat) : null, lng: form.lng ? Number(form.lng) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-stops'] })
      setAddOpen(false); setForm({ name: '', lat: '', lng: '' })
      toast.success('Stop added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add stop'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => transportApi.stops.delete(deleteId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transport-stops'] }); setDeleteId(null); toast.success('Stop removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove stop'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Your school's master list of pickup/drop points.</p>
        {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Stop</Button>}
      </div>
      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Coordinates</TableHead>{canManage && <TableHead className="w-10" />}</TableRow></TableHeader>
          <TableBody>
            {(stops ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No stops added yet.</TableCell></TableRow>}
            {(stops ?? []).map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-muted-foreground">{s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : '—'}</TableCell>
                {canManage && <TableCell><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(s.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Stop</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Green Park Market" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Latitude (optional)</Label><Input type="number" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Longitude (optional)</Label><Input type="number" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name.trim()}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)} title="Remove this stop?"
        description="Stops still used by a route or assigned to a student can't be deleted until reassigned."
        destructive confirmLabel="Remove" loading={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate()} />
    </Card>
  )
}

function RoutesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [manageRoute, setManageRoute] = useState<any | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', vehicle_id: '', driver_id: '' })

  const { data: routes, isLoading } = useQuery({ queryKey: ['transport-routes'], queryFn: () => transportApi.routes.list().then(r => r.data) })
  const { data: vehicles } = useQuery({ queryKey: ['transport-vehicles'], queryFn: () => transportApi.vehicles.list().then(r => r.data) })
  const { data: drivers } = useQuery({ queryKey: ['transport-drivers'], queryFn: () => transportApi.drivers.list().then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: () => transportApi.routes.create({ name: form.name.trim(), vehicle_id: form.vehicle_id || null, driver_id: form.driver_id || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-routes'] })
      setAddOpen(false); setForm({ name: '', vehicle_id: '', driver_id: '' })
      toast.success('Route added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add route'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => transportApi.routes.delete(deleteId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transport-routes'] }); setDeleteId(null); toast.success('Route removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove route'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Each route's vehicle, driver and ordered stops.</p>
        <div className="flex gap-2">
          {canManage && <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}><UserPlus className="h-4 w-4" /> Assign Student</Button>}
          {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Route</Button>}
        </div>
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Vehicle</TableHead><TableHead>Driver</TableHead><TableHead>Stops</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {(routes ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No routes added yet.</TableCell></TableRow>}
            {(routes ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.vehicles?.registration_no ?? '—'}</TableCell>
                <TableCell>{r.drivers?.full_name ?? '—'}</TableCell>
                <TableCell>{(r.route_stops ?? []).length}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setManageRoute(r)} aria-label="Manage stops"><MapPin className="h-4 w-4" /></Button>
                    {canManage && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Route</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Route 3 — North Zone" /></div>
            <div className="space-y-1.5">
              <Label>Vehicle (optional)</Label>
              <Select value={form.vehicle_id || undefined} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>{(vehicles ?? []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.registration_no}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Driver (optional)</Label>
              <Select value={form.driver_id || undefined} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>{(drivers ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name.trim()}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manageRoute && (
        <ManageStopsDialog open={!!manageRoute} onOpenChange={o => !o && setManageRoute(null)} route={manageRoute} canManage={canManage} />
      )}

      {assignOpen && (
        <AssignStudentDialog open={assignOpen} onOpenChange={setAssignOpen} routes={routes ?? []} />
      )}

      <ConfirmDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)} title="Remove this route?"
        description="Routes with active student assignments or scheduled trips can't be deleted until cleared."
        destructive confirmLabel="Remove" loading={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate()} />
    </Card>
  )
}

function ManageStopsDialog({ open, onOpenChange, route, canManage }: { open: boolean; onOpenChange: (o: boolean) => void; route: any; canManage: boolean }) {
  const qc = useQueryClient()
  const [stopId, setStopId] = useState('')
  const [distance, setDistance] = useState('')
  const { data: allStops } = useQuery({ queryKey: ['transport-stops'], queryFn: () => transportApi.stops.list().then(r => r.data) })

  const currentStops: any[] = route.route_stops ?? []
  const usedStopIds = new Set(currentStops.map(rs => rs.stops?.id))
  const availableStops = (allStops ?? []).filter((s: any) => !usedStopIds.has(s.id))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['transport-routes'] })

  const addMutation = useMutation({
    mutationFn: () => transportApi.routes.addStop(route.id, { stop_id: stopId, sequence_no: currentStops.length, distance_from_school_km: distance ? Number(distance) : null }),
    onSuccess: () => { invalidate(); setStopId(''); setDistance(''); toast.success('Stop added to route') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add stop'),
  })
  const removeMutation = useMutation({
    mutationFn: (routeStopId: string) => transportApi.routes.removeStop(route.id, routeStopId),
    onSuccess: () => { invalidate(); toast.success('Stop removed from route') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove stop'),
  })
  const reorderMutation = useMutation({
    mutationFn: (updates: { id: string; sequence_no: number }[]) =>
      Promise.all(updates.map(u => transportApi.routes.updateStop(route.id, u.id, { sequence_no: u.sequence_no }))),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to reorder stops'),
  })

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= currentStops.length) return
    const a = currentStops[index], b = currentStops[target]
    reorderMutation.mutate([{ id: a.id, sequence_no: b.sequence_no }, { id: b.id, sequence_no: a.sequence_no }])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{route.name} — Stops</DialogTitle>
          <DialogDescription>Ordered pickup/drop sequence, with distance from school for fee-slab pricing.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {currentStops.length === 0 && <p className="text-sm text-muted-foreground">No stops on this route yet.</p>}
          {currentStops.map((rs, i) => (
            <div key={rs.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <span className="font-medium">{rs.stops?.name}</span>
                {rs.distance_from_school_km != null && <span className="text-muted-foreground">{rs.distance_from_school_km} km</span>}
              </div>
              {canManage && (
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === currentStops.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeMutation.mutate(rs.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canManage && (
          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label>Add stop</Label>
              <Select value={stopId || undefined} onValueChange={setStopId}>
                <SelectTrigger><SelectValue placeholder="Choose a stop" /></SelectTrigger>
                <SelectContent>{availableStops.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-28 space-y-1.5">
              <Label>Distance (km)</Label>
              <Input type="number" min={0} value={distance} onChange={e => setDistance(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={!stopId || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AssignStudentDialog({ open, onOpenChange, routes }: { open: boolean; onOpenChange: (o: boolean) => void; routes: any[] }) {
  const qc = useQueryClient()
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [routeId, setRouteId] = useState('')
  const [stopId, setStopId] = useState('')
  const [direction, setDirection] = useState('both')

  const selectedRoute = routes.find(r => r.id === routeId)
  const routeStops: any[] = selectedRoute?.route_stops ?? []

  const assignMutation = useMutation({
    mutationFn: () => transportApi.studentAssignment.set(student!.id, { route_id: routeId, stop_id: stopId, direction }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-routes'] })
      toast.success(`${studentLabel(student!)} assigned`)
      onOpenChange(false)
      setStudent(null); setRouteId(''); setStopId('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to assign student'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Assign Student to Transport</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Student</Label>
            <StudentSearch value={student} onSelect={setStudent} />
          </div>
          <div className="space-y-1.5">
            <Label>Route</Label>
            <Select value={routeId || undefined} onValueChange={v => { setRouteId(v); setStopId('') }}>
              <SelectTrigger><SelectValue placeholder="Choose a route" /></SelectTrigger>
              <SelectContent>{routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Stop</Label>
            <Select value={stopId || undefined} onValueChange={setStopId} disabled={!routeId}>
              <SelectTrigger><SelectValue placeholder={routeId ? 'Choose a stop' : 'Choose a route first'} /></SelectTrigger>
              <SelectContent>{routeStops.map((rs: any) => <SelectItem key={rs.stops?.id} value={rs.stops?.id}>{rs.stops?.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Direction</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Pickup & Drop</SelectItem>
                <SelectItem value="pickup">Pickup only</SelectItem>
                <SelectItem value="drop">Drop only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={assignMutation.isPending}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={!student || !routeId || !stopId || assignMutation.isPending}>
            {assignMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
