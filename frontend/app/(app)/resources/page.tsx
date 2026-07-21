'use client'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { resourcesApi, admissionApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import {
  Plus, Upload, Trash2, Eye, ExternalLink, BookOpen, Loader2, X, Search,
  NotebookText, ClipboardList, GraduationCap, FileText, Video, BookmarkCheck, Paperclip,
} from 'lucide-react'
import { toast } from 'sonner'

const RESOURCE_TYPES = [
  { value: 'notes',          label: 'Notes',          icon: NotebookText,   iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600',  tag: 'bg-indigo-50 text-indigo-700' },
  { value: 'assignment',     label: 'Assignment',     icon: ClipboardList,  iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',   tag: 'bg-amber-50 text-amber-700' },
  { value: 'syllabus',       label: 'Syllabus',       icon: GraduationCap,  iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', tag: 'bg-emerald-50 text-emerald-700' },
  { value: 'question_paper', label: 'Question Paper', icon: FileText,       iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    tag: 'bg-rose-50 text-rose-700' },
  { value: 'video_link',     label: 'Video Link',     icon: Video,          iconBg: 'bg-pink-50',    iconColor: 'text-pink-600',    tag: 'bg-pink-50 text-pink-700' },
  { value: 'reference',      label: 'Reference',      icon: BookmarkCheck,  iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',  tag: 'bg-violet-50 text-violet-700' },
  { value: 'other',          label: 'Other',          icon: Paperclip,      iconBg: 'bg-gray-100',   iconColor: 'text-gray-500',    tag: 'bg-gray-100 text-gray-600' },
]

export default function ResourcesPage() {
  const [search,       setSearch]      = useState('')
  const [classFilter,  setClassFilter] = useState('')
  const [typeFilter,   setTypeFilter]  = useState('')
  const [showUpload,   setShowUpload]  = useState(false)
  const qc = useQueryClient()

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: resources, isLoading } = useQuery({
    queryKey: ['resources', classFilter, typeFilter],
    queryFn: () => resourcesApi.list({
      class_id: classFilter || undefined,
      resource_type: typeFilter || undefined,
    }).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => resourcesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] })
      toast.success('Resource deleted')
    },
  })

  const filtered = (resources ?? []).filter((r: any) =>
    !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.subject_name?.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = RESOURCE_TYPES.reduce((acc, t) => {
    acc[t.value] = filtered.filter((r: any) => r.resource_type === t.value)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource Centre</h1>
          <p className="text-gray-400 text-sm mt-0.5">Study materials, assignments and references for students</p>
        </div>
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-200">
          <Plus className="w-4 h-4" /> Upload Resource
        </button>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter('')}
          className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all',
            !typeFilter
              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
              : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-200 hover:text-indigo-600')}>
          All Types
        </button>
        {RESOURCE_TYPES.map(t => {
          const Icon = t.icon
          const active = typeFilter === t.value
          return (
            <button key={t.value} onClick={() => setTypeFilter(active ? '' : t.value)}
              className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all',
                active
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-200 hover:text-indigo-600')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Search + class filter */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search by title or subject..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white transition-all" />
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all">
          <option value="">All Classes</option>
          {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Resources */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium text-gray-600">No resources found</p>
          <p className="text-sm mt-1">Upload your first resource to get started</p>
        </div>
      ) : typeFilter ? (
        <ResourceList items={filtered} onDelete={id => deleteMutation.mutate(id)} />
      ) : (
        <div className="space-y-6">
          {RESOURCE_TYPES.map(t => {
            const items = grouped[t.value] ?? []
            if (!items.length) return null
            return (
              <div key={t.value}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t.label}</span>
                  <span className="bg-gray-100 text-gray-500 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-200">{items.length}</span>
                </div>
                <ResourceList items={items} onDelete={id => deleteMutation.mutate(id)} />
              </div>
            )
          })}
        </div>
      )}

      {showUpload && (
        <UploadModal classes={classesData ?? []} onClose={() => {
          setShowUpload(false)
          qc.invalidateQueries({ queryKey: ['resources'] })
        }} />
      )}
    </div>
  )
}

function ResourceList({ items, onDelete }: { items: any[], onDelete: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {items.map((r: any) => {
        const typeInfo = RESOURCE_TYPES.find(t => t.value === r.resource_type) ?? RESOURCE_TYPES[RESOURCE_TYPES.length - 1]
        const Icon = typeInfo.icon
        return (
          <div key={r.id}
            className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 hover:border-gray-300 hover:shadow-md transition-all">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', typeInfo.iconBg)}>
              <Icon className={cn('w-[18px] h-[18px]', typeInfo.iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate">{r.title}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-gray-400">
                {r.subject_name && <span>{r.subject_name}</span>}
                {r.subject_name && <Dot />}
                {r.classes?.name && <span className="text-indigo-600 font-medium">{r.classes.name}</span>}
                {r.classes?.name && <Dot />}
                {r.file_size && <span>{r.file_size}</span>}
                {r.file_size && <Dot />}
                <span>{formatDate(r.created_at)}</span>
                {r.users?.full_name && <Dot />}
                {r.users?.full_name && <span>{r.users.full_name}</span>}
              </div>
              {r.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{r.description}</p>}
            </div>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0', typeInfo.tag)}>
              {typeInfo.label}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {(r.file_url || r.external_url) && (
                <a href={r.file_url || r.external_url} target="_blank" rel="noreferrer"
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                  {r.external_url ? <ExternalLink className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </a>
              )}
              <button onClick={() => { if (confirm('Delete this resource?')) onDelete(r.id) }}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Dot() {
  return <span className="w-1 h-1 rounded-full bg-gray-300 inline-block" />
}

function UploadModal({ classes, onClose }: { classes: any[], onClose: () => void }) {
  const [form, setForm] = useState({
    title: '', description: '', resource_type: 'notes',
    class_id: '', subject_name: '', external_url: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!form.title) return toast.error('Title is required')
    if (!file && !form.external_url) return toast.error('Please upload a file or enter a URL')
    setLoading(true)
    try {
      const payload: any = { ...form }
      if (file) {
        const reader = new FileReader()
        await new Promise<void>(resolve => {
          reader.onload = async () => {
            payload.file_base64 = reader.result
            payload.file_name = file.name
            payload.mime_type = file.type
            resolve()
          }
          reader.readAsDataURL(file)
        })
      }
      await resourcesApi.upload(payload)
      toast.success('Resource uploaded!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Upload Resource</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Title *</label>
            <input className={inputCls} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Chapter 5 Notes - Algebra" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Type *</label>
              <select className={inputCls} value={form.resource_type}
                onChange={e => setForm(f => ({ ...f, resource_type: e.target.value }))}>
                {RESOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
              <select className={inputCls} value={form.class_id}
                onChange={e => setForm(f => ({ ...f, class_id: e.target.value }))}>
                <option value="">All classes</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
            <input className={inputCls} value={form.subject_name}
              onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}
              placeholder="e.g. Mathematics, Science" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea rows={2} className={inputCls + ' resize-none'} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of the resource..." />
          </div>
          {form.resource_type === 'video_link' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Video URL *</label>
              <input className={inputCls} value={form.external_url}
                onChange={e => setForm(f => ({ ...f, external_url: e.target.value }))}
                placeholder="https://youtube.com/..." />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">File *</label>
              <div onClick={() => fileRef.current?.click()}
                className={cn('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                  file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50')}>
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-indigo-700">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Click to select file</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, DOC, PPT, images up to 10MB</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.xls,.xlsx,.txt"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium hover:bg-gray-50 rounded-xl transition-colors">Cancel</button>
          <button onClick={handleUpload} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2 transition-colors">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : 'Upload Resource'}
          </button>
        </div>
      </div>
    </div>
  )
}