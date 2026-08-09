'use client'
import { useState, type ComponentType, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import {
  ArrowLeft, Users, Calendar, IndianRupee, Building2, BarChart3, UserMinus,
  UserCheck, FileWarning, Clock, Send, Printer, Download, Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton as UiSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { HrQuickNav } from '@/components/hr/HrQuickNav'

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

// Simple "current vs previous" delta, matching StatCard's own trend prop
// (positive = up). Callers decide whether "up" is good or bad for that
// particular metric.
function pctDelta(current: number, previous: number): number | undefined {
  if (previous === 0) return current === 0 ? undefined : 100
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function buildReportCSV(opts: { year: number; department: string; headcount: any; leaveSummary: any; payrollSummary: any; analytics: any }) {
  const { year, department, headcount, leaveSummary, payrollSummary, analytics } = opts
  const lines: string[] = []
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const row = (...cells: any[]) => lines.push(cells.map(esc).join(','))

  row(`HR Reports — ${year}${department ? ` — ${department}` : ' — All Departments'}`)
  row('')
  row('KPIs')
  row('Attrition Rate %', analytics?.kpis?.attrition_rate_pct)
  row('Avg Attendance %', analytics?.kpis?.avg_attendance_pct)
  row('Total Payroll YTD', analytics?.kpis?.total_payroll_ytd)
  row('Open Positions', analytics?.kpis?.open_positions)
  row('Documents Expiring (30 days)', analytics?.kpis?.documents_expiring)
  row('')

  row('Headcount by Department', 'Count')
  for (const d of headcount?.by_department ?? []) row(d.name, d.count)
  row('')
  row('Employment Type', 'Count')
  for (const t of headcount?.by_employment_type ?? []) row(t.name, t.count)
  row('')
  row('Status', 'Count')
  for (const s of headcount?.by_status ?? []) row(s.name, s.count)
  row('')

  row('Leave Summary')
  row('Total Requests', leaveSummary?.total_requests)
  row('Approved', leaveSummary?.approved)
  row('Days Taken', leaveSummary?.total_days_taken)
  row('Unpaid Emergency Days (attendance-marked, no application)', leaveSummary?.unpaid_emergency_days)
  row('By Leave Type', 'Days')
  for (const l of leaveSummary?.by_leave_type ?? []) row(l.name, l.days)
  row('')

  row('Monthly Payroll', 'Staff', 'Gross', 'Deductions', 'Net')
  for (const m of payrollSummary?.monthly ?? []) row(MONTHS_SHORT[m.month - 1], m.count, m.gross, m.deductions, m.net)
  row('Total Net Payout', '', '', '', (payrollSummary?.monthly ?? []).reduce((s: number, m: any) => s + m.net, 0))
  row('')

  row('Attrition')
  row('Turnover Rate %', analytics?.attrition?.turnover_rate_pct)
  row('Exits', analytics?.attrition?.exit_count)
  row('Avg Tenure at Exit (days)', analytics?.attrition?.avg_tenure_days)
  row('By Department', 'Count')
  for (const d of analytics?.attrition?.by_department ?? []) row(d.name, d.count)
  row('By Reason', 'Count')
  for (const r of analytics?.attrition?.by_reason ?? []) row(r.name, r.count)
  row('')

  row('Attendance Analytics')
  row('Avg Attendance %', analytics?.attendance?.avg_attendance_pct)
  row('Total LOP Days', analytics?.attendance?.total_lop_days)
  row('By Department Absenteeism %')
  for (const d of analytics?.attendance?.by_department_absenteeism ?? []) row(d.name, d.absent_pct)
  row('Unmarked Days by Month')
  for (const m of analytics?.attendance?.unmarked_trend ?? []) row(MONTHS_SHORT[m.month - 1], m.unmarked)
  row('')

  row('Recruitment Funnel')
  row('Total Applications', analytics?.recruitment?.total_applications)
  row('Avg Time to Hire (days)', analytics?.recruitment?.avg_time_to_hire_days)
  row('Applied-to-Offer Rate %', analytics?.recruitment?.applied_to_offer_rate_pct)
  row('Offers Accepted', analytics?.recruitment?.offers_accepted)
  row('Offers Declined', analytics?.recruitment?.offers_declined)
  row('')

  row('Payroll Cost')
  row('Total PF Liability', analytics?.payroll_cost?.total_pf)
  row('Total Professional Tax Liability', analytics?.payroll_cost?.total_pt)
  row('Total TDS Liability', analytics?.payroll_cost?.total_tds)
  row('Avg Cost per Employee', analytics?.payroll_cost?.avg_cost_per_employee)
  row('By Department Cost')
  for (const d of analytics?.payroll_cost?.by_department ?? []) row(d.name, d.cost)
  row('')

  row('Document Compliance')
  row('Expiring This Quarter', analytics?.documents?.expiring_this_quarter)
  row('Staff With No Documents On File', analytics?.documents?.staff_with_no_documents)

  return lines.join('\r\n')
}

export default function HRReportsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [department, setDepartment] = useState('')
  const [compareYoY, setCompareYoY] = useState(false)

  const { data: headcount, isLoading: l1 } = useQuery({
    queryKey: ['report-headcount', department],
    queryFn: () => hrmsApi.reports.headcount(department || undefined).then(r => r.data),
  })

  const { data: leaveSummary, isLoading: l2 } = useQuery({
    queryKey: ['report-leave', year, department],
    queryFn: () => hrmsApi.reports.leaveSummary(year, department || undefined).then(r => r.data),
  })

  const { data: payrollSummary, isLoading: l3 } = useQuery({
    queryKey: ['report-payroll', year, department],
    queryFn: () => hrmsApi.reports.payrollSummary(year, department || undefined).then(r => r.data),
  })

  // Attrition, Attendance, Recruitment and Payroll Cost all come from one
  // consolidated endpoint (same shape as the Principal Dashboard's own
  // single big aggregation call) — compare=true computes the previous
  // year for all four together in one pass rather than four separate
  // round trips, so the YoY toggle is shared across this group instead
  // of four independent ones that would just refire the same query.
  const { data: analytics, isLoading: l4 } = useQuery({
    queryKey: ['report-analytics', year, department, compareYoY],
    queryFn: () => hrmsApi.reports.analytics(year, department || undefined, compareYoY).then(r => r.data),
  })

  const maxDept = Math.max(1, ...(headcount?.by_department ?? []).map((d: any) => d.count))
  const maxLeaveType = Math.max(1, ...(leaveSummary?.by_leave_type ?? []).map((l: any) => l.days))
  const maxPayroll = Math.max(1, ...(payrollSummary?.monthly ?? []).map((m: any) => m.net))
  const maxAttritionDept = Math.max(1, ...(analytics?.attrition?.by_department ?? []).map((d: any) => d.count))
  const maxAttritionReason = Math.max(1, ...(analytics?.attrition?.by_reason ?? []).map((r: any) => r.count))
  const maxAbsenteeism = Math.max(1, ...(analytics?.attendance?.by_department_absenteeism ?? []).map((d: any) => d.absent_pct))
  const maxUnmarked = Math.max(1, ...(analytics?.attendance?.unmarked_trend ?? []).map((m: any) => m.unmarked))
  const maxCostDept = Math.max(1, ...(analytics?.payroll_cost?.by_department ?? []).map((d: any) => d.cost))

  const handleDownloadCSV = () => {
    const csv = buildReportCSV({ year, department, headcount, leaveSummary, payrollSummary, analytics })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr-report-${year}${department ? `-${department.replace(/\s+/g, '_')}` : ''}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Print stylesheet — same .no-print convention already used on
          every server-rendered document (TC/report card/payslip/relieving
          letter) print button, reused here on this page's own controls
          instead of needing a separate print-only route. */}
      <style>{`@media print { .no-print { display: none !important } }`}</style>

      <div className="flex items-start gap-2 no-print">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="HR Reports"
          description="Headcount, leave, attrition, attendance, recruitment, payroll cost and document compliance analytics"
          icon={BarChart3}
          actions={
            <>
              <HrQuickNav current="reports" />
              <Select value={department || 'all'} onValueChange={v => setDepartment(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[170px]" aria-label="Department filter"><SelectValue placeholder="All Departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {(headcount?.by_department ?? []).map((d: any) => (
                    <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-[110px]" aria-label="Report year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button>
              <Button variant="outline" onClick={handleDownloadCSV}><Download className="h-4 w-4" /> Download CSV</Button>
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Headcount by Department */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-muted-foreground" /> Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {l1 ? <Skeleton /> : (headcount?.by_department ?? []).length === 0 ? (
              <Empty icon={Building2} title="No departments yet" description="Set a department on staff profiles and the split will show up here." />
            ) : (
              <div className="space-y-3">
                {(headcount?.by_department ?? []).map((d: any, i: number) => (
                  <div key={d.name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-foreground">{d.name}</span>
                      <span className="tabular-nums text-muted-foreground">{d.count}</span>
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
            {l1 ? <Skeleton /> : (headcount?.by_employment_type ?? []).length === 0 ? (
              <Empty icon={Users} title="No staff on record" description="Add staff under Staff & HR and their employment types will be broken down here." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(headcount?.by_employment_type ?? []).map((t: any) => (
                  <div key={t.name} className="rounded-xl bg-muted p-4 text-center">
                    <p className="text-2xl font-bold tabular-nums text-foreground">{t.count}</p>
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
                      {s.name.replace('_', ' ')}: <span className="font-bold tabular-nums text-foreground">{s.count}</span>
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
                    <p className="text-xl font-bold tabular-nums text-foreground">{leaveSummary?.total_requests ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Total Requests</p>
                  </div>
                  <div className="rounded-xl bg-success/10 p-3 text-center">
                    <p className="text-xl font-bold tabular-nums text-success">{leaveSummary?.approved ?? 0}</p>
                    <p className="text-xs text-success">Approved</p>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-3 text-center">
                    <p className="text-xl font-bold tabular-nums text-primary">{leaveSummary?.total_days_taken ?? 0}</p>
                    <p className="text-xs text-primary">Days Taken</p>
                  </div>
                </div>
                {(leaveSummary?.by_leave_type ?? []).length === 0 ? (
                  <Empty icon={Calendar} title={`No approved leave in ${year}`} description="Once leave requests are approved, the days taken per leave type appear here." />
                ) : (
                  <div className="space-y-3">
                    {(leaveSummary?.by_leave_type ?? []).map((l: any, i: number) => (
                      <div key={l.name}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium text-foreground">{l.name}</span>
                          <span className="tabular-nums text-muted-foreground">{l.days} days</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${(l.days / maxLeaveType) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(leaveSummary?.unpaid_emergency_days ?? 0) > 0 && (
                  <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    Plus <span className="font-semibold text-foreground">{leaveSummary.unpaid_emergency_days} day{leaveSummary.unpaid_emergency_days === 1 ? '' : 's'}</span> of unpaid emergency absence — marked directly on the attendance sheet, not via a leave application.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Monthly Payroll */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Monthly Payroll {year}</CardTitle>
          </CardHeader>
          <CardContent>
            {l3 ? <Skeleton /> : (payrollSummary?.monthly ?? []).length === 0 ? (
              <Empty icon={IndianRupee} title={`No payslips generated for ${year}`} description="Run a payroll month under Staff & HR → Payroll and the monthly payout appears here." />
            ) : (
              <div className="space-y-3">
                {(payrollSummary?.monthly ?? []).map((m: any) => (
                  <div key={m.month}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-foreground">{MONTHS_SHORT[m.month - 1]} ({m.count} staff)</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(m.net))}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(m.net / maxPayroll) * 100}%`, backgroundColor: CHART_COLORS[0] }} />
                    </div>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-3 text-sm font-bold text-foreground">
                  <span>Total Net Payout ({year})</span>
                  <span className="tabular-nums">{formatCurrency((payrollSummary?.monthly ?? []).reduce((s: number, m: any) => s + m.net, 0))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attrition / Turnover */}
        <Card>
          <PanelHeader icon={UserMinus} title={`Attrition ${year}`} compareYoY={compareYoY} onToggle={() => setCompareYoY(v => !v)} />
          <CardContent>
            {l4 ? <Skeleton /> : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <StatBlock
                    label="Turnover Rate"
                    value={`${analytics?.attrition?.turnover_rate_pct ?? 0}%`}
                    trend={compareYoY && analytics?.previous ? pctDelta(analytics.attrition.turnover_rate_pct, analytics.previous.attrition.turnover_rate_pct) : undefined}
                    goodDirection="down"
                  />
                  <StatBlock label="Avg Tenure at Exit" value={`${((analytics?.attrition?.avg_tenure_days ?? 0) / 365).toFixed(1)} yrs`} />
                </div>
                {(analytics?.attrition?.by_department ?? []).length === 0 ? (
                  <Empty icon={UserMinus} title={`No exits recorded in ${year}`} description="Resignations processed through Staff Exit will show up here." />
                ) : (
                  <>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">By Department</p>
                    <div className="space-y-2.5">
                      {(analytics?.attrition?.by_department ?? []).map((d: any, i: number) => (
                        <MiniBar key={d.name} label={d.name} value={d.count} max={maxAttritionDept} color={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </div>
                    <p className="mb-2 mt-4 text-xs font-semibold uppercase text-muted-foreground">By Reason</p>
                    <div className="space-y-2.5">
                      {(analytics?.attrition?.by_reason ?? []).map((r: any, i: number) => (
                        <MiniBar key={r.name} label={r.name} value={r.count} max={maxAttritionReason} color={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Attendance Analytics */}
        <Card>
          <PanelHeader icon={UserCheck} title={`Attendance Analytics ${year}`} compareYoY={compareYoY} onToggle={() => setCompareYoY(v => !v)} />
          <CardContent>
            {l4 ? <Skeleton /> : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <StatBlock
                    label="Avg Attendance"
                    value={`${analytics?.attendance?.avg_attendance_pct ?? 0}%`}
                    trend={compareYoY && analytics?.previous ? pctDelta(analytics.attendance.avg_attendance_pct, analytics.previous.attendance.avg_attendance_pct) : undefined}
                    goodDirection="up"
                  />
                  <StatBlock label="Total LOP Days" value={analytics?.attendance?.total_lop_days ?? 0} />
                </div>
                {(analytics?.attendance?.by_department_absenteeism ?? []).length > 0 && (
                  <>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Top Departments by Absenteeism</p>
                    <div className="space-y-2.5">
                      {(analytics?.attendance?.by_department_absenteeism ?? []).map((d: any, i: number) => (
                        <MiniBar key={d.name} label={d.name} value={`${d.absent_pct}%`} rawValue={d.absent_pct} max={maxAbsenteeism} color={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </div>
                  </>
                )}
                {(analytics?.attendance?.unmarked_trend ?? []).length > 0 && (
                  <>
                    <p className="mb-2 mt-4 text-xs font-semibold uppercase text-muted-foreground">Unmarked Days Trend</p>
                    <div className="flex items-end gap-1.5" style={{ height: 80 }}>
                      {(analytics?.attendance?.unmarked_trend ?? []).map((m: any) => (
                        <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${MONTHS_SHORT[m.month - 1]}: ${m.unmarked} unmarked`}>
                          <div className="w-full rounded-t bg-warning/70" style={{ height: `${Math.max(4, (m.unmarked / maxUnmarked) * 64)}px` }} />
                          <span className="text-[10px] text-muted-foreground">{MONTHS_SHORT[m.month - 1]}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recruitment Funnel */}
        <Card>
          <PanelHeader icon={Send} title={`Recruitment Funnel ${year}`} compareYoY={compareYoY} onToggle={() => setCompareYoY(v => !v)} />
          <CardContent>
            {l4 ? <Skeleton /> : (analytics?.recruitment?.total_applications ?? 0) === 0 ? (
              <Empty icon={Send} title={`No applications in ${year}`} description="Applications added under Recruitment will feed this funnel." />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <StatBlock
                  label="Avg Time to Hire"
                  value={`${analytics?.recruitment?.avg_time_to_hire_days ?? 0}d`}
                  icon={Clock}
                  trend={compareYoY && analytics?.previous ? pctDelta(analytics.recruitment.avg_time_to_hire_days, analytics.previous.recruitment.avg_time_to_hire_days) : undefined}
                  goodDirection="down"
                />
                <StatBlock
                  label="Applied → Offer Rate"
                  value={`${analytics?.recruitment?.applied_to_offer_rate_pct ?? 0}%`}
                  trend={compareYoY && analytics?.previous ? pctDelta(analytics.recruitment.applied_to_offer_rate_pct, analytics.previous.recruitment.applied_to_offer_rate_pct) : undefined}
                  goodDirection="up"
                />
                <StatBlock label="Offers Accepted" value={analytics?.recruitment?.offers_accepted ?? 0} accent="success" />
                <StatBlock label="Offers Declined" value={analytics?.recruitment?.offers_declined ?? 0} accent="destructive" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payroll Cost Breakdown */}
        <Card>
          <PanelHeader icon={Wallet} title={`Payroll Cost ${year}`} compareYoY={compareYoY} onToggle={() => setCompareYoY(v => !v)} />
          <CardContent>
            {l4 ? <Skeleton /> : (
              <>
                <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatBlock label="Total PF" value={formatCurrency(Number(analytics?.payroll_cost?.total_pf ?? 0))} compact />
                  <StatBlock label="Total Prof. Tax" value={formatCurrency(Number(analytics?.payroll_cost?.total_pt ?? 0))} compact />
                  <StatBlock label="Total TDS" value={formatCurrency(Number(analytics?.payroll_cost?.total_tds ?? 0))} compact />
                  <StatBlock label="Avg Cost / Employee" value={formatCurrency(Number(analytics?.payroll_cost?.avg_cost_per_employee ?? 0))} compact />
                </div>
                {(analytics?.payroll_cost?.by_department ?? []).length === 0 ? (
                  <Empty icon={Wallet} title={`No payslips generated for ${year}`} description="Cost per department appears once payroll has been generated." />
                ) : (
                  <>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Cost by Department (Gross + Employer PF)</p>
                    <div className="space-y-2.5">
                      {(analytics?.payroll_cost?.by_department ?? []).map((d: any, i: number) => (
                        <MiniBar key={d.name} label={d.name} value={formatCurrency(d.cost)} rawValue={d.cost} max={maxCostDept} color={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Document Compliance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FileWarning className="h-4 w-4 text-muted-foreground" /> Document Compliance</CardTitle>
          </CardHeader>
          <CardContent>
            {l4 ? <Skeleton /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StatBlock label="Expiring This Quarter" value={analytics?.documents?.expiring_this_quarter ?? 0} accent="warning" />
                <StatBlock label="Staff With No Documents On File" value={analytics?.documents?.staff_with_no_documents ?? 0} accent="destructive"
                  hint="No 'required document' list exists in this app — this counts staff with zero documents uploaded at all, not missing specific types." />
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

// Compact EmptyState — these sit inside a report card, so the shared
// component's default vertical padding is dialled down.
function Empty({ icon, title, description }: { icon: ComponentType<{ className?: string }>, title: string, description: string }) {
  return <EmptyState icon={icon} title={title} description={description} className="px-0 py-8" />
}

// Shared header for the 4 panels driven by the compare-able analytics
// endpoint — a small pill toggle instead of four independent ones,
// since the backend computes all four together in a single pass.
function PanelHeader({ icon: Icon, title, compareYoY, onToggle }: { icon: ComponentType<{ className?: string }>, title: string, compareYoY: boolean, onToggle: () => void }) {
  return (
    <CardHeader className="flex-row items-center justify-between space-y-0">
      <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-muted-foreground" /> {title}</CardTitle>
      <button
        onClick={onToggle}
        className={cn(
          'no-print rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          compareYoY ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
        )}
      >
        vs previous year
      </button>
    </CardHeader>
  )
}

function StatBlock({ label, value, icon: Icon, trend, goodDirection, accent, compact, hint }: {
  label: string; value: ReactNode; icon?: ComponentType<{ className?: string }>
  trend?: number; goodDirection?: 'up' | 'down'; accent?: 'success' | 'destructive' | 'warning'; compact?: boolean; hint?: string
}) {
  // StatCard's arrow always reads "up = success", but for some metrics
  // (turnover, time-to-hire, absenteeism) up is bad — flip the sign fed
  // to it so the arrow color matches what actually happened, not the
  // raw number's direction.
  const displayTrend = trend === undefined ? undefined : goodDirection === 'down' ? -trend : trend
  return (
    <div className={cn('rounded-xl p-3', accent === 'success' ? 'bg-success/10' : accent === 'destructive' ? 'bg-destructive/10' : accent === 'warning' ? 'bg-warning/10' : 'bg-muted')}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={cn('mt-1 font-bold tabular-nums text-foreground', compact ? 'text-base' : 'text-xl')}>{value}</p>
      {displayTrend !== undefined && (
        <p className={cn('text-xs font-semibold', displayTrend >= 0 ? 'text-success' : 'text-destructive')}>
          {displayTrend >= 0 ? '↑' : '↓'} {Math.abs(displayTrend)}pp vs last year
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function MiniBar({ label, value, rawValue, max, color }: { label: string; value: ReactNode; rawValue?: number; max: number; color: string }) {
  const width = ((rawValue ?? Number(value)) / max) * 100
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}
