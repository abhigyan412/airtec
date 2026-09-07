'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bus, Loader2, Plus, Trash2, Save, Upload } from 'lucide-react'
import { transportApi, feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkflowSettingsCard } from '@/components/shared/WorkflowSettingsCard'
import { ImportCsvDialog } from '@/components/shared/ImportCsvDialog'
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

const TABS = ['Fee Slabs', 'Boarding & Notifications', 'Workflows']

// First settings surface for Transport — same "school configures the
// rules" shape as Result Settings and HR/SIS Settings: fee slabs are
// school-defined bands (not a hardcoded formula), boarding method and
// alert triggers are toggles, and all three approval chains
// (route/stop change, vehicle onboarding, driver reassignment) reuse the
// same shared workflow engine every other module's settings page uses.
export default function TransportSettingsPage() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState(TABS.includes(initialTab ?? '') ? initialTab! : 'Fee Slabs')
  const { can } = usePermissions()
  const canManage = can('transport.settings_manage')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport Settings"
        description="Configure fee slabs, boarding method, parent alerts and approval chains for the transport module."
        icon={Bus}
        className="mb-0"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="Fee Slabs">Fee Slabs</TabsTrigger>
          <TabsTrigger value="Boarding & Notifications">Boarding & Notifications</TabsTrigger>
          <TabsTrigger value="Workflows">Workflows</TabsTrigger>
        </TabsList>

        <TabsContent value="Fee Slabs" className="mt-6">
          <FeeSlabsTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="Boarding & Notifications" className="mt-6">
          <GeneralSettingsTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="Workflows" className="mt-6 space-y-4">
          <WorkflowSettingsCard
            title="Route & Stop Change Approval Workflow"
            description="Choose how many approval steps a route or stop change goes through before it takes effect."
            queryKey="transport-workflow-route-change"
            apiPath="/transport/settings/workflow/route-change"
            canManage={canManage}
          />
          <WorkflowSettingsCard
            title="New Vehicle Onboarding Workflow"
            description="Choose how many approval steps adding a new vehicle to the fleet goes through."
            queryKey="transport-workflow-vehicle-onboarding"
            apiPath="/transport/settings/workflow/vehicle-onboarding"
            canManage={canManage}
          />
          <WorkflowSettingsCard
            title="Driver Reassignment Approval Workflow"
            description="Choose how many approval steps reassigning a driver to a different route goes through."
            queryKey="transport-workflow-driver-reassignment"
            apiPath="/transport/settings/workflow/driver-reassignment"
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GeneralSettingsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['transport-settings-general'],
    queryFn: () => transportApi.settings.get().then(r => r.data),
  })
  const [form, setForm] = useState<any>(null)
  const current = form ?? data

  const saveMutation = useMutation({
    mutationFn: () => transportApi.settings.save(current),
    onSuccess: () => {
      toast.success('Settings saved')
      qc.invalidateQueries({ queryKey: ['transport-settings-general'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  if (isLoading || !current) return <Skeleton className="h-72 w-full max-w-xl rounded-xl" />

  const set = (patch: any) => setForm({ ...current, ...patch })

  return (
    <Card className="max-w-xl space-y-6 p-6">
      <div className="space-y-2">
        <Label>Boarding method</Label>
        <div className="flex flex-wrap gap-2">
          {(['manual', 'rfid', 'app'] as const).map(method => (
            <button key={method} type="button" disabled={!canManage} onClick={() => set({ boarding_method: method })}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-all disabled:opacity-60 ${current.boarding_method === method ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-foreground/30'}`}>
              {method === 'rfid' ? 'RFID scan' : method === 'app' ? 'Parent app self-report' : 'Manual roll-call'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label>Parent notification triggers</Label>
        {[
          ['notify_boarded', 'Student boarded'],
          ['notify_alighted', 'Student alighted'],
          ['notify_delayed', 'Trip delayed'],
          ['notify_approaching', 'Bus approaching stop'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canManage} checked={!!current[key]}
              onChange={e => set({ [key]: e.target.checked })} className="h-4 w-4 rounded border-input" />
            {label}
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={!canManage} checked={!!current.sync_boarding_to_attendance}
          onChange={e => set({ sync_boarding_to_attendance: e.target.checked })} className="h-4 w-4 rounded border-input" />
        Also mark boarding events in the main Attendance module
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="lead-days">Compliance document expiry alert — days in advance</Label>
        <Input id="lead-days" type="number" min={1} max={365} disabled={!canManage}
          value={current.compliance_alert_lead_days}
          onChange={e => set({ compliance_alert_lead_days: Number(e.target.value) })} className="w-32" />
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={!form || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      )}
    </Card>
  )
}

function FeeSlabsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', fee_head_id: '', min_distance_km: '', max_distance_km: '', amount: '' })

  const { data: slabs, isLoading } = useQuery({
    queryKey: ['transport-fee-slabs'],
    queryFn: () => transportApi.feeSlabs.list().then(r => r.data),
  })
  const { data: feeHeads } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => transportApi.feeSlabs.create({
      label: form.label.trim(),
      fee_head_id: form.fee_head_id,
      min_distance_km: form.min_distance_km ? Number(form.min_distance_km) : null,
      max_distance_km: form.max_distance_km ? Number(form.max_distance_km) : null,
      amount: Number(form.amount),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-fee-slabs'] })
      setAddOpen(false)
      setForm({ label: '', fee_head_id: '', min_distance_km: '', max_distance_km: '', amount: '' })
      toast.success('Fee slab added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add fee slab'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => transportApi.feeSlabs.delete(deleteId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-fee-slabs'] })
      setDeleteId(null)
      toast.success('Fee slab removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove fee slab'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Define your own distance bands or named zones — students are billed off whichever slab their assigned stop falls into.
        </p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Slab</Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Fee Head</TableHead>
              <TableHead>Distance range (km)</TableHead>
              <TableHead>Amount</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(slabs ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No fee slabs configured yet.</TableCell></TableRow>
            )}
            {(slabs ?? []).map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.label}</TableCell>
                <TableCell>{s.fee_heads?.name ?? '—'}</TableCell>
                <TableCell>{s.min_distance_km != null || s.max_distance_km != null ? `${s.min_distance_km ?? 0} – ${s.max_distance_km ?? '∞'}` : '—'}</TableCell>
                <TableCell>₹{Number(s.amount).toLocaleString()}</TableCell>
                {canManage && (
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Fee Slab</DialogTitle>
            <DialogDescription>A named zone or distance band, and the flat amount it bills.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="slab-label">Label</Label>
              <Input id="slab-label" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Zone A / 0-5 km" />
            </div>
            <div className="space-y-1.5">
              <Label>Fee head this slab prices</Label>
              <Select value={form.fee_head_id || undefined} onValueChange={v => setForm(f => ({ ...f, fee_head_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a fee head" /></SelectTrigger>
                <SelectContent>
                  {(feeHeads ?? []).map((h: any) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="slab-min">Min distance (km, optional)</Label>
                <Input id="slab-min" type="number" min={0} value={form.min_distance_km} onChange={e => setForm(f => ({ ...f, min_distance_km: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slab-max">Max distance (km, optional)</Label>
                <Input id="slab-max" type="number" min={0} value={form.max_distance_km} onChange={e => setForm(f => ({ ...f, max_distance_km: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slab-amount">Amount</Label>
              <Input id="slab-amount" type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.label.trim() || !form.fee_head_id || !form.amount}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
        title="Remove this fee slab?"
        description="Students currently billed off this slab will fall back to the flat structure amount until reassigned to another slab."
        destructive
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Fee Slabs"
        columns={['label', 'fee_head_name', 'min_distance_km', 'max_distance_km', 'amount']}
        sampleRow={['Zone A (0-5km)', 'Transport Fee', '0', '5', '800']}
        invalidateQueryKey={['transport-fee-slabs']}
        onImport={rows => transportApi.feeSlabs.import(rows).then((r: any) => r.data)}
      />
    </Card>
  )
}
