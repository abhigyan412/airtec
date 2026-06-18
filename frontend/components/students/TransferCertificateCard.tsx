'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { FileX, Plus, Check, X, Loader2, GitBranch, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'

// ═══════════════════════════════════════════════════════════════
// Transfer Certificate card — student detail page
// ═══════════════════════════════════════════════════════════════
// Shows existing TC requests for this student. If the most recent
// one is pending, shows the 2-step pipeline (Accountant/dues_clearance
// -> Principal/approve) with action buttons gated by role. If
// approved, shows the issued TC with a link/number. Otherwise offers
// a "Request Transfer Certificate" button.

const STEP_LABELS: Record<string, string> = {
  dues_clearance: 'Clear Dues',
  approve: 'Final Approval',
}

export function TransferCertificateCard({ studentId, studentStatus }: { studentId: string, studentStatus: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showRequest, setShowRequest] = useState(false)
  const [notes, setNotes] = useState('')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)

  const { data: tcs, isLoading } = useQuery({
    queryKey: ['student-tc', studentId],
    queryFn: () => studentsApi.tc.list(studentId).then(r => r.data),
  })

  const latestTc = (tcs ?? [])[0] // ordered desc by created_at

  const { data: workflow } = useQuery({
    queryKey: ['tc-workflow-status', studentId, latestTc?.id],
    queryFn: () => studentsApi.tc.workflowStatus(studentId, latestTc.id).then(r => r.data),
    enabled: !!latestTc && latestTc.status === 'pending',
  })

  const actionMutation = useMutation({
    mutationFn: ({ status }: { status: 'approved' | 'rejected' }) =>
      studentsApi.tc.workflowAction(studentId, latestTc.id, status, notes.trim() || undefined),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['student-tc', studentId] })
      qc.invalidateQueries({ queryKey: ['tc-workflow-status', studentId, latestTc.id] })
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      if (r.data?.completed) {
        toast.success(r.data.instance.status === 'approved' ? 'Transfer Certificate issued!' : 'TC request rejected')
      } else {
        toast.success('Dues clearance recorded — sent to Principal for approval')
      }
      setNotes('')
      setShowNotesFor(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const canRequest = ['school_admin', 'principal', 'accountant'].includes(user?.role ?? '')

  // No TC requested, or most recent one was rejected — allow a new request
  if (!latestTc || latestTc.status === 'rejected') {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileX className="w-4 h-4 text-gray-400" /> Transfer Certificate
          </h3>
          {canRequest && studentStatus !== 'transferred' && (
            <button onClick={() => setShowRequest(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700">
              <Plus className="w-3.5 h-3.5" /> Request TC
            </button>
          )}
        </div>
        {latestTc?.status === 'rejected' && (
          <p className="text-sm text-red-500 mt-2">Previous request ({latestTc.tc_number}) was rejected. {latestTc.reason && `Reason: ${latestTc.reason}`}</p>
        )}
        {!latestTc && <p className="text-sm text-gray-400 mt-2">No transfer certificate has been requested for this student.</p>}

        {showRequest && (
          <RequestTcModal studentId={studentId} onClose={() => {
            setShowRequest(false)
            qc.invalidateQueries({ queryKey: ['student-tc', studentId] })
          }} />
        )}
      </div>
    )
  }

  // Approved — show issued certificate info
  if (latestTc.status === 'approved') {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <FileX className="w-4 h-4 text-gray-400" /> Transfer Certificate
        </h3>
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">{latestTc.tc_number}</p>
            <p className="text-xs text-emerald-600">Issued {formatDate(latestTc.issue_date ?? latestTc.created_at)}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Issued</span>
        </div>
      </div>
    )
  }

  // Pending — show pipeline
  const currentStep = workflow?.current_step
  const approvals = workflow?.approvals ?? []
  const allSteps = workflow?.all_steps ?? []
  const wfStatus = workflow?.status

  const roleMap: Record<string, string> = {
    school_admin: 'School Admin',
    principal: 'Principal',
    accountant: 'Accountant',
  }
  const canAct = wfStatus === 'in_progress' && currentStep && (
    user?.role === 'school_admin' || roleMap[user?.role ?? ''] === currentStep.roles?.name
  )

  const handleAction = (status: 'approved' | 'rejected') => {
    if (status === 'rejected' && !notes.trim()) {
      setShowNotesFor('rejected')
      return
    }
    actionMutation.mutate({ status })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-gray-400" /> Transfer Certificate — {latestTc.tc_number}
        </h3>
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Pending</span>
      </div>

      {/* Pipeline steps */}
      <div className="flex items-center gap-1">
        {allSteps.map((step: any, idx: number) => {
          const approval = approvals.find((a: any) => a.workflow_steps?.step_order === step.step_order)
          let state: 'done' | 'current' | 'pending' | 'rejected'
          if (approval?.status === 'approved') state = 'done'
          else if (approval?.status === 'rejected') state = 'rejected'
          else if (currentStep && step.step_order === currentStep.step_order && wfStatus === 'in_progress') state = 'current'
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
        })}
      </div>

      {wfStatus === 'in_progress' && currentStep && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500 mb-3">
            Waiting on <span className="font-semibold text-gray-900">{currentStep.roles?.name}</span> to {STEP_LABELS[currentStep.action_name]?.toLowerCase() ?? currentStep.action_name}
          </p>
          {canAct ? (
            <div className="space-y-3">
              {showNotesFor && (
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={showNotesFor === 'rejected' ? 'Reason for rejection (required)...' : 'Add a note...'}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <button onClick={() => handleAction('approved')} disabled={actionMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-60">
                  {actionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {currentStep.action_name === 'dues_clearance' ? 'Confirm Dues Cleared' : 'Approve & Issue TC'}
                </button>
                <button onClick={() => handleAction('rejected')} disabled={actionMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 text-sm font-semibold rounded-xl hover:bg-red-100 disabled:opacity-60">
                  <X className="w-4 h-4" /> Reject
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">You don't have the {currentStep.roles?.name} role required for this step.</p>
          )}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="border-t border-gray-100 pt-4 space-y-2">
          {approvals.map((a: any) => (
            <div key={a.id} className="flex items-start gap-2 text-xs text-gray-500">
              <span className="font-semibold text-gray-700">{a.users?.full_name ?? 'System'}</span>
              <span>{a.status} ({a.workflow_steps?.roles?.name}) — {formatDate(a.acted_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RequestTcModal({ studentId, onClose }: { studentId: string, onClose: () => void }) {
  const [form, setForm] = useState({ reason: '', last_attendance_date: '', conduct: 'Good' })
  const [loading, setLoading] = useState(false)
  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  const handleSubmit = async () => {
    if (!form.reason) return toast.error('Reason is required')
    setLoading(true)
    try {
      await studentsApi.tc.request(studentId, form)
      toast.success('TC request submitted — sent to Accountant for dues clearance')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Request Transfer Certificate</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason *</label>
            <textarea rows={2} className={inputCls + ' resize-none'} value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Family relocation" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Attendance Date</label>
            <input type="date" className={inputCls} value={form.last_attendance_date}
              onChange={e => setForm(f => ({ ...f, last_attendance_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Conduct</label>
            <select className={inputCls} value={form.conduct} onChange={e => setForm(f => ({ ...f, conduct: e.target.value }))}>
              <option>Good</option>
              <option>Satisfactory</option>
              <option>Excellent</option>
            </select>
          </div>
          <p className="text-xs text-gray-400">This will be sent to the Accountant to clear dues, then to the Principal for final approval before the certificate is issued.</p>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Submit Request
          </button>
        </div>
      </div>
    </div>
  )
}