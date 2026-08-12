import { Response, NextFunction } from 'express'
import { supabase } from '../../../shared/db/client'
import { AuthRequest } from '../../../shared/middleware/auth'
import { getPermissionsForUser, requirePermissionV2 } from '../../../shared/middleware/permissions-v2'
import { FeeScope, resolveFeeScope } from '../../../shared/utils/feeScope'

// Fee module access control.
//
// The module previously gated writes on hardcoded role strings
// (`requireRole('school_admin','accountant')`) and gated reads on nothing at
// all. Both are replaced here by the RBAC v2 permission codes that were already
// seeded for this module and already drive the sidebar
// (fee.view / fee.collect / fee.discount / fee.structure_manage) — the fee
// routes were simply the last place still ignoring them.
//
// Two shapes of read:
//
//   requireFeeView    school-wide reports that no family should ever see —
//                     defaulters (which includes parents' phone numbers),
//                     aging, discount limits. Staff permission, full stop.
//
//   attachFeeScope    reads that legitimately serve families too. Anyone
//                     authenticated may call them; what they get back is
//                     narrowed to their own student, their homeroom section, or
//                     the school, by req.feeScope.
//
// A handler that reads req.feeScope and does not apply it is a bug — that is the
// exact mistake that made /fees/invoices world-readable.

export interface FeeRequest extends AuthRequest {
  feeScope?: FeeScope
}

/** Staff-only fee read. Parents, students and subject teachers get 403. */
export const requireFeeView = requirePermissionV2('fee.view')

/** Record a payment (invoice, arrear, or installment). */
export const requireFeeCollect = requirePermissionV2('fee.collect')

/** Grant or decide a discount. */
export const requireFeeDiscount = requirePermissionV2('fee.discount')

/**
 * Configure the catalogue and the plans: fee heads, structures and versions,
 * assignments, RTE rates, discount rules and scholarships. These change what a
 * family owes, as opposed to recording what they paid, which is why they are
 * not folded into fee.collect.
 */
export const requireFeeManage = requirePermissionV2('fee.structure_manage')

// The three codes below are narrower than fee.structure_manage on purpose. Every
// role seeded with them also holds fee.structure_manage (CORE grants it to
// School Admin / Principal / Vice Principal, and Accountant lists both), so
// splitting them out takes nothing away today — it exists so a school can hand a
// clerk "generate the invoices" or "chase the arrears" without also handing them
// the fee catalogue.

/** Run a billing cycle: preview, generate, cancel an invoice. */
export const requireFeeInvoiceGenerate = requirePermissionV2('fee.invoice_generate')

/** Create, bill or cancel a one-off charge. */
export const requireFeeAdhocManage = requirePermissionV2('fee.adhoc_manage')

/** Carry arrears forward, waive them, or run the late-fine sweep. */
export const requireFeeArrearManage = requirePermissionV2('fee.arrear_manage')

/**
 * Set a role's discount ceiling.
 *
 * Deliberately NOT fee.discount or fee.structure_manage: this endpoint sets the
 * auto-approve limit *for* the roles that hold fee.discount, and Accountant
 * holds both fee.discount and fee.structure_manage. Gating it on either would
 * let an Accountant raise their own ceiling and self-approve any concession.
 */
export const requireSettingsManage = requirePermissionV2('settings.manage')

/**
 * Resolve the caller's fee scope onto the request, or 403 if they have none.
 *
 * Does the permission lookup once and hands the result to resolveFeeScope, so a
 * scoped route costs the same number of round-trips as an unscoped one did.
 */
export async function attachFeeScope(req: FeeRequest, res: Response, next: NextFunction) {
  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, req.user!.school_id)
  const hasFeeView = isSuperRole || permissionCodes.has('fee.view')

  const scope = await resolveFeeScope(req, hasFeeView)
  if (scope.kind === 'none') {
    return res.status(403).json({ success: false, error: scope.reason })
  }

  req.feeScope = scope
  next()
}

/**
 * Narrow a fee_invoices query (or any query embedding `students`) to the
 * caller's scope.
 *
 * Section scoping goes through PostgREST's inner-join filter rather than
 * fetching the school's invoices and filtering in JS, which is what the old
 * /fees/dues did — that pulled every open invoice in the school into memory to
 * hand a class teacher thirty rows, and it is the reason none of these
 * endpoints could be paginated.
 */
export function scopeInvoiceQuery<T>(query: T, scope: FeeScope): T {
  const q = query as any
  switch (scope.kind) {
    case 'student': return q.eq('student_id', scope.studentId)
    case 'section': return q.eq('students.section_id', scope.sectionId)
    default:        return q
  }
}

/**
 * The `students` embed needed alongside scopeInvoiceQuery.
 *
 * Filtering on an embedded column only narrows the parent rows when the embed
 * is an INNER join; with the default left join PostgREST returns the invoice
 * with a null students object instead of dropping it, which would leak the row
 * count and amounts even while hiding the name.
 */
export function studentsEmbed(scope: FeeScope, columns: string): string {
  return scope.kind === 'section' ? `students!inner(${columns})` : `students(${columns})`
}

/**
 * Guard for routes that take an explicit :student_id in the path, where there is
 * no query to narrow — the id came from the URL and has to be checked directly.
 *
 * Returns an error message, or null if the read is allowed.
 *
 * The section case costs one lookup because homeroom membership can't be known
 * from the id alone; without it a class teacher could read any student in the
 * school by editing the URL, which is the same defect this whole change exists
 * to close, one level down.
 */
export async function assertCanReadStudent(
  scope: FeeScope,
  studentId: string,
  schoolId: string,
): Promise<string | null> {
  if (scope.kind === 'student') {
    return scope.studentId === studentId ? null : 'You can only view your own fee records'
  }

  if (scope.kind === 'section') {
    const { data, error } = await supabase
      .from('students')
      .select('id')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .eq('section_id', scope.sectionId)
      .maybeSingle()
    // Distinguished, because they are different problems for the reader. An
    // unchecked error here told a class teacher they were looking at somebody
    // else's student when in fact the database was unreachable — and sent them
    // to an administrator to fix a permission that was never wrong.
    if (error) return 'Could not check your homeroom just now. Try again.'
    return data ? null : 'You can only view students in your own homeroom section'
  }

  return null
}
