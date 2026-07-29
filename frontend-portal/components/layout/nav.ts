import type * as React from 'react'
import {
  LayoutDashboard,
  CalendarCheck,
  Wallet,
  NotebookPen,
  Clock,
  BookOpen,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Fees is household billing — a student has no business seeing what their
   *  parents owe. Everything else is identical for both roles. */
  parentOnly?: boolean
}

/**
 * Every destination in the app, in the order a family actually needs them.
 * Ordering is by real frequency, not by module size: homework is checked daily,
 * exam results a handful of times a year.
 */
export const NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/homework', label: 'Homework', icon: NotebookPen },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/fees', label: 'Fees', icon: Wallet, parentOnly: true },
  { href: '/timetable', label: 'Timetable', icon: Clock },
  { href: '/exams', label: 'Results', icon: BookOpen },
]

export const visibleNav = (role?: string) =>
  NAV.filter((item) => !item.parentOnly || role === 'parent')

/**
 * The phone tab bar holds four destinations plus "More". Five is the practical
 * ceiling before targets get too narrow to hit reliably, so the two least-used
 * sections move into the More sheet rather than being crushed in beside the rest.
 *
 * A parent's fourth slot is Fees (they get billed); a student's is Timetable,
 * since Fees isn't theirs to see.
 */
export function primaryNav(role?: string): NavItem[] {
  const visible = visibleNav(role)
  const wanted = role === 'parent'
    ? ['/', '/homework', '/attendance', '/fees']
    : ['/', '/homework', '/attendance', '/timetable']
  return wanted.map((href) => visible.find((i) => i.href === href)!).filter(Boolean)
}

/** Whatever the tab bar couldn't fit — shown in the More sheet. */
export function overflowNav(role?: string): NavItem[] {
  const primary = new Set(primaryNav(role).map((i) => i.href))
  return visibleNav(role).filter((i) => !primary.has(i.href))
}

/**
 * Exact match only. Every portal route is a single top-level segment, and '/'
 * is a prefix of all of them — `startsWith` would light up Home on every page.
 */
export const isActive = (pathname: string, href: string) => pathname === href
