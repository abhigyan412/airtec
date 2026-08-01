'use client'
import { useQuery } from '@tanstack/react-query'
import { teacherApi } from './api'

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
  metrics: { to_grade: number; homework_assigned: number; upcoming_tests: number }
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
    tc_requests: { id: string; tc_number: string; reason: string; created_at: string; students: { first_name: string; last_name: string; admission_number: string } }[]
  } | null
}

export function useTeacherDashboard() {
  return useQuery({
    queryKey: ['teacher-dashboard'],
    queryFn: () => teacherApi.dashboard().then(r => r.data as TeacherDashboardData),
  })
}
