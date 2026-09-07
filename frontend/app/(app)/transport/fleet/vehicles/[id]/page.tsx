'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Trash2, AlertTriangle, Wrench, FileText, Route as RouteIcon, CalendarClock } from 'lucide-react'
import Link from 'next/link'
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function expiryBadge(dateStr: string | null) {
  if (!dateStr) return null
  const d = daysUntil(dateStr)
  if (d < 0) return <Badge variant="destructive">Expired</Badge>
  if (d <= 30) return <Badge variant="warning">{d}d left</Badge>
  return <Badge variant="secondary">{dateStr}</Badge>
}

const DOC_TYPES = ['rc', 'insurance', 'permit', 'fitness', 'pollution', 'other']

export default function VehicleProfilePage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('transport.manage_fleet')

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['transport-vehicle', id],
    queryFn: () => transportApi.vehicles.get(id).then(r => r.data),
  })

  const [docForm, setDocForm] = useState({ doc_type: 'rc', document_no: '', expiry_date: '' })
  const [docFile, setDocFile] = useState<File | null>(null)
  const [serviceForm, setServiceForm] = useState({ service_date: '', service_type: 'routine', odometer_km: '', cost: '', next_service_due_date: '', notes: '' })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['transport-vehicle', id] }); qc.invalidateQueries({ queryKey: ['transport-vehicles'] }) }

  const addDocMutation = useMutation({
    mutationFn: () => new Promise<void>((resolve, reject) => {
      if (!docFile) return transportApi.vehicles.addDocument(id, docForm).then(() => resolve()).catch(reject)
      const reader = new FileReader()
      reader.onload = () => {
        transportApi.vehicles.addDocument(id, { ...docForm, file_base64: reader.result, file_name: docFile.name, mime_type: docFile.type })
          .then(() => resolve()).catch(reject)
      }
      reader.onerror = () => reject(new Error('Could not read that file'))
      reader.readAsDataURL(docFile)
    }),
    onSuccess: () => { invalidate(); setDocForm({ doc_type: 'rc', document_no: '', expiry_date: '' }); setDocFile(null); toast.success('Document added') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add document'),
  })
  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) => transportApi.vehicles.deleteDocument(id, docId),
    onSuccess: () => { invalidate(); toast.success('Document removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove document'),
  })

  const addServiceMutation = useMutation({
    mutationFn: () => transportApi.vehicles.addServiceRecord(id, {
      ...serviceForm,
      odometer_km: serviceForm.odometer_km ? Number(serviceForm.odometer_km) : null,
      cost: serviceForm.cost ? Number(serviceForm.cost) : null,
      next_service_due_date: serviceForm.next_service_due_date || null,
    }),
    onSuccess: () => {
      invalidate()
      setServiceForm({ service_date: '', service_type: 'routine', odometer_km: '', cost: '', next_service_due_date: '', notes: '' })
      toast.success('Service record added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add service record'),
  })
  const deleteServiceMutation = useMutation({
    mutationFn: (recordId: string) => transportApi.vehicles.deleteServiceRecord(id, recordId),
    onSuccess: () => { invalidate(); toast.success('Service record removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove service record'),
  })

  if (isLoading || !vehicle) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  const latestServiceDue = vehicle.service_records?.find((r: any) => r.next_service_due_date)?.next_service_due_date

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/transport/fleet" aria-label="Back to fleet"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title={vehicle.registration_no}
          description={`${vehicle.vehicle_type} · ${vehicle.capacity} seats · ${vehicle.status.replace('_', ' ')}`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><RouteIcon className="h-4 w-4" /> Assigned Route</h3>
          {vehicle.route ? (
            <div className="text-sm">
              <p className="font-medium">{vehicle.route.name}</p>
              <p className="text-muted-foreground">Driver: {vehicle.route.drivers?.full_name ?? 'Unassigned'}</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">Not assigned to any route.</p>}
        </Card>

        <Card className="p-5 space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Recent Trips</h3>
          {(vehicle.recent_trips ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No trips logged yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {vehicle.recent_trips.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between">
                  <span>{t.trip_date} · {t.shift} · {t.routes?.name}</span>
                  <Badge variant="secondary" className="capitalize">{t.status.replace('_', ' ')}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <FileText className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Compliance Documents</h3>
        </div>
        <div className="p-5 space-y-3">
          {(vehicle.documents ?? []).length === 0 && <p className="text-sm text-muted-foreground">No documents added yet.</p>}
          {(vehicle.documents ?? []).map((d: any) => {
            const expired = d.expiry_date && daysUntil(d.expiry_date) < 0
            return (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {expired && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                  <span className="font-medium capitalize">{d.doc_type.replace('_', ' ')}</span>
                  {d.document_no && <span className="text-muted-foreground">{d.document_no}</span>}
                  {d.file_url ? (
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View file{d.file_size ? ` (${d.file_size})` : ''}</a>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No file attached</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {expiryBadge(d.expiry_date)}
                  {canManage && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteDocMutation.mutate(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}

          {canManage && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={docForm.doc_type} onValueChange={v => setDocForm(f => ({ ...f, doc_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Document No.</Label><Input value={docForm.document_no} onChange={e => setDocForm(f => ({ ...f, document_no: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Expiry</Label><Input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label>File (optional)</Label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setDocFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
                </div>
                <Button size="sm" onClick={() => addDocMutation.mutate()} disabled={addDocMutation.isPending}>
                  {addDocMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Wrench className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Service &amp; Maintenance History</h3>
          {latestServiceDue && <span className="ml-auto">{expiryBadge(latestServiceDue)}</span>}
        </div>
        <div className="p-5 space-y-3">
          {(vehicle.service_records ?? []).length === 0 && <p className="text-sm text-muted-foreground">No service records yet.</p>}
          {(vehicle.service_records ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{r.service_type}</span>
                  <span className="text-muted-foreground">{r.service_date}</span>
                  {r.odometer_km != null && <span className="text-muted-foreground">{r.odometer_km} km</span>}
                  {r.cost != null && <span className="text-muted-foreground">₹{Number(r.cost).toLocaleString()}</span>}
                </div>
                {r.notes && <p className="text-xs text-muted-foreground mt-0.5">{r.notes}</p>}
                {r.next_service_due_date && <p className="text-xs text-muted-foreground mt-0.5">Next due: {r.next_service_due_date}</p>}
              </div>
              {canManage && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteServiceMutation.mutate(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}

          {canManage && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Service date</Label><Input type="date" value={serviceForm.service_date} onChange={e => setServiceForm(f => ({ ...f, service_date: e.target.value }))} /></div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={serviceForm.service_type} onValueChange={v => setServiceForm(f => ({ ...f, service_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['routine', 'repair', 'inspection', 'other'].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Odometer (km, optional)</Label><Input type="number" value={serviceForm.odometer_km} onChange={e => setServiceForm(f => ({ ...f, odometer_km: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Cost (optional)</Label><Input type="number" value={serviceForm.cost} onChange={e => setServiceForm(f => ({ ...f, cost: e.target.value }))} /></div>
              </div>
              <div className="space-y-1.5"><Label>Next service due (optional)</Label><Input type="date" value={serviceForm.next_service_due_date} onChange={e => setServiceForm(f => ({ ...f, next_service_due_date: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Notes (optional)</Label><Input value={serviceForm.notes} onChange={e => setServiceForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => addServiceMutation.mutate()} disabled={!serviceForm.service_date || addServiceMutation.isPending}>
                  {addServiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Record
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
