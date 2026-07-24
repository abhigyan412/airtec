'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { calendarApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatDate } from '@/lib/utils'
import { PartyPopper, CalendarDays } from 'lucide-react'

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const in30DaysStr = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// Holidays-only for now — the Academic Calendar feature only tracks
// holidays today. Exam dates/homework due dates are separate, unrelated
// tables with no unified "calendar events" concept to pull from yet.
export function UpcomingEvents() {
  const { isSuperRole, can } = usePermissions()
  const canView = isSuperRole || can('attendance.view')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-upcoming-events', todayStr, in30DaysStr],
    queryFn: () => calendarApi.holidays.upcoming(todayStr, in30DaysStr).then(r => r.data),
    enabled: canView,
  })

  if (!canView) return null
  const holidays = data ?? []

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-gray-400" /> Upcoming Events
        </h3>
        <Link href="/settings/calendar" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">Manage →</Link>
      </div>
      {isLoading ? (
        <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />
      ) : holidays.length === 0 ? (
        <div className="py-8 text-center text-gray-300">
          <PartyPopper className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No holidays in the next 30 days</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {holidays.slice(0, 6).map((h: any) => (
            <div key={h.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-50">
              <p className="text-sm font-medium text-gray-900 truncate">{h.name}</p>
              <span className="text-xs font-semibold text-emerald-600 flex-shrink-0 ml-3">{formatDate(h.date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
