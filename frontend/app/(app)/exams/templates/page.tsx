'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { Plus, Trash2, Loader2, ArrowLeft, Clock, LayoutTemplate, BookOpen, Sparkles, ShieldOff } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const EXAM_TYPES = ['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']
const titleCase = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ExamTemplatesPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('exam.schedule')
  const [showAddSlot, setShowAddSlot] = useState(false)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null)
  const [slotForm, setSlotForm] = useState({ name: '', start_time: '', end_time: '' })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })

  const { data: timeSlots, isLoading: slotsLoading } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
    enabled: canManage,
  })

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['exam-templates'],
    queryFn: () => api.get('/exams/templates').then(r => r.data.data),
    enabled: canManage,
  })

  const addSlotMutation = useMutation({
    mutationFn: () => api.post('/exams/time-slots', slotForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-time-slots'] })
      setSlotForm({ name: '', start_time: '', end_time: '' })
      setShowAddSlot(false)
      toast.success('Time slot added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add time slot'),
  })

  const deleteSlotMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/exams/time-slots/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-time-slots'] }); toast.success('Time slot removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/exams/templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-templates'] }); toast.success('Template removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only staff with exam scheduling permission can manage examination settings."
        className="h-64"
        action={<Button variant="outline" asChild><Link href="/exams">Back to Examinations</Link></Button>}
      />
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/exams" aria-label="Back to exams"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Examination Settings"
          description="Reusable time slots and datesheet blueprints — build a recurring exam once, apply it every year"
          icon={LayoutTemplate}
          actions={
            <Button variant="outline" onClick={() => setApplyTemplateId('')}>
              <Sparkles className="h-4 w-4" /> Pre Set Exams
            </Button>
          }
        />
      </div>

      {/* Time Slots */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Time Slots</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAddSlot(v => !v)}>
              <Plus className="h-3.5 w-3.5" /> Add Time Slot
            </Button>
          </div>
          <CardDescription className="text-xs">Named windows (e.g. "Morning Session") pickable from a dropdown instead of retyping start/end time on every subject.</CardDescription>
        </CardHeader>
        <CardContent>
          {showAddSlot && (
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 p-3">
              <div className="min-w-[160px] flex-1 space-y-1">
                <Label htmlFor="slot-name" className="text-xs">Name</Label>
                <Input id="slot-name" value={slotForm.name} onChange={e => setSlotForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning Session" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="slot-start" className="text-xs">Start</Label>
                <Input id="slot-start" type="time" value={slotForm.start_time} onChange={e => setSlotForm(f => ({ ...f, start_time: e.target.value }))} className="w-auto" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="slot-end" className="text-xs">End</Label>
                <Input id="slot-end" type="time" value={slotForm.end_time} onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))} className="w-auto" />
              </div>
              <Button
                onClick={() => {
                  if (!slotForm.name.trim() || !slotForm.start_time || !slotForm.end_time) return toast.error('Name, start and end time are required')
                  addSlotMutation.mutate()
                }}
                disabled={addSlotMutation.isPending}
              >
                {addSlotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {slotsLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (timeSlots ?? []).length === 0 ? (
            <EmptyState icon={Clock} title="No time slots yet" description="Add a named window like &quot;Morning Session · 9:00–12:00&quot; to reuse across every exam." className="py-8" />
          ) : (
            <div className="divide-y divide-border">
              {(timeSlots ?? []).map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">{s.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteSlotMutation.mutate(s.id)} aria-label={`Remove time slot ${s.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exam Templates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Exam Templates</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowNewTemplate(true)}>
              <Plus className="h-3.5 w-3.5" /> New Template
            </Button>
          </div>
          <CardDescription className="text-xs">The class/subject/time-slot blueprint for a recurring exam type — apply it from the Examinations page to build next year&apos;s datesheet in one step.</CardDescription>
        </CardHeader>
        <CardContent>
          {templatesLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (templates ?? []).length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="No templates yet" description="Build one from a recurring exam's usual classes, subjects and timing." className="py-8"
              action={<Button onClick={() => setShowNewTemplate(true)}><Plus className="h-4 w-4" /> New Template</Button>} />
          ) : (
            <div className="space-y-2">
              {(templates ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {titleCase(t.exam_type)} · {(t.exam_template_subjects ?? []).length} subject{(t.exam_template_subjects ?? []).length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setApplyTemplateId(t.id)}>Use This Template</Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTemplateMutation.mutate(t.id)} aria-label={`Remove template ${t.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showNewTemplate && (
        <NewTemplateModal classes={classes ?? []} timeSlots={timeSlots ?? []} onClose={() => {
          setShowNewTemplate(false)
          qc.invalidateQueries({ queryKey: ['exam-templates'] })
        }} />
      )}

      {applyTemplateId !== null && (
        <ApplyTemplateModal initialTemplateId={applyTemplateId || undefined} onClose={() => setApplyTemplateId(null)} />
      )}
    </div>
  )
}

// Turns a blueprint (Exam Templates) into a real exam + fully-built
// datesheet in one submit — only per-subject dates need touching,
// everything else (class, subject, time slot, marks) is inherited from
// the template as-is.
function ApplyTemplateModal({ initialTemplateId, onClose }: { initialTemplateId?: string; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['exam-templates'],
    queryFn: () => api.get('/exams/templates').then(r => r.data.data),
  })

  const template = (templates ?? []).find((t: any) => t.id === templateId)
  const templateSubjects = template?.exam_template_subjects ?? []

  useEffect(() => {
    if (template && !name) setName(template.name)
  }, [template, name])

  const mutation = useMutation({
    mutationFn: () => api.post(`/exams/templates/${templateId}/apply`, {
      name, start_date: startDate || undefined, end_date: endDate || undefined,
      subjects: templateSubjects.map((ts: any) => ({ template_subject_id: ts.id, exam_date: dates[ts.id] || undefined })),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['exams'] })
      qc.invalidateQueries({ queryKey: ['exam-stats'] })
      toast.success('Exam created from template!')
      onClose()
      router.push(`/exams/${res.data.data.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply template'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Exam from Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Template *</Label>
            <Select value={templateId || undefined} disabled={templatesLoading} onValueChange={v => { setTemplateId(v); setName(''); setDates({}) }}>
              <SelectTrigger><SelectValue placeholder={templatesLoading ? 'Loading...' : 'Select template...'} /></SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!templatesLoading && (templates ?? []).length === 0 && (
              <p className="mt-1.5 text-xs text-warning">No templates yet — create one first.</p>
            )}
          </div>

          {template && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="apply-name">Exam Name *</Label>
                  <Input id="apply-name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-start">Start Date</Label>
                  <Input id="apply-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-end">End Date</Label>
                  <Input id="apply-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Subjects — set each date</Label>
                <div className="space-y-2">
                  {templateSubjects.map((ts: any) => (
                    <div key={ts.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{ts.subject_name} · {ts.classes?.name}</p>
                        {ts.exam_time_slots && (
                          <p className="text-xs text-muted-foreground">{ts.exam_time_slots.name} · {ts.exam_time_slots.start_time?.slice(0, 5)}–{ts.exam_time_slots.end_time?.slice(0, 5)}</p>
                        )}
                      </div>
                      <Input type="date" className="w-auto" value={dates[ts.id] ?? ''}
                        onChange={e => setDates(d => ({ ...d, [ts.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!template || !name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TemplateRow = { class_id: string; subject_name: string; time_slot_id: string; max_marks: number; pass_marks: number }

function NewTemplateModal({ classes, timeSlots, onClose }: { classes: any[]; timeSlots: any[]; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', exam_type: 'unit_test', grading_system: 'marks' })
  const [rows, setRows] = useState<TemplateRow[]>([{ class_id: '', subject_name: '', time_slot_id: '', max_marks: 100, pass_marks: 33 }])

  const addRow = () => setRows(r => [...r, { class_id: '', subject_name: '', time_slot_id: '', max_marks: 100, pass_marks: 33 }])
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TemplateRow>) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  const mutation = useMutation({
    mutationFn: () => api.post('/exams/templates', {
      ...form,
      subjects: rows.map(r => ({
        class_id: r.class_id, subject_name: r.subject_name,
        time_slot_id: r.time_slot_id || undefined,
        max_marks: r.max_marks, pass_marks: r.pass_marks,
      })),
    }),
    onSuccess: () => { toast.success('Template created'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create template'),
  })

  const rowsValid = rows.length > 0 && rows.every(r => r.class_id && r.subject_name)
  const canSave = form.name.trim() && rowsValid

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Exam Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Half Yearly Examination" />
            </div>
            <div className="space-y-1.5">
              <Label>Exam Type</Label>
              <Select value={form.exam_type} onValueChange={v => setForm(f => ({ ...f, exam_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Grading System</Label>
              <Select value={form.grading_system} onValueChange={v => setForm(f => ({ ...f, grading_system: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="marks">Marks</SelectItem>
                  <SelectItem value="grades">Grades</SelectItem>
                  <SelectItem value="cgpa">CGPA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" /> Subjects</Label>
              <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add Row</Button>
            </div>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <TemplateSubjectRow key={i} row={row} classes={classes} timeSlots={timeSlots}
                  onChange={patch => updateRow(i, patch)} onRemove={rows.length > 1 ? () => removeRow(i) : undefined} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateSubjectRow({ row, classes, timeSlots, onChange, onRemove }: {
  row: TemplateRow; classes: any[]; timeSlots: any[]; onChange: (patch: Partial<TemplateRow>) => void; onRemove?: () => void
}) {
  // Each row picks its own class, so each row needs its own class-scoped
  // subject list — same source (Settings -> Classes & Sections) as the
  // datesheet's own Add Subject form, kept in sync with it.
  const { data: subjects } = useQuery({
    queryKey: ['subjects', row.class_id],
    queryFn: () => classesApi.subjects.list(row.class_id).then(r => r.data),
    enabled: !!row.class_id,
  })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_80px_80px_auto] gap-2 rounded-xl border border-border p-2.5">
      <Select value={row.class_id || undefined} onValueChange={v => onChange({ class_id: v, subject_name: '' })}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Class..." /></SelectTrigger>
        <SelectContent>
          {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={row.subject_name || undefined} disabled={!row.class_id} onValueChange={v => onChange({ subject_name: v })}>
        <SelectTrigger className="h-9"><SelectValue placeholder={row.class_id ? 'Subject...' : 'Pick class first'} /></SelectTrigger>
        <SelectContent>
          {(subjects ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={row.time_slot_id || 'none'} onValueChange={v => onChange({ time_slot_id: v === 'none' ? '' : v })}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Time slot..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No time slot</SelectItem>
          {timeSlots.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input type="number" className="h-9" value={row.max_marks} onChange={e => onChange({ max_marks: Number(e.target.value) })} placeholder="Max" />
      <Input type="number" className="h-9" value={row.pass_marks} onChange={e => onChange({ pass_marks: Number(e.target.value) })} placeholder="Pass" />
      {onRemove && (
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Remove row">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
