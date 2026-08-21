'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Calendar, Check, X, AlertTriangle, Ban, ClipboardList, ChevronDown, Settings, Gift, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ApplyLeaveModal } from '@/components/hr/ApplyLeaveModal'
import { ManageLeaveTypesModal } from '@/components/hr/ManageLeaveTypesModal'
import { RequestCompOffModal } from '@/components/hr/RequestCompOffModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { StaffAvatar, staffPhotoUrl } from '@/components/hr/StaffAvatar'
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
  const [showManageTypes, setShowManageTypes] = useState(false)
  const [showRequestCompOff, setShowRequestCompOff] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Permission-based, not role-hardcoded — any role holding staff.leave_approve
  // (Principal/School Admin by default, but also HR or any custom role it's
  // assigned to) reaches the approval queue, matching what the backend
  // actually gates this on (requirePermissionV2('staff.leave_approve')).
  const { can } = usePermissions()
  const isAdmin = can('staff.leave_approve')

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ['leave-balances', user?.id],
    queryFn: () => hrmsApi.leaveBalances(user!.id).then(r => r.data),
    enabled: !!user?.id && !isAdmin,
  })

  // Admins already have a dedicated /hr/my-leave page for their own history;
  // showing it here too invites this exact section to silently drift out of
  // scope (see git history — it used to omit user_id and leak every staff
  // member's requests into an admin's "mine" list).
  const { data: myRequests, isLoading } = useQuery({
    queryKey: ['leave-requests', 'mine', user?.id],
    queryFn: () => hrmsApi.leaveRequests.list({ user_id: user!.id, limit: 50 }).then(r => r.data),
    enabled: !!user?.id && !isAdmin,
  })

  const { data: pendingAll } = useQuery({
    queryKey: ['leave-requests', 'pending-all'],
    queryFn: () => hrmsApi.leaveRequests.list({ status: 'pending', limit: 50 }).then(r => r.data),
    enabled: isAdmin,
  })

  // Everything that has been decided. Approving a request used to make
  // it vanish: the page only ever asked for status 'pending', so there
  // was no way to see who is off next week, or to check what was agreed
  // last month. An approval that leaves no visible record is not a
  // record.
  const [decidedStatus, setDecidedStatus] = useState<'approved' | 'rejected' | 'all'>('approved')
  const { data: decided, isLoading: decidedLoading } = useQuery({
    queryKey: ['leave-requests', 'decided', decidedStatus],
    queryFn: () => hrmsApi.leaveRequests.list(
      decidedStatus === 'all' ? { limit: 100 } : { status: decidedStatus, limit: 100 },
    ).then(r => r.data),
    enabled: isAdmin,
  })

  const { data: pendingCompOff } = useQuery({
    queryKey: ['comp-off', 'pending-all'],
    queryFn: () => hrmsApi.compOff.list({ status: 'pending' }).then(r => r.data),
    enabled: isAdmin,
  })

  const expandedRequest = (pendingAll ?? []).find((lr: any) => lr.id === expandedId)
  const { data: expandedBalances, isLoading: expandedBalancesLoading } = useQuery({
    queryKey: ['leave-balances', expandedRequest?.user_id],
    queryFn: () => hrmsApi.leaveBalances(expandedRequest!.user_id).then(r => r.data),
    enabled: isAdmin && !!expandedRequest?.user_id,
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

  const accrualMutation = useMutation({
    mutationFn: () => hrmsApi.leavePolicy.runAccrual(),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success(`Accrual run — checked ${res.data.checked} leave type(s), credited ${res.data.credited} balance(s)`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Accrual run failed'),
  })

  const yearEndMutation = useMutation({
    mutationFn: () => hrmsApi.leavePolicy.runYearEnd(),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['leave-balances'] })
      toast.success(`Year-end rollover run — checked ${res.data.checked} leave type(s), processed ${res.data.processed} balance(s)`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Year-end rollover failed'),
  })

  const compOffActionMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.compOff.workflowAction(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comp-off'] })
      toast.success('Comp-off request updated')
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
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3 text-muted-foreground">
          <Link href="/hr/staff"><ArrowLeft className="h-4 w-4" /> Staff Directory</Link>
        </Button>
        <PageHeader
          className="mb-0"
          title="Leave Management"
          description={isAdmin ? 'Review and approve staff leave requests' : 'Apply for leave and track your balances'}
          icon={ClipboardList}
          actions={
            <div className="flex flex-wrap gap-2">
              <HrQuickNav current="leave" />
              {isAdmin && (
                <Button variant="outline" onClick={() => setShowManageTypes(true)}>
                  <Settings className="h-4 w-4" /> Manage Leave Types
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" onClick={() => {
                  if (confirm('Run the monthly accrual sweep now? It normally runs automatically on the 1st — this is only needed if a scheduled run was missed.')) accrualMutation.mutate()
                }} disabled={accrualMutation.isPending}>
                  {accrualMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run Accrual
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" onClick={() => {
                  if (confirm('Run year-end carry-forward/encashment for the current year now? It normally runs automatically on Jan 1st.')) yearEndMutation.mutate()
                }} disabled={yearEndMutation.isPending}>
                  {yearEndMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run Year-End Rollover
                </Button>
              )}
              {!isAdmin && (
                <Button variant="outline" onClick={() => setShowRequestCompOff(true)}>
                  <Gift className="h-4 w-4" /> Request Comp-Off
                </Button>
              )}
              {/* Admins/Principal use this page purely to review and approve —
                  applying for their own leave belongs on /hr/my-leave, same as
                  the balances/history sections below already assume. */}
              {!isAdmin && (
                <Button onClick={() => setShowApply(true)}>
                  <Plus className="h-4 w-4" /> Apply for Leave
                </Button>
              )}
            </div>
          }
        />
      </div>

      {/* My leave balances — not relevant to admins on this page, whose job here is approving everyone else's leave */}
      {!isAdmin && (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {balancesLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[98px] rounded-xl" />)
          : (balances ?? []).map((b: any) => (
              <Card key={b.leave_type_id}>
                <CardContent className="p-4 text-center">
                  <p className="text-xs font-medium text-muted-foreground">{b.code}</p>
                  <p className={cn('mt-1 text-2xl font-bold', b.remaining_days < 0 ? 'text-destructive' : 'text-foreground')}>{b.remaining_days}</p>
                  <p className="text-xs text-muted-foreground">of {b.total_days} days</p>
                </CardContent>
              </Card>
            ))}
      </div>
      )}

      {/* Pending approvals (admin only) */}
      {isAdmin && pendingAll && pendingAll.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border">
            <CardTitle>Pending Approvals</CardTitle>
            <Badge variant="warning">{pendingAll.length} pending</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {pendingAll.map((lr: any) => {
                const isExpanded = expandedId === lr.id
                return (
                  <div key={lr.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(isExpanded ? null : lr.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : lr.id) } }}
                      className="flex cursor-pointer items-center justify-between px-6 py-4 hover:bg-muted/40"
                    >
                      <div className="flex items-start gap-3">
                        <StaffAvatar photoUrl={staffPhotoUrl(lr.users?.staff_profiles)} fullName={lr.users?.full_name} className="mt-0.5 h-8 w-8 text-xs" />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
                            <span className="text-sm font-semibold text-foreground">{lr.users?.full_name}</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-sm text-muted-foreground">{lr.leave_types?.name}</span>
                            {lr.exceeds_balance && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/20">
                                <AlertTriangle className="h-3 w-3" /> Exceeds balance
                              </span>
                            )}
                          </div>
                          <p className="mt-1 pl-[22px] text-xs text-muted-foreground">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                          {lr.reason && <p className="mt-1 pl-[22px] text-xs text-muted-foreground">{lr.reason}</p>}
                          {lr.exceeds_balance && (
                            <p className="mt-1.5 flex items-center gap-1 pl-[22px] text-xs font-medium text-warning">
                              <Ban className="h-3 w-3" /> Approving pushes the days beyond remaining balance to Leave Without Pay.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
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
                    {isExpanded && (
                      <div className="border-t border-border bg-muted/20 px-6 py-4">
                        <p className="mb-3 text-xs font-medium text-muted-foreground">{lr.users?.full_name}'s leave balance</p>
                        {expandedBalancesLoading ? (
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                            {(expandedBalances ?? []).map((b: any) => (
                              <div key={b.leave_type_id} className="rounded-xl border border-border bg-background p-3 text-center">
                                <p className="text-xs font-medium text-muted-foreground">{b.code}</p>
                                <p className={cn('mt-0.5 text-lg font-bold', b.remaining_days < 0 ? 'text-destructive' : 'text-foreground')}>{b.remaining_days}</p>
                                <p className="text-[11px] text-muted-foreground">of {b.total_days} days</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending comp-off approvals (admin only) */}
      {isAdmin && pendingCompOff && pendingCompOff.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border">
            <CardTitle>Pending Comp-Off Requests</CardTitle>
            <Badge variant="warning">{pendingCompOff.length} pending</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {pendingCompOff.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-start gap-3">
                    <StaffAvatar photoUrl={staffPhotoUrl(r.users?.staff_profiles)} fullName={r.users?.full_name} className="mt-0.5 h-8 w-8 text-xs" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{r.users?.full_name}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-sm text-muted-foreground">worked {formatDate(r.worked_date)}</span>
                      </div>
                      {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => compOffActionMutation.mutate({ id: r.id, status: 'approved' })} disabled={compOffActionMutation.isPending}
                      className="bg-success/10 text-success shadow-none hover:bg-success/20">
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" onClick={() => compOffActionMutation.mutate({ id: r.id, status: 'rejected' })} disabled={compOffActionMutation.isPending}
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

      {isAdmin && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Decided requests
            </CardTitle>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {([['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDecidedStatus(key)}
                  className={cn('px-3 py-1.5 text-sm transition-colors',
                    decidedStatus === key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {decidedLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !(decided ?? []).length ? (
              <EmptyState
                icon={Calendar}
                title={decidedStatus === 'approved' ? 'No approved leave' : decidedStatus === 'rejected' ? 'Nothing has been rejected' : 'No requests yet'}
                description="Requests appear here once somebody has decided them."
              />
            ) : (
              <div className="divide-y divide-border">
                {(decided ?? []).map((lr: any) => {
                  // Leave that covers today, or has not started yet, is
                  // the part anybody is actually planning around.
                  const today = new Date().toISOString().slice(0, 10)
                  const current = lr.from_date <= today && lr.to_date >= today
                  const upcoming = lr.from_date > today
                  return (
                    <div key={lr.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{lr.users?.full_name ?? 'Unknown'}</p>
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_COLORS[lr.status])}>
                            {lr.status}
                          </span>
                          {current && <Badge variant="warning">away now</Badge>}
                          {upcoming && <Badge variant="secondary">upcoming</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {lr.leave_types?.name ?? 'Leave'} · {lr.from_date}
                          {lr.to_date !== lr.from_date && ` to ${lr.to_date}`}
                          {lr.total_days ? ` · ${lr.total_days} day${lr.total_days === 1 ? '' : 's'}` : ''}
                        </p>
                        {lr.reason && <p className="mt-0.5 text-xs text-muted-foreground">{lr.reason}</p>}
                        {lr.status === 'rejected' && lr.rejection_reason && (
                          <p className="mt-0.5 text-xs text-destructive">Rejected: {lr.rejection_reason}</p>
                        )}
                      </div>
                      {lr.status === 'approved' && (current || upcoming) && (
                        <Link
                          href={`/timetable/arrangements?date=${current ? today : lr.from_date}`}
                          className="shrink-0 text-sm text-primary hover:underline"
                        >
                          Cover for this →
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* My leave history — admins have a dedicated /hr/my-leave page for this */}
      {!isAdmin && (
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
            <EmptyState
              icon={Calendar}
              title="No leave requests yet"
              description="Apply for leave and it will show up here with its approval status."
              action={
                <Button onClick={() => setShowApply(true)}>
                  <Plus className="h-4 w-4" /> Apply for Leave
                </Button>
              }
            />
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
      )}

      {showApply && (
        <ApplyLeaveModal onClose={() => {
          setShowApply(false)
          qc.invalidateQueries({ queryKey: ['leave-requests'] })
          qc.invalidateQueries({ queryKey: ['leave-balances'] })
        }} />
      )}

      {showManageTypes && <ManageLeaveTypesModal onClose={() => setShowManageTypes(false)} />}

      {showRequestCompOff && (
        <RequestCompOffModal onClose={() => {
          setShowRequestCompOff(false)
          qc.invalidateQueries({ queryKey: ['comp-off'] })
        }} />
      )}
    </div>
  )
}
