'use client'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { resourcesApi, admissionApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import {
  Plus, Upload, Trash2, Eye, ExternalLink, BookOpen, Loader2, Search,
  NotebookText, ClipboardList, GraduationCap, FileText, Video, BookmarkCheck, Paperclip,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const RESOURCE_TYPES = [
  { value: 'notes',          label: 'Notes',          icon: NotebookText,   iconBg: 'bg-primary/10',      iconColor: 'text-primary',                        tag: 'bg-primary/10 text-primary' },
  { value: 'assignment',     label: 'Assignment',     icon: ClipboardList,  iconBg: 'bg-warning/10',      iconColor: 'text-warning',                        tag: 'bg-warning/10 text-warning' },
  { value: 'syllabus',       label: 'Syllabus',       icon: GraduationCap,  iconBg: 'bg-success/10',      iconColor: 'text-success',                        tag: 'bg-success/10 text-success' },
  { value: 'question_paper', label: 'Question Paper', icon: FileText,       iconBg: 'bg-destructive/10',  iconColor: 'text-destructive',                    tag: 'bg-destructive/10 text-destructive' },
  { value: 'video_link',     label: 'Video Link',     icon: Video,          iconBg: 'bg-pink-500/10',     iconColor: 'text-pink-600 dark:text-pink-400',    tag: 'bg-pink-500/10 text-pink-600 dark:text-pink-400' },
  { value: 'reference',      label: 'Reference',      icon: BookmarkCheck,  iconBg: 'bg-purple-500/10',   iconColor: 'text-purple-600 dark:text-purple-400', tag: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  { value: 'other',          label: 'Other',          icon: Paperclip,      iconBg: 'bg-muted',           iconColor: 'text-muted-foreground',               tag: 'bg-muted text-muted-foreground' },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Resource Centre</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Study materials, assignments and references for students</p>
        </div>
        <Button onClick={() => setShowUpload(true)}>
          <Plus className="h-4 w-4" /> Upload Resource
        </Button>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter('')}
          className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all',
            !typeFilter
              ? 'border-primary/20 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary')}>
          All Types
        </button>
        {RESOURCE_TYPES.map(t => {
          const Icon = t.icon
          const active = typeFilter === t.value
          return (
            <button key={t.value} onClick={() => setTypeFilter(active ? '' : t.value)}
              className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all',
                active
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary')}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Search + class filter */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="text" placeholder="Search by title or subject..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9" />
          </div>
          <Select value={classFilter || 'all'} onValueChange={v => setClassFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-auto min-w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Resources */}
      {isLoading ? (
        <Card>
          <div className="p-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="No resources found"
            description="Upload your first resource to get started"
          />
        </Card>
      ) : typeFilter ? (
        <ResourceList items={filtered} onDelete={id => deleteMutation.mutate(id)} />
      ) : (
        <div className="space-y-6">
          {RESOURCE_TYPES.map(t => {
            const items = grouped[t.value] ?? []
            if (!items.length) return null
            return (
              <div key={t.value}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</span>
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{items.length}</span>
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
          <Card key={r.id}
            className="flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-all hover:border-primary/30 hover:shadow-md">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', typeInfo.iconBg)}>
              <Icon className={cn('h-[18px] w-[18px]', typeInfo.iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{r.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {r.subject_name && <span>{r.subject_name}</span>}
                {r.subject_name && <Dot />}
                {r.classes?.name && <span className="font-medium text-primary">{r.classes.name}</span>}
                {r.classes?.name && <Dot />}
                {r.file_size && <span>{r.file_size}</span>}
                {r.file_size && <Dot />}
                <span>{formatDate(r.created_at)}</span>
                {r.users?.full_name && <Dot />}
                {r.users?.full_name && <span>{r.users.full_name}</span>}
              </div>
              {r.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.description}</p>}
            </div>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', typeInfo.tag)}>
              {typeInfo.label}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {(r.file_url || r.external_url) && (
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                  <a href={r.file_url || r.external_url} target="_blank" rel="noreferrer" aria-label="Open resource">
                    {r.external_url ? <ExternalLink className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </a>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => { if (confirm('Delete this resource?')) onDelete(r.id) }} aria-label="Delete resource">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function Dot() {
  return <span className="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />
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

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Resource</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="res-title">Title *</Label>
            <Input id="res-title" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Chapter 5 Notes - Algebra" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.resource_type} onValueChange={v => setForm(f => ({ ...f, resource_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={form.class_id || 'all'} onValueChange={v => setForm(f => ({ ...f, class_id: v === 'all' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-subject">Subject</Label>
            <Input id="res-subject" value={form.subject_name}
              onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}
              placeholder="e.g. Mathematics, Science" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-desc">Description</Label>
            <Textarea id="res-desc" rows={2} className="resize-none" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of the resource..." />
          </div>
          {form.resource_type === 'video_link' ? (
            <div className="space-y-1.5">
              <Label htmlFor="res-url">Video URL *</Label>
              <Input id="res-url" value={form.external_url}
                onChange={e => setForm(f => ({ ...f, external_url: e.target.value }))}
                placeholder="https://youtube.com/..." />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>File *</Label>
              <div onClick={() => fileRef.current?.click()}
                className={cn('cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                  file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/40')}>
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-primary">{file.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to select file</p>
                    <p className="mt-1 text-xs text-muted-foreground">PDF, DOC, PPT, images up to 10MB</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.xls,.xlsx,.txt"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpload} disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</> : 'Upload Resource'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
