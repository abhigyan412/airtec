'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { FileX, Plus, Check, X, Loader2, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

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
      <Card className="space-y-3 p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
      </Card>
    )
  }

  const canRequest = ['school_admin', 'principal', 'accountant'].includes(user?.role ?? '')

  // No TC requested, or most recent one was rejected — allow a new request
  if (!latestTc || latestTc.status === 'rejected') {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-foreground">
            <FileX className="h-4 w-4 text-muted-foreground" /> Transfer Certificate
          </h3>
          {canRequest && studentStatus !== 'transferred' && (
            <Button size="sm" onClick={() => setShowRequest(true)}>
              <Plus className="h-3.5 w-3.5" /> Request TC
            </Button>
          )}
        </div>
        {latestTc?.status === 'rejected' && (
          <p className="mt-2 text-sm text-destructive">Previous request ({latestTc.tc_number}) was rejected. {latestTc.reason && `Reason: ${latestTc.reason}`}</p>
        )}
        {!latestTc && <p className="mt-2 text-sm text-muted-foreground">No transfer certificate has been requested for this student.</p>}

        {showRequest && (
          <RequestTcModal studentId={studentId} onClose={() => {
            setShowRequest(false)
            qc.invalidateQueries({ queryKey: ['student-tc', studentId] })
          }} />
        )}
      </Card>
    )
  }

  // Approved — show issued certificate info
  if (latestTc.status === 'approved') {
    return (
      <Card className="p-6">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
          <FileX className="h-4 w-4 text-muted-foreground" /> Transfer Certificate
        </h3>
        <div className="flex items-center justify-between rounded-xl border border-success/20 bg-success/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-success">{latestTc.tc_number}</p>
            <p className="text-xs text-success/80">Issued {formatDate(latestTc.issue_date ?? latestTc.created_at)}</p>
          </div>
          <Badge variant="success">Issued</Badge>
        </div>
      </Card>
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
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-muted-foreground" /> Transfer Certificate — {latestTc.tc_number}
        </h3>
        <Badge variant="warning">Pending</Badge>
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
            <div key={step.id} className="flex min-w-0 flex-1 items-center">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  state === 'done' && 'bg-success/10 text-success',
                  state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  state === 'pending' && 'bg-muted text-muted-foreground',
                  state === 'rejected' && 'bg-destructive/10 text-destructive')}>
                  {state === 'done' && <Check className="h-4 w-4" />}
                  {state === 'rejected' && <X className="h-4 w-4" />}
                  {(state === 'current' || state === 'pending') && (idx + 1)}
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

      {wfStatus === 'in_progress' && currentStep && (
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
                  placeholder={showNotesFor === 'rejected' ? 'Reason for rejection (required)...' : 'Add a note...'}
                  rows={2}
                  className="resize-none"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <Button onClick={() => handleAction('approved')} disabled={actionMutation.isPending}
                  className="bg-success text-success-foreground hover:bg-success/90">
                  {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {currentStep.action_name === 'dues_clearance' ? 'Confirm Dues Cleared' : 'Approve & Issue TC'}
                </Button>
                <Button variant="outline" onClick={() => handleAction('rejected')} disabled={actionMutation.isPending}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <X className="h-4 w-4" /> Reject
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">You don&apos;t have the {currentStep.roles?.name} role required for this step.</p>
          )}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          {approvals.map((a: any) => (
            <div key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{a.users?.full_name ?? 'System'}</span>
              <span>{a.status} ({a.workflow_steps?.roles?.name}) — {formatDate(a.acted_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function RequestTcModal({ studentId, onClose }: { studentId: string, onClose: () => void }) {
  const [form, setForm] = useState({ reason: '', last_attendance_date: '', conduct: 'Good' })
  const [loading, setLoading] = useState(false)

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request Transfer Certificate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea rows={2} className="resize-none" value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Family relocation" />
          </div>
          <div className="space-y-1.5">
            <Label>Last Attendance Date</Label>
            <Input type="date" value={form.last_attendance_date}
              onChange={e => setForm(f => ({ ...f, last_attendance_date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Conduct</Label>
            <Select value={form.conduct} onValueChange={v => setForm(f => ({ ...f, conduct: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Good">Good</SelectItem>
                <SelectItem value="Satisfactory">Satisfactory</SelectItem>
                <SelectItem value="Excellent">Excellent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">This will be sent to the Accountant to clear dues, then to the Principal for final approval before the certificate is issued.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
