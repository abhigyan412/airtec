'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'
import { Users2, CalendarOff } from 'lucide-react'

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

  const barColor = (fill: number) => fill >= 100 ? 'bg-rose-500' : fill >= 85 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Users2 className="w-4 h-4 text-gray-400" /> Class-wise Strength
        </h3>
        <Link href="/settings/classes" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">Manage →</Link>
      </div>
      <p className="text-xs text-gray-400 mb-4">Present today, out of section capacity</p>

      {isLoading ? (
        <div className="h-24 bg-gray-50 rounded-xl animate-pulse" />
      ) : !isWorkingDay ? (
        <div className="py-8 text-center text-gray-300">
          <CalendarOff className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No school today (holiday / weekly off)</p>
        </div>
      ) : sections.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No sections with enrolled students yet</p>
      ) : (
        <div className="space-y-3">
          {sections.map((s: any) => (
            <div key={s.section_id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">{s.class_name} · {s.section_name}</span>
                <span className="text-xs text-gray-400">
                  {s.marked_today > 0 ? `${s.occupied}/${s.capacity} present` : `${s.enrolled} enrolled · not marked yet`}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className={cn('h-1.5 rounded-full transition-all', s.marked_today > 0 ? barColor(s.fill) : 'bg-gray-200')}
                  style={{ width: `${s.marked_today > 0 ? Math.min(100, s.fill) : Math.min(100, Math.round((s.enrolled / s.capacity) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
