'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Plus, X, Pencil, Trash2, Loader2, ShieldOff, GraduationCap } from 'lucide-react'
import { toast } from 'sonner'

export default function ClassesSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const qc = useQueryClient()
  const [showAddClass, setShowAddClass] = useState(false)

  const { data: classes, isLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list().then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['classes'] })

  const deleteClassMutation = useMutation({
    mutationFn: (id: string) => classesApi.delete(id),
    onSuccess: () => { invalidate(); toast.success('Class deleted') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete class'),
  })

  const sorted = [...(classes ?? [])].sort((a: any, b: any) => (a.numeric_level ?? 0) - (b.numeric_level ?? 0))

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <ShieldOff className="w-12 h-12 mb-3 text-gray-200" />
        <p className="font-semibold text-gray-500">Access Denied</p>
        <p className="text-sm mt-1">Only School Admin or Principal can manage classes & sections.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Settings</p>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Classes & Sections</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Define your school's classes and how each is split — letter sections, or streams for 11th/12th
          </p>
        </div>
        <button onClick={() => setShowAddClass(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <Plus className="w-4 h-4" /> Add Class
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No classes yet</p>
          <p className="text-sm mt-1">Add your first class to get started</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sorted.map((c: any) => (
            <ClassCard
              key={c.id}
              cls={c}
              onDeleteClass={() => {
                if (confirm(`Delete ${c.name}? This can't be undone.`)) deleteClassMutation.mutate(c.id)
              }}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      {showAddClass && (
        <AddClassModal onClose={() => { setShowAddClass(false); invalidate() }} />
      )}
    </div>
  )
}

// ── CLASS CARD ────────────────────────────────────────────────
function ClassCard({ cls, onDeleteClass, onChanged }: { cls: any; onDeleteClass: () => void; onChanged: () => void }) {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(cls.name)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionName, setSectionName] = useState('')

  const renameClassMutation = useMutation({
    mutationFn: () => classesApi.update(cls.id, { name }),
    onSuccess: () => { onChanged(); setEditingName(false); toast.success('Class renamed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to rename'),
  })

  const addSectionMutation = useMutation({
    mutationFn: () => classesApi.sections.create(cls.id, { name: sectionName.trim() }),
    onSuccess: () => { onChanged(); setSectionName(''); setAddingSection(false); toast.success('Section added') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add section'),
  })

  const deleteSectionMutation = useMutation({
    mutationFn: (id: string) => classesApi.sections.delete(id),
    onSuccess: () => { onChanged(); toast.success('Section removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove section'),
  })

  const renameSectionMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => classesApi.sections.update(id, { name }),
    onSuccess: () => { onChanged(); toast.success('Section renamed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to rename section'),
  })

  const sections = cls.sections ?? []
  const isSenior = cls.numeric_level === 11 || cls.numeric_level === 12

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          {editingName ? (
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onBlur={() => name.trim() && name !== cls.name ? renameClassMutation.mutate() : setEditingName(false)}
              onKeyDown={e => e.key === 'Enter' && renameClassMutation.mutate()}
              className="px-3 py-1.5 text-sm font-semibold border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          ) : (
            <h3 className="font-semibold text-gray-900">{cls.name}</h3>
          )}
          {isSenior && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-50 text-violet-600 border border-violet-100">
              Stream-wise
            </span>
          )}
          <button onClick={() => setEditingName(true)} className="text-gray-300 hover:text-gray-500 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
        <button onClick={onDeleteClass} className="text-gray-300 hover:text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sections.map((s: any) => (
          <SectionChip
            key={s.id}
            section={s}
            onDelete={() => deleteSectionMutation.mutate(s.id)}
            onRename={(newName) => renameSectionMutation.mutate({ id: s.id, name: newName })}
          />
        ))}

        {addingSection ? (
          <div className="flex items-center gap-1">
            <input autoFocus value={sectionName} onChange={e => setSectionName(e.target.value)}
              placeholder={isSenior ? 'e.g. PCM' : 'e.g. C'}
              onKeyDown={e => e.key === 'Enter' && sectionName.trim() && addSectionMutation.mutate()}
              className="px-3 py-1.5 text-xs border border-indigo-300 rounded-lg w-28 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <button onClick={() => sectionName.trim() && addSectionMutation.mutate()} disabled={addSectionMutation.isPending}
              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
              {addSectionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => { setAddingSection(false); setSectionName('') }} className="p-1.5 text-gray-400 hover:bg-gray-50 rounded-lg transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingSection(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors">
            <Plus className="w-3 h-3" /> {isSenior ? 'Add Stream' : 'Add Section'}
          </button>
        )}

        {sections.length === 0 && !addingSection && (
          <span className="text-xs text-gray-400">No {isSenior ? 'streams' : 'sections'} yet</span>
        )}
      </div>
    </div>
  )
}

// ── SECTION CHIP (click name to rename) ─────────────────────────
function SectionChip({ section, onDelete, onRename }: { section: any; onDelete: () => void; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(section.name)

  const commit = () => {
    setEditing(false)
    if (value.trim() && value !== section.name) onRename(value.trim())
    else setValue(section.name)
  }

  return (
    <div className={cn(
      'group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
      'bg-indigo-50 border-indigo-100 text-indigo-700'
    )}>
      {editing ? (
        <input autoFocus value={value} onChange={e => setValue(e.target.value)}
          onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}
          className="w-16 bg-white px-1.5 py-0.5 rounded border border-indigo-300 text-xs focus:outline-none" />
      ) : (
        <button onClick={() => setEditing(true)} className="hover:underline">{section.name}</button>
      )}
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-indigo-300 hover:text-red-500 transition-all">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ── ADD CLASS MODAL ───────────────────────────────────────────
function AddClassModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [numericLevel, setNumericLevel] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Class name required')
    setLoading(true)
    try {
      await classesApi.create({ name: name.trim(), numeric_level: numericLevel ? Number(numericLevel) : undefined })
      toast.success('Class added')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add class')
    } finally {
      setLoading(false)
    }
  }

  const ic = 'w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Class</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Class Name *</label>
            <input className={ic} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Class 13 / Nursery" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Numeric Level</label>
            <input type="number" className={ic} value={numericLevel} onChange={e => setNumericLevel(e.target.value)} placeholder="e.g. 11 (used to order classes)" />
            <p className="text-xs text-gray-400 mt-1">Levels 11 and 12 default to stream sections instead of letters once you add them below.</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Add Class
          </button>
        </div>
      </div>
    </div>
  )
}
