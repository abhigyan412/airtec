'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { ArrowLeft, Users, Calendar, IndianRupee, Building2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton as UiSkeleton } from '@/components/ui/skeleton'

// Theme-aware chart palette (reads well in light + dark).
const CHART_COLORS = [
  'hsl(243 75% 62%)',
  'hsl(152 62% 45%)',
  'hsl(38 92% 55%)',
  'hsl(262 70% 62%)',
  'hsl(280 65% 65%)',
  'hsl(199 89% 48%)',
  'hsl(0 84% 62%)',
  'hsl(173 58% 45%)',
]

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function HRReportsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  const { data: headcount, isLoading: l1 } = useQuery({
    queryKey: ['report-headcount'],
    queryFn: () => hrmsApi.reports.headcount().then(r => r.data),
  })

  const { data: leaveSummary, isLoading: l2 } = useQuery({
    queryKey: ['report-leave', year],
    queryFn: () => hrmsApi.reports.leaveSummary(year).then(r => r.data),
  })

  const { data: payrollSummary, isLoading: l3 } = useQuery({
    queryKey: ['report-payroll', year],
    queryFn: () => hrmsApi.reports.payrollSummary(year).then(r => r.data),
  })

  const maxDept = Math.max(1, ...(headcount?.by_department ?? []).map((d: any) => d.count))
  const maxLeaveType = Math.max(1, ...(leaveSummary?.by_leave_type ?? []).map((l: any) => l.days))
  const maxPayroll = Math.max(1, ...(payrollSummary?.monthly ?? []).map((m: any) => m.net))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
            <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">HR Reports</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Headcount, leave and payroll analytics</p>
          </div>
        </div>
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Headcount by Department */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-muted-foreground" /> Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {l1 ? <Skeleton /> : (headcount?.by_department ?? []).length === 0 ? <Empty text="No staff data" /> : (
              <div className="space-y-3">
                {(headcount?.by_department ?? []).map((d: any, i: number) => (
                  <div key={d.name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-foreground">{d.name}</span>
                      <span className="text-muted-foreground">{d.count}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(d.count / maxDept) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Employment Type breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-muted-foreground" /> Employment Type</CardTitle>
          </CardHeader>
          <CardContent>
            {l1 ? <Skeleton /> : (headcount?.by_employment_type ?? []).length === 0 ? <Empty text="No staff data" /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(headcount?.by_employment_type ?? []).map((t: any) => (
                  <div key={t.name} className="rounded-xl bg-muted p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{t.count}</p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">{t.name.replace('_', ' ')}</p>
                  </div>
                ))}
              </div>
            )}
            {(headcount?.by_status ?? []).length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">By Status</p>
                <div className="flex flex-wrap gap-2">
                  {(headcount?.by_status ?? []).map((s: any) => (
                    <span key={s.name} className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize text-muted-foreground">
                      {s.name.replace('_', ' ')}: <span className="font-bold text-foreground">{s.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leave Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4 text-muted-foreground" /> Leave Summary {year}</CardTitle>
          </CardHeader>
          <CardContent>
            {l2 ? <Skeleton /> : (
              <>
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="rounded-xl bg-muted p-3 text-center">
                    <p className="text-xl font-bold text-foreground">{leaveSummary?.total_requests ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Total Requests</p>
                  </div>
                  <div className="rounded-xl bg-success/10 p-3 text-center">
                    <p className="text-xl font-bold text-success">{leaveSummary?.approved ?? 0}</p>
                    <p className="text-xs text-success">Approved</p>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-3 text-center">
                    <p className="text-xl font-bold text-primary">{leaveSummary?.total_days_taken ?? 0}</p>
                    <p className="text-xs text-primary">Days Taken</p>
                  </div>
                </div>
                {(leaveSummary?.by_leave_type ?? []).length === 0 ? <Empty text="No approved leaves yet" /> : (
                  <div className="space-y-3">
                    {(leaveSummary?.by_leave_type ?? []).map((l: any, i: number) => (
                      <div key={l.name}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium text-foreground">{l.name}</span>
                          <span className="text-muted-foreground">{l.days} days</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${(l.days / maxLeaveType) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Payroll Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Monthly Payroll {year}</CardTitle>
          </CardHeader>
          <CardContent>
            {l3 ? <Skeleton /> : (payrollSummary?.monthly ?? []).length === 0 ? <Empty text="No payslips generated yet" /> : (
              <div className="space-y-3">
                {(payrollSummary?.monthly ?? []).map((m: any) => (
                  <div key={m.month}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-foreground">{MONTHS_SHORT[m.month - 1]} ({m.count} staff)</span>
                      <span className="font-semibold text-foreground">{formatCurrency(Number(m.net))}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(m.net / maxPayroll) * 100}%`, backgroundColor: CHART_COLORS[0] }} />
                    </div>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-3 text-sm font-bold text-foreground">
                  <span>Total Net Payout ({year})</span>
                  <span>{formatCurrency((payrollSummary?.monthly ?? []).reduce((s: number, m: any) => s + m.net, 0))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-3">{[1, 2, 3].map(i => <UiSkeleton key={i} className="h-8 rounded-lg" />)}</div>
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
}
