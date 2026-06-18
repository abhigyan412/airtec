'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Loader2, X, Calendar, Clock, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'

const STATUS_STYLES: Record<string, { icon: any, className: string }> = {
  pending: { icon: Clock, className: 'bg-amber-100 text-amber-700' },
  approved: { icon: CheckCircle, className: 'bg-emerald-100 text-emerald-700' },
  rejected: { icon: XCircle, className: 'bg-red-100 text-red-700' },
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
                <p className="text-2xl font-bold text-gray-900">{b.remaining_days}</p>
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
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{r.leave_types?.name ?? 'Leave'}</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1', style.className)}>
                        <Icon className="w-3 h-3" /> {r.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatDate(r.from_date)} – {formatDate(r.to_date)} · {r.total_days} day{r.total_days !== 1 ? 's' : ''}
                    </p>
                    {r.reason && <p className="text-xs text-gray-400 mt-1">{r.reason}</p>}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-xs text-red-500 mt-1">Reason: {r.rejection_reason}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">{formatDate(r.applied_at)}</p>
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

function ApplyLeaveModal({ onClose }: { onClose: () => void }) {
  const { data: leaveTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => hrmsApi.leaveTypes.list().then(r => r.data),
  })

  const [form, setForm] = useState({
    leave_type_id: '',
    from_date: '',
    to_date: '',
    reason: '',
  })
  const [loading, setLoading] = useState(false)

  const totalDays = (() => {
    if (!form.from_date || !form.to_date) return 0
    const from = new Date(form.from_date)
    const to = new Date(form.to_date)
    const diff = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
    return diff > 0 ? diff : 0
  })()

  const handleSubmit = async () => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) {
      return toast.error('Please fill all required fields')
    }
    if (totalDays <= 0) return toast.error('To date must be on or after from date')

    setLoading(true)
    try {
      await hrmsApi.leaveRequests.create({ ...form, total_days: totalDays })
      toast.success('Leave application submitted!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to submit')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Apply for Leave</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type *</label>
            <select className={inputCls} value={form.leave_type_id} onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">Select leave type</option>
              {(leaveTypes ?? []).map((lt: any) => (
                <option key={lt.id} value={lt.id}>{lt.name} {lt.is_paid ? '(Paid)' : '(Unpaid)'}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">From Date *</label>
              <input type="date" className={inputCls} value={form.from_date}
                onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">To Date *</label>
              <input type="date" className={inputCls} value={form.to_date}
                onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} />
            </div>
          </div>
          {totalDays > 0 && (
            <p className="text-sm text-indigo-600 font-medium">{totalDays} day{totalDays !== 1 ? 's' : ''} requested</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
            <textarea rows={3} className={inputCls + ' resize-none'} value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Brief reason for leave..." />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Submit Application
          </button>
        </div>
      </div>
    </div>
  )
}