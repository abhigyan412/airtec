'use client'
import { useQuery } from '@tanstack/react-query'
import { Clock, BookOpen, NotebookPen, Paperclip } from 'lucide-react'
import { studentsApi, homeworkApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import {
  formatCurrency,
  formatRelativeDue,
  todayLocalISO,
  attendanceTone,
  cn,
} from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatTile } from '@/components/shared/StatTile'
import { NavRow } from '@/components/shared/NavRow'

const today = todayLocalISO()

export default function PortalOverviewPage() {
  const { user } = useAuth()
  const isParent = user?.role === 'parent'

  const { data: me, isLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then((r) => r.data),
  })

  const { data: homework, isLoading: homeworkLoading } = useQuery({
    queryKey: ['portal-homework'],
    queryFn: () => homeworkApi.list().then((r) => r.data),
  })

  // Current-month attendance, so the overview can show the number a family
  // actually cares about instead of the word "View". class_id is ignored
  // server-side for a parent/student account — the backend always resolves and
  // scopes to their own child regardless of what's passed here.
  const now = new Date()
  const { data: attendance } = useQuery({
    queryKey: ['portal-attendance-month', now.getMonth() + 1, now.getFullYear()],
    queryFn: () =>
      studentsApi.getAttendanceReport('', now.getMonth() + 1, now.getFullYear()).then((r) => r.data),
  })

  const upcoming = [...((homework ?? []) as any[])]
    .filter((h) => !h.due_date || h.due_date >= today)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  const attendanceRow = (attendance?.students ?? [])[0]
  const attendancePct: number | undefined =
    attendance?.working_days > 0 ? attendanceRow?.percentage : undefined

  if (isLoading) return <OverviewSkeleton />

  if (!me) {
    return (
      <Card>
        <EmptyState
          title="No student is linked to this account yet"
          description="Your school office needs to connect your login to your child's record. Once they do, everything will show up here."
        />
      </Card>
    )
  }

  const due = me.fee_summary?.total_due ?? 0
  const classLabel = `${me.classes?.name ?? ''}${me.sections?.name ? ` · ${me.sections.name}` : ''}`

  return (
    <div className="space-y-6">
      {/* Who this is about. For a parent the app is about their child, so the
          child's name leads — not the account holder's. */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
          {me.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.photo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-bold text-primary">
              {me.first_name?.[0]}
              {me.last_name?.[0]}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
            {me.first_name} {me.last_name}
          </h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {classLabel && <span>{classLabel} · </span>}
            Admission no. {me.admission_number}
          </p>
        </div>
      </div>

      {/* Each tile carries a real measurement. The previous version put the word
          "View" in the value slot, which looks like data and carries none. */}
      <div className="grid grid-cols-2 gap-3">
        {isParent && (
          <StatTile
            label="Fees due"
            value={formatCurrency(due)}
            hint={due > 0 ? 'Tap to see invoices' : 'All settled — nothing owing'}
            tone={due > 0 ? 'destructive' : 'success'}
            href="/fees"
          />
        )}
        <StatTile
          label="Attendance"
          value={attendancePct === undefined ? '—' : `${attendancePct}%`}
          hint={
            attendancePct === undefined
              ? 'Not marked yet this month'
              : `This month${attendancePct < 75 ? ' · below 75%' : ''}`
          }
          tone={attendancePct === undefined ? 'default' : attendanceTone(attendancePct)}
          href="/attendance"
        />
        <StatTile
          label="Homework due"
          value={homeworkLoading ? '—' : upcoming.length}
          hint={upcoming.length === 1 ? '1 assignment open' : `${upcoming.length} assignments open`}
          tone={upcoming.length > 0 ? 'warning' : 'success'}
          href="/homework"
          className={cn(!isParent && 'col-span-2')}
        />
      </div>

      {/* Actual content, not another tile. What's due next is the single thing
          most likely to be why they opened the app. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Coming up</CardTitle>
          {upcoming.length > 3 && (
            <span className="text-xs text-muted-foreground">
              showing 3 of {upcoming.length}
            </span>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {homeworkLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={NotebookPen}
              title="Nothing due right now"
              description="No homework is outstanding. You'll get a notification as soon as a teacher posts something new."
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.slice(0, 3).map((h: any) => {
                const relative = h.due_date ? formatRelativeDue(h.due_date) : null
                return (
                  <li key={h.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{h.title}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span className="truncate">{h.subject_name}</span>
                        {h.attachment_url && (
                          <Paperclip className="h-3 w-3 shrink-0" aria-label="Has attachment" />
                        )}
                      </p>
                    </div>
                    {relative && (
                      <Badge
                        variant={relative.overdue ? 'destructive' : 'neutral'}
                        className="shrink-0 normal-case"
                      >
                        {relative.label}
                      </Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The sections without a number worth putting on a tile. */}
      <div className="space-y-2.5">
        <NavRow href="/timetable" icon={Clock} label="Weekly timetable" />
        <NavRow href="/exams" icon={BookOpen} label="Exam results" />
      </div>
    </div>
  )
}

/** Mirrors the real layout block-for-block so nothing shifts when data lands. */
function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[92px] rounded-lg" />
        <Skeleton className="h-[92px] rounded-lg" />
        <Skeleton className="h-[92px] rounded-lg" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <div className="space-y-2.5">
        <Skeleton className="h-[52px] w-full rounded-lg" />
        <Skeleton className="h-[52px] w-full rounded-lg" />
      </div>
    </div>
  )
}
