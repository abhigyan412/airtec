'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { hrmsApi, complaintsApi, studentsApi, feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { UserX, MessageSquareWarning, FileWarning, Wallet, CalendarCheck, AlertTriangle } from 'lucide-react'

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

export function NeedsAttentionToday() {
  const { can } = usePermissions()
  const canStaff = can('staff.view')
  const canComplaints = can('complaint.view')
  const canCertificates = can('certificate.view')
  const canFees = can('fee.view')
  const canAttendance = can('attendance.view')

  const { data: staffAttendance } = useQuery({
    queryKey: ['dashboard-staff-attendance-today', todayStr],
    queryFn: () => hrmsApi.attendance.list({ date: todayStr }).then(r => r.data),
    enabled: canStaff,
  })
  const { data: complaintStats } = useQuery({
    queryKey: ['dashboard-complaint-stats'],
    queryFn: () => complaintsApi.stats().then(r => r.data),
    enabled: canComplaints,
  })
  const { data: pendingTc } = useQuery({
    queryKey: ['dashboard-pending-tc'],
    queryFn: () => studentsApi.pendingTcRequests().then(r => r.data),
    enabled: canCertificates,
  })
  const { data: fees } = useQuery({
    queryKey: ['dashboard-fee-followups'],
    queryFn: () => feeApi.dues().then(r => r.data),
    enabled: canFees,
  })
  const { data: attendanceToday } = useQuery({
    queryKey: ['dashboard-attendance-today'],
    queryFn: () => studentsApi.attendanceToday().then(r => r.data),
    enabled: canAttendance,
  })

  if (!canStaff && !canComplaints && !canCertificates && !canFees && !canAttendance) return null

  const absentTeachers = (staffAttendance ?? []).filter((a: any) => a.status === 'absent')
  const unresolvedComplaints = (complaintStats?.open ?? 0) + (complaintStats?.in_progress ?? 0)
  const pendingTcCount = (pendingTc ?? []).length
  const feesDueToday = (fees ?? []).filter((f: any) => f.due_date && f.due_date <= todayStr)

  const tiles = [
    canStaff && {
      key: 'staff',
      icon: UserX,
      label: 'Absent Teachers',
      count: absentTeachers.length,
      sub: absentTeachers.length > 0 ? absentTeachers.slice(0, 3).map((a: any) => a.users?.full_name).filter(Boolean).join(', ') : 'All staff present',
      href: '/hr/attendance',
    },
    canComplaints && {
      key: 'complaints',
      icon: MessageSquareWarning,
      label: 'Unresolved Complaints',
      count: unresolvedComplaints,
      sub: unresolvedComplaints > 0 ? `${complaintStats?.urgent ?? 0} urgent` : 'Nothing pending',
      href: '/complaints',
    },
    canCertificates && {
      key: 'tc',
      icon: FileWarning,
      label: 'Pending TC Requests',
      count: pendingTcCount,
      sub: pendingTcCount > 0 ? 'Awaiting approval' : 'Nothing pending',
      href: '/students',
    },
    canFees && {
      key: 'fees',
      icon: Wallet,
      label: 'Fee Follow-ups Due',
      count: feesDueToday.length,
      sub: feesDueToday.length > 0 ? `${(fees ?? []).length} total unpaid/partial` : 'None due today',
      href: '/fees',
    },
  ].filter(Boolean) as { key: string; icon: any; label: string; count: number; sub: string; href: string }[]

  const attendancePct = attendanceToday?.percentage ?? 0
  const attendanceColor = !attendanceToday?.is_working_day
    ? 'text-gray-400 bg-gray-50'
    : attendancePct >= 75 ? 'text-emerald-600 bg-emerald-50'
    : attendancePct >= 50 ? 'text-amber-600 bg-amber-50'
    : 'text-rose-600 bg-rose-50'

  const unmarkedSections: any[] = attendanceToday?.unmarked_sections ?? []
  const UNMARKED_SHOWN = 8
  const sectionLabel = (s: any) => `${s.class_name ?? 'Unassigned'}${s.section_name ? ` · ${s.section_name}` : ''}`

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-5">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <h3 className="font-semibold text-gray-900">Needs Attention Today</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {tiles.map(t => (
          <Link key={t.key} href={t.href}
            className="group rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-2">
              <t.icon className={cn('w-4 h-4', t.count > 0 ? 'text-amber-500' : 'text-gray-300')} />
              <span className={cn('text-2xl font-bold', t.count > 0 ? 'text-gray-900' : 'text-gray-300')}>{t.count}</span>
            </div>
            <p className="text-xs font-medium text-gray-600">{t.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">{t.sub}</p>
          </Link>
        ))}

        {canAttendance && (
          <Link href="/attendance" className="group rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-2">
              <CalendarCheck className={cn('w-4 h-4', attendanceColor.split(' ')[0])} />
              <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', attendanceColor)}>
                {attendanceToday?.is_working_day ? `${attendancePct}%` : 'Off'}
              </span>
            </div>
            <p className="text-xs font-medium text-gray-600">Today's Attendance</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {!attendanceToday
                ? 'Loading...'
                : !attendanceToday.is_working_day
                ? 'Holiday / weekly off'
                : `${attendanceToday.sections_marked}/${attendanceToday.sections_total} sections marked`}
            </p>
          </Link>
        )}
      </div>

      {canAttendance && attendanceToday?.is_working_day && unmarkedSections.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-medium text-rose-600 mb-2">
            {unmarkedSections.length} class{unmarkedSections.length !== 1 ? 'es' : ''}/section{unmarkedSections.length !== 1 ? 's' : ''} haven't marked attendance yet
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unmarkedSections.slice(0, UNMARKED_SHOWN).map((s: any, i: number) => (
              <span key={i} className="px-2 py-1 rounded-lg text-[11px] font-medium bg-rose-50 text-rose-600 border border-rose-100">
                {sectionLabel(s)}
              </span>
            ))}
            {unmarkedSections.length > UNMARKED_SHOWN && (
              <Link href="/attendance" className="px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-700">
                +{unmarkedSections.length - UNMARKED_SHOWN} more →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
