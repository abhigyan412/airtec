'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Search, Users, UserCheck, UserPlus, Briefcase, ChevronRight, ShieldAlert, FileWarning } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  on_leave: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  suspended: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  resigned: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  terminated: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
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

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['hr-staff-stats'],
    queryFn: () => hrmsApi.staff.stats().then(r => r.data),
  })

  const { data: staffData, isLoading } = useQuery({
    queryKey: ['hr-staff', search, roleFilter],
    queryFn: () => hrmsApi.staff.list({ search: search || undefined, role: roleFilter || undefined, limit: 100 }).then(r => r),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Directory"
        description="Manage staff profiles, leave, payroll and recruitment"
        icon={Users}
        actions={<HrQuickNav current="staff" />}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)
        ) : (
          <>
            <StatCard label="Total Staff"    value={stats?.total_staff ?? 0}            icon={Users}     accent="primary" />
            <StatCard label="Active"         value={stats?.active_staff ?? 0}           icon={UserCheck} accent="success" />
            <StatCard label="Open Positions" value={stats?.open_positions ?? 0}         icon={Briefcase} accent="info" />
            <StatCard label="Probation Ending Soon" value={stats?.probation_ending_soon ?? 0} icon={ShieldAlert} accent="warning" />
            <StatCard label="Documents Expiring" value={stats?.documents_expiring_soon ?? 0} icon={FileWarning} accent="warning" />
          </>
        )}
      </div>

      {/* Filters */}
      <Card className="flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="text" placeholder="Search staff by name..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" />
        </div>
        <Select value={roleFilter || 'all'} onValueChange={v => setRoleFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-auto min-w-[160px]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {/* Department breakdown */}
      {stats?.by_department && stats.by_department.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.by_department.map((d: any) => (
            <span key={d.department} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {d.department}: <span className="font-bold text-foreground">{d.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Staff table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (staffData?.data ?? []).length === 0 ? (
          search || roleFilter ? (
            <EmptyState
              icon={Search}
              title="No staff match these filters"
              description="Try a different name, or switch the role filter back to All Roles."
              action={
                <Button variant="outline" onClick={() => { setSearch(''); setRoleFilter('') }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="Staff appear here once they've been invited and have accepted their account."
              action={
                <Button asChild>
                  <Link href="/settings/team"><UserPlus className="h-4 w-4" /> Invite a team member</Link>
                </Button>
              }
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Designation</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden lg:table-cell">Employee ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staffData?.data ?? []).map((s: any) => (
                <TableRow key={s.id} onClick={() => window.location.href = `/hr/staff/${s.id}`} className="group">
                  <TableCell>
                    <div className="max-w-[9rem] sm:max-w-none">
                      <p className="truncate font-semibold text-foreground">{s.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{ROLE_LABELS[s.role] ?? s.role}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{s.staff_profile?.designation ?? '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{s.staff_profile?.department ?? '—'}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{s.staff_profile?.employee_id ?? '—'}</TableCell>
                  <TableCell>
                    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize',
                      STATUS_COLORS[s.staff_profile?.employment_status ?? 'active'])}>
                      {(s.staff_profile?.employment_status ?? 'active').replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/hr/staff/${s.id}`}
                      className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary opacity-0 transition-opacity hover:text-primary/80 group-hover:opacity-100">
                      View <ChevronRight className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
