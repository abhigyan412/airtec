'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Search, Users, UserCheck, UserMinus, Briefcase, ChevronRight } from 'lucide-react'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  on_leave: 'bg-amber-100 text-amber-700',
  suspended: 'bg-orange-100 text-orange-700',
  resigned: 'bg-gray-100 text-gray-600',
  terminated: 'bg-red-100 text-red-700',
}

const ROLE_LABELS: Record<string, string> = {
  school_admin: 'School Admin',
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  counselor: 'Counselor',
}

export default function StaffDirectoryPage() {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const { data: stats } = useQuery({
    queryKey: ['hr-staff-stats'],
    queryFn: () => hrmsApi.staff.stats().then(r => r.data),
  })

  const { data: staffData, isLoading } = useQuery({
    queryKey: ['hr-staff', search, roleFilter],
    queryFn: () => hrmsApi.staff.list({ search: search || undefined, role: roleFilter || undefined, limit: 100 }).then(r => r),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Directory</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage staff profiles, leave, payroll and recruitment</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/hr/attendance"
            className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Attendance
          </Link>
          <Link href="/hr/leave"
            className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Leave
          </Link>
          <Link href="/hr/payroll"
            className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Payroll
          </Link>
          <Link href="/hr/reports"
            className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Reports
          </Link>
          <Link href="/hr/permissions"
            className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Permissions
          </Link>
          <Link href="/hr/recruitment"
            className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
            <Briefcase className="w-4 h-4" /> Recruitment
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Staff',     value: stats?.total_staff ?? 0,            icon: Users,     color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Active',          value: stats?.active_staff ?? 0,           icon: UserCheck, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'On Leave',        value: stats?.on_leave ?? 0,               icon: UserMinus, color: 'text-amber-600 bg-amber-50' },
          { label: 'Pending Leaves',  value: stats?.pending_leave_requests ?? 0, icon: UserMinus, color: 'text-purple-600 bg-purple-50' },
          { label: 'Open Positions',  value: stats?.open_positions ?? 0,         icon: Briefcase, color: 'text-blue-600 bg-blue-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', s.color)}>
              <s.icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search staff by name..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Department breakdown */}
      {stats?.by_department && stats.by_department.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.by_department.map((d: any) => (
            <span key={d.department} className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600">
              {d.department}: <span className="font-bold text-gray-900">{d.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Staff table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (staffData?.data ?? []).length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
            <p className="font-medium">No staff found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Designation</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Department</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Employee ID</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(staffData?.data ?? []).map((s: any) => (
                  <tr key={s.id} onClick={() => window.location.href = `/hr/staff/${s.id}`}
                    className="hover:bg-gray-50/80 transition-colors group cursor-pointer">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-gray-900">{s.full_name}</p>
                      <p className="text-xs text-gray-400">{s.email}</p>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">{ROLE_LABELS[s.role] ?? s.role}</td>
                    <td className="px-5 py-3.5 text-gray-600 hidden md:table-cell">{s.staff_profile?.designation ?? '—'}</td>
                    <td className="px-5 py-3.5 text-gray-600 hidden md:table-cell">{s.staff_profile?.department ?? '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500 font-mono text-xs hidden lg:table-cell">{s.staff_profile?.employee_id ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize whitespace-nowrap',
                        STATUS_COLORS[s.staff_profile?.employment_status ?? 'active'])}>
                        {(s.staff_profile?.employment_status ?? 'active').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link href={`/hr/staff/${s.id}`}
                        className="flex items-center gap-1 text-xs text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-700 whitespace-nowrap">
                        View <ChevronRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}