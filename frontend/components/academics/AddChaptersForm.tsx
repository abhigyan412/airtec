'use client'
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { syllabusApi, api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, Loader2, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

export const EXAM_TYPE_LABELS: Record<string, string> = {
  unit_test: 'Unit Test', monthly: 'Monthly Test', half_yearly: 'Half Yearly', annual: 'Annual Exam',
  pre_board: 'Pre-Board', practical: 'Practical', other: 'Exam',
}

type ChapterFormRow = { chapter_name: string; due_mode: 'exam' | 'custom'; exam_id: string; planned_date: string }

// Shared between Syllabus's Due Dates page (day-to-day chapter planning)
// and Organizational Settings' Syllabus Setup (bulk initial definition) —
// a real 2-consumer extraction, same reasoning as AddHomeworkModal and
// useClassPicker earlier this session. Chapter name entry, three ways:
// type a row at a time, import names from an .xlsx (chapter names only —
// see backend POST /academics/syllabus/import-chapters), or both mixed
// in the same batch before saving.
export function AddChaptersForm({ classId, sectionId, subjectName, onSaved }: {
  classId: string; sectionId: string; subjectName: string; onSaved: () => void
}) {
  const [rows, setRows] = useState<ChapterFormRow[]>([{ chapter_name: '', due_mode: 'custom', exam_id: '', planned_date: '' }])
  const [loading, setLoading] = useState(false)

  // The chapter's due date should track the school's real exam calendar
  // (Unit Test 1 -> Half Yearly -> ...) rather than a hand-typed date with
  // no anchor — pick an exam here, or fall back to a custom date.
  const { data: exams } = useQuery({
    queryKey: ['exams-for-syllabus'],
    queryFn: () => api.get('/exams', { params: { limit: 100 } }).then(r => r.data.data as any[]),
  })
  const sortedExams = useMemo(() => [...(exams ?? [])].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '')), [exams])

  const updateRow = (i: number, patch: Partial<ChapterFormRow>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Fills in chapter names from a spreadsheet the school already has,
  // instead of typing each one by hand — nothing is saved by this step,
  // it only fills in these same rows for review, same as typing would.
  // Due dates stay a manual per-row choice (exam-linked or custom); the
  // import only ever touches names.
  const handleImportFile = async (file: File) => {
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const CHUNK = 8192
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
      }
      const base64 = btoa(binary)
      const res = await syllabusApi.importChapters(base64)
      const names = (res.data.chapter_names ?? []) as string[]
      const imported: ChapterFormRow[] = names.map(name => ({ chapter_name: name, due_mode: 'custom', exam_id: '', planned_date: '' }))
      setRows(prev => (prev.length === 1 && !prev[0].chapter_name.trim()) ? imported : [...prev, ...imported])
      toast.success(`Imported ${names.length} chapter${names.length > 1 ? 's' : ''} — review before saving`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to import that file')
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const handleSave = async () => {
    const valid = rows.filter(r => r.chapter_name.trim())
    if (!valid.length) return toast.error('Add at least one chapter')
    if (!subjectName) return toast.error('Pick a subject first')
    setLoading(true)
    try {
      await syllabusApi.createChapters({
        class_id: classId, section_id: sectionId || undefined, subject_name: subjectName,
        chapters: valid.map((r, i) => ({
          chapter_number: i + 1, chapter_name: r.chapter_name.trim(),
          exam_id: r.due_mode === 'exam' ? (r.exam_id || undefined) : undefined,
          planned_date: r.due_mode === 'custom' ? (r.planned_date || undefined) : undefined,
        })),
      })
      toast.success('Chapters added')
      setRows([{ chapter_name: '', due_mode: 'custom', exam_id: '', planned_date: '' }])
      onSaved()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add chapters')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Add chapters</h3>
          <p className="mt-1 text-xs text-muted-foreground">Tie each chapter to the exam it needs to be covered before, or set a custom date — teachers mark them covered as they go.</p>
        </div>
        <input ref={importInputRef} type="file" className="hidden"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f) }} />
        <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={importing}
          onClick={() => importInputRef.current?.click()}
          title="One chapter name per row, in the first column, below a header row">
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          Import from Excel
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="flex-1">Chapter</Label>
          <Label className="w-40">Due before</Label>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="flex-1" value={row.chapter_name} placeholder={`Chapter ${i + 1} name`}
              onChange={e => updateRow(i, { chapter_name: e.target.value })} />
            <Select
              value={row.due_mode === 'custom' ? 'custom' : (row.exam_id || 'none')}
              onValueChange={v => v === 'custom' ? updateRow(i, { due_mode: 'custom', exam_id: '' }) : updateRow(i, { due_mode: 'exam', exam_id: v === 'none' ? '' : v })}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No due date</SelectItem>
                {sortedExams.map(ex => (
                  <SelectItem key={ex.id} value={ex.id}>
                    {EXAM_TYPE_LABELS[ex.exam_type] ?? ex.exam_type} — {ex.name}{ex.start_date ? ` (${formatDate(ex.start_date)})` : ''}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom date...</SelectItem>
              </SelectContent>
            </Select>
            {row.due_mode === 'custom' && (
              <Input type="date" className="w-36" value={row.planned_date} onChange={e => updateRow(i, { planned_date: e.target.value })} />
            )}
          </div>
        ))}
        <button onClick={() => setRows(rs => [...rs, { chapter_name: '', due_mode: 'custom', exam_id: '', planned_date: '' }])}
          className="-ml-2 flex h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-primary transition-colors hover:bg-accent hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Plus className="w-3 h-3" /> Add another chapter
        </button>
      </div>

      <Button onClick={handleSave} disabled={loading} className="w-full">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save Chapters
      </Button>
    </div>
  )
}
