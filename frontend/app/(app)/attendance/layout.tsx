'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, BarChart3 } from 'lucide-react'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

// Mirrors app/(app)/homework/layout.tsx and .../syllabus/layout.tsx — same
// tab-bar-above-{children} pattern, kept in step with the 'Student
// Attendance' group's children in components/layout/Sidebar.tsx. Split
// 2026-08-28 from one page that switched between marking and reporting
// via Radix tabs — same "make it a real sub-section, not a tab hidden
// behind a picker" restructure every other module in this session got.
const TABS = [
  { href: '/attendance', label: 'Mark Attendance', icon: ClipboardList, exact: true, anyOf: ['attendance.view'] },
  { href: '/attendance/report', label: 'Attendance Report', icon: BarChart3, anyOf: ['attendance.view'] },
]

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canAny } = usePermissions()

  const visible = TABS.filter(t => canAny(...t.anyOf))
  if (visible.length <= 1) return <div className="animate-fade-in">{children}</div>

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {visible.map(t => {
          const active = t.exact ? pathname === t.href : pathname?.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
