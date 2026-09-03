'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowApi, admissionApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { Check, X, MessageSquare, ArrowUpCircle, Loader2, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface WorkflowPipelineProps {
  applicationId: string
}

const STEP_LABELS: Record<string, string> = {
  review: 'Review',
  fee_confirm: 'Fee Confirmation',
  final_approve: 'Final Approval',
  approve: 'Approval',
  verify: 'Verification',
  freeze: 'Freeze Results',
  publish: 'Publish',
  dues_clearance: 'Dues Clearance',
}

export function WorkflowPipeline({ applicationId }: WorkflowPipelineProps) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)
  const [sectionId, setSectionId] = useState('')
  const [overrideDocGap, setOverrideDocGap] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow-status', applicationId],
    queryFn: () => workflowApi.getStatus(applicationId).then(r => r.data),
  })

  // The final approval is what creates the student record, and a student needs
  // a section. An application only records the class applied for, so this is
  // the first and only point anybody is asked which section they join —
  // without it they enrol sectionless and fall out of every section-scoped
  // screen.
  const { data: application } = useQuery({
    queryKey: ['application', applicationId],
    queryFn: () => admissionApi.applications.get(applicationId).then(r => r.data),
  })
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  // Live enrolled/capacity per section, so whoever picks a section at
  // admission time can see how full each one already is instead of
  // choosing blind — same data source as the admission Seats page.
  const { data: strength } = useQuery({
    queryKey: ['classes-strength'],
    queryFn: () => classesApi.strength().then(r => r.data),
  })

  const actMutation = useMutation({
    mutationFn: ({ status, notes, section_id, override }: {
      status: 'approved' | 'rejected' | 'commented', notes?: string, section_id?: string,
      override?: { override_document_gap: boolean; override_reason?: string },
    }) => workflowApi.act(applicationId, status, notes, section_id, override),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['workflow-status', applicationId] })
      // The chain completing changes the application's own status (Fee
      // Pending or Rejected) — the Fee card and top badge read that from
      // the main application query, which workflow-status alone won't refresh.
      qc.invalidateQueries({ queryKey: ['admission-application', applicationId] })
      if (res.data?.completed) {
        toast.success(res.data.instance.status === 'approved'
          ? 'Approval chain complete — moved to Fee Pending'
          : 'Application rejected')
      } else {
        toast.success('Action recorded — moved to next step')
      }
      setNotes('')
      setShowNotesFor(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  const startMutation = useMutation({
    mutationFn: () => workflowApi.start(applicationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-status', applicationId] })
      toast.success('Workflow started')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to start workflow'),
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-4">
            <Skeleton className="h-4 w-64" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // No workflow instance yet
  if (!workflow) {
    const canStart = ['school_admin', 'principal'].includes(user?.role ?? '')
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Approval Workflow</h3>
            </div>
            {canStart && (
              <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                {startMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Start Workflow
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">No approval workflow has been started for this application yet.</p>
        </CardContent>
      </Card>
    )
  }

  const allSteps: any[] = workflow.all_steps ?? []
  const currentStep = workflow.current_step
  const approvals: any[] = workflow.approvals ?? []
  const status = workflow.status as 'in_progress' | 'approved' | 'rejected' | 'cancelled'

  // Can the logged-in user act on the current step?
  // (Single-role check via useAuth(); School Admin always bypasses.)
  const canAct = status === 'in_progress' && currentStep && (
    user?.role === 'school_admin' ||
    user?.full_name && currentStep.roles?.name && roleMatchesUser(currentStep.roles.name, user.role)
  )

  // Approving on the last step completes the workflow and admits the student.
  const isFinalStep = !!currentStep && allSteps.length > 0 &&
    Number(currentStep.step_order) >= Math.max(...allSteps.map((s: any) => Number(s.step_order)))
  // Only when this approval will actually create a student — re-approving an
  // application already linked to one needs no section.
  const needsSection = isFinalStep && !application?.student_id
  const sections: any[] =
    classes?.find((c: any) => c.id === application?.applying_for_class_id)?.sections ?? []
  const strengthBySection = new Map((strength?.sections ?? []).map((s: any) => [s.section_id, s]))

  const canOverrideDocGap = isFinalStep && user?.role === 'principal'

  const handleAction = (actionStatus: 'approved' | 'rejected' | 'commented') => {
    if (actionStatus === 'rejected' && !notes.trim()) {
      setShowNotesFor('rejected')
      return
    }
    if (actionStatus === 'approved' && needsSection && !sectionId) {
      toast.error('Pick the section this student will be enrolled into.')
      return
    }
    if (actionStatus === 'approved' && overrideDocGap && !overrideReason.trim()) {
      toast.error('A reason is required to override missing documents.')
      return
    }
    actMutation.mutate({
      status: actionStatus,
      notes: notes.trim() || undefined,
      section_id: actionStatus === 'approved' && needsSection ? sectionId : undefined,
      override: actionStatus === 'approved' && overrideDocGap
        ? { override_document_gap: true, override_reason: overrideReason.trim() }
        : undefined,
    })
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">{workflow.workflow_definitions?.name ?? 'Approval Workflow'}</h3>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Pipeline steps — each step's label can shrink and wrap (no more
            forced flex-shrink-0/nowrap), so a long role+action pair like
            "School Admin / Admission Confirmation" wraps onto two lines
            instead of forcing the whole row — and the card — wider than
            the screen. overflow-x-auto stays as a safety net for a
            pathologically long chain of many steps. */}
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
          {allSteps.length > 0 && renderSteps(allSteps, approvals, currentStep, status)}
        </div>

        {/* Current step actor + actions */}
        {status === 'in_progress' && currentStep && (
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  Waiting on <span className="font-semibold text-foreground">{currentStep.roles?.name}</span> to {STEP_LABELS[currentStep.action_name]?.toLowerCase() ?? currentStep.action_name}
                </p>
              </div>
            </div>

            {canAct ? (
              <div className="space-y-3">
                {needsSection && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <label className="mb-1.5 block text-xs font-medium text-foreground">
                      Enrol into section <span className="text-destructive">*</span>
                    </label>
                    {sections.length === 0 ? (
                      <p className="text-xs text-destructive">
                        This class has no sections yet — add one in Settings before admitting.
                      </p>
                    ) : (
                      <>
                        <Select value={sectionId} onValueChange={setSectionId}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Choose a section…" /></SelectTrigger>
                          <SelectContent>
                            {sections.map((s: any) => {
                              const st = strengthBySection.get(s.id) as any
                              const full = st?.capacity > 0 && st.enrolled >= st.capacity
                              return (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                  {st && (
                                    <span className={cn('ml-1.5', full ? 'text-destructive' : 'text-muted-foreground')}>
                                      — {st.enrolled}{st.capacity > 0 ? `/${st.capacity}` : ''} student{st.enrolled === 1 ? '' : 's'}{full ? ' · full' : ''}
                                    </span>
                                  )}
                                </SelectItem>
                              )
                            })}
                          </SelectContent>
                        </Select>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          Approving here admits the student and creates their record.
                        </p>
                      </>
                    )}
                  </div>
                )}
                {canOverrideDocGap && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                      <input type="checkbox" checked={overrideDocGap} onChange={e => setOverrideDocGap(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-input" />
                      Override missing document requirement (if any) — Principal only
                    </label>
                    {overrideDocGap && (
                      <Textarea
                        value={overrideReason}
                        onChange={e => setOverrideReason(e.target.value)}
                        placeholder="Reason for overriding the missing-document block (required)..."
                        rows={2}
                        className="resize-none"
                      />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Only takes effect if this class has a document checklist configured and it isn't fully met — otherwise it's ignored.
                    </p>
                  </div>
                )}
                {showNotesFor && (
                  <Textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={showNotesFor === 'rejected' ? 'Reason for rejection (required)...' : 'Add a note (optional)...'}
                    rows={2}
                    className="resize-none"
                    autoFocus
                  />
                )}
                <div className="flex gap-2">
                  <Button onClick={() => handleAction('approved')} disabled={actMutation.isPending} className="bg-success text-success-foreground hover:bg-success/90">
                    {actMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
                  </Button>
                  <Button variant="destructive" onClick={() => handleAction('rejected')} disabled={actMutation.isPending}>
                    <X className="w-4 h-4" /> Reject
                  </Button>
                  {showNotesFor !== 'commented' ? (
                    <Button variant="outline" onClick={() => setShowNotesFor('commented')}>
                      <MessageSquare className="w-4 h-4" /> Add Note
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => handleAction('commented')} disabled={actMutation.isPending || !notes.trim()}>
                      Save Note
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                You ({user?.role?.replace('_', ' ')}) don't have the {currentStep.roles?.name} role required for this step.
              </p>
            )}
          </div>
        )}

        {status !== 'in_progress' && (
          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {status === 'approved' && 'This application has completed all approval steps.'}
              {status === 'rejected' && 'This application was rejected during the approval process.'}
              {status === 'cancelled' && 'This workflow was cancelled.'}
            </p>
          </div>
        )}

        {/* Approval history */}
        {approvals.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">History</p>
            <div className="space-y-3">
              {approvals.map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 text-sm">
                  <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    a.status === 'approved' ? 'bg-success/10 text-success' :
                    a.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                    a.status === 'escalated' ? 'bg-warning/10 text-warning' :
                    'bg-muted text-muted-foreground')}>
                    {a.status === 'approved' && <Check className="w-3.5 h-3.5" />}
                    {a.status === 'rejected' && <X className="w-3.5 h-3.5" />}
                    {a.status === 'escalated' && <ArrowUpCircle className="w-3.5 h-3.5" />}
                    {a.status === 'commented' && <MessageSquare className="w-3 h-3" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-foreground">
                      <span className="font-semibold">{a.users?.full_name ?? 'System'}</span>
                      {' '}
                      <span className="text-muted-foreground">
                        {a.status === 'approved' && 'approved'}
                        {a.status === 'rejected' && 'rejected'}
                        {a.status === 'escalated' && 'escalated'}
                        {a.status === 'commented' && 'commented on'}
                        {' '}{a.workflow_steps?.roles?.name} step ({STEP_LABELS[a.workflow_steps?.action_name] ?? a.workflow_steps?.action_name})
                      </span>
                    </p>
                    {a.notes && <p className="text-muted-foreground mt-0.5">"{a.notes}"</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDate(a.acted_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string, variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
    in_progress: { label: 'In Progress', variant: 'warning' },
    approved: { label: 'Approved', variant: 'success' },
    rejected: { label: 'Rejected', variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
  }
  const c = config[status] ?? config.in_progress
  return <Badge variant={c.variant}>{c.label}</Badge>
}

// Maps the old single-string users.role to the new Role names used in
// workflow_steps (e.g. 'counselor' -> 'Counselor', 'school_admin' -> 'School Admin').
// School Admin is handled separately as a bypass.
function roleMatchesUser(stepRoleName: string, userRole: string): boolean {
  const map: Record<string, string> = {
    school_admin: 'School Admin',
    principal: 'Principal',
    teacher: 'Teacher',
    accountant: 'Accountant',
    counselor: 'Counselor',
  }
  return map[userRole] === stepRoleName
}

// Renders step indicators using the full ordered step list from the API,
// marking each as done / current / pending / rejected based on approvals
// and the workflow's current_step.
function renderSteps(allSteps: any[], approvals: any[], currentStep: any, status: string) {
  const approvalByStepOrder = new Map<number, string>() // step_order -> approval status
  for (const a of approvals) {
    if (a.workflow_steps?.step_order != null) {
      approvalByStepOrder.set(a.workflow_steps.step_order, a.status)
    }
  }

  return allSteps.map((step, idx) => {
    const approvalStatus = approvalByStepOrder.get(step.step_order)
    let state: 'done' | 'current' | 'pending' | 'rejected'

    if (approvalStatus === 'approved') state = 'done'
    else if (approvalStatus === 'rejected') state = 'rejected'
    else if (currentStep && step.step_order === currentStep.step_order && status === 'in_progress') state = 'current'
    else state = 'pending'

    return (
      <div key={step.id} className="flex items-center flex-1 min-w-0">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
            state === 'done' && 'bg-success/10 text-success',
            state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
            state === 'pending' && 'bg-muted text-muted-foreground',
            state === 'rejected' && 'bg-destructive/10 text-destructive')}>
            {state === 'done' && <Check className="w-4 h-4" />}
            {state === 'rejected' && <X className="w-4 h-4" />}
            {(state === 'current' || state === 'pending') && (idx + 1)}
          </div>
          <div className="w-full text-center">
            <p className={cn('text-xs font-semibold', state === 'pending' ? 'text-muted-foreground' : 'text-foreground')}>{step.roles?.name}</p>
            <p className="text-[10px] text-muted-foreground">{STEP_LABELS[step.action_name] ?? step.action_name}</p>
          </div>
        </div>
        {idx < allSteps.length - 1 && (
          <div className={cn('flex-1 h-0.5 mx-2 mb-5', state === 'done' ? 'bg-success/40' : 'bg-border')} />
        )}
      </div>
    )
  })
}
