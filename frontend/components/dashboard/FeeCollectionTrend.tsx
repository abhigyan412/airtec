'use client'
import { useQuery } from '@tanstack/react-query'
import { feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp } from 'lucide-react'

export function FeeCollectionTrend() {
  const { can } = usePermissions()
  const canView = can('fee.view')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-fee-trend'],
    queryFn: () => feeApi.collectionTrend(6).then(r => r.data),
    enabled: canView,
  })

  if (!canView) return null
  const trend = data ?? []
  const hasAnyCollection = trend.some((t: any) => t.collected > 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-400" /> Fee Collection Trend
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
        </div>
      </div>
      {isLoading ? (
        <div className="h-[220px] bg-gray-50 rounded-xl animate-pulse" />
      ) : !hasAnyCollection ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
          <TrendingUp className="w-10 h-10 mb-2" />
          <p className="text-sm text-gray-400">No fee collection recorded yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trend} margin={{ left: -10, right: 10 }}>
            <defs>
              <linearGradient id="feeTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={60}
              tickFormatter={(v) => v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`} />
            <Tooltip
              formatter={(value: any) => [formatCurrency(Number(value)), 'Collected']}
              contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
              cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }}
            />
            <Area type="monotone" dataKey="collected" stroke="#6366f1" strokeWidth={2} fill="url(#feeTrendFill)" dot={{ r: 3, fill: '#6366f1' }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
