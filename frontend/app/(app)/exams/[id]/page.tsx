'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { api, admitCardApi, documentsApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Upload, BarChart2, Loader2, CheckCircle, FileText, GitBranch, Check, X, MessageSquare, Snowflake, Eye, Megaphone, BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
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

const titleCase = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

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
  const [editingSubject, setEditingSubject] = useState<any>(null)
  const [scheduleClassFilter, setScheduleClassFilter] = useState('')
  const [scheduleSubjectFilter, setScheduleSubjectFilter] = useState('')
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
    return (
      <div className="max-w-5xl space-y-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!exam) {
    return (
      <div className="max-w-5xl space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/exams">
            <ArrowLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Button>
        <Card>
          <EmptyState
            icon={FileText}
            title="Exam not found"
            description="This exam may have been deleted, or the link is out of date. Pick another exam from the list."
            action={
              <Button asChild>
                <Link href="/exams">Back to exams</Link>
              </Button>
            }
          />
        </Card>
      </div>
    )
  }

  // An exam's datesheet can span multiple classes at once (e.g. one
  // "Unit Test 4" covering Class 1 English and Class 2 Economics as
  // separate rows) — a flat table mixing every class/subject together
  // reads as a jumble once there's more than a couple of rows, so the
  // schedule is filterable down to one class and/or one subject.
  const examSubjects: any[] = exam?.exam_subjects ?? []
  const scheduleClasses = Array.from(
    new Map(examSubjects.map((s: any) => [s.class_id, { id: s.class_id, name: s.classes?.name }])).values()
  ).filter(c => c.id)
  const scheduleSubjectsForClass = Array.from(new Set(
    examSubjects
      .filter((s: any) => !scheduleClassFilter || s.class_id === scheduleClassFilter)
      .map((s: any) => s.subject_name)
  )).sort()
  const filteredSchedule = examSubjects.filter((s: any) =>
    (!scheduleClassFilter || s.class_id === scheduleClassFilter) &&
    (!scheduleSubjectFilter || s.subject_name === scheduleSubjectFilter)
  )

  // A datesheet's whole point is "what's happening on which date" — date
  // is the primary organizing axis, Class/Subject above are just narrowing
  // filters on top of it. Grouped and sorted chronologically rather than
  // left in whatever order the rows happen to have been added in.
  const scheduleByDate = new Map<string, any[]>()
  for (const s of filteredSchedule) {
    const key = s.exam_date ?? ''
    if (!scheduleByDate.has(key)) scheduleByDate.set(key, [])
    scheduleByDate.get(key)!.push(s)
  }
  const scheduleDateGroups = Array.from(scheduleByDate.entries())
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([date, rows]) => ({ date, rows: rows.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')) }))

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
          <Link href="/exams">
            <ArrowLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Button>

        <PageHeader
          title={exam.name}
          description={[
            titleCase(exam.exam_type ?? ''),
            exam.academic_years?.name,
            exam.start_date ? formatDate(exam.start_date) : null,
          ].filter(Boolean).join(' · ')}
          icon={BookOpen}
          actions={
            <>
              <Badge variant={STATUS_VARIANT[exam.status] ?? 'secondary'} className="capitalize">
                {exam.status?.replace(/_/g, ' ')}
              </Badge>
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
            </>
          }
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map(t => (
            <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="Datesheet" className="mt-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <h3 className="font-semibold text-foreground">Exam Schedule</h3>
              <div className="flex flex-wrap items-center gap-2">
                {scheduleClasses.length > 1 && (
                  <Select value={scheduleClassFilter || 'all'} onValueChange={v => { setScheduleClassFilter(v === 'all' ? '' : v); setScheduleSubjectFilter('') }}>
                    <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue placeholder="All classes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classes</SelectItem>
                      {scheduleClasses.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {scheduleSubjectsForClass.length > 1 && (
                  <Select value={scheduleSubjectFilter || 'all'} onValueChange={v => setScheduleSubjectFilter(v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue placeholder="All subjects" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All subjects</SelectItem>
                      {scheduleSubjectsForClass.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowAddSubject(true)}>
                  <Plus className="h-4 w-4" /> Add Subject
                </Button>
              </div>
            </div>
            {!examSubjects.length ? (
              <EmptyState
                icon={FileText}
                title="No subjects added yet"
                description="Add a subject with its date and max marks to build this exam's datesheet."
                action={
                  <Button onClick={() => setShowAddSubject(true)}>
                    <Plus className="h-4 w-4" /> Add Subject
                  </Button>
                }
              />
            ) : !filteredSchedule.length ? (
              <EmptyState
                icon={FileText}
                title="No subjects match this filter"
                description="Clear the class/subject filter above to see the full datesheet."
                action={
                  <Button variant="outline" onClick={() => { setScheduleClassFilter(''); setScheduleSubjectFilter('') }}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {scheduleDateGroups.map(({ date, rows }) => (
                  <div key={date || 'undated'} className="px-6 py-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {date ? formatDate(date) : 'Date not set'}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Subject</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Max Marks</TableHead>
                          <TableHead>Pass Marks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((sub: any) => (
                          <TableRow key={sub.id} onClick={() => setEditingSubject(sub)} className="cursor-pointer hover:bg-muted/40">
                            <TableCell className="font-medium text-foreground">{sub.subject_name}</TableCell>
                            <TableCell className="text-muted-foreground">{sub.classes?.name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {sub.start_time ? `${sub.start_time.slice(0, 5)}${sub.end_time ? `–${sub.end_time.slice(0, 5)}` : ''}` : '-'}
                            </TableCell>
                            <TableCell className="font-medium text-foreground">{sub.max_marks}</TableCell>
                            <TableCell className="text-muted-foreground">{sub.pass_marks}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="Marks Entry" className="mt-6">
          <MarksEntry examId={id} exam={exam} />
        </TabsContent>

        <TabsContent value="Results" className="mt-6">
          <div className="space-y-6">
            <FreezePublishPipeline examId={id} exam={exam} />
            <ResultsView examId={id} />
          </div>
        </TabsContent>
      </Tabs>

      {showAddSubject && (
        <AddSubjectModal examId={id} classes={classes ?? []} defaultTimeSlot={exam.default_time_slot} onClose={() => {
          setShowAddSubject(false)
          qc.invalidateQueries({ queryKey: ['exam', id] })
        }} />
      )}

      {editingSubject && (
        <EditSubjectModal subject={editingSubject} onClose={() => {
          setEditingSubject(null)
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
      <Card className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="flex items-center gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
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

function MarksEntry({ examId, exam }: any) {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [marksData, setMarksData] = useState<Record<string, any>>({})
  const qc = useQueryClient()

  // Only classes actually on this exam's datesheet belong here — the
  // full school class list (every class the school has, whether or not
  // this exam applies to it) was showing classes with no subject/date
  // configured for this exam at all, which meant picking most of them
  // left "Select Subject" permanently empty.
  const examClasses = Array.from(
    new Map((exam.exam_subjects ?? []).map((s: any) => [s.class_id, { id: s.class_id, name: s.classes?.name }])).values()
  ).filter((c: any) => c.id)

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Select Class</Label>
          <Select value={selectedClass}
            onValueChange={v => { setSelectedClass(v); setSelectedSubject(''); setMarksData({}) }}>
            <SelectTrigger>
              <SelectValue placeholder="Choose class..." />
            </SelectTrigger>
            <SelectContent>
              {examClasses.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
        <EmptyState
          icon={Upload}
          title="Select a class and subject to enter marks"
          description="Pick a class above, then the subject you're entering marks for."
          className="py-10"
        />
      )}

      {selectedClass && selectedSubject && (
        <div>
          {isLoading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
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
                            aria-label={`Mark ${s.first_name} ${s.last_name} absent`}
                            onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], absent: e.target.checked, marks: '' } }))}
                            className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
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

// A school-wide exam's results are one row per student — 1000+ for a
// full school — and report_cards.rank is scoped PER SECTION (see
// seed.ts), so a flat table sorted by rank alone interleaves every
// section's #1 together instead of meaning anything. Grouped by class +
// section instead, collapsed by default, so opening the page doesn't
// dump a thousand rows at once and each group's rank is locally
// meaningful again.
function ResultsView({ examId }: { examId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['results', examId],
    queryFn: () => api.get(`/exams/${examId}/results`).then(r => r.data.data),
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  if (isLoading) {
    return (
      <Card className="space-y-3 p-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </Card>
    )
  }

  const rows = data ?? []
  if (!rows.length) {
    return (
      <Card>
        <EmptyState
          icon={BarChart2}
          title="No results yet"
          description="Enter marks on the Marks Entry tab, then use Generate Results to build report cards."
        />
      </Card>
    )
  }

  const groupMap = new Map<string, { class_name: string; section_name: string; numeric_level: number; rows: any[] }>()
  for (const rc of rows) {
    const key = rc.students?.section_id ?? rc.students?.class_id ?? 'unknown'
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        class_name: rc.students?.classes?.name ?? 'Unknown class',
        section_name: rc.students?.sections?.name ?? '',
        numeric_level: rc.students?.classes?.numeric_level ?? 999,
        rows: [],
      })
    }
    groupMap.get(key)!.rows.push(rc)
  }
  const groups = Array.from(groupMap.entries())
    .map(([key, g]) => ({ key, ...g, rows: g.rows.sort((a, b) => a.rank - b.rank) }))
    .sort((a, b) => a.numeric_level - b.numeric_level || a.section_name.localeCompare(b.section_name))

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-semibold text-foreground">Results — {rows.length} students across {groups.length} sections</h3>
        <div className="text-sm text-muted-foreground">
          Pass: <span className="font-semibold text-success">{rows.filter((r: any) => r.is_pass).length}</span>
          &nbsp; Fail: <span className="font-semibold text-destructive">{rows.filter((r: any) => !r.is_pass).length}</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {groups.map(g => {
          const isOpen = expanded.has(g.key)
          const pass = g.rows.filter(r => r.is_pass).length
          const fail = g.rows.length - pass
          const avgPct = Math.round((g.rows.reduce((s, r) => s + Number(r.percentage), 0) / g.rows.length) * 10) / 10
          return (
            <div key={g.key}>
              <button
                onClick={() => toggle(g.key)}
                className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-foreground">{g.class_name} {g.section_name}</span>
                  <span className="text-xs text-muted-foreground">{g.rows.length} students</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Avg {avgPct}%</span>
                  <Badge variant="success">{pass} pass</Badge>
                  {fail > 0 && <Badge variant="destructive">{fail} fail</Badge>}
                </div>
              </button>
              {isOpen && (
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
                    {g.rows.map((rc: any) => (
                      <TableRow key={rc.id} className="cursor-default">
                        <TableCell className="font-bold text-primary">#{rc.rank}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          {rc.students?.first_name} {rc.students?.last_name}
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
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function AddSubjectModal({ examId, classes, defaultTimeSlot, onClose }: any) {
  // Pre-filled from the exam's own default time slot (set at Create
  // Exam time) if it has one — still just a starting point, the Time
  // Slot select below can always override it per subject.
  const [form, setForm] = useState({
    class_id: '', subject_name: '', exam_date: '',
    start_time: defaultTimeSlot?.start_time ?? '', end_time: defaultTimeSlot?.end_time ?? '', max_marks: 100, pass_marks: 33,
  })

  // Subjects come from the class's master list (Settings -> Classes &
  // Sections) — the same source Timetable and Homework already draw
  // from, so a datesheet entry for "Mathematics" matches exactly what
  // those modules mean by it, instead of free text that could drift.
  const { data: subjectsData } = useQuery({
    queryKey: ['subjects', form.class_id],
    queryFn: () => classesApi.subjects.list(form.class_id).then(r => r.data),
    enabled: !!form.class_id,
  })

  // Reusable named windows (Settings -> Exam Templates) instead of
  // re-typing the same start/end time on every subject added.
  const { data: timeSlots } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
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
            <Select value={form.class_id} onValueChange={v => setForm(f => ({ ...f, class_id: v, subject_name: '' }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select class..." />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subject *</Label>
            <Select value={form.subject_name || undefined} disabled={!form.class_id}
              onValueChange={v => setForm(f => ({ ...f, subject_name: v }))}>
              <SelectTrigger>
                <SelectValue placeholder={form.class_id ? 'Select subject...' : 'Select a class first'} />
              </SelectTrigger>
              <SelectContent>
                {(subjectsData ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.class_id && (subjectsData ?? []).length === 0 && (
              <p className="mt-1.5 text-xs text-warning">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="subject-date">Exam Date</Label>
              <Input id="subject-date" type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Time Slot</Label>
              <Select value={form.start_time ? `${form.start_time}-${form.end_time}` : 'none'}
                onValueChange={v => {
                  if (v === 'none') { setForm(f => ({ ...f, start_time: '', end_time: '' })); return }
                  const slot = (timeSlots ?? []).find((s: any) => `${s.start_time}-${s.end_time}` === v)
                  setForm(f => ({ ...f, start_time: slot?.start_time ?? '', end_time: slot?.end_time ?? '' }))
                }}>
                <SelectTrigger><SelectValue placeholder="No time slot" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No time slot</SelectItem>
                  {(timeSlots ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={`${s.start_time}-${s.end_time}`}>
                      {s.name} · {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(timeSlots ?? []).length === 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">No time slots set up yet — add some under Manage Templates.</p>
              )}
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

// Class/subject don't change once a datesheet row exists — reassigning
// either is really "delete this, add a different one" — so this only
// edits the fields that legitimately vary after the fact: date, time,
// and marks. Closes the create-only gap PATCH/DELETE /exams/subjects/:id
// fixes on the backend.
function EditSubjectModal({ subject, onClose }: any) {
  const [form, setForm] = useState({
    exam_date: subject.exam_date ?? '', start_time: subject.start_time ?? '', end_time: subject.end_time ?? '',
    max_marks: subject.max_marks, pass_marks: subject.pass_marks,
  })

  const { data: timeSlots } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
  })

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/exams/subjects/${subject.id}`, form),
    onSuccess: () => { toast.success('Subject updated'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exams/subjects/${subject.id}`),
    onSuccess: () => { toast.success('Subject removed from datesheet'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{subject.subject_name} · {subject.classes?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-date">Exam Date</Label>
              <Input id="edit-subject-date" type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Time Slot</Label>
              <Select value={form.start_time ? `${form.start_time}-${form.end_time}` : 'none'}
                onValueChange={v => {
                  if (v === 'none') { setForm(f => ({ ...f, start_time: '', end_time: '' })); return }
                  const slot = (timeSlots ?? []).find((s: any) => `${s.start_time}-${s.end_time}` === v)
                  setForm(f => ({ ...f, start_time: slot?.start_time ?? '', end_time: slot?.end_time ?? '' }))
                }}>
                <SelectTrigger><SelectValue placeholder="No time slot" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No time slot</SelectItem>
                  {(timeSlots ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={`${s.start_time}-${s.end_time}`}>
                      {s.name} · {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-max">Max Marks</Label>
              <Input id="edit-subject-max" type="number" value={form.max_marks} onChange={e => setForm(f => ({ ...f, max_marks: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-subject-pass">Pass Marks</Label>
              <Input id="edit-subject-pass" type="number" value={form.pass_marks} onChange={e => setForm(f => ({ ...f, pass_marks: Number(e.target.value) }))} />
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
            className="text-destructive hover:text-destructive">
            {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
