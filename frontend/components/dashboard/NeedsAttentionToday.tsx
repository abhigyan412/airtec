'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { hrmsApi, complaintsApi, studentsApi, feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { UserX, MessageSquareWarning, FileWarning, Wallet, CalendarCheck, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

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
  const { data: attendanceToday, isLoading: attendanceLoading } = useQuery({
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
      href: '/students?tc_status=pending',
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
    ? 'text-muted-foreground bg-muted'
    : attendancePct >= 75 ? 'text-success bg-success/10'
    : attendancePct >= 50 ? 'text-warning bg-warning/10'
    : 'text-destructive bg-destructive/10'

  const unmarkedSections: any[] = attendanceToday?.unmarked_sections ?? []
  const UNMARKED_SHOWN = 8
  const sectionLabel = (s: any) => `${s.class_name ?? 'Unassigned'}${s.section_name ? ` · ${s.section_name}` : ''}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" /> Needs Attention Today
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {tiles.map(t => (
            <Link
              key={t.key}
              href={t.href}
              className="group rounded-xl border border-border p-4 transition-all hover:shadow-sm hover:bg-muted/40"
            >
              <div className="mb-2 flex items-center justify-between">
                <t.icon className={cn('h-4 w-4', t.count > 0 ? 'text-warning' : 'text-muted-foreground/50')} />
                <span className={cn('text-2xl font-bold', t.count > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>{t.count}</span>
              </div>
              <p className="text-xs font-medium text-foreground">{t.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.sub}</p>
            </Link>
          ))}

          {canAttendance && (
            <Link href="/attendance" className="group rounded-xl border border-border p-4 transition-all hover:shadow-sm hover:bg-muted/40">
              <div className="mb-2 flex items-center justify-between">
                <CalendarCheck className={cn('h-4 w-4', attendanceColor.split(' ')[0])} />
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', attendanceColor)}>
                  {attendanceToday?.is_working_day ? `${attendancePct}%` : 'Off'}
                </span>
              </div>
              <p className="text-xs font-medium text-foreground">Today&apos;s Attendance</p>
              {attendanceLoading ? (
                <Skeleton className="mt-1 h-3 w-28" />
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {!attendanceToday?.is_working_day
                    ? 'Holiday / weekly off'
                    : `${attendanceToday.sections_marked}/${attendanceToday.sections_total} sections marked`}
                </p>
              )}
            </Link>
          )}
        </div>

        {canAttendance && attendanceToday?.is_working_day && unmarkedSections.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-destructive">
              {unmarkedSections.length} class{unmarkedSections.length !== 1 ? 'es' : ''}/section{unmarkedSections.length !== 1 ? 's' : ''} haven&apos;t marked attendance yet
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unmarkedSections.slice(0, UNMARKED_SHOWN).map((s: any, i: number) => (
                <span key={i} className="rounded-lg border border-destructive/20 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
                  {sectionLabel(s)}
                </span>
              ))}
              {unmarkedSections.length > UNMARKED_SHOWN && (
                <Link href="/attendance" className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  +{unmarkedSections.length - UNMARKED_SHOWN} more →
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
