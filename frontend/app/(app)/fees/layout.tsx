'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wallet, CreditCard, BarChart3, Tag, Receipt, UserCheck, Layers } from 'lucide-react'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

// The fee module was four pages that did not know about each other: an Overview
// with four tabs, a Collections page, an Arrears page, and a homeroom list. The
// job an accountant actually does — take a payment from the person standing at
// the desk — was a modal on a row inside a tab.
//
// These five are the jobs, in the order a school does them: see where we stand,
// take money, send bills, chase what is late, configure the rules. Discounts sit
// off the nav deliberately: they are reached from the student you are discussing
// them for, or from the approval queue on Overview, not by browsing.

const TABS = [
  { href: '/fees', label: 'Overview', icon: Wallet, exact: true, anyOf: ['fee.view'] },
  { href: '/fees/collect', label: 'Collect', icon: CreditCard, anyOf: ['fee.collect', 'fee.view'] },
  // Billing is not a destination any more. A plan carries its own schedule — when
  // each installment is raised and when it falls due — so raising one is an action
  // on the installment you are looking at, not a separate screen that re-asks the
  // year, the cadence, the period and the due date the plan already knows.
  { href: '/fees/structures', label: 'Structures', icon: Layers, anyOf: ['fee.structure_manage', 'fee.view'] },
  { href: '/fees/recovery', label: 'Recovery', icon: BarChart3, anyOf: ['fee.view'] },
  { href: '/fees/receipts', label: 'Receipts', icon: Receipt, anyOf: ['fee.view', 'fee.collect'] },
  { href: '/fees/approvals', label: 'Approvals', icon: UserCheck, anyOf: ['fee.structure_manage', 'fee.discount'] },
  { href: '/fees/discounts', label: 'Discounts', icon: Tag, anyOf: ['fee.discount', 'fee.view'] },
]

export default function FeesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canAny } = usePermissions()

  // The homeroom view is a teacher's own section, reached from their dashboard.
  // It has no business carrying the staff fee nav.
  if (pathname?.startsWith('/fees/homeroom')) return <>{children}</>

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
