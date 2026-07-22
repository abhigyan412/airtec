'use client'
import { useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { homeworkApi, syllabusApi, admissionApi, academicsApi, classesApi, api } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Trash2, Loader2, ShieldOff, BookOpen, ClipboardList, NotebookPen, CheckCircle2, Clock, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { MonthCalendar, toDateKey, type CalendarEvent } from '@/components/academics/MonthCalendar'
import { SyllabusMeter } from '@/components/academics/SyllabusMeter'

type Tab = 'homework' | 'syllabus'
const todayKey = toDateKey(new Date())

export default function HomeworkPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canView = can('homework.view')
  const canCreate = can('homework.create')
  const canSeeSyllabus = can('syllabus.view')
  const canPlanSyllabus = can('syllabus.plan')
  const canLogSyllabus = can('syllabus.log_progress')

  if (!permLoading && !canView) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <ShieldOff className="w-12 h-12 mb-3 text-gray-200" />
        <p className="font-semibold text-gray-500">Access Denied</p>
        <p className="text-sm mt-1">You don't have permission to view homework.</p>
      </div>
    )
  }

  // Students/parents (and, now, plain Teachers with no create/syllabus
  // rights at all) get a simple read-only "My Homework" list — everything
  // else (class pickers, syllabus, notes) is a staff tool.
  if (!canCreate && !canSeeSyllabus) {
    return <MyHomeworkView />
  }

  return (
    <StaffHomeworkView
      canCreate={canCreate}
      canSeeSyllabus={canSeeSyllabus}
      canPlanSyllabus={canPlanSyllabus}
      canLogSyllabus={canLogSyllabus}
    />
  )
}

// ── STUDENT / PARENT VIEW ─────────────────────────────────────
function MyHomeworkView() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Homework</h1>
        <p className="text-gray-500 text-sm mt-0.5">Homework and classwork assigned to you</p>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">Nothing assigned yet</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {(data ?? []).map((hw: any) => (
            <div key={hw.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase',
                      hw.type === 'homework' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600')}>
                      {hw.type}
                    </span>
                    <span className="text-xs text-gray-400">{hw.subject_name}</span>
                  </div>
                  <h3 className="font-semibold text-gray-900">{hw.title}</h3>
                  {hw.description && <p className="text-sm text-gray-500 mt-1">{hw.description}</p>}
                </div>
                {hw.due_date && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400">Due</p>
                    <p className="text-sm font-medium text-gray-700">{formatDate(hw.due_date)}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── STAFF VIEW ─────────────────────────────────────────────────
function StaffHomeworkView({ canCreate, canSeeSyllabus, canPlanSyllabus, canLogSyllabus }: {
  canCreate: boolean; canSeeSyllabus: boolean; canPlanSyllabus: boolean; canLogSyllabus: boolean
}) {
  const [tab, setTab] = useState<Tab>('homework')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSection, setSelectedSection] = useState('')

  // syllabus.plan (setting due-date targets) is the one permission that
  // stays exclusive to School Admin/Principal/Vice Principal — that's
  // the actual "senior management" signal. homework.create is NOT a
  // safe signal for this anymore: Teacher/Class Teacher now have it too
  // (they can post homework for their own classes), so using it here
  // would wrongly treat every teacher as senior management and show
  // them the unrestricted school-wide view instead of just their own
  // timetabled classes.
  const isSeniorManagement = canPlanSyllabus

  const { data: allClasses } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
    enabled: isSeniorManagement,
  })

  const { data: myClasses } = useQuery({
    queryKey: ['my-classes'],
    queryFn: () => academicsApi.myClasses().then(r => r.data),
    enabled: !isSeniorManagement,
  })

  // Normalize both sources into the same { id, name, sections: [{id,name}] }
  // shape the picker below already expects.
  const classesData = useMemo(() => {
    if (isSeniorManagement) return allClasses ?? []
    const byClass = new Map<string, any>()
    for (const row of myClasses ?? []) {
      if (!byClass.has(row.class_id)) byClass.set(row.class_id, { id: row.class_id, name: row.class_name, sections: [] })
      if (row.section_id) byClass.get(row.class_id).sections.push({ id: row.section_id, name: row.section_name })
    }
    return Array.from(byClass.values())
  }, [isSeniorManagement, allClasses, myClasses])

  const selectedClassObj = classesData.find((c: any) => c.id === selectedClass)
  const sections = selectedClassObj?.sections ?? []

  // Subjects the CURRENT user is actually timetabled for in the selected
  // class+section — undefined (no restriction) for senior management,
  // who can post/plan for any subject.
  const myAllowedSubjects = isSeniorManagement ? undefined : Array.from(new Set(
    (myClasses ?? [])
      .filter((c: any) => c.class_id === selectedClass && (c.section_id ?? '') === (selectedSection ?? ''))
      .map((c: any) => c.subject_name)
  ))

  const TABS: { id: Tab; label: string; icon: any; show: boolean }[] = [
    { id: 'homework', label: 'Homework & Classwork', icon: BookOpen, show: true },
    { id: 'syllabus', label: 'Syllabus Progress', icon: ClipboardList, show: canSeeSyllabus },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Homework</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {isSeniorManagement ? 'Assign homework/classwork and track syllabus progress school-wide' : 'Your classes, homework, and syllabus progress'}
        </p>
      </div>

      {canSeeSyllabus && (
        <SyllabusOverview scope={isSeniorManagement ? 'all' : (myClasses ?? [])} />
      )}

      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.filter(t => t.show).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
          <select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSelectedSection('') }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none min-w-[160px]">
            <option value="">Select class...</option>
            {classesData.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {sections.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Section</label>
            <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
              <option value="">{isSeniorManagement ? 'All sections' : 'Select section...'}</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {!selectedClass ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">{classesData.length === 0 && !isSeniorManagement ? "You're not scheduled to teach any class yet — check your timetable" : 'Select a class to get started'}</p>
        </div>
      ) : tab === 'homework' ? (
        <HomeworkTab classId={selectedClass} sectionId={selectedSection} canCreate={canCreate} allowedSubjects={myAllowedSubjects} />
      ) : (
        <SyllabusTab classId={selectedClass} sectionId={selectedSection} canPlan={canPlanSyllabus} canLog={canLogSyllabus} allowedSubjects={myAllowedSubjects} />
      )}
    </div>
  )
}

// ── SYLLABUS OVERVIEW — always-visible progress bars, scoped by role ──
// School Admin/Principal/VP: every class+section+subject in the school.
// Teacher/Class Teacher: only the exact class+section+SUBJECT combos
// they're scheduled to teach (per the timetable) — a Maths teacher for
// Class 1-A must not see Class 1-A's English progress just because they
// share a section. The stats call is per class+section (merging "whole
// class" + "this section" due dates, as the endpoint already does); the
// subject filter is applied after, client-side, against their timetable.
function SyllabusOverview({ scope }: {
  scope: 'all' | { class_id: string; class_name: string; section_id: string | null; section_name: string | null; subject_name: string }[]
}) {
  const allStats = useQuery({
    queryKey: ['syllabus-stats-all'],
    queryFn: () => syllabusApi.stats().then(r => r.data),
    enabled: scope === 'all',
  })

  const uniquePairs = useMemo(() => {
    if (scope === 'all') return []
    const byKey = new Map<string, { class_id: string; section_id: string | null }>()
    for (const c of scope) byKey.set(`${c.class_id}::${c.section_id ?? 'none'}`, c)
    return Array.from(byKey.values())
  }, [scope])

  const allowedSubjects = useMemo(() => {
    const map = new Map<string, Set<string>>()
    if (scope === 'all') return map
    for (const c of scope) {
      const key = `${c.class_id}::${c.section_id ?? 'none'}`
      if (!map.has(key)) map.set(key, new Set())
      map.get(key)!.add(c.subject_name)
    }
    return map
  }, [scope])

  const myStats = useQueries({
    queries: uniquePairs.map(c => ({
      queryKey: ['syllabus-stats', c.class_id, c.section_id],
      queryFn: () => syllabusApi.stats({ class_id: c.class_id, section_id: c.section_id ?? undefined }).then(r => r.data),
    })),
  })

  const cards = scope === 'all'
    ? (allStats.data ?? [])
    : myStats.flatMap(q => q.data ?? []).filter((s: any) => {
        const key = `${s.class_id}::${s.section_id ?? 'none'}`
        return allowedSubjects.get(key)?.has(s.subject_name)
      })

  if (scope !== 'all' && scope.length === 0) return null
  if (cards.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">
        {scope === 'all' ? 'School-wide syllabus progress' : 'Your classes'}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((s: any) => (
          <SyllabusMeter
            key={`${s.class_id}-${s.section_id ?? 'all'}-${s.subject_name}`}
            label={`${s.class_name}${s.section_name ? ` · ${s.section_name}` : ''} · ${s.subject_name}`}
            percentComplete={s.percent_complete}
            percentExpected={s.percent_expected}
            completed={s.completed}
            total={s.total}
          />
        ))}
      </div>
    </div>
  )
}

// ── HOMEWORK & CLASSWORK TAB — calendar view ────────────────────
function HomeworkTab({ classId, sectionId, canCreate, allowedSubjects }: {
  classId: string; sectionId: string; canCreate: boolean; allowedSubjects?: string[]
}) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string>(todayKey)

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['homework', classId, sectionId],
    queryFn: () => homeworkApi.list({ class_id: classId, section_id: sectionId || undefined }).then(r => r.data),
  })
  // Same boundary as Syllabus: a teacher only sees/manages homework for
  // subjects they're actually scheduled to teach in this class+section.
  const data = allowedSubjects ? (rawData ?? []).filter((hw: any) => allowedSubjects.includes(hw.subject_name)) : rawData

  const deleteMutation = useMutation({
    mutationFn: (id: string) => homeworkApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['homework'] }); toast.success('Deleted') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const hw of data ?? []) {
      const key = hw.due_date || hw.assigned_date
      if (!key) continue
      if (!map[key]) map[key] = []
      map[key].push(hw)
    }
    return map
  }, [data])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const [key, items] of Object.entries(byDate)) {
      map[key] = items.map(hw => ({
        id: hw.id, label: hw.title,
        color: hw.type === 'homework' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700',
      }))
    }
    return map
  }, [byDate])

  const dayItems = byDate[selectedDate] ?? []

  return (
    <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
      <MonthCalendar month={month} onMonthChange={setMonth} selectedDate={selectedDate} onSelectDate={setSelectedDate} eventsByDate={eventsByDate} />

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {selectedDate === todayKey ? 'Today' : formatDate(selectedDate)}</p>
            <h3 className="font-semibold text-gray-900 text-sm mt-0.5">Due this day</h3>
          </div>
          {canCreate && (
            <button onClick={() => setShowAdd(true)} title="Assign for this day"
              className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0">
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : dayItems.length === 0 ? (
          <p className="text-xs text-gray-400">Nothing due this day</p>
        ) : (
          <div className="space-y-3">
            {dayItems.map((hw: any) => (
              <div key={hw.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                        hw.type === 'homework' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600')}>
                        {hw.type}
                      </span>
                      {hw.assignment_type === 'individual' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-600">Individual</span>
                      )}
                      <span className="text-[10px] text-gray-400 truncate">{hw.subject_name}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate">{hw.title}</p>
                    {hw.description && <p className="text-xs text-gray-500 mt-0.5">{hw.description}</p>}
                  </div>
                  {canCreate && (
                    <button onClick={() => deleteMutation.mutate(hw.id)} className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddHomeworkModal classId={classId} sectionId={sectionId} initialDueDate={selectedDate} allowedSubjects={allowedSubjects}
          onClose={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['homework'] }) }} />
      )}
    </div>
  )
}

function AddHomeworkModal({ classId, sectionId, initialDueDate, allowedSubjects, onClose }: {
  classId: string; sectionId: string; initialDueDate?: string; allowedSubjects?: string[]; onClose: () => void
}) {
  const [type, setType] = useState<'homework' | 'classwork'>('homework')
  const [assignmentType, setAssignmentType] = useState<'class' | 'individual'>('class')
  const [subjectName, setSubjectName] = useState(allowedSubjects?.length === 1 ? allowedSubjects[0] : '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(initialDueDate ?? '')
  const [studentIds, setStudentIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const { data: students } = useQuery({
    queryKey: ['attendance-class-students', classId, sectionId],
    queryFn: () => api.get('/students/attendance/class', { params: { class_id: classId, section_id: sectionId || undefined, date: new Date().toISOString().slice(0, 10) } }).then(r => r.data.data.students),
    enabled: assignmentType === 'individual',
  })

  // Senior management picks from the school's full subject list for this
  // class; a restricted teacher's options (allowedSubjects) are always a
  // subset of the same list, sourced from their timetable.
  const { data: classSubjects } = useQuery({
    queryKey: ['subjects', classId],
    queryFn: () => classesApi.subjects.list(classId).then(r => r.data),
    enabled: !allowedSubjects,
  })
  const subjectOptions = allowedSubjects ?? (classSubjects ?? []).map((s: any) => s.name)

  const handleSave = async () => {
    if (!subjectName.trim() || !title.trim()) return toast.error('Subject and title are required')
    if (assignmentType === 'individual' && studentIds.length === 0) return toast.error('Select at least one student')
    setLoading(true)
    try {
      await homeworkApi.create({
        class_id: classId, section_id: sectionId || undefined, subject_name: subjectName.trim(),
        type, assignment_type: assignmentType, title: title.trim(), description: description.trim() || undefined,
        due_date: dueDate || undefined, student_ids: assignmentType === 'individual' ? studentIds : undefined,
      })
      toast.success('Assigned')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign')
    } finally { setLoading(false) }
  }

  const ic = 'w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Assign Homework / Classwork</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Type</label>
              <select className={ic} value={type} onChange={e => setType(e.target.value as any)}>
                <option value="homework">Homework</option>
                <option value="classwork">Classwork</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Assign to</label>
              <select className={ic} value={assignmentType} onChange={e => setAssignmentType(e.target.value as any)}>
                <option value="class">Whole class</option>
                <option value="individual">Specific students</option>
              </select>
            </div>
          </div>

          {assignmentType === 'individual' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Students</label>
              <div className="border border-gray-200 rounded-xl p-2 max-h-36 overflow-y-auto space-y-1">
                {(students ?? []).map((s: any) => (
                  <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm cursor-pointer">
                    <input type="checkbox" checked={studentIds.includes(s.id)}
                      onChange={e => setStudentIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />
                    {s.first_name} {s.last_name} {s.roll_number && <span className="text-gray-400">· Roll {s.roll_number}</span>}
                  </label>
                ))}
                {(students ?? []).length === 0 && <p className="text-xs text-gray-400 px-2 py-1.5">No students found for this class/section</p>}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject *</label>
            <select className={ic} value={subjectName} onChange={e => setSubjectName(e.target.value)}>
              <option value="">Select subject...</option>
              {subjectOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
            </select>
            {subjectOptions.length === 0 && (
              <p className="text-xs text-amber-600 mt-1.5">
                {allowedSubjects ? "You're not timetabled for any subject in this class/section." : 'No subjects set up for this class yet — add some in Settings → Classes & Sections.'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Title *</label>
            <input className={ic} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 4 exercises 1-10" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea className={ic} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details / instructions" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Due Date</label>
            <input type="date" className={ic} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Assign
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SYLLABUS PROGRESS TAB ──────────────────────────────────────
// "Due" = the planned date senior management set for a chapter.
// "Covered" = derived from a teacher's daily progress log against that
// chapter — logging a chapter as 'completed' is what actually flips its
// status; there's no separate one-click toggle anymore.
function SyllabusTab({ classId, sectionId, canPlan, canLog, allowedSubjects }: {
  classId: string; sectionId: string; canPlan: boolean; canLog: boolean; allowedSubjects?: string[]
}) {
  const qc = useQueryClient()
  const [subjectFilter, setSubjectFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logChapter, setLogChapter] = useState<any>(null)
  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string>(todayKey)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['syllabus'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats-all'] })
    qc.invalidateQueries({ queryKey: ['progress-notes'] })
  }

  const { data: rawChapters, isLoading } = useQuery({
    queryKey: ['syllabus', classId, sectionId, subjectFilter],
    queryFn: () => syllabusApi.list({ class_id: classId, section_id: sectionId || undefined, subject_name: subjectFilter || undefined }).then(r => r.data),
  })
  // A teacher only ever sees due dates / progress for subjects they're
  // actually scheduled to teach in this class+section — not the whole
  // class's syllabus just because they share a room with it.
  const chapters = allowedSubjects ? (rawChapters ?? []).filter((c: any) => allowedSubjects.includes(c.subject_name)) : rawChapters

  const { data: rawLogs } = useQuery({
    queryKey: ['progress-notes', classId],
    queryFn: () => syllabusApi.notes.list({ class_id: classId }).then(r => r.data),
  })
  const logs = allowedSubjects ? (rawLogs ?? []).filter((l: any) => allowedSubjects.includes(l.subject_name)) : rawLogs

  const deleteChapterMutation = useMutation({
    mutationFn: (id: string) => syllabusApi.delete(id),
    onSuccess: () => { invalidateAll(); toast.success('Removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const deleteLogMutation = useMutation({
    mutationFn: (id: string) => syllabusApi.notes.delete(id),
    onSuccess: () => { invalidateAll(); toast.success('Log entry removed') },
  })

  // A chapter appears on the calendar on its due date (so you can see
  // pace ahead of time). Log entries appear on the day they were logged,
  // separately — that's the actual daily activity.
  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const ch of chapters ?? []) {
      if (!ch.planned_date) continue
      if (!map[ch.planned_date]) map[ch.planned_date] = []
      map[ch.planned_date].push(ch)
    }
    return map
  }, [chapters])

  const logsByDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const log of logs ?? []) {
      if (!map[log.note_date]) map[log.note_date] = []
      map[log.note_date].push(log)
    }
    return map
  }, [logs])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const [key, items] of Object.entries(byDate)) {
      map[key] = items.map((ch: any) => {
        const behind = ch.status !== 'completed' && ch.planned_date < todayKey
        const color = ch.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
          : behind ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
        return { id: `due-${ch.id}`, label: ch.chapter_name, color }
      })
    }
    for (const [key, items] of Object.entries(logsByDate)) {
      if (!map[key]) map[key] = []
      map[key].push(...items.map((log: any) => ({
        id: `log-${log.id}`,
        label: log.syllabus_chapters?.chapter_name ?? log.note.slice(0, 24),
        color: 'bg-indigo-100 text-indigo-700',
      })))
    }
    return map
  }, [byDate, logsByDate])

  const dueToday = byDate[selectedDate] ?? []
  const loggedToday = logsByDate[selectedDate] ?? []

  const openLogModal = (chapter: any = null) => { setLogChapter(chapter); setShowLog(true) }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} placeholder="Filter by subject..."
          className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none min-w-[200px]" />
        <div className="flex items-center gap-2">
          {canPlan && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
              <Plus className="w-4 h-4" /> Set Chapter Due Dates
            </button>
          )}
          {canLog && (
            <button onClick={() => openLogModal(null)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700">
              <NotebookPen className="w-4 h-4" /> Log Today's Progress
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
        {isLoading ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <MonthCalendar month={month} onMonthChange={setMonth} selectedDate={selectedDate} onSelectDate={setSelectedDate} eventsByDate={eventsByDate} />
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {selectedDate === todayKey ? 'Today' : formatDate(selectedDate)}</p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900 text-xs uppercase tracking-wide text-gray-400">Due this day</h3>
            {dueToday.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing due</p>
            ) : (
              <div className="space-y-2">
                {dueToday.map((ch: any) => {
                  const behind = ch.status !== 'completed' && ch.planned_date < todayKey
                  return (
                    <div key={ch.id} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {ch.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <Clock className={cn('w-4 h-4 flex-shrink-0 mt-0.5', behind ? 'text-red-500' : 'text-amber-400')} />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {ch.chapter_number ? `${ch.chapter_number}. ` : ''}{ch.chapter_name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {ch.subject_name} · {ch.status === 'completed' ? 'Covered' : behind ? 'Overdue' : 'Due'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {canLog && ch.status !== 'completed' && (
                            <button onClick={() => openLogModal(ch)} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
                              Log progress
                            </button>
                          )}
                          {canPlan && (
                            <button onClick={() => deleteChapterMutation.mutate(ch.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900 text-xs uppercase tracking-wide text-gray-400">Logged this day</h3>
            {loggedToday.length === 0 ? (
              <p className="text-xs text-gray-400">No progress logged</p>
            ) : (
              <div className="space-y-2">
                {loggedToday.map((log: any) => (
                  <div key={log.id} className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          {log.progress_status && (
                            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                              log.progress_status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                              {log.progress_status.replace('_', ' ')}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 truncate">{log.subject_name}</span>
                        </div>
                        {log.syllabus_chapters?.chapter_name && (
                          <p className="text-sm font-medium text-gray-900 truncate">{log.syllabus_chapters.chapter_name}</p>
                        )}
                        {log.note && <p className="text-xs text-gray-500 mt-0.5">{log.note}</p>}
                        <p className="text-[10px] text-gray-400 mt-1">{log.users?.full_name}</p>
                      </div>
                      {canLog && (
                        <button onClick={() => deleteLogMutation.mutate(log.id)} className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdd && (
        <AddChaptersModal classId={classId} sectionId={sectionId} initialDate={selectedDate} onClose={() => { setShowAdd(false); invalidateAll() }} />
      )}

      {showLog && (
        <LogProgressModal
          classId={classId} sectionId={sectionId} chapters={chapters ?? []} initialChapter={logChapter} initialDate={selectedDate}
          onClose={() => { setShowLog(false); setLogChapter(null); invalidateAll() }}
        />
      )}
    </div>
  )
}

function LogProgressModal({ classId, sectionId, chapters, initialChapter, initialDate, onClose }: {
  classId: string; sectionId: string; chapters: any[]; initialChapter: any; initialDate?: string; onClose: () => void
}) {
  const subjects = useMemo(() => Array.from(new Set(chapters.map(c => c.subject_name))), [chapters])
  const [subjectName, setSubjectName] = useState(initialChapter?.subject_name ?? subjects[0] ?? '')
  const [chapterId, setChapterId] = useState(initialChapter?.id ?? '')
  const [status, setStatus] = useState<'started' | 'in_progress' | 'completed'>('in_progress')
  const [note, setNote] = useState('')
  const [logDate, setLogDate] = useState(initialDate ?? todayKey)
  const [loading, setLoading] = useState(false)

  const chaptersForSubject = chapters.filter(c => c.subject_name === subjectName)

  const handleSave = async () => {
    if (!subjectName) return toast.error('Pick a subject')
    setLoading(true)
    try {
      await syllabusApi.notes.create({
        class_id: classId, section_id: sectionId || undefined, subject_name: subjectName,
        chapter_id: chapterId || undefined, progress_status: status, note_date: logDate, note: note.trim() || undefined,
      })
      toast.success('Progress logged')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to log progress')
    } finally { setLoading(false) }
  }

  const ic = 'w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Log Today's Progress</h2>
          <p className="text-xs text-gray-400 mt-0.5">What did you actually cover this period? This drives the covered-vs-left tracking.</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject *</label>
              <select className={ic} value={subjectName} onChange={e => { setSubjectName(e.target.value); setChapterId('') }}>
                <option value="">Select subject...</option>
                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
              <input type="date" className={ic} value={logDate} onChange={e => setLogDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Chapter</label>
            <select className={ic} value={chapterId} onChange={e => setChapterId(e.target.value)} disabled={!subjectName}>
              <option value="">No specific chapter (general note)</option>
              {chaptersForSubject.map(c => (
                <option key={c.id} value={c.id}>
                  {c.chapter_number ? `${c.chapter_number}. ` : ''}{c.chapter_name}{c.status === 'completed' ? ' (already covered)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
            <div className="grid grid-cols-3 gap-2">
              {(['started', 'in_progress', 'completed'] as const).map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={cn('py-2 rounded-xl text-xs font-semibold border transition-all',
                    status === s ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                  {s === 'started' ? 'Started' : s === 'in_progress' ? 'In Progress' : 'Completed'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea className={ic} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Covered pages 10-15, did examples on the board" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

const EXAM_TYPE_LABELS: Record<string, string> = {
  unit_test: 'Unit Test', monthly: 'Monthly Test', half_yearly: 'Half Yearly', annual: 'Annual Exam',
  pre_board: 'Pre-Board', practical: 'Practical', other: 'Exam',
}

type ChapterRow = { chapter_name: string; due_mode: 'exam' | 'custom'; exam_id: string; planned_date: string }

function AddChaptersModal({ classId, sectionId, initialDate, onClose }: { classId: string; sectionId?: string; initialDate?: string; onClose: () => void }) {
  const [subjectName, setSubjectName] = useState('')
  const [applyToSection, setApplyToSection] = useState(!!sectionId)
  const [rows, setRows] = useState<ChapterRow[]>([{ chapter_name: '', due_mode: 'custom', exam_id: '', planned_date: initialDate ?? '' }])
  const [loading, setLoading] = useState(false)

  // The chapter's due date should track the school's real exam
  // calendar (Unit Test 1 -> Half Yearly -> ...) rather than a
  // hand-typed date with no anchor — pick an exam here, or fall back to
  // a custom date if there's no matching exam yet.
  const { data: exams } = useQuery({
    queryKey: ['exams-for-syllabus'],
    queryFn: () => api.get('/exams', { params: { limit: 100 } }).then(r => r.data.data as any[]),
  })
  const sortedExams = useMemo(() => [...(exams ?? [])].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '')), [exams])

  // Subject is picked from the school's master subject list (Settings ->
  // Classes & Sections), not typed — a typo here ("Maths" vs
  // "Mathematics") would silently break the match against what's on the
  // teacher's timetable.
  const { data: subjects } = useQuery({
    queryKey: ['subjects', classId],
    queryFn: () => classesApi.subjects.list(classId).then(r => r.data),
  })

  const handleSave = async () => {
    const valid = rows.filter(r => r.chapter_name.trim())
    if (!subjectName.trim()) return toast.error('Subject is required')
    if (!valid.length) return toast.error('Add at least one chapter')
    setLoading(true)
    try {
      await syllabusApi.createChapters({
        class_id: classId, section_id: (applyToSection && sectionId) ? sectionId : undefined, subject_name: subjectName.trim(),
        chapters: valid.map((r, i) => ({
          chapter_number: i + 1, chapter_name: r.chapter_name.trim(),
          exam_id: r.due_mode === 'exam' ? (r.exam_id || undefined) : undefined,
          planned_date: r.due_mode === 'custom' ? (r.planned_date || undefined) : undefined,
        })),
      })
      toast.success('Chapters added')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add chapters')
    } finally { setLoading(false) }
  }

  const ic = 'flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none'
  const updateRow = (i: number, patch: Partial<ChapterRow>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Set Chapter Due Dates</h2>
          <p className="text-xs text-gray-400 mt-0.5">Tie each chapter to the exam it needs to be covered before, or set a custom date — teachers mark them covered as they go</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject *</label>
            <select className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none"
              value={subjectName} onChange={e => setSubjectName(e.target.value)}>
              <option value="">Select subject...</option>
              {(subjects ?? []).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            {(subjects ?? []).length === 0 && (
              <p className="text-xs text-amber-600 mt-1.5">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
            )}
          </div>
          {sectionId && (
            <label className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={applyToSection} onChange={e => setApplyToSection(e.target.checked)} />
              Only for this section — uncheck to apply to every section of the class
            </label>
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex-1 block text-sm font-medium text-gray-700">Chapter</label>
              <label className="w-48 block text-sm font-medium text-gray-700">Due before</label>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={ic} value={row.chapter_name} placeholder={`Chapter ${i + 1} name`}
                  onChange={e => updateRow(i, { chapter_name: e.target.value })} />
                <select className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-48"
                  value={row.due_mode === 'custom' ? 'custom' : row.exam_id}
                  onChange={e => e.target.value === 'custom' ? updateRow(i, { due_mode: 'custom', exam_id: '' }) : updateRow(i, { due_mode: 'exam', exam_id: e.target.value })}>
                  <option value="">No due date</option>
                  {sortedExams.map(ex => (
                    <option key={ex.id} value={ex.id}>
                      {EXAM_TYPE_LABELS[ex.exam_type] ?? ex.exam_type} — {ex.name}{ex.start_date ? ` (${formatDate(ex.start_date)})` : ''}
                    </option>
                  ))}
                  <option value="custom">Custom date...</option>
                </select>
                {row.due_mode === 'custom' && (
                  <input type="date" className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-40"
                    value={row.planned_date} onChange={e => updateRow(i, { planned_date: e.target.value })} />
                )}
              </div>
            ))}
            <button onClick={() => setRows(rs => [...rs, { chapter_name: '', due_mode: 'custom', exam_id: '', planned_date: '' }])}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add another chapter
            </button>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save Chapters
          </button>
        </div>
      </div>
    </div>
  )
}

