'use client'
import { cn } from '@/lib/utils'

// Meter: fill = actual coverage so far, thin marker = where the plan says
// coverage should be by today ("expected by now"). Track+fill share one
// ramp keyed to severity (how far behind the gap is) so the whole bar
// reads as a single state, not two unrelated colors.
export function SyllabusMeter({
  label, percentComplete, percentExpected, completed, total,
}: {
  label: string
  percentComplete: number
  percentExpected: number
  completed: number
  total: number
}) {
  const gap = percentComplete - percentExpected
  const severity: 'good' | 'warning' | 'critical' = gap >= -5 ? 'good' : gap >= -20 ? 'warning' : 'critical'

  const ramp = {
    good: { track: 'bg-success/15', fill: 'bg-success', text: 'text-success' },
    warning: { track: 'bg-warning/15', fill: 'bg-warning', text: 'text-warning' },
    critical: { track: 'bg-destructive/15', fill: 'bg-destructive', text: 'text-destructive' },
  }[severity]

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <p className={cn('text-xs font-semibold flex-shrink-0', ramp.text)}>
          {percentComplete}% covered
          {gap < -5 && <span className="text-muted-foreground font-normal"> · {Math.abs(gap)}% behind pace</span>}
        </p>
      </div>
      <div className={cn('relative h-2.5 rounded-full overflow-hidden', ramp.track)}>
        <div className={cn('h-full rounded-full transition-all', ramp.fill)} style={{ width: `${percentComplete}%` }} />
        {percentExpected > 0 && percentExpected < 100 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-foreground/50"
            style={{ left: `${percentExpected}%` }}
            title={`Expected by now: ${percentExpected}%`}
          />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{completed} of {total} chapters covered</p>
    </div>
  )
}
