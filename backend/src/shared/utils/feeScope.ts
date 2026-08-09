import { AuthRequest } from '../middleware/auth'
import { NON_STAFF_ROLES, resolveOwnStudentId } from './helpers'
import { getTeacherContext } from './teacherContext'

// Who is allowed to see WHOSE fee data.
//
// This is separate from the fee.* permission codes on purpose. Permissions
// answer "may this role touch the fee module at all"; this answers "and over
// which students". A parent holds no fee permission yet must still see their
// own child's invoices, and a class teacher chasing dues for their homeroom
// must not see the rest of the school's.
//
// The logic here is not new — GET /fees/dues already did exactly this inline,
// and its comments record the two incidents that produced it: a parent calling
// /fees/dues saw every family's outstanding amount, and a subject-only teacher
// saw school-wide fee data. What was new was that /fees/invoices,
// /fees/defaulters, /fees/aging-report, /fees/arrears, /fees/discounts and
// /fees/stats had no such check at all, so the same data was one URL away.
// Having one implementation means the next fee endpoint cannot forget it.

export type FeeScope =
  /** Staff with fee.view: the whole school. */
  | { kind: 'school' }
  /** Parent or student: exactly one student. */
  | { kind: 'student'; studentId: string }
  /** Class teacher: their homeroom section only. */
  | { kind: 'section'; sectionId: string }
  /** Authenticated, but entitled to nothing here. */
  | { kind: 'none'; reason: string }

/**
 * Resolve what the caller may read.
 *
 * `staffHasFeeView` comes from the route's permission middleware having already
 * run — pass true when the route is gated on fee.view, so a staff member who
 * got past it isn't re-checked here.
 */
export async function resolveFeeScope(req: AuthRequest, staffHasFeeView: boolean): Promise<FeeScope> {
  const { id, role, school_id } = req.user!

  if (NON_STAFF_ROLES.includes(role)) {
    const studentId = await resolveOwnStudentId(id, role, school_id)
    return studentId
      ? { kind: 'student', studentId }
      : { kind: 'none', reason: 'No student record is linked to this account' }
  }

  if (role === 'teacher') {
    // A subject teacher has no business in fee data; a class teacher has it for
    // their own section, because chasing their homeroom's dues is part of the job.
    const ctx = await getTeacherContext(id, school_id)
    if (ctx.homeroomSection) return { kind: 'section', sectionId: ctx.homeroomSection.section_id }
    if (staffHasFeeView) return { kind: 'school' }
    return { kind: 'none', reason: 'Only a class teacher can view fee data, and only for their own section' }
  }

  return staffHasFeeView
    ? { kind: 'school' }
    : { kind: 'none', reason: "You don't have permission to view fee data" }
}

/** True when the scope may read school-wide aggregates and other families' rows. */
export function isSchoolWide(scope: FeeScope): scope is { kind: 'school' } {
  return scope.kind === 'school'
}
