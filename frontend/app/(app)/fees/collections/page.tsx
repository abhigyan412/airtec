'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { ArrowLeft, AlertTriangle, Phone, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const BUCKET_LABELS: Record<string, { label: string, color: string }> = {
  current: { label: 'Current (Not Due)', color: 'bg-gray-100 text-gray-600' },
  '1_30': { label: '1-30 Days', color: 'bg-amber-100 text-amber-700' },
  '31_60': { label: '31-60 Days', color: 'bg-orange-100 text-orange-700' },
  '61_90': { label: '61-90 Days', color: 'bg-red-100 text-red-700' },
  '90_plus': { label: '90+ Days', color: 'bg-red-200 text-red-800' },
}

export default function CollectionsPage() {
  const qc = useQueryClient()
  const [minDays, setMinDays] = useState(30)
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null)

  const { data: aging, isLoading: agingLoading } = useQuery({
    queryKey: ['aging-report'],
    queryFn: () => feeApi.agingReport().then(r => r.data),
  })

  const { data: defaulters, isLoading: defaultersLoading } = useQuery({
    queryKey: ['defaulters', minDays],
    queryFn: () => feeApi.defaulters(minDays).then(r => r.data),
  })

  const lateFineMutation = useMutation({
    mutationFn: () => feeApi.applyLateFines(),
    onSuccess: (res: any) => {
      toast.success(`Late fines updated on ${res.data?.updated ?? 0} overdue invoice(s)`)
      qc.invalidateQueries({ queryKey: ['aging-report'] })
      qc.invalidateQueries({ queryKey: ['defaulters'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const summary = aging?.summary ?? {}
  const bucketOrder = ['current', '1_30', '31_60', '61_90', '90_plus']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/fees" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Collections & Dues</h1>
            <p className="text-gray-500 text-sm mt-0.5">Aging report, defaulter tracking, and overdue management</p>
          </div>
        </div>
        <button onClick={() => lateFineMutation.mutate()} disabled={lateFineMutation.isPending}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 disabled:opacity-60">
          {lateFineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Recalculate Late Fines
        </button>
      </div>

      {/* Aging buckets */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Aging Report</p>
        {agingLoading ? (
          <div className="h-20 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {bucketOrder.map(key => {
              const b = summary[key] ?? { count: 0, total: 0 }
              const config = BUCKET_LABELS[key]
              return (
                <div key={key} className="rounded-xl border border-gray-100 p-4">
                  <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-2', config.color)}>
                    {config.label}
                  </span>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(b.total)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{b.count} invoice{b.count !== 1 ? 's' : ''}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Defaulters */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Defaulters ({defaulters?.length ?? 0})
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Overdue by at least</label>
            <select value={minDays} onChange={e => setMinDays(Number(e.target.value))}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none">
              <option value={0}>Any</option>
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        </div>

        {defaultersLoading ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" /></div>
        ) : !(defaulters ?? []).length ? (
          <div className="p-12 text-center text-gray-400">
            <p className="font-medium">No defaulters found 🎉</p>
            <p className="text-sm mt-1">No students overdue by {minDays}+ days</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Class</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Outstanding</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Max Days Overdue</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Parent Contact</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(defaulters ?? []).map((d: any) => {
                const isExpanded = expandedStudent === d.student.id
                return (
                  <>
                    <tr key={d.student.id} onClick={() => setExpandedStudent(isExpanded ? null : d.student.id)}
                      className="hover:bg-gray-50/80 cursor-pointer transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-gray-900">
                        {d.student.first_name} {d.student.last_name}
                        <p className="text-xs text-gray-400 font-mono">{d.student.admission_number}</p>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600">
                        {d.student.classes?.name}{d.student.sections?.name ? ` · ${d.student.sections.name}` : ''}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-rose-600">{formatCurrency(d.total_outstanding)}</td>
                      <td className="px-5 py-3.5">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold',
                          d.max_days_overdue > 90 ? 'bg-red-200 text-red-800' :
                          d.max_days_overdue > 60 ? 'bg-red-100 text-red-700' :
                          d.max_days_overdue > 30 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700')}>
                          {d.max_days_overdue} days
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500">
                        {d.parent_contact?.father_phone && (
                          <span className="flex items-center gap-1 text-xs">
                            <Phone className="w-3 h-3 text-gray-400" /> {d.parent_contact.father_phone}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${d.student.id}-detail`}>
                        <td colSpan={6} className="px-5 py-3 bg-gray-50/60">
                          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{d.invoice_count} overdue invoice{d.invoice_count !== 1 ? 's' : ''}</p>
                          <div className="space-y-1.5">
                            {d.invoices.map((inv: any) => (
                              <div key={inv.id} className="flex items-center justify-between text-sm">
                                <span className="font-mono text-xs text-gray-500">{inv.invoice_number}</span>
                                <span className="text-gray-600">{inv.days_overdue} days overdue</span>
                                <span className="font-semibold text-rose-600">{formatCurrency(inv.amount_due)}</span>
                              </div>
                            ))}
                          </div>
                          {d.parent_contact && (
                            <p className="text-xs text-gray-400 mt-2">
                              {d.parent_contact.father_name} · {d.parent_contact.father_phone}
                              {d.parent_contact.mother_name && ` · ${d.parent_contact.mother_name} · ${d.parent_contact.mother_phone}`}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}