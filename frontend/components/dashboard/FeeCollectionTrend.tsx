'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn, formatCurrency } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

// Local calendar date, not toISOString().slice(0,10) — that's UTC and
// would shift "today" back a day for part of the evening in IST, same
// bug class fixed elsewhere in this app.
function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgoLocal(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function FeeCollectionTrend() {
  const { can } = usePermissions()
  const canView = can('fee.view')
  const [mode, setMode] = useState<'monthly' | 'range'>('monthly')
  const [from, setFrom] = useState(() => daysAgoLocal(29))
  const [to, setTo] = useState(() => todayLocal())

  const { data, isLoading } = useQuery({
    queryKey: mode === 'monthly' ? ['dashboard-fee-trend', 'monthly'] : ['dashboard-fee-trend', 'range', from, to],
    queryFn: () =>
      mode === 'monthly'
        ? feeApi.collectionTrend(6).then(r => r.data)
        : feeApi.collectionTrendRange(from, to).then(r => r.data),
    enabled: canView && (mode === 'monthly' || (!!from && !!to && from <= to)),
  })

  if (!canView) return null
  const trend = data ?? []
  const hasAnyCollection = trend.some((t: any) => t.collected > 0)
  const rangeInvalid = mode === 'range' && from > to

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" /> Fee Collection Trend
          </CardTitle>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button onClick={() => setMode('monthly')}
              className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                mode === 'monthly' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              Monthly
            </button>
            <button onClick={() => setMode('range')}
              className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                mode === 'range' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              Custom Range
            </button>
          </div>
        </div>

        {mode === 'monthly' ? (
          <p className="text-xs text-muted-foreground">Last 6 months</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="h-8 w-auto text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={to} min={from} max={todayLocal()} onChange={e => setTo(e.target.value)} className="h-8 w-auto text-xs" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {rangeInvalid ? (
          <p className="py-14 text-center text-sm text-destructive">"From" must be on or before "to".</p>
        ) : isLoading ? (
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
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false}
                interval={mode === 'range' && trend.length > 10 ? 'preserveStartEnd' : 0} />
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
