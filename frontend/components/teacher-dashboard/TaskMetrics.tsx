'use client'
import Link from 'next/link'
import { NotebookPen, CalendarClock, CalendarCheck2, BookCheck } from 'lucide-react'
import { StatCard } from '@/components/shared/StatCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'
import { TrendMetricCard } from './TrendMetricCard'

export function TaskMetrics() {
  const { data, isLoading } = useTeacherDashboard()
  const metrics = data?.metrics
  const trends = data?.metrics_trends

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
    )
  }

  // Attendance only links through for a class teacher — the /attendance
  // page (and its nav entry) is hidden from subject-only teachers
  // entirely, same rule as the sidebar, so this card shouldn't be the
  // one place that quietly bypasses it.
  const attendanceCard = (
    <TrendMetricCard label="Attendance" icon={CalendarCheck2} trend={trends?.attendance ?? { value: null, delta: null, sparkline: [] }} />
  )

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {data?.header?.is_class_teacher ? <Link href="/attendance">{attendanceCard}</Link> : attendanceCard}
      <Link href="/homework">
        <TrendMetricCard label="Homework Completion" icon={BookCheck} trend={trends?.homework_completion ?? { value: null, delta: null, sparkline: [] }} />
      </Link>
      <Link href="/homework/assigned">
        <StatCard label="Homework Assigned" value={metrics?.homework_assigned ?? 0} icon={NotebookPen} accent="info" hint="Pending submission" />
      </Link>
      <Link href="/exams">
        <StatCard label="Upcoming Tests" value={metrics?.upcoming_tests ?? 0} icon={CalendarClock} accent="primary" hint="For your classes" />
      </Link>
    </div>
  )
}
