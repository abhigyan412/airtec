'use client'
import { TeacherDashboardHeader } from './Header'
import { AttendanceActionCard } from './AttendanceActionCard'
import { TodaySchedule } from './TodaySchedule'
import { TaskMetrics } from './TaskMetrics'
import { NeedsAttentionPanel } from './NeedsAttentionPanel'
import { ClassesPerformance } from './ClassesPerformance'
import { UpcomingForMyClasses } from './UpcomingForMyClasses'
import { HomeroomFollowups } from './HomeroomFollowups'
import { QuickActions } from './QuickActions'

// Everything here reads from the single GET /teacher/dashboard call
// (see lib/useTeacherDashboard.ts) — react-query dedupes it across all
// the child components below into one network round-trip.
// AttendanceActionCard and HomeroomFollowups render nothing at all for
// a subject-only teacher; every other section is scoped server-side to
// this teacher's own sections/subjects, never school-wide.
export function TeacherDashboard() {
  return (
    <div className="animate-fade-in space-y-6">
      <TeacherDashboardHeader />
      <AttendanceActionCard />
      <TaskMetrics />
      <NeedsAttentionPanel />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TodaySchedule />
        <UpcomingForMyClasses />
      </div>
      <ClassesPerformance />
      <HomeroomFollowups />
      <QuickActions />
    </div>
  )
}
