'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { syllabusApi, classesApi, api } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassPicker } from '@/lib/useClassPicker'
import { cn, formatDate } from '@/lib/utils'
import { Trash2, Loader2, ShieldOff, CalendarClock, CheckCircle2, Clock, Circle, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectGroup, SelectLabel, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { AddChaptersForm, EXAM_TYPE_LABELS } from '@/components/academics/AddChaptersForm'

const CHAPTER_STATUS_ICON: Record<string, any> = { completed: CheckCircle2, in_progress: Clock, pending: Circle }
const CHAPTER_STATUS_COLOR: Record<string, string> = { completed: 'text-success', in_progress: 'text-warning', pending: 'text-muted-foreground/50' }
const todayKey = new Date().toISOString().slice(0, 10)

// The "Due Dates" tab of the Syllabus module — used to be the "Set
// Chapter Due Dates" modal behind a button on the combined page. Its own
// page now — see app/(app)/syllabus/layout.tsx. syllabus.plan-gated, same
// as before, so useClassPicker always runs in "senior management" mode
// here: a Teacher without that permission never reaches this page (the
// layout tab and the gate below both keep it out), so there's no "my
// classes only" branch to support.
export default function SyllabusDueDatesPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canPlan = can('syllabus.plan')

  if (!permLoading && !canPlan) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to plan syllabus due dates." className="h-64" />
    )
  }

  return <SyllabusDueDatesView />
}

function SyllabusDueDatesView() {
  const qc = useQueryClient()
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections } = useClassPicker(true)
  const [selectedSubject, setSelectedSubjectRaw] = useState('')
  const [applyToSection, setApplyToSection] = useState(true)
  const setSelectedClassAndReset = (v: string) => { setSelectedClass(v); setSelectedSubjectRaw('') }

  // Subject is picked from the school's master subject list (Settings ->
  // Classes & Sections), not typed — a typo here ("Maths" vs
  // "Mathematics") would silently break the match against what's on the
  // teacher's timetable.
  const { data: masterSubjects } = useQuery({
    queryKey: ['subjects', selectedClass],
    queryFn: () => classesApi.subjects.list(selectedClass).then(r => r.data),
    enabled: !!selectedClass,
  })

  const effectiveSectionId = applyToSection ? selectedSection : ''
  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['syllabus', selectedClass, effectiveSectionId, selectedSubject],
    queryFn: () => syllabusApi.list({ class_id: selectedClass, section_id: effectiveSectionId || undefined, subject_name: selectedSubject || undefined }).then(r => r.data),
    enabled: !!selectedClass && !!selectedSubject,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['syllabus'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats-all'] })
  }

  const deleteChapterMutation = useMutation({
    mutationFn: (id: string) => syllabusApi.delete(id),
    onSuccess: () => { invalidate(); toast.success('Removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Chapter Due Dates" description="Plan the syllabus — tie each chapter to an exam or a custom date." icon={CalendarClock} />

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Class</Label>
          <Select value={selectedClass || undefined} onValueChange={setSelectedClassAndReset}>
            <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
            <SelectContent>
              {classesData.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Section</Label>
            <Select value={selectedSection || undefined} onValueChange={setSelectedSection}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select section..." /></SelectTrigger>
              <SelectContent>
                {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedClass && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Subject</Label>
            <Select value={selectedSubject || undefined} onValueChange={setSelectedSubjectRaw}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select subject..." /></SelectTrigger>
              <SelectContent>
                {(masterSubjects ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedClass && (masterSubjects ?? []).length === 0 && (
          <p className="text-xs text-warning">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
        )}
      </div>

      {!selectedClass || (sections.length > 0 && !selectedSection) || !selectedSubject ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState icon={CalendarClock} title="Pick a class, section and subject" description="Select a class, section and subject above to plan or review its chapter due dates." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-2">
          <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Existing chapters</h3>
              {selectedSection && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={applyToSection} onChange={e => setApplyToSection(e.target.checked)} />
                  This section only
                </label>
              )}
            </div>
            {chaptersLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
            ) : (chapters ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No chapters planned yet for this subject.</p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {(chapters ?? []).map((c: any) => (
                  <ExistingChapterRow
                    key={c.id} chapter={c}
                    onDelete={() => deleteChapterMutation.mutate(c.id)}
                    onSaved={invalidate}
                  />
                ))}
              </div>
            )}
          </div>

          <AddChaptersForm classId={selectedClass} sectionId={applyToSection ? selectedSection : ''} subjectName={selectedSubject} onSaved={invalidate} />
        </div>
      )}
    </div>
  )
}

// A chapter that's already saved — same status/overdue display as
// before, plus an edit action so a due date left blank at creation (e.g.
// after an Excel import, which only ever fills in names) can be set
// afterward, or an existing one changed to a different exam or custom
// date. Uses the same PATCH /syllabus/:id the rest of this module's
// syllabus.log_progress-gated status edits already go through — this is
// the syllabus.plan side of that same endpoint.
function ExistingChapterRow({ chapter: c, onDelete, onSaved }: { chapter: any; onDelete: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [dueMode, setDueMode] = useState<'exam' | 'template' | 'custom'>(c.exam_id ? 'exam' : c.exam_template_id ? 'template' : 'custom')
  const [examId, setExamId] = useState(c.exam_id ?? '')
  const [templateId, setTemplateId] = useState(c.exam_template_id ?? '')
  const [plannedDate, setPlannedDate] = useState(c.planned_date ?? '')
  const [saving, setSaving] = useState(false)

  const { data: exams } = useQuery({
    queryKey: ['exams-for-syllabus'],
    queryFn: () => api.get('/exams', { params: { limit: 100 } }).then(r => r.data.data as any[]),
    enabled: editing,
  })
  const sortedExams = useMemo(() => [...(exams ?? [])].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '')), [exams])

  const { data: examTemplates } = useQuery({
    queryKey: ['exam-templates-for-syllabus'],
    queryFn: () => api.get('/exams/templates').then(r => r.data.data as any[]),
    enabled: editing,
  })

  const Icon = CHAPTER_STATUS_ICON[c.status] ?? Circle
  const overdue = c.status !== 'completed' && c.due_date && c.due_date < todayKey
  const templateTag = c.exam_templates?.name ?? null

  const startEditing = () => {
    setDueMode(c.exam_id ? 'exam' : c.exam_template_id ? 'template' : 'custom')
    setExamId(c.exam_id ?? '')
    setTemplateId(c.exam_template_id ?? '')
    setPlannedDate(c.planned_date ?? '')
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await syllabusApi.update(c.id, {
        exam_id: dueMode === 'exam' ? (examId || null) : undefined,
        exam_template_id: dueMode === 'template' ? (templateId || null) : undefined,
        planned_date: dueMode === 'custom' ? (plannedDate || null) : undefined,
      })
      toast.success('Due date updated')
      setEditing(false)
      onSaved()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update')
    } finally { setSaving(false) }
  }

  return (
    <div className="border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className={cn('h-4 w-4 shrink-0', CHAPTER_STATUS_COLOR[c.status])} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {c.chapter_number ? `${c.chapter_number}. ` : ''}{c.chapter_name}
            </p>
            {!editing && (
              <p className="text-xs text-muted-foreground">
                {c.status === 'completed' && c.actual_completion_date
                  ? `Completed ${formatDate(c.actual_completion_date)}`
                  : c.due_date ? `Due ${formatDate(c.due_date)}`
                  : templateTag ? `Coming in ${templateTag}`
                  : 'No due date'}
              </p>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            {overdue && <Badge variant="destructive">Overdue</Badge>}
            <button onClick={startEditing} aria-label={`Edit due date for ${c.chapter_name}`}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} aria-label={`Remove chapter ${c.chapter_name}`}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Select
            value={
              dueMode === 'custom' ? 'custom'
                : dueMode === 'template' ? (templateId ? `template:${templateId}` : 'none')
                : (examId ? `exam:${examId}` : 'none')
            }
            onValueChange={v => {
              if (v === 'custom') { setDueMode('custom'); setExamId(''); setTemplateId('') }
              else if (v === 'none') { setDueMode('exam'); setExamId(''); setTemplateId('') }
              else if (v.startsWith('template:')) { setDueMode('template'); setTemplateId(v.slice(9)); setExamId('') }
              else { setDueMode('exam'); setExamId(v.slice(5)); setTemplateId('') }
            }}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No due date</SelectItem>
              {(examTemplates ?? []).length > 0 && (
                <SelectGroup>
                  <SelectLabel>Exam Templates</SelectLabel>
                  {(examTemplates ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={`template:${t.id}`}>
                      {EXAM_TYPE_LABELS[t.exam_type] ?? t.exam_type} — {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {sortedExams.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Scheduled Exams</SelectLabel>
                  {sortedExams.map(ex => (
                    <SelectItem key={ex.id} value={`exam:${ex.id}`}>
                      {EXAM_TYPE_LABELS[ex.exam_type] ?? ex.exam_type} — {ex.name}{ex.start_date ? ` (${formatDate(ex.start_date)})` : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectItem value="custom">Custom date...</SelectItem>
            </SelectContent>
          </Select>
          {dueMode === 'custom' && (
            <Input type="date" className="w-36" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
          )}
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      )}
    </div>
  )
}

