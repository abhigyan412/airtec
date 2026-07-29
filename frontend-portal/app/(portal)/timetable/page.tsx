'use client'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { timetableApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics': 'bg-indigo-50 border-indigo-200 text-indigo-800',
  'English': 'bg-blue-50 border-blue-200 text-blue-800',
  'Science': 'bg-emerald-50 border-emerald-200 text-emerald-800',
  'Hindi': 'bg-orange-50 border-orange-200 text-orange-800',
  'Social Studies': 'bg-purple-50 border-purple-200 text-purple-800',
  'Break': 'bg-gray-100 border-gray-200 text-gray-400',
  'Lunch': 'bg-gray-100 border-gray-200 text-gray-400',
}
const getColor = (s: string) => SUBJECT_COLORS[s] ?? 'bg-violet-50 border-violet-200 text-violet-800'

export default function PortalTimetablePage() {
  // No params — the backend auto-scopes to this student's own
  // class/section for a parent/student login.
  const { data, isLoading } = useQuery({
    queryKey: ['portal-timetable'],
    queryFn: () => timetableApi.get().then(r => r.data),
  })

  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of data ?? []) {
    byDay[p.day_of_week] = byDay[p.day_of_week] ?? []
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Clock className="w-5 h-5 text-gray-400" /> Timetable</h1>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : !(data ?? []).length ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <Clock className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="font-medium">No timetable published yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {DAYS.map((day, idx) => {
            const dayNum = idx + 1
            const periods = byDay[dayNum] ?? []
            if (!periods.length) return null
            return (
              <div key={day} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">{day}</h3>
                </div>
                <div className="divide-y divide-gray-50">
                  {periods.map((p: any) => (
                    <div key={p.id} className="px-5 py-3 flex items-center gap-3">
                      <span className="text-xs text-gray-400 font-mono w-16 flex-shrink-0">
                        {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
                      </span>
                      <span className={cn('flex-1 px-3 py-1.5 rounded-lg border text-sm font-medium', getColor(p.subject_name))}>
                        {p.subject_name}
                      </span>
                      {!p.is_break && p.users?.full_name && (
                        <span className="text-xs text-gray-400 truncate">{p.users.full_name}</span>
                      )}
                      {p.room && <span className="text-xs text-gray-300 flex-shrink-0">{p.room}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
