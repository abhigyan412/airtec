import { supabase } from '../../shared/db/client'
import { invalidateAllPermissions } from '../../shared/middleware/permissions-v2'

// ═══════════════════════════════════════════════════════════════
// What each role can do at a school that runs only the timetable.
// ═══════════════════════════════════════════════════════════════
//
// Written out per role rather than derived from a prefix filter. An
// earlier version allowed anything starting with "timetable.",
// "arrangement." or "booking." and pruned the rest, which produced a
// school where nobody could mark a teacher absent and nobody could open
// the staff list — because the timetable module's own inputs live
// outside its namespace:
//
//   * absence auto-detection reads staff_attendance;
//   * the arrangement queue syncs from approved leave_requests;
//   * assigning cover needs the staff list;
//   * a school with no HR module still has to issue its own logins.
//
// A prefix rule cannot express that. A table can, and can be read by
// somebody deciding whether to hand it to a customer.

export const TIMETABLE_SCHOOL_MODULES = ['timetable', 'staff', 'leave', 'settings']

const TIMETABLE_FULL = [
  'timetable.view', 'timetable.manage', 'timetable.setup_manage',
  'timetable.generate', 'timetable.publish', 'timetable.import',
  'timetable.export', 'timetable.workload_view',
]

const ARRANGEMENTS_FULL = [
  'arrangement.view', 'arrangement.manage',
  'arrangement.override_booking', 'arrangement.acknowledge',
]

// Staff records, staff attendance and leave. Not payroll, not
// recruitment — this school bought neither.
const STAFF_MANAGEMENT = [
  'staff.view', 'staff.edit', 'staff.attendance_mark',
  'staff.leave_approve', 'staff.homeroom_manage',
]

const RUN_THE_SCHOOL = [
  'team.view', 'team.invite', 'team.deactivate', 'team.credentials_manage', 'team.edit',
  'role.view', 'role.assign', 'role.manage',
  'settings.manage',
  // Classes and sections are read through the student endpoints; without
  // this the timetable grid cannot list what it is scheduling.
  'student.view',
]

export const TIMETABLE_SCHOOL_ROLES: Record<string, string[]> = {
  'School Admin': [
    ...TIMETABLE_FULL, ...ARRANGEMENTS_FULL, 'booking.manage_own',
    ...STAFF_MANAGEMENT, 'staff.promote', 'staff.exit_manage', ...RUN_THE_SCHOOL,
  ],

  'Principal': [
    ...TIMETABLE_FULL, ...ARRANGEMENTS_FULL, 'booking.manage_own',
    ...STAFF_MANAGEMENT, 'staff.promote', 'staff.exit_manage', ...RUN_THE_SCHOOL,
  ],

  'Vice Principal': [
    // Everything the principal has except the two escalations.
    ...TIMETABLE_FULL.filter(c => c !== 'timetable.publish'),
    ...ARRANGEMENTS_FULL.filter(c => c !== 'arrangement.override_booking'),
    'booking.manage_own', ...STAFF_MANAGEMENT, ...RUN_THE_SCHOOL,
  ],

  // The person who runs this module day to day. They get the full staff
  // picture — they cannot assign cover without knowing who is in today,
  // and at a school with no HR department they are the one issuing
  // teachers their logins.
  //
  // Two things are deliberately withheld. Publishing a new timetable
  // replaces the school's week; overriding a booking takes back time a
  // teacher was promised. Both should need a second person, and that
  // person is the principal.
  'Timetable Manager': [
    ...TIMETABLE_FULL.filter(c => c !== 'timetable.publish'),
    'arrangement.view', 'arrangement.manage', 'arrangement.acknowledge',
    'booking.manage_own',
    ...STAFF_MANAGEMENT,
    'team.view', 'team.credentials_manage', 'role.view', 'settings.manage', 'student.view',
  ],

  // Own-record only. Every handler behind these resolves the actor from
  // the token and ignores any id in the request, so none of them widens
  // to a colleague's data.
  //
  // arrangement.view is included on purpose: the day's cover sheet is
  // pinned up in the staffroom of every school that has ever existed, and
  // a teacher who cannot see it has to ask somebody. The page's manager
  // actions are gated separately on arrangement.manage.
  'Teacher': [
    'timetable.view', 'arrangement.view', 'arrangement.acknowledge', 'booking.manage_own',
  ],

  'Class Teacher': [
    'timetable.view', 'arrangement.view', 'arrangement.acknowledge', 'booking.manage_own',
  ],
}

/** Roles a timetable-only school has no use for. */
const UNUSED_ROLES = [
  'Accountant', 'Counselor', 'HR', 'Receptionist', 'Librarian',
  'Exam Controller', 'Transport Manager', 'Hostel Warden', 'Coordinator',
  'Parent', 'Student',
]

export interface ApplyResult {
  roles: { name: string; granted: number }[]
  removedRoles: string[]
  unknownCodes: string[]
}

/**
 * Make a school's roles match the table above, exactly.
 *
 * Replace, not merge: the point is that what a role holds is knowable
 * from reading this file, and a merge would leave whatever a previous
 * run or a hand-edit had put there.
 */
export async function applyTimetableSchoolRoles(schoolId: string): Promise<ApplyResult> {
  const [{ data: roles }, { data: permissions }] = await Promise.all([
    supabase.from('roles').select('id, name').eq('school_id', schoolId),
    supabase.from('permissions').select('id, permission_code'),
  ])

  const permIdByCode = new Map((permissions ?? []).map(p => [p.permission_code, p.id]))
  const result: ApplyResult = { roles: [], removedRoles: [], unknownCodes: [] }

  for (const role of roles ?? []) {
    const wanted = TIMETABLE_SCHOOL_ROLES[role.name]

    if (!wanted) {
      // A role this school will never use. Removing it keeps the
      // Permissions screen honest — an empty role that grants nothing is
      // just a thing for somebody to wonder about later. Only ever
      // removed when nobody holds it.
      if (!UNUSED_ROLES.includes(role.name)) continue
      const { count } = await supabase.from('user_roles')
        .select('id', { count: 'exact', head: true }).eq('role_id', role.id)
      if (count && count > 0) continue
      await supabase.from('role_permissions_v2').delete().eq('role_id', role.id)
      await supabase.from('roles').delete().eq('id', role.id)
      result.removedRoles.push(role.name)
      continue
    }

    const ids: string[] = []
    for (const code of new Set(wanted)) {
      const id = permIdByCode.get(code)
      if (id) ids.push(id)
      else if (!result.unknownCodes.includes(code)) result.unknownCodes.push(code)
    }

    await supabase.from('role_permissions_v2').delete().eq('role_id', role.id)
    if (ids.length) {
      await supabase.from('role_permissions_v2')
        .insert(ids.map(permission_id => ({ role_id: role.id, permission_id })))
    }
    result.roles.push({ name: role.name, granted: ids.length })
  }

  await supabase.from('schools')
    .update({ enabled_modules: TIMETABLE_SCHOOL_MODULES }).eq('id', schoolId)

  // Permissions are cached for 30s per user and baked into a JWT at
  // login; clearing the cache is what makes this take effect without
  // waiting, and everyone signs in fresh anyway.
  invalidateAllPermissions()

  result.roles.sort((a, b) => b.granted - a.granted)
  return result
}
