'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CalendarRange, Printer, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Label } from '@/components/ui/label'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { DatesheetGrid } from '@/components/exams/DatesheetGrid'
import { DatesheetPrintSheet } from '@/components/exams/DatesheetPrintSheet'

// A standalone, read-only version of the Datesheet tab on an exam's own
// detail page — pick any exam, see its schedule, print it. No edit
// affordance here (that stays on /exams/:id, where a click opens
// EditSubjectModal); this page exists for someone who just wants to look
// something up or hand out a printed copy without navigating into a
// specific exam first.
export default function DatesheetViewerPage() {
  const searchParams = useSearchParams()
  const [examId, setExamId] = useState(searchParams.get('exam') ?? '')
  // A link into this page (e.g. from the exams list) only changes ?exam=
  // via client-side navigation — this component stays mounted, so the
  // useState initializer above never sees a later URL's exam id on its own.
  useEffect(() => {
    const urlExam = searchParams.get('exam')
    if (urlExam && urlExam !== examId) setExamId(urlExam)
  }, [searchParams])

  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get('/exams').then(r => r.data.data),
  })

  const sortedExams = [...(exams ?? [])].sort((a: any, b: any) => {
    const ad = a.start_date ?? a.created_at ?? ''
    const bd = b.start_date ?? b.created_at ?? ''
    return bd.localeCompare(ad)
  })

  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get(`/exams/${examId}`).then(r => r.data.data),
    enabled: !!examId,
  })

  const examSubjects: any[] = exam?.exam_subjects ?? []

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="print:hidden">
        <PageHeader
          title="Datesheet Viewer"
          description="Pick an exam to see its full class-by-date schedule"
          icon={CalendarRange}
          actions={
            <Button variant="outline" onClick={() => window.print()} disabled={!examSubjects.length}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          }
        />
      </div>

      <div className="print:hidden space-y-6">
        <Card className="p-5">
          <div className="max-w-sm space-y-1.5">
            <Label>Exam</Label>
            {examsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={examId || undefined} onValueChange={setExamId}>
                <SelectTrigger><SelectValue placeholder="Select exam..." /></SelectTrigger>
                <SelectContent>
                  {sortedExams.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </Card>

        {!examId ? (
          <Card>
            <EmptyState icon={CalendarRange} title="Pick an exam to view its datesheet" description="Choose an exam above to see which subjects are scheduled on which date, class by class." />
          </Card>
        ) : examLoading ? (
          <Card className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </Card>
        ) : !examSubjects.length ? (
          <Card>
            <EmptyState icon={FileText} title="No subjects scheduled yet" description="This exam has no subjects added to its datesheet." />
          </Card>
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <h3 className="font-semibold text-foreground">{exam.name} — Exam Schedule</h3>
            </div>
            <DatesheetGrid examSubjects={examSubjects} />
          </Card>
        )}
      </div>

      {examSubjects.length > 0 && <DatesheetPrintSheet examSubjects={examSubjects} examName={exam?.name} />}
    </div>
  )
}
