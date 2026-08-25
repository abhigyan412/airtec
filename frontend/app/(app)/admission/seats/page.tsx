'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { LayoutGrid, Settings2, Loader2, Lock, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

export default function AdmissionSeatsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const canLock = user?.role === 'school_admin'
  const classStyle = useClassDisplayStyle()
  const [editing, setEditing] = useState<{
    class_id: string; class_name: string; numeric_level: number | null; capacity: number; frozen: number; is_locked: boolean; lock_reason: string | null
    sections: { section_id: string; section_name: string; capacity: number }[]
  } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admission-seats'],
    queryFn: () => admissionApi.seats.list().then(r => r.data),
  })
  // Actual enrolled students per section — the seat ledger above tracks
  // admission-pipeline counters (reserved/confirmed against capacity),
  // not which section anyone actually landed in, so this is a second,
  // real source: whoever allots a section at admission time needs to see
  // how full each one already is, not just the class-level total.
  const { data: strength } = useQuery({
    queryKey: ['classes-strength'],
    queryFn: () => classesApi.strength().then(r => r.data),
  })
  const sectionsByClass = new Map<string, any[]>()
  for (const sec of strength?.sections ?? []) {
    const list = sectionsByClass.get(sec.class_id) ?? []
    list.push(sec)
    sectionsByClass.set(sec.class_id, list)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seat Availability"
        description="Stored ledger, not a live estimate — capacity minus frozen minus reserved (in-flight applications) minus confirmed (admitted students), per class. Section-wise strength below each card is live enrollment, for when you're allotting a section."
        icon={LayoutGrid}
        className="mb-0"
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : !(data ?? []).length ? (
        <EmptyState icon={LayoutGrid} title="No classes configured" description="Add classes under Classes & Sections first." className="h-64" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data ?? []).map((s: any) => (
            <Card key={s.class_id} className={s.is_locked ? 'border-destructive/40' : undefined}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    {classLabel(s.class_name, s.numeric_level, classStyle)}
                    {s.is_locked && <Lock className="h-3.5 w-3.5 text-destructive" aria-label="Locked" />}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {s.is_locked ? (
                      <Badge variant="destructive">Locked</Badge>
                    ) : s.unlimited ? (
                      <Badge variant="secondary">Unlimited</Badge>
                    ) : s.available <= 0 ? (
                      <Badge variant="destructive">Full</Badge>
                    ) : (
                      <Badge variant="success">{s.available} left</Badge>
                    )}
                    {canManage && !s.unlimited && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Adjust capacity / freeze / lock"
                        onClick={() => setEditing({
                          class_id: s.class_id, class_name: s.class_name, numeric_level: s.numeric_level, capacity: s.capacity, frozen: s.frozen,
                          is_locked: s.is_locked, lock_reason: s.lock_reason,
                          sections: (sectionsByClass.get(s.class_id) ?? []).map((sec: any) => ({
                            section_id: sec.section_id, section_name: sec.section_name, capacity: sec.capacity,
                          })),
                        })}>
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-foreground">{s.unlimited ? '—' : s.capacity}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Capacity</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{s.confirmed}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Confirmed</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{s.reserved}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Reserved</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{s.frozen}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Frozen</p>
                  </div>
                </div>
                {s.is_locked && s.lock_reason && (
                  <p className="text-xs text-muted-foreground italic">"{s.lock_reason}"</p>
                )}
                {(sectionsByClass.get(s.class_id) ?? []).length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Section-wise strength</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(sectionsByClass.get(s.class_id) ?? []).map((sec: any) => {
                        const full = sec.capacity > 0 && sec.enrolled >= sec.capacity
                        return (
                          <span key={sec.section_id}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${full ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                            title={`${sec.enrolled} enrolled${sec.capacity > 0 ? ` of ${sec.capacity} capacity` : ''}`}>
                            {sec.section_name}: {sec.enrolled}{sec.capacity > 0 ? `/${sec.capacity}` : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && <AdjustSeatsModal target={editing} canLock={canLock} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AdjustSeatsModal({ target, canLock, onClose }: {
  target: {
    class_id: string; class_name: string; numeric_level: number | null; capacity: number; frozen: number; is_locked: boolean; lock_reason: string | null
    sections: { section_id: string; section_name: string; capacity: number }[]
  }
  canLock: boolean
  onClose: () => void
}) {
  const classStyle = useClassDisplayStyle()
  const qc = useQueryClient()
  const [capacity, setCapacity] = useState(String(target.capacity))
  const [frozen, setFrozen] = useState(String(target.frozen))
  const [reason, setReason] = useState(target.lock_reason ?? '')
  const [sectionCaps, setSectionCaps] = useState<Record<string, string>>(
    Object.fromEntries(target.sections.map(sec => [sec.section_id, String(sec.capacity)]))
  )
  const [saving, setSaving] = useState(false)

  const sectionsTotal = target.sections.reduce((sum, sec) => sum + (Number(sectionCaps[sec.section_id]) || 0), 0)
  const capacityNum = Number(capacity) || 0
  const mismatch = target.sections.length > 0 && sectionsTotal !== capacityNum

  // No shared onSuccess/onError here — the lock button and Save button
  // each have different follow-up work (lock just closes; Save also
  // pushes section-capacity changes), so each call site supplies its own
  // callbacks instead of one that would fire for both.
  const mutation = useMutation({
    mutationFn: (data: { capacity?: number; frozen?: number; locked?: boolean; reason?: string }) =>
      admissionApi.seats.update(target.class_id, data),
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await mutation.mutateAsync({ capacity: Number(capacity), frozen: Number(frozen), reason: reason.trim() || undefined })

      // Only push section capacities that actually changed — no point
      // rewriting every section on every save.
      const changed = target.sections.filter(sec => Number(sectionCaps[sec.section_id]) !== sec.capacity)
      await Promise.all(changed.map(sec =>
        classesApi.sections.update(sec.section_id, { max_strength: Number(sectionCaps[sec.section_id]) })
      ))

      qc.invalidateQueries({ queryKey: ['admission-seats'] })
      qc.invalidateQueries({ queryKey: ['classes-strength'] })
      toast.success('Seat ledger updated')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update sections')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Adjust {classLabel(target.class_name, target.numeric_level, classStyle)} Seats</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seat-capacity">Capacity</Label>
            <Input id="seat-capacity" type="number" min={0} value={capacity} onChange={e => setCapacity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seat-frozen">Frozen (buffer, held back)</Label>
            <Input id="seat-frozen" type="number" min={0} value={frozen} onChange={e => setFrozen(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seat-reason">Reason (optional)</Label>
            <Input id="seat-reason" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. holding 2 seats for staff wards, or why this class is locked" />
          </div>

          {target.sections.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <Label>Section capacities</Label>
                {mismatch && (
                  <button type="button" className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setCapacity(String(sectionsTotal))}>
                    Set capacity to {sectionsTotal}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {target.sections.map(sec => (
                  <div key={sec.section_id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">{sec.section_name}</span>
                    <Input
                      type="number" min={0} className="w-20 h-8"
                      value={sectionCaps[sec.section_id] ?? ''}
                      onChange={e => setSectionCaps(v => ({ ...v, [sec.section_id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <p className={`text-xs ${mismatch ? 'text-destructive' : 'text-muted-foreground'}`}>
                Sections total {sectionsTotal}{mismatch ? ` — doesn't match capacity (${capacityNum})` : ' — matches capacity'}
              </p>
            </div>
          )}

          {canLock && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">
                Locking blocks new applications to this class entirely, on top of capacity. School Admin only.
              </p>
              <Button
                variant={target.is_locked ? 'outline' : 'destructive'}
                size="sm"
                className="w-full"
                onClick={() => mutation.mutate({ locked: !target.is_locked, reason: reason.trim() || undefined }, {
                  onSuccess: () => {
                    qc.invalidateQueries({ queryKey: ['admission-seats'] })
                    toast.success(target.is_locked ? 'Class unlocked' : 'Class locked')
                    onClose()
                  },
                  onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
                })}
                disabled={mutation.isPending || saving}
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : target.is_locked ? (
                  <><Unlock className="h-4 w-4" /> Unlock Class</>
                ) : (
                  <><Lock className="h-4 w-4" /> Lock Class</>
                )}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || mutation.isPending}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
