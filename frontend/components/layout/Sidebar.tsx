'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, UserPlus, CreditCard,
  GraduationCap, LogOut, BookOpen, CalendarDays, MessageSquare,
  Award, Clock, Library, Briefcase, Settings as SettingsIcon, GraduationCap as ClassesIcon
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

// `permission` is the new role_permissions_v2 permission_code that
// gates this nav item's visibility. `null` means always visible
// (no permission gate — e.g. Dashboard).
//
// This REPLACES the old `module` field which checked the legacy
// role_permissions table via /api/hrms/permissions/me. The new
// system uses /api/rbac/permissions/me (see lib/usePermissions.ts).
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: null },
  { href: '/students', label: 'Students', icon: Users, permission: 'student.view' },
  { href: '/admission', label: 'Admissions', icon: UserPlus, permission: 'admission.view' },
  { href: '/fees', label: 'Fee Management', icon: CreditCard, permission: 'fee.view' },
  { href: '/exams', label: 'Examinations', icon: BookOpen, permission: 'exam.view' },
  { href: '/attendance', label: 'Attendance', icon: CalendarDays, permission: 'attendance.view' },
  { href: '/complaints', label: 'Complaints', icon: MessageSquare, permission: 'complaint.view' },
  { href: '/certificates', label: 'Certificates', icon: Award, permission: 'certificate.view' },
  { href: '/timetable', label: 'Timetable', icon: Clock, permission: 'timetable.view' },
  { href: '/resources', label: 'Resource Centre', icon: Library, permission: 'resource.view' },
  { href: '/hr/staff', label: 'Staff & HR', icon: Briefcase, permission: 'staff.view' },
  { href: '/hr/my-leave', label: 'My Leave', icon: CalendarDays, permission: null },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { can, isSuperRole } = usePermissions()

  const visible = NAV.filter(item => {
    if (!item.permission) return true
    return can(item.permission)
  })

  // "Team & Settings" link uses the new team.* permission codes
  // (replaces the old hardcoded ['school_admin','principal'] role check)
  const { canAny } = usePermissions()
  const canManageTeam = isSuperRole || canAny('team.view', 'team.invite', 'role.manage')

  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U'
  const schoolName = (user as any)?.schools?.name ?? 'Your School'

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] bg-[#14141A] flex flex-col z-40">
      {/* Brand */}
      <div className="px-[18px] pt-[18px] pb-[18px] mb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-[#7C6FF0] to-[#5B5BD6] flex items-center justify-center shadow-[0_4px_12px_rgba(124,111,240,0.35)] flex-shrink-0">
            <GraduationCap className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white text-[13px] leading-tight">AIRTEC</p>
            <p className="text-[11px] text-[#8A8A99] truncate leading-tight">{schoolName}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto">
        <p className="px-[18px] text-[10px] font-semibold text-[#6B6B7B] uppercase tracking-[0.1em] mb-1.5">Main Menu</p>
        {visible.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-2.5 px-[18px] py-[9px] text-[13px] transition-all',
                active
                  ? 'text-white font-medium bg-[#5B5BD6]/[0.15]'
                  : 'text-[#A0A0B0] hover:text-white hover:bg-white/[0.04]'
              )}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#9D8FFF] to-[#5B5BD6]" />
              )}
              <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Settings (gated by team.* / role.manage permissions) */}
      {canManageTeam && (
        <div className="px-2.5 mb-1">
          <Link
            href="/settings/team"
            className={cn(
              'flex items-center gap-2.5 px-[14px] py-2 rounded-[10px] text-[12px] transition-colors',
              pathname.startsWith('/settings/team')
                ? 'text-white bg-white/[0.06]'
                : 'text-[#8A8A99] hover:text-white hover:bg-white/[0.04]'
            )}
          >
            <SettingsIcon className="w-[15px] h-[15px] flex-shrink-0" />
            <span>Team & Settings</span>
          </Link>
        </div>
      )}

      {/* Classes & Sections — same gate as the backend enforces (school_admin/principal) */}
      {(isSuperRole || user?.role === 'principal') && (
        <div className="px-2.5 mb-1">
          <Link
            href="/settings/classes"
            className={cn(
              'flex items-center gap-2.5 px-[14px] py-2 rounded-[10px] text-[12px] transition-colors',
              pathname.startsWith('/settings/classes')
                ? 'text-white bg-white/[0.06]'
                : 'text-[#8A8A99] hover:text-white hover:bg-white/[0.04]'
            )}
          >
            <ClassesIcon className="w-[15px] h-[15px] flex-shrink-0" />
            <span>Classes & Sections</span>
          </Link>
        </div>
      )}

      {/* User */}
      <div className="m-2.5 mt-1.5">
        <div className="flex items-center gap-2.5 px-[14px] py-3 rounded-[10px] bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#9D8FFF] to-[#5B5BD6] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-white truncate leading-tight">{user?.full_name}</p>
            <p className="text-[10px] text-[#8A8A99] capitalize leading-tight">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 text-[#6B6B7B] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}