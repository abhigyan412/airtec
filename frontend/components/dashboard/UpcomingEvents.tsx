'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { calendarApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatDate } from '@/lib/utils'
import { PartyPopper, CalendarDays, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const in30DaysStr = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// Holidays-only for now — the Academic Calendar feature only tracks
// holidays today. Exam dates/homework due dates are separate, unrelated
// tables with no unified "calendar events" concept to pull from yet.
export function UpcomingEvents() {
  const { isSuperRole, can } = usePermissions()
  const canView = isSuperRole || can('attendance.view')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-upcoming-events', todayStr, in30DaysStr],
    queryFn: () => calendarApi.holidays.upcoming(todayStr, in30DaysStr).then(r => r.data),
    enabled: canView,
  })

  if (!canView) return null
  const holidays = data ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" /> Upcoming Events
        </CardTitle>
        <Link
          href="/settings/calendar"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Manage <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ) : holidays.length === 0 ? (
          <EmptyState icon={PartyPopper} title="No holidays in the next 30 days" className="py-10" />
        ) : (
          <div className="space-y-2.5">
            {holidays.slice(0, 6).map((h: any) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"
              >
                <p className="truncate text-sm font-medium text-foreground">{h.name}</p>
                <span className="ml-3 flex-shrink-0 text-xs font-semibold text-success">{formatDate(h.date)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
