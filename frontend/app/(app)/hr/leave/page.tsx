'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Calendar, Check, X, AlertTriangle, Ban } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ApplyLeaveModal } from '@/components/hr/ApplyLeaveModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  approved: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  rejected: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  cancelled: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
}

export default function LeavePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showApply, setShowApply] = useState(false)
  const isAdmin = ['school_admin', 'principal'].includes(user?.role ?? '')

  const { data: balances } = useQuery({
    queryKey: ['leave-balances', user?.id],
    queryFn: () => hrmsApi.leaveBalances(user!.id).then(r => r.data),
    enabled: !!user?.id,
  })

  const { data: myRequests, isLoading } = useQuery({
    queryKey: ['leave-requests', 'mine'],
    queryFn: () => hrmsApi.leaveRequests.list({ limit: 50 }).then(r => r.data),
  })

  const { data: pendingAll } = useQuery({
    queryKey: ['leave-requests', 'pending-all'],
    queryFn: () => hrmsApi.leaveRequests.list({ status: 'pending', limit: 50 }).then(r => r.data),
    enabled: isAdmin,
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.leaveRequests.update(id, { status }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      if (res.data?.exceeds_balance) {
        toast.warning('Approved — this pushed the staff member past their remaining balance (leave-without-pay).')
      } else {
        toast.success('Leave updated')
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.leaveRequests.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success('Leave cancelled')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to cancel'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild className="mt-1">
            <Link href="/hr/staff" aria-label="Back to staff directory"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Leave Management</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Apply for leave and track your balances</p>
          </div>
        </div>
        <Button onClick={() => setShowApply(true)}>
          <Plus className="h-4 w-4" /> Apply for Leave
        </Button>
      </div>

      {/* My leave balances */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {(balances ?? []).map((b: any) => (
          <Card key={b.leave_type_id}>
            <CardContent className="p-4 text-center">
              <p className="text-xs font-medium text-muted-foreground">{b.code}</p>
              <p className={cn('mt-1 text-2xl font-bold', b.remaining_days < 0 ? 'text-destructive' : 'text-foreground')}>{b.remaining_days}</p>
              <p className="text-xs text-muted-foreground">of {b.total_days} days</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending approvals (admin only) */}
      {isAdmin && pendingAll && pendingAll.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border">
            <CardTitle>Pending Approvals</CardTitle>
            <Badge variant="warning">{pendingAll.length} pending</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {pendingAll.map((lr: any) => (
                <div key={lr.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{lr.users?.full_name}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-sm text-muted-foreground">{lr.leave_types?.name}</span>
                      {lr.exceeds_balance && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/20">
                          <AlertTriangle className="h-3 w-3" /> Exceeds balance
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                    {lr.reason && <p className="mt-1 text-xs text-muted-foreground">{lr.reason}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approveMutation.mutate({ id: lr.id, status: 'approved' })} disabled={approveMutation.isPending}
                      className="bg-success/10 text-success shadow-none hover:bg-success/20">
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" onClick={() => approveMutation.mutate({ id: lr.id, status: 'rejected' })} disabled={approveMutation.isPending}
                      className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* My leave history */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /> My Leave Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (myRequests ?? []).length === 0 ? (
            <EmptyState icon={Calendar} title="No leave requests yet" />
          ) : (
            <div className="divide-y divide-border">
              {(myRequests ?? []).map((lr: any) => (
                <div key={lr.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{lr.leave_types?.name}</span>
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[lr.status])}>{lr.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                    {lr.reason && <p className="mt-1 text-xs text-muted-foreground">{lr.reason}</p>}
                    {lr.rejection_reason && <p className="mt-1 text-xs text-destructive">Reason: {lr.rejection_reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {(lr.status === 'pending' || (isAdmin && lr.status === 'approved')) && (
                      <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate(lr.id)} disabled={cancelMutation.isPending}
                        className="text-muted-foreground hover:text-destructive">
                        <Ban className="h-3.5 w-3.5" /> {lr.status === 'approved' ? 'Cancel' : 'Withdraw'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showApply && (
        <ApplyLeaveModal onClose={() => {
          setShowApply(false)
          qc.invalidateQueries({ queryKey: ['leave-requests'] })
          qc.invalidateQueries({ queryKey: ['leave-balances'] })
        }} />
      )}
    </div>
  )
}
