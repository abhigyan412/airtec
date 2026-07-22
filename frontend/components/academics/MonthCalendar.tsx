'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">
          {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => onMonthChange(new Date(year, monthIdx - 1, 1))}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => onMonthChange(new Date())}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
            Today
          </button>
          <button onClick={() => onMonthChange(new Date(year, monthIdx + 1, 1))}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map(w => (
          <div key={w} className="px-2 py-2 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            {w}
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
              className={cn(
                'min-h-[76px] p-1.5 border-b border-r border-gray-50 text-left align-top flex flex-col gap-1 transition-colors',
                (i + 1) % 7 === 0 && 'border-r-0',
                !inMonth && 'bg-gray-50/50',
                isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-medium flex-shrink-0',
                !inMonth ? 'text-gray-300' : isToday ? 'bg-indigo-600 text-white' : isSelected ? 'text-indigo-700 font-semibold' : 'text-gray-600'
              )}>
                {d.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                {visible.map(ev => (
                  <span key={ev.id} className={cn('block truncate text-[10px] font-medium px-1.5 py-0.5 rounded', ev.color)}>
                    {ev.label}
                  </span>
                ))}
                {extra > 0 && <span className="text-[10px] text-gray-400 px-1.5">+{extra} more</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { toDateKey }
