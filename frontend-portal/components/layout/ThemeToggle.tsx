'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
] as const

/**
 * A three-way segmented control rather than a light/dark toggle button. "Auto"
 * has to be reachable — it's the default, and a plain toggle silently strands
 * anyone who taps it away from following their phone's own day/night setting.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // The server can't know the resolved theme, so rendering the selection before
  // mount would hydrate wrong. Reserve the space instead of flashing.
  React.useEffect(() => setMounted(true), [])

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn('inline-flex items-center gap-1 rounded-lg bg-muted p-1', className)}
    >
      {OPTIONS.map((opt) => {
        const selected = mounted && theme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold',
              // Icon-only until there's room for words. In the portal header
              // this control sits beside the brand and the identity block, and
              // three labelled segments cost ~165px that the row doesn't have.
              'w-9 lg:w-auto lg:min-w-[3rem]',
              'transition-colors duration-[var(--duration-press)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <opt.icon className="h-3.5 w-3.5 shrink-0" />
            {/* aria-label on the button already carries this for assistive tech */}
            <span className="hidden lg:inline">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
