'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Wallet, Receipt } from 'lucide-react'
import { studentsApi, feeApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  unpaid: 'bg-rose-100 text-rose-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

export default function PortalFeesPage() {
  // Fees is parent-only (see (portal)/layout.tsx nav) — this catches a
  // student navigating here directly by URL, not just hiding the tab.
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (user && user.role !== 'parent') router.replace('/')
  }, [user, router])

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['portal-fee-summary', me?.id],
    queryFn: () => feeApi.studentSummary(me.id).then(r => r.data),
    enabled: !!me?.id,
  })

  if (user && user.role !== 'parent') return null

  const summary = data?.summary
  const invoices: any[] = data?.invoices ?? []
  const payments: any[] = data?.payments ?? []

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-gray-400" /> Fees</h1>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Total Billed</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(summary?.totalBilled ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Paid</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary?.totalPaid ?? 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-5 col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Outstanding</p>
              <p className={cn('text-xl font-bold', (summary?.totalDue ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                {formatCurrency(summary?.totalDue ?? 0)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">Invoices</h3>
            </div>
            {invoices.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No invoices yet</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {invoices.map((inv: any) => (
                  <div key={inv.id} className="px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 font-mono">{inv.invoice_number}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {inv.due_date ? `Due ${formatDate(inv.due_date)}` : formatDate(inv.invoice_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(inv.total_amount)}</p>
                      <span className={cn('inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize', STATUS_STYLES[inv.status])}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Receipt className="w-4 h-4 text-gray-400" /> Payment History</h3>
            </div>
            {payments.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No payments recorded yet</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {payments.map((p: any) => (
                  <div key={p.id} className="px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 font-mono">{p.receipt_number}</p>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">{formatDate(p.payment_date)} · {p.payment_mode}</p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-600">{formatCurrency(p.amount_paid)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
