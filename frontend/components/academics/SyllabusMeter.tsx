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
    good: { track: 'bg-emerald-100', fill: 'bg-emerald-500', text: 'text-emerald-700' },
    warning: { track: 'bg-amber-100', fill: 'bg-amber-500', text: 'text-amber-700' },
    critical: { track: 'bg-red-100', fill: 'bg-red-500', text: 'text-red-700' },
  }[severity]

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
        <p className={cn('text-xs font-semibold flex-shrink-0', ramp.text)}>
          {percentComplete}% covered
          {gap < -5 && <span className="text-gray-400 font-normal"> · {Math.abs(gap)}% behind pace</span>}
        </p>
      </div>
      <div className={cn('relative h-2.5 rounded-full overflow-hidden', ramp.track)}>
        <div className={cn('h-full rounded-full transition-all', ramp.fill)} style={{ width: `${percentComplete}%` }} />
        {percentExpected > 0 && percentExpected < 100 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-gray-700/60"
            style={{ left: `${percentExpected}%` }}
            title={`Expected by now: ${percentExpected}%`}
          />
        )}
      </div>
      <p className="text-[11px] text-gray-400">{completed} of {total} chapters covered</p>
    </div>
  )
}
