'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { syllabusApi, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassPicker } from '@/lib/useClassPicker'
import { cn, formatDate } from '@/lib/utils'
import { Loader2, ShieldOff, NotebookPen, Trash2, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

const todayKey = new Date().toISOString().slice(0, 10)

// The "Log Progress" tab of the Syllabus module — used to be a modal
// ("Log Today's Progress") behind a button on the combined page. Its own
// page now, same as app/(app)/syllabus/page.tsx (viewing) and .../due-dates
// (planning) — see app/(app)/syllabus/layout.tsx for why they were split.
export default function SyllabusLogPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canLog = can('syllabus.log_progress')
  const canPlan = can('syllabus.plan')

  if (!permLoading && !canLog) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to log syllabus progress." className="h-64" />
    )
  }

  return <SyllabusLogView isSeniorManagement={canPlan} />
}

function SyllabusLogView({ isSeniorManagement }: { isSeniorManagement: boolean }) {
  const qc = useQueryClient()
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections, myAllowedSubjects } = useClassPicker(isSeniorManagement)
  const [selectedSubject, setSelectedSubjectRaw] = useState('')
  const setSelectedClassAndReset = (v: string) => { setSelectedClass(v); setSelectedSubjectRaw('') }

  // Subject comes from the school's master subject list (Settings ->
  // Classes & Sections), same source used across the whole module now.
  const { data: masterSubjects } = useQuery({
    queryKey: ['subjects', selectedClass],
    queryFn: () => classesApi.subjects.list(selectedClass).then(r => r.data),
    enabled: !!selectedClass,
  })
  const subjectOptions = useMemo(() => {
    const names = (masterSubjects ?? []).map((s: any) => s.name as string)
    return myAllowedSubjects ? names.filter(n => myAllowedSubjects.includes(n)) : names
  }, [masterSubjects, myAllowedSubjects])

  const { data: chapters } = useQuery({
    queryKey: ['syllabus', selectedClass, selectedSection, selectedSubject],
    queryFn: () => syllabusApi.list({ class_id: selectedClass, section_id: selectedSection || undefined, subject_name: selectedSubject || undefined }).then(r => r.data),
    enabled: !!selectedClass && !!selectedSubject,
  })

  const { data: rawLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['progress-notes', selectedClass, selectedSubject],
    queryFn: () => syllabusApi.notes.list({ class_id: selectedClass, subject_name: selectedSubject || undefined }).then(r => r.data),
    enabled: !!selectedClass,
  })
  const logs = myAllowedSubjects ? (rawLogs ?? []).filter((l: any) => myAllowedSubjects.includes(l.subject_name)) : (rawLogs ?? [])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['progress-notes'] })
    qc.invalidateQueries({ queryKey: ['syllabus'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats-all'] })
  }

  const deleteLogMutation = useMutation({
    mutationFn: (id: string) => syllabusApi.notes.delete(id),
    onSuccess: () => { invalidate(); toast.success('Log entry removed') },
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Log Progress" description="Record what was actually covered — this drives the covered-vs-left tracking." icon={NotebookPen} />

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Class</Label>
          <Select value={selectedClass || undefined} onValueChange={setSelectedClassAndReset}>
            <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
            <SelectContent>
              {classesData.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Section</Label>
            <Select value={selectedSection || undefined} onValueChange={setSelectedSection}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select section..." /></SelectTrigger>
              <SelectContent>
                {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedClass && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Subject</Label>
            <Select value={selectedSubject || undefined} onValueChange={setSelectedSubjectRaw}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select subject..." /></SelectTrigger>
              <SelectContent>
                {subjectOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!selectedClass || (sections.length > 0 && !selectedSection) || !selectedSubject ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState icon={NotebookPen} title="Pick a class, section and subject" description="Select a class, section and subject above to log today's progress." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[1fr_1.2fr]">
          <LogEntryForm classId={selectedClass} sectionId={selectedSection} subjectName={selectedSubject} chapters={chapters ?? []} onLogged={invalidate} />

          <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Recent entries
            </h3>
            {logsLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
            ) : logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No progress logged yet for this subject.</p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {logs.map((log: any) => (
                  <div key={log.id} className="border border-border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          {log.progress_status && (
                            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                              log.progress_status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                              {log.progress_status.replace('_', ' ')}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">{formatDate(log.note_date)}</span>
                        </div>
                        {log.syllabus_chapters?.chapter_name && (
                          <p className="text-sm font-medium text-foreground truncate">{log.syllabus_chapters.chapter_name}</p>
                        )}
                        {log.note && <p className="text-xs text-muted-foreground mt-0.5">{log.note}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">{log.users?.full_name}</p>
                      </div>
                      <button onClick={() => deleteLogMutation.mutate(log.id)} aria-label="Remove progress log entry"
                        className="-mr-1.5 -mt-1.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LogEntryForm({ classId, sectionId, subjectName, chapters, onLogged }: {
  classId: string; sectionId: string; subjectName: string; chapters: any[]; onLogged: () => void
}) {
  const [chapterId, setChapterId] = useState('')
  const [status, setStatus] = useState<'started' | 'in_progress' | 'completed'>('in_progress')
  const [note, setNote] = useState('')
  const [logDate, setLogDate] = useState(todayKey)
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      await syllabusApi.notes.create({
        class_id: classId, section_id: sectionId || undefined, subject_name: subjectName,
        chapter_id: chapterId || undefined, progress_status: status, note_date: logDate, note: note.trim() || undefined,
      })
      toast.success('Progress logged')
      setChapterId('')
      setNote('')
      onLogged()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to log progress')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
      <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Log today's progress</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Chapter</Label>
          <Select value={chapterId || 'none'} onValueChange={v => setChapterId(v === 'none' ? '' : v)}>
            <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific chapter (general note)</SelectItem>
              {chapters.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.chapter_number ? `${c.chapter_number}. ` : ''}{c.chapter_name}{c.status === 'completed' ? ' (already covered)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Status</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['started', 'in_progress', 'completed'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
              className={cn('h-9 rounded-lg text-xs font-semibold border transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                status === s ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:bg-muted/50')}>
              {s === 'started' ? 'Started' : s === 'in_progress' ? 'In Progress' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Covered pages 10-15, did examples on the board" />
      </div>

      <Button onClick={handleSave} disabled={loading} className="w-full">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save
      </Button>
    </div>
  )
}
