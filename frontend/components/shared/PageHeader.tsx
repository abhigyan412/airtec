import * as React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  actions?: React.ReactNode
  className?: string
  /** Opt-in: icon/title/description centered as a block instead of the
   * default left-aligned-next-to-icon layout. Off by default everywhere —
   * this component is shared across every authenticated page, so a
   * module asking for a centered look (e.g. the timetable pages) passes
   * this explicitly rather than the default changing for everyone. */
  centered?: boolean
}

/** Consistent page title block used at the top of every authenticated page. */
export function PageHeader({ title, description, icon: Icon, actions, className, centered }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className={cn('flex items-start gap-3', centered && 'flex-col items-center text-center sm:flex-row sm:text-left')}>
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
