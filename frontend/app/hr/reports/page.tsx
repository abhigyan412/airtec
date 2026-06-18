'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Users, Calendar, IndianRupee, Building2 } from 'lucide-react'
import Link from 'next/link'

const BAR_COLORS = ['bg-indigo-500','bg-emerald-500','bg-amber-500','bg-purple-500','bg-pink-500','bg-cyan-500','bg-rose-500','bg-teal-500']

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
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">HR Reports</h1>
            <p className="text-gray-500 text-sm mt-0.5">Headcount, leave and payroll analytics</p>
          </div>
        </div>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
          {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Headcount by Department */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" /> Headcount by Department</h3>
          {l1 ? <Skeleton /> : (headcount?.by_department ?? []).length === 0 ? <Empty text="No staff data" /> : (
            <div className="space-y-3">
              {(headcount?.by_department ?? []).map((d: any, i: number) => (
                <div key={d.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium">{d.name}</span>
                    <span className="text-gray-500">{d.count}</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', BAR_COLORS[i % BAR_COLORS.length])} style={{ width: `${(d.count/maxDept)*100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Employment Type breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-gray-400" /> Employment Type</h3>
          {l1 ? <Skeleton /> : (headcount?.by_employment_type ?? []).length === 0 ? <Empty text="No staff data" /> : (
            <div className="grid grid-cols-2 gap-3">
              {(headcount?.by_employment_type ?? []).map((t: any, i: number) => (
                <div key={t.name} className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{t.count}</p>
                  <p className="text-xs text-gray-500 capitalize mt-1">{t.name.replace('_',' ')}</p>
                </div>
              ))}
            </div>
          )}
          {(headcount?.by_status ?? []).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">By Status</p>
              <div className="flex flex-wrap gap-2">
                {(headcount?.by_status ?? []).map((s: any) => (
                  <span key={s.name} className="px-3 py-1 bg-gray-50 rounded-full text-xs font-medium text-gray-600 capitalize">
                    {s.name.replace('_',' ')}: <span className="font-bold text-gray-900">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Leave Summary */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> Leave Summary {year}</h3>
          {l2 ? <Skeleton /> : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{leaveSummary?.total_requests ?? 0}</p>
                  <p className="text-xs text-gray-500">Total Requests</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-emerald-700">{leaveSummary?.approved ?? 0}</p>
                  <p className="text-xs text-emerald-600">Approved</p>
                </div>
                <div className="bg-indigo-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-indigo-700">{leaveSummary?.total_days_taken ?? 0}</p>
                  <p className="text-xs text-indigo-600">Days Taken</p>
                </div>
              </div>
              {(leaveSummary?.by_leave_type ?? []).length === 0 ? <Empty text="No approved leaves yet" /> : (
                <div className="space-y-3">
                  {(leaveSummary?.by_leave_type ?? []).map((l: any, i: number) => (
                    <div key={l.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">{l.name}</span>
                        <span className="text-gray-500">{l.days} days</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', BAR_COLORS[i % BAR_COLORS.length])} style={{ width: `${(l.days/maxLeaveType)*100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Payroll Summary */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><IndianRupee className="w-4 h-4 text-gray-400" /> Monthly Payroll {year}</h3>
          {l3 ? <Skeleton /> : (payrollSummary?.monthly ?? []).length === 0 ? <Empty text="No payslips generated yet" /> : (
            <div className="space-y-3">
              {(payrollSummary?.monthly ?? []).map((m: any) => (
                <div key={m.month}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium">{MONTHS_SHORT[m.month-1]} ({m.count} staff)</span>
                    <span className="text-gray-900 font-semibold">₹{Number(m.net).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(m.net/maxPayroll)*100}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-100 flex justify-between text-sm font-bold text-gray-900">
                <span>Total Net Payout ({year})</span>
                <span>₹{(payrollSummary?.monthly ?? []).reduce((s: number, m: any) => s + m.net, 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />)}</div>
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 text-center py-6">{text}</p>
}
