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
    <div className="flex items-center gap-1 bg-muted p-1 rounded-xl w-fit mb-6 overflow-x-auto max-w-full">
      {TABS.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link key={t.href} href={t.href}
            className={cn('px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all',
              active ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
