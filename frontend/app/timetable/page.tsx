'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timetableApi, admissionApi, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Loader2, Clock, Grid3X3, List, Printer, User, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics':       'bg-indigo-50 border-indigo-300 text-indigo-800',
  'English':           'bg-blue-50 border-blue-300 text-blue-800',
  'Science':           'bg-emerald-50 border-emerald-300 text-emerald-800',
  'Hindi':             'bg-orange-50 border-orange-300 text-orange-800',
  'Social Studies':    'bg-purple-50 border-purple-300 text-purple-800',
  'Computer':          'bg-cyan-50 border-cyan-300 text-cyan-800',
  'Art':               'bg-pink-50 border-pink-300 text-pink-800',
  'Physical Ed':       'bg-lime-50 border-lime-300 text-lime-800',
  'Sanskrit':          'bg-yellow-50 border-yellow-300 text-yellow-800',
  'Drawing':           'bg-rose-50 border-rose-300 text-rose-800',
  'Sports':            'bg-teal-50 border-teal-300 text-teal-800',
  'Activity':          'bg-violet-50 border-violet-300 text-violet-800',
  'Moral Science':     'bg-amber-50 border-amber-300 text-amber-800',
  'General Knowledge': 'bg-sky-50 border-sky-300 text-sky-800',
  'Break':             'bg-gray-100 border-gray-200 text-gray-400',
  'Lunch':             'bg-gray-100 border-gray-200 text-gray-400',
  'Assembly':          'bg-gray-100 border-gray-200 text-gray-400',
}
const getColor = (s: string) => SUBJECT_COLORS[s] ?? 'bg-violet-50 border-violet-300 text-violet-800'

type ViewMode = 'class' | 'teacher'

export default function TimetablePage() {
  const [selectedClass,   setSelectedClass]   = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [viewMode,        setViewMode]        = useState<ViewMode>('class')
  const [gridOrList,      setGridOrList]      = useState<'grid'|'list'>('grid')
  const [showAdd,         setShowAdd]         = useState(false)
  const [addingDay,       setAddingDay]       = useState(1)
  const [showPrint,       setShowPrint]       = useState(false)
  const qc = useQueryClient()

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: teachersData } = useQuery({
    queryKey: ['all-teachers'],
    queryFn: () => api.get('/students/timetable/teachers').then(r => r.data.data).catch(() => []),
  })

  const selectedClassObj = (classesData ?? []).find((c: any) => c.id === selectedClass)
  const sections = selectedClassObj?.sections ?? []

  const { data: timetableData, isLoading } = useQuery({
    queryKey: ['timetable', selectedClass, selectedSection, selectedTeacher, viewMode],
    queryFn: () => timetableApi.get({
      class_id: viewMode === 'class' ? selectedClass : undefined,
      section_id: viewMode === 'class' && selectedSection ? selectedSection : undefined,
      teacher_id: viewMode === 'teacher' ? selectedTeacher : undefined,
    }).then(r => r.data),
    enabled: viewMode === 'class' ? !!selectedClass : !!selectedTeacher,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => timetableApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timetable'] }); toast.success('Period removed') },
  })

  // Build day map
  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of timetableData ?? []) {
    byDay[p.day_of_week] = byDay[p.day_of_week] ?? []
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  const allPeriods = Array.from(new Set((timetableData ?? []).map((p: any) => p.period_number))).sort((a, b) => Number(a) - Number(b))
  const timeByPeriod: Record<number, string> = {}
  for (const p of timetableData ?? []) timeByPeriod[p.period_number] = `${p.start_time?.slice(0,5)}–${p.end_time?.slice(0,5)}`

  // Conflict detection — teacher double booked
  const conflicts: Set<string> = new Set()
  if (viewMode === 'class' && timetableData) {
    const teacherSlots: Record<string, string[]> = {}
    for (const p of timetableData) {
      if (!p.teacher_id || p.is_break) continue
      const key = `${p.teacher_id}_${p.day_of_week}_${p.period_number}`
      if (!teacherSlots[key]) teacherSlots[key] = []
      teacherSlots[key].push(p.id)
    }
    for (const ids of Object.values(teacherSlots)) {
      if (ids.length > 1) ids.forEach(id => conflicts.add(id))
    }
  }

  const stats = {
    total:    (timetableData ?? []).filter((p: any) => !p.is_break).length,
    subjects: new Set((timetableData ?? []).filter((p: any) => !p.is_break).map((p: any) => p.subject_name)).size,
    breaks:   (timetableData ?? []).filter((p: any) => p.is_break).length,
    conflicts: conflicts.size,
  }

  const printLabel = viewMode === 'teacher'
    ? (teachersData ?? []).find((t: any) => t.id === selectedTeacher)?.full_name ?? 'Teacher'
    : `${selectedClassObj?.name ?? ''}${selectedSection ? ' · Sec ' + sections.find((s: any) => s.id === selectedSection)?.name : ''}`

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timetable</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage class schedules and period assignments</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setViewMode('class')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                viewMode === 'class' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700')}>
              <Grid3X3 className="w-3.5 h-3.5" /> Class View
            </button>
            <button onClick={() => setViewMode('teacher')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                viewMode === 'teacher' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700')}>
              <User className="w-3.5 h-3.5" /> Teacher View
            </button>
          </div>
          {/* Grid/List */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setGridOrList('grid')}
              className={cn('p-1.5 rounded-lg transition-all', gridOrList === 'grid' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400')}>
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button onClick={() => setGridOrList('list')}
              className={cn('p-1.5 rounded-lg transition-all', gridOrList === 'list' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400')}>
              <List className="w-4 h-4" />
            </button>
          </div>
          {/* Print */}
          {timetableData && timetableData.length > 0 && (
            <button onClick={() => setShowPrint(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
              <Printer className="w-4 h-4" /> Print
            </button>
          )}
        </div>
      </div>

      {/* Selectors */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-4 items-end flex-wrap">
        {viewMode === 'class' ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
              <select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSelectedSection('') }}
                className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none min-w-[160px]">
                <option value="">Select class...</option>
                {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {sections.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Section</label>
                <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}
                  className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
                  <option value="">All sections</option>
                  {sections.map((s: any) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
                </select>
              </div>
            )}
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Teacher</label>
            <select value={selectedTeacher} onChange={e => setSelectedTeacher(e.target.value)}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none min-w-[200px]">
              <option value="">Select teacher...</option>
              {(teachersData ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
        )}

        {/* Stats */}
        {timetableData && timetableData.length > 0 && (
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{stats.total}</p>
              <p className="text-xs text-gray-500">Periods/week</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{stats.subjects}</p>
              <p className="text-xs text-gray-500">Subjects</p>
            </div>
            {stats.conflicts > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold text-red-500">{stats.conflicts}</p>
                <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Conflicts</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Conflict banner */}
      {stats.conflicts > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Teacher conflict detected</p>
            <p className="text-xs text-red-500 mt-0.5">A teacher is assigned to multiple periods at the same time. Conflicting periods are highlighted in red.</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {((viewMode === 'class' && !selectedClass) || (viewMode === 'teacher' && !selectedTeacher)) ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <Clock className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">{viewMode === 'class' ? 'Select a class to view timetable' : 'Select a teacher to view their schedule'}</p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : gridOrList === 'grid' ? (
        // ── GRID VIEW ─────────────────────────────────────────
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase border-b border-r border-gray-200 w-28 sticky left-0 bg-gray-50 z-10">
                    Period
                  </th>
                  {DAYS.map((day, idx) => (
                    <th key={day} className="px-3 py-3 border-b border-r border-gray-200 last:border-r-0 min-w-[150px]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700">{DAY_SHORT[idx]}</span>
                        {viewMode === 'class' && (
                          <button onClick={() => { setAddingDay(idx + 1); setShowAdd(true) }}
                            className="text-indigo-400 hover:text-indigo-600 transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allPeriods.map((periodNum) => (
                  <tr key={periodNum} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-2 border-r border-gray-100 sticky left-0 bg-white z-10">
                      <p className="text-xs font-bold text-gray-700">P{periodNum}</p>
                      <p className="text-xs text-gray-400">{timeByPeriod[Number(periodNum)]}</p>
                    </td>
                    {[1,2,3,4,5,6].map(dayNum => {
                      const period = (byDay[dayNum] ?? []).find((p: any) => p.period_number === periodNum)
                      const hasConflict = period && conflicts.has(period.id)
                      return (
                        <td key={dayNum} className="px-2 py-2 border-r border-gray-100 last:border-r-0 align-top">
                          {period ? (
                            <div className={cn(
                              'group relative rounded-xl border px-3 py-2 text-xs transition-all hover:shadow-sm cursor-default',
                              hasConflict ? 'bg-red-50 border-red-400 text-red-800' : getColor(period.subject_name)
                            )}>
                              <div className="flex items-start justify-between gap-1">
                                <p className="font-semibold leading-tight flex items-center gap-1">
                                  {hasConflict && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                                  {period.subject_name}
                                </p>
                                {viewMode === 'class' && !period.is_break && (
                                  <button onClick={() => deleteMutation.mutate(period.id)}
                                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-red-400 hover:text-red-600 transition-all">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {viewMode === 'teacher' && period.classes?.name && (
                                <p className="text-xs font-medium opacity-80 mt-0.5">{period.classes.name}{period.sections?.name ? ` · ${period.sections.name}` : ''}</p>
                              )}
                              {!period.is_break && period.users?.full_name && viewMode === 'class' && (
                                <p className="text-xs opacity-60 truncate mt-0.5">{period.users.full_name.split(' ')[0]}</p>
                              )}
                              {!period.is_break && period.room && (
                                <p className="text-xs opacity-50 mt-0.5">{period.room}</p>
                              )}
                            </div>
                          ) : viewMode === 'class' ? (
                            <button onClick={() => { setAddingDay(dayNum); setShowAdd(true) }}
                              className="w-full h-14 border-2 border-dashed border-gray-200 rounded-xl text-gray-300 hover:border-indigo-300 hover:text-indigo-400 transition-all flex items-center justify-center">
                              <Plus className="w-4 h-4" />
                            </button>
                          ) : (
                            <div className="w-full h-14 rounded-xl bg-gray-50" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {allPeriods.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      <Clock className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                      <p className="font-medium">No periods scheduled yet</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {allPeriods.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-wrap gap-2">
              {Array.from(new Set((timetableData ?? []).filter((p: any) => !p.is_break).map((p: any) => p.subject_name))).map((subject: any) => (
                <span key={subject} className={cn('px-2.5 py-1 rounded-full text-xs font-medium border', getColor(subject))}>
                  {subject}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ── LIST VIEW ─────────────────────────────────────────
        <div className="space-y-3">
          {DAYS.map((day, idx) => {
            const dayNum = idx + 1
            const periods = byDay[dayNum] ?? []
            return (
              <div key={day} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">{day}</h3>
                  {viewMode === 'class' && (
                    <button onClick={() => { setAddingDay(dayNum); setShowAdd(true) }}
                      className="flex items-center gap-1 text-xs text-indigo-600 font-medium hover:text-indigo-700">
                      <Plus className="w-3.5 h-3.5" /> Add Period
                    </button>
                  )}
                </div>
                {periods.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-400">No periods scheduled</p>
                ) : (
                  <div className="flex flex-wrap gap-2 p-4">
                    {periods.map((p: any) => {
                      const hasConflict = conflicts.has(p.id)
                      return (
                        <div key={p.id} className={cn(
                          'group relative flex flex-col gap-1 px-4 py-3 rounded-xl border text-xs min-w-[130px]',
                          hasConflict ? 'bg-red-50 border-red-400 text-red-800' : getColor(p.subject_name)
                        )}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm flex items-center gap-1">
                              {hasConflict && <AlertTriangle className="w-3 h-3 text-red-500" />}
                              {p.subject_name}
                            </span>
                            {viewMode === 'class' && !p.is_break && (
                              <button onClick={() => deleteMutation.mutate(p.id)}
                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <span className="opacity-70">P{p.period_number} · {p.start_time?.slice(0,5)}–{p.end_time?.slice(0,5)}</span>
                          {viewMode === 'teacher' && p.classes?.name && <span className="font-medium opacity-80">{p.classes.name}</span>}
                          {p.room && <span className="opacity-50">{p.room}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && selectedClass && (
        <AddPeriodModal
          classId={selectedClass}
          sectionId={selectedSection || undefined}
          dayOfWeek={addingDay}
          existingPeriods={byDay[addingDay] ?? []}
          allPeriods={timetableData ?? []}
          onClose={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['timetable'] }) }}
        />
      )}

      {showPrint && (
        <PrintModal
          timetableData={timetableData ?? []}
          label={printLabel}
          viewMode={viewMode}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  )
}

// ── ADD PERIOD MODAL ──────────────────────────────────────────
function AddPeriodModal({ classId, sectionId, dayOfWeek, existingPeriods, allPeriods, onClose }: {
  classId: string; sectionId?: string; dayOfWeek: number; existingPeriods: any[]; allPeriods: any[]; onClose: () => void
}) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const nextPeriod = existingPeriods.length > 0 ? Math.max(...existingPeriods.map(p => p.period_number)) + 1 : 1
  const lastEnd = existingPeriods.length > 0 ? existingPeriods[existingPeriods.length-1]?.end_time?.slice(0,5) ?? '08:00' : '08:00'

  const [form, setForm] = useState({ day_of_week: dayOfWeek, period_number: nextPeriod, start_time: lastEnd, end_time: '', subject_name: '', room: '', is_break: false })
  const [teacherId, setTeacherId] = useState('')
  const [loading, setLoading] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const { data: teachersData } = useQuery({
    queryKey: ['all-teachers'],
    queryFn: () => api.get('/students/timetable/teachers').then(r => r.data.data).catch(() => []),
  })

  const calcEnd = (start: string, mins = 45) => {
    const [h, m] = start.split(':').map(Number)
    const t = h * 60 + m + mins
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`
  }

  // Check conflict when teacher/day/period changes
  const checkConflict = (tid: string, day: number, period: number) => {
    if (!tid) { setConflict(null); return }
    const clash = allPeriods.find((p: any) =>
      p.teacher_id === tid && p.day_of_week === day && p.period_number === period && !p.is_break
    )
    if (clash) {
      setConflict(`${(teachersData ?? []).find((t: any) => t.id === tid)?.full_name ?? 'This teacher'} already has ${clash.subject_name} at this slot`)
    } else {
      setConflict(null)
    }
  }

  const handleSave = async () => {
    if (!form.subject_name && !form.is_break) return toast.error('Subject name required')
    if (!form.start_time || !form.end_time) return toast.error('Start and end time required')
    if (conflict) return toast.error('Resolve the teacher conflict first')
    setLoading(true)
    try {
      await timetableApi.save([{
        class_id: classId, section_id: sectionId || null, academic_year_id: null,
        day_of_week: form.day_of_week, period_number: form.period_number,
        start_time: form.start_time, end_time: form.end_time,
        subject_name: form.is_break ? (form.subject_name || 'Break') : form.subject_name,
        teacher_id: teacherId || null, room: form.room || null, is_break: form.is_break,
      }])
      toast.success('Period added!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
  const SUBJECTS = ['Mathematics','English','Science','Hindi','Social Studies','Computer','Art','Physical Ed','Sanskrit','Drawing','Sports','Moral Science','General Knowledge']

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Period — {DAYS[form.day_of_week - 1]}</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Break toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <span className="text-sm font-medium text-gray-700">Break / Lunch</span>
            <button onClick={() => setForm(f => ({ ...f, is_break: !f.is_break, subject_name: !f.is_break ? 'Break' : '' }))}
              className={cn('w-12 h-6 rounded-full relative transition-all', form.is_break ? 'bg-indigo-600' : 'bg-gray-300')}>
              <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all', form.is_break ? 'left-6' : 'left-0.5')} />
            </button>
          </div>

          {!form.is_break ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject *</label>
                <input list="subj-list" className={ic} value={form.subject_name}
                  onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))} placeholder="e.g. Mathematics" />
                <datalist id="subj-list">{SUBJECTS.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Teacher</label>
                <select className={ic} value={teacherId}
                  onChange={e => { setTeacherId(e.target.value); checkConflict(e.target.value, form.day_of_week, form.period_number) }}>
                  <option value="">No teacher assigned</option>
                  {(teachersData ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
                {conflict && (
                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {conflict}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Room</label>
                <input className={ic} value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. Room 12, Lab 2" />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Label</label>
              <select className={ic} value={form.subject_name} onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}>
                <option value="Break">Break</option>
                <option value="Lunch">Lunch</option>
                <option value="Assembly">Assembly</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Period No.</label>
              <input type="number" min="1" max="12" className={ic} value={form.period_number}
                onChange={e => { const v = Number(e.target.value); setForm(f => ({ ...f, period_number: v })); checkConflict(teacherId, form.day_of_week, v) }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Start</label>
              <input type="time" className={ic} value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value, end_time: calcEnd(e.target.value, f.is_break ? 30 : 45) }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">End</label>
              <input type="time" className={ic} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>

          {/* Day picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Day</label>
            <div className="grid grid-cols-6 gap-1">
              {['M','T','W','T','F','S'].map((d, i) => (
                <button key={i} onClick={() => { setForm(f => ({ ...f, day_of_week: i+1 })); checkConflict(teacherId, i+1, form.period_number) }}
                  className={cn('py-2 rounded-lg text-xs font-bold transition-all', form.day_of_week === i+1 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading || !!conflict}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Add Period
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PRINT MODAL ───────────────────────────────────────────────
function PrintModal({ timetableData, label, viewMode, onClose }: {
  timetableData: any[]; label: string; viewMode: string; onClose: () => void
}) {
  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of timetableData) {
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  const allPeriods = Array.from(new Set(timetableData.map(p => p.period_number))).sort((a, b) => Number(a) - Number(b))
  const timeByPeriod: Record<number, string> = {}
  for (const p of timetableData) timeByPeriod[p.period_number] = `${p.start_time?.slice(0,5)}–${p.end_time?.slice(0,5)}`

  const handlePrint = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = allPeriods.map(pNum => {
      const cells = [1,2,3,4,5,6].map(dayNum => {
        const p = (byDay[dayNum] ?? []).find((x: any) => x.period_number === pNum)
        if (!p) return '<td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;"></td>'
        const bg = p.is_break ? '#f3f4f6' : '#eff6ff'
        const extraLine = viewMode === 'teacher' && p.classes?.name ? `<br/><small style="color:#6b7280">${p.classes.name}</small>` : (p.room ? `<br/><small style="color:#9ca3af">${p.room}</small>` : '')
        return `<td style="padding:8px;border:1px solid #e5e7eb;background:${bg};text-align:center;">
          <strong>${p.subject_name}</strong>${extraLine}
        </td>`
      }).join('')
      return `<tr>
        <td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;text-align:center;white-space:nowrap;">
          <strong>P${pNum}</strong><br/><small style="color:#6b7280">${timeByPeriod[Number(pNum)]}</small>
        </td>
        ${cells}
      </tr>`
    }).join('')

    win.document.write(`<!DOCTYPE html><html><head><title>Timetable — ${label}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
      h2 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 0 0 16px; color: #6b7280; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #4F46E5; color: white; padding: 10px 8px; border: 1px solid #4338ca; }
      @media print { @page { size: landscape; margin: 1cm; } }
    </style></head><body>
    <h2>Timetable — ${label}</h2>
    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}</p>
    <table>
      <thead><tr>
        <th>Period / Time</th>
        <th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`)
    win.document.close()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 text-center">
        <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Printer className="w-7 h-7 text-indigo-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900">Print Timetable</h3>
        <p className="text-sm text-gray-500 mt-1 mb-6">{label} — {timetableData.filter(p => !p.is_break).length} periods</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handlePrint} className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">
            Open Print Preview
          </button>
        </div>
      </div>
    </div>
  )
}