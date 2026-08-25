'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserPlus, ClipboardList, LayoutGrid, CalendarClock, FileText } from 'lucide-react'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

// Mirrors app/(app)/fees/layout.tsx — same tab-bar-above-{children} pattern.
// Kept in step with the 'Admissions' group's children in
// components/layout/Sidebar.tsx, for the same reason that file's comment
// warns about for Fees: the two drifting is how a page ends up reachable
// from one nav and not the other.
const TABS = [
  { href: '/admission', label: 'Pipeline', icon: UserPlus, exact: true, anyOf: ['admission.view'] },
  { href: '/admission/applications', label: 'Applications', icon: ClipboardList, anyOf: ['admission.view'] },
  { href: '/admission/seats', label: 'Seats', icon: LayoutGrid, anyOf: ['admission.view'] },
  { href: '/admission/cycles', label: 'Cycles', icon: CalendarClock, anyOf: ['admission.view'] },
  { href: '/admission/slots', label: 'Slots', icon: ClipboardList, anyOf: ['admission.view'] },
  { href: '/admission/document-requirements', label: 'Documents', icon: FileText, anyOf: ['admission.view'] },
]

export default function AdmissionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canAny } = usePermissions()

  const visible = TABS.filter(t => canAny(...t.anyOf))

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
