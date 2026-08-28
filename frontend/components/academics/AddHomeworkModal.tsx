'use client'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { homeworkApi, classesApi, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Upload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Shared between the Assign page (frontend/app/(app)/homework/page.tsx —
// HomeworkTab's own "+"/edit actions) and the Syllabus page's chapter
// drill-down ("Assign homework for this chapter") — a real second consumer
// within the same app, unlike the staff-app/portal-app duplication
// elsewhere in this module, so extracting to a real shared component was
// warranted here rather than just noted as intentional drift.
export function AddHomeworkModal({ classId, sectionId, initialDueDate, allowedSubjects, editing, fromChapter, onClose }: {
  classId: string; sectionId: string; initialDueDate?: string; allowedSubjects?: string[]; editing?: any
  // plan.md Phase 10 — set when opened from "Assign homework for this
  // chapter" on the Syllabus page, so the created homework carries the
  // link and the form starts pre-filled instead of blank.
  fromChapter?: { id: string; subject_name: string; chapter_label: string }
  onClose: () => void
}) {
  const isEditing = !!editing
  const [type, setType] = useState<'homework' | 'classwork'>(editing?.type ?? 'homework')
  const [assignmentType, setAssignmentType] = useState<'class' | 'individual'>(editing?.assignment_type ?? 'class')
  const [subjectName, setSubjectName] = useState(editing?.subject_name ?? fromChapter?.subject_name ?? (allowedSubjects?.length === 1 ? allowedSubjects[0] : ''))
  const [title, setTitle] = useState(editing?.title ?? (fromChapter ? fromChapter.chapter_label : ''))
  const [description, setDescription] = useState(editing?.description ?? '')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? initialDueDate ?? '')
  const [studentIds, setStudentIds] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: students } = useQuery({
    queryKey: ['attendance-class-students', classId, sectionId],
    queryFn: () => api.get('/students/attendance/class', { params: { class_id: classId, section_id: sectionId || undefined, date: new Date().toISOString().slice(0, 10) } }).then(r => r.data.data.students),
    enabled: !isEditing && assignmentType === 'individual',
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

  const readFileAsBase64 = (f: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(f)
  })

  const handleSave = async () => {
    if (isEditing) {
      if (!title.trim()) return toast.error('Title is required')
      setLoading(true)
      try {
        const fileFields = file ? { file_base64: await readFileAsBase64(file), file_name: file.name, mime_type: file.type } : {}
        await homeworkApi.update(editing.id, {
          title: title.trim(), description: description.trim() || undefined, due_date: dueDate || undefined, ...fileFields,
        })
        toast.success('Updated')
        onClose()
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Failed to update')
      } finally { setLoading(false) }
      return
    }

    if (!subjectName.trim() || !title.trim()) return toast.error('Subject and title are required')
    if (assignmentType === 'individual' && studentIds.length === 0) return toast.error('Select at least one student')
    setLoading(true)
    try {
      const fileFields = file ? { file_base64: await readFileAsBase64(file), file_name: file.name, mime_type: file.type } : {}
      await homeworkApi.create({
        class_id: classId, section_id: sectionId || undefined, subject_name: subjectName.trim(),
        type, assignment_type: assignmentType, title: title.trim(), description: description.trim() || undefined,
        due_date: dueDate || undefined, student_ids: assignmentType === 'individual' ? studentIds : undefined,
        chapter_id: fromChapter?.id,
        ...fileFields,
      })
      toast.success('Assigned')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Homework / Classwork' : 'Assign Homework / Classwork'}</DialogTitle>
          {fromChapter && <DialogDescription>For chapter: {fromChapter.chapter_label}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {/* Re-targeting (type, whole-class vs individual, and who) isn't
              editable once posted — plan.md Phase 3 scoped that out
              deliberately, since submissions may already exist against it. */}
          {!isEditing && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={v => setType(v as any)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="homework">Homework</SelectItem>
                      <SelectItem value="classwork">Classwork</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Assign to</Label>
                  <Select value={assignmentType} onValueChange={v => setAssignmentType(v as any)}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="class">Whole class</SelectItem>
                      <SelectItem value="individual">Specific students</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {assignmentType === 'individual' && (
                <div className="space-y-1.5">
                  <Label>Students</Label>
                  <div className="border border-border rounded-xl p-2 max-h-36 overflow-y-auto space-y-1">
                    {(students ?? []).map((s: any) => (
                      <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm text-foreground cursor-pointer">
                        <input type="checkbox" checked={studentIds.includes(s.id)}
                          onChange={e => setStudentIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />
                        {s.first_name} {s.last_name} {s.roll_number && <span className="text-muted-foreground">· Roll {s.roll_number}</span>}
                      </label>
                    ))}
                    {(students ?? []).length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No students found for this class/section</p>}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Subject *</Label>
                <Select value={subjectName || undefined} onValueChange={setSubjectName}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Select subject..." /></SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {subjectOptions.length === 0 && (
                  <p className="text-xs text-warning mt-1.5">
                    {allowedSubjects ? "You're not timetabled for any subject in this class/section." : 'No subjects set up for this class yet — add some in Settings → Classes & Sections.'}
                  </p>
                )}
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chapter 4 exercises 1-10" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details / instructions" />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Attachment</Label>
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> {file ? file.name : (editing?.attachment_url ? 'Replace file' : 'Attach a file (optional)')}
            </Button>
            {!file && editing?.attachment_url && (
              <a href={editing.attachment_url} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline">Current attachment</a>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} {isEditing ? 'Save changes' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
