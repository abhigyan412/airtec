import { supabase } from '../../shared/db/client'

// ═══════════════════════════════════════════════════════════════
// Default RBAC role → permission_code mapping.
//
// This is the same set of roles/permissions that was manually seeded
// for the first school (via the rbac-phase1 SQL scripts). New schools
// never got these tables populated, which left every non-null-gated
// nav item invisible for them (Sidebar.tsx / usePermissions.ts fall
// back to "no permission" when a user has zero user_roles rows).
// seedDefaultRoles() reproduces that seed for any school.
// ═══════════════════════════════════════════════════════════════

const CORE = [
  'student.view', 'student.create', 'student.edit', 'student.delete',
  'student.promote', 'student.transfer', 'student.bulk_upload', 'student.generate_id',
  'admission.view', 'admission.create', 'admission.edit', 'admission.delete',
  'admission.follow_up', 'admission.approve',
  'fee.view', 'fee.collect', 'fee.discount', 'fee.refund', 'fee.export', 'fee.structure_manage',
  'exam.view', 'exam.create', 'exam.publish', 'exam.schedule', 'exam.marks_entry',
  'exam.result_publish', 'exam.freeze',
  'attendance.view', 'attendance.mark', 'attendance.edit',
  'complaint.view', 'complaint.create', 'complaint.resolve', 'complaint.assign',
  'certificate.view', 'certificate.generate', 'certificate.verify',
  'tc.generate', 'tc.revoke',
  'timetable.view', 'timetable.manage',
  'resource.view', 'resource.upload', 'resource.delete',
  'staff.view', 'staff.edit', 'staff.attendance_mark', 'staff.leave_approve',
  'staff.payroll_manage', 'staff.recruitment_manage',
]

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  'School Admin': [...CORE, 'role.manage', 'role.assign', 'team.view', 'team.invite', 'team.deactivate', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  'Principal': [...CORE, 'role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  'Vice Principal': CORE.filter(c => c !== 'staff.payroll_manage').concat(['role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage']),
  'Teacher': ['student.view', 'exam.view', 'exam.marks_entry', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete'],
  'Class Teacher': ['student.view', 'student.edit', 'exam.view', 'exam.marks_entry', 'exam.result_publish', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'complaint.resolve', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete'],
  'Accountant': ['student.view', 'fee.view', 'fee.collect', 'fee.discount', 'fee.export', 'fee.structure_manage', 'staff.view', 'staff.payroll_manage'],
  'Counselor': ['student.view', 'admission.view', 'admission.create', 'admission.edit', 'admission.follow_up', 'complaint.view', 'complaint.create'],
  'HR': ['staff.view', 'staff.edit', 'staff.attendance_mark', 'staff.leave_approve', 'staff.payroll_manage', 'staff.recruitment_manage', 'team.view', 'team.invite'],
  'Receptionist': ['student.view', 'admission.view', 'admission.create', 'admission.follow_up', 'complaint.view', 'complaint.create'],
  'Librarian': ['student.view', 'resource.view', 'resource.upload', 'resource.delete'],
  'Exam Controller': ['student.view', 'exam.view', 'exam.create', 'exam.publish', 'exam.schedule', 'exam.marks_entry', 'exam.result_publish', 'exam.freeze', 'certificate.view', 'certificate.generate', 'tc.generate'],
  'Parent': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view'],
  'Student': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view'],
  'Transport Manager': ['student.view'],
  'Hostel Warden': ['student.view'],
  'Coordinator': ['student.view'],
}

// Maps the legacy `users.role` text value to the RBAC role name it
// should be auto-assigned in `user_roles` on creation.
export const LEGACY_ROLE_TO_RBAC_ROLE: Record<string, string> = {
  super_admin: 'School Admin',
  school_admin: 'School Admin',
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  counselor: 'Counselor',
  parent: 'Parent',
  student: 'Student',
}

/**
 * Creates the default set of RBAC roles + role_permissions_v2 mappings
 * for a school that doesn't have any yet. Idempotent per role name
 * (skips roles that already exist for the school).
 *
 * Returns a name -> role_id map for the roles now present.
 */
export async function seedDefaultRoles(schoolId: string): Promise<Record<string, string>> {
  const { data: existingRoles } = await supabase
    .from('roles')
    .select('id, name')
    .eq('school_id', schoolId)

  const roleIdByName: Record<string, string> = {}
  for (const r of existingRoles ?? []) roleIdByName[r.name] = r.id

  const missing = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter(name => !roleIdByName[name])
  if (missing.length > 0) {
    const { data: inserted, error } = await supabase
      .from('roles')
      .insert(missing.map(name => ({ school_id: schoolId, name, is_system_role: true })))
      .select('id, name')

    if (error) throw new Error(`Failed to seed default roles: ${error.message}`)
    for (const r of inserted ?? []) roleIdByName[r.name] = r.id
  }

  const { data: perms, error: permErr } = await supabase
    .from('permissions')
    .select('id, permission_code')
  if (permErr) throw new Error(`Failed to load permission registry: ${permErr.message}`)

  const permIdByCode = new Map((perms ?? []).map((p: any) => [p.permission_code, p.id]))

  // Only insert mappings for roles that were just created (avoid clobbering
  // any manually-edited permissions on pre-existing roles).
  const rows: { role_id: string; permission_id: string }[] = []
  for (const name of missing) {
    const roleId = roleIdByName[name]
    for (const code of DEFAULT_ROLE_PERMISSIONS[name] ?? []) {
      const permId = permIdByCode.get(code)
      if (permId) rows.push({ role_id: roleId, permission_id: permId })
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('role_permissions_v2').insert(rows)
    if (insErr) throw new Error(`Failed to seed role_permissions_v2: ${insErr.message}`)
  }

  return roleIdByName
}

/**
 * Assigns a user to the RBAC role matching their legacy `users.role`
 * value, creating default roles for the school first if needed.
 * No-ops if the user already has that role assigned.
 */
export async function assignDefaultUserRole(userId: string, schoolId: string, legacyRole: string): Promise<void> {
  const rbacRoleName = LEGACY_ROLE_TO_RBAC_ROLE[legacyRole]
  if (!rbacRoleName) return

  const roleIdByName = await seedDefaultRoles(schoolId)
  const roleId = roleIdByName[rbacRoleName]
  if (!roleId) return

  const { data: existing } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role_id', roleId)
    .maybeSingle()

  if (existing) return

  const { error } = await supabase.from('user_roles').insert({
    user_id: userId,
    role_id: roleId,
    school_id: schoolId,
  })
  if (error) throw new Error(`Failed to assign user role: ${error.message}`)
}

/**
 * Switches a user's primary RBAC role assignment when their legacy
 * `users.role` value changes — removes the old primary role's
 * user_roles row (if any) and assigns the new one. Leaves any extra
 * (non-primary) roles the user was manually granted untouched.
 */
export async function setPrimaryUserRole(userId: string, schoolId: string, newLegacyRole: string, oldLegacyRole?: string): Promise<void> {
  const roleIdByName = await seedDefaultRoles(schoolId)

  if (oldLegacyRole && oldLegacyRole !== newLegacyRole) {
    const oldRoleName = LEGACY_ROLE_TO_RBAC_ROLE[oldLegacyRole]
    const oldRoleId = oldRoleName ? roleIdByName[oldRoleName] : undefined
    if (oldRoleId) {
      await supabase.from('user_roles').delete().eq('user_id', userId).eq('role_id', oldRoleId).eq('school_id', schoolId)
    }
  }

  await assignDefaultUserRole(userId, schoolId, newLegacyRole)
}
