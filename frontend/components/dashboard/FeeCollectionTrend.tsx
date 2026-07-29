'use client'
import { useQuery } from '@tanstack/react-query'
import { feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

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
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" /> Fee Collection Trend
        </CardTitle>
        <p className="text-xs text-muted-foreground">Last 6 months</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        ) : !hasAnyCollection ? (
          <EmptyState icon={TrendingUp} title="No fee collection recorded yet" className="py-14" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ left: -10, right: 10 }}>
              <defs>
                <linearGradient id="feeTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(243 75% 62%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(243 75% 62%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={(v) => v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`}
              />
              <Tooltip
                formatter={(value: any) => [formatCurrency(Number(value)), 'Collected']}
                contentStyle={{
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 12,
                  fontSize: 13,
                  background: 'hsl(var(--popover))',
                  color: 'hsl(var(--popover-foreground))',
                  boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)',
                }}
                cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
              />
              <Area type="monotone" dataKey="collected" stroke="hsl(243 75% 62%)" strokeWidth={2} fill="url(#feeTrendFill)" dot={{ r: 3, fill: 'hsl(243 75% 62%)' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
