'use client'
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { syllabusApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useClassPicker } from '@/lib/useClassPicker'
import { formatDate } from '@/lib/utils'
import { BookMarked, ShieldOff, Upload, FileText, Trash2, Eye, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { AddChaptersForm } from '@/components/academics/AddChaptersForm'

// Organizational Settings -> Syllabus Setup: the initial, class-wide
// definition of each subject's syllabus, as opposed to Syllabus -> Due
// Dates (the day-to-day planning view for a class a senior staff member
// is actively working with). Same class/section/subject sourcing as
// every other syllabus screen this session — never free text. All three
// requested input methods live here: AddChaptersForm already covers
// "import from Excel" and "type chapters in one at a time"; the upload
// panel below is the new third option, a raw reference document kept
// as-is rather than parsed into chapters.
export default function SyllabusSetupPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'

  if (!canManage) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="Only School Admin or Principal can set up the syllabus." className="h-64" />
    )
  }

  return <SyllabusSetupView />
}

function SyllabusSetupView() {
  const qc = useQueryClient()
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections } = useClassPicker(true)
  const [selectedSubject, setSelectedSubjectRaw] = useState('')
  const setSelectedClassAndReset = (v: string) => { setSelectedClass(v); setSelectedSubjectRaw('') }

  const { data: masterSubjects } = useQuery({
    queryKey: ['subjects', selectedClass],
    queryFn: () => classesApi.subjects.list(selectedClass).then(r => r.data),
    enabled: !!selectedClass,
  })

  const invalidateChapters = () => {
    qc.invalidateQueries({ queryKey: ['syllabus'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats'] })
    qc.invalidateQueries({ queryKey: ['syllabus-stats-all'] })
  }

  const ready = !!selectedClass && (sections.length === 0 || !!selectedSection) && !!selectedSubject

  return (
    <div className="space-y-5">
      <PageHeader title="Syllabus Setup" description="Define the syllabus for each class, section and subject — import an Excel sheet, type chapters in, or upload a reference document." icon={BookMarked} />

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
                {(masterSubjects ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedClass && (masterSubjects ?? []).length === 0 && (
          <p className="text-xs text-warning">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
        )}
      </div>

      {!ready ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState icon={BookMarked} title="Pick a class, section and subject" description="Select a class, section and subject above to set up its syllabus." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-2">
          <AddChaptersForm classId={selectedClass} sectionId={selectedSection} subjectName={selectedSubject} onSaved={invalidateChapters} />
          <SyllabusDocumentsPanel classId={selectedClass} sectionId={selectedSection} subjectName={selectedSubject} />
        </div>
      )}
    </div>
  )
}

// The third input method — a raw reference document (a CBSE-issued PDF,
// a scanned copy of last year's plan) kept as-is rather than parsed
// into chapters. Distinct from AddChaptersForm's Excel import, which
// only ever extracts chapter names.
function SyllabusDocumentsPanel({ classId, sectionId, subjectName }: { classId: string; sectionId: string; subjectName: string }) {
  const qc = useQueryClient()
  const [docName, setDocName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const queryKey = ['syllabus-documents', classId, sectionId, subjectName]
  const { data: docs, isLoading } = useQuery({
    queryKey,
    queryFn: () => syllabusApi.documents.list({ class_id: classId, section_id: sectionId || undefined, subject_name: subjectName }).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => syllabusApi.documents.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast.success('Document removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  const handleUpload = async () => {
    if (!file) return toast.error('Choose a file first')
    const name = docName.trim() || file.name
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          await syllabusApi.documents.upload({
            class_id: classId, section_id: sectionId || undefined, subject_name: subjectName,
            document_name: name, file_base64: reader.result as string, file_name: file.name, mime_type: file.type,
          })
          toast.success('Document uploaded')
          setFile(null); setDocName('')
          if (fileRef.current) fileRef.current.value = ''
          qc.invalidateQueries({ queryKey })
        } catch (e: any) {
          toast.error(e?.response?.data?.error ?? 'Upload failed')
        } finally { setUploading(false) }
      }
      reader.readAsDataURL(file)
    } catch {
      setUploading(false)
    }
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Upload a reference document</h3>
        <p className="mt-1 text-xs text-muted-foreground">Keep the original syllabus document (PDF, scan, etc.) alongside the chapter list — it's kept as-is, not parsed.</p>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors border-input hover:border-primary hover:bg-muted/50"
      >
        {file ? (
          <p className="text-sm font-medium text-primary">{file.name}</p>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Upload className="w-4 h-4" /> Click to select a file
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        onChange={e => setFile(e.target.files?.[0] ?? null)} />

      <div className="flex items-center gap-2">
        <Input className="flex-1" placeholder="Document name (optional)" value={docName} onChange={e => setDocName(e.target.value)} />
        <Button type="button" size="sm" disabled={!file || uploading} onClick={handleUpload}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
        </Button>
      </div>

      <div className="pt-1 space-y-2">
        {isLoading ? (
          <Skeleton className="h-12 w-full rounded-xl" />
        ) : (docs ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents uploaded yet for this subject.</p>
        ) : (
          (docs ?? []).map((doc: any) => (
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
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0" title="Delete"
                aria-label={`Delete ${doc.document_name}`}
                onClick={() => { if (confirm('Delete this document?')) deleteMutation.mutate(doc.id) }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
