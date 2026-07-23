'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { studentsApi, admissionApi, academicYearsApi } from '@/lib/api'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { ArrowLeft, Search, CheckSquare, Square, Users, ArrowRight, Loader2, GraduationCap, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

const PROMOTION_TYPES = [
  { value: 'promoted', label: 'Promoted', hint: 'Moving up to the next class for a new academic year' },
  { value: 'transferred', label: 'Transferred', hint: 'Moving section/class within the same academic year' },
  { value: 'detained', label: 'Detained', hint: 'Repeating the same class in the new academic year' },
  { value: 'withdrawn', label: 'Withdrawn', hint: 'Leaving — recorded here, handle TC separately' },
]

export default function PromoteStudentsPage() {
  const qc = useQueryClient()

  // Source filters
  const [fromClass, setFromClass] = useState('')
  const [fromSection, setFromSection] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Destination
  const [toAcademicYear, setToAcademicYear] = useState('')
  const [toClass, setToClass] = useState('')
  const [toSection, setToSection] = useState('')
  const [promotionType, setPromotionType] = useState('promoted')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  const { data: academicYears } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })

  const fromClassObj = (classesData ?? []).find((c: any) => c.id === fromClass)
  const fromSections = fromClassObj?.sections ?? []
  const toClassObj = (classesData ?? []).find((c: any) => c.id === toClass)
  const toSections = toClassObj?.sections ?? []

  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students-promote', fromClass, fromSection, search],
    queryFn: () => studentsApi.list({
      class_id: fromClass || undefined,
      section_id: fromSection || undefined,
      search: search || undefined,
      status: 'active',
      limit: 200,
    }).then(r => r),
    enabled: !!fromClass,
  })
  const students = studentsData?.data ?? []

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelected(selected.size === students.length ? new Set() : new Set(students.map((s: any) => s.id)))
  }

  const promoteMutation = useMutation({
    mutationFn: () => studentsApi.bulkPromote({
      student_ids: Array.from(selected),
      to_class_id: toClass,
      to_section_id: toSection || undefined,
      to_academic_year_id: toAcademicYear,
      promotion_type: promotionType,
      notes: notes || undefined,
    }),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? 'Students promoted')
      setSelected(new Set())
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['students-promote'] })
      qc.invalidateQueries({ queryKey: ['student-stats'] })
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to promote')
      setConfirming(false)
    },
  })

  const canReview = selected.size > 0 && toClass && toAcademicYear
  const toClassName = toClassObj?.name ?? '—'
  const toSectionName = toSections.find((s: any) => s.id === toSection)?.name
  const toYearName = (academicYears ?? []).find((y: any) => y.id === toAcademicYear)?.name ?? '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/students" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promote / Transfer Students</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Move students to a new class, section, or academic year — tracked in each student's promotion history
          </p>
        </div>
      </div>

      {/* Step 1: source */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">1. Select students</p>
        <div className="flex flex-wrap gap-3">
          <select value={fromClass} onChange={e => { setFromClass(e.target.value); setFromSection(''); setSelected(new Set()) }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 min-w-[160px]">
            <option value="">Select current class...</option>
            {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {fromSections.length > 0 && (
            <select value={fromSection} onChange={e => { setFromSection(e.target.value); setSelected(new Set()) }}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">All sections</option>
              {fromSections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search within selected class..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white" />
          </div>
        </div>
      </div>

      {/* Student list */}
      {fromClass && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <button onClick={toggleAll} className="text-gray-400 hover:text-indigo-600 transition-colors">
                {selected.size === students.length && students.length > 0
                  ? <CheckSquare className="w-5 h-5 text-indigo-600" /> : <Square className="w-5 h-5" />}
              </button>
              <span className="text-sm text-gray-500">
                {students.length} active students
                {selected.size > 0 && <span className="text-indigo-600 font-semibold"> · {selected.size} selected</span>}
              </span>
            </div>
            {students.length > 0 && (
              <button onClick={toggleAll} className="text-xs text-indigo-600 font-medium hover:text-indigo-700">
                {selected.size === students.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          {isLoading ? (
            <div className="p-12 text-center text-gray-400">Loading students...</div>
          ) : students.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="font-medium text-sm">No active students in this class/section</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[360px] overflow-y-auto">
              {students.map((s: any) => {
                const isSelected = selected.has(s.id)
                return (
                  <div key={s.id} onClick={() => toggleOne(s.id)}
                    className={cn('flex items-center gap-4 px-6 py-2.5 cursor-pointer transition-colors', isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50')}>
                    <button className="text-gray-400 flex-shrink-0">
                      {isSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{s.first_name} {s.last_name}</p>
                      <p className="text-xs text-gray-400">
                        {s.admission_number && `#${s.admission_number} · `}Roll: {s.roll_number ?? '—'}
                        {s.sections?.name && ` · ${s.sections.name}`}
                      </p>
                    </div>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[s.status])}>{s.status}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: destination */}
      {selected.size > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-700">2. Move {selected.size} selected student{selected.size !== 1 ? 's' : ''} to</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year *</label>
              <select value={toAcademicYear} onChange={e => setToAcademicYear(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="">Select year...</option>
                {(academicYears ?? []).map((y: any) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Class *</label>
              <select value={toClass} onChange={e => { setToClass(e.target.value); setToSection('') }}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="">Select class...</option>
                {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
              <select value={toSection} onChange={e => setToSection(e.target.value)} disabled={!toClass}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50">
                <option value="">Unassigned</option>
                {toSections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type *</label>
              <select value={promotionType} onChange={e => setPromotionType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                {PROMOTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">{PROMOTION_TYPES.find(t => t.value === promotionType)?.hint}</p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Promoted after Annual Exam 2026"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <div className="flex justify-end">
            <button onClick={() => setConfirming(true)} disabled={!canReview}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
              <GraduationCap className="w-4 h-4" /> Review & Confirm
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-900">Confirm {PROMOTION_TYPES.find(t => t.value === promotionType)?.label.toLowerCase()}</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{selected.size}</span> student{selected.size !== 1 ? 's' : ''} will move to:
              </p>
              <div className="flex items-center gap-2 text-sm bg-gray-50 rounded-xl px-4 py-3">
                <span className="font-medium text-gray-900">{fromClassObj?.name ?? 'Current class'}</span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <span className="font-semibold text-indigo-600">{toClassName}{toSectionName ? ` · ${toSectionName}` : ''} · {toYearName}</span>
              </div>
              <p className="text-xs text-gray-400">This updates each student's record immediately and is logged in their promotion history. It isn't automatically reversible — you'd need to promote them back manually.</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
                {promoteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
