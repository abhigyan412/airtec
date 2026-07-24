'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatDate } from '@/lib/utils'
import { BookOpen, CalendarClock } from 'lucide-react'

export function UpcomingExams() {
  const { can } = usePermissions()
  const canView = can('exam.view')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-upcoming-exams'],
    queryFn: () => api.get('/exams/upcoming', { params: { days: 7 } }).then(r => r.data.data),
    enabled: canView,
  })

  if (!canView) return null
  const exams = data ?? []

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-gray-400" /> Upcoming Exams
        </h3>
        <Link href="/exams" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">View all →</Link>
      </div>
      {isLoading ? (
        <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />
      ) : exams.length === 0 ? (
        <div className="py-8 text-center text-gray-300">
          <BookOpen className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No exams in the next 7 days</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {exams.map((e: any) => (
            <Link key={e.id} href={`/exams/${e.id}`}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                <p className="text-xs text-gray-400 capitalize">{e.exam_type?.replace('_', ' ')}{e.academic_years?.name ? ` · ${e.academic_years.name}` : ''}</p>
              </div>
              <span className="text-xs font-semibold text-indigo-600 flex-shrink-0 ml-3">{formatDate(e.start_date)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
