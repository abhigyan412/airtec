'use client'
import { GraduationCap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

export function TeacherDashboardHeader() {
  const { data, isLoading } = useTeacherDashboard()
  const header = data?.header
  const firstName = header?.full_name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {greeting}, {firstName} 👋
          </h1>
          {header?.is_class_teacher && header.homeroom_section && (
            <Badge variant="info" className="gap-1">
              <GraduationCap className="h-3 w-3" /> Class Teacher — {header.homeroom_section.class_name} {header.homeroom_section.section_name}
            </Badge>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="mt-1.5 h-4 w-56" />
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {(header?.sections_today?.length ?? 0) > 0
              ? `Teaching ${header!.sections_today.length} section${header!.sections_today.length > 1 ? 's' : ''} today: ${header!.sections_today.map(s => `${s.class_name} ${s.section_name}`).join(', ')}`
              : 'No periods scheduled for you today'}
          </p>
        )}
      </div>
      <p className="text-sm font-semibold text-foreground sm:text-right">
        {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
    </div>
  )
}
