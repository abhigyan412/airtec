'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ArrowLeft, IndianRupee, Loader2, Play, Check, ShieldCheck, Download, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// payment_status state machine: pending -> approved (Principal sign-off) -> paid
const PAY_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-emerald-100 text-emerald-700',
  on_hold: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
}

export default function PayrollPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const canApprove = ['school_admin', 'principal'].includes(user?.role ?? '')
  const [skipped, setSkipped] = useState<{ user_id: string; full_name: string; role: string }[] | null>(null)

  const { data: payslips, isLoading } = useQuery({
    queryKey: ['payslips', month, year],
    queryFn: () => hrmsApi.payslips.list({ month, year, limit: 100 }).then(r => r.data),
  })

  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: () => hrmsApi.payroll.summary({ month, year }).then(r => r.data),
  })

  const generateMutation = useMutation({
    mutationFn: () => hrmsApi.payslips.generate({ month, year }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      qc.invalidateQueries({ queryKey: ['payroll-summary'] })
      // count/skipped are siblings of data (the generated payslips array),
      // not nested inside it — res.data?.count was always undefined.
      toast.success(`${res.count ?? 0} payslip(s) generated`)
      setSkipped(res.skipped ?? [])
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to generate'),
  })

  const approveMutation = useMutation({
    mutationFn: ({ id }: any) => hrmsApi.payslips.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      toast.success('Payslip approved — ready to mark as paid')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to approve'),
  })

  const markPaidMutation = useMutation({
    mutationFn: ({ id }: any) => hrmsApi.payslips.update(id, { payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      qc.invalidateQueries({ queryKey: ['payroll-summary'] })
      toast.success('Marked as paid')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to mark paid'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500 text-sm mt-0.5">Generate and manage monthly payslips</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none min-w-[140px]">
            {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
            {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 shadow-sm shadow-indigo-200">
          {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Generate Payslips for {MONTHS[month-1]}
        </button>
      </div>

      {/* Summary cards */}
      {summary && summary.payslip_count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Payslips Generated', value: summary.payslip_count, color: 'text-gray-900' },
            { label: 'Gross Total', value: `₹${Number(summary.total_gross).toLocaleString('en-IN')}`, color: 'text-emerald-600' },
            { label: 'Deductions', value: `₹${Number(summary.total_deductions).toLocaleString('en-IN')}`, color: 'text-red-500' },
            { label: 'Net Payable', value: `₹${Number(summary.total_net).toLocaleString('en-IN')}`, color: 'text-indigo-600' },
            { label: 'Paid / Pending', value: `${summary.paid_count}/${summary.pending_count}`, color: 'text-gray-900' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4">
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {skipped !== null && skipped.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">{skipped.length} staff member{skipped.length !== 1 ? 's' : ''} skipped — no salary structure on file</p>
            <p className="text-xs text-amber-700 mt-1">
              {skipped.map((s, i) => (
                <span key={s.user_id}>
                  {i > 0 && ', '}
                  <Link href={`/hr/staff/${s.user_id}`} className="underline hover:text-amber-900">{s.full_name}</Link>
                </span>
              ))}
              {' — set their salary under Staff → Payroll tab, then generate again.'}
            </p>
          </div>
        </div>
      )}

      {!canApprove && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-2.5">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
          Payslips need Principal approval before they can be marked as paid.
        </div>
      )}

      {/* Payslips table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (payslips ?? []).length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <IndianRupee className="w-10 h-10 mx-auto mb-2 text-gray-200" />
            <p className="font-medium">No payslips for {MONTHS[month-1]} {year}</p>
            <p className="text-sm mt-1">Click "Generate Payslips" to create them from staff salary structures</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Staff</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Gross</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Deductions</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Net Pay</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(payslips ?? []).map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50/80">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-gray-900">{p.users?.full_name}</p>
                    <p className="text-xs text-gray-400 capitalize">{p.users?.role?.replace('_',' ')}</p>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">₹{Number(p.gross_salary).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3.5 text-gray-600">₹{Number(p.total_deductions).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3.5 font-semibold text-gray-900">₹{Number(p.net_salary).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3.5">
                    <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', PAY_STATUS_COLORS[p.payment_status])}>
                      {p.payment_status.replace('_',' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {p.payment_status === 'pending' && canApprove && (
                      <button onClick={() => approveMutation.mutate({ id: p.id })} disabled={approveMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100 ml-auto">
                        {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Approve
                      </button>
                    )}
                    {p.payment_status === 'pending' && !canApprove && (
                      <span className="text-xs text-gray-400">Awaiting Principal approval</span>
                    )}
                    {p.payment_status === 'approved' && (
                      <button onClick={() => markPaidMutation.mutate({ id: p.id })} disabled={markPaidMutation.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 ml-auto">
                        {markPaidMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Mark Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}