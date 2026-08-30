'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { SlidersHorizontal, ShieldOff, Plus, Trash2, Loader2, RotateCcw, GraduationCap, GitBranch, ArrowUp, ArrowDown, Lock, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { ClassCheckboxPicker } from '@/components/exams/ClassCheckboxPicker'

// Organizational config for how results compute — Class Rules (default +
// per-exam-type overrides), Subject Overrides, and reusable Grade Scales.
// Deliberately scoped to the "core" fields this pass: promotion policy,
// pass criteria mode, aggregate pass %, grading mode + grade scale, and
// (subject tab only) has_practical, since that flag drives Marks Entry's
// theory/practical fields. The edge-case fields already on
// exam_class_result_rules (best-of-N, compartment, attendance eligibility,
// grace marks, rounding, remarks rules) get their own editor once Marks
// Entry and the rest of the pipeline are wired up to use them.
const EXAM_TYPES = ['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']
const titleCase = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
// Kept in step with the sidebar's Result Settings sub-items
// (components/layout/Sidebar.tsx) — each links straight into one tab
// via ?tab=, landing here instead of always opening on Class Rules.
const RESULT_SETTINGS_TABS = ['Class Rules', 'Exam Type Rules', 'Subject Overrides', 'Grade Scales', 'Remarks Rules', 'Term Templates', 'Apply Preset', 'Publish Workflow']

export default function ResultSettingsPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canManage = can('exam.result_settings_manage')

  if (!permLoading && !canManage) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="Only School Admin, Principal, Vice Principal or Exam Controller can configure result settings." className="h-64" />
    )
  }

  return <ResultSettingsView />
}

function ResultSettingsView() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState(RESULT_SETTINGS_TABS.includes(initialTab ?? '') ? initialTab! : 'Class Rules')
  // A sidebar link only changes ?tab= via client-side navigation — this
  // component stays mounted, so the useState initializer above (which
  // only runs once, on mount) never sees the new value on its own.
  // Without this effect, clicking a different sidebar entry updates the
  // URL but leaves whichever tab was already open on screen.
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && RESULT_SETTINGS_TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab)
  }, [searchParams])
  const [selectedClass, setSelectedClass] = useState('')
  const displayStyle = useClassDisplayStyle()

  const { data: classes, isLoading: classesLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })
  const sortedClasses = [...(classes ?? [])].sort((a: any, b: any) => (a.numeric_level ?? 0) - (b.numeric_level ?? 0))

  return (
    <div className="space-y-5">
      <PageHeader title="Result Settings" description="Configure how pass/fail, grading and results compute — per class, and per exam type where it needs to differ." icon={SlidersHorizontal} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="Class Rules">Class Rules</TabsTrigger>
          <TabsTrigger value="Exam Type Rules">Exam Type Rules</TabsTrigger>
          <TabsTrigger value="Subject Overrides">Subject Overrides</TabsTrigger>
          <TabsTrigger value="Grade Scales">Grade Scales</TabsTrigger>
          <TabsTrigger value="Remarks Rules">Remarks Rules</TabsTrigger>
          <TabsTrigger value="Term Templates">Term Templates</TabsTrigger>
          <TabsTrigger value="Apply Preset">Apply Preset</TabsTrigger>
          <TabsTrigger value="Publish Workflow">Publish Workflow</TabsTrigger>
        </TabsList>

        {(tab === 'Class Rules' || tab === 'Subject Overrides') && (
          <div className="mt-6 mb-5 flex items-center gap-2">
            <Label className="shrink-0">Class</Label>
            {classesLoading ? (
              <Skeleton className="h-9 w-48" />
            ) : (
              <Select value={selectedClass || undefined} onValueChange={setSelectedClass}>
                <SelectTrigger className="h-9 min-w-[180px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
                <SelectContent>
                  {sortedClasses.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{classLabel(c.name, c.numeric_level, displayStyle)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <TabsContent value="Class Rules" className={tab === 'Class Rules' ? '' : 'mt-0'}>
          {!selectedClass ? (
            <Card><EmptyState icon={GraduationCap} title="Pick a class" description="Select a class above to view or edit its result rules." /></Card>
          ) : (
            <ClassRulesTab classId={selectedClass} className={classLabel(sortedClasses.find((c: any) => c.id === selectedClass)?.name ?? '', sortedClasses.find((c: any) => c.id === selectedClass)?.numeric_level, displayStyle)} />
          )}
        </TabsContent>

        <TabsContent value="Exam Type Rules" className="mt-6 space-y-8">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">Class Rules</h3>
              <p className="text-xs text-muted-foreground">Pass criteria, grading mode and the rest of a class's result rule, applied to several classes at once.</p>
            </div>
            <BulkExamRulesTab classes={sortedClasses} displayStyle={displayStyle} />
          </div>

          <div className="space-y-4 border-t border-border pt-8">
            <div>
              <h3 className="font-semibold text-foreground">Subject Max / Pass Marks</h3>
              <p className="text-xs text-muted-foreground">One subject's default Max Marks and Pass Marks (or Theory/Practical split), applied to several classes at once — the same numbers Add Subject pre-fills from.</p>
            </div>
            <BulkSubjectMarksTab classes={sortedClasses} displayStyle={displayStyle} />
          </div>
        </TabsContent>

        <TabsContent value="Subject Overrides" className={tab === 'Subject Overrides' ? '' : 'mt-0'}>
          {!selectedClass ? (
            <Card><EmptyState icon={GraduationCap} title="Pick a class" description="Select a class above to view or edit its subject-level overrides." /></Card>
          ) : (
            <SubjectOverridesTab classId={selectedClass} />
          )}
        </TabsContent>

        <TabsContent value="Grade Scales" className="mt-6">
          <GradeScalesTab />
        </TabsContent>

        <TabsContent value="Remarks Rules" className="mt-6">
          <RemarksRulesTab />
        </TabsContent>

        <TabsContent value="Term Templates" className="mt-6">
          <TermTemplatesTab classes={sortedClasses} displayStyle={displayStyle} />
        </TabsContent>

        <TabsContent value="Apply Preset" className="mt-6">
          <ApplyPresetTab classes={sortedClasses} displayStyle={displayStyle} />
        </TabsContent>

        <TabsContent value="Publish Workflow" className="mt-6">
          <PublishWorkflowTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CLASS RULES
// ═══════════════════════════════════════════════════════════════

const DEFAULT_RULE_FORM = {
  promotion_policy: 'standard',
  pass_criteria_mode: 'aggregate',
  pass_criteria_requires_aggregate: true,
  aggregate_pass_percent: 33,
  grading_mode: 'marks',
  grade_scale_id: '',
  best_of_subjects_count: '',
  allow_additional_subject_substitution: false,
  compartment_policy: 'none',
  compartment_max_failed_subjects: '',
  min_attendance_percent: '',
  max_grace_marks_per_subject: 0,
  max_grace_marks_total: 0,
  rounding_mode: 'nearest',
  rounding_decimals: 2,
  remarks_rule_id: '',
}

function ClassRulesTab({ classId, className }: { classId: string; className: string }) {
  const qc = useQueryClient()
  const [addingType, setAddingType] = useState(false)

  const { data: rows, isLoading } = useQuery({
    queryKey: ['result-class-rules', classId],
    queryFn: () => api.get('/exams/result-settings/class-rules', { params: { class_id: classId } }).then(r => r.data.data as any[]),
  })

  const defaultRow = (rows ?? []).find(r => r.exam_type == null)
  const typedRows = (rows ?? []).filter(r => r.exam_type != null)
  const availableTypes = EXAM_TYPES.filter(t => !typedRows.some(r => r.exam_type === t))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['result-class-rules', classId] })

  const addTypeMutation = useMutation({
    // DEFAULT_RULE_FORM's best_of_subjects_count/compartment_max_failed_subjects/
    // min_attendance_percent are '' (an <Input>-friendly blank), not the
    // null the backend's nullable numeric fields expect — sending the raw
    // form object 400s with "Expected number, received string". Same
    // conversion the main Save button already applies.
    mutationFn: (exam_type: string) => api.patch(`/exams/result-settings/class-rules/${classId}`, {
      ...DEFAULT_RULE_FORM,
      grade_scale_id: undefined,
      remarks_rule_id: undefined,
      best_of_subjects_count: null,
      compartment_max_failed_subjects: null,
      min_attendance_percent: null,
    }, { params: { exam_type } }),
    onSuccess: () => { invalidate(); toast.success('Exam-type override added'); setAddingType(false) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add override'),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-64 w-full rounded-2xl" /></div>

  return (
    <div className="space-y-5">
      <RuleCard title={`${className} — Default`} description="Applies to every exam type in this class that has no override below." classId={classId} examType={null} existing={defaultRow} onSaved={invalidate} />

      {typedRows.map(row => (
        <RuleCard key={row.id} title={`${className} — ${titleCase(row.exam_type)}`} description="Overrides the class default for this exam type only." classId={classId} examType={row.exam_type} existing={row} onSaved={invalidate} removable onRemoved={invalidate} />
      ))}

      {availableTypes.length > 0 && (
        addingType ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="shrink-0">Add an override for</Label>
              <Select onValueChange={v => addTypeMutation.mutate(v)} disabled={addTypeMutation.isPending}>
                <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Select exam type..." /></SelectTrigger>
                <SelectContent>
                  {availableTypes.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setAddingType(false)}>Cancel</Button>
            </div>
          </Card>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingType(true)}>
            <Plus className="h-4 w-4" /> Add exam-type override
          </Button>
        )
      )}
    </div>
  )
}

// The full class-rule field set, presentational only — no data-fetching,
// no save logic. Shared between RuleCard (one class at a time) and the
// bulk "Exam Type Rules" tab (configure once, apply to several classes'
// worth of exam-type overrides at once), so the ~15-field form only
// exists in one place.
function RuleFormFields({ form, update, showAdvanced, setShowAdvanced, scales, remarksRules, idPrefix }: {
  form: typeof DEFAULT_RULE_FORM; update: (patch: Partial<typeof DEFAULT_RULE_FORM>) => void
  showAdvanced: boolean; setShowAdvanced: (v: boolean | ((v: boolean) => boolean)) => void
  scales: any[] | undefined; remarksRules: any[] | undefined; idPrefix: string
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Promotion Policy</Label>
          <Select value={form.promotion_policy} onValueChange={v => update({ promotion_policy: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard — pass/fail from marks</SelectItem>
              <SelectItem value="no_detention">No Detention — never fails (e.g. up to Class 8)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Pass Criteria</Label>
          <Select value={form.pass_criteria_mode} onValueChange={v => update({ pass_criteria_mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="aggregate">Aggregate only</SelectItem>
              <SelectItem value="per_subject">Must pass each subject individually</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {form.pass_criteria_mode === 'per_subject' && (
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input type="checkbox" checked={form.pass_criteria_requires_aggregate} onChange={e => update({ pass_criteria_requires_aggregate: e.target.checked })} />
          Also require the overall aggregate percentage to clear
        </label>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`agg-${idPrefix}`}>Aggregate Pass %</Label>
          <Input id={`agg-${idPrefix}`} type="number" min={0} max={100} value={form.aggregate_pass_percent}
            onChange={e => update({ aggregate_pass_percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        </div>
        <div className="space-y-1.5">
          <Label>Grading Mode</Label>
          <Select value={form.grading_mode} onValueChange={v => update({ grading_mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="marks">Marks / Percentage</SelectItem>
              <SelectItem value="grade_only">Grade Only — no numeric marks</SelectItem>
              <SelectItem value="cgpa">CGPA</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {form.grading_mode !== 'marks' && (
        <div className="space-y-1.5">
          <Label>Grade Scale</Label>
          <Select value={form.grade_scale_id || undefined} onValueChange={v => update({ grade_scale_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select a grade scale..." /></SelectTrigger>
            <SelectContent>
              {(scales ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_system ? ' (built-in)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          {!form.grade_scale_id && <p className="text-xs text-warning">A grade scale is required for this grading mode.</p>}
        </div>
      )}

      <button type="button" onClick={() => setShowAdvanced(v => !v)} className="text-xs font-medium text-primary hover:text-primary/80">
        {showAdvanced ? 'Hide' : 'Show'} advanced rules — best-of-N, compartment, attendance eligibility, grace marks, rounding, remarks
      </button>

      {showAdvanced && (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Best-of-N Subjects</Label>
              <Input type="number" min={1} placeholder="All subjects count" value={form.best_of_subjects_count}
                onChange={e => update({ best_of_subjects_count: e.target.value })} />
              <p className="text-xs text-muted-foreground">Only the top N subjects (by %) count toward the aggregate; the rest still show, excluded from the total.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Compartment Policy</Label>
              <Select value={form.compartment_policy} onValueChange={v => update({ compartment_policy: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not allowed — flat pass/fail</SelectItem>
                  <SelectItem value="allow">Allow compartment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.compartment_policy === 'allow' && (
            <div className="space-y-1.5">
              <Label>Max Failed Subjects for Compartment</Label>
              <Input type="number" min={1} value={form.compartment_max_failed_subjects}
                onChange={e => update({ compartment_max_failed_subjects: e.target.value })} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={form.allow_additional_subject_substitution} onChange={e => update({ allow_additional_subject_substitution: e.target.checked })} />
            Allow a passing additional subject to replace a failed compulsory one in the aggregate
          </label>

          <div className="space-y-1.5">
            <Label>Minimum Attendance % to Appear</Label>
            <Input type="number" min={0} max={100} placeholder="No minimum" value={form.min_attendance_percent}
              onChange={e => update({ min_attendance_percent: e.target.value })} />
            <p className="text-xs text-muted-foreground">Below this, the result shows "Not Eligible to Appear" regardless of marks.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Max Grace Marks / Subject</Label>
              <Input type="number" min={0} value={form.max_grace_marks_per_subject} onChange={e => update({ max_grace_marks_per_subject: Number(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Max Grace Marks Total</Label>
              <Input type="number" min={0} value={form.max_grace_marks_total} onChange={e => update({ max_grace_marks_total: Number(e.target.value) || 0 })} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Percentage Rounding</Label>
              <Select value={form.rounding_mode} onValueChange={v => update({ rounding_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nearest">Nearest</SelectItem>
                  <SelectItem value="floor">Round down</SelectItem>
                  <SelectItem value="ceil">Round up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Decimal Places</Label>
              <Input type="number" min={0} max={4} value={form.rounding_decimals} onChange={e => update({ rounding_decimals: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Remarks Rule</Label>
            <Select value={form.remarks_rule_id || 'default'} onValueChange={v => update({ remarks_rule_id: v === 'default' ? '' : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default — "Promoted" / "Detained"</SelectItem>
                {(remarksRules ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}{r.is_system ? ' (built-in)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  )
}

function RuleCard({ title, description, classId, examType, existing, onSaved, removable, onRemoved }: {
  title: string; description: string; classId: string; examType: string | null; existing: any
  onSaved: () => void; removable?: boolean; onRemoved?: () => void
}) {
  const [form, setForm] = useState(() => existing ? {
    promotion_policy: existing.promotion_policy,
    pass_criteria_mode: existing.pass_criteria_mode,
    pass_criteria_requires_aggregate: existing.pass_criteria_requires_aggregate,
    aggregate_pass_percent: Number(existing.aggregate_pass_percent),
    grading_mode: existing.grading_mode,
    grade_scale_id: existing.grade_scale_id ?? '',
    best_of_subjects_count: existing.best_of_subjects_count ?? '',
    allow_additional_subject_substitution: existing.allow_additional_subject_substitution ?? false,
    compartment_policy: existing.compartment_policy ?? 'none',
    compartment_max_failed_subjects: existing.compartment_max_failed_subjects ?? '',
    min_attendance_percent: existing.min_attendance_percent ?? '',
    max_grace_marks_per_subject: Number(existing.max_grace_marks_per_subject ?? 0),
    max_grace_marks_total: Number(existing.max_grace_marks_total ?? 0),
    rounding_mode: existing.rounding_mode ?? 'nearest',
    rounding_decimals: existing.rounding_decimals ?? 2,
    remarks_rule_id: existing.remarks_rule_id ?? '',
  } : DEFAULT_RULE_FORM)
  const [dirty, setDirty] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const { data: scales } = useQuery({
    queryKey: ['exam-grade-scales'],
    queryFn: () => api.get('/exams/result-settings/grade-scales').then(r => r.data.data as any[]),
    enabled: form.grading_mode !== 'marks',
  })
  const { data: remarksRules } = useQuery({
    queryKey: ['exam-remarks-rules'],
    queryFn: () => api.get('/exams/result-settings/remarks-rules').then(r => r.data.data as any[]),
    enabled: showAdvanced,
  })

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/exams/result-settings/class-rules/${classId}`, {
      ...form,
      grade_scale_id: form.grade_scale_id || undefined,
      remarks_rule_id: form.remarks_rule_id || undefined,
      best_of_subjects_count: form.best_of_subjects_count === '' ? null : Number(form.best_of_subjects_count),
      compartment_max_failed_subjects: form.compartment_max_failed_subjects === '' ? null : Number(form.compartment_max_failed_subjects),
      min_attendance_percent: form.min_attendance_percent === '' ? null : Number(form.min_attendance_percent),
    }, { params: examType ? { exam_type: examType } : {} }),
    onSuccess: () => { toast.success('Saved'); setDirty(false); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/exams/result-settings/class-rules/${classId}`, { params: { exam_type: examType } }),
    onSuccess: () => { toast.success('Override removed — this exam type now follows the class default'); onRemoved?.() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const update = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setDirty(true) }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!existing && <Badge variant="secondary">Unconfigured — using default behavior</Badge>}
          {removable && (
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="Remove this override" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
              {removeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <RuleFormFields form={form} update={update} showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
          scales={scales} remarksRules={remarksRules} idPrefix={`${examType ?? 'default'}-${classId}`} />

        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty || (form.grading_mode !== 'marks' && !form.grade_scale_id)}>
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════
// EXAM TYPE RULES — configure one exam type's rule once, tick every
// class it applies to, apply in one submit — the Class Rules tab's
// "one class, then repeat per class" flow inverted: exam-type-first,
// class-checklist-second, the same shape the Exam Structure wizard
// (Examination Settings) already uses for a different resource.
// ═══════════════════════════════════════════════════════════════

type BulkRuleRow = { exam_type: string; classIds: Set<string>; ruleForm: typeof DEFAULT_RULE_FORM; showAdvanced: boolean }
const BLANK_BULK_RULE_ROW = (): BulkRuleRow => ({ exam_type: 'unit_test', classIds: new Set(), ruleForm: { ...DEFAULT_RULE_FORM }, showAdvanced: false })

function BulkExamRulesTab({ classes, displayStyle }: { classes: any[]; displayStyle: string }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<BulkRuleRow[]>([BLANK_BULK_RULE_ROW()])

  const { data: scales } = useQuery({
    queryKey: ['exam-grade-scales'],
    queryFn: () => api.get('/exams/result-settings/grade-scales').then(r => r.data.data as any[]),
  })
  const { data: remarksRules } = useQuery({
    queryKey: ['exam-remarks-rules'],
    queryFn: () => api.get('/exams/result-settings/remarks-rules').then(r => r.data.data as any[]),
  })

  const addRow = () => setRows(r => [...r, BLANK_BULK_RULE_ROW()])
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<BulkRuleRow>) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))
  const updateRowForm = (i: number, patch: Partial<typeof DEFAULT_RULE_FORM>) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, ruleForm: { ...row.ruleForm, ...patch } } : row))
  const toggleRowClass = (i: number, classId: string) => setRows(r => r.map((row, idx) => {
    if (idx !== i) return row
    const next = new Set(row.classIds)
    next.has(classId) ? next.delete(classId) : next.add(classId)
    return { ...row, classIds: next }
  }))

  // One request per row (not per class within a row — the backend's own
  // bulk-apply endpoint already loops class_ids server-side). Row count
  // is however many exam types someone configures in one visit — small,
  // nothing like the class x subject blowup generate-structure hit.
  const applyMutation = useMutation({
    mutationFn: async () => {
      let totalApplied = 0
      for (const row of rows) {
        const { ruleForm: f } = row
        const res = await api.post('/exams/result-settings/class-rules/bulk-apply', {
          class_ids: Array.from(row.classIds),
          exam_type: row.exam_type === 'default' ? null : row.exam_type,
          ...f,
          grade_scale_id: f.grade_scale_id || undefined,
          remarks_rule_id: f.remarks_rule_id || undefined,
          best_of_subjects_count: f.best_of_subjects_count === '' ? null : Number(f.best_of_subjects_count),
          compartment_max_failed_subjects: f.compartment_max_failed_subjects === '' ? null : Number(f.compartment_max_failed_subjects),
          min_attendance_percent: f.min_attendance_percent === '' ? null : Number(f.min_attendance_percent),
        })
        totalApplied += res.data.data.applied
      }
      return totalApplied
    },
    onSuccess: (totalApplied: number) => {
      toast.success(`Applied to ${totalApplied} class rule${totalApplied === 1 ? '' : 's'} across ${rows.length} row${rows.length === 1 ? '' : 's'}.`)
      qc.invalidateQueries({ queryKey: ['result-class-rules'] })
      setRows([BLANK_BULK_RULE_ROW()])
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply'),
  })

  const rowsValid = rows.length > 0 && rows.every(r => r.classIds.size > 0 && (r.ruleForm.grading_mode === 'marks' || r.ruleForm.grade_scale_id))

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Configure a result rule once for an exam type (or the class default), then tick every class it applies to — applied in one go instead of visiting Class Rules once per class.</p>

      {rows.map((row, i) => (
        <Card key={i} className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="shrink-0">Applies to</Label>
              <Select value={row.exam_type} onValueChange={v => updateRow(i, { exam_type: v })}>
                <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Class Default (every exam type)</SelectItem>
                  {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {rows.length > 1 && (
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(i)} aria-label="Remove row">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <RuleFormFields form={row.ruleForm} update={patch => updateRowForm(i, patch)}
            showAdvanced={row.showAdvanced} setShowAdvanced={v => updateRow(i, { showAdvanced: typeof v === 'function' ? (v as (v: boolean) => boolean)(row.showAdvanced) : v })}
            scales={scales} remarksRules={remarksRules} idPrefix={`bulk-${i}`} />

          <div className="space-y-1.5 border-t border-border pt-4">
            <Label>Classes * <span className="font-normal text-muted-foreground">— every class this rule applies to</span></Label>
            <ClassCheckboxPicker classes={classes} selected={row.classIds} onToggle={id => toggleRowClass(i, id)} displayStyle={displayStyle as 'numeric' | 'roman'} />
          </div>
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add Another Row</Button>
        <Button onClick={() => applyMutation.mutate()} disabled={!rowsValid || applyMutation.isPending}>
          {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Apply
        </Button>
      </div>
    </div>
  )
}

type BulkSubjectRow = {
  exam_type: string; subject_name: string; allSubjects: boolean; split: boolean
  max_marks: number; pass_marks: number
  theory_max_marks: number; theory_pass_marks: number; practical_max_marks: number; practical_pass_marks: number
  classIds: Set<string>
}
const BLANK_BULK_SUBJECT_ROW = (): BulkSubjectRow => ({
  exam_type: 'default', subject_name: '', allSubjects: false, split: false,
  max_marks: 100, pass_marks: 33,
  theory_max_marks: 70, theory_pass_marks: 25, practical_max_marks: 30, practical_pass_marks: 10,
  classIds: new Set(),
})

function BulkSubjectMarksTab({ classes, displayStyle }: { classes: any[]; displayStyle: string }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<BulkSubjectRow[]>([BLANK_BULK_SUBJECT_ROW()])

  // Every subject name used anywhere in the school (not scoped to one
  // class) — a Select instead of free text so this doesn't drift from
  // however subjects are actually spelled in Settings -> Classes &
  // Sections.
  const { data: allSubjects } = useQuery({
    queryKey: ['all-subjects'],
    queryFn: () => api.get('/admission/subjects').then(r => r.data.data as any[]),
  })
  const subjectNames = Array.from(new Set((allSubjects ?? []).map((s: any) => s.name))).sort()

  // Which classes actually teach a given subject name — a subject row
  // with class_id null applies school-wide ('all'); otherwise only the
  // specific classes that have their own row for that name do. Ticking a
  // class that doesn't teach the subject wouldn't error (the override
  // just goes unread), but it's a confusing thing to let someone do —
  // e.g. Accountancy is realistically a Class 11-12 subject, not
  // Class 1-12, so the class list narrows to match instead of showing
  // every class in the school regardless of relevance.
  const classIdsForSubject = (subjectName: string): Set<string> | 'all' => {
    const rowsForName = (allSubjects ?? []).filter((s: any) => s.name === subjectName)
    if (rowsForName.some((s: any) => s.class_id == null)) return 'all'
    return new Set(rowsForName.map((s: any) => s.class_id))
  }
  // With "every subject" on, each ticked class supplies its OWN subject
  // list server-side (same resolution as the Exam Structure wizard) —
  // there's no single subject to narrow the class picker against, so
  // every class in the school is a valid pick.
  const eligibleClasses = (row: BulkSubjectRow) => {
    if (row.allSubjects) return classes
    if (!row.subject_name) return []
    const eligible = classIdsForSubject(row.subject_name)
    return eligible === 'all' ? classes : classes.filter((c: any) => eligible.has(c.id))
  }

  const addRow = () => setRows(r => [...r, BLANK_BULK_SUBJECT_ROW()])
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<BulkSubjectRow>) => setRows(r => r.map((row, idx) => {
    if (idx !== i) return row
    const next = { ...row, ...patch }
    // Changing the subject (or toggling "every subject") can shrink the
    // eligible class list — drop any ticked class that's no longer
    // valid rather than silently submitting a stale selection.
    if (patch.subject_name !== undefined || patch.allSubjects !== undefined) {
      const eligible = new Set(eligibleClasses(next).map((c: any) => c.id))
      next.classIds = new Set(Array.from(row.classIds).filter(id => eligible.has(id)))
    }
    if (patch.allSubjects === true) next.subject_name = ''
    return next
  }))
  const toggleRowClass = (i: number, classId: string) => setRows(r => r.map((row, idx) => {
    if (idx !== i) return row
    const next = new Set(row.classIds)
    next.has(classId) ? next.delete(classId) : next.add(classId)
    return { ...row, classIds: next }
  }))

  const applyMutation = useMutation({
    mutationFn: async () => {
      let totalApplied = 0
      for (const row of rows) {
        const marksFields = row.split ? {
          has_practical: true,
          default_theory_max_marks: row.theory_max_marks, default_theory_pass_marks: row.theory_pass_marks,
          default_practical_max_marks: row.practical_max_marks, default_practical_pass_marks: row.practical_pass_marks,
          default_max_marks: null, default_pass_marks: null,
        } : {
          has_practical: false,
          default_max_marks: row.max_marks, default_pass_marks: row.pass_marks,
          default_theory_max_marks: null, default_theory_pass_marks: null,
          default_practical_max_marks: null, default_practical_pass_marks: null,
        }
        const res = row.allSubjects
          ? await api.post('/exams/result-settings/subject-overrides/bulk-apply-all', {
              class_ids: Array.from(row.classIds),
              exam_type: row.exam_type === 'default' ? null : row.exam_type,
              ...marksFields,
            })
          : await api.post('/exams/result-settings/subject-overrides/bulk-apply', {
              class_ids: Array.from(row.classIds),
              exam_type: row.exam_type === 'default' ? null : row.exam_type,
              subject_name: row.subject_name,
              ...marksFields,
            })
        totalApplied += res.data.data.applied
      }
      return totalApplied
    },
    onSuccess: (totalApplied: number) => {
      toast.success(`Applied to ${totalApplied} subject override${totalApplied === 1 ? '' : 's'} across ${rows.length} row${rows.length === 1 ? '' : 's'}.`)
      qc.invalidateQueries({ queryKey: ['result-subject-overrides'] })
      setRows([BLANK_BULK_SUBJECT_ROW()])
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply'),
  })

  const rowsValid = rows.length > 0 && rows.every(r => (r.allSubjects || r.subject_name) && r.classIds.size > 0)

  return (
    <div className="space-y-5">
      {rows.map((row, i) => (
        <Card key={i} className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="shrink-0">Applies to</Label>
              <Select value={row.exam_type} onValueChange={v => updateRow(i, { exam_type: v })}>
                <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Class Default (every exam type)</SelectItem>
                  {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              {!row.allSubjects && (
                <>
                  <Label className="shrink-0">Subject</Label>
                  <Select value={row.subject_name || undefined} onValueChange={v => updateRow(i, { subject_name: v })}>
                    <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Select subject..." /></SelectTrigger>
                    <SelectContent>
                      {subjectNames.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            {rows.length > 1 && (
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(i)} aria-label="Remove row">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={row.allSubjects} onChange={e => updateRow(i, { allSubjects: e.target.checked })} />
            Apply to every subject each ticked class teaches — not just one
          </label>
          {row.allSubjects && (
            <p className="text-xs text-muted-foreground">
              Sets this same Max/Pass Marks (or split) as the default for every subject in each ticked class's own curriculum — a class that teaches 5 subjects gets 5 overrides, a class that teaches 40 gets 40.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={row.split} onChange={e => updateRow(i, { split: e.target.checked })} />
            Split into Theory + Practical
          </label>

          {row.split ? (
            <div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label>Theory Max</Label>
                <Input type="number" value={row.theory_max_marks} onChange={e => updateRow(i, { theory_max_marks: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Theory Pass</Label>
                <Input type="number" value={row.theory_pass_marks} onChange={e => updateRow(i, { theory_pass_marks: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Practical Max</Label>
                <Input type="number" value={row.practical_max_marks} onChange={e => updateRow(i, { practical_max_marks: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Practical Pass</Label>
                <Input type="number" value={row.practical_pass_marks} onChange={e => updateRow(i, { practical_pass_marks: Number(e.target.value) })} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Max Marks</Label>
                <Input type="number" value={row.max_marks} onChange={e => updateRow(i, { max_marks: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Pass Marks</Label>
                <Input type="number" value={row.pass_marks} onChange={e => updateRow(i, { pass_marks: Number(e.target.value) })} />
              </div>
            </div>
          )}

          <div className="space-y-1.5 border-t border-border pt-4">
            <Label>Classes * <span className="font-normal text-muted-foreground">
              {row.allSubjects ? '— each class applies this to its own subjects' : `— only classes that actually teach ${row.subject_name || 'this subject'} are shown`}
            </span></Label>
            {!row.allSubjects && !row.subject_name ? (
              <p className="text-xs text-muted-foreground">Pick a subject above to see which classes teach it.</p>
            ) : eligibleClasses(row).length === 0 ? (
              <p className="text-xs text-warning">No class currently has "{row.subject_name}" in its subject list.</p>
            ) : (
              <ClassCheckboxPicker classes={eligibleClasses(row)} selected={row.classIds} onToggle={id => toggleRowClass(i, id)} displayStyle={displayStyle as 'numeric' | 'roman'} />
            )}
          </div>
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add Another Row</Button>
        <Button onClick={() => applyMutation.mutate()} disabled={!rowsValid || applyMutation.isPending}>
          {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Apply
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SUBJECT OVERRIDES
// ═══════════════════════════════════════════════════════════════

function SubjectOverridesTab({ classId }: { classId: string }) {
  const qc = useQueryClient()
  // '' = the class-wide default (applies to every exam type with no
  // override of its own for this subject); a real exam_type scopes every
  // field below — including has_practical — to just that type, e.g. a
  // subject that's Theory+Practical for Half Yearly but a single combined
  // paper for Unit Tests.
  const [examTypeScope, setExamTypeScope] = useState('')

  const { data: subjects, isLoading: subjectsLoading } = useQuery({
    queryKey: ['subjects', classId],
    queryFn: () => classesApi.subjects.list(classId).then(r => r.data as any[]),
    enabled: !!classId,
  })
  const { data: overrides, isLoading: overridesLoading } = useQuery({
    queryKey: ['result-subject-overrides', classId, examTypeScope],
    queryFn: () => api.get('/exams/result-settings/subject-overrides', { params: { class_id: classId, exam_type: examTypeScope || undefined } }).then(r => r.data.data as any[]),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['result-subject-overrides', classId, examTypeScope] })

  if (subjectsLoading) return <Skeleton className="h-64 w-full rounded-2xl" />
  if (!(subjects ?? []).length) {
    return <Card><EmptyState icon={GraduationCap} title="No subjects set up for this class" description="Add subjects in Settings → Classes & Sections first." /></Card>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="shrink-0">Scope</Label>
        <Select value={examTypeScope || 'default'} onValueChange={v => setExamTypeScope(v === 'default' ? '' : v)}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default (all exam types)</SelectItem>
            {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)} only</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {examTypeScope && (
        <p className="text-xs text-muted-foreground -mt-2">
          Editing overrides for <b>{titleCase(examTypeScope)}</b> only — a subject left as "Inherits" here still falls back to its Default override (if any) or the class rule. Switch back to "Default" to set the fallback that every other exam type without its own override uses.
        </p>
      )}

      {overridesLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <div className="space-y-3">
          {(subjects ?? []).map((s: any) => (
            <SubjectOverrideRow key={`${examTypeScope}:${s.id}`} classId={classId} subjectName={s.name} examType={examTypeScope}
              existing={(overrides ?? []).find((o: any) => o.subject_name === s.name && (examTypeScope ? o.exam_type === examTypeScope : o.exam_type == null))}
              onSaved={invalidate} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubjectOverrideRow({ classId, subjectName, examType, existing, onSaved }: { classId: string; subjectName: string; examType: string; existing: any; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState(() => ({
    pass_criteria_mode: existing?.pass_criteria_mode ?? '',
    aggregate_pass_percent: existing?.aggregate_pass_percent ?? '',
    grading_mode: existing?.grading_mode ?? '',
    grade_scale_id: existing?.grade_scale_id ?? '',
    has_practical: existing?.has_practical ?? false,
    is_additional: existing?.is_additional ?? false,
    include_in_aggregate: existing?.include_in_aggregate ?? true,
    subject_group_key: existing?.subject_group_key ?? '',
    default_max_marks: existing?.default_max_marks ?? '',
    default_pass_marks: existing?.default_pass_marks ?? '',
    default_theory_max_marks: existing?.default_theory_max_marks ?? '',
    default_theory_pass_marks: existing?.default_theory_pass_marks ?? '',
    default_practical_max_marks: existing?.default_practical_max_marks ?? '',
    default_practical_pass_marks: existing?.default_practical_pass_marks ?? '',
  }))

  const { data: scales } = useQuery({
    queryKey: ['exam-grade-scales'],
    queryFn: () => api.get('/exams/result-settings/grade-scales').then(r => r.data.data as any[]),
    enabled: expanded && form.grading_mode === 'grade_only',
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        class_id: classId, subject_name: subjectName,
        exam_type: examType || undefined,
        pass_criteria_mode: form.pass_criteria_mode || undefined,
        aggregate_pass_percent: form.aggregate_pass_percent === '' ? undefined : Number(form.aggregate_pass_percent),
        grading_mode: form.grading_mode || undefined,
        grade_scale_id: form.grade_scale_id || undefined,
        has_practical: form.has_practical,
        is_additional: form.is_additional,
        include_in_aggregate: form.include_in_aggregate,
        subject_group_key: form.subject_group_key || null,
        default_max_marks: form.default_max_marks === '' ? null : Number(form.default_max_marks),
        default_pass_marks: form.default_pass_marks === '' ? null : Number(form.default_pass_marks),
        default_theory_max_marks: form.default_theory_max_marks === '' ? null : Number(form.default_theory_max_marks),
        default_theory_pass_marks: form.default_theory_pass_marks === '' ? null : Number(form.default_theory_pass_marks),
        default_practical_max_marks: form.default_practical_max_marks === '' ? null : Number(form.default_practical_max_marks),
        default_practical_pass_marks: form.default_practical_pass_marks === '' ? null : Number(form.default_practical_pass_marks),
      }
      return existing ? api.patch(`/exams/result-settings/subject-overrides/${existing.id}`, body) : api.post('/exams/result-settings/subject-overrides', body)
    },
    onSuccess: () => { toast.success('Saved'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const clearMutation = useMutation({
    mutationFn: () => api.delete(`/exams/result-settings/subject-overrides/${existing.id}`),
    onSuccess: () => { toast.success('Override removed'); onSaved() },
  })

  const hasOverride = !!existing

  return (
    <Card className="p-4">
      <button onClick={() => setExpanded(v => !v)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2.5">
          <span className="font-medium text-foreground text-sm">{subjectName}</span>
          {examType && <Badge variant="secondary">{titleCase(examType)} only</Badge>}
          {form.has_practical && <Badge variant="secondary">Theory + Practical</Badge>}
          {hasOverride ? <Badge variant="info">Overridden</Badge> : <span className="text-xs text-muted-foreground">{examType ? 'Inherits default / class rule' : 'Inherits class rule'}</span>}
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? 'Hide' : 'Edit'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={form.has_practical} onChange={e => setForm(f => ({ ...f, has_practical: e.target.checked }))} />
            This subject has a separate Theory + Practical split (classes 9-12 style)
          </label>

          {form.has_practical ? (
            <div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label>Default Theory Max</Label>
                <Input type="number" placeholder="e.g. 70" value={form.default_theory_max_marks}
                  onChange={e => setForm(f => ({ ...f, default_theory_max_marks: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Default Theory Pass</Label>
                <Input type="number" placeholder="e.g. 25" value={form.default_theory_pass_marks}
                  onChange={e => setForm(f => ({ ...f, default_theory_pass_marks: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Default Practical Max</Label>
                <Input type="number" placeholder="e.g. 30" value={form.default_practical_max_marks}
                  onChange={e => setForm(f => ({ ...f, default_practical_max_marks: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Default Practical Pass</Label>
                <Input type="number" placeholder="e.g. 10" value={form.default_practical_pass_marks}
                  onChange={e => setForm(f => ({ ...f, default_practical_pass_marks: e.target.value }))} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Pre-fills Add Subject on this exam type's datesheet — still changeable per exam.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label>Default Max Marks</Label>
                <Input type="number" placeholder="e.g. 100" value={form.default_max_marks}
                  onChange={e => setForm(f => ({ ...f, default_max_marks: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Default Pass Marks</Label>
                <Input type="number" placeholder="e.g. 33" value={form.default_pass_marks}
                  onChange={e => setForm(f => ({ ...f, default_pass_marks: e.target.value }))} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Pre-fills Add Subject on this exam type's datesheet — still changeable per exam.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={form.is_additional} onChange={e => setForm(f => ({ ...f, is_additional: e.target.checked }))} />
            Additional subject — can substitute for a failed compulsory subject, if the class rule allows it
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={form.include_in_aggregate} onChange={e => setForm(f => ({ ...f, include_in_aggregate: e.target.checked }))} />
            Include this subject's marks in the overall percentage
          </label>

          <div className="space-y-1.5">
            <Label>Subject Group (optional)</Label>
            <Input placeholder="e.g. &quot;language&quot; — shared with another subject to mean &quot;pass at least one&quot;" value={form.subject_group_key}
              onChange={e => setForm(f => ({ ...f, subject_group_key: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Pass Criteria (overrides class default)</Label>
              <Select value={form.pass_criteria_mode || 'inherit'} onValueChange={v => setForm(f => ({ ...f, pass_criteria_mode: v === 'inherit' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit class rule</SelectItem>
                  <SelectItem value="aggregate">Aggregate only</SelectItem>
                  <SelectItem value="per_subject">Must pass individually</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Grading Mode (overrides class default)</Label>
              <Select value={form.grading_mode || 'inherit'} onValueChange={v => setForm(f => ({ ...f, grading_mode: v === 'inherit' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit class rule</SelectItem>
                  <SelectItem value="marks">Marks / Percentage</SelectItem>
                  <SelectItem value="grade_only">Grade Only</SelectItem>
                  <SelectItem value="cgpa">CGPA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.grading_mode === 'grade_only' && (
            <div className="space-y-1.5">
              <Label>Grade Scale</Label>
              <Select value={form.grade_scale_id || undefined} onValueChange={v => setForm(f => ({ ...f, grade_scale_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select a grade scale..." /></SelectTrigger>
                <SelectContent>
                  {(scales ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_system ? ' (built-in)' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {hasOverride && (
              <Button variant="ghost" size="sm" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} className="text-destructive hover:text-destructive">
                {clearMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Clear override
              </Button>
            )}
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════
// GRADE SCALES
// ═══════════════════════════════════════════════════════════════

function GradeScalesTab() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)

  const { data: scales, isLoading } = useQuery({
    queryKey: ['exam-grade-scales'],
    queryFn: () => api.get('/exams/result-settings/grade-scales').then(r => r.data.data as any[]),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['exam-grade-scales'] })

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Scale</Button>
      </div>
      {(scales ?? []).map((scale: any) => (
        <GradeScaleCard key={scale.id} scale={scale} onChanged={invalidate} />
      ))}
      {showNew && <NewScaleModal onClose={() => { setShowNew(false); invalidate() }} />}
    </div>
  )
}

function GradeScaleCard({ scale, onChanged }: { scale: any; onChanged: () => void }) {
  const bands = [...(scale.exam_grade_bands ?? [])].sort((a: any, b: any) => b.min_percent - a.min_percent)
  const [editing, setEditing] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exams/result-settings/grade-scales/${scale.id}`),
    onSuccess: () => { toast.success('Scale deleted'); onChanged() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            {scale.name}
            {scale.is_system && <Badge variant="secondary">Built-in</Badge>}
            <Badge variant="secondary" className="capitalize">{scale.scale_type}</Badge>
          </CardTitle>
        </div>
        {!scale.is_system && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit Bands</Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {bands.map((b: any) => (
            <div key={b.id} className={`rounded-lg border px-2.5 py-1.5 text-xs ${b.is_pass ? 'border-border' : 'border-destructive/40 bg-destructive/5'}`}>
              <span className="font-semibold text-foreground">{b.grade_label}</span>
              <span className="text-muted-foreground"> {b.min_percent}–{b.max_percent}%{b.grade_point != null ? ` · ${b.grade_point} pts` : ''}</span>
            </div>
          ))}
        </div>
      </CardContent>
      {editing && <EditBandsModal scale={scale} onClose={() => { setEditing(false); onChanged() }} />}
    </Card>
  )
}

function NewScaleModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [scaleType, setScaleType] = useState<'grade' | 'cgpa'>('grade')

  const mutation = useMutation({
    mutationFn: () => api.post('/exams/result-settings/grade-scales', { name, scale_type: scaleType }),
    onSuccess: () => { toast.success('Scale created — add its bands next'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e: any) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">New Grade Scale</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scale-name">Name</Label>
            <Input id="scale-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. State Board Grades" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={scaleType} onValueChange={v => setScaleType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="grade">Letter Grade</SelectItem>
                <SelectItem value="cgpa">CGPA (grade points)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type BandForm = { min_percent: string; max_percent: string; grade_label: string; grade_point: string; is_pass: boolean }

function EditBandsModal({ scale, onClose }: { scale: any; onClose: () => void }) {
  const initial: BandForm[] = (scale.exam_grade_bands ?? []).length
    ? [...scale.exam_grade_bands].sort((a: any, b: any) => b.min_percent - a.min_percent).map((b: any) => ({
        min_percent: String(b.min_percent), max_percent: String(b.max_percent), grade_label: b.grade_label,
        grade_point: b.grade_point == null ? '' : String(b.grade_point), is_pass: b.is_pass,
      }))
    : [{ min_percent: '0', max_percent: '100', grade_label: '', grade_point: '', is_pass: true }]
  const [bands, setBands] = useState<BandForm[]>(initial)

  const update = (i: number, patch: Partial<BandForm>) => setBands(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b))
  const addBand = () => setBands(bs => [...bs, { min_percent: '', max_percent: '', grade_label: '', grade_point: '', is_pass: true }])
  const removeBand = (i: number) => setBands(bs => bs.filter((_, j) => j !== i))

  const mutation = useMutation({
    mutationFn: () => api.put(`/exams/result-settings/grade-scales/${scale.id}/bands`, {
      bands: bands.map(b => ({
        min_percent: Number(b.min_percent), max_percent: Number(b.max_percent), grade_label: b.grade_label,
        grade_point: b.grade_point === '' ? null : Number(b.grade_point), is_pass: b.is_pass,
      })),
    }),
    onSuccess: () => { toast.success('Bands saved'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save bands'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e: any) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">{scale.name} — Bands</CardTitle><CardDescription>Must cover 0% through 100% with no gaps or overlaps.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto_auto] items-center gap-2">
              <Input type="number" placeholder="Min %" value={b.min_percent} onChange={e => update(i, { min_percent: e.target.value })} className="h-9" />
              <Input type="number" placeholder="Max %" value={b.max_percent} onChange={e => update(i, { max_percent: e.target.value })} className="h-9" />
              <Input placeholder="Label (A1, A+...)" value={b.grade_label} onChange={e => update(i, { grade_label: e.target.value })} className="h-9" />
              {scale.scale_type === 'cgpa' ? (
                <Input type="number" placeholder="Points" value={b.grade_point} onChange={e => update(i, { grade_point: e.target.value })} className="h-9" />
              ) : <div />}
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={b.is_pass} onChange={e => update(i, { is_pass: e.target.checked })} /> Pass
              </label>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => removeBand(i)} aria-label="Remove band">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addBand}><Plus className="h-3.5 w-3.5" /> Add band</Button>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Bands
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// REMARKS RULES
// ═══════════════════════════════════════════════════════════════

const RESULT_STATUSES = ['pass', 'fail', 'compartment', 'not_eligible', 'withheld']
const statusLabel = (s: string) => ({ pass: 'Pass', fail: 'Fail', compartment: 'Compartment', not_eligible: 'Not Eligible', withheld: 'Withheld' } as Record<string, string>)[s] ?? s

function RemarksRulesTab() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)

  const { data: rules, isLoading } = useQuery({
    queryKey: ['exam-remarks-rules'],
    queryFn: () => api.get('/exams/result-settings/remarks-rules').then(r => r.data.data as any[]),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['exam-remarks-rules'] })

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Remarks Rule</Button>
      </div>
      {(rules ?? []).map((rule: any) => (
        <RemarksRuleCard key={rule.id} rule={rule} onChanged={invalidate} />
      ))}
      {showNew && <NewRemarksRuleModal onClose={() => { setShowNew(false); invalidate() }} />}
    </div>
  )
}

function RemarksRuleCard({ rule, onChanged }: { rule: any; onChanged: () => void }) {
  const bands = rule.exam_remarks_bands ?? []
  const [editing, setEditing] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exams/result-settings/remarks-rules/${rule.id}`),
    onSuccess: () => { toast.success('Remarks rule deleted'); onChanged() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          {rule.name}
          {rule.is_system && <Badge variant="secondary">Built-in</Badge>}
        </CardTitle>
        {!rule.is_system && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit Bands</Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {bands.map((b: any) => (
          <p key={b.id} className="text-xs">
            <Badge variant="secondary" className="mr-2">{statusLabel(b.match_status)}</Badge>
            {b.min_percent != null && <span className="text-muted-foreground">{b.min_percent}–{b.max_percent}% → </span>}
            <span className="text-foreground">"{b.remark_text}"</span>
          </p>
        ))}
      </CardContent>
      {editing && <EditRemarksBandsModal rule={rule} onClose={() => { setEditing(false); onChanged() }} />}
    </Card>
  )
}

function NewRemarksRuleModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: () => api.post('/exams/result-settings/remarks-rules', { name }),
    onSuccess: () => { toast.success('Remarks rule created — add its bands next'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create'),
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e: any) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">New Remarks Rule</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="remarks-name">Name</Label>
            <Input id="remarks-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Board Style" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type RemarksBandForm = { match_status: string; min_percent: string; max_percent: string; remark_text: string }

function EditRemarksBandsModal({ rule, onClose }: { rule: any; onClose: () => void }) {
  const initial: RemarksBandForm[] = (rule.exam_remarks_bands ?? []).length
    ? rule.exam_remarks_bands.map((b: any) => ({
        match_status: b.match_status, min_percent: b.min_percent == null ? '' : String(b.min_percent),
        max_percent: b.max_percent == null ? '' : String(b.max_percent), remark_text: b.remark_text,
      }))
    : [{ match_status: 'pass', min_percent: '', max_percent: '', remark_text: '' }]
  const [bands, setBands] = useState<RemarksBandForm[]>(initial)

  const update = (i: number, patch: Partial<RemarksBandForm>) => setBands(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b))
  const addBand = () => setBands(bs => [...bs, { match_status: 'pass', min_percent: '', max_percent: '', remark_text: '' }])
  const removeBand = (i: number) => setBands(bs => bs.filter((_, j) => j !== i))

  const mutation = useMutation({
    mutationFn: () => api.put(`/exams/result-settings/remarks-rules/${rule.id}/bands`, {
      bands: bands.map(b => ({
        match_status: b.match_status,
        min_percent: b.min_percent === '' ? null : Number(b.min_percent),
        max_percent: b.max_percent === '' ? null : Number(b.max_percent),
        remark_text: b.remark_text,
      })),
    }),
    onSuccess: () => { toast.success('Bands saved'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save bands'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e: any) => e.stopPropagation()}>
        <CardHeader><CardTitle className="text-base">{rule.name} — Bands</CardTitle><CardDescription>Percentage range is optional — leave blank for a flat remark whenever that outcome occurs.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] items-center gap-2">
              <Select value={b.match_status} onValueChange={v => update(i, { match_status: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESULT_STATUSES.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" placeholder="Min %" value={b.min_percent} onChange={e => update(i, { min_percent: e.target.value })} className="h-9" />
              <Input type="number" placeholder="Max %" value={b.max_percent} onChange={e => update(i, { max_percent: e.target.value })} className="h-9" />
              <Input placeholder="Remark text" value={b.remark_text} onChange={e => update(i, { remark_text: e.target.value })} className="h-9" />
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => removeBand(i)} aria-label="Remove band">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addBand}><Plus className="h-3.5 w-3.5" /> Add band</Button>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Bands
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TERM TEMPLATES — a reusable composite-Term blueprint ("Term 1 = Unit
// Test 1 20% + Unit Test 2 20% + Half Yearly 60%"), applied against a
// class to spin up a real Term (Result Group) with its member exams and
// weights already set and its subjects already synced, instead of
// building one by hand every year. Mirrors Examination Settings' own
// Exam Templates (blueprint -> apply -> real instance) one level up.
// ═══════════════════════════════════════════════════════════════

function TermTemplatesTab({ classes, displayStyle }: { classes: any[]; displayStyle: string }) {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [applyTemplate, setApplyTemplate] = useState<any>(null)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['term-templates'],
    queryFn: () => api.get('/exams/term-templates').then(r => r.data.data as any[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/exams/term-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['term-templates'] }); toast.success('Template removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Term Templates</CardTitle>
              <CardDescription className="text-xs">Configure a composite Term's structure once — apply it against a class every year instead of rebuilding it by hand.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Template</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : !(templates ?? []).length ? (
            <EmptyState icon={Layers} title="No Term templates yet" description="Build one from a recurring Term's usual exams and weights (e.g. Unit Test 1 20% + Unit Test 2 20% + Half Yearly 60%)." className="py-8"
              action={<Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> New Template</Button>} />
          ) : (
            <div className="space-y-2">
              {(templates ?? []).map((t: any) => {
                const slots = (t.term_template_slots ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order)
                return (
                  <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {slots.map((s: any) => `${s.label} ${s.weight_percent}%`).join(' + ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setApplyTemplate(t)}>Use This Template</Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(t.id)} aria-label={`Remove template ${t.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showNew && (
        <NewTermTemplateModal onClose={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['term-templates'] }) }} />
      )}
      {applyTemplate && (
        <ApplyTermTemplateModal template={applyTemplate} classes={classes} displayStyle={displayStyle} onClose={() => setApplyTemplate(null)} />
      )}
    </div>
  )
}

type TermSlotRow = { label: string; exam_type: string; weight_percent: number }

function NewTermTemplateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [slots, setSlots] = useState<TermSlotRow[]>([
    { label: '', exam_type: '', weight_percent: 100 },
  ])

  const addRow = () => setSlots(s => [...s, { label: '', exam_type: '', weight_percent: 0 }])
  const removeRow = (i: number) => setSlots(s => s.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TermSlotRow>) => setSlots(s => s.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  const totalWeight = slots.reduce((sum, s) => sum + (Number(s.weight_percent) || 0), 0)
  const weightsOk = Math.abs(totalWeight - 100) < 0.01
  const rowsValid = slots.length > 0 && slots.every(s => s.label.trim() && Number(s.weight_percent) > 0)
  const canSave = name.trim() && rowsValid && weightsOk

  const mutation = useMutation({
    mutationFn: () => api.post('/exams/term-templates', {
      name,
      slots: slots.map(s => ({ label: s.label, exam_type: s.exam_type || undefined, weight_percent: Number(s.weight_percent) })),
    }),
    onSuccess: () => { toast.success('Term template created'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to create template'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Term Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Term 1" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Member Exam Slots</Label>
              <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add Row</Button>
            </div>
            <div className="space-y-2">
              {slots.map((row, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_100px_auto] gap-2 rounded-xl border border-border p-2.5">
                  <Input placeholder="Label — e.g. Unit Test 1" value={row.label} onChange={e => updateRow(i, { label: e.target.value })} className="h-9" />
                  <Select value={row.exam_type || 'none'} onValueChange={v => updateRow(i, { exam_type: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Exam type (optional)..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No type hint</SelectItem>
                      {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={0} max={100} value={row.weight_percent} onChange={e => updateRow(i, { weight_percent: Number(e.target.value) })} className="h-9" placeholder="Weight %" />
                  {slots.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => removeRow(i)} aria-label="Remove row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <p className={`text-xs ${weightsOk ? 'text-muted-foreground' : 'text-warning'}`}>
              Total weight: {totalWeight}% {!weightsOk && '— must sum to exactly 100% before saving'}
            </p>
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

// Turns a blueprint into a real Term (Result Group) + its member exams +
// synced subjects in one submit — only which real exam fulfills each
// slot needs picking, everything else (weights, name-as-starting-point)
// is inherited from the template. Mirrors Examination Settings'
// ApplyTemplateModal exactly, one level up.
function ApplyTermTemplateModal({ template, classes, displayStyle, onClose }: { template: any; classes: any[]; displayStyle: string; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [classIds, setClassIds] = useState<Set<string>>(new Set())
  const [name, setName] = useState(template.name)
  const [examBySlot, setExamBySlot] = useState<Record<string, string>>({})

  const slots = (template.term_template_slots ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order)

  const { data: exams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get('/exams', { params: { limit: 100 } }).then(r => r.data.data as any[]),
  })

  const examOptionsForSlot = (slot: any) => {
    const list = exams ?? []
    if (!slot.exam_type) return list
    // Matching-type exams first, purely a sorting convenience — a slot's
    // exam_type is a hint, never a restriction on what can be picked.
    return [...list].sort((a, b) => (a.exam_type === slot.exam_type ? -1 : 0) - (b.exam_type === slot.exam_type ? -1 : 0))
  }

  const toggleClass = (id: string) => setClassIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // The real member exams behind a template are typically shared across
  // classes already (one "Half Yearly Examination" exam spans every
  // class's own datesheet rows) — so applying to several classes reuses
  // this one exam_ids pick for all of them, just creating one Term per
  // class, each syncing its own subjects.
  const mutation = useMutation({
    mutationFn: () => api.post(`/exams/term-templates/${template.id}/apply`, {
      class_ids: Array.from(classIds), name, exam_ids: examBySlot,
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['result-groups'] })
      const created = res.data.data as any[]
      onClose()
      if (created.length === 1) {
        toast.success('Term created from template!')
        router.push(`/exams/result-groups/${created[0].id}`)
      } else {
        toast.success(`${created.length} Terms created from template!`)
        router.push('/exams/results?mode=term')
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply template'),
  })

  const canSave = classIds.size > 0 && name.trim() && slots.every((s: any) => examBySlot[s.id])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Term from "{template.name}"</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Classes * <span className="font-normal text-muted-foreground">— select every class this structure applies to</span></Label>
            <ClassCheckboxPicker classes={classes} selected={classIds} onToggle={toggleClass} displayStyle={displayStyle as 'numeric' | 'roman'} />
          </div>
          <div className="space-y-1.5">
            <Label>Term Name * {classIds.size > 1 && <span className="font-normal text-muted-foreground">— each class's Term is named "{name || '...'} — &lt;class&gt;"</span>}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Slots — pick the real exam for each</Label>
            <div className="space-y-2">
              {slots.map((s: any) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{s.label}</p>
                    <p className="text-xs text-muted-foreground">Weight {s.weight_percent}%{s.exam_type ? ` · usually ${titleCase(s.exam_type)}` : ''}</p>
                  </div>
                  <Select value={examBySlot[s.id] || undefined} onValueChange={v => setExamBySlot(m => ({ ...m, [s.id]: v }))}>
                    <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Select exam..." /></SelectTrigger>
                    <SelectContent>
                      {examOptionsForSlot(s).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Term
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════
// APPLY PRESET — a one-time autofill of the class-default rule for
// whichever classes are checked, never a live binding. Every field it
// sets is exactly what a school could set by hand on the Class Rules tab
// — nothing preset-only exists in the engine.
// ═══════════════════════════════════════════════════════════════

function ApplyPresetTab({ classes, displayStyle }: { classes: any[]; displayStyle: string }) {
  const [selectedKey, setSelectedKey] = useState('')
  const [checkedClasses, setCheckedClasses] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  const { data: presets, isLoading } = useQuery({
    queryKey: ['result-presets'],
    queryFn: () => api.get('/exams/result-settings/presets').then(r => r.data.data as any[]),
  })
  const preset = (presets ?? []).find(p => p.key === selectedKey)

  const applyMutation = useMutation({
    mutationFn: () => api.post(`/exams/result-settings/presets/${selectedKey}/apply`, { class_ids: Array.from(checkedClasses) }),
    onSuccess: (r: any) => { toast.success(`Applied to ${r.data.data.applied} class${r.data.data.applied === 1 ? '' : 'es'} — edit any of them individually on the Class Rules tab.`); setConfirming(false); setCheckedClasses(new Set()) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply preset'),
  })

  const toggleClass = (id: string) => setCheckedClasses(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const selectSuggested = () => {
    if (!preset) return
    setCheckedClasses(new Set(classes.filter(c => (c.numeric_level ?? 0) >= preset.classRange.min && (c.numeric_level ?? 0) <= preset.classRange.max).map(c => c.id)))
  }

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(presets ?? []).map((p: any) => (
          <button key={p.key} onClick={() => { setSelectedKey(p.key); setCheckedClasses(new Set()) }}
            className={`rounded-xl border p-4 text-left transition-colors ${selectedKey === p.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
            <p className="font-semibold text-sm text-foreground">{p.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
          </button>
        ))}
      </div>

      {preset && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Apply to which classes?</h3>
            <Button variant="ghost" size="sm" onClick={selectSuggested}>Select suggested range</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {classes.map((c: any) => (
              <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={checkedClasses.has(c.id)} onChange={() => toggleClass(c.id)} />
                {classLabel(c.name, c.numeric_level, displayStyle)}
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setConfirming(true)} disabled={checkedClasses.size === 0}>
              Apply to {checkedClasses.size} class{checkedClasses.size === 1 ? '' : 'es'}
            </Button>
          </div>
        </Card>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirming(false)}>
          <Card className="w-full max-w-md" onClick={(e: any) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">Apply "{preset?.name}"?</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This overwrites the default result rule for {checkedClasses.size} class{checkedClasses.size === 1 ? '' : 'es'}. Any existing settings for those classes' defaults will be replaced — this does not touch exam-type-specific overrides or subject overrides. You can edit anything afterward on the Class Rules tab.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
                  {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Apply
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PUBLISH WORKFLOW — how many approval steps an exam's results go
// through before becoming visible to students/parents, and which of the
// school's own roles each step belongs to. See resultSettings.routes.ts's
// GET/PUT /workflow — saving retires the previous workflow_definitions row
// and creates a fresh one, so exams already mid-flow (or already
// published) under the old configuration keep their real history intact.
// ═══════════════════════════════════════════════════════════════

type WorkflowStepForm = { role_id: string; action_name: string }

function findRoleId(roles: any[], name: string): string {
  return roles.find((r: any) => r.name === name)?.id ?? ''
}

const WORKFLOW_PRESETS: Record<'1' | '2' | '3', (roles: any[]) => WorkflowStepForm[]> = {
  '1': roles => [{ role_id: findRoleId(roles, 'Principal'), action_name: 'Publish' }],
  '2': roles => [
    { role_id: findRoleId(roles, 'Exam Controller'), action_name: 'Freeze' },
    { role_id: findRoleId(roles, 'Principal'), action_name: 'Publish' },
  ],
  '3': roles => [
    { role_id: findRoleId(roles, 'Exam Controller'), action_name: 'Freeze' },
    { role_id: findRoleId(roles, 'Principal'), action_name: 'Verify' },
    { role_id: findRoleId(roles, 'Principal'), action_name: 'Publish' },
  ],
}

function PublishWorkflowTab() {
  const qc = useQueryClient()
  const [steps, setSteps] = useState<WorkflowStepForm[] | null>(null)
  const [dirty, setDirty] = useState(false)

  const { data: workflow, isLoading: workflowLoading } = useQuery({
    queryKey: ['result-workflow'],
    queryFn: () => api.get('/exams/result-settings/workflow').then(r => r.data.data),
  })
  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => api.get('/rbac/roles').then(r => r.data.data as any[]),
  })

  const savedSteps: WorkflowStepForm[] = (workflow?.steps ?? []).map((s: any) => ({ role_id: s.role_id, action_name: s.action_name }))
  const currentSteps = steps ?? savedSteps
  const editable = workflow?.editable !== false

  const saveMutation = useMutation({
    mutationFn: () => api.put('/exams/result-settings/workflow', { steps: currentSteps }),
    onSuccess: () => {
      toast.success('Publish workflow saved — this applies the next time an exam starts the freeze/publish process.')
      setDirty(false); setSteps(null)
      qc.invalidateQueries({ queryKey: ['result-workflow'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save workflow'),
  })

  const update = (next: WorkflowStepForm[]) => { setSteps(next); setDirty(true) }
  const updateStep = (i: number, patch: Partial<WorkflowStepForm>) => update(currentSteps.map((s, j) => j === i ? { ...s, ...patch } : s))
  const addStep = () => update([...currentSteps, { role_id: '', action_name: '' }])
  const removeStep = (i: number) => update(currentSteps.filter((_, j) => j !== i))
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= currentSteps.length) return
    const next = [...currentSteps]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }
  const applyPreset = (key: '1' | '2' | '3') => { if (roles) update(WORKFLOW_PRESETS[key](roles)) }

  if (workflowLoading || rolesLoading) return <Skeleton className="h-64 w-full rounded-2xl" />

  const canSave = currentSteps.length > 0 && currentSteps.every(s => s.role_id && s.action_name.trim())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="h-4 w-4" /> Result Freeze &amp; Publish Workflow</CardTitle>
        <CardDescription>Choose how many approval steps an exam's results go through — and which of your school's roles each step belongs to — before they become visible to students and parents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editable && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            An exam's results are currently mid-approval on this workflow — finish or reject that first before changing the steps.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Quick setup:</span>
          {(['1', '2', '3'] as const).map(k => (
            <Button key={k} variant="outline" size="sm" disabled={!editable} onClick={() => applyPreset(k)}>
              {k}-step{k === '3' ? ' (default)' : ''}
            </Button>
          ))}
        </div>

        <div className="space-y-3">
          {currentSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <Select value={step.role_id || undefined} onValueChange={v => updateStep(i, { role_id: v })} disabled={!editable}>
                <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {(roles ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-9 flex-1" placeholder="Step label, e.g. Verify Results" value={step.action_name}
                onChange={e => updateStep(i, { action_name: e.target.value })} disabled={!editable} />
              <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!editable || i === 0} onClick={() => moveStep(i, -1)} aria-label="Move step up">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!editable || i === currentSteps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move step down">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                disabled={!editable || currentSteps.length <= 1} onClick={() => removeStep(i)} aria-label="Remove step">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" disabled={!editable} onClick={addStep}><Plus className="h-3.5 w-3.5" /> Add step</Button>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!editable || !dirty || !canSave || saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
