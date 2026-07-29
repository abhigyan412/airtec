'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export type CalendarEvent = { id: string; label: string; color: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MonthCalendar({
  month, onMonthChange, selectedDate, onSelectDate, eventsByDate,
}: {
  month: Date
  onMonthChange: (d: Date) => void
  selectedDate: string | null
  onSelectDate: (dateKey: string) => void
  eventsByDate: Record<string, CalendarEvent[]>
}) {
  const year = month.getFullYear()
  const monthIdx = month.getMonth()
  const firstOfMonth = new Date(year, monthIdx, 1)
  const startOffset = firstOfMonth.getDay()
  const gridStart = new Date(year, monthIdx, 1 - startOffset)
  const todayKey = toDateKey(new Date())

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-5 sm:py-3.5">
        <h3 className="font-semibold text-foreground text-sm">
          {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month"
            onClick={() => onMonthChange(new Date(year, monthIdx - 1, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8"
            onClick={() => onMonthChange(new Date())}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month"
            onClick={() => onMonthChange(new Date(year, monthIdx + 1, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map(w => (
          <div key={w} className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2">
            <span className="sm:hidden">{w[0]}</span>
            <span className="hidden sm:inline">{w}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = toDateKey(d)
          const inMonth = d.getMonth() === monthIdx
          const isToday = key === todayKey
          const isSelected = key === selectedDate
          const events = eventsByDate[key] ?? []
          const visible = events.slice(0, 3)
          const extra = events.length - visible.length

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              aria-label={d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              aria-pressed={isSelected}
              className={cn(
                'min-h-[52px] p-1 sm:min-h-[76px] sm:p-1.5 border-b border-r border-border/60 text-left align-top flex flex-col gap-0.5 sm:gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                (i + 1) % 7 === 0 && 'border-r-0',
                !inMonth && 'bg-muted/30',
                isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-medium flex-shrink-0',
                !inMonth ? 'text-muted-foreground/40' : isToday ? 'bg-primary text-primary-foreground' : isSelected ? 'text-primary font-semibold' : 'text-foreground'
              )}>
                {d.getDate()}
              </span>
              {/* Phones: a dot per event — a truncated label in a ~45px
                  column reads as noise. Tap the day for the detail list. */}
              <div className="flex flex-wrap gap-0.5 sm:hidden">
                {visible.map(ev => (
                  <span key={ev.id} className={cn('h-1.5 w-1.5 rounded-full', ev.color)} />
                ))}
                {extra > 0 && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
              </div>
              <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {visible.map(ev => (
                  <span key={ev.id} className={cn('block truncate text-[10px] font-medium px-1.5 py-0.5 rounded', ev.color)}>
                    {ev.label}
                  </span>
                ))}
                {extra > 0 && <span className="text-[10px] text-muted-foreground px-1.5">+{extra} more</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { toDateKey }
