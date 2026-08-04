'use client'
import { PrincipalDashboardHeader } from './Header'
import { HealthSummary } from './HealthSummary'
import { ClassAttendanceStatus } from './ClassAttendanceStatus'
import { StaffAttendanceList } from './StaffAttendanceList'
import { LowAttendancePanel } from './LowAttendancePanel'
import { StudentPerformanceLookup } from './StudentPerformanceLookup'
import { SyllabusCompletion } from './SyllabusCompletion'
import { ComplaintsByClass } from './ComplaintsByClass'
import { PerformanceConcerns } from './PerformanceConcerns'
import { Escalations } from './Escalations'
import { FeeCollectionChart } from './FeeCollectionChart'
import { UpcomingEvents } from '@/components/dashboard/UpcomingEvents'
import { UpcomingExams } from '@/components/dashboard/UpcomingExams'

// An academic-oversight and escalation view, deliberately not a copy of
// the Admin dashboard: every widget here reads from the single GET
// /principal/dashboard call (see lib/usePrincipalDashboard.ts) plus a
// handful of purpose-built list endpoints (staff attendance, class
// attendance, low-attendance students) — school-wide aggregates and
// concrete lists only, no invoice list, no admission funnel, no
// operational student-name-level detail beyond the low-attendance
// drill-down this spec explicitly asked for. That detail stays on the
// Admin dashboard otherwise.
export function PrincipalDashboard() {
  return (
    <div className="animate-fade-in space-y-6">
      <PrincipalDashboardHeader />
      <HealthSummary />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ClassAttendanceStatus />
        <StaffAttendanceList />
      </div>
      <LowAttendancePanel />

      <StudentPerformanceLookup />
      <SyllabusCompletion />

      <ComplaintsByClass />
      <PerformanceConcerns />

      <Escalations />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UpcomingEvents />
        <UpcomingExams />
      </div>
      <FeeCollectionChart />
    </div>
  )
}
