'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Loader2, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

// Small hand-rolled CSV helpers, entirely client-side — this modal's
// data is already loaded in the browser, so round-tripping it through
// the backend would just be extra latency for no benefit. Matches this
// codebase's existing zero-dependency convention for CSV
// (backend/src/shared/utils/csv.ts) rather than pulling in a library for
// a handful of columns. A UTF-8 BOM is included so Excel opens the file
// correctly rather than guessing the wrong encoding.
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function buildDatesCsv(templateSubjects: any[]): string {
  const header = ['Row Id', 'Subject', 'Class', 'Time Slot', 'Theory Date (YYYY-MM-DD)', 'Practical Date (YYYY-MM-DD)']
  const lines = [header.map(csvCell).join(',')]
  for (const ts of templateSubjects) {
    const timeSlot = ts.exam_time_slots ? `${ts.exam_time_slots.name} ${ts.exam_time_slots.start_time?.slice(0, 5)}-${ts.exam_time_slots.end_time?.slice(0, 5)}` : ''
    lines.push([ts.id, ts.subject_name, ts.classes?.name ?? '', timeSlot, '', ''].map((v: string) => csvCell(String(v))).join(','))
  }
  const BOM = String.fromCharCode(0xFEFF)
  return BOM + lines.join('\r\n')
}

// Minimal RFC4180 parser — handles quoted fields with embedded commas/
// quotes/newlines, which a name like `Games, Sports` (unlikely but
// possible) could otherwise break on a naive split(',').
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false } }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Turns a blueprint (Exam Templates) into a real exam + fully-built
// datesheet in one submit — only per-subject dates need touching,
// everything else (class, subject, time slot, marks) is inherited from
// the template as-is. Shared between Examination Settings' own Exam
// Templates list and the main Examinations page's "New from Template"
// action, rather than duplicated across both.
export function ApplyTemplateModal({ initialTemplateId, onClose }: { initialTemplateId?: string; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [practicalDates, setPracticalDates] = useState<Record<string, string>>({})

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['exam-templates'],
    queryFn: () => api.get('/exams/templates').then(r => r.data.data),
  })

  const template = (templates ?? []).find((t: any) => t.id === templateId)
  const templateSubjects = template?.exam_template_subjects ?? []
  // A template generated across many classes can easily carry hundreds
  // of subject rows — a table scans and scrolls far better at that scale
  // than a stack of bordered cards. Practical Date only gets its own
  // column when the template actually has a split subject somewhere.
  const anySplit = templateSubjects.some((ts: any) => ts.theory_max_marks != null && ts.practical_max_marks != null)

  useEffect(() => {
    if (template && !name) setName(template.name)
  }, [template, name])

  const mutation = useMutation({
    mutationFn: () => api.post(`/exams/templates/${templateId}/apply`, {
      name, start_date: startDate || undefined, end_date: endDate || undefined,
      subjects: templateSubjects.map((ts: any) => ({
        template_subject_id: ts.id,
        exam_date: dates[ts.id] || undefined,
        practical_exam_date: practicalDates[ts.id] || undefined,
      })),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['exams'] })
      qc.invalidateQueries({ queryKey: ['exam-stats'] })
      toast.success('Exam created from template!')
      onClose()
      router.push(`/exams/${res.data.data.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply template'),
  })

  const handleDownloadCsv = () => {
    const csv = buildDatesCsv(templateSubjects)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(template?.name || 'datesheet').replace(/[^a-z0-9]+/gi, '-')}-dates.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Matches rows back to their subject purely by the Row Id column (the
  // template_subject_id) — never by Subject/Class text, which someone
  // could reformat or translate in Excel without meaning to break the
  // import. Any row with dates that don't parse as YYYY-MM-DD, or whose
  // Row Id no longer matches a real row in this template, is skipped
  // rather than guessed at.
  const handleImportCsv = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result ?? '')
      const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
      const rows = parseCsv(text)
      if (rows.length < 2) { toast.error('That file has no data rows to import.'); return }
      const validIds = new Set(templateSubjects.map((ts: any) => ts.id))
      const newDates: Record<string, string> = {}
      const newPracticalDates: Record<string, string> = {}
      let filled = 0, skipped = 0
      for (const r of rows.slice(1)) {
        const [id, , , , theoryDate, practicalDate] = r
        if (!id || !validIds.has(id)) { skipped++; continue }
        let matched = false
        if (theoryDate && DATE_RE.test(theoryDate.trim())) { newDates[id] = theoryDate.trim(); matched = true }
        if (practicalDate && DATE_RE.test(practicalDate.trim())) { newPracticalDates[id] = practicalDate.trim(); matched = true }
        if (matched) filled++
      }
      setDates(d => ({ ...d, ...newDates }))
      setPracticalDates(d => ({ ...d, ...newPracticalDates }))
      toast.success(`Imported dates for ${filled} subject${filled === 1 ? '' : 's'}${skipped ? ` — ${skipped} row${skipped === 1 ? '' : 's'} skipped (not from this template)` : ''}.`)
    }
    reader.onerror = () => toast.error('Could not read that file.')
    reader.readAsText(file)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>New Exam from Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Template *</Label>
            <Select value={templateId || undefined} disabled={templatesLoading} onValueChange={v => { setTemplateId(v); setName(''); setDates({}); setPracticalDates({}) }}>
              <SelectTrigger><SelectValue placeholder={templatesLoading ? 'Loading...' : 'Select template...'} /></SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!templatesLoading && (templates ?? []).length === 0 && (
              <p className="mt-1.5 text-xs text-warning">No templates yet — create one first.</p>
            )}
          </div>

          {template && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="apply-name">Exam Name *</Label>
                  <Input id="apply-name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-start">Start Date</Label>
                  <Input id="apply-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-end">End Date</Label>
                  <Input id="apply-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Subjects — set each date <span className="font-normal text-muted-foreground">({templateSubjects.length})</span></Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleDownloadCsv}>
                      <Download className="h-3.5 w-3.5" /> Download CSV
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> Import CSV
                    </Button>
                    <input
                      ref={fileInputRef} type="file" accept=".csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleImportCsv(f); e.target.value = '' }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Download, fill in dates in Excel (YYYY-MM-DD) or leave blank, save as CSV, then Import — much faster than {templateSubjects.length} date fields one at a time.
                </p>
                <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Subject</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Time Slot</TableHead>
                        <TableHead>{anySplit ? 'Theory Date' : 'Date'}</TableHead>
                        {anySplit && <TableHead>Practical Date</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templateSubjects.map((ts: any) => {
                        const isSplit = ts.theory_max_marks != null && ts.practical_max_marks != null
                        return (
                          <TableRow key={ts.id} className="cursor-default">
                            <TableCell className="font-medium text-foreground">{ts.subject_name}</TableCell>
                            <TableCell className="text-muted-foreground">{ts.classes?.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {ts.exam_time_slots ? `${ts.exam_time_slots.name} · ${ts.exam_time_slots.start_time?.slice(0, 5)}–${ts.exam_time_slots.end_time?.slice(0, 5)}` : '—'}
                            </TableCell>
                            <TableCell>
                              <Input type="date" className="h-8 w-auto" value={dates[ts.id] ?? ''}
                                onChange={e => setDates(d => ({ ...d, [ts.id]: e.target.value }))} />
                            </TableCell>
                            {anySplit && (
                              <TableCell>
                                {isSplit ? (
                                  <Input type="date" className="h-8 w-auto" value={practicalDates[ts.id] ?? ''}
                                    onChange={e => setPracticalDates(d => ({ ...d, [ts.id]: e.target.value }))} />
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!template || !name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
