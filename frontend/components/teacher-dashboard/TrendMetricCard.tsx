'use client'
import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MetricTrend } from '@/lib/useTeacherDashboard'

// A StatCard variant for the two trend-tracked metrics (attendance %,
// homework completion %) — a delta arrow vs the previous 30-day period,
// plus a 5-point sparkline of the current period's shape. Kept separate
// from the shared StatCard (used on the admin dashboard too) rather than
// bolting a chart onto it.
export function TrendMetricCard({ label, icon: Icon, trend }: { label: string; icon: React.ComponentType<{ className?: string }>; trend: MetricTrend }) {
  const up = (trend.delta ?? 0) > 0
  const flat = trend.delta === 0
  const sparkData = trend.sparkline.map((v, i) => ({ i, v }))
  const hasSparkline = trend.sparkline.some(v => v != null)

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold tracking-tight text-foreground">{trend.value != null ? `${trend.value}%` : '—'}</p>
            {trend.delta != null && (
              <span className={cn(
                'inline-flex items-center gap-0.5 text-xs font-semibold',
                flat ? 'text-muted-foreground' : up ? 'text-success' : 'text-destructive',
              )}>
                {flat ? <Minus className="h-3 w-3" /> : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(trend.delta)}pp vs prior 30d
              </span>
            )}
          </div>
          {hasSparkline && (
            <div className="h-10 w-20">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`spark-${label.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(243 75% 62%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(243 75% 62%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="hsl(243 75% 62%)" strokeWidth={1.5}
                    fill={`url(#spark-${label.replace(/\s+/g, '')})`} connectNulls dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
