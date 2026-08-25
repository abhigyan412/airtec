'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { Plus, Trash2, Loader2, ClipboardList, Users2, MapPin, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

const SLOT_TYPES = [
  { value: 'entrance_exam', label: 'Entrance Exam' },
  { value: 'interview', label: 'Interview' },
  { value: 'campus_tour', label: 'Campus Tour' },
]

const ENTRANCE_MODES = [
  { value: 'interview', label: 'Interview' },
  { value: 'written_mcq', label: 'Written — MCQ' },
  { value: 'written_subjective', label: 'Written — Subjective' },
  { value: 'observation', label: 'Observation' },
  { value: 'previous_academic_percentage', label: 'Previous Academic Percentage' },
]

function entranceModeLabel(v: string) {
  return ENTRANCE_MODES.find(m => m.value === v)?.label ?? v
}

const SLOT_TYPE_BADGE: Record<string, 'info' | 'warning' | 'secondary'> = {
  entrance_exam: 'info',
  interview: 'warning',
  campus_tour: 'secondary',
}

const BOOKING_STATUS_BADGE: Record<string, 'info' | 'success' | 'warning' | 'destructive'> = {
  booked: 'info',
  attended: 'success',
  no_show: 'warning',
  cancelled: 'destructive',
}

function slotTypeLabel(v: string) {
  return SLOT_TYPES.find(t => t.value === v)?.label ?? v
}

function bookingSubjectName(b: any) {
  return b.admission_inquiries?.student_name
    ?? [b.admission_applications?.student_first_name, b.admission_applications?.student_last_name].filter(Boolean).join(' ')
    ?? 'Unknown'
}

export default function AdmissionSlotsPage() {
  const classStyle = useClassDisplayStyle()
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editingSlot, setEditingSlot] = useState<any | null>(null)
  const [bookingsFor, setBookingsFor] = useState<{ id: string; title: string } | null>(null)

  const { data: slots, isLoading } = useQuery({
    queryKey: ['admission-slots'],
    queryFn: () => admissionApi.slots.list().then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => admissionApi.slots.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-slots'] })
      toast.success('Slot removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove slot'),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entrance Test / Interview Slots"
        description="Bookable slots for entrance tests, interviews, and campus tours."
        icon={ClipboardList}
        className="mb-0"
        actions={<Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Slot</Button>}
      />

      <EntranceModeCard />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : !(slots ?? []).length ? (
        <EmptyState
          icon={ClipboardList}
          title="No slots scheduled"
          description="Create an entrance-test, interview, or campus-tour slot to start booking applicants into it."
          action={<Button onClick={() => setShowNew(true)}>New Slot</Button>}
          className="py-10"
        />
      ) : (
        <div className="space-y-3">
          {(slots ?? []).map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{s.title}</p>
                    <Badge variant={SLOT_TYPE_BADGE[s.slot_type] ?? 'secondary'}>{slotTypeLabel(s.slot_type)}</Badge>
                    {!s.class_id && s.slot_type !== 'campus_tour' && (
                      <Badge variant="warning" title="No class is linked — this slot won't appear in any candidate's Book a Slot list">
                        Not linked to a class
                      </Badge>
                    )}
                    {new Date(s.starts_at) < new Date() && (
                      <Badge variant="secondary" title="This slot's start time has already passed — it won't appear in any candidate's Book a Slot list">
                        Past
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground mt-1">
                    <span>{formatDate(s.starts_at)} · {new Date(s.starts_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                    {s.classes?.name && <span>· {classLabel(s.classes.name, s.classes.numeric_level, classStyle)}</span>}
                    {s.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.location}</span>}
                    {s.capacity != null && <span>· capacity {s.capacity}</span>}
                    {s.users?.full_name && <span>· {s.users.full_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setBookingsFor({ id: s.id, title: s.title })}>
                    <Users2 className="h-3.5 w-3.5" /> Bookings
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingSlot(s)}
                    aria-label={`Edit ${s.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => { if (confirm(`Delete "${s.title}"?`)) deleteMutation.mutate(s.id) }}
                    aria-label={`Delete ${s.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showNew && <SlotFormModal onClose={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['admission-slots'] }) }} />}
      {editingSlot && (
        <SlotFormModal
          slot={editingSlot}
          onClose={() => { setEditingSlot(null); qc.invalidateQueries({ queryKey: ['admission-slots'] }) }}
        />
      )}
      {bookingsFor && <BookingsModal slotId={bookingsFor.id} slotTitle={bookingsFor.title} onClose={() => setBookingsFor(null)} />}
    </div>
  )
}

function EntranceModeCard() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const classStyle = useClassDisplayStyle()
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admission-class-settings'],
    queryFn: () => admissionApi.classSettings.list().then(r => r.data),
    enabled: expanded,
  })

  const updateMutation = useMutation({
    mutationFn: ({ classId, data }: { classId: string; data: { entrance_mode?: string; pass_marks_percent?: number; admission_fee_amount?: number | null } }) =>
      admissionApi.classSettings.update(classId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-class-settings'] })
      toast.success('Updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  return (
    <Card>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <CardTitle className="text-sm">Entrance Mode &amp; Admission Fee by Class</CardTitle>
          <CardDescription className="text-xs mt-0.5">How each class's entrance assessment is conducted, its pass mark, and the admission fee due once admitted.</CardDescription>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <CardContent className="pt-0">
          {isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : (
            <div className="divide-y divide-border">
              {(settings ?? []).map((s: any) => (
                <div key={s.class_id} className="flex items-center justify-between py-2.5 gap-3 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{classLabel(s.class_name, s.numeric_level, classStyle)}</span>
                  {canManage ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={s.entrance_mode} onValueChange={(v) => updateMutation.mutate({ classId: s.class_id, data: { entrance_mode: v } })}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ENTRANCE_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(s.entrance_mode === 'written_mcq' || s.entrance_mode === 'written_subjective' || s.entrance_mode === 'previous_academic_percentage') && (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min={0} max={100} defaultValue={s.pass_marks_percent}
                            className="w-16 h-9"
                            onBlur={(e) => {
                              const v = Number(e.target.value)
                              if (v !== s.pass_marks_percent) updateMutation.mutate({ classId: s.class_id, data: { pass_marks_percent: v } })
                            }}
                          />
                          <span className="text-xs text-muted-foreground">% required</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 border-l border-border pl-2">
                        <span className="text-xs text-muted-foreground">₹</span>
                        <Input
                          type="number" min={0} step="1" defaultValue={s.admission_fee_amount ?? ''}
                          placeholder="Not set" className="w-24 h-9"
                          onBlur={(e) => {
                            const raw = e.target.value.trim()
                            const v = raw === '' ? null : Number(raw)
                            if (v !== (s.admission_fee_amount ?? null)) updateMutation.mutate({ classId: s.class_id, data: { admission_fee_amount: v } })
                          }}
                        />
                        <span className="text-xs text-muted-foreground">admission fee</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{entranceModeLabel(s.entrance_mode)}</Badge>
                      {(s.entrance_mode === 'written_mcq' || s.entrance_mode === 'written_subjective' || s.entrance_mode === 'previous_academic_percentage') && (
                        <span className="text-xs text-muted-foreground">{s.pass_marks_percent}% required</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.admission_fee_amount != null ? `₹${Number(s.admission_fee_amount).toLocaleString('en-IN')} admission fee` : 'Admission fee not set'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Local <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the
// viewer's own timezone — new Date(iso).toISOString() would silently shift
// an edited slot's time by the UTC offset, so this formats from the local
// getters instead.
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SlotFormModal({ slot, onClose }: { slot?: any; onClose: () => void }) {
  const isEdit = !!slot
  const classStyle = useClassDisplayStyle()
  const [form, setForm] = useState({
    slot_type: slot?.slot_type ?? 'entrance_exam',
    title: slot?.title ?? '',
    location: slot?.location ?? '',
    class_id: slot?.class_id ?? '',
    starts_at: toDatetimeLocalValue(slot?.starts_at),
    ends_at: toDatetimeLocalValue(slot?.ends_at),
    capacity: slot?.capacity != null ? String(slot.capacity) : '',
    notes: slot?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const { data: classes } = useQuery({
    queryKey: ['admission-classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  const { data: classSettings } = useQuery({
    queryKey: ['admission-class-settings'],
    queryFn: () => admissionApi.classSettings.list().then(r => r.data),
  })
  const selectedMode = classSettings?.find((s: any) => s.class_id === form.class_id)?.entrance_mode

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error('Title is required')
    if (!form.starts_at) return toast.error('Start date/time is required')
    if (new Date(form.starts_at) < new Date()) {
      return toast.error('Start date/time is in the past — candidates can only be booked into upcoming slots')
    }
    setSaving(true)
    try {
      const payload = {
        slot_type: form.slot_type,
        title: form.title.trim(),
        location: form.location.trim() || undefined,
        class_id: form.class_id || undefined,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        notes: form.notes.trim() || undefined,
      }
      if (isEdit) {
        await admissionApi.slots.update(slot.id, payload)
        toast.success('Slot updated')
      } else {
        await admissionApi.slots.create(payload)
        toast.success('Slot created')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? `Failed to ${isEdit ? 'update' : 'create'} slot`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Slot' : 'New Slot'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.slot_type} onValueChange={v => setForm(f => ({ ...f, slot_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLOT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-title">Title *</Label>
            <Input id="slot-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Class 3 Entrance Test — Morning" />
          </div>
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Select value={form.class_id} onValueChange={v => setForm(f => ({ ...f, class_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Not linked to any class" /></SelectTrigger>
              <SelectContent>
                {(classes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{classLabel(c.name, c.numeric_level, classStyle)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Leaving this unset hides the slot from every class's "Book a Slot" list — candidates are strictly
              filtered to their own applying-for class. Only leave it unset for a slot no candidate should book
              directly.
            </p>
            {form.slot_type === 'entrance_exam' && selectedMode && (
              <p className="text-xs text-muted-foreground">
                This class's configured entrance mode: <span className="font-medium text-foreground">{entranceModeLabel(selectedMode)}</span>
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="slot-starts">Starts *</Label>
              <Input id="slot-starts" type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-ends">Ends</Label>
              <Input id="slot-ends" type="datetime-local" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="slot-location">Location</Label>
              <Input id="slot-location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Main Hall" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot-capacity">Capacity</Label>
              <Input id="slot-capacity" type="number" min={1} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} placeholder="Unlimited" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-notes">Notes</Label>
            <Textarea id="slot-notes" rows={2} className="resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? 'Save Changes' : 'Create Slot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BookingsModal({ slotId, slotTitle, onClose }: { slotId: string; slotTitle: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: bookings, isLoading } = useQuery({
    queryKey: ['admission-slot-bookings', 'slot', slotId],
    queryFn: () => admissionApi.slotBookings.list({ slot_id: slotId }).then(r => r.data),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; marks_obtained?: number; max_marks?: number }) =>
      admissionApi.slotBookings.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-slot-bookings', 'slot', slotId] })
      toast.success('Booking updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update booking'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Bookings — {slotTitle}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
        ) : !(bookings ?? []).length ? (
          <EmptyState icon={Users2} title="No bookings yet" description="Book an inquiry or application into this slot from its detail page." className="py-8" />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto -mx-1 px-1">
            {(bookings ?? []).map((b: any) => (
              <div key={b.id} className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{bookingSubjectName(b)}</p>
                    {b.result && <p className="text-xs text-muted-foreground mt-0.5">{b.result}</p>}
                  </div>
                  <Select value={b.status} onValueChange={(v) => updateMutation.mutate({ id: b.id, status: v })}>
                    <SelectTrigger className="w-32 shrink-0">
                      <SelectValue>
                        <Badge variant={BOOKING_STATUS_BADGE[b.status] ?? 'secondary'} className="capitalize">{b.status.replace('_', ' ')}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="booked">Booked</SelectItem>
                      <SelectItem value="attended">Attended</SelectItem>
                      <SelectItem value="no_show">No Show</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pl-0.5">
                  <span className="text-xs text-muted-foreground">Marks</span>
                  <Input
                    type="number" min={0} defaultValue={b.marks_obtained ?? ''}
                    className="w-16 h-8 text-sm"
                    placeholder="—"
                    onBlur={(e) => {
                      // Found live 2026-08-25: v undefined !== b.marks_obtained
                      // null was true, so blurring an already-empty field (no
                      // typing at all) still fired an update — normalizing
                      // both to null before comparing is what "did this
                      // actually change" should have meant all along.
                      const v = e.target.value === '' ? undefined : Number(e.target.value)
                      if ((v ?? null) !== (b.marks_obtained ?? null)) updateMutation.mutate({ id: b.id, marks_obtained: v as any })
                    }}
                  />
                  <span className="text-xs text-muted-foreground">/</span>
                  <Input
                    type="number" min={1} defaultValue={b.max_marks ?? ''}
                    className="w-16 h-8 text-sm"
                    placeholder="max"
                    onBlur={(e) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value)
                      if ((v ?? null) !== (b.max_marks ?? null)) updateMutation.mutate({ id: b.id, max_marks: v as any })
                    }}
                  />
                  {b.is_pass != null && (
                    <Badge variant={b.is_pass ? 'success' : 'destructive'} className="ml-1">{b.is_pass ? 'Pass' : 'Fail'}</Badge>
                  )}
                </div>
                {b.marks_obtained != null && b.max_marks != null && <ResultWorkflowRow bookingId={b.id} />}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Phase 6c: compact status for the result-publishing workflow that
// auto-starts once both marks fields are set. Deliberately not a full
// step-tracker like WorkflowPipeline (that component is built around
// admission_application specifics — section pick, offer letter, etc.
// none of which apply here) — just enough to see where a result stands
// and act on it without leaving the Bookings dialog.
const ROLE_NAME_MAP: Record<string, string> = { school_admin: 'School Admin', principal: 'Principal', counselor: 'Counselor' }

function ResultWorkflowRow({ bookingId }: { bookingId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: workflow, isLoading } = useQuery({
    queryKey: ['admission-slot-booking-workflow', bookingId],
    queryFn: () => admissionApi.slotBookings.workflowStatus(bookingId).then(r => r.data),
  })

  const actMutation = useMutation({
    mutationFn: (status: 'approved' | 'rejected') => admissionApi.slotBookings.workflowAct(bookingId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-slot-booking-workflow', bookingId] })
      qc.invalidateQueries({ queryKey: ['admission-slot-bookings'] })
      toast.success('Recorded')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  if (isLoading) return <Skeleton className="h-6 w-40" />
  if (!workflow) return <p className="text-xs text-muted-foreground pl-0.5">Result workflow not started yet.</p>

  const currentStep = workflow.current_step
  const canAct = workflow.status === 'in_progress' && currentStep && (
    user?.role === 'school_admin' || ROLE_NAME_MAP[user?.role ?? ''] === currentStep.roles?.name
  )

  return (
    <div className="flex items-center justify-between gap-2 pl-0.5">
      <span className="text-xs text-muted-foreground">
        {workflow.status === 'approved' && 'Result published'}
        {workflow.status === 'rejected' && 'Result rejected'}
        {workflow.status === 'in_progress' && `Awaiting ${currentStep?.roles?.name ?? '…'}`}
      </span>
      {canAct && (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={actMutation.isPending} onClick={() => actMutation.mutate('approved')}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={actMutation.isPending} onClick={() => actMutation.mutate('rejected')}>
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}
