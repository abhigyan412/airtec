'use client'
import { Wallet } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatCurrency } from '@/lib/utils'
import { usePrincipalDashboard } from '@/lib/usePrincipalDashboard'

// One summary chart only — invoiced vs collected, monthly. No invoice
// list, no student names; that operational detail stays admin-only on
// the Fees module.
export function FeeCollectionChart() {
  const { data, isLoading } = usePrincipalDashboard()
  const trend = data?.fee_collection_trend ?? []
  const hasData = trend.some(t => t.invoiced > 0 || t.collected > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" /> Fee Collection
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Invoiced vs collected, last 6 months</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[240px] w-full rounded-xl" />
        ) : !hasData ? (
          <EmptyState icon={Wallet} title="No fee activity recorded yet" className="py-14" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend} barGap={4} margin={{ left: -10, right: 10 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false} axisLine={false} width={60}
                tickFormatter={(v) => v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`}
              />
              <Tooltip
                formatter={(value: any, name: any) => [formatCurrency(Number(value)), name === 'invoiced' ? 'Invoiced' : 'Collected']}
                contentStyle={{ border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 13, background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)' }}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'invoiced' ? 'Invoiced' : 'Collected'} />
              <Bar dataKey="invoiced" fill="hsl(243 30% 80%)" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="collected" fill="hsl(243 75% 62%)" radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
