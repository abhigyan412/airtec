'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Calendar, CalendarDays, Clock, CheckCircle, XCircle, Ban, AlertTriangle, Sunrise } from 'lucide-react'
import { toast } from 'sonner'
import { ApplyLeaveModal } from '@/components/hr/ApplyLeaveModal'
import { RequestCompOffModal } from '@/components/hr/RequestCompOffModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_STYLES: Record<string, { icon: any, className: string }> = {
  pending: { icon: Clock, className: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20' },
  approved: { icon: CheckCircle, className: 'bg-success/10 text-success ring-1 ring-inset ring-success/20' },
  rejected: { icon: XCircle, className: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20' },
  cancelled: { icon: Ban, className: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border' },
}

export default function MyLeavePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showApply, setShowApply] = useState(false)
  const [showCompOff, setShowCompOff] = useState(false)

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ['my-leave-balances', user?.id],
    queryFn: () => hrmsApi.leaveBalances(user!.id).then(r => r.data),
    enabled: !!user,
  })

  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ['my-leave-requests'],
    queryFn: () => hrmsApi.leaveRequests.list({ user_id: user?.id }).then(r => r.data),
    enabled: !!user,
  })

  // Comp-off self-service was previously only reachable from /hr/leave,
  // which is gated behind staff.leave_approve/staff.view — invisible to
  // an ordinary teacher. This page has no permission gate at all, so
  // it's where every staff member's own comp-off requests belong too.
  const { data: compOffRequests, isLoading: compOffLoading } = useQuery({
    queryKey: ['my-comp-off-requests'],
    queryFn: () => hrmsApi.compOff.list({ user_id: user?.id }).then(r => r.data),
    enabled: !!user,
  })

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.leaveRequests.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-leave-requests'] })
      qc.invalidateQueries({ queryKey: ['my-leave-balances'] })
      toast.success('Leave request withdrawn')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to withdraw'),
  })

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="My Leave"
        description="Apply for leave and track your requests"
        icon={CalendarDays}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowCompOff(true)}>
              <Sunrise className="h-4 w-4" /> Request Comp-Off
            </Button>
            <Button onClick={() => setShowApply(true)}>
              <Plus className="h-4 w-4" /> Apply for Leave
            </Button>
          </div>
        }
      />

      {/* Leave balances */}
      <Card>
        <CardHeader>
          <CardTitle>Leave Balance ({new Date().getFullYear()})</CardTitle>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[100px] rounded-xl" />)}
            </div>
          ) : (balances ?? []).length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No leave types allocated"
              description="Your school hasn't set up a leave quota for you yet — ask an administrator to allocate one."
              className="py-8"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(balances ?? []).map((b: any) => (
                <div key={b.leave_type_id} className="rounded-xl bg-muted p-4">
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{b.name}</p>
                  <p className={cn('text-2xl font-bold', b.remaining_days < 0 ? 'text-destructive' : 'text-foreground')}>{b.remaining_days}</p>
                  <p className="text-xs text-muted-foreground">of {b.total_days} days left</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leave history */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" /> Leave History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {requestsLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (requests ?? []).length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No leave requests yet"
              description="Apply for leave and you'll be able to track its approval status here."
              action={
                <Button onClick={() => setShowApply(true)}>
                  <Plus className="h-4 w-4" /> Apply for Leave
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {(requests ?? []).map((r: any) => {
                const style = STATUS_STYLES[r.status] ?? STATUS_STYLES.pending
                const Icon = style.icon
                return (
                  <div key={r.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{r.leave_types?.name ?? 'Leave'}</span>
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold capitalize', style.className)}>
                          <Icon className="h-3 w-3" /> {r.status}
                        </span>
                        {r.exceeds_balance && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/20">
                            <AlertTriangle className="h-3 w-3" /> Over balance
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatDate(r.from_date)} – {formatDate(r.to_date)} · {r.total_days} day{r.total_days !== 1 ? 's' : ''}
                      </p>
                      {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                      {r.status === 'rejected' && r.rejection_reason && (
                        <p className="mt-1 text-xs text-destructive">Reason: {r.rejection_reason}</p>
                      )}
                      {r.status === 'cancelled' && r.rejection_reason && (
                        <p className="mt-1 text-xs text-muted-foreground">Note: {r.rejection_reason}</p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3">
                      <p className="text-xs text-muted-foreground">{formatDate(r.applied_at)}</p>
                      {r.status === 'pending' && (
                        <Button variant="ghost" size="sm" onClick={() => withdrawMutation.mutate(r.id)} disabled={withdrawMutation.isPending}
                          className="text-muted-foreground hover:text-destructive">
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comp-off history */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <Sunrise className="h-4 w-4 text-muted-foreground" /> Comp-Off Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {compOffLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (compOffRequests ?? []).length === 0 ? (
            <EmptyState
              icon={Sunrise}
              title="No comp-off requests yet"
              description="Worked a holiday or weekly-off day? Request comp-off and it'll be credited once approved."
              action={
                <Button onClick={() => setShowCompOff(true)}>
                  <Plus className="h-4 w-4" /> Request Comp-Off
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {(compOffRequests ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">Worked {formatDate(r.worked_date)}</span>
                      <Badge variant={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'destructive' : 'warning'} className="capitalize">{r.status}</Badge>
                    </div>
                    {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCompOff && (
        <RequestCompOffModal onClose={() => {
          setShowCompOff(false)
          qc.invalidateQueries({ queryKey: ['my-comp-off-requests'] })
        }} />
      )}

      {showApply && (
        <ApplyLeaveModal onClose={() => {
          setShowApply(false)
          qc.invalidateQueries({ queryKey: ['my-leave-requests'] })
          qc.invalidateQueries({ queryKey: ['my-leave-balances'] })
        }} />
      )}
    </div>
  )
}
