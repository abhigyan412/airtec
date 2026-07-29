'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/hr/staff',       label: 'Staff Directory' },
  { href: '/hr/attendance',  label: 'Attendance' },
  { href: '/hr/leave',       label: 'Leave' },
  { href: '/hr/payroll',     label: 'Payroll' },
  { href: '/hr/recruitment', label: 'Recruitment' },
  { href: '/hr/reports',     label: 'Reports' },
  { href: '/hr/permissions', label: 'Permissions' },
]

export function HrNav() {
  const pathname = usePathname()
  return (
    <div className="mb-6 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {TABS.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link key={t.href} href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn('whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
