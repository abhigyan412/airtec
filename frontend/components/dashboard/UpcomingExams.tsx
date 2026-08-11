'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatDate } from '@/lib/utils'
import { BookOpen, CalendarClock, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

export function UpcomingExams() {
  const { can } = usePermissions()
  const canView = can('exam.view')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-upcoming-exams'],
    // No `days` param — defaults server-side to the rest of the current
    // academic year rather than a rolling 7-day window.
    queryFn: () => api.get('/exams/upcoming').then(r => r.data.data),
    enabled: canView,
  })

  if (!canView) return null
  const exams = data ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" /> Upcoming Exams
        </CardTitle>
        <Link
          href="/exams"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : exams.length === 0 ? (
          <EmptyState icon={BookOpen} title="No exams scheduled this academic year" className="py-10" />
        ) : (
          <div className="space-y-2.5">
            {exams.map((e: any) => (
              <Link
                key={e.id}
                href={`/exams/${e.id}`}
                className="flex items-center justify-between rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{e.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {e.exam_type?.replace('_', ' ')}{e.academic_years?.name ? ` · ${e.academic_years.name}` : ''}
                  </p>
                </div>
                <span className="ml-3 flex-shrink-0 text-xs font-semibold text-primary">{formatDate(e.start_date)}</span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
