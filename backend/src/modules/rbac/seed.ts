import { supabase } from '../../shared/db/client'
import { invalidatePermissionsForUser } from '../../shared/middleware/permissions-v2'

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
  'homework.view', 'homework.create', 'homework.delete',
  'syllabus.view', 'syllabus.plan', 'syllabus.log_progress',
]

// Phase 2 additions: codes with no clean home in the original CORE set,
// added when the backend modules that gated on hardcoded requireRole()
// checks were converted to actually read role_permissions_v2. See
// supabase/migrations/20260808000000_rbac_phase2_permissions.sql for the
// matching live-data backfill this list alone does not cover.
const PHASE2_MANAGEMENT = [
  'settings.manage', 'fee.invoice_generate', 'fee.adhoc_manage', 'fee.arrear_manage',
  'exam.result_generate', 'staff.payroll_view', 'certificate.template_manage',
  'exam.admit_card_generate', 'tc.view', 'team.credentials_manage', 'team.edit',
  'role.view', 'staff.homeroom_manage', 'staff.promote', 'staff.exit_manage',
]

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  'School Admin': [...CORE, ...PHASE2_MANAGEMENT, 'role.manage', 'role.assign', 'team.view', 'team.invite', 'team.deactivate', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  // role.manage: Principal could already edit role_permissions_v2 (i.e.
  // use the Permissions page itself) under the old requireRole(
  // 'school_admin','principal') gate on PUT /rbac/roles/:id/permissions
  // — kept so converting that route doesn't lock Principal out of the
  // very page that grants permissions.
  'Principal': [...CORE, ...PHASE2_MANAGEMENT, 'role.manage', 'role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  'Vice Principal': CORE.filter(c => c !== 'staff.payroll_manage').concat(PHASE2_MANAGEMENT.filter(c => c !== 'staff.payroll_view')).concat(['role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage']),
  // Two different jobs that both live under "Homework": day-to-day
  // homework/classwork is a teacher's direct communication to their own
  // students/parents ("tonight's assignment is..."), so Teacher/Class
  // Teacher get full control there — restricted client-side to only the
  // class/section/subject combos on their own timetable. Syllabus due
  // dates (the term-level pacing target) stay a senior-management-only
  // responsibility (syllabus.plan) — teachers only log actual coverage
  // against it (syllabus.log_progress).
  'Teacher': ['student.view', 'exam.view', 'exam.marks_entry', 'exam.admit_card_generate', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete', 'homework.view', 'homework.create', 'homework.delete', 'syllabus.view', 'syllabus.log_progress'],
  'Class Teacher': ['student.view', 'student.edit', 'exam.view', 'exam.marks_entry', 'exam.result_publish', 'exam.admit_card_generate', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'complaint.resolve', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete', 'homework.view', 'homework.create', 'homework.delete', 'syllabus.view', 'syllabus.log_progress'],
  // tc.generate: Accountant could already initiate TC requests under
  // the old requireRole('school_admin','principal','accountant') gate
  // on POST /sis/:id/tc — kept so converting that route doesn't
  // silently take it away, even though their real workload on a TC
  // (dues-clearance) happens via the workflow-action endpoint instead.
  'Accountant': ['student.view', 'fee.view', 'fee.collect', 'fee.discount', 'fee.export', 'fee.structure_manage', 'fee.invoice_generate', 'fee.adhoc_manage', 'fee.arrear_manage', 'staff.view', 'staff.payroll_manage', 'staff.payroll_view', 'tc.view', 'tc.generate'],
  // fee.discount, student.create, staff.recruitment_manage: Counselor
  // already had all three under old hardcoded requireRole(...) gates
  // (POST /fees/discounts, POST /sis, PATCH /hrms/applications/:id
  // respectively) — kept here so converting those routes to
  // requirePermissionV2 doesn't silently take any away. (Some schools
  // apparently have their Counselor double as recruitment coordinator.)
  'Counselor': ['student.view', 'student.create', 'admission.view', 'admission.create', 'admission.edit', 'admission.follow_up', 'complaint.view', 'complaint.create', 'fee.discount', 'staff.recruitment_manage'],
  'HR': ['staff.view', 'staff.edit', 'staff.attendance_mark', 'staff.leave_approve', 'staff.payroll_manage', 'staff.recruitment_manage', 'staff.promote', 'staff.exit_manage', 'team.view', 'team.invite'],
  'Receptionist': ['student.view', 'admission.view', 'admission.create', 'admission.follow_up', 'complaint.view', 'complaint.create'],
  'Librarian': ['student.view', 'resource.view', 'resource.upload', 'resource.delete'],
  'Exam Controller': ['student.view', 'exam.view', 'exam.create', 'exam.publish', 'exam.schedule', 'exam.marks_entry', 'exam.result_publish', 'exam.freeze', 'exam.admit_card_generate', 'certificate.view', 'certificate.generate', 'tc.generate', 'syllabus.view'],
  'Parent': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view', 'homework.view'],
  'Student': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view', 'homework.view'],
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
  invalidatePermissionsForUser(userId, schoolId)
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
  invalidatePermissionsForUser(userId, schoolId)
}

/**
 * Ensures a school has a given single-step workflow definition before
 * some route calls startWorkflow() against it by name. No migration/
 * seed anywhere in this codebase creates workflow_definitions rows for
 * a school automatically (confirmed: even 'Leave Approval Workflow',
 * referenced by name in hrms/routes.ts, has no seed — it silently
 * fails on any school where nobody manually inserted one). This
 * mirrors seedDefaultRoles()'s idiom instead: check by (school_id,
 * name), insert if missing, safe to call every time.
 *
 * The single approval step targets the school's HR role if it exists,
 * falling back to Principal — both hold staff.exit_manage and
 * staff.attendance_mark by default, the two permissions this is used
 * for so far.
 */
async function ensureSingleStepWorkflow(schoolId: string, opts: { name: string; module: string; entityType: string; actionName: string }): Promise<void> {
  const { data: existing } = await supabase
    .from('workflow_definitions')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', opts.name)
    .maybeSingle()

  if (existing) return

  const { data: roles } = await supabase
    .from('roles')
    .select('id, name')
    .eq('school_id', schoolId)
    .in('name', ['HR', 'Principal'])

  const approverRoleId = (roles ?? []).find(r => r.name === 'HR')?.id
    ?? (roles ?? []).find(r => r.name === 'Principal')?.id

  if (!approverRoleId) return // roles not seeded yet — nothing to point the step at

  const { data: definition, error: defErr } = await supabase
    .from('workflow_definitions')
    .insert({ school_id: schoolId, name: opts.name, module: opts.module, entity_type: opts.entityType })
    .select('id')
    .single()

  if (defErr || !definition) {
    console.error(`Failed to create ${opts.name} definition:`, defErr?.message)
    return
  }

  const { error: stepErr } = await supabase.from('workflow_steps').insert({
    workflow_id: definition.id,
    step_order: 1,
    role_id: approverRoleId,
    action_name: opts.actionName,
    is_required: true,
  })

  if (stepErr) console.error(`Failed to create ${opts.name} step:`, stepErr.message)
}

export async function ensureExitWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureSingleStepWorkflow(schoolId, {
    name: 'Staff Exit Settlement Workflow', module: 'hrms', entityType: 'staff_exit', actionName: 'settlement_approval',
  })
}

export async function ensureRegularizationWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureSingleStepWorkflow(schoolId, {
    name: 'Attendance Regularization Workflow', module: 'hrms', entityType: 'staff_attendance_regularization', actionName: 'regularization_approval',
  })
}

// The original gap this helper was built to close (see the doc comment
// above) — 'Leave Approval Workflow' is referenced by name in
// POST /hrms/leave-requests but was never actually wired to call this
// before startWorkflow(), so every leave request created before this
// fix has no workflow_instances row at all, surfacing as "No workflow
// found for this leave request" the moment anyone tries to approve it.
export async function ensureLeaveApprovalWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureSingleStepWorkflow(schoolId, {
    name: 'Leave Approval Workflow', module: 'hrms', entityType: 'leave_request', actionName: 'leave_approval',
  })
}

export async function ensureCompOffWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureSingleStepWorkflow(schoolId, {
    name: 'Comp-Off Approval Workflow', module: 'hrms', entityType: 'staff_comp_off_request', actionName: 'comp_off_approval',
  })
}

/**
 * Same idiom as ensureSingleStepWorkflow above, generalized to N steps —
 * 'Admission Approval Workflow' needs three (Counselor -> Principal ->
 * School Admin), not one. Found via a live "not found or inactive for
 * this school" error: the definition existed for this school but had
 * been hand-created as "Admission Approval" (no migration/seed ever
 * created it — same gap the doc comment above already describes), one
 * word short of the name every startWorkflow() call site actually
 * looks up. Renaming that row fixed this school; this closes the gap
 * for every other one.
 */
async function ensureMultiStepWorkflow(schoolId: string, opts: { name: string; module: string; entityType: string; steps: { roleName: string; actionName: string }[] }): Promise<void> {
  const { data: existing } = await supabase
    .from('workflow_definitions')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', opts.name)
    .maybeSingle()

  if (existing) return

  const { data: roles } = await supabase
    .from('roles')
    .select('id, name')
    .eq('school_id', schoolId)
    .in('name', opts.steps.map(s => s.roleName))

  const roleIdByName = new Map((roles ?? []).map(r => [r.name, r.id]))
  if (opts.steps.some(s => !roleIdByName.has(s.roleName))) return // roles not seeded yet — nothing to point every step at

  const { data: definition, error: defErr } = await supabase
    .from('workflow_definitions')
    .insert({ school_id: schoolId, name: opts.name, module: opts.module, entity_type: opts.entityType })
    .select('id')
    .single()

  if (defErr || !definition) {
    console.error(`Failed to create ${opts.name} definition:`, defErr?.message)
    return
  }

  const stepRows = opts.steps.map((s, i) => ({
    workflow_id: definition.id,
    step_order: i + 1,
    role_id: roleIdByName.get(s.roleName)!,
    action_name: s.actionName,
    is_required: true,
  }))
  const { error: stepErr } = await supabase.from('workflow_steps').insert(stepRows)
  if (stepErr) console.error(`Failed to create ${opts.name} steps:`, stepErr.message)
}

export async function ensureAdmissionApprovalWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureMultiStepWorkflow(schoolId, {
    name: 'Admission Approval Workflow', module: 'admission', entityType: 'admission_application',
    steps: [
      { roleName: 'Counselor', actionName: 'Counselor Review' },
      { roleName: 'Principal', actionName: 'Principal Approval' },
      { roleName: 'School Admin', actionName: 'Admission Confirmation' },
    ],
  })
}
