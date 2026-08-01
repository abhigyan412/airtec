'use client'
import { ClipboardCheck, NotebookPen, CalendarClock, CalendarCheck2, BookCheck } from 'lucide-react'
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <TrendMetricCard label="Attendance" icon={CalendarCheck2} trend={trends?.attendance ?? { value: null, delta: null, sparkline: [] }} />
      <TrendMetricCard label="Homework Completion" icon={BookCheck} trend={trends?.homework_completion ?? { value: null, delta: null, sparkline: [] }} />
      <StatCard label="To Grade" value={metrics?.to_grade ?? 0} icon={ClipboardCheck} accent="warning" hint="Submitted, awaiting a grade" />
      <StatCard label="Homework Assigned" value={metrics?.homework_assigned ?? 0} icon={NotebookPen} accent="info" hint="Pending submission" />
      <StatCard label="Upcoming Tests" value={metrics?.upcoming_tests ?? 0} icon={CalendarClock} accent="primary" hint="For your classes" />
    </div>
  )
}
