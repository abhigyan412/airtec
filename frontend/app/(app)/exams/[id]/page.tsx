'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'next/navigation'
import { api, admitCardApi, documentsApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { ResultStatusBadge } from '@/components/exams/ResultStatusBadge'
import { STATUS_VARIANT } from '@/components/exams/statusVariant'
import { DatesheetGrid } from '@/components/exams/DatesheetGrid'
import { AnnounceExamDialog } from '@/components/exams/AnnounceExamDialog'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Upload, BarChart2, Loader2, CheckCircle, FileText, GitBranch, Check, X, MessageSquare, Snowflake, Eye, Megaphone, BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
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

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()
  const canGenerateResults = can('exam.result_generate')
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState(TABS.includes(initialTab as any) ? initialTab! : 'Datesheet')
  // Next.js reuses this component across navigations that only change the
  // [id] param or ?tab= (e.g. clicking a different Needs Attention item) —
  // it doesn't remount, so the useState initializer above (which only
  // runs once, on first mount) never sees a later URL's tab on its own.
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab)
  }, [searchParams])
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [editingSubject, setEditingSubject] = useState<any>(null)
  const [showAnnounce, setShowAnnounce] = useState(false)
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
      // released: this exam is a Term member whose Term has no configured
      // Component Release workflow — generate-results already froze it
      // in the same request (see backend comment on that route), so say
      // so rather than a generic "generated" that implies another step
      // is still needed.
      toast.success(r.data.data.released
        ? `Results generated for ${r.data.data.report_cards_generated} students — released to them now.`
        : `Results generated for ${r.data.data.report_cards_generated} students!`)
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

  const examSubjects: any[] = exam?.exam_subjects ?? []

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
              {exam.status === 'completed' && (
                canGenerateResults ? (
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
                ) : (
                  <p className="text-xs text-muted-foreground">Waiting on a School Admin or Principal to generate results</p>
                )
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
              <div className="flex items-center gap-2">
                {/* Enabled once there's something to announce and the exam
                    is out of draft — disabled-with-title rather than
                    hidden, so "announce this" reads as the next step in
                    the sequence, not something only discoverable by
                    already knowing Examination Settings has a copy of it. */}
                <Button
                  variant="outline" size="sm"
                  onClick={() => setShowAnnounce(true)}
                  disabled={exam.status === 'draft' || !examSubjects.length}
                  title={exam.status === 'draft' ? 'Publish this exam first' : undefined}
                >
                  <Megaphone className="h-4 w-4" /> Announce
                </Button>
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
            ) : (
              <DatesheetGrid examSubjects={examSubjects} onSubjectClick={subject => setEditingSubject(subject)} />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="Marks Entry" className="mt-6">
          <MarksEntry examId={id} exam={exam} />
        </TabsContent>

        <TabsContent value="Results" className="mt-6">
          <div className="space-y-6">
            <div className="flex justify-end">
              <Link href="/exams/results" className="text-xs text-muted-foreground hover:text-foreground">
                Browse all results ↗
              </Link>
            </div>
            <TermMembershipWarning memberships={exam.term_memberships ?? []} />
            {(exam.term_memberships ?? []).length > 0 && <ComponentReleasePipeline examId={id} exam={exam} />}
            <FreezePublishPipeline examId={id} exam={exam} />
            {(exam.term_memberships ?? []).length > 0
              ? <ScoresheetView examId={id} />
              : <ResultsView examId={id} />}
          </div>
        </TabsContent>
      </Tabs>

      {showAddSubject && (
        <AddSubjectModal examId={id} examType={exam.exam_type} classes={classes ?? []} defaultTimeSlot={exam.default_time_slot} onClose={() => {
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

      <AnnounceExamDialog examId={id} examName={exam.name} open={showAnnounce} onOpenChange={setShowAnnounce} />
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

// A pure hint, never a block: this exam already feeds one or more
// composite Terms, so publishing IT standalone risks a parent seeing two
// different numbers for the same subject/period — this exam's own %, and
// the Term's blended one. Some schools do want both (a Unit Test's quick
// standalone result now, the official Term card later), so this only
// nudges toward the Term, it never disables Freeze/Publish below.
function TermMembershipWarning({ memberships }: { memberships: any[] }) {
  if (!memberships.length) return null
  return (
    <Alert variant="warning" title="This exam is part of a composite Term">
      <p>
        It feeds into{' '}
        {memberships.map((m: any, i: number) => (
          <span key={m.id}>
            {i > 0 && ', '}
            <Link href={`/exams/result-groups/${m.id}`} className="font-medium underline hover:no-underline">{m.name}</Link>
            {' '}<span className="text-xs">({m.status.replace(/_/g, ' ')})</span>
          </span>
        ))}
        . Consider publishing that Term's result instead of this exam's standalone one, so parents only ever see the one official number for this period.
      </p>
    </Alert>
  )
}

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
  const canStart = ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '')

  // Schools can configure this workflow with any of their own roles
  // (Result Settings -> Publish Workflow), so who can act on the current
  // step can't be determined from a fixed list of role names client-side —
  // the backend computes it the same way actOnWorkflow itself authorizes
  // actions (role match / School Admin bypass / leave-delegate fallback)
  // and returns it as `can_act` on the workflow-status response.
  const canAct = status === 'in_progress' && !!currentStep && !!workflow.can_act

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
                  {currentStep.action_name.charAt(0).toUpperCase() + currentStep.action_name.slice(1)}
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
            {status === 'rejected' && 'This workflow was sent back for correction.'}
            {status === 'cancelled' && 'This workflow was cancelled.'}
          </p>
          {status === 'rejected' && canStart && (
            <Button size="sm" className="mt-3" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Restart Workflow
            </Button>
          )}
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

// ═══════════════════════════════════════════════════════════════
// COMPONENT EXAM RELEASE — a lighter release point for a Term-member
// exam, entirely separate from the FreezePublishPipeline above (that one
// targets entity_type='exam' — the school-wide chain a component exam
// almost never runs on its own — this one targets 'exam_component').
// Real schools report the Term as the official result, so a component
// exam's own marks need SOME release point well before that; either a
// school-configured workflow (named approvers, same shape as above) or,
// if none is configured for this exam's Term Template, a single Freeze
// button anyone who entered the marks can click. See
// resolveComponentRelease (backend resultGroups.routes.ts) for the full
// reasoning.
// ═══════════════════════════════════════════════════════════════

const COMPONENT_RELEASE_STATUSES = ['result_declared', 'result_frozen']

function ComponentReleasePipeline({ examId, exam }: { examId: string, exam: any }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)

  const relevant = COMPONENT_RELEASE_STATUSES.includes(exam.status)

  const { data: statusResp, isLoading } = useQuery({
    queryKey: ['exam-component-workflow-status', examId],
    queryFn: () => api.get(`/exams/${examId}/component-workflow-status`).then(r => r.data),
    enabled: relevant,
  })

  const freezeMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/component-freeze`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      qc.invalidateQueries({ queryKey: ['results', examId] })
      toast.success('Released — visible to students now')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to release'),
  })

  const startMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/start-component-workflow`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-component-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      toast.success('Release workflow started')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to start workflow'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ status }: { status: 'approved' | 'rejected' | 'commented' }) =>
      api.post(`/exams/${examId}/component-workflow-action`, { status, notes: notes.trim() || undefined }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['exam-component-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      qc.invalidateQueries({ queryKey: ['results', examId] })
      if (r.data.data?.completed) {
        toast.success(r.data.data.instance.status === 'approved' ? 'Released — visible to students now' : 'Sent back for correction')
      } else {
        toast.success('Decision recorded')
      }
      setNotes('')
      setShowNotesFor(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  if (!relevant) return null

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-9 w-full" />
      </Card>
    )
  }

  const hasConfiguredWorkflow = !!statusResp?.has_configured_workflow
  const workflow = statusResp?.data

  // No workflow configured for this exam's Term — the fallback. Normally
  // generate-results already did this in the same step; reaching here
  // with status still 'result_declared' means results were regenerated
  // (e.g. after a marks correction) and need releasing again.
  if (!hasConfiguredWorkflow) {
    if (exam.status === 'result_frozen') return null
    const canFreeze = ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '')
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-foreground"><Snowflake className="h-4 w-4" /> Release to students</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No release workflow is configured for this exam's Term — release its scores once marks are final. Reachable to whoever entered them, or an Exam Controller.
            </p>
          </div>
          {canFreeze && (
            <Button size="sm" onClick={() => freezeMutation.mutate()} disabled={freezeMutation.isPending}>
              {freezeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Release
            </Button>
          )}
        </div>
      </Card>
    )
  }

  // Configured but not yet started
  if (!workflow) {
    const canStart = ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '')
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Component Release</h3>
          </div>
          {canStart && (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Start Release Workflow
            </Button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Results have been generated. Start this Term's configured release workflow before students see this exam's scores.
        </p>
      </Card>
    )
  }

  const allSteps: any[] = workflow.all_steps ?? []
  const currentStep = workflow.current_step
  const approvals: any[] = workflow.approvals ?? []
  const status = workflow.status as 'in_progress' | 'approved' | 'rejected' | 'cancelled'
  const canAct = status === 'in_progress' && !!currentStep && !!workflow.can_act

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
          <h3 className="font-semibold text-foreground">{workflow.workflow_definitions?.name ?? 'Component Release'}</h3>
        </div>
        <Badge variant={status === 'approved' ? 'success' : status === 'rejected' ? 'destructive' : status === 'cancelled' ? 'secondary' : 'warning'}>
          {status === 'approved' ? 'Released' : status === 'rejected' ? 'Sent Back' : status === 'cancelled' ? 'Cancelled' : 'In Progress'}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        {allSteps.map((step, idx) => {
          const approval = approvals.find((a: any) => a.workflow_steps?.step_order === step.step_order)
          let state: 'done' | 'current' | 'pending' | 'rejected'
          if (approval?.status === 'approved') state = 'done'
          else if (approval?.status === 'rejected') state = 'rejected'
          else if (currentStep && step.step_order === currentStep.step_order && status === 'in_progress') state = 'current'
          else state = 'pending'

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
                  {(state === 'current' || state === 'pending') && <Snowflake className="h-4 w-4" />}
                </div>
                <div className="text-center">
                  <p className={cn('whitespace-nowrap text-xs font-semibold', state === 'pending' ? 'text-muted-foreground' : 'text-foreground')}>{step.roles?.name}</p>
                  <p className="whitespace-nowrap text-[10px] text-muted-foreground">{step.action_name}</p>
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
            Waiting on <span className="font-semibold text-foreground">{currentStep.roles?.name}</span> to {(currentStep.action_name ?? '').toLowerCase()}
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
                  {currentStep.action_name.charAt(0).toUpperCase() + currentStep.action_name.slice(1)}
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
            {status === 'approved' && 'This exam has been released and is now visible to students and parents.'}
            {status === 'rejected' && 'This workflow was sent back for correction.'}
            {status === 'cancelled' && 'This workflow was cancelled.'}
          </p>
          {status === 'rejected' && ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '') && (
            <Button size="sm" className="mt-3" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Restart Workflow
            </Button>
          )}
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
                      {a.status === 'approved' && 'approved'}
                      {a.status === 'rejected' && 'sent back'}
                      {a.status === 'commented' && 'commented'}
                      {' '}({a.workflow_steps?.roles?.name} · {a.workflow_steps?.action_name})
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

function MarksEntry({ examId, exam }: any) {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [marksData, setMarksData] = useState<Record<string, any>>({})
  const [overridingStudent, setOverridingStudent] = useState<any>(null)
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canOverride = can('exam.result_generate')

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

  const selectedSubjectRow = subjectsForClass.find((sub: any) => sub.id === selectedSubject)
  const isSplit = selectedSubjectRow?.theory_max_marks != null && selectedSubjectRow?.practical_max_marks != null
  // Resolved once per class by GET /marks/:class_id (Result Settings ->
  // Class Rules/Subject Overrides), keyed by subject name — tells this
  // screen whether the subject is grade_only (no numeric marks at all)
  // without a second round trip.
  const subjectRule = sheetData?.subject_rules?.[selectedSubjectRow?.subject_name]
  const isGradeOnly = !isSplit && subjectRule?.grading_mode === 'grade_only'

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/marks`, {
      exam_subject_id: selectedSubject,
      marks: Object.entries(marksData).map(([student_id, m]: any) => ({
        student_id,
        ...(isSplit ? {
          theory_marks_obtained: m.theoryAbsent ? null : (m.theory === '' || m.theory == null ? null : Number(m.theory)),
          practical_marks_obtained: m.practicalAbsent ? null : (m.practical === '' || m.practical == null ? null : Number(m.practical)),
          theory_is_absent: m.theoryAbsent ?? false,
          practical_is_absent: m.practicalAbsent ?? false,
        } : isGradeOnly ? {
          grade: m.grade || null,
          is_absent: m.absent ?? false,
        } : {
          marks_obtained: m.absent ? null : Number(m.marks),
          is_absent: m.absent ?? false,
        }),
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
      init[m.student_id] = {
        marks: m.marks_obtained ?? '', absent: m.is_absent,
        theory: m.theory_marks_obtained ?? '', practical: m.practical_marks_obtained ?? '',
        theoryAbsent: m.theory_is_absent ?? false, practicalAbsent: m.practical_is_absent ?? false,
        grade: m.grade ?? '',
      }
    }
    setMarksData(init)
  }

  // Numbers only start "fitting in" once the exam has actually started —
  // matches the backend's own gate on POST /:id/marks, so this isn't just
  // a UI nicety papering over a call that would fail anyway.
  if (exam.status === 'draft' || exam.status === 'published') {
    return (
      <Card>
        <EmptyState
          icon={Upload}
          title="Marks entry opens once the exam starts"
          description={`This exam is currently ${exam.status === 'draft' ? 'in Draft' : 'Published, but not yet started'}. Move it to Ongoing from the Examinations list to begin entering marks.`}
          className="py-10"
        />
      </Card>
    )
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
                    {isSplit ? (
                      <>
                        <TableHead className="w-28">Theory (out of {selectedSubjectRow?.theory_max_marks})</TableHead>
                        <TableHead className="w-20">Absent</TableHead>
                        <TableHead className="w-28">Practical (out of {selectedSubjectRow?.practical_max_marks})</TableHead>
                        <TableHead className="w-20">Absent</TableHead>
                      </>
                    ) : isGradeOnly ? (
                      <TableHead className="w-40">Grade</TableHead>
                    ) : (
                      <>
                        <TableHead className="w-32">Marks (out of {selectedSubjectRow?.max_marks ?? 100})</TableHead>
                        <TableHead className="w-24">Absent</TableHead>
                      </>
                    )}
                    {canOverride && <TableHead className="w-20"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sheetData?.students ?? []).map((s: any) => {
                    const m = marksData[s.id] ?? {}
                    const sub = selectedSubjectRow
                    return (
                      <TableRow key={s.id} className={cn('cursor-default', (m.absent || (m.theoryAbsent && m.practicalAbsent)) && 'opacity-50')}>
                        <TableCell className="text-muted-foreground">{s.roll_number}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          {s.first_name} {s.last_name}
                          <span className="ml-2 text-xs text-muted-foreground">{s.admission_number}</span>
                        </TableCell>
                        {isSplit ? (
                          <>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" max={sub?.theory_max_marks ?? 100}
                                  value={m.theory ?? ''}
                                  disabled={m.theoryAbsent}
                                  onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], theory: e.target.value } }))}
                                  className="h-8" />
                                <span className="shrink-0 text-xs text-muted-foreground">/{sub?.theory_max_marks}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <input type="checkbox" checked={m.theoryAbsent ?? false}
                                aria-label={`Mark ${s.first_name} ${s.last_name} absent for theory`}
                                onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], theoryAbsent: e.target.checked, theory: '' } }))}
                                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" max={sub?.practical_max_marks ?? 100}
                                  value={m.practical ?? ''}
                                  disabled={m.practicalAbsent}
                                  onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], practical: e.target.value } }))}
                                  className="h-8" />
                                <span className="shrink-0 text-xs text-muted-foreground">/{sub?.practical_max_marks}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <input type="checkbox" checked={m.practicalAbsent ?? false}
                                aria-label={`Mark ${s.first_name} ${s.last_name} absent for practical`}
                                onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], practicalAbsent: e.target.checked, practical: '' } }))}
                                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </TableCell>
                          </>
                        ) : isGradeOnly ? (
                          <TableCell>
                            <Select value={m.grade || undefined} onValueChange={v => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], grade: v } }))}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Select grade..." /></SelectTrigger>
                              <SelectContent>
                                {(subjectRule?.grade_bands ?? []).map((b: any) => (
                                  <SelectItem key={b.grade_label} value={b.grade_label}>{b.grade_label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        ) : (
                          <>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" max={sub?.max_marks ?? 100}
                                  value={m.marks ?? ''}
                                  disabled={m.absent}
                                  onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], marks: e.target.value } }))}
                                  className="h-8" />
                                <span className="shrink-0 text-xs text-muted-foreground">/{sub?.max_marks ?? 100}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <input type="checkbox" checked={m.absent ?? false}
                                aria-label={`Mark ${s.first_name} ${s.last_name} absent`}
                                onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], absent: e.target.checked, marks: '' } }))}
                                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </TableCell>
                          </>
                        )}
                        {canOverride && (
                          <TableCell>
                            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-primary"
                              onClick={() => setOverridingStudent(s)} title="Set a manual result exception for this student">
                              Override
                            </Button>
                          </TableCell>
                        )}
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

      {overridingStudent && (
        <StudentOverrideModal
          examId={examId} student={overridingStudent} examSubjectId={selectedSubject}
          onClose={() => setOverridingStudent(null)}
        />
      )}
    </Card>
  )
}

// A one-off exception for exactly one student's one subject — "Absent -
// Medical", "Result Withheld", or a specific grace-mark award — separate
// from the bulk marks sheet above since it always requires a reason and
// only ever touches one field at a time (never both together, so an
// override clear can't silently wipe a grace-mark award or vice versa).
function StudentOverrideModal({ examId, student, examSubjectId, onClose }: any) {
  const [mode, setMode] = useState<'status' | 'grace'>('status')
  const [statusOverride, setStatusOverride] = useState('')
  const [graceMarks, setGraceMarks] = useState('')
  const [reason, setReason] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.patch(`/exams/${examId}/marks/${student.id}/${examSubjectId}/override`, {
      ...(mode === 'status' ? { result_status_override: statusOverride || null } : { grace_marks_applied: Number(graceMarks) || 0 }),
      reason,
    }),
    onSuccess: () => { toast.success('Override saved'); qc.invalidateQueries({ queryKey: ['marks-sheet'] }); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save override'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Override — {student.first_name} {student.last_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={mode} onValueChange={v => setMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="status">Manual status (Absent - Medical, Result Withheld...)</SelectItem>
                <SelectItem value="grace">Grace marks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'status' ? (
            <div className="space-y-1.5">
              <Label htmlFor="status-override">Status text</Label>
              <Input id="status-override" value={statusOverride} onChange={e => setStatusOverride(e.target.value)}
                placeholder="e.g. Absent - Medical" />
              <p className="text-xs text-muted-foreground">Shown in place of the computed grade/pass-fail for this one subject; excludes it from the aggregate. Leave blank to clear an existing override.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="grace-marks">Grace marks to apply</Label>
              <Input id="grace-marks" type="number" min={0} value={graceMarks} onChange={e => setGraceMarks(e.target.value)} />
              <p className="text-xs text-muted-foreground">Always shown separately on the report card — never silently folded into the raw marks.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="override-reason">Reason (required, kept as an audit trail)</Label>
            <Textarea id="override-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !reason.trim()}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Shown instead of ResultsView for a Term-member exam — this exam's own
// percentage/pass-fail isn't the "official" one (the Term's blended
// result is, see TermMembershipWarning above), so rather than an
// aggregate table this renders the raw student x subject grid: every
// active student in the exam's classes down the rows, every subject
// across the columns, "NA" where nothing's entered yet and "Absent"
// where the student was actually marked absent — grouped by class +
// section the same way ResultsView is, for the same reason (rank would
// be meaningless flattened across sections; here it's just readability
// at scale).
function ScoresheetView({ examId }: { examId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['scoresheet', examId],
    queryFn: () => api.get(`/exams/${examId}/scoresheet`).then(r => r.data.data),
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

  const subjects = data?.subjects ?? []
  const students = data?.students ?? []
  if (!students.length || !subjects.length) {
    return (
      <Card>
        <EmptyState
          icon={BarChart2}
          title="No scoresheet yet"
          description="Enter marks on the Marks Entry tab to see each student's subject-wise marks here."
        />
      </Card>
    )
  }

  const marksByKey = new Map<string, any>()
  for (const m of data?.marks ?? []) marksByKey.set(`${m.student_id}:${m.exam_subject_id}`, m)

  const subjectsByClass = new Map<string, any[]>()
  for (const s of subjects) {
    if (!subjectsByClass.has(s.class_id)) subjectsByClass.set(s.class_id, [])
    subjectsByClass.get(s.class_id)!.push(s)
  }

  const groupMap = new Map<string, { class_name: string; section_name: string; numeric_level: number; class_id: string; students: any[] }>()
  for (const s of students) {
    const key = s.section_id ?? s.class_id ?? 'unknown'
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        class_name: s.classes?.name ?? 'Unknown class',
        section_name: s.sections?.name ?? '',
        numeric_level: s.classes?.numeric_level ?? 999,
        class_id: s.class_id,
        students: [],
      })
    }
    groupMap.get(key)!.students.push(s)
  }
  const groups = Array.from(groupMap.entries())
    .map(([key, g]) => ({ key, ...g, classSubjects: subjectsByClass.get(g.class_id) ?? [] }))
    .sort((a, b) => a.numeric_level - b.numeric_level || a.section_name.localeCompare(b.section_name))

  const formatCell = (studentId: string, subject: any) => {
    const m = marksByKey.get(`${studentId}:${subject.id}`)
    const isSplit = subject.theory_max_marks != null && subject.practical_max_marks != null
    if (!m) return <span className="text-muted-foreground">NA</span>
    if (isSplit) {
      if (m.theory_is_absent && m.practical_is_absent) return <span className="font-medium text-destructive">Absent</span>
      const theoryPart = m.theory_is_absent ? 'Absent' : (m.theory_marks_obtained ?? 'NA')
      const practicalPart = m.practical_is_absent ? 'Absent' : (m.practical_marks_obtained ?? 'NA')
      return <span>T: {theoryPart} · P: {practicalPart}</span>
    }
    if (m.is_absent) return <span className="font-medium text-destructive">Absent</span>
    if (m.grade) return <span>{m.grade}</span>
    if (m.marks_obtained == null) return <span className="text-muted-foreground">NA</span>
    return <span>{m.marks_obtained}</span>
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-semibold text-foreground">Scoresheet — {students.length} students across {groups.length} sections</h3>
        <p className="text-xs text-muted-foreground">Part of a Term — see the Term's own result for pass/fail</p>
      </div>
      <div className="divide-y divide-border">
        {groups.map(g => {
          const isOpen = expanded.has(g.key)
          return (
            <div key={g.key}>
              <button
                onClick={() => toggle(g.key)}
                className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-foreground">{g.class_name} {g.section_name}</span>
                  <span className="text-xs text-muted-foreground">{g.students.length} students</span>
                </div>
              </button>
              {isOpen && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Student</TableHead>
                        {g.classSubjects.map((sub: any) => (
                          <TableHead key={sub.id}>{sub.subject_name}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.students.map((s: any) => (
                        <TableRow key={s.id} className="cursor-default">
                          <TableCell className="font-medium text-foreground">{s.first_name} {s.last_name}</TableCell>
                          {g.classSubjects.map((sub: any) => (
                            <TableCell key={sub.id} className="text-muted-foreground">{formatCell(s.id, sub)}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function AddSubjectModal({ examId, examType, classes, defaultTimeSlot, onClose }: any) {
  // Pre-filled from the exam's own default time slot (set at Create
  // Exam time) if it has one — still just a starting point, the Time
  // Slot select below can always override it per subject.
  const [form, setForm] = useState({
    class_id: '', section_id: '', subject_name: '', exam_date: '',
    start_time: defaultTimeSlot?.start_time ?? '', end_time: defaultTimeSlot?.end_time ?? '', max_marks: 100, pass_marks: 33,
    practical_exam_date: '', practical_start_time: '', practical_end_time: '',
  })
  const [split, setSplit] = useState(false)
  const [splitForm, setSplitForm] = useState({ theory_max_marks: 70, theory_pass_marks: 25, practical_max_marks: 30, practical_pass_marks: 10 })

  // 11th/12th "sections" are really streams (PCM/PCB/Commerce/Humanities)
  // with genuinely different subjects — same numeric_level convention
  // Syllabus Setup already uses. Below that, a section picker only adds a
  // pointless step since every section shares one subject list.
  const selectedClassObj = (classes ?? []).find((c: any) => c.id === form.class_id)
  const isStreamWise = selectedClassObj?.numeric_level === 11 || selectedClassObj?.numeric_level === 12
  const streamSections = selectedClassObj?.sections ?? []

  // Subjects come from the class's master list (Settings -> Classes &
  // Sections) — the same source Timetable and Homework already draw
  // from, so a datesheet entry for "Mathematics" matches exactly what
  // those modules mean by it, instead of free text that could drift.
  // Scoped to the picked stream (when applicable) so the dropdown only
  // shows this stream's own + whole-class + school-wide subjects.
  const { data: subjectsData } = useQuery({
    queryKey: ['subjects', form.class_id, isStreamWise ? form.section_id : undefined],
    queryFn: () => classesApi.subjects.list(form.class_id, isStreamWise ? form.section_id : undefined).then(r => r.data),
    enabled: !!form.class_id,
  })

  // Result Settings -> Subject Overrides can flag a subject as
  // "has_practical" ahead of time (a UI hint only) — pre-checks the split
  // here so setting it up once in Result Settings carries through to
  // every future exam's datesheet for that subject. Matches the same
  // exam-type-scoped-first-then-default precedence resolveEffectiveSubjectRule()
  // uses server-side (this exam's own exam_type wins over the class-wide
  // default override, if a type-specific one exists for this subject).
  const { data: subjectOverrides } = useQuery({
    queryKey: ['result-subject-overrides', form.class_id],
    queryFn: () => api.get('/exams/result-settings/subject-overrides', { params: { class_id: form.class_id } }).then(r => r.data.data as any[]),
    enabled: !!form.class_id,
  })

  // Reusable named windows (Settings -> Exam Templates) instead of
  // re-typing the same start/end time on every subject added.
  const { data: timeSlots } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
  })

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/exams/subjects/add', {
      ...data, exam_id: examId,
      section_id: data.section_id || undefined,
      ...(split ? splitForm : {}),
    }),
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
            <Select value={form.class_id} onValueChange={v => setForm(f => ({ ...f, class_id: v, section_id: '', subject_name: '' }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select class..." />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isStreamWise && streamSections.length > 0 && (
            <div className="space-y-1.5">
              <Label>Stream</Label>
              <Select value={form.section_id || undefined} onValueChange={v => setForm(f => ({ ...f, section_id: v, subject_name: '' }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stream..." />
                </SelectTrigger>
                <SelectContent>
                  {streamSections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Subject *</Label>
            <Select value={form.subject_name || undefined} disabled={!form.class_id}
              onValueChange={v => {
                const override =
                  (subjectOverrides ?? []).find((o: any) => o.subject_name === v && o.exam_type === examType) ??
                  (subjectOverrides ?? []).find((o: any) => o.subject_name === v && o.exam_type == null)
                const hasSplit = !!override?.has_practical
                setSplit(hasSplit)
                setForm(f => ({
                  ...f, subject_name: v,
                  ...(!hasSplit && (override?.default_max_marks != null || override?.default_pass_marks != null) ? {
                    max_marks: override?.default_max_marks ?? f.max_marks,
                    pass_marks: override?.default_pass_marks ?? f.pass_marks,
                  } : {}),
                }))
                if (hasSplit) {
                  setSplitForm(f => ({
                    theory_max_marks: override?.default_theory_max_marks ?? f.theory_max_marks,
                    theory_pass_marks: override?.default_theory_pass_marks ?? f.theory_pass_marks,
                    practical_max_marks: override?.default_practical_max_marks ?? f.practical_max_marks,
                    practical_pass_marks: override?.default_practical_pass_marks ?? f.practical_pass_marks,
                  }))
                }
              }}>
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
              <Label htmlFor="subject-date">{split ? 'Theory Date' : 'Exam Date'}</Label>
              <Input id="subject-date" type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{split ? 'Theory Time Slot' : 'Time Slot'}</Label>
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
            {!split && (
              <div className="space-y-1.5">
                <Label htmlFor="subject-max">Max Marks</Label>
                <Input id="subject-max" type="number" value={form.max_marks} onChange={e => setForm(f => ({ ...f, max_marks: Number(e.target.value) }))} />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} />
            Split into Theory + Practical
          </label>

          {split && (
            <div className="space-y-4 rounded-xl bg-muted/40 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="subject-practical-date">Practical Date</Label>
                  <Input id="subject-practical-date" type="date" value={form.practical_exam_date} onChange={e => setForm(f => ({ ...f, practical_exam_date: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Practical Time Slot</Label>
                  <Select value={form.practical_start_time ? `${form.practical_start_time}-${form.practical_end_time}` : 'none'}
                    onValueChange={v => {
                      if (v === 'none') { setForm(f => ({ ...f, practical_start_time: '', practical_end_time: '' })); return }
                      const slot = (timeSlots ?? []).find((s: any) => `${s.start_time}-${s.end_time}` === v)
                      setForm(f => ({ ...f, practical_start_time: slot?.start_time ?? '', practical_end_time: slot?.end_time ?? '' }))
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="theory-max">Theory Max</Label>
                  <Input id="theory-max" type="number" value={splitForm.theory_max_marks} onChange={e => setSplitForm(f => ({ ...f, theory_max_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="theory-pass">Theory Pass</Label>
                  <Input id="theory-pass" type="number" value={splitForm.theory_pass_marks} onChange={e => setSplitForm(f => ({ ...f, theory_pass_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practical-max">Practical Max</Label>
                  <Input id="practical-max" type="number" value={splitForm.practical_max_marks} onChange={e => setSplitForm(f => ({ ...f, practical_max_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practical-pass">Practical Pass</Label>
                  <Input id="practical-pass" type="number" value={splitForm.practical_pass_marks} onChange={e => setSplitForm(f => ({ ...f, practical_pass_marks: Number(e.target.value) }))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Combined max marks: {splitForm.theory_max_marks + splitForm.practical_max_marks}
              </p>
            </div>
          )}
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
    practical_exam_date: subject.practical_exam_date ?? '', practical_start_time: subject.practical_start_time ?? '', practical_end_time: subject.practical_end_time ?? '',
  })
  const [split, setSplit] = useState(subject.theory_max_marks != null && subject.practical_max_marks != null)
  const [splitForm, setSplitForm] = useState({
    theory_max_marks: subject.theory_max_marks ?? 70, theory_pass_marks: subject.theory_pass_marks ?? 25,
    practical_max_marks: subject.practical_max_marks ?? 30, practical_pass_marks: subject.practical_pass_marks ?? 10,
  })

  const { data: timeSlots } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
  })

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/exams/subjects/${subject.id}`, {
      ...form,
      theory_max_marks: split ? splitForm.theory_max_marks : null,
      theory_pass_marks: split ? splitForm.theory_pass_marks : null,
      practical_max_marks: split ? splitForm.practical_max_marks : null,
      practical_pass_marks: split ? splitForm.practical_pass_marks : null,
      practical_exam_date: split ? (form.practical_exam_date || null) : null,
      practical_start_time: split ? (form.practical_start_time || null) : null,
      practical_end_time: split ? (form.practical_end_time || null) : null,
    }),
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
              <Label htmlFor="edit-subject-date">{split ? 'Theory Date' : 'Exam Date'}</Label>
              <Input id="edit-subject-date" type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{split ? 'Theory Time Slot' : 'Time Slot'}</Label>
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
          {!split && (
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
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} />
            Split into Theory + Practical
          </label>

          {split && (
            <div className="space-y-4 rounded-xl bg-muted/40 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-subject-practical-date">Practical Date</Label>
                  <Input id="edit-subject-practical-date" type="date" value={form.practical_exam_date} onChange={e => setForm(f => ({ ...f, practical_exam_date: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Practical Time Slot</Label>
                  <Select value={form.practical_start_time ? `${form.practical_start_time}-${form.practical_end_time}` : 'none'}
                    onValueChange={v => {
                      if (v === 'none') { setForm(f => ({ ...f, practical_start_time: '', practical_end_time: '' })); return }
                      const slot = (timeSlots ?? []).find((s: any) => `${s.start_time}-${s.end_time}` === v)
                      setForm(f => ({ ...f, practical_start_time: slot?.start_time ?? '', practical_end_time: slot?.end_time ?? '' }))
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-theory-max">Theory Max</Label>
                  <Input id="edit-theory-max" type="number" value={splitForm.theory_max_marks} onChange={e => setSplitForm(f => ({ ...f, theory_max_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-theory-pass">Theory Pass</Label>
                  <Input id="edit-theory-pass" type="number" value={splitForm.theory_pass_marks} onChange={e => setSplitForm(f => ({ ...f, theory_pass_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-practical-max">Practical Max</Label>
                  <Input id="edit-practical-max" type="number" value={splitForm.practical_max_marks} onChange={e => setSplitForm(f => ({ ...f, practical_max_marks: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-practical-pass">Practical Pass</Label>
                  <Input id="edit-practical-pass" type="number" value={splitForm.practical_pass_marks} onChange={e => setSplitForm(f => ({ ...f, practical_pass_marks: Number(e.target.value) }))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Combined max marks: {splitForm.theory_max_marks + splitForm.practical_max_marks}
              </p>
            </div>
          )}
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
