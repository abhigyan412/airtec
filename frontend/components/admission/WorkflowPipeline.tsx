'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { Check, X, Clock, MessageSquare, ArrowUpCircle, Loader2, GitBranch } from 'lucide-react'
import { toast } from 'sonner'

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

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow-status', applicationId],
    queryFn: () => workflowApi.getStatus(applicationId).then(r => r.data),
  })

  const actMutation = useMutation({
    mutationFn: ({ status, notes }: { status: 'approved' | 'rejected' | 'commented', notes?: string }) =>
      workflowApi.act(applicationId, status, notes),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['workflow-status', applicationId] })
      if (res.data?.completed) {
        toast.success(res.data.instance.status === 'approved' ? 'Application fully approved!' : 'Application rejected')
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
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // No workflow instance yet
  if (!workflow) {
    const canStart = ['school_admin', 'principal'].includes(user?.role ?? '')
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-gray-400" />
            <h3 className="font-semibold text-gray-900">Approval Workflow</h3>
          </div>
          {canStart && (
            <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60">
              {startMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Start Workflow
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mt-2">No approval workflow has been started for this application yet.</p>
      </div>
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

  const handleAction = (actionStatus: 'approved' | 'rejected' | 'commented') => {
    if (actionStatus === 'rejected' && !notes.trim()) {
      setShowNotesFor('rejected')
      return
    }
    actMutation.mutate({ status: actionStatus, notes: notes.trim() || undefined })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-900">{workflow.workflow_definitions?.name ?? 'Approval Workflow'}</h3>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Pipeline steps */}
      <div className="flex items-center gap-1">
        {allSteps.length > 0 && renderSteps(allSteps, approvals, currentStep, status)}
      </div>

      {/* Current step actor + actions */}
      {status === 'in_progress' && currentStep && (
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-gray-500">
                Waiting on <span className="font-semibold text-gray-900">{currentStep.roles?.name}</span> to {STEP_LABELS[currentStep.action_name]?.toLowerCase() ?? currentStep.action_name}
              </p>
            </div>
          </div>

          {canAct ? (
            <div className="space-y-3">
              {showNotesFor && (
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={showNotesFor === 'rejected' ? 'Reason for rejection (required)...' : 'Add a note (optional)...'}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <button onClick={() => handleAction('approved')} disabled={actMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-60">
                  {actMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
                </button>
                <button onClick={() => handleAction('rejected')} disabled={actMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 text-sm font-semibold rounded-xl hover:bg-red-100 disabled:opacity-60">
                  <X className="w-4 h-4" /> Reject
                </button>
                {showNotesFor !== 'commented' ? (
                  <button onClick={() => setShowNotesFor('commented')}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
                    <MessageSquare className="w-4 h-4" /> Add Note
                  </button>
                ) : (
                  <button onClick={() => handleAction('commented')} disabled={actMutation.isPending || !notes.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50">
                    Save Note
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              You ({user?.role?.replace('_', ' ')}) don't have the {currentStep.roles?.name} role required for this step.
            </p>
          )}
        </div>
      )}

      {status !== 'in_progress' && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500">
            {status === 'approved' && 'This application has completed all approval steps.'}
            {status === 'rejected' && 'This application was rejected during the approval process.'}
            {status === 'cancelled' && 'This workflow was cancelled.'}
          </p>
        </div>
      )}

      {/* Approval history */}
      {approvals.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-3">History</p>
          <div className="space-y-3">
            {approvals.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                  a.status === 'rejected' ? 'bg-red-100 text-red-600' :
                  a.status === 'escalated' ? 'bg-amber-100 text-amber-600' :
                  'bg-gray-100 text-gray-400')}>
                  {a.status === 'approved' && <Check className="w-3.5 h-3.5" />}
                  {a.status === 'rejected' && <X className="w-3.5 h-3.5" />}
                  {a.status === 'escalated' && <ArrowUpCircle className="w-3.5 h-3.5" />}
                  {a.status === 'commented' && <MessageSquare className="w-3 h-3" />}
                </div>
                <div className="flex-1">
                  <p className="text-gray-900">
                    <span className="font-semibold">{a.users?.full_name ?? 'System'}</span>
                    {' '}
                    <span className="text-gray-500">
                      {a.status === 'approved' && 'approved'}
                      {a.status === 'rejected' && 'rejected'}
                      {a.status === 'escalated' && 'escalated'}
                      {a.status === 'commented' && 'commented on'}
                      {' '}{a.workflow_steps?.roles?.name} step ({STEP_LABELS[a.workflow_steps?.action_name] ?? a.workflow_steps?.action_name})
                    </span>
                  </p>
                  {a.notes && <p className="text-gray-500 mt-0.5">"{a.notes}"</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(a.acted_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string, className: string }> = {
    in_progress: { label: 'In Progress', className: 'bg-amber-100 text-amber-700' },
    approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
  }
  const c = config[status] ?? config.in_progress
  return <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', c.className)}>{c.label}</span>
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
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
            state === 'done' && 'bg-emerald-100 text-emerald-600',
            state === 'current' && 'bg-indigo-600 text-white ring-4 ring-indigo-100',
            state === 'pending' && 'bg-gray-100 text-gray-400',
            state === 'rejected' && 'bg-red-100 text-red-600')}>
            {state === 'done' && <Check className="w-4 h-4" />}
            {state === 'rejected' && <X className="w-4 h-4" />}
            {(state === 'current' || state === 'pending') && (idx + 1)}
          </div>
          <div className="text-center">
            <p className={cn('text-xs font-semibold whitespace-nowrap', state === 'pending' ? 'text-gray-400' : 'text-gray-900')}>{step.roles?.name}</p>
            <p className="text-[10px] text-gray-400 whitespace-nowrap">{STEP_LABELS[step.action_name] ?? step.action_name}</p>
          </div>
        </div>
        {idx < allSteps.length - 1 && (
          <div className={cn('flex-1 h-0.5 mx-2 mb-5', state === 'done' ? 'bg-emerald-200' : 'bg-gray-100')} />
        )}
      </div>
    )
  })
}