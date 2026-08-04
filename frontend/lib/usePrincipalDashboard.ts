'use client'
import { useQuery } from '@tanstack/react-query'
import { principalApi } from './api'
import { useAuth } from './auth'

export interface WeeklyPoint { week_label: string; pct: number | null }

export interface PrincipalDashboardData {
  header: { full_name: string; date: string }
  health: {
    attendance_today_pct: number | null
    fee_collection_pct: number | null
    unresolved_complaints_count: number
    complaints_new_this_week: number
    complaints_new_prior_week: number
    staff_attendance_today_pct: number | null
  }
  academic_performance: {
    score_trend: { exam_name: string; date: string; avg_pct: number }[]
    grade_comparison: { class_id: string; class_name: string; avg_pct: number; exam_name: string }[]
    syllabus_completion: {
      class_id: string; class_name: string; subject_name: string
      percent_complete: number; percent_expected: number; gap: number
      sections: { section_id: string; section_name: string; teacher_name: string | null }[]
    }[]
  }
  staff_oversight: {
    teacher_attendance_trend: WeeklyPoint[]
    complaints_by_class: { class_name: string; section_name: string; count: number }[]
    performance_concerns: { class_name: string; subject_name: string; teacher_name: string | null; prior_pct: number; latest_pct: number; drop: number }[]
  }
  escalations: {
    sla_escalations: { id: string; category: string; subject: string; priority: string; days_open: number; class_name: string | null; section_name: string | null }[]
    disciplinary_flagged: { id: string; category: string; subject: string; priority: string; days_open: number; class_name: string | null; section_name: string | null }[]
    sla_days: number
  }
  attendance_trend: WeeklyPoint[]
  fee_collection_trend: { month: string; label: string; invoiced: number; collected: number }[]
}

// Single GET /principal/dashboard call, deduped by react-query across
// every widget below (same pattern as lib/useTeacherDashboard.ts). Keyed
// by user id for the same reason: a stale cache entry must never leak
// one principal's aggregates into another's session.
export function usePrincipalDashboard() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['principal-dashboard', user?.id],
    queryFn: () => principalApi.dashboard().then(r => r.data as PrincipalDashboardData),
    enabled: !!user,
  })
}
