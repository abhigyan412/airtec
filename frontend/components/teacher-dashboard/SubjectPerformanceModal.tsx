'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardX } from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'

interface SubjectPerformanceData {
  section_name: string
  class_name: string
  subject_name: string
  exams: {
    exam_subject_id: string
    exam_name: string
    exam_date: string
    max_marks: number
    class_average_pct: number | null
    students: {
      student_id: string
      first_name: string
      last_name: string
      admission_number: string
      marks_obtained: number | null
      max_marks: number
      percentage: number | null
      is_absent: boolean
      grade: string | null
    }[]
  }[]
}

export function SubjectPerformanceModal({ sectionId, subjectId, onClose }: { sectionId: string; subjectId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-subject-performance', sectionId, subjectId],
    queryFn: () => teacherApi.subjectPerformance(sectionId, subjectId).then(r => r.data as SubjectPerformanceData),
  })

  const [examId, setExamId] = useState<string>('')
  useEffect(() => {
    if (data?.exams?.length && !examId) setExamId(data.exams[0].exam_subject_id)
  }, [data, examId])

  const exam = data?.exams.find(e => e.exam_subject_id === examId)

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.class_name} ${data.section_name} — ${data.subject_name}` : 'Subject Performance'}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data?.exams.length ? (
          <EmptyState icon={ClipboardX} title="No tests recorded yet for this subject" className="py-10" />
        ) : (
          <div className="space-y-4">
            <Select value={examId} onValueChange={setExamId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.exams.map(e => (
                  <SelectItem key={e.exam_subject_id} value={e.exam_subject_id}>
                    {e.exam_name} — {formatDate(e.exam_date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {exam && (
              <>
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">Class average</span>
                  <span className="text-sm font-bold text-foreground">
                    {exam.class_average_pct != null ? `${exam.class_average_pct}%` : '—'} <span className="font-normal text-muted-foreground">(out of {exam.max_marks})</span>
                  </span>
                </div>

                <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-medium">Student</th>
                        <th className="px-3 py-2 text-right font-medium">Marks</th>
                        <th className="px-3 py-2 text-right font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {exam.students.map(s => (
                        <tr key={s.student_id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-foreground">{s.first_name} {s.last_name}</p>
                            <p className="text-xs text-muted-foreground">{s.admission_number}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-foreground">
                            {s.is_absent ? <Badge variant="destructive">Absent</Badge> : s.marks_obtained != null ? `${s.marks_obtained}/${s.max_marks}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-foreground">
                            {s.percentage != null ? `${s.percentage}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
