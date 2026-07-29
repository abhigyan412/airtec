'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { visibleNav, isActive } from './nav'

/**
 * Desktop navigation. Everything fits on one row here, so unlike the phone tab
 * bar there's no overflow sheet — a wide screen has no excuse for hiding six
 * links behind a menu.
 */
export function TopNav({ role }: { role?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="hidden sm:block">
      <ul className="flex items-center gap-1">
        {visibleNav(role).map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium',
                  'transition-colors duration-[var(--duration-press)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
