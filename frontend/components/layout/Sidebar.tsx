'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, UserPlus, CreditCard, BookOpen, CalendarDays,
  MessageSquare, Award, Clock, Library, Briefcase, Settings as SettingsIcon,
  NotebookPen, GraduationCap, ChevronDown, ChevronRight, X, UserCheck,
  Wallet, ClipboardList, BarChart3, ShieldCheck, School, ArrowUpNarrowWide,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { NotificationBell } from './NotificationBell'

interface NavItem {
  label: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  children?: NavItem[]
  /** Single permission code that gates this leaf. */
  permission?: string
  /** Visible if the user holds ANY of these codes. */
  requireAny?: string[]
  /** Visible only for these roles (super role always passes). */
  roles?: string[]
}

// Grouped navigation mapped to airtec's real routes and role_permissions_v2
// codes (see lib/usePermissions.ts). A group is shown when at least one of its
// children is visible, so a group can never advertise a page the user can't open.
const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Students',
    icon: Users,
    children: [
      { label: 'All Students', href: '/students', icon: UserCheck, permission: 'student.view' },
      { label: 'Add Student', href: '/students/new', icon: UserPlus, permission: 'student.create' },
      { label: 'Promotions', href: '/students/promote', icon: ArrowUpNarrowWide, permission: 'student.promote' },
      { label: 'Bulk Edit', href: '/students/bulk-edit', icon: ClipboardList, permission: 'student.edit' },
    ],
  },
  {
    label: 'Admissions',
    icon: UserPlus,
    children: [
      { label: 'Pipeline', href: '/admission', icon: UserPlus, permission: 'admission.view' },
      { label: 'Applications', href: '/admission/applications', icon: ClipboardList, permission: 'admission.view' },
    ],
  },
  {
    label: 'Fees',
    icon: CreditCard,
    children: [
      { label: 'Overview', href: '/fees', icon: Wallet, permission: 'fee.view' },
      { label: 'Collections', href: '/fees/collections', icon: CreditCard, requireAny: ['fee.collect', 'fee.view'] },
      { label: 'Arrears', href: '/fees/arrears', icon: BarChart3, permission: 'fee.view' },
    ],
  },
  { label: 'Examinations', href: '/exams', icon: BookOpen, permission: 'exam.view' },
  { label: 'Attendance', href: '/attendance', icon: CalendarDays, permission: 'attendance.view' },
  { label: 'Timetable', href: '/timetable', icon: Clock, permission: 'timetable.view' },
  { label: 'Homework', href: '/homework', icon: NotebookPen, permission: 'homework.view' },
  { label: 'Complaints', href: '/complaints', icon: MessageSquare, permission: 'complaint.view' },
  { label: 'Certificates', href: '/certificates', icon: Award, permission: 'certificate.view' },
  { label: 'Resource Centre', href: '/resources', icon: Library, permission: 'resource.view' },
  {
    label: 'Staff & HR',
    icon: Briefcase,
    children: [
      { label: 'Staff', href: '/hr/staff', icon: Users, permission: 'staff.view' },
      { label: 'Attendance', href: '/hr/attendance', icon: UserCheck, requireAny: ['staff.attendance_mark', 'staff.view'] },
      { label: 'Leave Requests', href: '/hr/leave', icon: ClipboardList, requireAny: ['staff.leave_approve', 'staff.view'] },
      { label: 'My Leave', href: '/hr/my-leave', icon: CalendarDays },
      { label: 'Payroll', href: '/hr/payroll', icon: Wallet, requireAny: ['staff.payroll_manage', 'staff.view'] },
      { label: 'Recruitment', href: '/hr/recruitment', icon: UserPlus, requireAny: ['staff.recruitment_manage', 'staff.view'] },
      { label: 'Reports', href: '/hr/reports', icon: BarChart3, permission: 'staff.view' },
      { label: 'Permissions', href: '/hr/permissions', icon: ShieldCheck, requireAny: ['role.manage', 'role.assign'] },
    ],
  },
]

// Footer settings group — Classes & Calendar historically gated to principal /
// school-admin; keep that gate.
const SETTINGS: NavItem[] = [
  { label: 'Team & Settings', href: '/settings/team', icon: SettingsIcon, requireAny: ['team.view', 'team.invite', 'role.manage'] },
  { label: 'Classes & Sections', href: '/settings/classes', icon: School, roles: ['principal'] },
  { label: 'Academic Calendar', href: '/settings/calendar', icon: CalendarDays, roles: ['principal'] },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, isRole } = useAuth()
  const { can, canAny, isSuperRole } = usePermissions()

  const allowed = React.useCallback(
    (item: NavItem): boolean => {
      if (item.children?.length) return item.children.some(allowed)
      if (item.roles) return isSuperRole || isRole(...item.roles)
      if (item.requireAny) return canAny(...item.requireAny)
      if (item.permission) return can(item.permission)
      return true
    },
    [can, canAny, isRole, isSuperRole],
  )

  // Only the single most-specific nav entry may be "active". Without this,
  // "All Students" (/students) would also light up on /students/bulk-edit and
  // /students/new because those start with "/students/". We resolve the longest
  // matching href for the current path and mark exactly that one active.
  const allHrefs = React.useMemo(() => {
    const hrefs: string[] = []
    const walk = (items: NavItem[]) =>
      items.forEach((i) => {
        if (i.href) hrefs.push(i.href)
        if (i.children) walk(i.children)
      })
    walk(NAV)
    walk(SETTINGS)
    return hrefs
  }, [])

  const activeHref = React.useMemo(() => {
    let best = ''
    for (const h of allHrefs) {
      if ((pathname === h || pathname.startsWith(h + '/')) && h.length > best.length) best = h
    }
    return best
  }, [allHrefs, pathname])

  const isActive = (href: string) => href === activeHref

  const getActiveGroup = React.useCallback(
    (path: string) =>
      NAV.filter((i) => i.children?.some((c) => c.href && (path === c.href || path.startsWith(c.href + '/')))).map(
        (i) => i.label,
      ),
    [],
  )

  const [expanded, setExpanded] = React.useState<string[]>(() => getActiveGroup(pathname))

  React.useEffect(() => {
    const active = getActiveGroup(pathname)
    if (active.length) setExpanded((prev) => Array.from(new Set([...prev, ...active])))
  }, [pathname, getActiveGroup])

  const toggle = (label: string) =>
    setExpanded((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))

  const schoolName = (user as any)?.schools?.name ?? 'School ERP'

  return (
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out',
          'lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-5">
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow-indigo">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-bold tracking-tight text-sidebar-foreground">AIRTEC</span>
              <span className="block truncate text-[11px] leading-none text-muted-foreground">{schoolName}</span>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Main Menu
          </p>
          {NAV.map((item) => {
            if (!allowed(item)) return null
            const children = item.children?.filter(allowed)
            if (item.children && !children?.length) return null
            return (
              <NavEntry
                key={item.label}
                item={{ ...item, children }}
                expanded={expanded}
                onToggle={toggle}
                isActive={isActive}
                onClose={onClose}
              />
            )
          })}
        </nav>

        {/* Settings footer */}
        <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-3">
          {SETTINGS.filter(allowed).map((item) => (
            <NavEntry
              key={item.label}
              item={item}
              expanded={expanded}
              onToggle={toggle}
              isActive={isActive}
              onClose={onClose}
            />
          ))}
        </div>
      </aside>
  )
}

function NavEntry({
  item,
  expanded,
  onToggle,
  isActive,
  onClose,
}: {
  item: NavItem
  expanded: string[]
  onToggle: (label: string) => void
  isActive: (href: string) => boolean
  onClose: () => void
}) {
  const Icon = item.icon
  const isOpen = expanded.includes(item.label)

  if (item.href) {
    const active = isActive(item.href)
    return (
      <Link
        href={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    )
  }

  const anyChildActive = item.children?.some((c) => c.href && isActive(c.href))

  return (
    <div>
      <button
        onClick={() => onToggle(item.label)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
          anyChildActive ? 'text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
      </button>

      {isOpen && item.children && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon
            const active = child.href ? isActive(child.href) : false
            return (
              <Link
                key={child.label}
                href={child.href ?? '#'}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-all duration-200',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{child.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
