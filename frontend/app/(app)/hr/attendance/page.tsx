'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, ClipboardList, BarChart3, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

type Tab = 'mark' | 'report'
type RecordState = { status: string; check_in?: string; check_out?: string }

const STATUS_OPTIONS = [
  { key: 'present',  label: 'Present',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'absent',   label: 'Absent',   color: 'bg-red-100 text-red-700 border-red-200' },
  { key: 'half_day', label: 'Half Day', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'on_leave', label: 'On Leave', color: 'bg-purple-100 text-purple-700 border-purple-200' },
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function StaffAttendancePage() {
  const [tab, setTab] = useState<Tab>('mark')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Staff Attendance</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {tab === 'mark' ? 'Mark daily attendance for staff members' : 'Monthly attendance report and working-day percentage'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button onClick={() => setTab('mark')}
            className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === 'mark' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <ClipboardList className="w-4 h-4" /> Mark
          </button>
          <button onClick={() => setTab('report')}
            className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === 'report' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <BarChart3 className="w-4 h-4" /> Report
          </button>
        </div>
      </div>

      {tab === 'mark' ? <MarkTab /> : <ReportTab />}
    </div>
  )
}

// ── MARK TAB — daily marking sheet (unchanged behavior) ────────
function MarkTab() {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [records, setRecords] = useState<Record<string, RecordState>>({})

  const { data: staffData } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })

  const { data: existingAttendance, isLoading } = useQuery({
    queryKey: ['staff-attendance', date],
    queryFn: () => hrmsApi.attendance.list({ date }).then(r => r.data),
  })

  useEffect(() => {
    const init: Record<string, RecordState> = {}
    for (const a of existingAttendance ?? []) {
      init[a.user_id] = { status: a.status, check_in: a.check_in?.slice(0, 5), check_out: a.check_out?.slice(0, 5) }
    }
    setRecords(init)
  }, [existingAttendance])

  const saveMutation = useMutation({
    mutationFn: () => {
      const recs = Object.entries(records).map(([user_id, r]) => ({ user_id, ...r }))
      return hrmsApi.attendance.save({ date, records: recs })
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['staff-attendance'] })
      toast.success(`Attendance saved for ${res.data?.count ?? 0} staff`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const setStatus = (userId: string, status: string) => {
    setRecords(r => ({ ...r, [userId]: { ...r[userId], status } }))
  }

  const setTime = (userId: string, field: 'check_in' | 'check_out', value: string) => {
    setRecords(r => ({ ...r, [userId]: { ...r[userId], [field]: value, status: r[userId]?.status ?? 'present' } }))
  }

  const markAllPresent = () => {
    const all: Record<string, RecordState> = {}
    for (const s of staffData ?? []) all[s.id] = { ...records[s.id], status: 'present' }
    setRecords(all)
  }

  const stats = {
    present: Object.values(records).filter(r => r.status === 'present').length,
    absent: Object.values(records).filter(r => r.status === 'absent').length,
    marked: Object.keys(records).length,
    total: (staffData ?? []).length,
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 shadow-sm shadow-indigo-200">
          {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save Attendance
        </button>
      </div>

      {/* Date selector + stats */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none" />
        </div>
        <button onClick={markAllPresent}
          className="px-4 py-2.5 border border-emerald-200 text-emerald-700 text-sm font-medium rounded-xl hover:bg-emerald-50">
          Mark All Present
        </button>
        <div className="ml-auto flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.present}</p>
            <p className="text-xs text-gray-500">Present</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{stats.absent}</p>
            <p className="text-xs text-gray-500">Absent</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{stats.marked}/{stats.total}</p>
            <p className="text-xs text-gray-500">Marked</p>
          </div>
        </div>
      </div>

      {/* Staff list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Staff</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Check In</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Check Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(staffData ?? []).map((s: any) => {
                const rec: Partial<RecordState> = records[s.id] ?? {}
                return (
                  <tr key={s.id} className="hover:bg-gray-50/80">
                    <td className="px-5 py-3 font-semibold text-gray-900">{s.full_name}</td>
                    <td className="px-5 py-3 text-gray-500 capitalize text-xs">{s.role?.replace('_',' ')}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {STATUS_OPTIONS.map(opt => (
                          <button key={opt.key} onClick={() => setStatus(s.id, opt.key)}
                            className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border transition-all',
                              rec.status === opt.key ? opt.color : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300')}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <input type="time" value={rec.check_in ?? ''} onChange={e => setTime(s.id, 'check_in', e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-28" />
                    </td>
                    <td className="px-5 py-3">
                      <input type="time" value={rec.check_out ?? ''} onChange={e => setTime(s.id, 'check_out', e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-28" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── REPORT TAB — monthly per-staff rollup, same shape as the
// student attendance report (working days from the shared academic
// calendar: weekly-off + holidays) ──────────────────────────────
function ReportTab() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data, isLoading } = useQuery({
    queryKey: ['staff-attendance-report', month, year],
    queryFn: () => hrmsApi.attendance.report(month, year).then(r => r.data),
  })

  const staff = data?.staff ?? []
  const workingDays = data?.working_days ?? 0
  const holidaysInMonth = data?.holidays_in_month ?? 0

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)

  const pctColor = (pct: number) =>
    pct >= 75 ? 'text-green-600 bg-green-50' : pct >= 50 ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50'

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Month</label>
            <div className="flex items-center gap-2">
              <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <span className="text-sm font-medium text-gray-900 w-36 text-center">{MONTHS[month - 1]} {year}</span>
              <button onClick={() => changeMonth(1)} disabled={isFutureMonth}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          <div className="text-sm text-gray-500 text-right">
            Working days this month: <span className="font-semibold text-gray-900">{workingDays}</span>
            {holidaysInMonth > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">{holidaysInMonth} holiday{holidaysInMonth > 1 ? 's' : ''} excluded</p>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          Loading report...
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No staff found</p>
        </div>
      ) : workingDays === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No attendance was marked in {MONTHS[month - 1]} {year} yet.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">{MONTHS[month - 1]} {year}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-6 py-3 font-semibold">Staff</th>
                  <th className="px-3 py-3 font-semibold">Department</th>
                  <th className="px-3 py-3 font-semibold text-center">Present</th>
                  <th className="px-3 py-3 font-semibold text-center">Absent</th>
                  <th className="px-3 py-3 font-semibold text-center">Half Day</th>
                  <th className="px-3 py-3 font-semibold text-center">On Leave</th>
                  <th className="px-6 py-3 font-semibold text-center">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {staff.map((s: any) => (
                  <tr key={s.user_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{s.full_name}</p>
                      <p className="text-xs text-gray-400 capitalize">{s.role?.replace('_', ' ')}</p>
                    </td>
                    <td className="px-3 py-3 text-gray-500">{s.department ?? '—'}</td>
                    <td className="px-3 py-3 text-center font-mono text-gray-700">{s.present}</td>
                    <td className="px-3 py-3 text-center font-mono text-gray-700">{s.absent}</td>
                    <td className="px-3 py-3 text-center font-mono text-gray-700">{s.half_day}</td>
                    <td className="px-3 py-3 text-center font-mono text-gray-700">{s.on_leave}</td>
                    <td className="px-6 py-3 text-center">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', pctColor(s.percentage))}>
                        {s.percentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
