'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryNav, isActive } from './nav'

/**
 * Phone navigation. A tab bar rather than the row of scrolling top tabs this
 * app used to have: on a phone the top of the screen is the hardest place to
 * reach one-handed, and a horizontally-scrolling nav hides its own contents —
 * you can't tap what you don't know is there.
 *
 * Deliberately not animated. These get tapped dozens of times a day, and
 * anything that plays on every tap reads as lag by the tenth one. The active
 * state is instant: colour and weight, no sliding indicator.
 */
export function BottomTabs({ role, onMore, moreOpen }: {
  role?: string
  onMore: () => void
  moreOpen: boolean
}) {
  const pathname = usePathname()
  const tabs = primaryNav(role)
  // Tapping "More" shouldn't leave the tab bar looking like nothing is selected.
  const overflowActive = !moreOpen && !tabs.some((t) => isActive(pathname, t.href))

  return (
    <nav
      aria-label="Main"
      className="chrome fixed inset-x-0 bottom-0 z-40 border-t pb-safe sm:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href)
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-1 px-1',
                  'transition-colors duration-[var(--duration-press)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <tab.icon className={cn('h-[22px] w-[22px]', active && 'stroke-[2.4]')} />
                <span className={cn('text-[11px] leading-none', active ? 'font-semibold' : 'font-medium')}>
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              'flex h-full w-full flex-col items-center justify-center gap-1 px-1',
              'transition-colors duration-[var(--duration-press)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              moreOpen || overflowActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <MoreHorizontal className="h-[22px] w-[22px]" />
            <span className="text-[11px] font-medium leading-none">More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
