'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { Users2, CalendarOff, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

export function ClassStrength() {
  const { can, isSuperRole } = usePermissions()
  const canView = isSuperRole || can('student.view')

  const { data: res, isLoading } = useQuery({
    queryKey: ['dashboard-class-strength'],
    queryFn: () => classesApi.strength().then(r => r.data),
    enabled: canView,
  })

  if (!canView) return null
  const isWorkingDay = res?.is_working_day ?? true
  const sections = ((res?.sections ?? []) as any[])
    .filter((s: any) => s.capacity > 0 && s.enrolled > 0)
    .map((s: any) => ({ ...s, fill: Math.round((s.occupied / s.capacity) * 100) }))
    .sort((a: any, b: any) => b.occupied - a.occupied)
    .slice(0, 8)

  const barColor = (fill: number) => fill >= 100 ? 'bg-destructive' : fill >= 85 ? 'bg-warning' : 'bg-success'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-muted-foreground" /> Class-wise Strength
          </CardTitle>
          <Link
            href="/settings/classes"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            Manage <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">Present today, out of section capacity</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : !isWorkingDay ? (
          <EmptyState icon={CalendarOff} title="No school today (holiday / weekly off)" className="py-8" />
        ) : sections.length === 0 ? (
          <EmptyState icon={Users2} title="No sections with enrolled students yet" className="py-8" />
        ) : (
          <div className="space-y-3">
            {sections.map((s: any) => (
              <div key={s.section_id}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{s.class_name} · {s.section_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.marked_today > 0 ? `${s.occupied}/${s.capacity} present` : `${s.enrolled} enrolled · not marked yet`}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div
                    className={cn('h-1.5 rounded-full transition-all', s.marked_today > 0 ? barColor(s.fill) : 'bg-muted-foreground/30')}
                    style={{ width: `${s.marked_today > 0 ? Math.min(100, s.fill) : Math.min(100, Math.round((s.enrolled / s.capacity) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
