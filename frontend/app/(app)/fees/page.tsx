'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi, studentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, STATUS_COLORS, formatCurrency, formatDate } from '@/lib/utils'
import { CreditCard, AlertCircle, CheckCircle, Clock, Plus, X, Loader2, Tag, Check, XCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowRightLeft } from 'lucide-react'

export default function FeesPage() {
  const [tab, setTab] = useState<'invoices' | 'dues' | 'structures' | 'discounts'>('invoices')

  const { data: stats } = useQuery({
    queryKey: ['fee-stats'],
    queryFn: () => feeApi.stats().then(r => r.data),
  })

  const { data: invoices } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => feeApi.invoices.list({ limit: 50 }).then(r => r),
    enabled: tab === 'invoices',
  })

  const { data: dues } = useQuery({
    queryKey: ['dues'],
    queryFn: () => feeApi.dues().then(r => r),
    enabled: tab === 'dues',
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fee Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track collections, invoices, and dues</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/fees/arrears"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
            <ArrowRightLeft className="w-4 h-4" /> Arrears
          </Link>
          <Link href="/fees/collections"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
            <AlertTriangle className="w-4 h-4" /> Collections & Dues
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Billed', value: formatCurrency(stats?.total_billed ?? 0), icon: CreditCard, color: 'text-brand-600 bg-brand-50' },
          { label: 'Collected', value: formatCurrency(stats?.total_collected ?? 0), icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Due', value: formatCurrency(stats?.total_due ?? 0), icon: AlertCircle, color: 'text-rose-600 bg-rose-50' },
          { label: 'Partial Paid', value: stats?.partial_invoices ?? 0, icon: Clock, color: 'text-amber-600 bg-amber-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', s.color.split(' ')[1])}>
              <s.icon className={cn('w-5 h-5', s.color.split(' ')[0])} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex border-b border-gray-200 px-4">
          {(['invoices', 'dues', 'structures', 'discounts'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize',
                tab === t
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t === 'dues' ? 'Pending Dues' : t === 'structures' ? 'Fee Structure' : t === 'discounts' ? 'Discounts' : 'Invoices'}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'invoices' && (
            <InvoicesTable data={invoices?.data ?? []} />
          )}
          {tab === 'dues' && (
            <DuesTable data={dues?.data ?? []} />
          )}
          {tab === 'structures' && (
            <FeeStructures />
          )}
          {tab === 'discounts' && (
            <DiscountsTab />
          )}
        </div>
      </div>
    </div>
  )
}

function InvoicesTable({ data }: { data: any[] }) {
  if (!data.length) return <Empty message="No invoices yet" />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="pb-3 text-left font-medium text-gray-500">Invoice</th>
          <th className="pb-3 text-left font-medium text-gray-500">Student</th>
          <th className="pb-3 text-left font-medium text-gray-500">Amount</th>
          <th className="pb-3 text-left font-medium text-gray-500">Due Date</th>
          <th className="pb-3 text-left font-medium text-gray-500">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {data.map((inv: any) => (
          <tr key={inv.id} className="hover:bg-gray-50">
            <td className="py-3 font-mono text-xs text-gray-500">{inv.invoice_number}</td>
            <td className="py-3">
              <p className="font-medium text-gray-900">
                {inv.students?.first_name} {inv.students?.last_name}
              </p>
              <p className="text-xs text-gray-400">{inv.students?.classes?.name}</p>
            </td>
            <td className="py-3 font-semibold text-gray-900">{formatCurrency(inv.total_amount)}</td>
            <td className="py-3 text-gray-500">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
            <td className="py-3">
              <span className={cn('px-2 py-1 rounded-full text-xs font-medium', STATUS_COLORS[inv.status])}>
                {inv.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DuesTable({ data }: { data: any[] }) {
  if (!data.length) return <Empty message="No pending dues 🎉" />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="pb-3 text-left font-medium text-gray-500">Student</th>
          <th className="pb-3 text-left font-medium text-gray-500">Class</th>
          <th className="pb-3 text-left font-medium text-gray-500">Amount Due</th>
          <th className="pb-3 text-left font-medium text-gray-500">Invoice</th>
          <th className="pb-3 text-left font-medium text-gray-500">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {data.map((inv: any) => (
          <tr key={inv.id} className="hover:bg-gray-50">
            <td className="py-3 font-medium text-gray-900">
              {inv.students?.first_name} {inv.students?.last_name}
            </td>
            <td className="py-3 text-gray-500">{inv.students?.classes?.name}</td>
            <td className="py-3 font-semibold text-rose-600">{formatCurrency(inv.amount_due)}</td>
            <td className="py-3 font-mono text-xs text-gray-400">{inv.invoice_number}</td>
            <td className="py-3">
              <span className={cn('px-2 py-1 rounded-full text-xs font-medium', STATUS_COLORS[inv.status])}>
                {inv.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FeeStructures() {
  const { data } = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => feeApi.structures.list().then(r => r.data),
  })

  if (!(data ?? []).length) return <Empty message="No fee structures configured yet" />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="pb-3 text-left font-medium text-gray-500">Class</th>
          <th className="pb-3 text-left font-medium text-gray-500">Fee Head</th>
          <th className="pb-3 text-left font-medium text-gray-500">Amount</th>
          <th className="pb-3 text-left font-medium text-gray-500">Frequency</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {(data ?? []).map((s: any) => (
          <tr key={s.id} className="hover:bg-gray-50">
            <td className="py-3 font-medium text-gray-900">{s.classes?.name}</td>
            <td className="py-3 text-gray-600">{s.fee_heads?.name}</td>
            <td className="py-3 font-semibold text-gray-900">{formatCurrency(s.amount)}</td>
            <td className="py-3 text-gray-500 capitalize">{s.frequency.replace('_', ' ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ═══════════════════════════════════════════════════════════════
// DISCOUNTS TAB — Fee Discount Approval Workflow
// ═══════════════════════════════════════════════════════════════
//
// - "New Discount" form: discounts < ₹2000 auto-approve immediately
//   (workflow engine's auto_approve_condition); >= ₹2000 sit as
//   'pending' awaiting Principal approval.
// - Approve/Reject buttons appear for pending discounts only when the
//   logged-in user is Principal or School Admin (workflow step 1 role
//   is "Principal"; School Admin always bypasses via actOnWorkflow).

const APPROVAL_STYLES: Record<string, { label: string, className: string, icon: any }> = {
  pending: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700', icon: Check },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700', icon: XCircle },
}

function DiscountsTab() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['fee-discounts'],
    queryFn: () => feeApi.discounts.list().then(r => r.data),
  })

  const canApprove = ['principal', 'school_admin'].includes(user?.role ?? '')

  const actionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: 'approved' | 'rejected' }) =>
      feeApi.discounts.workflowAction(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee-discounts'] })
      toast.success('Decision recorded')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Discounts under ₹2,000 auto-approve. ₹2,000 and above need Principal approval.</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New Discount
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : !(discounts ?? []).length ? (
        <Empty message="No discounts created yet" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="pb-3 text-left font-medium text-gray-500">Student</th>
              <th className="pb-3 text-left font-medium text-gray-500">Fee Head</th>
              <th className="pb-3 text-left font-medium text-gray-500">Discount</th>
              <th className="pb-3 text-left font-medium text-gray-500">Reason</th>
              <th className="pb-3 text-left font-medium text-gray-500">Status</th>
              <th className="pb-3 text-left font-medium text-gray-500">Created</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(discounts ?? []).map((d: any) => {
              const style = APPROVAL_STYLES[d.approval_status] ?? APPROVAL_STYLES.pending
              const Icon = style.icon
              return (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900">
                    {d.students?.first_name} {d.students?.last_name}
                  </td>
                  <td className="py-3 text-gray-600">{d.fee_heads?.name ?? 'All fees'}</td>
                  <td className="py-3 font-semibold text-gray-900">
                    {d.discount_type === 'percentage' ? `${d.discount_value}%` : formatCurrency(d.discount_value)}
                  </td>
                  <td className="py-3 text-gray-500">{d.reason}</td>
                  <td className="py-3">
                    <span className={cn('px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit', style.className)}>
                      <Icon className="w-3 h-3" /> {style.label}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400 text-xs">{formatDate(d.created_at)}</td>
                  <td className="py-3 text-right">
                    {d.approval_status === 'pending' && canApprove && (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => actionMutation.mutate({ id: d.id, status: 'approved' })}
                          disabled={actionMutation.isPending}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">
                          Approve
                        </button>
                        <button onClick={() => actionMutation.mutate({ id: d.id, status: 'rejected' })}
                          disabled={actionMutation.isPending}
                          className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">
                          Reject
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

      {showCreate && (
        <CreateDiscountModal onClose={() => {
          setShowCreate(false)
          qc.invalidateQueries({ queryKey: ['fee-discounts'] })
        }} />
      )}
    </div>
  )
}

function CreateDiscountModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<any>(null)
  const [form, setForm] = useState({
    student_id: '',
    discount_type: 'fixed' as 'fixed' | 'percentage',
    discount_value: '',
    reason: '',
  })
  const [loading, setLoading] = useState(false)

  const { data: students } = useQuery({
    queryKey: ['students-search', search],
    queryFn: () => studentsApi.list({ search, limit: 10 }).then(r => r.data),
    enabled: search.length > 1,
  })

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white"

  const handleSubmit = async () => {
    if (!form.student_id || !form.discount_value || !form.reason) {
      return toast.error('Please fill all required fields')
    }
    setLoading(true)
    try {
      const res = await feeApi.discounts.create({
        ...form,
        discount_value: Number(form.discount_value),
      })
      if (res.workflow?.auto_approved) {
        toast.success('Discount auto-approved (under ₹2,000)')
      } else {
        toast.success('Discount submitted — pending Principal approval')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create discount')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-gray-400" /> New Fee Discount
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Student *</label>
            {selectedStudent ? (
              <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 rounded-xl text-sm">
                <span className="font-medium text-indigo-900">{selectedStudent.first_name} {selectedStudent.last_name} · {selectedStudent.classes?.name}</span>
                <button onClick={() => { setForm(f => ({ ...f, student_id: '' })); setSelectedStudent(null); setSearch('') }} className="text-indigo-400 hover:text-indigo-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student by name..." autoComplete="off" />
                {search.length > 1 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg rounded-xl divide-y divide-gray-50 max-h-48 overflow-y-auto">
                    {(students ?? []).length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-400">No students found</p>
                    ) : (
                      (students ?? []).map((s: any) => (
                        <button key={s.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, student_id: s.id })); setSelectedStudent(s); setSearch('') }}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 transition-colors">
                          <span className="font-medium text-gray-900">{s.first_name} {s.last_name}</span>
                          <span className="text-gray-400"> · {s.classes?.name}{s.sections?.name ? `-${s.sections.name}` : ''}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Discount Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['fixed', 'percentage'] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, discount_type: t }))}
                  className={cn('px-3 py-2 rounded-xl border-2 text-sm font-medium capitalize transition-all',
                    form.discount_type === t ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500')}>
                  {t === 'fixed' ? 'Fixed (₹)' : 'Percentage (%)'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Discount Value * {form.discount_type === 'fixed' && <span className="text-xs text-gray-400">(under ₹2,000 auto-approves)</span>}
            </label>
            <input type="number" className={inputCls} value={form.discount_value}
              onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))}
              placeholder={form.discount_type === 'fixed' ? 'e.g. 1500' : 'e.g. 10'} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason *</label>
            <textarea rows={2} className={inputCls + ' resize-none'} value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Sibling discount, financial hardship..." />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Submit
          </button>
        </div>
      </div>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-gray-400">
      <p className="font-medium">{message}</p>
    </div>
  )
}
