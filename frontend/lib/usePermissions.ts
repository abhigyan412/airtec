'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'

/**
 * ═══════════════════════════════════════════════════════════════
 * UNIFIED PERMISSIONS HOOK (v2)
 * ═══════════════════════════════════════════════════════════════
 *
 * Backed by /api/rbac/permissions/me, which aggregates permission
 * codes across ALL of a user's roles via:
 *   user_roles -> roles -> role_permissions_v2 -> permissions
 *
 * Replaces the old usePermissions() that called
 * /api/hrms/permissions/me (module/action based on the legacy
 * role_permissions table). That endpoint and table are no longer
 * used by the frontend after this change.
 *
 * `can(permissionCode)` — exact-match check against the new
 * `module.action` permission codes (e.g. 'student.view', 'fee.collect').
 * School Admin (is_super_role) always returns true.
 *
 * Sidebar / page guards should be updated to use these new codes.
 * See PERMISSION_CODE_REFERENCE at the bottom of this file for the
 * full list of 59 codes seeded in Phase 1.
 */

export type RbacPermissionsResponse = {
  roles: string[]
  role_ids: string[]
  is_super_role: boolean
  permissions: string[] // flat array of permission_codes, e.g. ['student.view', 'fee.collect', ...]
}

export function usePermissions() {
  const { user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['rbac-permissions-me'],
    queryFn: () => api.get('/rbac/permissions/me').then(r => r.data.data as RbacPermissionsResponse),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  const permissionSet = new Set(data?.permissions ?? [])
  const isSuperRole = data?.is_super_role ?? false

  /**
   * can(permissionCode) — primary usage, exact code match.
   *   can('fee.collect')
   *
   * While loading, defaults to true to avoid hiding UI before the
   * first response arrives (prevents flicker on page load).
   */
  function can(permissionCode: string): boolean {
    if (isLoading || !data) return true
    if (isSuperRole) return true
    return permissionSet.has(permissionCode)
  }

  /**
   * canAny(...codes) — true if the user has ANY of the given codes.
   * Useful when multiple permission codes could grant access to the
   * same nav item/page (e.g. either 'fee.view' or 'fee.collect').
   */
  function canAny(...codes: string[]): boolean {
    if (isLoading || !data) return true
    if (isSuperRole) return true
    return codes.some(c => permissionSet.has(c))
  }

  return {
    roles: data?.roles ?? [],
    permissions: data?.permissions ?? [],
    isSuperRole,
    isLoading,
    can,
    canAny,
  }
}

/**
 * ═══════════════════════════════════════════════════════════════
 * PERMISSION_CODE_REFERENCE
 * ═══════════════════════════════════════════════════════════════
 * Full list of 59 permission_codes seeded in
 * rbac-phase1/02-permission-registry-seed.sql, grouped by module.
 * Use these exact strings with can()/canAny().
 *
 * student:   student.view, student.create, student.edit, student.delete,
 *            student.promote, student.transfer, student.bulk_upload,
 *            student.generate_id
 *
 * admission: admission.view, admission.create, admission.edit,
 *            admission.delete, admission.follow_up, admission.approve
 *
 * fee:       fee.view, fee.collect, fee.discount, fee.refund,
 *            fee.export, fee.structure_manage
 *
 * exam:      exam.view, exam.create, exam.publish, exam.schedule,
 *            exam.marks_entry, exam.result_publish, exam.freeze
 *
 * attendance: attendance.view, attendance.mark, attendance.edit
 *
 * complaint: complaint.view, complaint.create, complaint.resolve,
 *            complaint.assign
 *
 * certificate: certificate.view, certificate.generate, certificate.verify
 * tc:          tc.generate, tc.revoke
 *
 * timetable: timetable.view, timetable.manage
 *
 * resource:  resource.view, resource.upload, resource.delete
 *
 * staff:     staff.view, staff.edit, staff.attendance_mark,
 *            staff.leave_approve, staff.payroll_manage,
 *            staff.recruitment_manage
 *
 * role:      role.manage, role.assign
 * team:      team.view, team.invite, team.deactivate
 *
 * website:   website.edit, website.publish
 * gallery:   gallery.manage
 * popup:     popup.manage
 * ═══════════════════════════════════════════════════════════════
 */