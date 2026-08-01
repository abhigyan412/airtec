'use client'
import Link from 'next/link'
import { NotebookPen, PenLine, Library, CalendarCheck2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTeacherDashboard } from '@/lib/useTeacherDashboard'

// "Message a parent" from the original spec is intentionally omitted —
// there's no parent<->teacher messaging system anywhere in this app yet
// (only one-way notifications), so it would be a dead link.
const BASE_ACTIONS = [
  { label: 'Assign Homework', href: '/homework', icon: NotebookPen },
  { label: 'Enter Marks', href: '/exams', icon: PenLine },
  { label: 'Resource Centre', href: '/resources', icon: Library },
]

export function QuickActions() {
  const { data } = useTeacherDashboard()
  const actions = data?.header?.is_class_teacher
    ? [{ label: 'Take Attendance', href: '/attendance', icon: CalendarCheck2 }, ...BASE_ACTIONS]
    : BASE_ACTIONS

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="flex flex-col items-center gap-2 rounded-xl border border-border px-3 py-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <a.icon className="h-4 w-4" />
              </div>
              <span className="text-xs font-medium text-foreground">{a.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
