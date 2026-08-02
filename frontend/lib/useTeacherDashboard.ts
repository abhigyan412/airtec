'use client'
import { useQuery } from '@tanstack/react-query'
import { teacherApi } from './api'
import { useAuth } from './auth'

export interface MetricTrend {
  value: number | null
  delta: number | null
  sparkline: (number | null)[]
}

export interface TeacherDashboardData {
  header: {
    full_name: string
    date: string
    day_of_week: number | null
    is_class_teacher: boolean
    homeroom_section: { section_id: string; section_name: string; class_id: string; class_name: string } | null
    sections_today: { section_id: string; section_name: string; class_name: string }[]
  }
  attendance_action: {
    section_id: string
    section_name: string
    class_name: string
    marked: boolean
    present_count: number
    total_count: number
  } | null
  schedule_today: {
    period_id: string
    period_number: number
    start_time: string
    end_time: string
    room: string | null
    section_id: string
    section_name: string
    class_name: string
    subject_name: string
    is_current: boolean
    is_next: boolean
  }[]
  metrics: { homework_assigned: number; upcoming_tests: number }
  metrics_trends: { attendance: MetricTrend; homework_completion: MetricTrend }
  classes_performance: {
    section_id: string
    section_name: string
    class_name: string
    subject_id: string | null
    subject_name: string | null
    attendance_pct: number | null
    overall_avg_pct: number | null
    exams_taken: number
    student_count: number
  }[]
  needs_attention: {
    student_id: string
    first_name: string
    last_name: string
    class_name: string
    section_name: string
    reasons: string[]
  }[]
  upcoming: {
    tests: { id: string; subject_name: string; exam_name?: string; exam_date: string; sections: string[] }[]
    homework_due: { id: string; title: string; due_date: string | null; sections: string[] }[]
    events: { date: string; name: string }[]
  }
  homeroom_followups: {
    fee_dues: {
      top: { student_id: string; first_name: string; last_name: string; amount_overdue: number; days_overdue: number }[]
      remaining_count: number
      remaining_total: number
    }
    tc_requests: { id: string; tc_number: string; reason: string; created_at: string; students: { id: string; first_name: string; last_name: string; admission_number: string } }[]
  } | null
}

export function useTeacherDashboard() {
  const { user } = useAuth()
  return useQuery({
    // Keyed by user id, not just ['teacher-dashboard'] — belt-and-braces
    // alongside the cache wipe on login (see lib/auth.tsx): even if
    // something re-triggers this query before that wipe lands, a
    // different teacher's id can never resolve to the same cache entry.
    queryKey: ['teacher-dashboard', user?.id],
    queryFn: () => teacherApi.dashboard().then(r => r.data as TeacherDashboardData),
    enabled: !!user,
  })
}
