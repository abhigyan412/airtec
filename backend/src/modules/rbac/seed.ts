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
  'homework.view', 'homework.create', 'homework.delete', 'homework.edit',
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
  // Result Settings — configuring per-class/exam-type pass criteria, grading
  // mode and grade scales. Same tier as exam.result_generate: senior
  // management, not day-to-day marks entry.
  'exam.result_settings_manage',
]

// Timetable module (20260829010000). Deliberately fine-grained: a school
// rolling out ONLY the timetable feature needs "runs the daily arrangement
// queue" to be a different grant from "republishes the master timetable",
// because they are usually different people. Two codes are held back from
// the Timetable Manager on purpose — timetable.publish and
// arrangement.override_booking — so that replacing the school's week, or
// taking a teacher's protected free period, needs a second person.
const TIMETABLE_SENIOR = [
  'timetable.setup_manage', 'timetable.generate', 'timetable.publish',
  'timetable.import', 'timetable.export', 'timetable.workload_view',
  'arrangement.view', 'arrangement.manage', 'arrangement.override_booking',
]

// Own-record capabilities. The handlers resolve the actor from the JWT and
// ignore any teacher id in the request, so granting these broadly widens
// nothing — a teacher can only ever acknowledge their own cover and book
// their own free periods.
// Deliberately does NOT repeat arrangement.view: the senior set already
// grants it, and seedDefaultRoles dedupes, but keeping the two lists
// disjoint makes it obvious which grant a role gets it from.
// What a member of staff needs for their OWN timetable: accept the cover
// they are given, reserve their own free periods. Nothing about anybody
// else.
//
// arrangement.view used to be in here, on the reasoning that the day's
// cover sheet is pinned up in every staffroom. That was true of a paper
// sheet listing who is covering what. It is not true of this page, which
// now says WHY each teacher is not in — "is suspended", "has been
// terminated" — so every teacher in the school could read a colleague's
// disciplinary and employment history from the timetable app.
//
// And they never needed it: My Week already gives a teacher the cover
// they must take, naming who they are covering for, and shows a
// substitute against their own periods when they are the one away.
// Verified both, as the two people involved. The senior roles below take
// arrangement.view from TIMETABLE_SENIOR, which is where seeing the
// whole queue belongs.
const TIMETABLE_TEACHER = ['arrangement.acknowledge', 'booking.manage_own']

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  'School Admin': [...CORE, ...PHASE2_MANAGEMENT, ...TIMETABLE_SENIOR, ...TIMETABLE_TEACHER, 'role.manage', 'role.assign', 'team.view', 'team.invite', 'team.deactivate', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  // role.manage: Principal could already edit role_permissions_v2 (i.e.
  // use the Permissions page itself) under the old requireRole(
  // 'school_admin','principal') gate on PUT /rbac/roles/:id/permissions
  // — kept so converting that route doesn't lock Principal out of the
  // very page that grants permissions.
  'Principal': [...CORE, ...PHASE2_MANAGEMENT, ...TIMETABLE_SENIOR, ...TIMETABLE_TEACHER, 'role.manage', 'role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],
  'Vice Principal': CORE.filter(c => c !== 'staff.payroll_manage').concat(PHASE2_MANAGEMENT.filter(c => c !== 'staff.payroll_view')).concat(TIMETABLE_SENIOR.filter(c => c !== 'timetable.publish' && c !== 'arrangement.override_booking')).concat(TIMETABLE_TEACHER).concat(['role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage']),
  // Two different jobs that both live under "Homework": day-to-day
  // homework/classwork is a teacher's direct communication to their own
  // students/parents ("tonight's assignment is..."), so Teacher/Class
  // Teacher get full control there — restricted client-side to only the
  // class/section/subject combos on their own timetable. Syllabus due
  // dates (the term-level pacing target) stay a senior-management-only
  // responsibility (syllabus.plan) — teachers only log actual coverage
  // against it (syllabus.log_progress).
  'Teacher': ['student.view', 'exam.view', 'exam.marks_entry', 'exam.admit_card_generate', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete', 'homework.view', 'homework.create', 'homework.delete', 'homework.edit', 'syllabus.view', 'syllabus.log_progress', ...TIMETABLE_TEACHER],
  'Class Teacher': ['student.view', 'student.edit', 'exam.view', 'exam.marks_entry', 'exam.result_publish', 'exam.admit_card_generate', 'attendance.view', 'attendance.mark', 'attendance.edit', 'complaint.view', 'complaint.create', 'complaint.resolve', 'timetable.view', 'resource.view', 'resource.upload', 'resource.delete', 'homework.view', 'homework.create', 'homework.delete', 'homework.edit', 'syllabus.view', 'syllabus.log_progress', ...TIMETABLE_TEACHER],
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
  'Librarian': ['student.view', 'resource.view', 'resource.upload', 'resource.delete', 'timetable.view', ...TIMETABLE_TEACHER],
  'Exam Controller': ['student.view', 'exam.view', 'exam.create', 'exam.publish', 'exam.schedule', 'exam.marks_entry', 'exam.result_publish', 'exam.freeze', 'exam.admit_card_generate', 'exam.result_settings_manage', 'certificate.view', 'certificate.generate', 'tc.generate', 'syllabus.view'],
  'Parent': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view', 'homework.view'],
  'Student': ['student.view', 'exam.view', 'attendance.view', 'timetable.view', 'resource.view', 'homework.view'],
  // The person who actually runs this module day to day. Narrow on
  // purpose: they own the grid and the arrangement queue and nothing else
  // in the ERP, so a school can roll out the timetable feature alone
  // without handing anyone the keys to fees or student records.
  // staff.view/student.view are read-only and load-bearing — you cannot
  // assign cover without being able to see who the staff are.
  'Timetable Manager': [
    'timetable.view', 'timetable.manage', 'timetable.setup_manage',
    'timetable.generate', 'timetable.import', 'timetable.export',
    'timetable.workload_view',
    'arrangement.view', 'arrangement.manage', 'arrangement.acknowledge',
    'booking.manage_own',
    'staff.view', 'student.view',
  ],
  'Transport Manager': ['student.view'],
  'Hostel Warden': ['student.view'],
  'Coordinator': ['student.view', 'timetable.view', ...TIMETABLE_TEACHER],

  // ── remaining-work-plan.md Section A1 (RBAC Finalization) ──────
  // Five titles admission/plan.md and decisions.md assumed throughout
  // (Director, Admission Officer, Exam Coordinator, Examiner, IT Admin)
  // but never actually seeded — decisions.md's adopted resolution was
  // that each maps onto RBAC v2 as an *additional* granted role, while
  // every real person holding one still logs in under one of the 8
  // existing users.role base values (see LEGACY_ROLE_TO_RBAC_ROLE below,
  // unchanged — none of these five get a base-role mapping, they're
  // assigned as a second RBAC role on top of whichever base role the
  // person actually logs in as).

  // Same operational authority as Principal — decisions.md's adopted
  // answer was "map Director onto the closest existing base role
  // (school_admin/principal)", not invent a separate authority tier.
  // Giving it Principal's exact permission set (not a copy that drifts)
  // means a school whose top authority is titled "Director" rather than
  // "Principal" sees the same capabilities under the name they actually
  // use, with zero risk of the two silently diverging over time.
  'Director': [...CORE, ...PHASE2_MANAGEMENT, ...TIMETABLE_SENIOR, ...TIMETABLE_TEACHER, 'role.manage', 'role.assign', 'team.view', 'website.edit', 'website.publish', 'gallery.manage', 'popup.manage'],

  // The formal title for what 'Counselor' already covers on the
  // admissions side — deliberately without Counselor's extra legacy
  // grants (fee.discount, staff.recruitment_manage, complaint.*), which
  // were kept on Counselor only so converting old hardcoded requireRole()
  // gates didn't silently take away access a real Counselor already had.
  // Admission Officer is a clean role with no such history to preserve.
  'Admission Officer': ['student.view', 'student.create', 'admission.view', 'admission.create', 'admission.edit', 'admission.follow_up'],

  // Scoped to the admission module specifically — plan.md's Phase 6c
  // ("Examiner -> Review -> Principal Approval -> Publish") ties this
  // title to admission's entrance-test result-publishing workflow, not
  // the separate main Examinations module (which already has its own
  // 'Exam Controller' role). admission.edit covers entering/reviewing
  // entrance-test marks via PATCH /admission-slot-bookings/:id.
  'Exam Coordinator': ['student.view', 'admission.view', 'admission.edit'],

  // Narrowest of the five: enters marks for the candidates they examined
  // and nothing else — the same admission.edit grant Exam Coordinator
  // has, without admission.create/follow_up, since an Examiner's job is
  // scoring, not running the pipeline.
  'Examiner': ['student.view', 'admission.view', 'admission.edit'],

  // Technical/system administration — team and role management only,
  // deliberately no student/admission/fee/exam data access. Mirrors the
  // narrow-by-design intent already used for Timetable Manager: a school
  // handing someone the "IT Admin" title is usually handing them account
  // and permission administration, not access to academic or financial
  // records.
  'IT Admin': ['team.view', 'team.invite', 'team.deactivate', 'team.credentials_manage', 'team.edit', 'role.view', 'role.manage', 'role.assign', 'settings.manage'],
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

  if (permIdByCode.size === 0) {
    // The registry is populated by migrations, not by this function, so an
    // empty one means the mappings below would all silently resolve to nothing
    // and every role would come out with no permissions at all. Said out loud,
    // because the symptom otherwise appears much later as "nobody can do
    // anything" with no clue pointing back here.
    console.warn(
      '   ⚠️  permissions registry is empty — roles will have no permissions. ' +
      'Re-apply the permission-registry migrations before seeding roles.')
  }

  // Roles that were just created, plus any existing role that has no mappings
  // at all. The second case is repair, not clobbering: the guard here is meant
  // to preserve permissions somebody edited by hand, and a role holding zero
  // permissions is not an edit anyone made on purpose — it is a role that was
  // created while the registry was missing, and it can do nothing until it is
  // filled in.
  //
  // Found 2026-08-25, while adding 5 more default roles: this used to select
  // role_id with NO scope at all — every role_permissions_v2 row in the
  // entire database, across every school. PostgREST caps an unscoped select
  // at its default row limit (1000), so once the table's total row count
  // (all schools combined) crossed that line, this silently came back
  // truncated — a role that genuinely had mappings could be missing from
  // the resulting Set, get incorrectly added to needsMappings below, and
  // then abort the whole seed on the (role_id, permission_id) unique
  // constraint when its rows were inserted a second time. Scoped to just
  // this school's own role ids — correct regardless of how large the table
  // grows globally, not merely a higher limit that pushes the same failure
  // mode further out.
  const { data: mapped } = await supabase.from('role_permissions_v2').select('role_id').in('role_id', Object.values(roleIdByName))
  const hasMappings = new Set((mapped ?? []).map((m: any) => m.role_id))
  const needsMappings = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter(name =>
    missing.includes(name) || (roleIdByName[name] && !hasMappings.has(roleIdByName[name])))

  const rows: { role_id: string; permission_id: string }[] = []
  for (const name of needsMappings) {
    const roleId = roleIdByName[name]
    // Deduped, because the lists above are assembled by spreading several
    // groups together and a code can legitimately appear in two of them —
    // arrangement.view belongs to both the senior set and the own-record
    // teacher set. Two identical rows violate the (role_id, permission_id)
    // unique index and abort the whole seed, which is a silly way to lose
    // a fresh school.
    for (const code of new Set(DEFAULT_ROLE_PERMISSIONS[name] ?? [])) {
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

// Phase 6c of admission/plan.md — entrance-test result publishing.
// remaining-work-plan.md Section A1: Examiner now exists as a real seeded
// RBAC role (see DEFAULT_ROLE_PERMISSIONS above), so step 1 is repointed
// to it — the person actually confirming the marks they entered, matching
// plan.md's original "Examiner -> ... -> Principal Approval -> Publish"
// intent more closely than the Counselor placeholder ever did. Kept to
// the same 2-step shape rather than expanding to the full 4-name chain
// plan.md's settings default described — the shipped workflow has always
// been 2 steps (Confirm Result / Approve & Publish), and turning that into
// a 4-step chain is a real workflow-structure change, not a role
// repoint, so it's left for a deliberate follow-up if actually wanted.
// This only affects NEW schools — ensureMultiStepWorkflow no-ops once a
// school already has a definition by this name, so any school seeded
// before this change keeps its existing Counselor step until repointed
// directly (see the one-off fix applied to the pre-existing local dev
// school's row when this shipped, 2026-08-25).
export async function ensureEntranceResultWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureMultiStepWorkflow(schoolId, {
    name: 'Entrance Result Publishing', module: 'admission', entityType: 'admission_slot_booking',
    steps: [
      { roleName: 'Examiner', actionName: 'Confirm Result' },
      { roleName: 'Principal', actionName: 'Approve & Publish' },
    ],
  })
}

// Same gap as every workflow above — 'Transfer Certificate Workflow' is
// referenced by name in POST /students/:id/tc but was never wired to
// call this before startWorkflow(), so every TC request ever created had
// no workflow_instances row at all: TransferCertificateCard.tsx's
// pipeline reads workflow?.all_steps, which comes back empty, so no
// action buttons ever render for the Accountant or Principal — the
// request just sits at status='pending' forever with no visible way to
// act on it. action_name values are lowercase/snake_case (not human-
// readable, unlike Admission's) because both the frontend
// (STEP_LABELS, the `dues_clearance` button-text branch) and the backend
// (POST /:id/tc/:tcId/workflow-action's dues_cleared write) key off
// these exact strings.
export async function ensureTransferCertificateWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureMultiStepWorkflow(schoolId, {
    name: 'Transfer Certificate Workflow', module: 'sis', entityType: 'transfer_certificate',
    steps: [
      { roleName: 'Accountant', actionName: 'dues_clearance' },
      { roleName: 'Principal', actionName: 'approve' },
    ],
  })
}

// Same gap as every workflow above — 'Result Freeze & Publish Workflow' is
// referenced by name in POST /exams/:id/start-freeze-workflow but had no
// seed anywhere, surfacing live as 'Workflow "Result Freeze & Publish
// Workflow" not found or inactive for this school' the moment an Exam
// Controller tried to start it after generating results. action_name
// values are lowercase (not human-readable) because both the frontend
// (exams/[id]/page.tsx's STEP_ICONS/STEP_LABELS and the
// currentStep.action_name === 'publish' button-text branch) and the
// backend (POST /:id/workflow-action's STEP_STATUS_MAP) key off these
// exact strings.
export async function ensureResultFreezePublishWorkflowDefinition(schoolId: string): Promise<void> {
  return ensureMultiStepWorkflow(schoolId, {
    name: 'Result Freeze & Publish Workflow', module: 'exam', entityType: 'exam',
    steps: [
      { roleName: 'Exam Controller', actionName: 'freeze' },
      { roleName: 'Principal', actionName: 'verify' },
      { roleName: 'Principal', actionName: 'publish' },
    ],
  })
}
