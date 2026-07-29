'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const STATUS_COLORS: Record<string, string> = {
  present: 'bg-success text-success-foreground',
  absent:  'bg-destructive text-destructive-foreground',
  late:    'bg-warning text-warning-foreground',
  leave:   'bg-blue-500 text-white',
  holiday: 'bg-muted text-muted-foreground',
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function StudentAttendancePage() {
  const { id } = useParams<{ id: string }>()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data: student } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  const { data: attData, isLoading } = useQuery({
    queryKey: ['student-attendance', id, month, year],
    queryFn: () => studentsApi.getAttendance(id, month, year).then(r => r.data),
  })

  const records = attData?.records ?? []
  const summary = attData?.summary ?? { present: 0, absent: 0, late: 0, total: 0, percentage: 0 }

  const getStatusForDate = (dateStr: string) => {
    return records.find((r: any) => r.date === dateStr)?.status
  }

  // Build calendar
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m)
    setYear(y)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to student">
          <Link href={`/students/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Attendance — {student?.first_name} {student?.last_name}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{student?.classes?.name}</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Present',    value: summary.present,    color: 'text-success bg-success/10' },
          { label: 'Absent',     value: summary.absent,     color: 'text-destructive bg-destructive/10' },
          { label: 'Late',       value: summary.late,       color: 'text-warning bg-warning/10' },
          { label: 'Attendance', value: `${summary.percentage}%`, color: 'text-primary bg-primary/10' },
        ].map(s => (
          <div key={s.label} className={cn('rounded-2xl p-4 text-center', s.color)}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <Card className="rounded-2xl">
        <CardContent className="p-6">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-6">
            <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h3 className="font-semibold text-foreground text-lg">{MONTHS[month - 1]} {year}</h3>
            <Button variant="ghost" size="icon" onClick={() => changeMonth(1)}
              disabled={month === now.getMonth() + 1 && year === now.getFullYear()}
              aria-label="Next month">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells before first day */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {/* Days */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1
                const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const status = getStatusForDate(dateStr)
                const isToday = dateStr === new Date().toISOString().split('T')[0]
                const isFuture = new Date(dateStr) > new Date()
                const isSunday = new Date(dateStr).getDay() === 0

                return (
                  <div key={day} className={cn(
                    'aspect-square rounded-xl flex flex-col items-center justify-center text-sm transition-all',
                    status ? STATUS_COLORS[status] : isSunday ? 'bg-muted text-muted-foreground/50' : isFuture ? 'text-muted-foreground/50' : 'bg-muted text-muted-foreground',
                    isToday && !status && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                  )}>
                    <span className="font-semibold text-sm">{day}</span>
                    {status && <span className="text-xs opacity-80 capitalize">{status[0].toUpperCase()}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border flex-wrap">
            {Object.entries(STATUS_COLORS).map(([s, color]) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={cn('w-4 h-4 rounded', color)} />
                <span className="text-xs text-muted-foreground capitalize">{s}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
