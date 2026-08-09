'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

const BLANK_FORM = {
  name: '', code: '', default_days_per_year: 0, is_paid: true, carry_forward: false,
  accrual_frequency: 'annual' as 'annual' | 'monthly', max_carry_forward_days: 0,
  is_encashable: false, is_comp_off: false,
}

// Leave-type policy configuration — previously there was no way to
// create or edit a leave type at all; every row came from the demo
// seeder. This is the first UI for it, so it covers every column
// including the accrual/carry-forward/encashment/comp-off policy
// fields added alongside it.
export function ManageLeaveTypesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)

  const { data: leaveTypes, isLoading } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => hrmsApi.leaveTypes.list().then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['leave-types'] })

  const saveMutation = useMutation({
    mutationFn: () => editingId ? hrmsApi.leaveTypes.update(editingId, form) : hrmsApi.leaveTypes.create(form),
    onSuccess: () => {
      toast.success(editingId ? 'Leave type updated' : 'Leave type created')
      invalidate()
      setShowForm(false)
      setEditingId(null)
      setForm(BLANK_FORM)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.leaveTypes.delete(id),
    onSuccess: () => { toast.success('Leave type deleted'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  const startEdit = (lt: any) => {
    setEditingId(lt.id)
    setForm({
      name: lt.name, code: lt.code, default_days_per_year: lt.default_days_per_year ?? 0,
      is_paid: lt.is_paid ?? true, carry_forward: lt.carry_forward ?? false,
      accrual_frequency: lt.accrual_frequency ?? 'annual', max_carry_forward_days: lt.max_carry_forward_days ?? 0,
      is_encashable: lt.is_encashable ?? false, is_comp_off: lt.is_comp_off ?? false,
    })
    setShowForm(true)
  }

  const startNew = () => {
    setEditingId(null)
    setForm(BLANK_FORM)
    setShowForm(true)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Manage Leave Types</DialogTitle></DialogHeader>

        {!showForm ? (
          <div className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {(leaveTypes ?? []).map((lt: any) => (
                  <div key={lt.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{lt.name} <span className="font-normal text-muted-foreground">({lt.code})</span></p>
                      <p className="text-xs text-muted-foreground">
                        {lt.default_days_per_year} days/yr · {lt.accrual_frequency === 'monthly' ? 'Monthly accrual' : 'Annual lump-sum'}
                        {lt.carry_forward && ` · carries forward up to ${lt.max_carry_forward_days}d`}
                        {lt.is_encashable && ' · encashable'}
                        {lt.is_comp_off && ' · comp-off'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(lt)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(lt.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
                {!isLoading && (leaveTypes ?? []).length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No leave types configured yet.</p>
                )}
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={startNew}><Plus className="h-4 w-4" /> Add Leave Type</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Days per year</Label>
                <Input type="number" min={0} value={form.default_days_per_year}
                  onChange={e => setForm(f => ({ ...f, default_days_per_year: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Accrual</Label>
                <Select value={form.accrual_frequency} onValueChange={(v: any) => setForm(f => ({ ...f, accrual_frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual lump-sum</SelectItem>
                    <SelectItem value="monthly">Monthly credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="accent-primary" checked={form.is_paid} onChange={e => setForm(f => ({ ...f, is_paid: e.target.checked }))} /> Paid leave
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="accent-primary" checked={form.carry_forward} onChange={e => setForm(f => ({ ...f, carry_forward: e.target.checked }))} /> Carries forward to next year
            </label>
            {form.carry_forward && (
              <div className="space-y-1.5 pl-6">
                <Label>Max carry-forward days</Label>
                <Input type="number" min={0} value={form.max_carry_forward_days}
                  onChange={e => setForm(f => ({ ...f, max_carry_forward_days: Number(e.target.value) }))} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="accent-primary" checked={form.is_encashable} onChange={e => setForm(f => ({ ...f, is_encashable: e.target.checked }))} /> Unused days beyond carry-forward are encashable
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="accent-primary" checked={form.is_comp_off}
                onChange={e => setForm(f => ({ ...f, is_comp_off: e.target.checked }))} /> This is the comp-off leave type
            </label>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Back</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name || !form.code}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
