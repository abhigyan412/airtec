'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rbacApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, Save, Check, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { HrQuickNav } from '@/components/hr/HrQuickNav'

// ═══════════════════════════════════════════════════════════════
// UNIFIED ROLE PERMISSIONS PAGE (v2)
// ═══════════════════════════════════════════════════════════════
// Manages role_permissions_v2 via /api/rbac/roles and
// /api/rbac/roles/:id/permissions. Replaces the old page that
// managed the legacy role_permissions table (module + can_view/
// can_create/can_edit/can_delete booleans).
//
// The new system uses fine-grained permission_codes (module.action),
// e.g. 'student.view', 'fee.collect', 'exam.marks_entry' — 59 total,
// seeded in Phase 1.
//
// Editable roles: all NON-system roles, plus a curated subset of
// system roles that schools commonly customize (Teacher, Accountant,
// Counselor, etc). School Admin is excluded — it always has full
// access by design (SUPER_ROLES bypass in permissions-v2.ts).

const EXCLUDED_ROLES = ['School Admin'] // always full access, not editable

// Group permission codes by module for display, with friendly labels
const MODULE_LABELS: Record<string, string> = {
  student: 'Students',
  admission: 'Admissions',
  fee: 'Fee Management',
  exam: 'Examinations',
  attendance: 'Attendance',
  complaint: 'Complaints',
  certificate: 'Certificates',
  tc: 'Transfer Certificates',
  timetable: 'Timetable',
  resource: 'Resource Centre',
  staff: 'Staff & HR',
  homework: 'Homework',
  syllabus: 'Syllabus',
  role: 'Roles & Permissions',
  team: 'Team Management',
  settings: 'School Settings',
  website: 'Website',
  gallery: 'Gallery',
  popup: 'Popups',
}

const ACTION_LABELS: Record<string, string> = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete',
  promote: 'Promote', transfer: 'Transfer', bulk_upload: 'Bulk Upload', generate_id: 'Generate ID',
  follow_up: 'Follow Up', approve: 'Approve',
  collect: 'Collect', discount: 'Discount', refund: 'Refund', export: 'Export', structure_manage: 'Manage Structure',
  publish: 'Publish', schedule: 'Schedule', marks_entry: 'Marks Entry', result_publish: 'Result Publish', freeze: 'Freeze',
  mark: 'Mark', resolve: 'Resolve', assign: 'Assign',
  generate: 'Generate', verify: 'Verify', revoke: 'Revoke', manage: 'Manage',
  attendance_mark: 'Mark Attendance', leave_approve: 'Approve Leave', payroll_manage: 'Manage Payroll', recruitment_manage: 'Manage Recruitment',
  invite: 'Invite', deactivate: 'Deactivate',
  plan: 'Plan Chapters', log_progress: 'Log Progress',
  invoice_generate: 'Generate Invoice', adhoc_manage: 'Manage Ad-hoc Charges', arrear_manage: 'Manage Arrears',
  result_generate: 'Generate Results', payroll_view: 'View Payroll', template_manage: 'Manage Templates',
  admit_card_generate: 'Generate Admit Cards', credentials_manage: 'Reset Login',
  homeroom_manage: 'Manage Homeroom Assignments',
}

export default function RolePermissionsPage() {
  const qc = useQueryClient()
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacApi.roles.list().then(r => r.data),
  })

  const { data: allPermissions } = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: () => rbacApi.permissions.list().then(r => r.data),
  })

  const editableRoles = (roles ?? []).filter((r: any) => !EXCLUDED_ROLES.includes(r.name))

  useEffect(() => {
    if (!activeRoleId && editableRoles.length > 0) {
      setActiveRoleId(editableRoles[0].id)
    }
  }, [editableRoles, activeRoleId])

  const { data: rolePerms, isLoading: rolePermsLoading } = useQuery({
    queryKey: ['rbac-role-permissions', activeRoleId],
    queryFn: () => rbacApi.roles.getPermissions(activeRoleId!).then(r => r.data),
    enabled: !!activeRoleId,
  })

  useEffect(() => {
    if (rolePerms?.permissions) {
      setSelectedCodes(new Set(rolePerms.permissions.map((p: any) => p.permission_code)))
    }
  }, [rolePerms])

  const saveMutation = useMutation({
    mutationFn: () => rbacApi.roles.setPermissions(activeRoleId!, Array.from(selectedCodes)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-role-permissions', activeRoleId] })
      qc.invalidateQueries({ queryKey: ['rbac-permissions-me'] })
      toast.success('Permissions saved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const toggle = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggleModule = (codes: string[], allOn: boolean) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      for (const c of codes) {
        if (allOn) next.delete(c)
        else next.add(c)
      }
      return next
    })
  }

  // Group permissions by module, in a stable order
  const moduleOrder = Object.keys(MODULE_LABELS)
  const groupedPermissions: Record<string, any[]> = {}
  for (const p of allPermissions ?? []) {
    if (!groupedPermissions[p.module]) groupedPermissions[p.module] = []
    groupedPermissions[p.module].push(p)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Role Permissions"
          description="Control what each role can do, by fine-grained permission"
          icon={ShieldCheck}
          actions={
            <>
            <HrQuickNav current="permissions" />
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !activeRoleId}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Permissions
            </Button>
            </>
          }
        />
      </div>

      {/* Role tabs */}
      {rolesLoading ? (
        <Skeleton className="h-10 w-64 rounded-xl" />
      ) : (
        <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {editableRoles.map((r: any) => (
            <button key={r.id} onClick={() => setActiveRoleId(r.id)}
              className={cn('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                activeRoleId === r.id ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {r.name}
            </button>
          ))}
        </div>
      )}

      {/* Permission grid, grouped by module */}
      <Card className="overflow-hidden">
        {rolePermsLoading ? (
          // Mirrors the real grid: a module heading followed by a row of
          // permission chips, repeated for each module block.
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="mb-3 h-5 w-40" />
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <Skeleton key={j} className="h-8 w-24 rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {moduleOrder.filter(m => groupedPermissions[m]?.length).map(module => {
              const perms = groupedPermissions[module]
              const allOn = perms.every(p => selectedCodes.has(p.permission_code))
              const someOn = perms.some(p => selectedCodes.has(p.permission_code))

              return (
                <div key={module} className="px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{MODULE_LABELS[module] ?? module}</h3>
                    <button onClick={() => toggleModule(perms.map(p => p.permission_code), allOn)}
                      className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      {allOn ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {perms.map((p: any) => {
                      const checked = selectedCodes.has(p.permission_code)
                      const actionLabel = ACTION_LABELS[p.action] ?? p.action
                      return (
                        <button key={p.permission_code} onClick={() => toggle(p.permission_code)}
                          aria-pressed={checked}
                          className={cn('flex min-h-[32px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            checked ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-foreground/30')}>
                          <span className={cn('flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border',
                            checked ? 'border-primary bg-primary' : 'border-border')}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          {actionLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          School Admin always has full access to every module and isn't shown here.
          Changes take effect immediately for all users with this role — they may need to refresh their page to see updated menus.
        </p>
      </div>
    </div>
  )
}
