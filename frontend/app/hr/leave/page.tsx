'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Calendar, Check, X, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      toast.success('Leave updated')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
            <p className="text-gray-500 text-sm mt-0.5">Apply for leave and track your balances</p>
          </div>
        </div>
        <button onClick={() => setShowApply(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <Plus className="w-4 h-4" /> Apply for Leave
        </button>
      </div>

      {/* My leave balances */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {(balances ?? []).map((b: any) => (
          <div key={b.leave_type_id} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-xs text-gray-400 font-medium">{b.code}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{b.remaining_days}</p>
            <p className="text-xs text-gray-400">of {b.total_days} days</p>
          </div>
        ))}
      </div>

      {/* Pending approvals (admin only) */}
      {isAdmin && pendingAll && pendingAll.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Pending Approvals</h3>
            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">{pendingAll.length} pending</span>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingAll.map((lr: any) => (
              <div key={lr.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{lr.users?.full_name}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-sm text-gray-600">{lr.leave_types?.name}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                  {lr.reason && <p className="text-xs text-gray-400 mt-1">{lr.reason}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approveMutation.mutate({ id: lr.id, status: 'approved' })} disabled={approveMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button onClick={() => approveMutation.mutate({ id: lr.id, status: 'rejected' })} disabled={approveMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My leave history */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> My Leave Requests</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center"><div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (myRequests ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Calendar className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No leave requests yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(myRequests ?? []).map((lr: any) => (
              <div key={lr.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{lr.leave_types?.name}</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[lr.status])}>{lr.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                  {lr.reason && <p className="text-xs text-gray-400 mt-1">{lr.reason}</p>}
                  {lr.rejection_reason && <p className="text-xs text-red-400 mt-1">Reason: {lr.rejection_reason}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

function ApplyLeaveModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ leave_type_id: '', from_date: '', to_date: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const { data: leaveTypes } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => hrmsApi.leaveTypes.list().then(r => r.data),
  })

  const calcDays = () => {
    if (!form.from_date || !form.to_date) return 0
    const from = new Date(form.from_date)
    const to = new Date(form.to_date)
    const diff = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
    return diff > 0 ? diff : 0
  }

  const handleSave = async () => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) return toast.error('Please fill all required fields')
    const days = calcDays()
    if (days <= 0) return toast.error('Invalid date range')
    setLoading(true)
    try {
      await hrmsApi.leaveRequests.create({ ...form, total_days: days })
      toast.success('Leave request submitted')
      onClose()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Apply for Leave</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type *</label>
            <select className={ic} value={form.leave_type_id} onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">Select leave type</option>
              {(leaveTypes ?? []).map((lt: any) => <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">From Date *</label>
              <input type="date" className={ic} value={form.from_date} onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">To Date *</label>
              <input type="date" className={ic} value={form.to_date} onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} />
            </div>
          </div>
          {calcDays() > 0 && (
            <p className="text-sm text-indigo-600 font-medium">{calcDays()} day(s) total</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
            <textarea rows={3} className={ic + ' resize-none'} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for leave..." />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Submit Request
          </button>
        </div>
      </div>
    </div>
  )
}
