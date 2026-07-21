'use client'
import { useQuery } from '@tanstack/react-query'
import { Users, UserPlus, CreditCard, AlertCircle, TrendingUp, ArrowUpRight, Clock, LayoutDashboard } from 'lucide-react'
import { studentsApi, admissionApi, feeApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import Link from 'next/link'

export default function DashboardPage() {
  const { user } = useAuth()

  // ── RBAC ──────────────────────────────────────────────────
  const { can, isLoading: permLoading } = usePermissions()
  const canViewStudents  = can('student.view')
  const canViewAdmission = can('admission.view')
  const canViewFees      = can('fee.view')
  const hasAnyAccess = canViewStudents || canViewAdmission || canViewFees

  const { data: studentStats } = useQuery({
    queryKey: ['student-stats'],
    queryFn: () => studentsApi.stats().then(r => r.data),
    enabled: canViewStudents,
  })
  const { data: inquiryStats } = useQuery({
    queryKey: ['inquiry-stats'],
    queryFn: () => admissionApi.inquiries.stats().then(r => r.data),
    enabled: canViewAdmission,
  })
  const { data: feeStats } = useQuery({
    queryKey: ['fee-stats'],
    queryFn: () => feeApi.stats().then(r => r.data),
    enabled: canViewFees,
  })
  const { data: recentStudents } = useQuery({
    queryKey: ['recent-students'],
    queryFn: () => studentsApi.list({ limit: 5, page: 1 }).then(r => r.data),
    enabled: canViewStudents,
  })
  const { data: dues } = useQuery({
    queryKey: ['fee-dues'],
    queryFn: () => feeApi.dues().then(r => r.data),
    enabled: canViewFees,
  })

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const pipelineData = inquiryStats?.by_status
    ?.filter((s: any) => !['lost', 'rejected'].includes(s.status))
    ?.map((s: any) => ({ name: s.status.replace('_', ' '), count: s.count })) ?? []

  const COLORS = ['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#e0e7ff','#eef2ff']

  // ── Build KPI cards based on permission ───────────────────
  const cards: any[] = []
  if (canViewStudents) {
    cards.push({
      label: 'Total Students',
      value: studentStats?.total_students ?? '—',
      sub: `${studentStats?.active_students ?? 0} active`,
      trend: `+${studentStats?.new_this_month ?? 0} this month`,
      icon: Users,
      color: 'bg-indigo-600',
      light: 'bg-indigo-50 text-indigo-600',
      href: '/students',
    })
  }
  if (canViewAdmission) {
    cards.push({
      label: 'Inquiries',
      value: inquiryStats?.total ?? '—',
      sub: `${inquiryStats?.conversion_rate ?? 0}% converted`,
      trend: `${inquiryStats?.by_status?.find((s:any)=>s.status==='new')?.count ?? 0} new`,
      icon: UserPlus,
      color: 'bg-violet-500',
      light: 'bg-violet-50 text-violet-600',
      href: '/admission',
    })
  }
  if (canViewFees) {
    cards.push({
      label: 'Fee Collected',
      value: feeStats ? formatCurrency(feeStats.total_collected) : '—',
      sub: 'this academic year',
      trend: `${feeStats?.paid_invoices ?? 0} paid invoices`,
      icon: CreditCard,
      color: 'bg-emerald-500',
      light: 'bg-emerald-50 text-emerald-600',
      href: '/fees',
    })
    cards.push({
      label: 'Pending Dues',
      value: feeStats ? formatCurrency(feeStats.total_due) : '—',
      sub: `${feeStats?.unpaid_invoices ?? 0} unpaid invoices`,
      trend: 'Needs attention',
      icon: AlertCircle,
      color: 'bg-rose-500',
      light: 'bg-rose-50 text-rose-600',
      href: '/fees',
    })
  }

  // ── No access at all ───────────────────────────────────────
  if (!permLoading && !hasAnyAccess) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.full_name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-400 text-sm mt-0.5">Here's your school overview for today</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <LayoutDashboard className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No dashboard data available for your role</p>
          <p className="text-sm text-gray-300 mt-1">Contact your administrator if you believe this is an error</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.full_name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-400 text-sm mt-0.5">Here's your school overview for today</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-700">{(user as any)?.schools?.name}</p>
          <p className="text-xs text-gray-400">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      {/* KPI Cards */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {cards.map(card => (
            <Link key={card.label} href={card.href} className="group bg-white rounded-2xl border border-gray-200 p-5 hover:border-gray-300 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.color}`}>
                  <card.icon className="w-5 h-5 text-white" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{card.label}</p>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">{card.sub}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${card.light}`}>{card.trend}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Charts + tables */}
      {(canViewAdmission || canViewFees) && (
        <div className={`grid grid-cols-1 gap-6 ${canViewAdmission && canViewFees ? 'lg:grid-cols-3' : ''}`}>
          {/* Admission pipeline chart */}
          {canViewAdmission && (
            <div className={`bg-white rounded-2xl border border-gray-200 p-6 ${canViewFees ? 'lg:col-span-2' : ''}`}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-semibold text-gray-900">Admission Pipeline</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Inquiries by stage</p>
                </div>
                <Link href="/admission" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">View all →</Link>
              </div>
              {pipelineData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={pipelineData} barSize={36} barGap={4}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={25} />
                    <Tooltip
                      contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                      cursor={{ fill: '#f9fafb', radius: 6 }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {pipelineData.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
                  <UserPlus className="w-10 h-10 mb-2" />
                  <p className="text-sm">No inquiries yet</p>
                </div>
              )}
            </div>
          )}

          {/* Pending dues */}
          {canViewFees && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">Pending Dues</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{(dues ?? []).length} students</p>
                </div>
                <Link href="/fees" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">View all →</Link>
              </div>
              {(dues ?? []).length > 0 ? (
                <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
                  {(dues ?? []).slice(0, 8).map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {inv.students?.first_name} {inv.students?.last_name}
                        </p>
                        <p className="text-xs text-gray-400">{inv.students?.classes?.name}</p>
                      </div>
                      <div className="text-right ml-3 flex-shrink-0">
                        <p className="text-sm font-bold text-rose-600">{formatCurrency(inv.total_amount)}</p>
                        <span className={`text-xs ${inv.status === 'partial' ? 'text-amber-500' : 'text-rose-400'}`}>
                          {inv.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[200px] flex flex-col items-center justify-center text-gray-300">
                  <CreditCard className="w-10 h-10 mb-2" />
                  <p className="text-sm">No pending dues 🎉</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent students */}
      {canViewStudents && (
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Recently Added Students</h3>
            <Link href="/students" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">View all →</Link>
          </div>
          {(recentStudents ?? []).length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No students added yet</p>
              <Link href="/students/new" className="text-xs text-indigo-500 mt-1 inline-block font-medium">Add your first student →</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(recentStudents ?? []).map((s: any) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-700 text-xs font-bold">{s.first_name[0]}{s.last_name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-gray-400">{s.classes?.name ?? 'No class'}{s.sections?.name ? ` · ${s.sections.name}` : ''}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400 font-mono">{s.admission_number}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{formatDate(s.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}