'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, admissionApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, Save, Loader2, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { toast } from 'sonner'

type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave'

const STATUS_CONFIG = {
  present: { label: 'P', color: 'bg-green-500 text-white', border: 'border-green-500', icon: CheckCircle },
  absent:  { label: 'A', color: 'bg-red-500 text-white',   border: 'border-red-500',   icon: XCircle },
  late:    { label: 'L', color: 'bg-yellow-500 text-white', border: 'border-yellow-500', icon: Clock },
  leave:   { label: 'LV', color: 'bg-blue-500 text-white',  border: 'border-blue-500',  icon: Calendar },
}

export default function AttendancePage() {
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({})
  const [saved, setSaved] = useState(false)
  const qc = useQueryClient()

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const selectedClassData = (classesData ?? []).find((c: any) => c.id === selectedClass)
  const sections = selectedClassData?.sections ?? []

  const { data: sheet, isLoading } = useQuery({
    queryKey: ['attendance-sheet', selectedClass, selectedSection, selectedDate],
    queryFn: () => studentsApi.getClassAttendance(selectedClass, selectedDate, selectedSection || undefined).then(r => r.data),
    enabled: !!selectedClass && !!selectedDate,
    onSuccess: (data: any) => {
      const init: Record<string, AttendanceStatus> = {}
      for (const student of data.students ?? []) {
        const existing = data.attendance?.find((a: any) => a.student_id === student.id)
        init[student.id] = existing?.status ?? 'present'
      }
      setAttendance(init)
      setSaved(false)
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => studentsApi.saveAttendance({
      class_id: selectedClass,
      section_id: selectedSection || null,
      date: selectedDate,
      records: Object.entries(attendance).map(([student_id, status]) => ({ student_id, status })),
    }),
    onSuccess: () => {
      setSaved(true)
      toast.success('Attendance saved!')
      qc.invalidateQueries({ queryKey: ['attendance-sheet'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const markAll = (status: AttendanceStatus) => {
    const updated: Record<string, AttendanceStatus> = {}
    for (const key of Object.keys(attendance)) updated[key] = status
    setAttendance(updated)
  }

  const stats = {
    present: Object.values(attendance).filter(s => s === 'present').length,
    absent:  Object.values(attendance).filter(s => s === 'absent').length,
    late:    Object.values(attendance).filter(s => s === 'late').length,
    leave:   Object.values(attendance).filter(s => s === 'leave').length,
    total:   Object.keys(attendance).length,
  }

  const changeDate = (days: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
        <p className="text-gray-500 text-sm mt-0.5">Mark daily attendance by class</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Date picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
            <div className="flex items-center gap-2">
              <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <input type="date" value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                max={today}
                className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
              <button onClick={() => changeDate(1)} disabled={selectedDate >= today}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Class */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
            <select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSelectedSection('') }}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white min-w-[140px]">
              <option value="">Select class...</option>
              {(classesData ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Section */}
          {sections.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Section</label>
              <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}
                className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white">
                <option value="">All sections</option>
                {sections.map((s: any) => (
                  <option key={s.id} value={s.id}>Section {s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Quick mark all */}
          {selectedClass && Object.keys(attendance).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mark All</label>
              <div className="flex gap-2">
                {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => (
                  <button key={s} onClick={() => markAll(s)}
                    className={cn('px-3 py-2 rounded-lg text-xs font-bold border transition-colors', STATUS_CONFIG[s].color)}>
                    All {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {selectedClass && stats.total > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Present', count: stats.present, color: 'bg-green-500', pct: Math.round((stats.present/stats.total)*100) },
            { label: 'Absent',  count: stats.absent,  color: 'bg-red-500',   pct: Math.round((stats.absent/stats.total)*100) },
            { label: 'Late',    count: stats.late,    color: 'bg-yellow-500', pct: Math.round((stats.late/stats.total)*100) },
            { label: 'Leave',   count: stats.leave,   color: 'bg-blue-500',  pct: Math.round((stats.leave/stats.total)*100) },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">{s.label}</span>
                <span className="text-lg font-bold text-gray-900">{s.count}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className={cn('h-1.5 rounded-full transition-all', s.color)} style={{ width: `${s.pct}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{s.pct}%</p>
            </div>
          ))}
        </div>
      )}

      {/* Attendance sheet */}
      {!selectedClass ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">Select a class to mark attendance</p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          Loading students...
        </div>
      ) : !(sheet?.students ?? []).length ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="font-medium">No students found in this class</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">
              {selectedClassData?.name} — {new Date(selectedDate).toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </h3>
            <button onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                saved
                  ? 'bg-green-100 text-green-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60'
              )}>
              {saveMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : saved
                ? <><CheckCircle className="w-4 h-4" /> Saved!</>
                : <><Save className="w-4 h-4" /> Save Attendance</>
              }
            </button>
          </div>

          <div className="divide-y divide-gray-50">
            {(sheet?.students ?? []).map((student: any, idx: number) => {
              const status = attendance[student.id] ?? 'present'
              const cfg = STATUS_CONFIG[status]
              return (
                <div key={student.id} className={cn(
                  'flex items-center gap-4 px-6 py-3 transition-colors',
                  status === 'absent' ? 'bg-red-50' : status === 'late' ? 'bg-yellow-50' : 'hover:bg-gray-50'
                )}>
                  <span className="text-xs text-gray-400 w-6 text-center font-mono">{idx + 1}</span>
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-700">
                    {student.photo_url
                      ? <img src={student.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : `${student.first_name?.[0]}${student.last_name?.[0]}`
                    }
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{student.first_name} {student.last_name}</p>
                    <p className="text-xs text-gray-400">
                      Roll: {student.roll_number ?? '—'}
                      {student.sections?.name && ` · Sec ${student.sections.name}`}
                    </p>
                  </div>
                  {/* Status buttons */}
                  <div className="flex gap-2">
                    {(Object.entries(STATUS_CONFIG) as [AttendanceStatus, any][]).map(([s, config]) => (
                      <button key={s}
                        onClick={() => setAttendance(a => ({ ...a, [student.id]: s }))}
                        className={cn(
                          'w-9 h-9 rounded-xl text-xs font-bold border-2 transition-all',
                          attendance[student.id] === s
                            ? config.color + ' ' + config.border + ' scale-110 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                        )}>
                        {config.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}