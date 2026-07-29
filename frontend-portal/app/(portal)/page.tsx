'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Wallet, CalendarCheck, NotebookPen, BookOpen, ArrowRight } from 'lucide-react'
import { studentsApi, homeworkApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatCurrency, cn } from '@/lib/utils'

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

export default function PortalOverviewPage() {
  const { user } = useAuth()
  const isParent = user?.role === 'parent'

  const { data: me, isLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data: homework } = useQuery({
    queryKey: ['portal-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })

  const upcomingHomework = (homework ?? []).filter((h: any) => !h.due_date || h.due_date >= todayStr)

  if (isLoading) {
    return <div className="text-center py-20 text-gray-400">Loading...</div>
  }

  if (!me) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
        <p className="font-medium">No student record is linked to this account yet.</p>
        <p className="text-sm mt-1">Contact your school office to get this fixed.</p>
      </div>
    )
  }

  const due = me.fee_summary?.total_due ?? 0

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#9D8FFF] to-[#5B5BD6] flex items-center justify-center flex-shrink-0 overflow-hidden">
          {me.photo_url ? (
            <img src={me.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-lg font-bold">{me.first_name?.[0]}{me.last_name?.[0]}</span>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{me.first_name} {me.last_name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {me.classes?.name}{me.sections?.name ? ` - ${me.sections.name}` : ''} · Admission No. {me.admission_number}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isParent ? (
          <Link href="/fees" className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center"><Wallet className="w-4 h-4 text-rose-500" /></div>
              <ArrowRight className="w-4 h-4 text-gray-300" />
            </div>
            <p className={cn('text-xl font-bold', due > 0 ? 'text-rose-600' : 'text-emerald-600')}>{formatCurrency(due)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{due > 0 ? 'Outstanding fees' : 'All fees paid'}</p>
          </Link>
        ) : (
          <Link href="/exams" className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center"><BookOpen className="w-4 h-4 text-violet-500" /></div>
              <ArrowRight className="w-4 h-4 text-gray-300" />
            </div>
            <p className="text-xl font-bold text-gray-900">View</p>
            <p className="text-xs text-gray-400 mt-0.5">Exam results</p>
          </Link>
        )}

        <Link href="/homework" className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center"><NotebookPen className="w-4 h-4 text-amber-500" /></div>
            <ArrowRight className="w-4 h-4 text-gray-300" />
          </div>
          <p className="text-xl font-bold text-gray-900">{upcomingHomework.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">Upcoming homework</p>
        </Link>

        <Link href="/attendance" className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center"><CalendarCheck className="w-4 h-4 text-emerald-500" /></div>
            <ArrowRight className="w-4 h-4 text-gray-300" />
          </div>
          <p className="text-xl font-bold text-gray-900">View</p>
          <p className="text-xs text-gray-400 mt-0.5">Attendance record</p>
        </Link>
      </div>

      <div className={cn('grid grid-cols-1 gap-4', isParent && 'sm:grid-cols-2')}>
        <Link href="/timetable" className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center justify-between hover:border-indigo-200 hover:shadow-sm transition-all">
          <span className="text-sm font-semibold text-gray-900">Weekly Timetable</span>
          <ArrowRight className="w-4 h-4 text-gray-300" />
        </Link>
        {isParent && (
          <Link href="/exams" className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center justify-between hover:border-indigo-200 hover:shadow-sm transition-all">
            <span className="text-sm font-semibold text-gray-900 flex items-center gap-2"><BookOpen className="w-4 h-4 text-gray-400" /> Exam Results</span>
            <ArrowRight className="w-4 h-4 text-gray-300" />
          </Link>
        )}
      </div>
    </div>
  )
}
