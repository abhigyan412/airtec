'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rbacApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, Save, Check, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

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
  role: 'Roles & Permissions',
  team: 'Team Management',
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
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Role Permissions</h1>
            <p className="text-gray-500 text-sm mt-0.5">Control what each role can do, by fine-grained permission</p>
          </div>
        </div>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !activeRoleId}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 shadow-sm shadow-indigo-200">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Permissions
        </button>
      </div>

      {/* Role tabs */}
      {rolesLoading ? (
        <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-64" />
      ) : (
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit overflow-x-auto max-w-full">
          {editableRoles.map((r: any) => (
            <button key={r.id} onClick={() => setActiveRoleId(r.id)}
              className={cn('px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                activeRoleId === r.id ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700')}>
              {r.name}
            </button>
          ))}
        </div>
      )}

      {/* Permission grid, grouped by module */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {rolePermsLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (
          <div className="divide-y divide-gray-100">
            {moduleOrder.filter(m => groupedPermissions[m]?.length).map(module => {
              const perms = groupedPermissions[module]
              const allOn = perms.every(p => selectedCodes.has(p.permission_code))
              const someOn = perms.some(p => selectedCodes.has(p.permission_code))

              return (
                <div key={module} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">{MODULE_LABELS[module] ?? module}</h3>
                    <button onClick={() => toggleModule(perms.map(p => p.permission_code), allOn)}
                      className="text-xs text-indigo-600 font-medium hover:underline">
                      {allOn ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {perms.map((p: any) => {
                      const checked = selectedCodes.has(p.permission_code)
                      const actionLabel = ACTION_LABELS[p.action] ?? p.action
                      return (
                        <button key={p.permission_code} onClick={() => toggle(p.permission_code)}
                          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                            checked ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300')}>
                          <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                            checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300')}>
                            {checked && <Check className="w-2.5 h-2.5 text-white" />}
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
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-400">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          School Admin always has full access to every module and isn't shown here.
          Changes take effect immediately for all users with this role — they may need to refresh their page to see updated menus.
        </p>
      </div>
    </div>
  )
}
