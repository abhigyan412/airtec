'use client'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CheckCircle2, Eye, Loader2, NotebookPen, Upload, Users2 } from 'lucide-react'
import { toast } from 'sonner'
import { teacherApi, homeworkApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface HomeworkItem {
  id: string
  title: string
  subject_name: string
  type: string
  assignment_type: string
  assigned_date: string
  due_date: string | null
  student_count: number
  submitted_count: number | null
  graded_count: number | null
  pending_count: number | null
}

interface Group {
  class_id: string
  class_name: string
  section_id: string
  section_name: string
  items: HomeworkItem[]
}

// Everything this teacher has assigned, grouped by class/section — reached
// via the "Grading" tab (frontend/app/(app)/homework/layout.tsx) and also
// still the destination behind clicking "Homework Assigned" on the teacher
// dashboard, which only ever shows a single rolled-up count. Scoped
// server-side to created_by = the logged-in teacher (see GET
// /teacher/homework-overview).
export default function HomeworkAssignedPage() {
  const [gradingId, setGradingId] = useState<string | null>(null)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['teacher-homework-overview'],
    queryFn: () => teacherApi.homeworkOverview().then(r => r.data.groups as Group[]),
  })
  const groups = data ?? []
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grading"
        description={totalItems > 0 ? `${totalItems} item${totalItems > 1 ? 's' : ''} across ${groups.length} section${groups.length > 1 ? 's' : ''}` : 'Class-wise and section-wise breakdown of what you’ve assigned'}
        icon={NotebookPen}
      />

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        // Distinct from "haven't assigned anything yet" on purpose — a
        // failed request (permission, network, server error) used to
        // render as the exact same empty state below, which read as "you
        // have no homework" when the real problem was the request never
        // succeeded at all.
        <Card>
          <EmptyState icon={NotebookPen} title="Couldn't load your assigned homework"
            description={(error as any)?.response?.data?.error ?? 'Something went wrong loading this — try refreshing.'} className="py-14" />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={NotebookPen} title="You haven't assigned any homework yet" description="Homework you assign will show up here, grouped by class and section." className="py-14" />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <Card key={`${g.class_id}::${g.section_id}`}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-muted-foreground" /> {g.class_name} {g.section_name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">{g.items.length} item{g.items.length > 1 ? 's' : ''}</span>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {g.items.map(item => {
                    // Tracked = has homework_students rows at all — since
                    // plan.md Phase 1, that's every item created after the
                    // migration, whole-class included, not just
                    // 'individual'. Older items with no rows yet still fall
                    // back to the plain roster count.
                    const tracked = item.submitted_count !== null
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!tracked}
                        onClick={() => tracked && setGradingId(item.id)}
                        className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left first:pt-0 last:pb-0 disabled:cursor-default"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{item.title}</p>
                            <Badge variant="secondary" className="font-normal">{item.subject_name}</Badge>
                            {item.type === 'classwork' && <Badge variant="info" className="font-normal">Classwork</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Assigned {formatDate(item.assigned_date)}{item.due_date ? ` · Due ${formatDate(item.due_date)}` : ''}
                          </p>
                        </div>

                        {tracked ? (
                          <div className="flex shrink-0 items-center gap-3 text-right">
                            <div>
                              <p className="text-xs text-muted-foreground">Submitted</p>
                              <p className="text-sm font-semibold text-foreground">{item.submitted_count}/{item.student_count}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Graded</p>
                              <p className="text-sm font-semibold text-foreground">{item.graded_count}/{item.student_count}</p>
                            </div>
                            {(item.pending_count ?? 0) > 0 && (
                              <Badge variant="warning">{item.pending_count} pending</Badge>
                            )}
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ) : (
                          <p className="shrink-0 text-xs text-muted-foreground">Assigned to whole section · {item.student_count} students</p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {gradingId && (
        <GradeModal homeworkId={gradingId} onClose={() => setGradingId(null)} />
      )}
    </div>
  )
}

// plan.md Phase 2 — the roster + grading UI. Sits behind the click on a
// tracked item above, rather than its own route, since this list already
// had "click through for detail" as its whole reason to exist.
function GradeModal({ homeworkId, onClose }: { homeworkId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['homework-roster', homeworkId],
    queryFn: () => homeworkApi.roster(homeworkId).then(r => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['homework-roster', homeworkId] })
    qc.invalidateQueries({ queryKey: ['teacher-homework-overview'] })
  }

  const pendingCount = (data?.students ?? []).filter((r: any) => r.status === 'assigned').length
  const dueDate = data?.homework?.due_date as string | undefined
  const isOverdue = (row: any) => row.status === 'assigned' && !!dueDate && dueDate < new Date().toISOString().slice(0, 10)

  const remindMutation = useMutation({
    mutationFn: () => homeworkApi.remind(homeworkId),
    onSuccess: (res: any) => toast.success(res?.data?.reminded ? `Reminded ${res.data.reminded} student${res.data.reminded > 1 ? 's' : ''}` : 'Everyone has already submitted'),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to send reminders'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span>{data?.homework?.title ?? 'Homework'}</span>
            {pendingCount > 0 && (
              <Button size="sm" variant="outline" disabled={remindMutation.isPending} onClick={() => remindMutation.mutate()}>
                {remindMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                Remind {pendingCount} unsubmitted
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {(data?.students ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No students on this assignment yet.</p>
            ) : (
              (data.students as any[]).map(row => (
                <GradeRow key={row.id ?? row.student_id} row={row} homeworkId={homeworkId} overdue={isOverdue(row)} onGraded={invalidate} />
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GradeRow({ row, homeworkId, overdue, onGraded }: { row: any; homeworkId: string; overdue: boolean; onGraded: () => void }) {
  const student = row.students
  const [editing, setEditing] = useState(false)
  const [marks, setMarks] = useState(row.marks_obtained ?? '')
  const [maxMarks, setMaxMarks] = useState(row.max_marks ?? '')
  const [feedback, setFeedback] = useState(row.feedback ?? '')

  const [markingSubmitted, setMarkingSubmitted] = useState(false)
  const [submissionNote, setSubmissionNote] = useState('')
  const [submissionFile, setSubmissionFile] = useState<File | null>(null)
  const submissionFileRef = useRef<HTMLInputElement>(null)

  // Staff recording a submission on a student's behalf — a paper hand-in,
  // or anything else that never went through the portal — was already a
  // real backend endpoint (POST .../students/:studentId/submit) with no UI
  // action calling it. Without this, the only way to move a student off
  // "Pending" was to grade them directly, which also works but skips
  // recording that anything was actually handed in (no submitted_at,
  // no is_late, no submission_text/file on record).
  const submitMutation = useMutation({
    mutationFn: async () => {
      const fileFields = submissionFile
        ? {
            file_base64: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(submissionFile)
            }),
            file_name: submissionFile.name,
            mime_type: submissionFile.type,
          }
        : {}
      return homeworkApi.submitForStudent(homeworkId, row.student_id, {
        submission_text: submissionNote.trim() || undefined, ...fileFields,
      })
    },
    onSuccess: () => {
      toast.success('Marked as submitted')
      setMarkingSubmitted(false)
      setSubmissionNote('')
      setSubmissionFile(null)
      onGraded()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record submission'),
  })

  const gradeMutation = useMutation({
    mutationFn: () => homeworkApi.grade(homeworkId, row.student_id, {
      marks_obtained: marks === '' ? null : Number(marks),
      max_marks: maxMarks === '' ? null : Number(maxMarks),
      feedback: feedback || null,
    }),
    onSuccess: () => {
      toast.success('Graded')
      setEditing(false)
      onGraded()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to grade'),
  })

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {student?.first_name} {student?.last_name}
            {student?.roll_number && <span className="ml-1.5 text-xs text-muted-foreground">#{student.roll_number}</span>}
          </p>
          {row.submitted_at && (
            <p className="text-xs text-muted-foreground">Submitted {formatDate(row.submitted_at)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {row.is_late && (row.status === 'submitted' || row.status === 'graded') && (
            <Badge variant="destructive">Late</Badge>
          )}
          {row.status === 'graded' ? (
            <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Graded</Badge>
          ) : row.status === 'submitted' ? (
            <Badge variant="secondary">Submitted</Badge>
          ) : overdue ? (
            <Badge variant="destructive">Overdue</Badge>
          ) : (
            <Badge variant="warning">Pending</Badge>
          )}
        </div>
      </div>

      {(row.submission_text || row.submission_file_url) && (
        <div className="mt-2 rounded-md bg-muted/50 p-2 text-sm text-foreground">
          {row.submission_text && <p className="whitespace-pre-wrap">{row.submission_text}</p>}
          {row.submission_file_url && (
            <a href={row.submission_file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              View attached file
            </a>
          )}
        </div>
      )}

      {row.status === 'assigned' && (
        markingSubmitted ? (
          <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-2">
            <Input value={submissionNote} onChange={e => setSubmissionNote(e.target.value)} placeholder="e.g. Handed in on paper" className="h-8 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              <input ref={submissionFileRef} type="file" className="hidden" onChange={e => setSubmissionFile(e.target.files?.[0] ?? null)} />
              <Button type="button" size="sm" variant="outline" onClick={() => submissionFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {submissionFile ? submissionFile.name : 'Attach file'}
              </Button>
              <Button size="sm" disabled={submitMutation.isPending || (!submissionNote.trim() && !submissionFile)} onClick={() => submitMutation.mutate()}>
                {submitMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMarkingSubmitted(false); setSubmissionNote(''); setSubmissionFile(null) }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setMarkingSubmitted(true)}>
            Mark as submitted
          </Button>
        )
      )}

      {row.status === 'graded' && !editing ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            {row.marks_obtained != null && row.max_marks != null ? `${row.marks_obtained}/${row.max_marks} — ` : ''}
            {row.feedback}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Input className="w-20" type="number" placeholder="Marks" value={marks} onChange={e => setMarks(e.target.value)} />
            <span className="text-muted-foreground">/</span>
            <Input className="w-20" type="number" placeholder="Max" value={maxMarks} onChange={e => setMaxMarks(e.target.value)} />
          </div>
          <Textarea rows={2} placeholder="Feedback (optional)" value={feedback} onChange={e => setFeedback(e.target.value)} />
          <Button size="sm" disabled={gradeMutation.isPending || (marks === '' && !feedback)} onClick={() => gradeMutation.mutate()}>
            {gradeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save grade
          </Button>
        </div>
      )}
    </div>
  )
}
