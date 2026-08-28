'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { syllabusApi, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassPicker } from '@/lib/useClassPicker'
import { formatDate } from '@/lib/utils'
import { BookMarked, ShieldOff, BookOpen, FileText, Eye, Download } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

// Read-only mirror of Organizational Settings' Syllabus Setup — same
// chapter list and reference documents that page writes, browsed here by
// anyone who can already see Progress (syllabus.view), not just School
// Admin/Principal. Deliberately skips Progress's status colors, overdue
// badges and "assign homework" action — this tab answers "what is the
// syllabus", Progress answers "how far along are we".
export default function ViewSyllabusPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canSeeSyllabus = can('syllabus.view')
  const isSeniorManagement = can('syllabus.plan')

  if (!permLoading && !canSeeSyllabus) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to view the syllabus." className="h-64" />
    )
  }

  return <ViewSyllabusView isSeniorManagement={isSeniorManagement} />
}

function ViewSyllabusView({ isSeniorManagement }: { isSeniorManagement: boolean }) {
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections, myAllowedSubjects } = useClassPicker(isSeniorManagement)
  const [selectedSubject, setSelectedSubjectRaw] = useState('')
  const setSelectedClassAndReset = (v: string) => { setSelectedClass(v); setSelectedSubjectRaw('') }

  // Sections below 11th/12th all share one syllabus (see Settings ->
  // Syllabus Setup) — matching that same gate here means a class that was
  // set up with no section picked isn't hidden behind a pointless "select
  // a section" step.
  const selectedClassObj = classesData.find((c: any) => c.id === selectedClass)
  const isStreamWise = selectedClassObj?.numeric_level === 11 || selectedClassObj?.numeric_level === 12
  const effectiveSection = isStreamWise ? selectedSection : ''

  const { data: masterSubjects } = useQuery({
    queryKey: ['subjects', selectedClass],
    queryFn: () => classesApi.subjects.list(selectedClass).then(r => r.data),
    enabled: !!selectedClass,
  })
  const subjectOptions = useMemo(() => {
    const names = (masterSubjects ?? []).map((s: any) => s.name as string)
    return myAllowedSubjects ? names.filter(n => myAllowedSubjects.includes(n)) : names
  }, [masterSubjects, myAllowedSubjects])

  const ready = !!selectedClass && (!isStreamWise || sections.length === 0 || !!selectedSection) && !!selectedSubject

  return (
    <div className="space-y-5">
      <PageHeader title="View Syllabus" description="Browse the chapter list and reference documents set up for each class." icon={BookMarked} />

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
        {isStreamWise && sections.length > 0 && (
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

      {!ready ? (
        <div className="bg-card rounded-2xl border border-border">
          {classesData.length === 0 && !isSeniorManagement ? (
            <EmptyState
              icon={BookMarked}
              title="You're not scheduled to teach any class yet"
              description="Your classes come from the timetable — ask your school admin to schedule you, then they'll appear here."
            />
          ) : (
            <EmptyState icon={BookMarked} title="Pick a class, section and subject" description="Select a class, section and subject above to view its syllabus." />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-2">
          <ChapterListPanel classId={selectedClass} sectionId={effectiveSection} subjectName={selectedSubject} />
          <DocumentsListPanel classId={selectedClass} sectionId={effectiveSection} subjectName={selectedSubject} />
        </div>
      )}
    </div>
  )
}

function ChapterListPanel({ classId, sectionId, subjectName }: { classId: string; sectionId: string; subjectName: string }) {
  const { data: chapters, isLoading } = useQuery({
    queryKey: ['syllabus', classId, sectionId, subjectName],
    queryFn: () => syllabusApi.list({ class_id: classId, section_id: sectionId || undefined, subject_name: subjectName }).then(r => r.data),
  })

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
      <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Chapters</h3>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
      ) : (chapters ?? []).length === 0 ? (
        <EmptyState icon={BookOpen} title="No chapters set up yet" description="Chapters are added in Settings → Syllabus Setup." className="py-8" />
      ) : (
        <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
          {(chapters ?? []).map((c: any) => (
            <div key={c.id} className="rounded-lg border border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {c.chapter_number ? `${c.chapter_number}. ` : ''}{c.chapter_name}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.due_date ? `Due ${formatDate(c.due_date)}`
                  : c.exam_templates?.name ? `Coming in ${c.exam_templates.name}`
                  : 'No due date'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentsListPanel({ classId, sectionId, subjectName }: { classId: string; sectionId: string; subjectName: string }) {
  const { data: docs, isLoading } = useQuery({
    queryKey: ['syllabus-documents', classId, sectionId, subjectName],
    queryFn: () => syllabusApi.documents.list({ class_id: classId, section_id: sectionId || undefined, subject_name: subjectName }).then(r => r.data),
  })

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
      <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Reference documents</h3>
      {isLoading ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : (docs ?? []).length === 0 ? (
        <EmptyState icon={FileText} title="No documents uploaded yet" description="Reference documents are uploaded in Settings → Syllabus Setup." className="py-8" />
      ) : (
        <div className="space-y-2">
          {(docs ?? []).map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-2.5 border border-border rounded-xl p-2.5">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{doc.document_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(doc.created_at)}{doc.file_size ? ` · ${doc.file_size}` : ''}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-primary shrink-0" title="View">
                <a href={doc.file_url} target="_blank" rel="noreferrer" aria-label={`View ${doc.document_name}`}><Eye className="h-4 w-4" /></a>
              </Button>
              <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-success shrink-0" title="Download">
                <a href={doc.file_url} download aria-label={`Download ${doc.document_name}`}><Download className="h-4 w-4" /></a>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
