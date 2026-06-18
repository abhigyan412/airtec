'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, admissionApi } from '@/lib/api'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { Search, Filter, CheckSquare, Square, Edit3, Loader2, ArrowLeft, Users } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { api } from '@/lib/api'

const EDIT_FIELDS = [
  { key: 'house_id',    label: 'House',        type: 'house' },
  { key: 'class_id',   label: 'Class',         type: 'class' },
  { key: 'section_id', label: 'Section',       type: 'section' },
  { key: 'status',     label: 'Status',        type: 'status' },
  { key: 'roll_number',label: 'Roll Number',   type: 'text' },
  { key: 'stream',     label: 'Stream',        type: 'stream' },
]

const STATUSES = ['active','inactive','suspended','transferred','passed_out']
const STREAMS  = ['Science','Commerce','Arts','General']

export default function BulkEditPage() {
  const [search, setSearch]               = useState('')
  const [filterClass, setFilterClass]     = useState('')
  const [filterSection, setFilterSection] = useState('')
  const [filterHouse, setFilterHouse]     = useState('')
  const [filterStatus, setFilterStatus]   = useState('active')
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [editField, setEditField]         = useState('')
  const [editValue, setEditValue]         = useState('')
  const [applying, setApplying]           = useState(false)
  const qc = useQueryClient()

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: housesData } = useQuery({
    queryKey: ['houses'],
    queryFn: () => api.get('/students/houses').then(r => r.data.data).catch(() => []),
  })

  const selectedClassObj = (classesData ?? []).find((c: any) => c.id === filterClass)
  const sections = selectedClassObj?.sections ?? []

  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students-bulk', search, filterClass, filterSection, filterHouse, filterStatus],
    queryFn: () => studentsApi.list({
      search: search || undefined,
      class_id: filterClass || undefined,
      section_id: filterSection || undefined,
      house_id: filterHouse || undefined,
      status: filterStatus || undefined,
      limit: 100,
    }).then(r => r),
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
    if (selected.size === students.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(students.map((s: any) => s.id)))
    }
  }

  const applyEdit = async () => {
    if (!editField || !editValue || selected.size === 0) {
      return toast.error('Select students, a field, and a value')
    }
    setApplying(true)
    try {
      await Promise.all(
        Array.from(selected).map(id =>
          studentsApi.update(id, { [editField]: editValue })
        )
      )
      toast.success(`Updated ${selected.size} students`)
      setSelected(new Set())
      setEditField('')
      setEditValue('')
      qc.invalidateQueries({ queryKey: ['students-bulk'] })
      qc.invalidateQueries({ queryKey: ['student-stats'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update')
    } finally {
      setApplying(false)
    }
  }

  // Section options based on edit class
  const editClassObj = (classesData ?? []).find((c: any) => c.id === editValue)
  const editSections = editField === 'class_id' ? editClassObj?.sections ?? [] : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/students" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bulk Edit Students</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Filter students, select them, then apply changes to all at once
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Filter className="w-4 h-4" /> Filter Students
        </p>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search by name or admission no..."
              value={search} onChange={e => { setSearch(e.target.value); setSelected(new Set()) }}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
          </div>
          <select value={filterClass} onChange={e => { setFilterClass(e.target.value); setFilterSection(''); setSelected(new Set()) }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">All Classes</option>
            {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {sections.length > 0 && (
            <select value={filterSection} onChange={e => { setFilterSection(e.target.value); setSelected(new Set()) }}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">All Sections</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
            </select>
          )}
          <select value={filterHouse} onChange={e => { setFilterHouse(e.target.value); setSelected(new Set()) }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">All Houses</option>
            {(housesData ?? []).map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setSelected(new Set()) }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">All Status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* Edit action bar */}
      {selected.size > 0 && (
        <div className="bg-indigo-600 rounded-2xl p-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-white">
            <Users className="w-5 h-5" />
            <span className="font-semibold">{selected.size} students selected</span>
          </div>
          <div className="flex-1 flex items-center gap-3 flex-wrap">
            <select value={editField} onChange={e => { setEditField(e.target.value); setEditValue('') }}
              className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
              <option value="">Select field to edit...</option>
              {EDIT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>

            {/* Value selector based on field type */}
            {editField === 'house_id' && (
              <select value={editValue} onChange={e => setEditValue(e.target.value)}
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
                <option value="">Select house...</option>
                {(housesData ?? []).map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            )}
            {editField === 'class_id' && (
              <select value={editValue} onChange={e => setEditValue(e.target.value)}
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
                <option value="">Select class...</option>
                {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {editField === 'section_id' && (
              <select value={editValue} onChange={e => setEditValue(e.target.value)}
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
                <option value="">Select section...</option>
                {(classesData ?? []).flatMap((c: any) => c.sections ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            {editField === 'status' && (
              <select value={editValue} onChange={e => setEditValue(e.target.value)}
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
                <option value="">Select status...</option>
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            )}
            {editField === 'stream' && (
              <select value={editValue} onChange={e => setEditValue(e.target.value)}
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-white/30">
                <option value="">Select stream...</option>
                {STREAMS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {editField === 'roll_number' && (
              <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                placeholder="Enter roll number..."
                className="px-4 py-2 text-sm border border-indigo-400 rounded-xl bg-indigo-700 text-white placeholder-indigo-300 focus:outline-none focus:ring-2 focus:ring-white/30" />
            )}

            <button onClick={applyEdit} disabled={applying || !editField || !editValue}
              className="flex items-center gap-2 px-5 py-2 bg-white text-indigo-700 text-sm font-bold rounded-xl hover:bg-indigo-50 disabled:opacity-60 transition-colors">
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
              Apply to {selected.size} students
            </button>
            <button onClick={() => setSelected(new Set())}
              className="px-4 py-2 text-white/70 text-sm hover:text-white transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Student table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button onClick={toggleAll} className="text-gray-400 hover:text-indigo-600 transition-colors">
              {selected.size === students.length && students.length > 0
                ? <CheckSquare className="w-5 h-5 text-indigo-600" />
                : <Square className="w-5 h-5" />
              }
            </button>
            <span className="text-sm text-gray-500">
              {students.length} students found
              {selected.size > 0 && <span className="text-indigo-600 font-semibold"> · {selected.size} selected</span>}
            </span>
          </div>
          {students.length > 0 && (
            <button onClick={toggleAll}
              className="text-xs text-indigo-600 font-medium hover:text-indigo-700">
              {selected.size === students.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Loading students...</div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="font-medium">No students match the filters</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {students.map((s: any) => {
              const isSelected = selected.has(s.id)
              return (
                <div key={s.id}
                  onClick={() => toggleOne(s.id)}
                  className={cn(
                    'flex items-center gap-4 px-6 py-3 cursor-pointer transition-colors',
                    isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  )}>
                  <button className="text-gray-400 flex-shrink-0">
                    {isSelected
                      ? <CheckSquare className="w-5 h-5 text-indigo-600" />
                      : <Square className="w-5 h-5" />
                    }
                  </button>
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {s.photo_url
                      ? <img src={s.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : <span className="text-xs font-bold text-indigo-700">{s.first_name?.[0]}{s.last_name?.[0]}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-gray-400">
                      {s.admission_number && `#${s.admission_number} · `}
                      Roll: {s.roll_number ?? '—'}
                    </p>
                  </div>
                  <div className="hidden md:flex items-center gap-3 text-xs text-gray-500">
                    <span>{s.classes?.name ?? '—'}</span>
                    {s.sections?.name && <span>Sec {s.sections.name}</span>}
                    {s.houses && (
                      <span className="px-2 py-0.5 rounded-full text-white text-xs font-medium"
                        style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                        {s.houses.name}
                      </span>
                    )}
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[s.status])}>
                      {s.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}