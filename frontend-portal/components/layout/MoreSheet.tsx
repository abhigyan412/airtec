'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, LogOut, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { overflowNav, isActive } from './nav'
import { ThemeToggle } from './ThemeToggle'

/**
 * The phone "More" sheet: the destinations that didn't fit the tab bar, plus
 * the account actions. Sign-out lives here rather than as a 30px icon in the
 * header, where it sat next to nothing else and was easy to hit by accident.
 *
 * Radix Dialog handles the parts that are easy to get wrong by hand — focus
 * trap, Escape, restoring focus to the trigger, scroll lock, aria wiring.
 */
export function MoreSheet({
  open,
  onOpenChange,
  role,
  student,
  onSignOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: string
  student?: { name: string; detail?: string; initials: string; photoUrl?: string }
  onSignOut: () => void
}) {
  const pathname = usePathname()
  const items = overflowNav(role)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 sm:hidden',
            'data-[state=open]:animate-fade data-[state=closed]:animate-fade-out',
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 sm:hidden',
            'rounded-t-[calc(var(--radius-surface)*1.5)] border-t bg-card pb-safe',
            'focus:outline-none',
            // Enters and leaves along the same edge, so the sheet reads as one
            // object arriving and departing rather than two unrelated effects.
            'data-[state=open]:animate-slide-up data-[state=closed]:animate-slide-down',
            // Reduced motion keeps the dimming (it explains that the page behind
            // is inert) and drops only the travel.
            'motion-reduce:animate-none',
          )}
        >
          {/* Grabber: a visual affordance that this panel belongs to the bottom
              edge. Purely decorative, so hidden from the a11y tree. */}
          <div className="flex justify-center pt-2.5" aria-hidden>
            <div className="h-1 w-9 rounded-full bg-border" />
          </div>

          <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                {student?.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={student.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-primary">{student?.initials ?? 'S'}</span>
                )}
              </div>
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-bold text-foreground">
                  {student?.name ?? 'Your account'}
                </Dialog.Title>
                {student?.detail && (
                  <p className="truncate text-sm text-muted-foreground">{student.detail}</p>
                )}
              </div>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1.5 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-[18px] w-[18px]" />
            </Dialog.Close>
          </div>

          {items.length > 0 && (
            <ul className="border-t px-2 py-2">
              {items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[3rem] items-center gap-3 rounded-lg px-3 text-sm font-medium',
                        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
            <span className="text-sm font-medium text-foreground">Appearance</span>
            <ThemeToggle />
          </div>

          <div className="border-t p-3">
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-[3rem] w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              Sign out
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
