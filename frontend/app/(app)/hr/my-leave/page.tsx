'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Loader2, Calendar, Clock, CheckCircle, XCircle, Ban, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { ApplyLeaveModal } from '@/components/hr/ApplyLeaveModal'

const STATUS_STYLES: Record<string, { icon: any, className: string }> = {
  pending: { icon: Clock, className: 'bg-amber-100 text-amber-700' },
  approved: { icon: CheckCircle, className: 'bg-emerald-100 text-emerald-700' },
  rejected: { icon: XCircle, className: 'bg-red-100 text-red-700' },
  cancelled: { icon: Ban, className: 'bg-gray-100 text-gray-600' },
}

export default function MyLeavePage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showApply, setShowApply] = useState(false)

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leave</h1>
          <p className="text-gray-500 text-sm mt-0.5">Apply for leave and track your requests</p>
        </div>
        <button onClick={() => setShowApply(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <Plus className="w-4 h-4" /> Apply for Leave
        </button>
      </div>

      {/* Leave balances */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Leave Balance ({new Date().getFullYear()})</h3>
        {balancesLoading ? (
          <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(balances ?? []).map((b: any) => (
              <div key={b.leave_type_id} className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">{b.name}</p>
                <p className={cn('text-2xl font-bold', b.remaining_days < 0 ? 'text-red-600' : 'text-gray-900')}>{b.remaining_days}</p>
                <p className="text-xs text-gray-400">of {b.total_days} days left</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Leave history */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" /> Leave History
          </h3>
        </div>
        {requestsLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (requests ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Calendar className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No leave requests yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(requests ?? []).map((r: any) => {
              const style = STATUS_STYLES[r.status] ?? STATUS_STYLES.pending
              const Icon = style.icon
              return (
                <div key={r.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{r.leave_types?.name ?? 'Leave'}</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 capitalize', style.className)}>
                        <Icon className="w-3 h-3" /> {r.status}
                      </span>
                      {r.exceeds_balance && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 bg-amber-100 text-amber-700">
                          <AlertTriangle className="w-3 h-3" /> Over balance
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(r.from_date)} – {formatDate(r.to_date)} · {r.total_days} day{r.total_days !== 1 ? 's' : ''}
                    </p>
                    {r.reason && <p className="text-xs text-gray-400 mt-1">{r.reason}</p>}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-xs text-red-500 mt-1">Reason: {r.rejection_reason}</p>
                    )}
                    {r.status === 'cancelled' && r.rejection_reason && (
                      <p className="text-xs text-gray-400 mt-1">Note: {r.rejection_reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-xs text-gray-400">{formatDate(r.applied_at)}</p>
                    {r.status === 'pending' && (
                      <button onClick={() => withdrawMutation.mutate(r.id)} disabled={withdrawMutation.isPending}
                        className="text-xs font-medium text-gray-500 hover:text-red-600 transition-colors">
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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
