'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react'
import { studentsApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function PortalAttendancePage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  // class_id is ignored server-side for a parent/student account — the
  // backend always resolves and scopes to their own child regardless
  // of what's passed here (see the ownership-scoping fix on
  // GET /students/attendance/report).
  const { data, isLoading } = useQuery({
    queryKey: ['portal-attendance', month, year],
    queryFn: () => studentsApi.getAttendanceReport('', month, year).then(r => r.data),
  })

  const student = (data?.students ?? [])[0]
  const workingDays = data?.working_days ?? 0
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)

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
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-gray-400" /> Attendance</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <span className="text-sm font-medium text-gray-900 w-36 text-center">{MONTHS[month - 1]} {year}</span>
          <button onClick={() => changeMonth(1)} disabled={isFutureMonth} className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : !student || workingDays === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No attendance was marked for {MONTHS[month - 1]} {year} yet.
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
              <p className="text-sm text-gray-500">Overall attendance this month</p>
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
