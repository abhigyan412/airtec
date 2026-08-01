'use client'
import { useState } from 'react'
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatDate } from '@/lib/utils'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

// A test on a class-level exam, or homework assigned separately to each
// section, both show up once per section otherwise — the backend already
// groups identical title+date items and reports which sections they
// apply to, so this only renders that grouping: one row with a "N
// sections" tag, expandable to the individual names.
export function UpcomingForMyClasses() {
  const { data, isLoading } = useTeacherDashboard()
  const upcoming = data?.upcoming
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const items = [
    ...(upcoming?.tests ?? []).map(t => ({ key: `test-${t.id}`, label: `${t.subject_name}${t.exam_name ? ` — ${t.exam_name}` : ''}`, date: t.exam_date, kind: 'Test', sections: t.sections })),
    ...(upcoming?.homework_due ?? []).map(h => ({ key: `hw-${h.id}-${h.due_date}`, label: h.title, date: h.due_date, kind: 'Homework due', sections: h.sections })),
    ...(upcoming?.events ?? []).map(e => ({ key: `ev-${e.date}-${e.name}`, label: e.name, date: e.date, kind: 'Event', sections: [] as string[] })),
  ]
    .filter(i => i.date)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))
    .slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" /> Upcoming
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nothing upcoming for your classes" className="py-10" />
        ) : (
          <div className="divide-y divide-border">
            {items.map(i => {
              const multi = i.sections.length > 1
              const isOpen = expanded.has(i.key)
              return (
                <div key={i.key} className="py-2.5">
                  <div
                    className={cn('flex items-center justify-between gap-3', multi && 'cursor-pointer')}
                    onClick={() => multi && toggle(i.key)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {multi && (isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />)}
                        <p className="truncate text-sm font-medium text-foreground">{i.label}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {i.kind}
                        {i.sections.length === 1 && ` · ${i.sections[0]}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {multi && <Badge variant="secondary">{i.sections.length} sections</Badge>}
                      <p className="text-xs font-medium text-muted-foreground">{formatDate(i.date as string)}</p>
                    </div>
                  </div>
                  {multi && isOpen && (
                    <div className="ml-[18px] mt-1.5 flex flex-wrap gap-1.5">
                      {i.sections.map(s => (
                        <span key={s} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
