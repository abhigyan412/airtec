'use client'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { hrmsApi, notificationsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Search, Users, UserCheck, UserPlus, Briefcase, ChevronRight, ShieldAlert, FileWarning, UserX, X } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { StaffAvatar } from '@/components/hr/StaffAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  absconded: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
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
  const [showExpiringDocs, setShowExpiringDocs] = useState(false)

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['hr-staff-stats'],
    queryFn: () => hrmsApi.staff.stats().then(r => r.data),
  })

  const { data: staffData, isLoading } = useQuery({
    queryKey: ['hr-staff', search, roleFilter],
    queryFn: () => hrmsApi.staff.list({ search: search || undefined, role: roleFilter || undefined, limit: 100 }).then(r => r),
  })

  // Absconded sweep review cards — the sweep's own notification, read
  // back here so "notify HR for review" has somewhere to land besides
  // the bell. Each admin sees their own unread copies (recipients are
  // resolved per-user server-side); dismissing marks it read, same as
  // any other notification, rather than a separate dismiss mechanism.
  const qc = useQueryClient()
  const { data: abscondedAlerts } = useQuery({
    queryKey: ['notifications', 'absconded_review_needed'],
    queryFn: () => notificationsApi.list({ type: 'absconded_review_needed', unread_only: true, limit: 20 }).then(r => r.data as any[]),
  })
  const dismissAlertMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'absconded_review_needed'] }),
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
            <StatCard label="Documents Expiring" value={stats?.documents_expiring_soon ?? 0} icon={FileWarning} accent="warning"
              onClick={() => setShowExpiringDocs(true)} hint={(stats?.documents_expiring_soon ?? 0) > 0 ? 'View list →' : undefined} />
          </>
        )}
      </div>

      {/* Absconded review-required cards — surfaced here, not only in
          the notification bell, since this is exactly the page where
          someone would act on it (transition the person's status). */}
      {(abscondedAlerts ?? []).length > 0 && (
        <div className="space-y-2">
          {abscondedAlerts!.map((n: any) => (
            <div key={n.id} className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4">
              <UserX className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
              <div className="flex-1 text-sm text-foreground">
                <p className="font-semibold">{n.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.message}</p>
              </div>
              {n.related_entity_id && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/hr/staff/${n.related_entity_id}`}>Review</Link>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => dismissAlertMutation.mutate(n.id)} disabled={dismissAlertMutation.isPending}
                className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

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
                    <div className="flex items-center gap-3">
                      <StaffAvatar photoUrl={s.staff_profile?.photo_url} fullName={s.full_name} />
                      <div className="max-w-[9rem] sm:max-w-none">
                        <p className="truncate font-semibold text-foreground">{s.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                      </div>
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

      {showExpiringDocs && <ExpiringDocumentsModal onClose={() => setShowExpiringDocs(false)} />}
    </div>
  )
}

// ── Drill-through for the "Documents Expiring" tile — the count alone
// was a dead end; this is the actual list it's counting, each row
// linked to the staff member's own profile to act on it.
function ExpiringDocumentsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['documents-expiring'],
    queryFn: () => hrmsApi.documentsExpiring().then(r => r.data as any[]),
  })
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileWarning className="h-4 w-4 text-warning" /> Documents Expiring Within 30 Days</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon={FileWarning} title="Nothing expiring soon" description="No staff documents are due to expire in the next 30 days." />
        ) : (
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {(data ?? []).map((d: any) => (
              <Link key={d.id} href={`/hr/staff/${d.user_id}`}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/40">
                <div>
                  <p className="font-medium text-foreground">{d.users?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{d.document_name}</p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                  d.expiry_date < today ? 'bg-destructive/10 text-destructive ring-destructive/20' : 'bg-warning/10 text-warning ring-warning/20')}>
                  {d.expiry_date < today ? 'Expired' : 'Expires'} {d.expiry_date}
                </span>
              </Link>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
