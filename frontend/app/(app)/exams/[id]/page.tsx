'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { api, admitCardApi, documentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Upload, BarChart2, Loader2, CheckCircle, FileText, GitBranch, Check, X, MessageSquare, Snowflake, Eye, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/shared/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const TABS = ['Datesheet', 'Marks Entry', 'Results']

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  draft: 'secondary',
  published: 'info',
  ongoing: 'warning',
  completed: 'default',
  result_declared: 'success',
  result_frozen: 'info',
  result_verified: 'default',
  result_published: 'success',
}

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState('Datesheet')
  const [showAddSubject, setShowAddSubject] = useState(false)
  const qc = useQueryClient()

  const { data: exam, isLoading } = useQuery({
    queryKey: ['exam', id],
    queryFn: () => api.get(`/exams/${id}`).then(r => r.data.data),
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })

  const generateResults = useMutation({
    mutationFn: () => api.post(`/exams/${id}/generate-results`, {}),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['exam', id] })
      toast.success(`Results generated for ${r.data.data.report_cards_generated} students!`)
      setTab('Results')
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to generate results')
    },
  })

  if (isLoading) {
    return <div className="p-12 text-center text-muted-foreground">Loading exam...</div>
  }

  if (!exam) {
    return <div className="p-12 text-center text-muted-foreground">Exam not found</div>
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to exams">
          <Link href="/exams">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{exam.name}</h1>
            <Badge variant={STATUS_VARIANT[exam.status] ?? 'secondary'} className="capitalize">
              {exam.status?.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm capitalize text-muted-foreground">
            {exam.exam_type?.replace('_', ' ')} · {exam.academic_years?.name}
            {exam.start_date && ` · ${formatDate(exam.start_date)}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <a href={admitCardApi.bulk(id)} target="_blank" rel="noreferrer">
              Bulk Admit Cards
            </a>
          </Button>
          {(exam.status === 'completed' || exam.status === 'ongoing') && (
            <Button
              onClick={() => generateResults.mutate()}
              disabled={generateResults.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {generateResults.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <BarChart2 className="h-4 w-4" />
              }
              Generate Results
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map(t => (
            <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="Datesheet" className="mt-6">
          <Card>
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="font-semibold text-foreground">Exam Schedule</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowAddSubject(true)}>
                <Plus className="h-4 w-4" /> Add Subject
              </Button>
            </div>
            {!(exam.exam_subjects ?? []).length ? (
              <EmptyState
                icon={FileText}
                title="No subjects added yet"
                description="Add subjects to build the datesheet"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Max Marks</TableHead>
                    <TableHead>Pass Marks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(exam.exam_subjects ?? []).map((sub: any) => (
                    <TableRow key={sub.id} className="cursor-default">
                      <TableCell className="font-medium text-foreground">{sub.subject_name}</TableCell>
                      <TableCell className="text-muted-foreground">{sub.classes?.name}</TableCell>
                      <TableCell className="text-muted-foreground">{sub.exam_date ? formatDate(sub.exam_date) : '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{sub.start_time ?? '-'}</TableCell>
                      <TableCell className="font-medium text-foreground">{sub.max_marks}</TableCell>
                      <TableCell className="text-muted-foreground">{sub.pass_marks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="Marks Entry" className="mt-6">
          <MarksEntry examId={id} exam={exam} classes={classes ?? []} />
        </TabsContent>

        <TabsContent value="Results" className="mt-6">
          <div className="space-y-6">
            <FreezePublishPipeline examId={id} exam={exam} />
            <ResultsView examId={id} />
          </div>
        </TabsContent>
      </Tabs>

      {showAddSubject && (
        <AddSubjectModal examId={id} classes={classes ?? []} onClose={() => {
          setShowAddSubject(false)
          qc.invalidateQueries({ queryKey: ['exam', id] })
        }} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RESULT FREEZE & PUBLISH WORKFLOW PIPELINE
// ═══════════════════════════════════════════════════════════════

const STEP_ICONS: Record<string, any> = {
  freeze: Snowflake,
  verify: Eye,
  publish: Megaphone,
}

const STEP_LABELS: Record<string, string> = {
  freeze: 'Freeze Results',
  verify: 'Verify Results',
  publish: 'Publish Results',
}

const RESULT_STATUSES = ['result_declared', 'result_frozen', 'result_verified', 'result_published']

function FreezePublishPipeline({ examId, exam }: { examId: string, exam: any }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['exam-workflow-status', examId],
    queryFn: () => api.get(`/exams/${examId}/workflow-status`).then(r => r.data.data),
    enabled: RESULT_STATUSES.includes(exam.status),
  })

  const startMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/start-freeze-workflow`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      toast.success('Freeze & publish workflow started')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to start workflow'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ status }: { status: 'approved' | 'rejected' | 'commented' }) =>
      api.post(`/exams/${examId}/workflow-action`, { status, notes: notes.trim() || undefined }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['exam-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      qc.invalidateQueries({ queryKey: ['results', examId] })
      if (r.data.data?.completed) {
        toast.success(r.data.data.instance.status === 'approved' ? 'Results published!' : 'Sent back for correction')
      } else {
        toast.success('Decision recorded')
      }
      setNotes('')
      setShowNotesFor(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  if (!RESULT_STATUSES.includes(exam.status)) {
    return null
  }

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </Card>
    )
  }

  if (!workflow) {
    const canStart = ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '')
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Result Freeze &amp; Publish</h3>
          </div>
          {canStart && (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Start Freeze Workflow
            </Button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Results have been generated but not yet sent for freeze/verify/publish. Start the workflow to send results through Exam Controller and Principal review before they become visible to students and parents.
        </p>
      </Card>
    )
  }

  const allSteps: any[] = workflow.all_steps ?? []
  const currentStep = workflow.current_step
  const approvals: any[] = workflow.approvals ?? []
  const status = workflow.status as 'in_progress' | 'approved' | 'rejected' | 'cancelled'

  const roleMap: Record<string, string> = {
    school_admin: 'School Admin',
    principal: 'Principal',
  }
  const canAct = status === 'in_progress' && currentStep && (
    user?.role === 'school_admin' ||
    roleMap[user?.role ?? ''] === currentStep.roles?.name ||
    (user?.role === 'teacher' && currentStep.roles?.name === 'Exam Controller')
  )

  const handleAction = (actionStatus: 'approved' | 'rejected' | 'commented') => {
    if (actionStatus === 'rejected' && !notes.trim()) {
      setShowNotesFor('rejected')
      return
    }
    actionMutation.mutate({ status: actionStatus })
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">{workflow.workflow_definitions?.name ?? 'Result Freeze & Publish'}</h3>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-center gap-1">
        {allSteps.map((step, idx) => {
          const approval = approvals.find((a: any) => a.workflow_steps?.step_order === step.step_order)
          let state: 'done' | 'current' | 'pending' | 'rejected'
          if (approval?.status === 'approved') state = 'done'
          else if (approval?.status === 'rejected') state = 'rejected'
          else if (currentStep && step.step_order === currentStep.step_order && status === 'in_progress') state = 'current'
          else state = 'pending'

          const Icon = STEP_ICONS[step.action_name] ?? GitBranch

          return (
            <div key={step.id} className="flex min-w-0 flex-1 items-center">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  state === 'done' && 'bg-success/15 text-success',
                  state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  state === 'pending' && 'bg-muted text-muted-foreground',
                  state === 'rejected' && 'bg-destructive/10 text-destructive')}>
                  {state === 'done' && <Check className="h-4 w-4" />}
                  {state === 'rejected' && <X className="h-4 w-4" />}
                  {(state === 'current' || state === 'pending') && <Icon className="h-4 w-4" />}
                </div>
                <div className="text-center">
                  <p className={cn('whitespace-nowrap text-xs font-semibold', state === 'pending' ? 'text-muted-foreground' : 'text-foreground')}>{step.roles?.name}</p>
                  <p className="whitespace-nowrap text-[10px] text-muted-foreground">{STEP_LABELS[step.action_name] ?? step.action_name}</p>
                </div>
              </div>
              {idx < allSteps.length - 1 && (
                <div className={cn('mx-2 mb-5 h-0.5 flex-1', state === 'done' ? 'bg-success/30' : 'bg-border')} />
              )}
            </div>
          )
        })}
      </div>

      {status === 'in_progress' && currentStep && (
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Waiting on <span className="font-semibold text-foreground">{currentStep.roles?.name}</span> to {STEP_LABELS[currentStep.action_name]?.toLowerCase() ?? currentStep.action_name}
          </p>

          {canAct ? (
            <div className="space-y-3">
              {showNotesFor && (
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={showNotesFor === 'rejected' ? 'Reason for sending back (required)...' : 'Add a note (optional)...'}
                  rows={2}
                  className="resize-none"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <Button onClick={() => handleAction('approved')} disabled={actionMutation.isPending}
                  className="bg-success text-success-foreground hover:bg-success/90">
                  {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {currentStep.action_name === 'publish' ? 'Publish' : currentStep.action_name === 'verify' ? 'Verify' : 'Freeze'}
                </Button>
                <Button variant="destructive" onClick={() => handleAction('rejected')} disabled={actionMutation.isPending}>
                  <X className="h-4 w-4" /> Send Back
                </Button>
                {showNotesFor !== 'commented' ? (
                  <Button variant="outline" onClick={() => setShowNotesFor('commented')}>
                    <MessageSquare className="h-4 w-4" /> Add Note
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => handleAction('commented')} disabled={actionMutation.isPending || !notes.trim()}>
                    Save Note
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              You don't have the {currentStep.roles?.name} role required for this step.
            </p>
          )}
        </div>
      )}

      {status !== 'in_progress' && (
        <div className="border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            {status === 'approved' && 'Results have been published and are now visible to students and parents.'}
            {status === 'rejected' && 'This workflow was rejected.'}
            {status === 'cancelled' && 'This workflow was cancelled.'}
          </p>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">History</p>
          <div className="space-y-3">
            {approvals.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  a.status === 'approved' ? 'bg-success/15 text-success' :
                  a.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                  'bg-muted text-muted-foreground')}>
                  {a.status === 'approved' && <Check className="h-3.5 w-3.5" />}
                  {a.status === 'rejected' && <X className="h-3.5 w-3.5" />}
                  {a.status === 'commented' && <MessageSquare className="h-3 w-3" />}
                </div>
                <div className="flex-1">
                  <p className="text-foreground">
                    <span className="font-semibold">{a.users?.full_name ?? 'System'}</span>
                    {' '}
                    <span className="text-muted-foreground">
                      {a.status === 'approved' && (a.workflow_steps?.action_name === 'publish' ? 'published results' : a.status)}
                      {a.status === 'rejected' && 'sent back'}
                      {a.status === 'commented' && 'commented'}
                      {' '}({a.workflow_steps?.roles?.name} · {STEP_LABELS[a.workflow_steps?.action_name] ?? a.workflow_steps?.action_name})
                    </span>
                  </p>
                  {a.notes && <p className="mt-0.5 text-muted-foreground">"{a.notes}"</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(a.acted_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string, variant: BadgeProps['variant'] }> = {
    in_progress: { label: 'In Progress', variant: 'warning' },
    approved: { label: 'Published', variant: 'success' },
    rejected: { label: 'Sent Back', variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
  }
  const c = config[status] ?? config.in_progress
  return <Badge variant={c.variant}>{c.label}</Badge>
}

function MarksEntry({ examId, exam, classes }: any) {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [marksData, setMarksData] = useState<Record<string, any>>({})
  const qc = useQueryClient()

  const subjectsForClass = (exam.exam_subjects ?? []).filter((s: any) => s.class_id === selectedClass)

  const { data: sheetData, isLoading } = useQuery({
    queryKey: ['marks-sheet', examId, selectedClass],
    queryFn: () => api.get(`/exams/${examId}/marks/${selectedClass}`).then(r => r.data.data),
    enabled: !!selectedClass,
  })

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/marks`, {
      exam_subject_id: selectedSubject,
      marks: Object.entries(marksData).map(([student_id, m]: any) => ({
        student_id,
        marks_obtained: m.absent ? null : Number(m.marks),
        is_absent: m.absent ?? false,
      })),
    }),
    onSuccess: () => {
      toast.success('Marks saved!')
      qc.invalidateQueries({ queryKey: ['marks-sheet'] })
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to save')
    },
  })

  const initMarks = () => {
    if (!sheetData || !selectedSubject) return
    const existing = (sheetData.marks ?? []).filter((m: any) => m.exam_subject_id === selectedSubject)
    const init: Record<string, any> = {}
    for (const m of existing) {
      init[m.student_id] = { marks: m.marks_obtained ?? '', absent: m.is_absent }
    }
    setMarksData(init)
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Select Class</Label>
          <Select value={selectedClass}
            onValueChange={v => { setSelectedClass(v); setSelectedSubject(''); setMarksData({}) }}>
            <SelectTrigger>
              <SelectValue placeholder="Choose class..." />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Select Subject</Label>
          <Select value={selectedSubject}
            onValueChange={v => { setSelectedSubject(v); initMarks() }}
            disabled={!selectedClass}>
            <SelectTrigger>
              <SelectValue placeholder="Choose subject..." />
            </SelectTrigger>
            <SelectContent>
              {subjectsForClass.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.subject_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedClass && (
        <EmptyState icon={Upload} title="Select a class and subject to enter marks" className="py-10" />
      )}

      {selectedClass && selectedSubject && (
        <div>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading students...</div>
          ) : (
            <div>
              <Table className="mb-4">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Roll No</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="w-32">Marks</TableHead>
                    <TableHead className="w-24">Absent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sheetData?.students ?? []).map((s: any) => {
                    const m = marksData[s.id] ?? {}
                    const sub = subjectsForClass.find((sub: any) => sub.id === selectedSubject)
                    return (
                      <TableRow key={s.id} className={cn('cursor-default', m.absent && 'opacity-50')}>
                        <TableCell className="text-muted-foreground">{s.roll_number}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          {s.first_name} {s.last_name}
                          <span className="ml-2 text-xs text-muted-foreground">{s.admission_number}</span>
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" max={sub?.max_marks ?? 100}
                            value={m.marks ?? ''}
                            disabled={m.absent}
                            onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], marks: e.target.value } }))}
                            placeholder={`/${sub?.max_marks ?? 100}`}
                            className="h-8" />
                        </TableCell>
                        <TableCell>
                          <input type="checkbox" checked={m.absent ?? false}
                            onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], absent: e.target.checked, marks: '' } }))}
                            className="h-4 w-4 rounded border-input accent-primary" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-end">
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CheckCircle className="h-4 w-4" />
                  }
                  Save Marks
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function ResultsView({ examId }: { examId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['results', examId],
    queryFn: () => api.get(`/exams/${examId}/results`).then(r => r.data.data),
  })

  if (isLoading) {
    return <div className="p-12 text-center text-muted-foreground">Loading results...</div>
  }

  if (!(data ?? []).length) {
    return (
      <Card>
        <EmptyState
          icon={BarChart2}
          title="No results yet"
          description="Upload marks and click Generate Results"
        />
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-semibold text-foreground">Results — {(data ?? []).length} students</h3>
        <div className="text-sm text-muted-foreground">
          Pass: <span className="font-semibold text-success">{(data ?? []).filter((r: any) => r.is_pass).length}</span>
          &nbsp; Fail: <span className="font-semibold text-destructive">{(data ?? []).filter((r: any) => !r.is_pass).length}</span>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Rank</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Marks</TableHead>
            <TableHead>Pct</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>Result</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map((rc: any) => (
            <TableRow key={rc.id} className="cursor-default">
              <TableCell className="font-bold text-primary">#{rc.rank}</TableCell>
              <TableCell className="font-medium text-foreground">
                {rc.students?.first_name} {rc.students?.last_name}
                <span className="ml-2 text-xs text-muted-foreground">{rc.students?.classes?.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{rc.obtained_marks}/{rc.total_marks}</TableCell>
              <TableCell className="font-semibold text-foreground">{rc.percentage}%</TableCell>
              <TableCell>
                <Badge variant={
                  ['A+','A'].includes(rc.grade) ? 'success' :
                  ['B+','B'].includes(rc.grade) ? 'info' :
                  rc.grade === 'C' ? 'warning' : 'destructive'}>
                  {rc.grade}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={rc.is_pass ? 'success' : 'destructive'}>
                  {rc.is_pass ? 'Pass' : 'Fail'}
                </Badge>
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
    </Card>
  )
}

function AddSubjectModal({ examId, classes, onClose }: any) {
  const [form, setForm] = useState({
    class_id: '', subject_name: '', exam_date: '',
    start_time: '', end_time: '', max_marks: 100, pass_marks: 33,
  })

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/exams/subjects/add', { ...data, exam_id: examId }),
    onSuccess: () => {
      toast.success('Subject added!')
      onClose()
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed')
    },
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Subject to Datesheet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Select value={form.class_id} onValueChange={v => setForm(f => ({ ...f, class_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select class..." />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject-name">Subject Name</Label>
            <Input id="subject-name" value={form.subject_name} onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}
              placeholder="e.g. Mathematics" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="subject-date">Exam Date</Label>
              <Input id="subject-date" type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-max">Max Marks</Label>
              <Input id="subject-max" type="number" value={form.max_marks} onChange={e => setForm(f => ({ ...f, max_marks: Number(e.target.value) }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.class_id || !form.subject_name}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Subject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
