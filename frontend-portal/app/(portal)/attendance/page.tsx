'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react'
import { studentsApi, academicYearsApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const todayStr = new Date().toISOString().slice(0, 10)

// Same helper as the staff Report tab (frontend/app/(app)/attendance/page.tsx)
// — kept local rather than shared since it's a few lines and this is the
// only other place that needs "today, or the year's end if that's already
// past" as the year-to-date cutoff.
function useCurrentAcademicYear() {
  const { data } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const current = (data ?? []).find((y: any) => y.is_current) ?? data?.[0]
  if (!current) return null
  return { ...current, effective_end: current.end_date < todayStr ? current.end_date : todayStr }
}

export default function PortalAttendancePage() {
  const now = new Date()
  const [scope, setScope] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const academicYear = useCurrentAcademicYear()

  // class_id is ignored server-side for a parent/student account — the
  // backend always resolves and scopes to their own child regardless
  // of what's passed here (see the ownership-scoping fix on
  // GET /students/attendance/report).
  const monthQuery = useQuery({
    queryKey: ['portal-attendance-month', month, year],
    queryFn: () => studentsApi.getAttendanceReport('', month, year).then(r => r.data),
    enabled: scope === 'month',
  })
  const yearQuery = useQuery({
    queryKey: ['portal-attendance-year', academicYear?.start_date, academicYear?.effective_end],
    queryFn: () => studentsApi.getAttendanceReportRange('', academicYear!.start_date, academicYear!.effective_end).then(r => r.data),
    enabled: scope === 'year' && !!academicYear,
  })
  const { data, isLoading } = scope === 'month' ? monthQuery : yearQuery

  const student = (data?.students ?? [])[0]
  const workingDays = data?.working_days ?? 0
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)
  const periodLabel = scope === 'month' ? `${MONTHS[month - 1]} ${year}` : (academicYear ? `Academic Year ${academicYear.name}` : 'Academic Year')

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  const pctColor = (pct: number) =>
    pct >= 75 ? 'text-emerald-600 bg-emerald-50' : pct >= 50 ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50'

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-gray-400" /> Attendance</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button onClick={() => setScope('month')}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                scope === 'month' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              Month
            </button>
            <button onClick={() => setScope('year')}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                scope === 'year' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              Academic Year
            </button>
          </div>
          {scope === 'month' && (
            <div className="flex items-center gap-2">
              <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <span className="w-24 text-center text-sm font-medium text-gray-900 sm:w-32">{MONTHS[month - 1]} {year}</span>
              <button onClick={() => changeMonth(1)} disabled={isFutureMonth} className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          )}
        </div>
      </div>

      {scope === 'year' && !academicYear ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No academic year is configured for this school yet.
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : !student || workingDays === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No attendance was marked for {periodLabel} yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Present', count: student.present, color: 'bg-emerald-500' },
              { label: 'Absent', count: student.absent, color: 'bg-rose-500' },
              { label: 'Late', count: student.late, color: 'bg-amber-500' },
              { label: 'Leave', count: student.leave, color: 'bg-indigo-500' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">{s.label}</span>
                  <span className="text-lg font-bold text-gray-900">{s.count}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={cn('h-1.5 rounded-full', s.color)} style={{ width: `${workingDays > 0 ? Math.round((s.count / workingDays) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Overall attendance — {periodLabel}</p>
              <p className="text-xs text-gray-400 mt-0.5">{workingDays} working day{workingDays !== 1 ? 's' : ''}</p>
            </div>
            <span className={cn('px-3 py-1.5 rounded-full text-lg font-bold', pctColor(student.percentage))}>
              {student.percentage}%
            </span>
          </div>
        </>
      )}
    </div>
  )
}
