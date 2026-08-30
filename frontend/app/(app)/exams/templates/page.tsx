'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { Plus, Trash2, Loader2, ArrowLeft, Clock, LayoutTemplate, BookOpen, Sparkles, ShieldOff, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ClassCheckboxPicker } from '@/components/exams/ClassCheckboxPicker'
import { ApplyTemplateModal } from '@/components/exams/ApplyTemplateModal'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const EXAM_TYPES = ['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']
const titleCase = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

type StructureRow = { label: string; exam_type: string; count: number; classIds: Set<string> }
const BLANK_STRUCTURE_ROW = (): StructureRow => ({ label: '', exam_type: 'unit_test', count: 1, classIds: new Set() })

// Kept in step with the sidebar's Examination Settings sub-items
// (components/layout/Sidebar.tsx) — each links straight into one tab
// via ?tab=, landing here instead of always opening on Time Slots.
const EXAM_TEMPLATES_TABS = ['Time Slots', 'Exam Structure (Annually)', 'Exam Templates']

export default function ExamTemplatesPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('exam.schedule')
  const displayStyle = useClassDisplayStyle()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState(EXAM_TEMPLATES_TABS.includes(initialTab ?? '') ? initialTab! : 'Time Slots')
  // A sidebar link only changes ?tab= via client-side navigation — this
  // component stays mounted, so the useState initializer above (which
  // only runs once, on mount) never sees the new value on its own.
  // Without this effect, clicking a different sidebar entry updates the
  // URL but leaves whichever tab was already open on screen.
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && EXAM_TEMPLATES_TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab)
  }, [searchParams])
  const [showAddSlot, setShowAddSlot] = useState(false)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null)
  const [slotForm, setSlotForm] = useState({ name: '', start_time: '', end_time: '' })
  const [structureRows, setStructureRows] = useState<StructureRow[]>([BLANK_STRUCTURE_ROW()])

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

  const addStructureRow = () => setStructureRows(r => [...r, BLANK_STRUCTURE_ROW()])
  const removeStructureRow = (i: number) => setStructureRows(r => r.filter((_, idx) => idx !== i))
  const updateStructureRow = (i: number, patch: Partial<StructureRow>) =>
    setStructureRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))
  const toggleStructureRowClass = (i: number, classId: string) =>
    setStructureRows(r => r.map((row, idx) => {
      if (idx !== i) return row
      const next = new Set(row.classIds)
      next.has(classId) ? next.delete(classId) : next.add(classId)
      return { ...row, classIds: next }
    }))

  // Checkbox-driven year plan: "Unit Tests: 2, Classes 1-12" becomes a
  // real, numbered set of Exam Templates in one submit, each already
  // carrying every selected class's subjects with marks/split state
  // pre-filled from Result Settings — see generate-structure's own
  // comment in exam/routes.ts for exactly how those defaults resolve.
  const generateStructureMutation = useMutation({
    mutationFn: () => api.post('/exams/templates/generate-structure', {
      rows: structureRows.map(r => ({ label: r.label, exam_type: r.exam_type, count: r.count, class_ids: Array.from(r.classIds) })),
    }),
    onSuccess: (res: any) => {
      const { templates: created, subjects_added } = res.data.data
      toast.success(`Created ${created.length} exam template${created.length === 1 ? '' : 's'}, ${subjects_added} subject${subjects_added === 1 ? '' : 's'} pre-filled.`)
      qc.invalidateQueries({ queryKey: ['exam-templates'] })
      setStructureRows([BLANK_STRUCTURE_ROW()])
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to generate exam structure'),
  })

  const structureRowsValid = structureRows.length > 0 && structureRows.every(r => r.label.trim() && r.count >= 1 && r.classIds.size > 0)

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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="Time Slots">Time Slots</TabsTrigger>
          <TabsTrigger value="Exam Structure (Annually)">Exam Structure (Annually)</TabsTrigger>
          <TabsTrigger value="Exam Templates">Exam Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="Time Slots" className="mt-6">
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
        </TabsContent>

        <TabsContent value="Exam Structure (Annually)" className="mt-6">
      {/* Exam Structure */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Exam Structure for the Year</CardTitle>
          <CardDescription className="text-xs">
            Tell us how many of each exam this school runs and for which classes — we&apos;ll generate the matching Exam Templates below in one go, subjects and marks already pre-filled from Result Settings. A one-time setup step, not something you redo per exam.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {structureRows.map((row, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border p-3">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_90px_auto] gap-2">
                <Input placeholder="Label — e.g. Unit Test" value={row.label} onChange={e => updateStructureRow(i, { label: e.target.value })} className="h-9" />
                <Select value={row.exam_type} onValueChange={v => updateStructureRow(i, { exam_type: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} max={12} value={row.count} onChange={e => updateStructureRow(i, { count: Number(e.target.value) })} className="h-9" placeholder="Count" />
                {structureRows.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => removeStructureRow(i)} aria-label="Remove row">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Classes {row.count > 1 && `— generates "${row.label || '...'} 1"–"${row.label || '...'} ${row.count}"`}</Label>
                <ClassCheckboxPicker classes={classes ?? []} selected={row.classIds} onToggle={id => toggleStructureRowClass(i, id)} displayStyle={displayStyle} />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={addStructureRow}><Plus className="h-3.5 w-3.5" /> Add Row</Button>
            <Button size="sm" onClick={() => generateStructureMutation.mutate()} disabled={!structureRowsValid || generateStructureMutation.isPending}>
              {generateStructureMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
              Generate Templates
            </Button>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="Exam Templates" className="mt-6">
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
        </TabsContent>
      </Tabs>

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

type TemplateRow = {
  class_id: string; subject_name: string; time_slot_id: string; max_marks: number; pass_marks: number
  split: boolean; theory_max_marks: number; theory_pass_marks: number; practical_max_marks: number; practical_pass_marks: number
}

const BLANK_TEMPLATE_ROW: TemplateRow = {
  class_id: '', subject_name: '', time_slot_id: '', max_marks: 100, pass_marks: 33,
  split: false, theory_max_marks: 70, theory_pass_marks: 25, practical_max_marks: 30, practical_pass_marks: 10,
}

function NewTemplateModal({ classes, timeSlots, onClose }: { classes: any[]; timeSlots: any[]; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', exam_type: 'unit_test', grading_system: 'marks' })
  const [rows, setRows] = useState<TemplateRow[]>([{ ...BLANK_TEMPLATE_ROW }])

  const addRow = () => setRows(r => [...r, { ...BLANK_TEMPLATE_ROW }])
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TemplateRow>) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  const mutation = useMutation({
    mutationFn: () => api.post('/exams/templates', {
      ...form,
      subjects: rows.map(r => ({
        class_id: r.class_id, subject_name: r.subject_name,
        time_slot_id: r.time_slot_id || undefined,
        max_marks: r.max_marks, pass_marks: r.pass_marks,
        ...(r.split ? {
          theory_max_marks: r.theory_max_marks, theory_pass_marks: r.theory_pass_marks,
          practical_max_marks: r.practical_max_marks, practical_pass_marks: r.practical_pass_marks,
        } : {}),
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
    <div className="space-y-2 rounded-xl border border-border p-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_80px_80px_auto] gap-2">
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
        {!row.split && (
          <>
            <Input type="number" className="h-9" value={row.max_marks} onChange={e => onChange({ max_marks: Number(e.target.value) })} placeholder="Max" />
            <Input type="number" className="h-9" value={row.pass_marks} onChange={e => onChange({ pass_marks: Number(e.target.value) })} placeholder="Pass" />
          </>
        )}
        {row.split && <div className="hidden sm:block sm:col-span-2" />}
        {onRemove && (
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Remove row">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input type="checkbox" checked={row.split} onChange={e => onChange({ split: e.target.checked })} />
        Split into Theory + Practical
      </label>

      {row.split && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg bg-muted/40 p-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Theory Max</Label>
            <Input type="number" className="h-9" value={row.theory_max_marks} onChange={e => onChange({ theory_max_marks: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Theory Pass</Label>
            <Input type="number" className="h-9" value={row.theory_pass_marks} onChange={e => onChange({ theory_pass_marks: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Practical Max</Label>
            <Input type="number" className="h-9" value={row.practical_max_marks} onChange={e => onChange({ practical_max_marks: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Practical Pass</Label>
            <Input type="number" className="h-9" value={row.practical_pass_marks} onChange={e => onChange({ practical_pass_marks: Number(e.target.value) })} />
          </div>
        </div>
      )}
    </div>
  )
}
