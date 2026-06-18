'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi, admissionApi } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Loader2, ArrowRightLeft, Check, X, Plus } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-orange-100 text-orange-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  waived: 'bg-gray-100 text-gray-500',
}

export default function ArrearsPage() {
  const qc = useQueryClient()
  const [showCarryForward, setShowCarryForward] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [payTarget, setPayTarget] = useState<any>(null)
  const [waiveTarget, setWaiveTarget] = useState<any>(null)

  const { data: arrears, isLoading } = useQuery({
    queryKey: ['fee-arrears', statusFilter],
    queryFn: () => feeApi.arrears.list(statusFilter ? { status: statusFilter } : undefined).then(r => r.data),
  })

  const totalOutstanding = (arrears ?? [])
    .filter((a: any) => a.status !== 'cleared' && a.status !== 'waived')
    .reduce((s: number, a: any) => s + (Number(a.amount) - Number(a.amount_paid)), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/fees" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Arrears</h1>
            <p className="text-gray-500 text-sm mt-0.5">Carried-forward dues from previous academic years</p>
          </div>
        </div>
        <button onClick={() => setShowCarryForward(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <ArrowRightLeft className="w-4 h-4" /> Carry Forward Dues
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Total Outstanding Arrears</p>
        <p className="text-2xl font-bold text-rose-600">{formatCurrency(totalOutstanding)}</p>
      </div>

      <div className="flex items-center gap-2">
        {['', 'pending', 'partial', 'cleared', 'waived'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-all capitalize',
              statusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300')}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" /></div>
        ) : !(arrears ?? []).length ? (
          <div className="p-12 text-center text-gray-400">
            <p className="font-medium">No arrears found</p>
            <p className="text-sm mt-1">Use "Carry Forward Dues" at the start of a new academic year to bring unpaid balances forward</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">From → To Year</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Amount</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Paid</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Remaining</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(arrears ?? []).map((a: any) => {
                const remaining = Number(a.amount) - Number(a.amount_paid)
                const canAct = a.status === 'pending' || a.status === 'partial'
                return (
                  <tr key={a.id} className="hover:bg-gray-50/80">
                    <td className="px-5 py-3.5 font-semibold text-gray-900">
                      {a.students?.first_name} {a.students?.last_name}
                      <p className="text-xs text-gray-400">{a.students?.classes?.name}</p>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">
                      {a.from_year?.name ?? '—'} → {a.to_year?.name ?? '—'}
                    </td>
                    <td className="px-5 py-3.5 text-gray-700">{formatCurrency(a.amount)}</td>
                    <td className="px-5 py-3.5 text-emerald-600">{formatCurrency(a.amount_paid)}</td>
                    <td className="px-5 py-3.5 font-bold text-rose-600">{formatCurrency(remaining)}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_STYLES[a.status])}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {canAct && (
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setPayTarget(a)}
                            className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">
                            Record Payment
                          </button>
                          <button onClick={() => setWaiveTarget(a)}
                            className="px-3 py-1.5 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">
                            Waive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCarryForward && (
        <CarryForwardModal onClose={() => { setShowCarryForward(false); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
      {payTarget && (
        <RecordPaymentModal arrear={payTarget} onClose={() => { setPayTarget(null); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
      {waiveTarget && (
        <WaiveModal arrear={waiveTarget} onClose={() => { setWaiveTarget(null); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
    </div>
  )
}

function CarryForwardModal({ onClose }: { onClose: () => void }) {
  const [fromYear, setFromYear] = useState('')
  const [toYear, setToYear] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => admissionApi.academicYears?.() ? admissionApi.academicYears().then((r: any) => r.data) : Promise.resolve([]),
  })

  const handleSubmit = async () => {
    if (!fromYear || !toYear) return toast.error('Select both academic years')
    if (fromYear === toYear) return toast.error('From and To years must be different')
    setLoading(true)
    try {
      const res = await feeApi.arrears.carryForward(fromYear, toYear)
      setResult(res.data)
      toast.success(res.data?.message ?? `${res.data?.carried_forward ?? 0} arrears created`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to carry forward')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Carry Forward Dues</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {result ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
              <p className="font-semibold">{result.message ?? `${result.carried_forward} arrears created`}</p>
              {result.total_amount != null && <p className="mt-1">Total: {formatCurrency(result.total_amount)}</p>}
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                For every student with unpaid or partially-paid invoices in the "From" year, this creates an arrear carrying the remaining balance into the "To" year. Safe to re-run — already-carried invoices won't be duplicated.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">From Academic Year *</label>
                <select className={inputCls} value={fromYear} onChange={e => setFromYear(e.target.value)}>
                  <option value="">Select year</option>
                  {(years ?? []).map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">To Academic Year *</label>
                <select className={inputCls} value={toYear} onChange={e => setToYear(e.target.value)}>
                  <option value="">Select year</option>
                  {(years ?? []).map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {result ? (
            <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button onClick={handleSubmit} disabled={loading}
                className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Carry Forward
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RecordPaymentModal({ arrear, onClose }: { arrear: any, onClose: () => void }) {
  const remaining = Number(arrear.amount) - Number(arrear.amount_paid)
  const [amount, setAmount] = useState(String(remaining))
  const [paymentMode, setPaymentMode] = useState('cash')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    setLoading(true)
    try {
      await feeApi.arrears.recordPayment(arrear.id, { amount: amt, payment_mode: paymentMode })
      toast.success('Payment recorded')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Record Payment</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500">
            {arrear.students?.first_name} {arrear.students?.last_name} · Remaining: <span className="font-semibold text-rose-600">{formatCurrency(remaining)}</span>
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount *</label>
            <input type="number" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Payment Mode</label>
            <select className={inputCls} value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="neft">NEFT</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="online">Online</option>
            </select>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Record
          </button>
        </div>
      </div>
    </div>
  )
}

function WaiveModal({ arrear, onClose }: { arrear: any, onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!reason.trim()) return toast.error('A reason is required to waive an arrear')
    setLoading(true)
    try {
      await feeApi.arrears.waive(arrear.id, reason)
      toast.success('Arrear waived')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Waive Arrear</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500">
            This permanently waives the remaining balance for {arrear.students?.first_name} {arrear.students?.last_name}. This action should be reserved for admin/principal-approved hardship cases.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason *</label>
            <textarea rows={2} className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none resize-none"
              value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Financial hardship, approved by Principal" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Waive
          </button>
        </div>
      </div>
    </div>
  )
}