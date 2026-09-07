'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Truck, Loader2, Plus, Trash2, FileText, AlertTriangle, CalendarOff, Upload } from 'lucide-react'
import { transportApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { ImportCsvDialog } from '@/components/shared/ImportCsvDialog'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const EXPIRY_WARNING_DAYS = 30

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// Worst-case expiry across a vehicle/driver's own documents — drives the
// row's compliance badge without needing a second round-trip; the
// compliance-alert cron (transportComplianceAlerts.ts) is what actually
// notifies people, this is just a glance-level indicator here.
function complianceBadge(docs: { expiry_date: string | null }[]) {
  const withExpiry = docs.filter(d => d.expiry_date)
  if (!withExpiry.length) return null
  const soonest = Math.min(...withExpiry.map(d => daysUntil(d.expiry_date!)))
  if (soonest < 0) return <Badge variant="destructive">Document expired</Badge>
  if (soonest <= EXPIRY_WARNING_DAYS) return <Badge variant="warning">Expires in {soonest}d</Badge>
  return null
}

export default function TransportFleetPage() {
  const { can } = usePermissions()
  const canManage = can('transport.manage_fleet')
  const canManageTrips = can('transport.manage_trips')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="Vehicles, drivers, and their compliance documents."
        icon={Truck}
        className="mb-0"
      />

      <Tabs defaultValue="Vehicles">
        <TabsList>
          <TabsTrigger value="Vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="Drivers">Drivers</TabsTrigger>
        </TabsList>
        <TabsContent value="Vehicles" className="mt-6">
          <VehiclesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="Drivers" className="mt-6">
          <DriversTab canManage={canManage} canManageTrips={canManageTrips} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function VehiclesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [docsFor, setDocsFor] = useState<any | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ registration_no: '', vehicle_type: 'bus', capacity: '' })

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['transport-vehicles'],
    queryFn: () => transportApi.vehicles.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => transportApi.vehicles.create({ ...form, capacity: Number(form.capacity) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] })
      setAddOpen(false)
      setForm({ registration_no: '', vehicle_type: 'bus', capacity: '' })
      toast.success('Vehicle added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add vehicle'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => transportApi.vehicles.delete(deleteId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] })
      setDeleteId(null)
      toast.success('Vehicle removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove vehicle'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Your fleet's vehicles and their compliance status.</p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Vehicle</Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Registration No.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(vehicles ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No vehicles added yet.</TableCell></TableRow>
            )}
            {(vehicles ?? []).map((v: any) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.registration_no}</TableCell>
                <TableCell className="capitalize">{v.vehicle_type}</TableCell>
                <TableCell>{v.capacity}</TableCell>
                <TableCell className="capitalize">{v.status.replace('_', ' ')}</TableCell>
                <TableCell>{complianceBadge(v.vehicle_documents ?? [])}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setDocsFor(v)} aria-label="Documents">
                      <FileText className="h-4 w-4" />
                    </Button>
                    {canManage && (
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(v.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Vehicle</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="veh-reg">Registration number</Label>
              <Input id="veh-reg" value={form.registration_no} onChange={e => setForm(f => ({ ...f, registration_no: e.target.value }))} placeholder="e.g. DL 1P 1234" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.vehicle_type} onValueChange={v => setForm(f => ({ ...f, vehicle_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['bus', 'van', 'minibus', 'car', 'other'].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="veh-cap">Capacity (seats)</Label>
              <Input id="veh-cap" type="number" min={1} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.registration_no.trim() || !form.capacity}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Vehicles"
        columns={['registration_no', 'vehicle_type', 'capacity', 'status']}
        sampleRow={['DL 1P 1234', 'bus', '40', 'active']}
        invalidateQueryKey={['transport-vehicles']}
        onImport={rows => transportApi.vehicles.import(rows).then((r: any) => r.data)}
      />

      {docsFor && (
        <DocumentsDialog
          open={!!docsFor}
          onOpenChange={open => !open && setDocsFor(null)}
          title={`${docsFor.registration_no} — Documents`}
          docTypes={['rc', 'insurance', 'permit', 'fitness', 'pollution', 'other']}
          canManage={canManage}
          queryKey={['transport-vehicles']}
          list={() => transportApi.vehicles.list().then((r: any) => (r.data.find((v: any) => v.id === docsFor.id)?.vehicle_documents ?? []))}
          docsListQueryKey={['transport-vehicles']}
          onAdd={data => transportApi.vehicles.addDocument(docsFor.id, data)}
          onDelete={docId => transportApi.vehicles.deleteDocument(docsFor.id, docId)}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Remove this vehicle?"
        description="This cannot be undone. Vehicles assigned to a route can't be deleted until reassigned."
        destructive
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Card>
  )
}

function DriversTab({ canManage, canManageTrips }: { canManage: boolean; canManageTrips: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [docsFor, setDocsFor] = useState<any | null>(null)
  const [absentFor, setAbsentFor] = useState<any | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ full_name: '', phone: '', license_no: '', license_expiry: '' })

  const { data: drivers, isLoading } = useQuery({
    queryKey: ['transport-drivers'],
    queryFn: () => transportApi.drivers.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => transportApi.drivers.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] })
      setAddOpen(false)
      setForm({ full_name: '', phone: '', license_no: '', license_expiry: '' })
      toast.success('Driver added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add driver'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => transportApi.drivers.delete(deleteId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] })
      setDeleteId(null)
      toast.success('Driver removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove driver'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Your school's drivers and their compliance status.</p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Driver</Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>License No.</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(drivers ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No drivers added yet.</TableCell></TableRow>
            )}
            {(drivers ?? []).map((d: any) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.full_name}</TableCell>
                <TableCell>{d.phone ?? '—'}</TableCell>
                <TableCell>{d.license_no}</TableCell>
                <TableCell className="capitalize">{d.status.replace('_', ' ')}</TableCell>
                <TableCell>{complianceBadge(d.driver_documents ?? [])}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setDocsFor(d)} aria-label="Documents">
                      <FileText className="h-4 w-4" />
                    </Button>
                    {canManageTrips && (
                      <Button variant="ghost" size="icon" onClick={() => setAbsentFor(d)} aria-label="Mark absent">
                        <CalendarOff className="h-4 w-4" />
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(d.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Driver</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="drv-name">Full name</Label>
              <Input id="drv-name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drv-phone">Phone</Label>
              <Input id="drv-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drv-license">License number</Label>
              <Input id="drv-license" value={form.license_no} onChange={e => setForm(f => ({ ...f, license_no: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drv-expiry">License expiry</Label>
              <Input id="drv-expiry" type="date" value={form.license_expiry} onChange={e => setForm(f => ({ ...f, license_expiry: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.full_name.trim() || !form.license_no.trim()}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Drivers"
        columns={['full_name', 'phone', 'license_no', 'license_class', 'license_expiry', 'status']}
        sampleRow={['Ramesh Kumar', '9876543210', 'DL-0420110012345', 'HMV', '2028-06-30', 'active']}
        invalidateQueryKey={['transport-drivers']}
        onImport={rows => transportApi.drivers.import(rows).then((r: any) => r.data)}
      />

      {docsFor && (
        <DocumentsDialog
          open={!!docsFor}
          onOpenChange={open => !open && setDocsFor(null)}
          title={`${docsFor.full_name} — Documents`}
          docTypes={['license', 'medical_certificate', 'police_verification', 'other']}
          canManage={canManage}
          queryKey={['transport-drivers']}
          list={() => transportApi.drivers.list().then((r: any) => (r.data.find((d: any) => d.id === docsFor.id)?.driver_documents ?? []))}
          docsListQueryKey={['transport-drivers']}
          onAdd={data => transportApi.drivers.addDocument(docsFor.id, data)}
          onDelete={docId => transportApi.drivers.deleteDocument(docsFor.id, docId)}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Remove this driver?"
        description="This cannot be undone. Drivers assigned to a route can't be deleted until reassigned."
        destructive
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

      {absentFor && <MarkAbsentDialog open={!!absentFor} onOpenChange={o => !o && setAbsentFor(null)} driver={absentFor} />}
    </Card>
  )
}

function MarkAbsentDialog({ open, onOpenChange, driver }: { open: boolean; onOpenChange: (o: boolean) => void; driver: any }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => transportApi.driverAbsences.create(driver.id, { absence_date: date, reason: reason.trim() || undefined }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['transport-substitute-assignments'] })
      const n = res?.data?.materialized ?? 0
      toast.success(n > 0 ? `Marked absent — ${n} trip${n === 1 ? '' : 's'} now need a substitute driver.` : 'Marked absent')
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record absence'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {driver.full_name} Absent</DialogTitle>
          <DialogDescription>Any trip this driver is scheduled for on this date will need a substitute.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Mark Absent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Shared documents dialog for a vehicle or driver — lists its
// vehicle_documents/driver_documents, lets you add one (type + number +
// dates) and delete one. `list` re-derives the current doc list from the
// already-loaded vehicles/drivers query rather than a separate endpoint,
// since Phase 1 has no standalone GET .../documents route.
function DocumentsDialog({ open, onOpenChange, title, docTypes, canManage, list, docsListQueryKey, onAdd, onDelete }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  docTypes: string[]
  canManage: boolean
  queryKey: string[]
  list: () => Promise<any[]>
  docsListQueryKey: string[]
  onAdd: (data: any) => Promise<any>
  onDelete: (docId: string) => Promise<any>
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ doc_type: docTypes[0], document_no: '', expiry_date: '' })

  const { data: docs, isLoading } = useQuery({
    queryKey: [...docsListQueryKey, 'documents', title],
    queryFn: list,
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: () => onAdd(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: docsListQueryKey })
      qc.invalidateQueries({ queryKey: [...docsListQueryKey, 'documents', title] })
      setForm({ doc_type: docTypes[0], document_no: '', expiry_date: '' })
      toast.success('Document added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add document'),
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => onDelete(docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: docsListQueryKey })
      qc.invalidateQueries({ queryKey: [...docsListQueryKey, 'documents', title] })
      toast.success('Document removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove document'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Compliance documents and their expiry dates.</DialogDescription>
        </DialogHeader>

        {isLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : (
          <div className="space-y-2">
            {(docs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No documents added yet.</p>}
            {(docs ?? []).map((d: any) => {
              const expired = d.expiry_date && daysUntil(d.expiry_date) < 0
              const soon = d.expiry_date && !expired && daysUntil(d.expiry_date) <= EXPIRY_WARNING_DAYS
              return (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    {(expired || soon) && <AlertTriangle className={cn('h-3.5 w-3.5', expired ? 'text-destructive' : 'text-warning')} />}
                    <span className="font-medium capitalize">{d.doc_type.replace('_', ' ')}</span>
                    {d.expiry_date && <span className="text-muted-foreground">expires {d.expiry_date}</span>}
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {canManage && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Document type</Label>
                <Select value={form.doc_type} onValueChange={v => setForm(f => ({ ...f, doc_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {docTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expiry date</Label>
                <Input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Document number (optional)</Label>
              <Input value={form.document_no} onChange={e => setForm(f => ({ ...f, document_no: e.target.value }))} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add Document
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
