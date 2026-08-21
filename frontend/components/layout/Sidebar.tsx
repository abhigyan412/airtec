'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard, Users, UserPlus, CreditCard, BookOpen, CalendarDays,
  MessageSquare, Award, Clock, Library, Briefcase, Settings as SettingsIcon,
  NotebookPen, GraduationCap, ChevronDown, ChevronRight, X, UserCheck,
  Wallet, ClipboardList, BarChart3, ShieldCheck, School, ArrowUpNarrowWide,
  Network, UserCheck2, Send, Grid3X3, LayoutGrid, User, Layers, Receipt, Tag, FileText, Lock,
  SlidersHorizontal, Gauge, FileSpreadsheet, CalendarClock, Wand2,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

/**
 * A heading inside an expanded group.
 *
 * Deliberately quiet — small, uppercase, muted, no rule. It is there to
 * be read once while scanning and then ignored; anything louder competes
 * with the links themselves, which are the thing being looked for.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 first:pt-0.5">
      {children}
    </p>
  )
}

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
  /** On top of any permission/roles check: for a legacy 'teacher' role
   *  user specifically, also requires the RBAC "Class Teacher" role (an
   *  active homeroom assignment this academic year). No-op for every
   *  other role. */
  teacherRequiresClassTeacher?: boolean
  /** Renders one level further indented than its siblings, as a visual
   *  sub-item of the entry directly above it (e.g. "Joined Candidates"
   *  under "Recruitment") — the nav tree itself stays flat/one-level,
   *  this is styling only. */
  indent?: boolean
  /** Heading rendered above this child, splitting a long group into
   *  labelled runs. Set it on EVERY child in the run, not just the
   *  first: the renderer emits a heading wherever the value changes from
   *  the previous surviving sibling, so tagging only the first would
   *  lose the heading whenever permissions hid that particular item.
   *  A run whose every item is hidden correctly takes its heading with
   *  it. Only worth using past roughly six children — below that the
   *  heading costs more attention than the grouping saves. */
  section?: string
  /** Which product module this belongs to. A school that has not bought
   *  the module never sees the entry, whatever permissions its roles
   *  hold — several entries below (Dashboard, My Payslips, My Leave)
   *  check no permission at all, so permissions alone cannot hide them
   *  from a school that only runs the timetable. Untagged items are
   *  always shown. */
  module?: string
  /** Permission required to actually open this item. Unlike `permission`
   *  (which hides the item outright), lacking this one still shows the
   *  entry — greyed out with a lock icon and no navigation — so a user
   *  knows the feature exists without being able to silently hit a 403
   *  after the page loads. */
  lockUnless?: string
}

// Grouped navigation mapped to airtec's real routes and role_permissions_v2
// codes (see lib/usePermissions.ts). A group is shown when at least one of its
// children is visible, so a group can never advertise a page the user can't open.
const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: 'dashboard' },
  {
    label: 'Students',
    module: 'students',
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
    module: 'admissions',
    icon: UserPlus,
    children: [
      { label: 'Pipeline', href: '/admission', icon: UserPlus, permission: 'admission.view' },
      { label: 'Applications', href: '/admission/applications', icon: ClipboardList, permission: 'admission.view' },
    ],
  },
  {
    label: 'Fees',
    module: 'fees',
    icon: CreditCard,
    children: [
      // Kept in step with the tab bar in app/(app)/fees/layout.tsx — the two
      // drifting is how Discounts ended up reachable from one nav and not the
      // other, and how Billing outlived the screen it pointed at.
      { label: 'Overview', href: '/fees', icon: Wallet, permission: 'fee.view' },
      { label: 'Collect', href: '/fees/collect', icon: CreditCard, requireAny: ['fee.collect', 'fee.view'] },
      { label: 'Structures', href: '/fees/structures', icon: Layers, requireAny: ['fee.structure_manage', 'fee.view'] },
      { label: 'Recovery', href: '/fees/recovery', icon: BarChart3, permission: 'fee.view' },
      { label: 'Receipts', href: '/fees/receipts', icon: Receipt, requireAny: ['fee.view', 'fee.collect'] },
      { label: 'Approvals', href: '/fees/approvals', icon: UserCheck, requireAny: ['fee.structure_manage', 'fee.discount'] },
      { label: 'Discounts', href: '/fees/discounts', icon: Tag, requireAny: ['fee.discount', 'fee.view'] },
    ],
  },
  {
    label: 'Examinations',
    module: 'exams',
    icon: BookOpen,
    children: [
      { label: 'All Examinations', href: '/exams', icon: BookOpen, permission: 'exam.view' },
      { label: 'Results', href: '/exams/results', icon: BarChart3, permission: 'exam.view', indent: true },
      { label: 'Examination Settings', href: '/exams/templates', icon: SettingsIcon, permission: 'exam.view', lockUnless: 'exam.schedule', indent: true },
    ],
  },
  { label: 'Student Attendance', href: '/attendance', icon: CalendarDays, permission: 'attendance.view', teacherRequiresClassTeacher: true, module: 'attendance' },
  {
    label: 'Timetable',
    module: 'timetable',
    icon: Clock,
    children: [
      // Ordered the way the module is actually used across a day:
      // look at the timetable, work today's cover from it, then the
      // things you do occasionally — analyse, build, configure. The old
      // order interleaved all three, so the screen somebody opens twenty
      // times a day sat below the one they open twice a term.

      { label: 'Class View', href: '/timetable', icon: Grid3X3, permission: 'timetable.view', section: 'View' },
      { label: 'Teacher View', href: '/timetable?view=teacher', icon: User, permission: 'timetable.view', indent: true, section: 'View' },
      // Every class at once, live or draft, and the thing that prints
      // the whole set. timetable.view because printing the timetables is
      // an office job, not a manager's.
      { label: 'Block View', href: '/timetable/block', icon: LayoutGrid, permission: 'timetable.view', section: 'View' },

      // Who is away, who is covering, who is free, and what needs
      // attention right now. "Who's free" used to be a separate Free
      // Faculty page on the class-view screen; it is a tab here now,
      // beside the queue it exists to serve.
      { label: 'Arrangements', href: '/timetable/arrangements', icon: UserCheck2, permission: 'arrangement.view', section: 'Today' },
      // Every teacher's own page: their week, the cover they have been
      // given, and their reserved periods. Gated on nothing but a login,
      // because it only ever shows the caller their own data — the
      // handler resolves identity from the token and ignores any id.
      { label: 'My Week', href: '/timetable/my-week', icon: CalendarClock, section: 'Today' },

      { label: 'Workload', href: '/timetable/workload', icon: Gauge, permission: 'timetable.workload_view', section: 'Build & manage' },
      { label: 'Generate', href: '/timetable/generate', icon: Wand2, permission: 'timetable.generate', section: 'Build & manage' },
      { label: 'Import', href: '/timetable/import', icon: FileSpreadsheet, permission: 'timetable.import', section: 'Build & manage' },
      { label: 'Setup', href: '/timetable/setup', icon: SlidersHorizontal, permission: 'timetable.setup_manage', section: 'Build & manage' },
    ],
  },
  { label: 'Homework', href: '/homework', icon: NotebookPen, permission: 'homework.view', module: 'homework' },
  { label: 'Complaints', href: '/complaints', icon: MessageSquare, permission: 'complaint.view', module: 'complaints' },
  { label: 'Certificates', href: '/certificates', icon: Award, permission: 'certificate.view', module: 'certificates' },
  { label: 'Resource Centre', href: '/resources', icon: Library, permission: 'resource.view', module: 'resources' },
  {
    label: 'Staff & HR',
    icon: Briefcase,
    // No module on the group itself — its children span four of them.
    // Tagging the whole group 'hr' was wrong: a school running only the
    // timetable still needs staff records, staff attendance and leave,
    // because absence detection reads staff_attendance and the
    // arrangement queue syncs from approved leave. Hiding the group hid
    // the timetable's own inputs.
    children: [
      { label: 'Staff', href: '/hr/staff', icon: Users, permission: 'staff.view', module: 'staff' },
      { label: 'Org Chart', href: '/hr/org-chart', icon: Network, permission: 'staff.view', module: 'staff' },
      // Feeds the timetable's absence detection, so it belongs to the
      // staff module rather than a payroll-shaped "HR" one.
      { label: 'Staff Attendance', href: '/hr/attendance', icon: UserCheck, requireAny: ['staff.attendance_mark', 'staff.view'], module: 'staff' },
      { label: 'Leave Requests', href: '/hr/leave', icon: ClipboardList, requireAny: ['staff.leave_approve', 'staff.view'], module: 'leave' },
      { label: 'Payroll', href: '/hr/payroll', icon: Wallet, requireAny: ['staff.payroll_manage', 'staff.view'], module: 'payroll' },
      { label: 'Recruitment', href: '/hr/recruitment', icon: UserPlus, requireAny: ['staff.recruitment_manage', 'staff.view'], module: 'recruitment' },
      { label: 'Offer Sent', href: '/hr/recruitment/offer-sent', icon: Send, requireAny: ['staff.recruitment_manage', 'staff.view'], indent: true, module: 'recruitment' },
      { label: 'Joined Candidates', href: '/hr/recruitment/joined', icon: UserCheck2, requireAny: ['staff.recruitment_manage', 'staff.view'], indent: true, module: 'recruitment' },
      { label: 'Reports', href: '/hr/reports', icon: BarChart3, permission: 'staff.view', module: 'staff' },
      { label: 'My Attendance', href: '/hr/my-attendance', icon: Clock, module: 'staff' },
      { label: 'My Leave', href: '/hr/my-leave', icon: CalendarDays, module: 'leave' },
      { label: 'My Payslips', href: '/hr/my-payslips', icon: CreditCard, module: 'payroll' },
      { label: 'My Documents', href: '/hr/my-documents', icon: FileText, module: 'documents' },
      { label: 'Permissions', href: '/hr/permissions', icon: ShieldCheck, requireAny: ['role.manage', 'role.assign'], module: 'staff' },
    ],
  },
]

// Footer settings group — Classes & Calendar historically gated to principal /
// school-admin; keep that gate.
const SETTINGS: NavItem[] = [
  { label: 'Team & Settings', href: '/settings/team', icon: SettingsIcon, requireAny: ['team.view', 'team.invite', 'role.manage'], module: 'settings' },
  { label: 'Classes & Sections', href: '/settings/classes', icon: School, roles: ['principal'], module: 'settings' },
  { label: 'Class Teachers', href: '/settings/teaching-assignments', icon: GraduationCap, roles: ['principal'], module: 'settings' },
  // Holidays and the weekly-off pattern, which the timetable reads.
  { label: 'Academic Calendar', href: '/settings/calendar', icon: CalendarDays, roles: ['principal', 'teacher'], module: 'settings' },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSearch = searchParams.toString()
  const { user, isRole } = useAuth()
  const { can, canAny, isSuperRole, roles, moduleEnabled } = usePermissions()
  const isSubjectOnlyTeacher = user?.role === 'teacher' && !roles.includes('Class Teacher')

  const allowed = React.useCallback(
    (item: NavItem): boolean => {
      // Module first, and before the children check: a group the school
      // has not bought is gone whatever its children would allow, and a
      // super role does not override it either — School Admin at a
      // timetable-only school still has no fees to look at.
      if (!moduleEnabled(item.module)) return false
      if (item.children?.length) return item.children.some(allowed)
      if (item.teacherRequiresClassTeacher && isSubjectOnlyTeacher) return false
      if (item.roles) return isSuperRole || isRole(...item.roles)
      if (item.requireAny) return canAny(...item.requireAny)
      if (item.permission) return can(item.permission)
      return true
    },
    [can, canAny, isRole, isSuperRole, isSubjectOnlyTeacher, moduleEnabled],
  )

  const locked = React.useCallback(
    (item: NavItem): boolean => (item.lockUnless ? !isSuperRole && !can(item.lockUnless) : false),
    [can, isSuperRole],
  )

  // Only the single most-specific nav entry may be "active". Without this,
  // "All Students" (/students) would also light up on /students/bulk-edit and
  // /students/new because those start with "/students/". We resolve the longest
  // matching href for the current path and mark exactly that one active.
  //
  // A few hrefs (Timetable's Class/Teacher View/Free Faculty) distinguish
  // themselves by a `?view=` query string on the SAME pathname rather than
  // a different path — usePathname() strips search params entirely, so
  // those need an exact query match instead of the plain prefix check
  // below, or all three would appear active together.
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

  const hrefMatches = React.useCallback((href: string) => {
    const qIdx = href.indexOf('?')
    if (qIdx === -1) return pathname === href || pathname.startsWith(href + '/')
    return pathname === href.slice(0, qIdx) && currentSearch === href.slice(qIdx + 1)
  }, [pathname, currentSearch])

  const activeHref = React.useMemo(() => {
    let best = ''
    for (const h of allHrefs) {
      if (hrefMatches(h) && h.length > best.length) best = h
    }
    return best
  }, [allHrefs, hrefMatches])

  const isActive = (href: string) => href === activeHref

  const getActiveGroup = React.useCallback(
    (path: string) =>
      NAV.filter((i) => i.children?.some((c) => c.href && (path === c.href.split('?')[0] || path.startsWith(c.href.split('?')[0] + '/')))).map(
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
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 [animation-duration:var(--duration-fast)] animate-in fade-in-0 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          // The drawer travels on the iOS curve rather than ease-in-out: an
          // ease-in start delays the first few pixels, which is exactly the
          // moment the user is watching after tapping the menu button.
          'fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar',
          'transition-transform [transition-duration:var(--duration-base)] ease-drawer',
          'lg:static lg:z-auto lg:translate-x-0 lg:transition-none',
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
          {/* The notification bell lives in the header, not here: its
              dropdown is wider than the sidebar and got clipped by the
              shell's overflow-hidden. */}
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Main Menu
          </p>
          {NAV.map((item) => {
            if (!allowed(item)) return null
            let children = item.children?.filter(allowed)
            // A teacher's "Students" group is just their own scoped
            // roster (the backend forces this regardless of query params
            // — see GET /students) — the admin bulk-management children
            // (Add/Promote/Bulk Edit) don't belong here even where a
            // class teacher happens to hold the underlying permission.
            if (item.label === 'Students' && user?.role === 'teacher') {
              children = children
                ?.filter((c) => c.href === '/students')
                .map((c) => ({ ...c, label: 'My Students' }))
            }
            if (item.children && !children?.length) return null
            return (
              <NavEntry
                key={item.label}
                item={{ ...item, children }}
                expanded={expanded}
                onToggle={toggle}
                isActive={isActive}
                isLocked={locked}
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
              isLocked={locked}
              onClose={onClose}
            />
          ))}
        </div>
      </aside>
    </>
  )
}

function NavEntry({
  item,
  expanded,
  onToggle,
  isActive,
  isLocked,
  onClose,
}: {
  item: NavItem
  expanded: string[]
  onToggle: (label: string) => void
  isActive: (href: string) => boolean
  isLocked: (item: NavItem) => boolean
  onClose: () => void
}) {
  const Icon = item.icon
  const isOpen = expanded.includes(item.label)

  if (item.href) {
    if (isLocked(item)) {
      return (
        <div
          className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/50"
          title="You don't have permission to open this"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{item.label}</span>
          <Lock className="h-3.5 w-3.5 shrink-0" />
        </div>
      )
    }
    const active = isActive(item.href)
    return (
      <Link
        href={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [transition-duration:var(--duration-press)] ease-out',
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
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [transition-duration:var(--duration-press)] ease-out',
          anyChildActive ? 'text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
      </button>

      {isOpen && item.children && (
        // A group opening with no transition reads as the page jumping rather
        // than as this group revealing its contents. Short and slide-only —
        // this is opened a few times a session, so it must not feel like a wait.
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3 [animation-duration:var(--duration-fast)] animate-in fade-in-0 slide-in-from-top-1">
          {item.children.map((child, i) => {
            const ChildIcon = child.icon
            const active = child.href ? isActive(child.href) : false
            // Compared against the previous SURVIVING child, so a hidden
            // run does not leave its heading stranded above the next one.
            const heading = child.section && child.section !== item.children?.[i - 1]?.section
              ? child.section
              : null
            if (isLocked(child)) {
              return (
                <React.Fragment key={child.label}>
                  {heading && <SectionLabel>{heading}</SectionLabel>}
                <div
                  className={cn(
                    'flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground/50',
                    child.indent && 'ml-3 border-l border-border/60 pl-2.5 text-[13px]',
                  )}
                  title="You don't have permission to open this"
                >
                  <ChildIcon className={cn('shrink-0', child.indent ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                  <span className="flex-1">{child.label}</span>
                  <Lock className="h-3 w-3 shrink-0" />
                </div>
                </React.Fragment>
              )
            }
            return (
              <React.Fragment key={child.label}>
                {heading && <SectionLabel>{heading}</SectionLabel>}
              <Link
                href={child.href ?? '#'}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors [transition-duration:var(--duration-press)] ease-out',
                  child.indent && 'ml-3 border-l border-border/60 pl-2.5 text-[13px]',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <ChildIcon className={cn('shrink-0', child.indent ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                <span>{child.label}</span>
              </Link>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
