'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Plus, X, Pencil, Trash2, Loader2, ShieldOff, GraduationCap, School } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

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
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only School Admin or Principal can manage classes & sections."
        className="h-64"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes & Sections"
        description="Define your school's classes and how each is split — letter sections, or streams for 11th/12th"
        icon={School}
        className="mb-0"
        actions={
          <Button onClick={() => setShowAddClass(true)}>
            <Plus className="h-4 w-4" /> Add Class
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title="No classes yet"
            description="Classes are the backbone of admissions, timetables and attendance. Add your first one to get started."
            action={
              <Button onClick={() => setShowAddClass(true)}>
                <Plus className="h-4 w-4" /> Add Class
              </Button>
            }
          />
        </Card>
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

  const [addingSubject, setAddingSubject] = useState(false)
  const [subjectName, setSubjectName] = useState('')

  const { data: subjects, refetch: refetchSubjects } = useQuery({
    queryKey: ['subjects', cls.id],
    queryFn: () => classesApi.subjects.list(cls.id).then(r => r.data),
  })

  const addSubjectMutation = useMutation({
    mutationFn: () => classesApi.subjects.create({ name: subjectName.trim(), class_id: cls.id }),
    onSuccess: () => { refetchSubjects(); setSubjectName(''); setAddingSubject(false); toast.success('Subject added') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add subject'),
  })

  const deleteSubjectMutation = useMutation({
    mutationFn: (id: string) => classesApi.subjects.delete(id),
    onSuccess: () => { refetchSubjects(); toast.success('Subject removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove subject'),
  })

  const sections = cls.sections ?? []
  const isSenior = cls.numeric_level === 11 || cls.numeric_level === 12

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {editingName ? (
              <Input autoFocus value={name} onChange={e => setName(e.target.value)}
                onBlur={() => name.trim() && name !== cls.name ? renameClassMutation.mutate() : setEditingName(false)}
                onKeyDown={e => e.key === 'Enter' && renameClassMutation.mutate()}
                className="h-8 w-40 font-semibold" />
            ) : (
              <h3 className="font-semibold text-foreground">{cls.name}</h3>
            )}
            {isSenior && (
              <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 dark:text-purple-400">
                Stream-wise
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => setEditingName(true)}
              aria-label={`Rename ${cls.name}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={onDeleteClass}
            aria-label={`Delete ${cls.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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
              <Input autoFocus value={sectionName} onChange={e => setSectionName(e.target.value)}
                placeholder={isSenior ? 'e.g. PCM' : 'e.g. C'}
                onKeyDown={e => e.key === 'Enter' && sectionName.trim() && addSectionMutation.mutate()}
                className="h-8 w-28 text-xs" />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10"
                onClick={() => sectionName.trim() && addSectionMutation.mutate()} disabled={addSectionMutation.isPending}
                aria-label="Add section">
                {addSectionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                onClick={() => { setAddingSection(false); setSectionName('') }} aria-label="Cancel">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button onClick={() => setAddingSection(true)}
              className="flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Plus className="h-3 w-3" /> {isSenior ? 'Add Stream' : 'Add Section'}
            </button>
          )}

          {sections.length === 0 && !addingSection && (
            <span className="text-xs text-muted-foreground">No {isSenior ? 'streams' : 'sections'} yet</span>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Subjects — used across Timetable, Homework &amp; Syllabus
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(subjects ?? []).map((s: any) => (
              <SubjectChip key={s.id} subject={s} onDelete={() => deleteSubjectMutation.mutate(s.id)} />
            ))}

            {addingSubject ? (
              <div className="flex items-center gap-1">
                <Input autoFocus value={subjectName} onChange={e => setSubjectName(e.target.value)}
                  placeholder="e.g. Physics"
                  onKeyDown={e => e.key === 'Enter' && subjectName.trim() && addSubjectMutation.mutate()}
                  className="h-8 w-32 text-xs" />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10"
                  onClick={() => subjectName.trim() && addSubjectMutation.mutate()} disabled={addSubjectMutation.isPending}
                  aria-label="Add subject">
                  {addSubjectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                  onClick={() => { setAddingSubject(false); setSubjectName('') }} aria-label="Cancel">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button onClick={() => setAddingSubject(true)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-success/40 hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Plus className="h-3 w-3" /> Add Subject
              </button>
            )}

            {(subjects ?? []).length === 0 && !addingSubject && (
              <span className="text-xs text-muted-foreground">No subjects yet</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── SUBJECT CHIP ──────────────────────────────────────────────
function SubjectChip({ subject, onDelete }: { subject: any; onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-1.5 rounded-lg border border-success/20 bg-success/10 py-1.5 pl-3 pr-1 text-xs font-medium text-success">
      <span>{subject.name}</span>
      {/* Revealed on hover, but also on keyboard focus — otherwise the only
          way to remove a subject is with a mouse. */}
      <button onClick={onDelete} aria-label={`Remove ${subject.name}`}
        className="flex h-6 w-6 items-center justify-center rounded text-success/50 opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
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
    <div className="group flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 py-1.5 pl-3 pr-1 text-xs font-medium text-primary transition-all">
      {editing ? (
        <input autoFocus value={value} onChange={e => setValue(e.target.value)}
          onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}
          className="w-16 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none" />
      ) : (
        <button onClick={() => setEditing(true)} aria-label={`Rename section ${section.name}`}
          className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{section.name}</button>
      )}
      {/* Revealed on hover, but also on keyboard focus — otherwise the only
          way to remove a section is with a mouse. */}
      <button onClick={onDelete} aria-label={`Remove section ${section.name}`}
        className="flex h-6 w-6 items-center justify-center rounded text-primary/50 opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
        <X className="h-3 w-3" />
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

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Class</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="class-name">Class Name *</Label>
            <Input id="class-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Class 13 / Nursery" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="class-level">Numeric Level</Label>
            <Input id="class-level" type="number" value={numericLevel} onChange={e => setNumericLevel(e.target.value)} placeholder="e.g. 11 (used to order classes)" />
            <p className="text-xs text-muted-foreground">Levels 11 and 12 default to stream sections instead of letters once you add them below.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Add Class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
