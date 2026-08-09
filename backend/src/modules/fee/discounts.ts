import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { amountDue, money } from '../../shared/utils/feeMoney'
import { createNotifications, getRecipientUserIdsForStudent } from '../../shared/utils/notifications'
import { getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { FeeRequest, attachFeeScope, requireFeeView, requireFeeDiscount, requireFeeManage, requireSettingsManage } from './lib/guards'

// Concessions and scholarships.
//
// A concession reduces what the family is billed. A scholarship is FUNDED by
// someone — government, trust, the school itself — which is why it is a separate
// table rather than a discount with a label.
//
// Approval is amount-driven: inside the requester's role ceiling it is approved
// on the spot, above it a Principal decides. edut routes discounts for approval
// but has no threshold, so routine sibling concessions queue behind the same
// person as a ₹50,000 waiver.

const router = Router()

const SELECT = '*, students(id, first_name, last_name, admission_number, classes(name)), fee_heads(name), approver:approved_by(full_name), requester:requested_by(full_name)'

const CreateSchema = z.object({
  student_id: z.string().uuid(),
  fee_head_id: z.string().uuid().optional(),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().positive(),
  reason: z.string().min(3),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
})

/**
 * What this concession will NOT touch.
 *
 * A concession is applied by the billing run, as buildLineItems builds each
 * line. It does not reach back into an invoice already issued — deliberately, so
 * that paper handed to a family always matches what the system says was billed.
 *
 * The consequence is invisible unless it is said out loud: approve a concession
 * in June for a student whose quarters were raised in April, and the family goes
 * on being invoiced, reminded and chased for the full amount, while every report
 * shows the concession as granted. These are the invoices somebody now has to
 * decide about — adjust them, or accept that the concession starts next period.
 */
async function invoicesThisWillNotTouch(schoolId: string, studentId: string) {
  const { data } = await supabase.from('fee_invoices')
    .select('invoice_number, period_key, due_date, total_amount, amount_paid, discount_total')
    .eq('school_id', schoolId).eq('student_id', studentId)
    .in('status', ['unpaid', 'partial'])
    .order('due_date', { ascending: true })

  // Only the ones carrying no concession at all. An invoice already discounted
  // was raised after some concession existed and is not the surprise here.
  const rows = (data ?? []).filter((i: any) => Number(i.discount_total ?? 0) === 0)

  return {
    count: rows.length,
    outstanding: money(rows.reduce((s: number, i: any) => s + amountDue(i.total_amount, i.amount_paid), 0)),
    invoices: rows.map((i: any) => ({
      invoice_number: i.invoice_number,
      period_key: i.period_key,
      due_date: i.due_date,
      amount_due: money(amountDue(i.total_amount, i.amount_paid)),
    })),
  }
}

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { student_id, approval_status } = req.query
  const scope = req.feeScope!

  let q = supabase.from('fee_discounts')
    .select(scope.kind === 'section' ? SELECT.replace('students(', 'students!inner(id, section_id, ') : SELECT)
    .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })

  if (scope.kind === 'student') q = q.eq('student_id', scope.studentId)
  if (scope.kind === 'section') q = q.eq('students.section_id', scope.sectionId)
  if (student_id) q = q.eq('student_id', student_id as string)
  if (approval_status) q = q.eq('approval_status', approval_status as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/', requireFeeDiscount, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CreateSchema.parse(req.body)
  const school_id = req.user!.school_id
  const userId = req.user!.id

  const { data: userRoles } = await supabase.from('user_roles')
    .select('role_id').eq('user_id', userId).eq('school_id', school_id)
  const roleIds = (userRoles ?? []).map(r => r.role_id)

  const { data: limits } = roleIds.length
    ? await supabase.from('fee_discount_limits').select('*').eq('school_id', school_id).in('role_id', roleIds)
    : { data: [] as any[] }

  // Most permissive ceiling across the user's roles — someone who is both Admin
  // and Accountant gets the Admin figure, not the lower one.
  const maxSingle = limits?.length ? Math.max(...limits.map(l => Number(l.max_single_discount))) : 0
  const maxMonthly = limits?.length
    ? (limits.some(l => l.max_monthly_total == null) ? null : Math.max(...limits.map(l => Number(l.max_monthly_total ?? 0))))
    : 0

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const { data: thisMonth } = await supabase.from('fee_discounts')
    .select('discount_value, discount_type').eq('school_id', school_id)
    .eq('requested_by', userId).eq('approval_status', 'approved')
    .gte('created_at', monthStart.toISOString())

  // A percentage has no rupee value until it meets a fee, so it cannot be checked
  // against a ceiling and is always reviewed. Stated in the response rather than
  // left for the UI to guess.
  const monthlySoFar = money((thisMonth ?? [])
    .filter(d => d.discount_type === 'fixed').reduce((s, d) => s + Number(d.discount_value), 0))

  const isFixed = body.discount_type === 'fixed'
  const withinSingle = isFixed && body.discount_value <= maxSingle
  const withinMonthly = isFixed && (maxMonthly === null || monthlySoFar + body.discount_value <= maxMonthly)
  const auto = withinSingle && withinMonthly

  const { data, error } = await supabase.from('fee_discounts').insert({
    ...body, school_id, requested_by: userId,
    approval_status: auto ? 'approved' : 'pending',
    approved_by: auto ? userId : null,
    approved_at: auto ? new Date().toISOString() : null,
  }).select(SELECT).single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // Reported whether it auto-approved or queued: either way these invoices keep
  // the amount they were issued with, and the person recording the concession is
  // the only one in a position to notice before the family is chased for it.
  const alreadyBilled = await invoicesThisWillNotTouch(school_id, body.student_id)

  res.status(201).json({
    success: true, data,
    approval: {
      auto_approved: auto,
      reason: auto ? 'within_role_limits'
        : !isFixed ? 'percentage_always_reviewed'
        : !withinSingle ? 'exceeds_single_limit' : 'exceeds_monthly_limit',
      limit: { max_single: maxSingle, max_monthly: maxMonthly, monthly_used: monthlySoFar },
    },
    already_billed: alreadyBilled,
  })
}))

router.post('/:id/decide', requireFeeDiscount, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { decision, note } = req.body ?? {}
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be approved or rejected' })
  }
  const school_id = req.user!.school_id

  const { data: existing } = await supabase.from('fee_discounts')
    .select('id, approval_status, student_id, requested_by')
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!existing) return res.status(404).json({ success: false, error: 'Concession not found' })
  if (existing.approval_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Already ${existing.approval_status}` })
  }
  // Four eyes, with a way out for the person who has nobody to escalate to.
  //
  // The rule exists so a second pair of eyes sees a concession. But on a small
  // school the School Admin IS the second pair — blocking them meant a
  // concession they raised themselves could never be decided by anyone, and the
  // only way through was to re-key it under a colleague's login, which is worse
  // for the audit trail than the thing the rule was protecting against.
  //
  // So: everyone else is still blocked; the School Admin may self-decide, and it
  // is recorded as a self-approval rather than passing silently.
  const selfDecided = existing.requested_by === req.user!.id
  const { isSuperRole } = selfDecided
    ? await getPermissionsForUser(req.user!.id, school_id)
    : { isSuperRole: false }

  if (selfDecided && !isSuperRole) {
    return res.status(403).json({
      success: false,
      error: 'You raised this — someone else has to decide it. A School Admin can approve their own.',
    })
  }

  const { data, error } = await supabase.from('fee_discounts').update({
    approval_status: decision, approved_by: req.user!.id, approved_at: new Date().toISOString(),
  }).eq('id', req.params.id).select(SELECT).single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  // A concession decision moves money, so it is logged whoever made it — and a
  // self-approval is exactly the row an auditor comes looking for.
  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id,
    action: selfDecided ? 'FEE_DISCOUNT_SELF_APPROVED' : 'FEE_DISCOUNT_DECIDED',
    entity_type: 'fee_discount', entity_id: req.params.id,
    new_values: {
      decision, note: note ?? null, self_decided: selfDecided,
      student_id: existing.student_id,
      discount_type: data.discount_type, discount_value: data.discount_value,
    },
  })

  try {
    const recipients = await getRecipientUserIdsForStudent(existing.student_id)
    await createNotifications(recipients, {
      schoolId: school_id,
      type: decision === 'approved' ? 'discount_approved' : 'discount_rejected',
      title: decision === 'approved' ? 'Fee concession approved' : 'Fee concession declined',
      message: decision === 'approved'
        ? 'A fee concession has been approved and applies to your next bill.'
        : 'A requested fee concession was declined.',
      link: '/fees', relatedEntityType: 'fee_discount', relatedEntityId: req.params.id,
    })
  } catch (e) { console.error('discount notification failed:', e) }

  // The parent has just been told "applies to your next bill". If open invoices
  // are sitting there unreduced, the person who approved it needs to know that
  // sentence is the whole truth — nothing they are holding today has changed.
  const alreadyBilled = decision === 'approved'
    ? await invoicesThisWillNotTouch(school_id, existing.student_id)
    : { count: 0, outstanding: 0, invoices: [] }

  res.json({
    success: true, data,
    already_billed: alreadyBilled,
    meta: { note: note ?? null, self_decided: selfDecided },
  })
}))

// ── Ceilings ──────────────────────────────────────────────────────────
// Only roles that can actually grant a concession. Listing all 16 made "13 roles
// have no ceiling" look like 13 things to fix when the real number was one.
router.get('/limits', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id

  const { data: permission } = await supabase.from('permissions')
    .select('id').eq('permission_code', 'fee.discount').maybeSingle()
  if (!permission) return res.json({ success: true, data: [] })

  const { data: grants, error } = await supabase.from('role_permissions_v2')
    .select('role_id, roles!inner(id, name, description, school_id)')
    .eq('permission_id', permission.id).eq('roles.school_id', school_id)
  if (error) return res.status(500).json({ success: false, error: error.message })

  const { data: limits } = await supabase.from('fee_discount_limits').select('*').eq('school_id', school_id)
  const byRole = new Map((limits ?? []).map(l => [l.role_id, l]))

  res.json({
    success: true,
    data: (grants ?? []).map((g: any) => {
      const limit = byRole.get(g.roles.id)
      return {
        role_id: g.roles.id, role_name: g.roles.name,
        max_single_discount: limit ? Number(limit.max_single_discount) : 0,
        max_monthly_total: limit?.max_monthly_total == null ? null : Number(limit.max_monthly_total),
        configured: !!limit,
      }
    }).sort((a: any, b: any) => b.max_single_discount - a.max_single_discount),
  })
}))

router.put('/limits/:roleId', requireSettingsManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { max_single_discount, max_monthly_total } = req.body ?? {}
  if (max_single_discount == null || Number(max_single_discount) < 0) {
    return res.status(400).json({ success: false, error: 'max_single_discount must be zero or more' })
  }
  if (max_monthly_total != null && Number(max_monthly_total) < Number(max_single_discount)) {
    return res.status(400).json({
      success: false,
      error: 'A monthly total below the single-concession ceiling auto-approves nothing.',
    })
  }

  const { data, error } = await supabase.from('fee_discount_limits').upsert({
    school_id: req.user!.school_id, role_id: req.params.roleId,
    max_single_discount: Number(max_single_discount),
    max_monthly_total: max_monthly_total == null ? null : Number(max_monthly_total),
  }, { onConflict: 'school_id,role_id' }).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── Concession rules: what a fee category actually does ───────────────
//
// fee_category was inert — written by the assign form, read by one report,
// branched on by nothing. A school tagging forty children "RTE" got no different
// billing, no exemption from the chase list, and no exemption from the nightly
// reminder sweep. These rows are what make the tag act.
//
// The rule is policy; fee_discounts stays the record of a concession granted to
// a named student. Both end up in the same list at billing time, so there is one
// arithmetic and one thing to explain on a receipt.

const RuleSchema = z.object({
  academic_year_id: z.string().uuid(),
  fee_category: z.enum(['rte', 'staff_ward', 'sibling', 'scholarship']).nullish(),
  /** Fires for the Nth child and later, counted senior-first within a family. */
  min_sibling_order: z.number().int().min(1).max(10).nullish(),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().min(0),
  /** NULL = every head on the plan. */
  fee_head_id: z.string().uuid().nullish(),
  note: z.string().max(200).optional(),
  is_active: z.boolean().default(true),
}).refine(v => v.fee_category || v.min_sibling_order, {
  // The database refuses this too. Caught here so it reads as a sentence rather
  // than a constraint violation.
  message: 'A rule needs a condition — a fee category, a sibling order, or both. Without one it would discount every student in the school.',
  path: ['fee_category'],
})

router.get('/rules', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id } = req.query
  let q = supabase.from('fee_concession_rules')
    .select('*, fee_heads(id, name)')
    .eq('school_id', req.user!.school_id)
    .order('fee_category')
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({
    success: true,
    data,
    meta: {
      note: 'A rule reduces the next invoice raised for every student on that category. Invoices already issued keep the amount they were issued with.',
    },
  })
}))

// Structure-manage, not fee.discount: this is not one concession for one family,
// it is the school's standing terms for a whole category of seat. Anyone who can
// grant a discount should not be able to silently rewrite the policy behind it.
router.put('/rules', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = RuleSchema.parse(req.body)
  const school_id = req.user!.school_id

  if (body.discount_type === 'percentage' && body.discount_value > 100) {
    return res.status(400).json({ success: false, error: 'A percentage concession cannot exceed 100%' })
  }

  // Upsert on the same pair the partial unique indexes cover, so saving the RTE
  // row twice edits it rather than stacking a second rule nobody can see.
  let findExisting = supabase.from('fee_concession_rules')
    .select('id')
    .eq('school_id', school_id)
    .eq('academic_year_id', body.academic_year_id)
    .is('fee_head_id', body.fee_head_id ?? null)
  findExisting = body.fee_category
    ? findExisting.eq('fee_category', body.fee_category)
    : findExisting.is('fee_category', null)
  findExisting = body.min_sibling_order
    ? findExisting.eq('min_sibling_order', body.min_sibling_order)
    : findExisting.is('min_sibling_order', null)

  const { data: existing } = await findExisting.maybeSingle()

  const values = {
    school_id,
    academic_year_id: body.academic_year_id,
    fee_category: body.fee_category ?? null,
    min_sibling_order: body.min_sibling_order ?? null,
    discount_type: body.discount_type,
    discount_value: body.discount_value,
    fee_head_id: body.fee_head_id ?? null,
    note: body.note ?? null,
    is_active: body.is_active,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = existing
    ? await supabase.from('fee_concession_rules').update(values).eq('id', existing.id).select().single()
    : await supabase.from('fee_concession_rules')
        .insert({ ...values, created_by: req.user!.id }).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // Policy that changes what families are billed is exactly the thing an auditor
  // asks about a year later.
  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id,
    action: existing ? 'FEE_CONCESSION_RULE_UPDATED' : 'FEE_CONCESSION_RULE_CREATED',
    entity_type: 'fee_concession_rule', entity_id: data.id,
    new_values: values,
  })

  // How many students this now reaches, said out loud. A rule is invisible until
  // the next billing run, and "12% off for 114 children" is a different decision
  // from "12% off for two".
  const reach = await ruleReach(school_id, body.academic_year_id, body)

  res.json({
    success: true, data,
    meta: {
      students_on_category: reach,
      note: 'Applies to the next invoice raised. Invoices already issued are unchanged.',
    },
  })
}))

/** How many active, assigned students a rule's conditions currently select. */
async function ruleReach(
  schoolId: string,
  academicYearId: string,
  rule: { fee_category?: string | null; min_sibling_order?: number | null },
): Promise<number> {
  let q = supabase.from('fee_assignments')
    .select('student_id')
    .eq('school_id', schoolId).eq('academic_year_id', academicYearId).eq('status', 'active')
  if (rule.fee_category) q = q.eq('fee_category', rule.fee_category)

  const { data, error } = await q
  if (error) return 0
  let ids = (data ?? []).map((a: any) => a.student_id)

  if (rule.min_sibling_order && ids.length) {
    const { data: orders } = await supabase.from('student_sibling_order')
      .select('student_id, sibling_order').eq('school_id', schoolId)
      .gte('sibling_order', rule.min_sibling_order)
    const eligible = new Set((orders ?? []).map((o: any) => o.student_id))
    ids = ids.filter(id => eligible.has(id))
  }
  return ids.length
}

router.delete('/rules/:id', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data, error } = await supabase.from('fee_concession_rules')
    .delete().eq('id', req.params.id).eq('school_id', school_id).select().maybeSingle()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Rule not found' })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'FEE_CONCESSION_RULE_DELETED',
    entity_type: 'fee_concession_rule', entity_id: req.params.id,
    new_values: { removed: data },
  })

  res.json({
    success: true, data,
    meta: { note: 'Removed. Invoices already raised under it keep the concession they were issued with.' },
  })
}))

// ── Scholarships ──────────────────────────────────────────────────────
router.get('/scholarships', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const scope = req.feeScope!
  let q = supabase.from('fee_scholarships')
    .select('*, students(id, first_name, last_name, admission_number, section_id, classes(name))')
    .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
  if (scope.kind === 'student') q = q.eq('student_id', scope.studentId)
  if (req.query.student_id) q = q.eq('student_id', req.query.student_id as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/scholarships', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const schema = z.object({
    student_id: z.string().uuid(),
    academic_year_id: z.string().uuid().optional(),
    name: z.string().min(1),
    funding_source: z.enum(['government', 'trust', 'school', 'corporate', 'other']).default('school'),
    amount: z.number().positive(),
    awarded_at: z.string().optional(),
    notes: z.string().optional(),
  })
  const body = schema.parse(req.body)

  const { data, error } = await supabase.from('fee_scholarships')
    .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

export default router
