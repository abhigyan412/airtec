'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, documentsApi } from '@/lib/api'
import { ResultStatusBadge } from '@/components/exams/ResultStatusBadge'
import { TermResultsBrowser } from '@/components/exams/TermResultsBrowser'
import { ArrowLeft, BarChart2, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Label } from '@/components/ui/label'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// A dedicated results lookup — the Results tab on an exam's own detail
// page always shows every class/section flattened together with just a
// collapsible grouping; this is the direct "pick an exam, narrow to one
// class or section" path, one level deeper than that grouping ever goes.
export default function ExamResultsPage() {
  const searchParams = useSearchParams()
  const initialMode = searchParams.get('mode')
  const [mode, setMode] = useState<'exam' | 'term'>(initialMode === 'term' ? 'term' : 'exam')
  // A link into this page (e.g. result-settings' redirect after bulk-
  // creating Terms) only changes ?mode= via client-side navigation — this
  // component stays mounted, so the useState initializer above never sees
  // a later URL's mode on its own.
  useEffect(() => {
    const urlMode = searchParams.get('mode')
    if (urlMode === 'term' && mode !== 'term') setMode('term')
    else if (urlMode === 'exam' && mode !== 'exam') setMode('exam')
  }, [searchParams])
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')

  const { data: exams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get('/exams').then(r => r.data.data),
  })

  // Sections come from the school's full class list (a class's sections
  // don't vary per exam), but which CLASSES are even choosable has to be
  // scoped to this exam's own datesheet — same fix as Marks Entry's class
  // picker: an exam only ever covers some of the school's classes, so
  // listing every class here just means picking most of them shows "no
  // results" for a class this exam was never scheduled against.
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })

  const { data: exam } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get(`/exams/${examId}`).then(r => r.data.data),
    enabled: !!examId,
  })
  const examClasses = Array.from(
    new Map((exam?.exam_subjects ?? []).map((s: any) => [s.class_id, { id: s.class_id, name: s.classes?.name }])).values()
  ).filter((c: any) => c.id)

  const selectedClass = (classes ?? []).find((c: any) => c.id === classId)
  const sections = selectedClass?.sections ?? []

  const { data: results, isLoading } = useQuery({
    queryKey: ['exam-results-filtered', examId, classId, sectionId],
    queryFn: () => api.get(`/exams/${examId}/results`, {
      params: { class_id: classId || undefined, section_id: sectionId || undefined },
    }).then(r => r.data.data),
    enabled: !!examId,
  })

  const rows = results ?? []
  const pass = rows.filter((r: any) => r.is_pass).length
  const fail = rows.length - pass
  const avgPct = rows.length ? Math.round((rows.reduce((s: number, r: any) => s + Number(r.percentage), 0) / rows.length) * 10) / 10 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/exams" aria-label="Back to exams"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Results"
          description="Pick an exam, then narrow to a class or section to browse report cards"
          icon={BarChart2}
        />
      </div>

      <div className="flex w-fit items-center gap-1 rounded-xl bg-muted p-1">
        {(['exam', 'term'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${mode === m ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {m === 'exam' ? 'Single Exam' : 'Composite Term'}
          </button>
        ))}
      </div>

      {mode === 'term' && <TermResultsBrowser />}

      {mode === 'exam' && (
      <>
      <Card className="flex flex-wrap items-end gap-4 p-5">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label>Exam</Label>
          <Select value={examId || undefined} onValueChange={v => { setExamId(v); setClassId(''); setSectionId('') }}>
            <SelectTrigger><SelectValue placeholder="Select exam..." /></SelectTrigger>
            <SelectContent>
              {(exams ?? []).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {examId && (
            <Link href={`/exams/${examId}?tab=Results`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              View full exam <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
        <div className="min-w-[160px] space-y-1.5">
          <Label>Class</Label>
          <Select value={classId || 'all'} disabled={!examId} onValueChange={v => { setClassId(v === 'all' ? '' : v); setSectionId('') }}>
            <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {examClasses.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sections.length > 0 && (
          <div className="min-w-[160px] space-y-1.5">
            <Label>Section</Label>
            <Select value={sectionId || 'all'} onValueChange={v => setSectionId(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="All sections" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      {!examId ? (
        <Card>
          <EmptyState icon={BarChart2} title="Pick an exam to view results" description="Choose an exam above — narrow further by class or section once it's picked." />
        </Card>
      ) : isLoading ? (
        <Card className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart2} title="No results for this filter" description="Either results haven't been generated for this exam yet, or nobody matches the class/section filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-4">
            <h3 className="font-semibold text-foreground">{rows.length} student{rows.length !== 1 ? 's' : ''}</h3>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>Avg {avgPct}%</span>
              <Badge variant="success">{pass} pass</Badge>
              {fail > 0 && <Badge variant="destructive">{fail} fail</Badge>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Rank</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Pct</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((rc: any) => (
                  <TableRow key={rc.id} className="cursor-default">
                    <TableCell className="font-bold text-primary">#{rc.rank}</TableCell>
                    <TableCell className="font-medium text-foreground">{rc.students?.first_name} {rc.students?.last_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rc.students?.classes?.name}{rc.students?.sections?.name ? ` · ${rc.students.sections.name}` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {rc.obtained_marks}/{rc.total_marks}
                      {Number(rc.grace_marks_applied_total) > 0 && (
                        <span className="ml-1.5 text-xs text-info" title="Grace marks applied">+{rc.grace_marks_applied_total} grace</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">
                      {rc.percentage}%{rc.overall_cgpa != null && <span className="ml-1 text-xs font-normal text-muted-foreground">· {rc.overall_cgpa} CGPA</span>}
                    </TableCell>
                    <TableCell>
                      {rc.grade ? (
                        <Badge variant={
                          ['A+', 'A', 'A1', 'A2'].includes(rc.grade) ? 'success' :
                          ['B+', 'B', 'B1', 'B2'].includes(rc.grade) ? 'info' :
                          ['C', 'C1', 'C2'].includes(rc.grade) ? 'warning' : 'destructive'}>
                          {rc.grade}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <ResultStatusBadge status={rc.result_status} isPass={rc.is_pass} />
                    </TableCell>
                    <TableCell>
                      <a href={documentsApi.reportCard(rc.exam_id, rc.student_id)}
                        target="_blank" rel="noreferrer"
                        className="text-xs font-medium text-primary hover:text-primary/80">
                        View Card
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  )
}
