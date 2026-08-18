'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Users, UserPlus, CreditCard, AlertCircle, LayoutDashboard, ArrowRight, Plus } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { studentsApi, admissionApi, feeApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { NeedsAttentionToday } from '@/components/dashboard/NeedsAttentionToday'
import { UpcomingExams } from '@/components/dashboard/UpcomingExams'
import { ClassStrength } from '@/components/dashboard/ClassStrength'
import { UpcomingEvents } from '@/components/dashboard/UpcomingEvents'
import { FeeCollectionTrend } from '@/components/dashboard/FeeCollectionTrend'
import { TeacherDashboard } from '@/components/teacher-dashboard/TeacherDashboard'
import { PrincipalDashboard } from '@/components/principal-dashboard/PrincipalDashboard'

const CHART_COLORS = [
  'hsl(243 75% 62%)',
  'hsl(262 70% 62%)',
  'hsl(280 65% 65%)',
  'hsl(243 60% 72%)',
  'hsl(243 55% 80%)',
  'hsl(243 50% 86%)',
]

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
    >
      View all <ArrowRight className="h-3 w-3" />
    </Link>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { can, isLoading: permLoading, moduleEnabled } = usePermissions()

  // A school that has not bought the dashboard has nothing to show here —
  // every panel below is students, admissions and fees. Rather than
  // render a page of empty widgets, send them to the first thing they do
  // run. Login and the root route both land here, so this is the one
  // place that has to know.
  const dashboardEnabled = moduleEnabled('dashboard')
  React.useEffect(() => {
    if (permLoading || dashboardEnabled) return
    router.replace(moduleEnabled('timetable') ? '/timetable/my-week' : '/settings/team')
  }, [permLoading, dashboardEnabled, moduleEnabled, router])

  if (!permLoading && !dashboardEnabled) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    )
  }

  // Teachers get an entirely different, personally-scoped dashboard —
  // not a stripped-down version of the admin one below (which shows
  // school-wide fee/admissions figures a teacher must never see).
  if (user?.role === 'teacher') return <TeacherDashboard />

  // Principals get an academic-oversight/escalation view, not the
  // admin operational task list — school-wide aggregates and flagged
  // insights only, never invoice-level or admission-stage-level detail.
  // (Principal keeps their existing broad RBAC permissions elsewhere in
  // the app for approvals — this dashboard is additive, not a
  // permission restriction.)
  if (user?.role === 'principal') return <PrincipalDashboard />

  const canViewStudents = can('student.view')
  const canViewAdmission = can('admission.view')
  const canViewFees = can('fee.view')
  const hasAnyAccess = canViewStudents || canViewAdmission || canViewFees

  const { data: studentStats } = useQuery({
    queryKey: ['student-stats'],
    queryFn: () => studentsApi.stats().then((r) => r.data),
    enabled: canViewStudents,
  })
  const { data: inquiryStats, isLoading: inquiryLoading } = useQuery({
    queryKey: ['inquiry-stats'],
    queryFn: () => admissionApi.inquiries.stats().then((r) => r.data),
    enabled: canViewAdmission,
  })
  const { data: feeStats } = useQuery({
    queryKey: ['fee-stats'],
    queryFn: () => feeApi.stats().then((r) => r.data),
    enabled: canViewFees,
  })
  const { data: recentStudents, isLoading: recentLoading } = useQuery({
    queryKey: ['recent-students'],
    queryFn: () => studentsApi.list({ limit: 5, page: 1 }).then((r) => r.data),
    enabled: canViewStudents,
  })
  // Only the first 8 are rendered, so only 8 are fetched; the headline count
  // comes off meta.total, which the server counts across the whole school.
  // Measuring the returned array capped this at the page size (50).
  const { data: duesPage, isLoading: duesLoading } = useQuery({
    queryKey: ['fee-dues', { limit: 8 }],
    queryFn: () => feeApi.dues({ page: 1, limit: 8 }),
    enabled: canViewFees,
  })
  const dues: any[] = duesPage?.data ?? []
  const duesTotal: number = duesPage?.meta?.total ?? 0

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'

  const pipelineData =
    inquiryStats?.by_status
      ?.filter((s: any) => !['lost', 'rejected'].includes(s.status))
      ?.map((s: any) => ({ name: s.status.replace(/_/g, ' '), count: s.count })) ?? []

  return (
    <div className="animate-fade-in space-y-6">
      {/* Greeting */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {greeting}, {firstName} 👋
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Here&apos;s your school overview for today</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm font-semibold text-foreground">{(user as any)?.schools?.name}</p>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {!permLoading && !hasAnyAccess ? (
        <Card>
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboard data available for your role"
            description="Contact your administrator if you believe this is an error."
          />
        </Card>
      ) : (
        <>
          <NeedsAttentionToday />

          {/* KPI cards — skeletons until permissions resolve, otherwise the
              grid renders empty for a beat and the page jumps when it fills. */}
          {permLoading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {canViewStudents && (
                <Link href="/students">
                  <StatCard
                    label="Total Students"
                    value={studentStats?.total_students ?? '—'}
                    icon={Users}
                    accent="primary"
                    hint={`${studentStats?.active_students ?? 0} active · +${studentStats?.new_this_month ?? 0} this month`}
                  />
                </Link>
              )}
              {canViewAdmission && (
                <Link href="/admission">
                  <StatCard
                    label="Inquiries"
                    value={inquiryStats?.total ?? '—'}
                    icon={UserPlus}
                    accent="info"
                    hint={`${inquiryStats?.conversion_rate ?? 0}% converted`}
                  />
                </Link>
              )}
              {canViewFees && (
                <>
                  <Link href="/fees">
                    <StatCard
                      label="Fee Collected"
                      value={feeStats ? formatCurrency(feeStats.total_collected) : '—'}
                      icon={CreditCard}
                      accent="success"
                      hint={`${feeStats?.paid_invoices ?? 0} paid invoices`}
                    />
                  </Link>
                  <Link href="/fees/recovery">
                    <StatCard
                      label="Pending Dues"
                      value={feeStats ? formatCurrency(feeStats.total_due) : '—'}
                      icon={AlertCircle}
                      accent="destructive"
                      hint={`${feeStats?.unpaid_invoices ?? 0} unpaid invoices`}
                    />
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Pipeline + dues */}
          {(canViewAdmission || canViewFees) && (
            <div className={`grid grid-cols-1 gap-6 ${canViewAdmission && canViewFees ? 'lg:grid-cols-3' : ''}`}>
              {canViewAdmission && (
                <Card className={canViewFees ? 'lg:col-span-2' : ''}>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle>Admission Pipeline</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">Inquiries by stage</p>
                    </div>
                    <ViewAll href="/admission" />
                  </CardHeader>
                  <CardContent>
                    {inquiryLoading ? (
                      <Skeleton className="h-[220px] w-full rounded-xl" />
                    ) : pipelineData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={pipelineData} barSize={36} barGap={4}>
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            width={25}
                          />
                          <Tooltip
                            contentStyle={{
                              border: '1px solid hsl(var(--border))',
                              borderRadius: 12,
                              fontSize: 13,
                              background: 'hsl(var(--popover))',
                              color: 'hsl(var(--popover-foreground))',
                              boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)',
                            }}
                            cursor={{ fill: 'hsl(var(--muted))', radius: 6 }}
                          />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                            {pipelineData.map((_: any, i: number) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyState
                        icon={UserPlus}
                        title="No inquiries yet"
                        description="New admission inquiries will appear here as they come in."
                        className="py-12"
                      />
                    )}
                  </CardContent>
                </Card>
              )}

              {canViewFees && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle>Pending Dues</CardTitle>
                      {/* Invoices, not students — one student can hold several. */}
                      <p className="mt-0.5 text-xs text-muted-foreground">{duesTotal} unpaid invoice{duesTotal === 1 ? '' : 's'}</p>
                    </div>
                    <ViewAll href="/fees/recovery" />
                  </CardHeader>
                  <CardContent>
                    {duesLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-11 w-full rounded-lg" />
                        ))}
                      </div>
                    ) : dues.length > 0 ? (
                      <div className="max-h-[250px] space-y-1 overflow-y-auto pr-1">
                        {dues.map((inv: any) => (
                          <div
                            key={inv.id}
                            className="flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {inv.students?.first_name} {inv.students?.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground">{inv.students?.classes?.name}</p>
                            </div>
                            <div className="ml-3 shrink-0 text-right">
                              <p className="text-sm font-bold text-destructive">{formatCurrency(inv.total_amount)}</p>
                              <Badge variant={inv.status === 'partial' ? 'warning' : 'destructive'} className="mt-0.5">
                                {inv.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={CreditCard}
                        title="No pending dues 🎉"
                        description="Every invoice raised so far has been paid in full."
                        className="py-12"
                      />
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Recent students */}
          {canViewStudents && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recently Added Students</CardTitle>
                <ViewAll href="/students" />
              </CardHeader>
              <CardContent className="p-0">
                {recentLoading ? (
                  <div className="space-y-3 p-6">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (recentStudents ?? []).length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No students added yet"
                    description="Add your first student and the newest admissions will show up here."
                    action={
                      <Button asChild>
                        <Link href="/students/new">
                          <Plus className="h-4 w-4" /> Add Student
                        </Link>
                      </Button>
                    }
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {(recentStudents ?? []).map((s: any) => (
                      <div key={s.id} className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/50">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                            {s.first_name?.[0]}
                            {s.last_name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {s.first_name} {s.last_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.classes?.name ?? 'No class'}
                            {s.sections?.name ? ` · ${s.sections.name}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-xs text-muted-foreground">{s.admission_number}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground/70">{formatDate(s.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Academic snapshot */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <UpcomingExams />
            <ClassStrength />
            <UpcomingEvents />
          </div>

          <FeeCollectionTrend />
        </>
      )}
    </div>
  )
}
