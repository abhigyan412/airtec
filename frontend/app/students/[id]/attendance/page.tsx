'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  present: 'bg-green-500 text-white',
  absent:  'bg-red-500 text-white',
  late:    'bg-yellow-500 text-white',
  leave:   'bg-blue-500 text-white',
  holiday: 'bg-gray-300 text-gray-600',
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function StudentAttendancePage() {
  const { id } = useParams<{ id: string }>()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data: student } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  const { data: attData, isLoading } = useQuery({
    queryKey: ['student-attendance', id, month, year],
    queryFn: () => studentsApi.getAttendance(id, month, year).then(r => r.data),
  })

  const records = attData?.records ?? []
  const summary = attData?.summary ?? { present: 0, absent: 0, late: 0, total: 0, percentage: 0 }

  const getStatusForDate = (dateStr: string) => {
    return records.find((r: any) => r.date === dateStr)?.status
  }

  // Build calendar
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m)
    setYear(y)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/students/${id}`} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Attendance — {student?.first_name} {student?.last_name}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">{student?.classes?.name}</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Present',    value: summary.present,    color: 'text-green-600 bg-green-50' },
          { label: 'Absent',     value: summary.absent,     color: 'text-red-600 bg-red-50' },
          { label: 'Late',       value: summary.late,       color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Attendance', value: `${summary.percentage}%`, color: 'text-indigo-600 bg-indigo-50' },
        ].map(s => (
          <div key={s.label} className={cn('rounded-2xl p-4 text-center', s.color)}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-500" />
          </button>
          <h3 className="font-semibold text-gray-900 text-lg">{MONTHS[month - 1]} {year}</h3>
          <button onClick={() => changeMonth(1)}
            disabled={month === now.getMonth() + 1 && year === now.getFullYear()}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-40">
            <ChevronRight className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells before first day */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {/* Days */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const status = getStatusForDate(dateStr)
              const isToday = dateStr === new Date().toISOString().split('T')[0]
              const isFuture = new Date(dateStr) > new Date()
              const isSunday = new Date(dateStr).getDay() === 0

              return (
                <div key={day} className={cn(
                  'aspect-square rounded-xl flex flex-col items-center justify-center text-sm transition-all',
                  status ? STATUS_COLORS[status] : isSunday ? 'bg-gray-50 text-gray-300' : isFuture ? 'text-gray-300' : 'bg-gray-50 text-gray-500',
                  isToday && !status && 'ring-2 ring-indigo-400 ring-offset-1'
                )}>
                  <span className="font-semibold text-sm">{day}</span>
                  {status && <span className="text-xs opacity-80 capitalize">{status[0].toUpperCase()}</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-6 pt-4 border-t border-gray-100 flex-wrap">
          {Object.entries(STATUS_COLORS).map(([s, color]) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={cn('w-4 h-4 rounded', color)} />
              <span className="text-xs text-gray-500 capitalize">{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}