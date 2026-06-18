import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'

const router = Router()
router.use(authenticate)

// ── Schemas ─────────────────────────────────────────────────
const CreateFeeHeadSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
})

const CreateFeeStructureSchema = z.object({
  academic_year_id: z.string().uuid(),
  class_id: z.string().uuid(),
  fee_head_id: z.string().uuid(),
  amount: z.number().positive(),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annually', 'one_time']),
  due_day: z.number().min(1).max(31).optional(),
  late_fine_per_day: z.number().min(0).default(0),
  is_optional: z.boolean().default(false),
})

const CreateInvoiceSchema = z.object({
  student_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  due_date: z.string().optional(),
  fee_head_ids: z.array(z.string().uuid()), // which fee heads to include
  apply_discounts: z.boolean().default(true),
})

const RecordPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount_paid: z.number().positive(),
  payment_mode: z.enum(['cash', 'cheque', 'neft', 'card', 'upi', 'online']),
  transaction_reference: z.string().optional(),
  cheque_number: z.string().optional(),
  cheque_date: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
})

const CreateDiscountSchema = z.object({
  student_id: z.string().uuid(),
  fee_head_id: z.string().uuid().optional(),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().positive(),
  reason: z.string().min(1),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════
// Retroactive discount application
// ═══════════════════════════════════════════════════════════════
//
// Invoices are normally generated once and their line_items/totals
// are a fixed snapshot. When a discount is newly APPROVED (either
// auto-approved at creation, or via Principal approval afterward),
// this re-applies it to the student's existing unpaid/partial
// invoices so "Amount Due" reflects the discount without requiring
// a brand-new invoice.
//
// Only invoices with status 'unpaid' or 'partial' are touched —
// 'paid' invoices are left alone (already settled, recalculating
// would create confusing negative/refund situations).
//
// For each eligible invoice, line_items are recalculated against
// ALL of the student's currently-approved discounts (not just the
// one just approved) — so this is idempotent and correct even if
// called multiple times or if multiple discounts exist.
async function applyApprovedDiscountToExistingInvoices(studentId: string, schoolId: string) {
  // Fetch all currently-approved discounts for this student
  const { data: discounts } = await supabase
    .from('fee_discounts')
    .select('*')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .eq('approval_status', 'approved')

  const approvedDiscounts = discounts ?? []

  // Fetch unpaid/partial invoices for this student
  const { data: invoices } = await supabase
    .from('fee_invoices')
    .select('id, line_items, status, total_amount')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .in('status', ['unpaid', 'partial'])

  if (!invoices?.length) return { updated: 0 }

  // Fetch total paid per invoice (needed to recompute status after
  // total_amount changes)
  const invoiceIds = invoices.map(i => i.id)
  const { data: payments } = await supabase
    .from('fee_payments')
    .select('invoice_id, amount_paid')
    .in('invoice_id', invoiceIds)

  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid))
  }

  let updatedCount = 0

  for (const inv of invoices) {
    const lineItems = (inv.line_items as any[]) ?? []
    if (!lineItems.length) continue

    // Recompute each line item's discount based on ALL approved discounts
    // that apply to it, SUMMED together (a student can have multiple
    // approved discounts — e.g. sibling discount + merit discount — and
    // all of them should reduce the fee, not just the first one found).
    const newLineItems = lineItems.map(item => {
      const baseAmount = Number(item.amount)

      const applicable = approvedDiscounts.filter(
        d => !d.fee_head_id || d.fee_head_id === item.fee_head_id
      )

      let discountAmount = 0
      for (const d of applicable) {
        const thisDiscount = d.discount_type === 'percentage'
          ? (baseAmount * d.discount_value) / 100
          : d.discount_value
        discountAmount += thisDiscount
      }
      // Cap total discount at the line's base amount (can't discount
      // more than 100% of the fee)
      discountAmount = Math.min(discountAmount, baseAmount)

      return {
        ...item,
        discount: discountAmount,
        net_amount: baseAmount - discountAmount,
      }
    })

    const newSubtotal = newLineItems.reduce((s, l) => s + Number(l.amount), 0)
    const newTotalDiscount = newLineItems.reduce((s, l) => s + Number(l.discount), 0)
    const newTotalAmount = newSubtotal - newTotalDiscount

    // No change? skip the write
    if (newTotalAmount === Number(inv.total_amount)) continue

    const totalPaid = paidByInvoice.get(inv.id) ?? 0
    const newStatus = totalPaid <= 0 ? 'unpaid'
      : totalPaid >= newTotalAmount ? 'paid'
      : 'partial'

    await supabase
      .from('fee_invoices')
      .update({
        line_items: newLineItems,
        subtotal: newSubtotal,
        total_discount: newTotalDiscount,
        total_amount: newTotalAmount,
        status: newStatus,
      })
      .eq('id', inv.id)

    updatedCount++
  }

  return { updated: updatedCount }
}

// ── FEE HEADS ────────────────────────────────────────────────
router.get('/heads', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('fee_heads')
    .select('*')
    .eq('school_id', req.user!.school_id)
    .eq('is_active', true)
    .order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post(
  '/heads',
  requireRole('school_admin', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateFeeHeadSchema.parse(req.body)
    const { data, error } = await supabase
      .from('fee_heads')
      .insert({ ...body, school_id: req.user!.school_id })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ── FEE STRUCTURES ───────────────────────────────────────────
router.get('/structures', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { academic_year_id, class_id } = req.query
  let query = supabase
    .from('fee_structures')
    .select('*, fee_heads(id, name), classes(id, name), academic_years(id, name)')
    .eq('school_id', req.user!.school_id)

  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)
  if (class_id) query = query.eq('class_id', class_id)

  const { data, error } = await query.order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post(
  '/structures',
  requireRole('school_admin', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateFeeStructureSchema.parse(req.body)
    const { data, error } = await supabase
      .from('fee_structures')
      .insert({ ...body, school_id: req.user!.school_id })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ── INVOICES ─────────────────────────────────────────────────
router.get('/invoices', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', student_id, status, academic_year_id } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('fee_invoices')
    .select(`
      *,
      students(id, first_name, last_name, admission_number, class_id, classes(name)),
      academic_years(id, name)
    `, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('created_at', { ascending: false })

  if (student_id) query = query.eq('student_id', student_id)
  if (status) query = query.eq('status', status)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

router.post(
  '/invoices',
  requireRole('school_admin', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateInvoiceSchema.parse(req.body)
    const school_id = req.user!.school_id

    // Get student info
    const { data: student } = await supabase
      .from('students').select('id, class_id').eq('id', body.student_id).eq('school_id', school_id).single()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })

    // Get fee structures for the selected fee heads
    const { data: structures } = await supabase
      .from('fee_structures')
      .select('*, fee_heads(id, name)')
      .eq('school_id', school_id)
      .eq('academic_year_id', body.academic_year_id)
      .eq('class_id', student.class_id!)
      .in('fee_head_id', body.fee_head_ids)

    if (!structures?.length) {
      return res.status(400).json({ success: false, error: 'No fee structures found for selected criteria' })
    }

    // Get applicable discounts.
    // Only APPROVED discounts (workflow_instance approved, or auto-approved
    // sub-₹2000 discounts) reduce the invoice amount. Discounts still
    // pending Principal approval are not applied yet.
    let discounts: any[] = []
    if (body.apply_discounts) {
      const { data } = await supabase
        .from('fee_discounts')
        .select('*')
        .eq('student_id', body.student_id)
        .eq('is_active', true)
        .eq('approval_status', 'approved')
      discounts = data ?? []
    }

    // Build line items — sum ALL applicable approved discounts per
    // fee head (a student can have multiple approved discounts).
    const lineItems = structures.map(s => {
      const feeHead = s.fee_heads as any
      const baseAmount = Number(s.amount)

      const applicable = discounts.filter(
        d => !d.fee_head_id || d.fee_head_id === s.fee_head_id
      )

      let discountAmount = 0
      for (const d of applicable) {
        discountAmount += d.discount_type === 'percentage'
          ? (baseAmount * d.discount_value) / 100
          : d.discount_value
      }
      discountAmount = Math.min(discountAmount, baseAmount)

      return {
        fee_head_id: s.fee_head_id,
        name: feeHead?.name ?? 'Fee',
        amount: baseAmount,
        discount: discountAmount,
        net_amount: baseAmount - discountAmount,
      }
    })

    const subtotal = lineItems.reduce((s, l) => s + l.amount, 0)
    const totalDiscount = lineItems.reduce((s, l) => s + l.discount, 0)
    const totalAmount = subtotal - totalDiscount

    // Generate invoice number
    const { count } = await supabase
      .from('fee_invoices').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const invoiceNumber = `INV${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(5, '0')}`

    const { data, error } = await supabase
      .from('fee_invoices')
      .insert({
        school_id,
        student_id: body.student_id,
        academic_year_id: body.academic_year_id,
        invoice_number: invoiceNumber,
        due_date: body.due_date,
        line_items: lineItems,
        subtotal,
        total_discount: totalDiscount,
        late_fine: 0,
        total_amount: totalAmount,
        status: 'unpaid',
        created_by: req.user!.id,
      })
      .select()
      .single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ── PAYMENTS ─────────────────────────────────────────────────
router.post(
  '/payments',
  requireRole('school_admin', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = RecordPaymentSchema.parse(req.body)
    const school_id = req.user!.school_id

    // Verify invoice
    const { data: invoice } = await supabase
      .from('fee_invoices')
      .select('*')
      .eq('id', body.invoice_id)
      .eq('school_id', school_id)
      .single()
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })
    if (invoice.status === 'paid') return res.status(400).json({ success: false, error: 'Invoice already paid' })

    // Generate receipt number
    const { count } = await supabase
      .from('fee_payments').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const receiptNumber = `RCP${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(5, '0')}`

    const { data: payment, error: payErr } = await supabase
      .from('fee_payments')
      .insert({
        ...body,
        school_id,
        student_id: invoice.student_id,
        receipt_number: receiptNumber,
        collected_by: req.user!.id,
      })
      .select()
      .single()

    if (payErr) return res.status(400).json({ success: false, error: payErr.message })

    // Update invoice status
    const { data: allPayments } = await supabase
      .from('fee_payments')
      .select('amount_paid')
      .eq('invoice_id', body.invoice_id)

    const totalPaid = (allPayments ?? []).reduce((s, p) => s + Number(p.amount_paid), 0)
    const newStatus = totalPaid >= invoice.total_amount ? 'paid' : 'partial'

    await supabase.from('fee_invoices')
      .update({ status: newStatus })
      .eq('id', body.invoice_id)

    await supabase.from('audit_logs').insert({
      school_id,
      user_id: req.user!.id,
      action: 'PAYMENT_RECORDED',
      entity_type: 'fee_payment',
      entity_id: payment.id,
      new_values: { amount: body.amount_paid, mode: body.payment_mode, invoice_id: body.invoice_id },
    })

    res.status(201).json({ success: true, data: { payment, invoice_status: newStatus } })
  })
)

// ── DUES LIST ─────────────────────────────────────────────────
router.get('/dues', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, academic_year_id } = req.query
  const school_id = req.user!.school_id
 
  let query = supabase
    .from('fee_invoices')
    .select(`
      id, invoice_number, total_amount, due_date, status, created_at,
      students(id, first_name, last_name, admission_number, class_id, classes(name), sections(name))
    `)
    .eq('school_id', school_id)
    .in('status', ['unpaid', 'partial'])
    .order('due_date', { ascending: true, nullsFirst: false })
 
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)
 
  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
 
  let filtered = class_id
    ? (data ?? []).filter((i: any) => i.students?.class_id === class_id)
    : (data ?? [])
 
  // Compute the REAL remaining balance per invoice (total_amount minus
  // whatever has already been paid against it) — total_amount alone
  // is the original bill, not what's still owed.
  const invoiceIds = filtered.map((i: any) => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('fee_payments').select('invoice_id, amount_paid').in('invoice_id', invoiceIds)
    : { data: [] }
 
  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid))
  }
 
  const result = filtered.map((inv: any) => ({
    ...inv,
    amount_due: Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0),
  }))
 
  res.json({ success: true, data: result })
}))

// ── DISCOUNTS ────────────────────────────────────────────────
//
// Fee Discount Approval Workflow:
//   - discount_value < 2000  -> auto-approved immediately (workflow
//     engine's entityContext auto-approve cascade)
//   - discount_value >= 2000 -> requires Principal approval via
//     /discounts/:id/workflow-action before it's applied to invoices
//
// fee_discounts.approval_status mirrors workflow_instances.status
// ('pending' | 'approved' | 'rejected') so existing UI/queries that
// filter on discount approval state keep working without an extra
// join. is_active stays true throughout — approval_status is the
// gate for whether a discount actually reduces an invoice (see
// POST /invoices above, which only applies approval_status='approved'
// discounts).

router.get('/discounts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id, approval_status } = req.query
  let query = supabase
    .from('fee_discounts')
    .select('*, students(first_name, last_name), fee_heads(name), users:approved_by(full_name)')
    .eq('school_id', req.user!.school_id)

  if (student_id) query = query.eq('student_id', student_id)
  if (approval_status) query = query.eq('approval_status', approval_status as string)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post(
  '/discounts',
  requireRole('school_admin', 'principal', 'accountant', 'counselor'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateDiscountSchema.parse(req.body)
    const school_id = req.user!.school_id
    const userId = req.user!.id
 
    // Find the requesting user's roles (new RBAC system) and their
    // discount limits. Use the most permissive limit among all their
    // roles (a School Admin who's also Accountant gets Admin's limit).
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role_id')
      .eq('user_id', userId)
      .eq('school_id', school_id)
 
    const roleIds = (userRoles ?? []).map(r => r.role_id)
 
    const { data: limits } = roleIds.length
      ? await supabase.from('fee_discount_limits').select('*').eq('school_id', school_id).in('role_id', roleIds)
      : { data: [] }
 
    // Default fallback if no limit row found for any of their roles
    // (e.g. brand-new role with no fee_discount_limits seeded yet) —
    // be conservative and require Principal approval for anything.
    const maxSingle = limits?.length ? Math.max(...limits.map(l => Number(l.max_single_discount))) : 0
    const maxMonthly = limits?.length
      ? limits.some(l => l.max_monthly_total == null) ? null : Math.max(...limits.map(l => Number(l.max_monthly_total ?? 0)))
      : 0
 
    // Sum this user's already-approved discounts this calendar month
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
 
    const { data: thisMonthDiscounts } = await supabase
      .from('fee_discounts')
      .select('discount_value, discount_type')
      .eq('school_id', school_id)
      .eq('requested_by', userId)
      .eq('approval_status', 'approved')
      .gte('created_at', startOfMonth.toISOString())
 
    // Note: percentage discounts can't be summed in rupee terms without
    // knowing the base amount per-invoice; this monthly cap currently
    // only tracks FIXED-amount discounts. Percentage discounts always
    // pass the monthly check (still subject to max_single_discount via
    // the per-line cap applied at invoice time).
    const monthlySoFar = (thisMonthDiscounts ?? [])
      .filter(d => d.discount_type === 'fixed')
      .reduce((s, d) => s + Number(d.discount_value), 0)
 
    const withinSingleLimit = body.discount_type === 'fixed' ? body.discount_value <= maxSingle : true
    const withinMonthlyLimit = body.discount_type === 'fixed'
      ? (maxMonthly === null || (monthlySoFar + body.discount_value) <= maxMonthly)
      : true
 
    const canAutoApprove = withinSingleLimit && withinMonthlyLimit
 
    const { data, error } = await supabase
      .from('fee_discounts')
      .insert({ ...body, school_id, approval_status: 'pending', requested_by: userId })
      .select().single()
 
    if (error) return res.status(400).json({ success: false, error: error.message })
 
    let finalData = data
    let workflowInfo: any = null
 
    if (canAutoApprove) {
      const { data: updated } = await supabase
        .from('fee_discounts')
        .update({ approval_status: 'approved', approved_by: null, approved_at: new Date().toISOString() })
        .eq('id', data.id)
        .select('*, students(first_name, last_name), fee_heads(name)')
        .single()
 
      finalData = updated ?? data
      await applyApprovedDiscountToExistingInvoices(body.student_id, school_id)
      workflowInfo = { auto_approved: true, reason: 'within_role_limits' }
    } else {
      // Over the role's limit — start the Principal-approval workflow
      const wfResult = await startWorkflow({
        schoolId: school_id,
        workflowName: 'Fee Discount Approval Workflow',
        entityType: 'fee_discount',
        entityId: data.id,
        initiatedBy: userId,
        entityContext: { discount_value: body.discount_value },
      })
      workflowInfo = {
        auto_approved: false,
        reason: !withinSingleLimit ? 'exceeds_single_discount_limit' : 'exceeds_monthly_limit',
        instance: wfResult.success ? wfResult.instance : null,
      }
      if (!wfResult.success) console.error(`Failed to start fee discount workflow:`, wfResult.error)
    }
 
    res.status(201).json({ success: true, data: finalData, workflow: workflowInfo })
  })
)
 
// ── GET /fees/discount-limits ──────────────────────────────────
// View configured limits per role (for an admin settings page)
router.get('/discount-limits', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data, error } = await supabase
      .from('fee_discount_limits')
      .select('*, roles(name)')
      .eq('school_id', school_id)
      .order('max_single_discount', { ascending: false })
 
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)
 
// ── PUT /fees/discount-limits/:roleId ──────────────────────────
// Admin/Principal can adjust a role's discount limits.
router.put('/discount-limits/:roleId', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { roleId } = req.params
    const { max_single_discount, max_monthly_total } = req.body
    const school_id = req.user!.school_id
 
    if (max_single_discount == null || max_single_discount < 0) {
      return res.status(400).json({ success: false, error: 'max_single_discount must be a non-negative number' })
    }
 
    const { data, error } = await supabase
      .from('fee_discount_limits')
      .upsert({ school_id, role_id: roleId, max_single_discount, max_monthly_total: max_monthly_total ?? null }, { onConflict: 'school_id,role_id' })
      .select()
      .single()
 
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)
// ── POST /discounts/:id/workflow-action ───────────────────────
// For discounts >= ₹2000 requiring real Principal approval.
// Body: { status: 'approved' | 'rejected', notes?: string }
router.post('/discounts/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { status, notes } = req.body
  const school_id = req.user!.school_id

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be approved or rejected.' })
  }

  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'fee_discount')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instErr || !instance) {
    return res.status(404).json({ success: false, error: 'No workflow instance found for this discount.' })
  }

  if (instance.status !== 'in_progress') {
    return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
  }

  const result = await actOnWorkflow({
    instanceId: instance.id,
    userId: req.user!.id,
    schoolId: school_id,
    status,
    notes,
  })

  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error })
  }

  if (result.completed) {
    const { data: updatedDiscount } = await supabase
      .from('fee_discounts')
      .update({
        approval_status: result.instance.status, // 'approved' | 'rejected'
        approved_by: req.user!.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('school_id', school_id)
      .select('student_id')
      .single()

    // If approved, retroactively apply to existing unpaid/partial
    // invoices for this student.
    if (result.instance.status === 'approved' && updatedDiscount) {
      await applyApprovedDiscountToExistingInvoices(updatedDiscount.student_id, school_id)
    }
  }

  res.json({
    success: true,
    data: { instance: result.instance, completed: result.completed },
  })
}))

// ── GET /discounts/:id/workflow-status ────────────────────────
router.get('/discounts/:id/workflow-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const status = await getWorkflowStatus('fee_discount', id, school_id)

  if (!status) {
    return res.json({ success: true, data: null, message: 'No workflow started for this discount' })
  }

  res.json({ success: true, data: status })
}))

// ── STATS ────────────────────────────────────────────────────
router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { academic_year_id } = req.query
  const school_id = req.user!.school_id

  let query = supabase.from('fee_invoices').select('status, total_amount').eq('school_id', school_id)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)

  const { data: invoices } = await query
  const { data: payments } = await supabase
    .from('fee_payments').select('amount_paid').eq('school_id', school_id)

  const totalBilled = (invoices ?? []).reduce((s, i) => s + Number(i.total_amount), 0)
  const totalCollected = (payments ?? []).reduce((s, p) => s + Number(p.amount_paid), 0)
  const totalDue = totalBilled - totalCollected

  res.json({
    success: true,
    data: {
      total_billed: totalBilled,
      total_collected: totalCollected,
      total_due: totalDue,
      paid_invoices: invoices?.filter(i => i.status === 'paid').length ?? 0,
      unpaid_invoices: invoices?.filter(i => i.status === 'unpaid').length ?? 0,
      partial_invoices: invoices?.filter(i => i.status === 'partial').length ?? 0,
    },
  })
}))



// ── GET /fees/adhoc ───────────────────────────────────────────
router.get('/adhoc', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id, class_id, status } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('adhoc_fees')
    .select('*, students(first_name, last_name, admission_number), classes(name), users:created_by(full_name)')
    .eq('school_id', school_id)
    .order('created_at', { ascending: false })

  if (student_id) query = query.eq('student_id', student_id as string)
  if (class_id)   query = query.eq('class_id', class_id as string)
  if (status)     query = query.eq('status', status as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── POST /fees/adhoc ──────────────────────────────────────────
router.post('/adhoc', requireRole('school_admin','principal','accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { student_id, class_id, title, description, amount, due_date } = req.body
    const school_id = req.user!.school_id

    if (!title || !amount) return res.status(400).json({ success: false, error: 'title and amount required' })

    const { data, error } = await supabase
      .from('adhoc_fees')
      .insert({
        school_id,
        student_id: student_id || null,
        class_id: class_id || null,
        title, description,
        amount: Number(amount),
        due_date: due_date || null,
        created_by: req.user!.id,
      })
      .select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ── PATCH /fees/adhoc/:id ─────────────────────────────────────
router.patch('/adhoc/:id', requireRole('school_admin','principal','accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status } = req.body
    const { data, error } = await supabase
      .from('adhoc_fees')
      .update({ status })
      .eq('id', id)
      .eq('school_id', req.user!.school_id)
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ── GET /fees/student-summary/:student_id ─────────────────────
router.get('/student-summary/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id } = req.params
  const school_id = req.user!.school_id

  const [invoicesRes, paymentsRes, adhocRes] = await Promise.all([
    supabase.from('fee_invoices')
      .select('id, invoice_number, invoice_date, due_date, total_amount, status, line_items')
      .eq('student_id', student_id)
      .eq('school_id', school_id)
      .order('invoice_date', { ascending: false }),
    supabase.from('fee_payments')
      .select('id, receipt_number, payment_date, amount_paid, payment_mode, invoice_id')
      .eq('student_id', student_id)
      .eq('school_id', school_id)
      .order('payment_date', { ascending: false }),
    supabase.from('adhoc_fees')
      .select('*')
      .eq('student_id', student_id)
      .eq('school_id', school_id)
      .order('created_at', { ascending: false }),
  ])

  const invoices  = invoicesRes.data  ?? []
  const payments  = paymentsRes.data  ?? []
  const adhocFees = adhocRes.data     ?? []

  const totalBilled    = invoices.reduce((s, i) => s + Number(i.total_amount), 0)
  const totalPaid      = payments.reduce((s, p) => s + Number(p.amount_paid), 0)
  const totalDue       = totalBilled - totalPaid
  const totalAdhoc     = adhocFees.filter(a => a.status !== 'cancelled').reduce((s, a) => s + Number(a.amount), 0)
  const totalAdhocPaid = adhocFees.filter(a => a.status === 'paid').reduce((s, a) => s + Number(a.amount), 0)

  res.json({
    success: true,
    data: {
      summary: { totalBilled, totalPaid, totalDue, totalAdhoc, totalAdhocPaid },
      invoices,
      payments,
      adhoc_fees: adhocFees,
    }
  })
}))



router.get('/aging-report', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
 
  const { data: invoices, error } = await supabase
    .from('fee_invoices')
    .select(`
      id, invoice_number, total_amount, due_date, status,
      students(id, first_name, last_name, admission_number, class_id, classes(name))
    `)
    .eq('school_id', school_id)
    .in('status', ['unpaid', 'partial'])
 
  if (error) return res.status(500).json({ success: false, error: error.message })
 
  const invoiceIds = (invoices ?? []).map(i => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('fee_payments').select('invoice_id, amount_paid').in('invoice_id', invoiceIds)
    : { data: [] }
 
  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid))
  }
 
  const today = new Date()
  const buckets: Record<string, any[]> = { current: [], '1_30': [], '31_60': [], '61_90': [], '90_plus': [] }
 
  for (const inv of invoices ?? []) {
    const amountDue = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
    if (amountDue <= 0) continue // fully paid despite stale status, skip
 
    const dueDate = inv.due_date ? new Date(inv.due_date) : null
    const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : -1
 
    const row = { ...inv, amount_due: amountDue, days_overdue: daysOverdue }
 
    if (daysOverdue <= 0) buckets.current.push(row)
    else if (daysOverdue <= 30) buckets['1_30'].push(row)
    else if (daysOverdue <= 60) buckets['31_60'].push(row)
    else if (daysOverdue <= 90) buckets['61_90'].push(row)
    else buckets['90_plus'].push(row)
  }
 
  const summary = Object.fromEntries(
    Object.entries(buckets).map(([k, rows]) => [k, {
      count: rows.length,
      total: rows.reduce((s, r) => s + r.amount_due, 0),
    }])
  )
 
  res.json({ success: true, data: { buckets, summary } })
}))
 
// ── GET /fees/defaulters ────────────────────────────────────────
// Students with invoices overdue beyond a threshold (default 30 days),
// grouped per student with their total outstanding amount.
router.get('/defaulters', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const minDaysOverdue = Number(req.query.min_days_overdue) || 30
 
  const { data: invoices, error } = await supabase
    .from('fee_invoices')
    .select(`
      id, invoice_number, total_amount, due_date, student_id,
      students(id, first_name, last_name, admission_number, class_id, classes(name), sections(name), parents(father_name, father_phone, mother_name, mother_phone))
    `)
    .eq('school_id', school_id)
    .in('status', ['unpaid', 'partial'])
    .not('due_date', 'is', null)
 
  if (error) return res.status(500).json({ success: false, error: error.message })
 
  const invoiceIds = (invoices ?? []).map(i => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('fee_payments').select('invoice_id, amount_paid').in('invoice_id', invoiceIds)
    : { data: [] }
 
  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid))
  }
 
  const today = new Date()
  const byStudent: Record<string, any> = {}
 
  for (const inv of invoices ?? []) {
    const amountDue = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
    if (amountDue <= 0) continue
 
    const daysOverdue = Math.floor((today.getTime() - new Date(inv.due_date!).getTime()) / (1000 * 60 * 60 * 24))
    if (daysOverdue < minDaysOverdue) continue
 
    const sid = inv.student_id
    if (!byStudent[sid]) {
      const studentData = inv.students as any
      byStudent[sid] = {
        student: studentData,
        parent_contact: studentData?.parents?.[0] ?? null,
        total_outstanding: 0,
        max_days_overdue: 0,
        invoice_count: 0,
        invoices: [],
      }
    }
    byStudent[sid].total_outstanding += amountDue
    byStudent[sid].max_days_overdue = Math.max(byStudent[sid].max_days_overdue, daysOverdue)
    byStudent[sid].invoice_count += 1
    byStudent[sid].invoices.push({ id: inv.id, invoice_number: inv.invoice_number, amount_due: amountDue, days_overdue: daysOverdue })
  }
 
  const result = Object.values(byStudent).sort((a: any, b: any) => b.max_days_overdue - a.max_days_overdue)
 
  res.json({ success: true, data: result, meta: { min_days_overdue: minDaysOverdue, total_defaulters: result.length } })
}))


router.post('/arrears/carry-forward', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from_academic_year_id, to_academic_year_id } = req.body
    const school_id = req.user!.school_id

    if (!from_academic_year_id || !to_academic_year_id) {
      return res.status(400).json({ success: false, error: 'from_academic_year_id and to_academic_year_id are required' })
    }

    const { data: invoices, error } = await supabase
      .from('fee_invoices')
      .select('id, student_id, total_amount')
      .eq('school_id', school_id)
      .eq('academic_year_id', from_academic_year_id)
      .in('status', ['unpaid', 'partial'])

    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!invoices?.length) return res.json({ success: true, data: { carried_forward: 0, message: 'No outstanding invoices found for that academic year' } })

    const invoiceIds = invoices.map(i => i.id)
    const { data: payments } = await supabase.from('fee_payments').select('invoice_id, amount_paid').in('invoice_id', invoiceIds)

    const paidByInvoice = new Map<string, number>()
    for (const p of payments ?? []) {
      paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid))
    }

    // Skip invoices already carried forward (idempotency — running
    // this twice shouldn't double the arrears)
    const { data: existingArrears } = await supabase
      .from('fee_arrears')
      .select('original_invoice_id')
      .eq('school_id', school_id)
      .eq('to_academic_year_id', to_academic_year_id)

    const alreadyCarried = new Set((existingArrears ?? []).map(a => a.original_invoice_id))

    const rows = invoices
      .filter(inv => !alreadyCarried.has(inv.id))
      .map(inv => {
        const remaining = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
        return {
          school_id,
          student_id: inv.student_id,
          from_academic_year_id,
          to_academic_year_id,
          original_invoice_id: inv.id,
          amount: remaining,
          amount_paid: 0,
          status: 'pending',
          carried_forward_by: req.user!.id,
        }
      })
      .filter(r => r.amount > 0)

    if (!rows.length) {
      return res.json({ success: true, data: { carried_forward: 0, message: 'All outstanding invoices already carried forward, or no balance remaining' } })
    }

    const { data: inserted, error: insErr } = await supabase.from('fee_arrears').insert(rows).select()
    if (insErr) return res.status(400).json({ success: false, error: insErr.message })

    res.json({ success: true, data: { carried_forward: inserted?.length ?? 0, total_amount: rows.reduce((s, r) => s + r.amount, 0) } })
  })
)

// ── GET /fees/arrears ────────────────────────────────────────────
// List arrears, optionally filtered by student or academic year.
router.get('/arrears', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id, to_academic_year_id, status } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('fee_arrears')
    .select(`
      *, students(id, first_name, last_name, admission_number, classes(name)),
      from_year:from_academic_year_id(name), to_year:to_academic_year_id(name)
    `)
    .eq('school_id', school_id)
    .order('carried_forward_at', { ascending: false })

  if (student_id) query = query.eq('student_id', student_id as string)
  if (to_academic_year_id) query = query.eq('to_academic_year_id', to_academic_year_id as string)
  if (status) query = query.eq('status', status as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── POST /fees/arrears/:id/payment ────────────────────────────────
// Record a payment against an arrear (separate from regular invoice
// payments, since arrears aren't tied to a current invoice).
router.post('/arrears/:id/payment', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { amount, payment_mode, notes } = req.body
    const school_id = req.user!.school_id

    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A positive amount is required' })

    const { data: arrear } = await supabase.from('fee_arrears').select('*').eq('id', id).eq('school_id', school_id).single()
    if (!arrear) return res.status(404).json({ success: false, error: 'Arrear not found' })

    const newAmountPaid = Number(arrear.amount_paid) + Number(amount)
    const newStatus = newAmountPaid >= Number(arrear.amount) ? 'cleared' : 'partial'

    const { data, error } = await supabase
      .from('fee_arrears')
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        cleared_at: newStatus === 'cleared' ? new Date().toISOString() : null,
        notes: notes ? `${arrear.notes ?? ''}\n[${payment_mode ?? 'payment'}] ${notes}`.trim() : arrear.notes,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ── PATCH /fees/arrears/:id/waive ─────────────────────────────────
// Admin/Principal can waive an arrear entirely (e.g. financial hardship).
router.patch('/arrears/:id/waive', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { reason } = req.body
    const school_id = req.user!.school_id

    const { data, error } = await supabase
      .from('fee_arrears')
      .update({ status: 'waived', notes: reason ? `Waived: ${reason}` : 'Waived', cleared_at: new Date().toISOString() })
      .eq('id', id)
      .eq('school_id', school_id)
      .select()
      .single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)
router.post('/invoices/:id/installments', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { installments } = req.body
    const school_id = req.user!.school_id
 
    if (!Array.isArray(installments) || installments.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 installments are required (otherwise just pay the invoice directly)' })
    }
 
    const { data: invoice } = await supabase.from('fee_invoices').select('id, total_amount').eq('id', id).eq('school_id', school_id).single()
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })
 
    const sum = installments.reduce((s: number, i: any) => s + Number(i.amount), 0)
    if (Math.abs(sum - Number(invoice.total_amount)) > 0.01) {
      return res.status(400).json({
        success: false,
        error: `Installment amounts (₹${sum}) must sum to the invoice total (₹${invoice.total_amount})`,
      })
    }
 
    // Replace any existing installment plan for this invoice
    await supabase.from('fee_installments').delete().eq('invoice_id', id)
 
    const rows = installments.map((inst: any, idx: number) => ({
      school_id,
      invoice_id: id,
      installment_number: idx + 1,
      amount: inst.amount,
      due_date: inst.due_date || null,
      status: 'pending',
    }))
 
    const { data, error } = await supabase.from('fee_installments').insert(rows).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
 
    res.status(201).json({ success: true, data })
  })
)
 
// ── GET /fees/invoices/:id/installments ───────────────────────────
router.get('/invoices/:id/installments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
 
  const { data, error } = await supabase
    .from('fee_installments')
    .select('*')
    .eq('invoice_id', id)
    .eq('school_id', school_id)
    .order('installment_number')
 
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))
 
// ── POST /fees/installments/:id/pay ───────────────────────────────
// Records a payment specifically against one installment. Creates a
// fee_payments row linked via installment_id, marks the installment
// paid, and updates the parent invoice's overall status the same way
// a regular payment would.
router.post('/installments/:id/pay', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { payment_mode, transaction_reference, notes } = req.body
    const school_id = req.user!.school_id
 
    const { data: installment } = await supabase.from('fee_installments').select('*').eq('id', id).eq('school_id', school_id).single()
    if (!installment) return res.status(404).json({ success: false, error: 'Installment not found' })
    if (installment.status === 'paid') return res.status(400).json({ success: false, error: 'Installment already paid' })
 
    const { data: invoice } = await supabase.from('fee_invoices').select('*').eq('id', installment.invoice_id).single()
    if (!invoice) return res.status(404).json({ success: false, error: 'Parent invoice not found' })
 
    const { count } = await supabase.from('fee_payments').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const receiptNumber = `RCP${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(5, '0')}`
 
    const { data: payment, error: payErr } = await supabase
      .from('fee_payments')
      .insert({
        school_id,
        invoice_id: invoice.id,
        installment_id: id,
        student_id: invoice.student_id,
        amount_paid: installment.amount,
        payment_mode: payment_mode ?? 'cash',
        transaction_reference,
        notes,
        receipt_number: receiptNumber,
        collected_by: req.user!.id,
      })
      .select()
      .single()
 
    if (payErr) return res.status(400).json({ success: false, error: payErr.message })
 
    await supabase.from('fee_installments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', id)
 
    // Update parent invoice status based on total paid across all
    // payments (installment-based or otherwise)
    const { data: allPayments } = await supabase.from('fee_payments').select('amount_paid').eq('invoice_id', invoice.id)
    const totalPaid = (allPayments ?? []).reduce((s, p) => s + Number(p.amount_paid), 0)
    const newInvoiceStatus = totalPaid >= Number(invoice.total_amount) ? 'paid' : 'partial'
    await supabase.from('fee_invoices').update({ status: newInvoiceStatus }).eq('id', invoice.id)
 
    res.status(201).json({ success: true, data: { payment, invoice_status: newInvoiceStatus } })
  })
)



router.post('/apply-late-fines', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const today = new Date()
 
    const { data: invoices, error } = await supabase
      .from('fee_invoices')
      .select('id, line_items, due_date, late_fine, total_amount, academic_year_id')
      .eq('school_id', school_id)
      .in('status', ['unpaid', 'partial'])
      .not('due_date', 'is', null)
 
    if (error) return res.status(500).json({ success: false, error: error.message })
 
    const overdue = (invoices ?? []).filter(inv => new Date(inv.due_date!) < today)
    if (!overdue.length) {
      return res.json({ success: true, data: { updated: 0, message: 'No overdue invoices found' } })
    }
 
    // Fetch late_fine_per_day rates for all fee heads referenced in
    // these invoices' line_items, scoped to each invoice's academic year.
    const allFeeHeadIds = new Set<string>()
    for (const inv of overdue) {
      for (const item of (inv.line_items as any[]) ?? []) {
        if (item.fee_head_id) allFeeHeadIds.add(item.fee_head_id)
      }
    }
 
    const { data: structures } = allFeeHeadIds.size
      ? await supabase.from('fee_structures').select('fee_head_id, late_fine_per_day, academic_year_id').in('fee_head_id', Array.from(allFeeHeadIds))
      : { data: [] }
 
    let updatedCount = 0
 
    for (const inv of overdue) {
      const daysOverdue = Math.floor((today.getTime() - new Date(inv.due_date!).getTime()) / (1000 * 60 * 60 * 24))
      if (daysOverdue <= 0) continue
 
      const lineItems = (inv.line_items as any[]) ?? []
      let totalFine = 0
 
      for (const item of lineItems) {
        const structure = (structures ?? []).find(
          s => s.fee_head_id === item.fee_head_id && s.academic_year_id === inv.academic_year_id
        )
        const dailyRate = Number(structure?.late_fine_per_day ?? 0)
        if (dailyRate > 0) totalFine += dailyRate * daysOverdue
      }
 
      // Only update if the fine actually changed (avoids unnecessary
      // writes if this endpoint is called repeatedly on the same day)
      if (Math.abs(totalFine - Number(inv.late_fine ?? 0)) < 0.01) continue
 
      const oldFine = Number(inv.late_fine ?? 0)
      const newTotalAmount = Number(inv.total_amount) - oldFine + totalFine
 
      await supabase
        .from('fee_invoices')
        .update({ late_fine: totalFine, total_amount: newTotalAmount })
        .eq('id', inv.id)
 
      updatedCount++
    }
 
    res.json({ success: true, data: { updated: updatedCount, checked: overdue.length } })
  })
)
 
export default router