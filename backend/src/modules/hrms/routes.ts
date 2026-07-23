import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { getPermissionsForRole } from '../../shared/middleware/permissions'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { assignDefaultUserRole } from '../rbac/seed'
import { getNonWorkingDaySets, countWorkingDays, isWorkingDate, dateRangeStrings } from '../../shared/utils/academicCalendar'

const router = Router()
router.use(authenticate)

// ═══════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════
const StaffProfileSchema = z.object({
  user_id: z.string().uuid(),
  employee_id: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  date_of_joining: z.string().optional(),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  blood_group: z.string().optional(),
  qualification: z.string().optional(),
  experience_years: z.number().optional(),
  phone: z.string().optional(),
  alternate_phone: z.string().optional(),
  personal_email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_ifsc: z.string().optional(),
  pan_number: z.string().optional(),
  photo_url: z.string().optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'probation']).optional(),
  employment_status: z.enum(['active', 'on_leave', 'suspended', 'resigned', 'terminated']).optional(),
  reporting_to: z.string().optional(),
})

const LeaveRequestSchema = z.object({
  leave_type_id: z.string().uuid(),
  from_date: z.string(),
  to_date: z.string(),
  // total_days is recomputed server-side from the academic calendar
  // (weekly-off + holidays) — never trust the client's count, it's what
  // gets deducted from the staff member's leave balance.
  reason: z.string().optional(),
})

const JobPostingSchema = z.object({
  title: z.string().min(1),
  department: z.string().optional(),
  designation: z.string().optional(),
  employment_type: z.string().optional(),
  description: z.string().optional(),
  requirements: z.string().optional(),
  experience_required: z.string().optional(),
  salary_range: z.string().optional(),
  vacancies: z.number().optional(),
})

const JobApplicationSchema = z.object({
  job_posting_id: z.string().uuid().optional(),
  candidate_name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().min(1),
  resume_url: z.string().optional(),
  cover_letter: z.string().optional(),
  experience_years: z.number().optional(),
  current_designation: z.string().optional(),
  expected_salary: z.number().optional(),
  notice_period: z.string().optional(),
  source: z.string().optional(),
})

const SalaryStructureSchema = z.object({
  user_id: z.string().uuid(),
  basic_salary: z.number(),
  hra: z.number().optional(),
  da: z.number().optional(),
  conveyance_allowance: z.number().optional(),
  medical_allowance: z.number().optional(),
  other_allowances: z.number().optional(),
  pf_deduction: z.number().optional(),
  professional_tax: z.number().optional(),
  other_deductions: z.number().optional(),
  effective_from: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════
// STAFF DIRECTORY
// ═══════════════════════════════════════════════════════════════

// GET /hrms/staff - list all staff with profiles
router.get('/staff', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, department, employment_status, role, page = '1', limit = '20' } = req.query
  const { from, to } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('users')
    .select(`
  id, full_name, email, role, phone, created_at,
  staff_profiles!staff_profiles_user_id_fkey(*)
`, { count: 'exact' })
    .eq('school_id', school_id)
    .neq('role', 'student')
    .range(from, to)
    .order('full_name')

  if (role) query = query.eq('role', role as string)
  if (search) query = query.ilike('full_name', `%${search}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  let filtered = data ?? []
  // staff_profiles comes back as array (one-to-one but supabase returns array) - normalize
  filtered = filtered.map((u: any) => ({ ...u, staff_profile: u.staff_profiles?.[0] ?? null, staff_profiles: undefined }))

  if (department) filtered = filtered.filter((u: any) => u.staff_profile?.department === department)
  if (employment_status) filtered = filtered.filter((u: any) => u.staff_profile?.employment_status === employment_status)

  res.json({ success: true, data: filtered, meta: { total: count ?? 0 } })
}))

// GET /hrms/staff/stats - dashboard stats
router.get('/staff/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  const [{ count: total }, { data: profiles }, { count: pendingLeaves }, { count: openJobs }, { count: pendingApplications }] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school_id).neq('role', 'student'),
    supabase.from('staff_profiles').select('employment_status, department').eq('school_id', school_id),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'pending'),
    supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'open'),
    supabase.from('job_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id).in('status', ['applied', 'shortlisted', 'interview_scheduled']),
  ])

  const active = (profiles ?? []).filter(p => p.employment_status === 'active').length
  const onLeave = (profiles ?? []).filter(p => p.employment_status === 'on_leave').length
  const byDept: Record<string, number> = {}
  for (const p of profiles ?? []) {
    const d = p.department || 'Unassigned'
    byDept[d] = (byDept[d] ?? 0) + 1
  }

  res.json({
    success: true,
    data: {
      total_staff: total ?? 0,
      active_staff: active,
      on_leave: onLeave,
      pending_leave_requests: pendingLeaves ?? 0,
      open_positions: openJobs ?? 0,
      pending_applications: pendingApplications ?? 0,
      by_department: Object.entries(byDept).map(([department, count]) => ({ department, count })),
    },
  })
}))

// GET /hrms/staff/:user_id - full staff profile
router.get('/staff/:user_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const school_id = req.user!.school_id

  const { data: user, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, phone, created_at')
    .eq('id', user_id)
    .eq('school_id', school_id)
    .single()

  if (error || !user) return res.status(404).json({ success: false, error: 'Staff member not found' })

  const [{ data: profile }, { data: salary }, { data: leaveBalances }, { data: recentLeaves }, { data: recentPayslips }] = await Promise.all([
    supabase.from('staff_profiles').select('*, reporting_user:reporting_to(full_name)').eq('user_id', user_id).maybeSingle(),
    supabase.from('salary_structures').select('*').eq('user_id', user_id).eq('is_active', true).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('leave_balances').select('*, leave_types(name, code)').eq('user_id', user_id).eq('year', new Date().getFullYear()),
    supabase.from('leave_requests').select('*, leave_types(name, code)').eq('user_id', user_id).order('applied_at', { ascending: false }).limit(10),
    supabase.from('payslips').select('*').eq('user_id', user_id).order('year', { ascending: false }).order('month', { ascending: false }).limit(6),
  ])

  res.json({
    success: true,
    data: {
      ...user,
      profile,
      salary_structure: salary,
      leave_balances: leaveBalances ?? [],
      recent_leaves: recentLeaves ?? [],
      recent_payslips: recentPayslips ?? [],
    },
  })
}))

// PUT /hrms/staff/:user_id/profile - create/update staff profile
router.put('/staff/:user_id/profile', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const body = StaffProfileSchema.omit({ user_id: true }).parse(req.body)

    const cleanData = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]))

    const { data: existing } = await supabase.from('staff_profiles').select('id').eq('user_id', user_id).maybeSingle()

    let result
    if (existing) {
      result = await supabase.from('staff_profiles').update(cleanData).eq('user_id', user_id).select().single()
    } else {
      result = await supabase.from('staff_profiles').insert({ ...cleanData, school_id, user_id }).select().single()
    }

    if (result.error) return res.status(400).json({ success: false, error: result.error.message })
    res.json({ success: true, data: result.data })
  })
)

// ═══════════════════════════════════════════════════════════════
// LEAVE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Balance is "warn but allow" — a request can exceed remaining days (goes
// negative / effectively leave-without-pay) and still gets submitted and
// can still be approved. This just tells the caller whether that's the
// case so the UI can show a clear warning to both the applicant and the
// approver, instead of blocking outright.
async function getLeaveBalanceSnapshot(userId: string, leaveTypeId: string, year: number) {
  const [{ data: balance }, { data: leaveType }] = await Promise.all([
    supabase.from('leave_balances').select('total_days, used_days').eq('user_id', userId).eq('leave_type_id', leaveTypeId).eq('year', year).maybeSingle(),
    supabase.from('leave_types').select('default_days_per_year').eq('id', leaveTypeId).single(),
  ])
  const total_days = balance?.total_days ?? leaveType?.default_days_per_year ?? 0
  const used_days = balance?.used_days ?? 0
  return { total_days, used_days, remaining_days: total_days - used_days }
}

// GET /hrms/leave-types
router.get('/leave-types', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('leave_types').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// GET /hrms/leave-requests - list (admin sees all, staff sees own)
router.get('/leave-requests', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, user_id, page = '1', limit = '20' } = req.query
  const { from, to } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id
  const isAdmin = ['school_admin', 'principal'].includes(req.user!.role)

  let query = supabase
    .from('leave_requests')
    .select(`*, leave_types(name, code, is_paid), users:user_id(full_name, role), approver:approved_by(full_name)`, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('applied_at', { ascending: false })

  if (!isAdmin) query = query.eq('user_id', req.user!.id)
  else if (user_id) query = query.eq('user_id', user_id as string)
  if (status) query = query.eq('status', status as string)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  // Batch-attach exceeds_balance so the approver sees the warning in the
  // list itself, before opening/approving any single request. One query
  // per distinct year among the results, then matched precisely in JS —
  // cheaper than a per-row round trip.
  const years = [...new Set((data ?? []).map(r => new Date(r.from_date).getFullYear()))]
  const userIds = [...new Set((data ?? []).map(r => r.user_id))]
  const leaveTypeIds = [...new Set((data ?? []).map(r => r.leave_type_id))]
  const [{ data: allBalances }, { data: allLeaveTypes }] = years.length && userIds.length
    ? await Promise.all([
        supabase.from('leave_balances').select('user_id, leave_type_id, year, total_days, used_days').in('user_id', userIds).in('year', years),
        supabase.from('leave_types').select('id, default_days_per_year').in('id', leaveTypeIds),
      ])
    : [{ data: [] }, { data: [] }]

  const withWarnings = (data ?? []).map(r => {
    const year = new Date(r.from_date).getFullYear()
    const bal = (allBalances ?? []).find(b => b.user_id === r.user_id && b.leave_type_id === r.leave_type_id && b.year === year)
    const lt = (allLeaveTypes ?? []).find(t => t.id === r.leave_type_id)
    const total_days = bal?.total_days ?? lt?.default_days_per_year ?? 0
    const used_days = bal?.used_days ?? 0
    return { ...r, exceeds_balance: r.total_days > (total_days - used_days) }
  })

  res.json({ success: true, data: withWarnings, meta: { total: count ?? 0 } })
}))

// GET /hrms/leave-requests/stats
router.get('/leave-requests/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const [pending, approved, rejected] = await Promise.all([
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'pending'),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'approved'),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'rejected'),
  ])
  res.json({ success: true, data: { pending: pending.count ?? 0, approved: approved.count ?? 0, rejected: rejected.count ?? 0 } })
}))

// POST /hrms/leave-requests - apply for leave
router.post('/leave-requests', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = LeaveRequestSchema.parse(req.body)
  const school_id = req.user!.school_id

  if (body.to_date < body.from_date) {
    return res.status(400).json({ success: false, error: 'to_date must be on or after from_date' })
  }

  const nonWorkingSets = await getNonWorkingDaySets(school_id, body.from_date, body.to_date)
  const total_days = countWorkingDays(body.from_date, body.to_date, nonWorkingSets)
  if (total_days <= 0) {
    return res.status(400).json({ success: false, error: 'Selected range has no working days (all holidays/weekly-off)' })
  }

  // Balance is warn-but-allow: this never blocks submission, it just
  // tells the caller whether the request would run past what's left so
  // the UI can flag it up front instead of surprising anyone at approval.
  const year = new Date(body.from_date).getFullYear()
  const snapshot = await getLeaveBalanceSnapshot(req.user!.id, body.leave_type_id, year)
  const exceeds_balance = total_days > snapshot.remaining_days

  const { data, error } = await supabase
    .from('leave_requests')
    .insert({ ...body, total_days, school_id, user_id: req.user!.id })
    .select('*, leave_types(name, code)')
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // Start the Leave Approval Workflow for this new request.
  // Fire-and-forget: don't fail leave application if the workflow
  // fails to start — just log it so an admin can manually start it
  // later via POST /leave-requests/:id/start-workflow if needed.
  const wfResult = await startWorkflow({
    schoolId: school_id,
    workflowName: 'Leave Approval Workflow',
    entityType: 'leave_request',
    entityId: data.id,
    initiatedBy: req.user!.id,
  })

  if (!wfResult.success) {
    console.error(`Failed to start leave workflow for request ${data.id}:`, wfResult.error)
  }

  res.status(201).json({ success: true, data: { ...data, exceeds_balance, remaining_days_before: snapshot.remaining_days } })
}))

// PATCH /hrms/leave-requests/:id - approve/reject (delegates to workflow engine)
//
// This now delegates entirely to the workflow engine
// (workflow_instances / workflow_approvals / workflow_steps), so
// there is a single source of truth for approval state. The
// leave_requests.status / approved_by / approved_at columns are kept
// in sync for any UI/reporting that reads them directly, and the
// leave balance update logic is unchanged.
//
// Body: { status: 'approved' | 'rejected', rejection_reason?: string }
router.patch('/leave-requests/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { status, rejection_reason } = req.body
  const school_id = req.user!.school_id

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' })
  }

  const { data: leaveReq, error: fetchErr } = await supabase
    .from('leave_requests').select('*').eq('id', id).eq('school_id', school_id).single()
  if (fetchErr || !leaveReq) return res.status(404).json({ success: false, error: 'Leave request not found' })

  // Find the active workflow instance for this leave request
  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'leave_request')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instErr || !instance) {
    return res.status(404).json({
      success: false,
      error: 'No workflow found for this leave request. Use POST /leave-requests/:id/start-workflow first.',
    })
  }

  if (instance.status !== 'in_progress') {
    return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
  }

  const result = await actOnWorkflow({
    instanceId: instance.id,
    userId: req.user!.id,
    schoolId: school_id,
    status,
    notes: rejection_reason,
  })

  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error })
  }

  // Keep leave_requests.status / approved_by / approved_at in sync
  // for any reporting/UI that reads these columns directly.
  const update: any = {}
  if (result.completed) {
    update.status = result.instance.status // 'approved' | 'rejected'
    update.approved_by = req.user!.id
    update.approved_at = new Date().toISOString()
    if (status === 'rejected') update.rejection_reason = rejection_reason
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // If approved, update leave balance. Warn-but-allow: this still goes
  // through even if it pushes used_days past total_days — the response
  // carries that back so the approver sees it happened.
  let exceeds_balance = false
  if (result.completed && result.instance.status === 'approved') {
    const year = new Date(leaveReq.from_date).getFullYear()
    const { data: balance } = await supabase
      .from('leave_balances')
      .select('*')
      .eq('user_id', leaveReq.user_id)
      .eq('leave_type_id', leaveReq.leave_type_id)
      .eq('year', year)
      .maybeSingle()

    if (balance) {
      const newUsed = balance.used_days + leaveReq.total_days
      await supabase.from('leave_balances')
        .update({ used_days: newUsed })
        .eq('id', balance.id)
      exceeds_balance = newUsed > balance.total_days
    } else {
      const { data: lt } = await supabase.from('leave_types').select('default_days_per_year').eq('id', leaveReq.leave_type_id).single()
      const total_days_allowed = lt?.default_days_per_year ?? 0
      await supabase.from('leave_balances').insert({
        school_id, user_id: leaveReq.user_id, leave_type_id: leaveReq.leave_type_id, year,
        total_days: total_days_allowed, used_days: leaveReq.total_days,
      })
      exceeds_balance = leaveReq.total_days > total_days_allowed
    }
  }

  res.json({
    success: true,
    data: { ...data, workflow_instance: result.instance, completed: result.completed, exceeds_balance },
  })
}))

// DELETE /hrms/leave-requests/:id — withdraw (pending, by the requester
// or an admin) or cancel (approved, admin-only — reverses the balance
// deduction that approval made). Nothing to do for already-rejected or
// already-cancelled requests. Soft-cancels (status='cancelled') rather
// than deleting the row, so the history stays intact.
router.delete('/leave-requests/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { reason } = req.body
  const school_id = req.user!.school_id
  const isAdmin = ['school_admin', 'principal'].includes(req.user!.role)

  const { data: leaveReq, error: fetchErr } = await supabase
    .from('leave_requests').select('*').eq('id', id).eq('school_id', school_id).single()
  if (fetchErr || !leaveReq) return res.status(404).json({ success: false, error: 'Leave request not found' })

  if (leaveReq.status === 'pending') {
    if (leaveReq.user_id !== req.user!.id && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Only the requester or an admin can withdraw a pending request' })
    }
  } else if (leaveReq.status === 'approved') {
    if (!isAdmin) return res.status(403).json({ success: false, error: 'Only an admin can cancel an approved leave' })
  } else {
    return res.status(400).json({ success: false, error: `Cannot cancel a request that is already ${leaveReq.status}` })
  }

  // Cancel any in-progress workflow instance so it can't still be acted on.
  await supabase.from('workflow_instances')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('entity_type', 'leave_request').eq('entity_id', id).eq('status', 'in_progress')

  // Reverse the balance deduction if this was already approved.
  if (leaveReq.status === 'approved') {
    const year = new Date(leaveReq.from_date).getFullYear()
    const { data: balance } = await supabase
      .from('leave_balances').select('*')
      .eq('user_id', leaveReq.user_id).eq('leave_type_id', leaveReq.leave_type_id).eq('year', year)
      .maybeSingle()
    if (balance) {
      await supabase.from('leave_balances')
        .update({ used_days: Math.max(0, balance.used_days - leaveReq.total_days) })
        .eq('id', balance.id)
    }
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled', rejection_reason: reason || null })
    .eq('id', id)
    .select()
    .single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  res.json({ success: true, data })
}))

// GET /hrms/leave-requests/:id/workflow-status — pipeline UI
router.get('/leave-requests/:id/workflow-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const status = await getWorkflowStatus('leave_request', id, school_id)

  if (!status) {
    return res.json({ success: true, data: null, message: 'No workflow started for this leave request' })
  }

  res.json({ success: true, data: status })
}))

// POST /hrms/leave-requests/:id/start-workflow — backfill for old requests
router.post('/leave-requests/:id/start-workflow', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: leaveReq, error: lrErr } = await supabase
      .from('leave_requests').select('id').eq('id', id).eq('school_id', school_id).single()

    if (lrErr || !leaveReq) return res.status(404).json({ success: false, error: 'Leave request not found' })

    const result = await startWorkflow({
      schoolId: school_id,
      workflowName: 'Leave Approval Workflow',
      entityType: 'leave_request',
      entityId: id,
      initiatedBy: req.user!.id,
    })

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    res.json({ success: true, data: result.instance })
  })
)

// GET /hrms/leave-balances/:user_id
router.get('/leave-balances/:user_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const year = Number(req.query.year) || new Date().getFullYear()
  const school_id = req.user!.school_id

  const { data: leaveTypes } = await supabase.from('leave_types').select('*').eq('school_id', school_id)
  const { data: balances } = await supabase.from('leave_balances').select('*').eq('user_id', user_id).eq('year', year)

  const result = (leaveTypes ?? []).map(lt => {
    const bal = (balances ?? []).find(b => b.leave_type_id === lt.id)
    return {
      leave_type_id: lt.id,
      name: lt.name,
      code: lt.code,
      total_days: bal?.total_days ?? lt.default_days_per_year,
      used_days: bal?.used_days ?? 0,
      remaining_days: (bal?.total_days ?? lt.default_days_per_year) - (bal?.used_days ?? 0),
    }
  })

  res.json({ success: true, data: result })
}))

// ═══════════════════════════════════════════════════════════════
// PAYROLL
// ═══════════════════════════════════════════════════════════════

// GET /hrms/salary-structure/:user_id
router.get('/salary-structure/:user_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const { data, error } = await supabase
    .from('salary_structures').select('*').eq('user_id', user_id).eq('is_active', true)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// PUT /hrms/salary-structure - create/update salary structure
router.put('/salary-structure', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = SalaryStructureSchema.parse(req.body)
    const school_id = req.user!.school_id

    // Deactivate old structures
    await supabase.from('salary_structures').update({ is_active: false }).eq('user_id', body.user_id).eq('is_active', true)

    const { data, error } = await supabase
      .from('salary_structures')
      .insert({ ...body, school_id, created_by: req.user!.id, is_active: true })
      .select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// GET /hrms/payslips - list (filterable by month/year/user)
router.get('/payslips', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, month, year, payment_status, page = '1', limit = '50' } = req.query
  const { from, to } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id
  const isAdmin = ['school_admin', 'principal', 'accountant'].includes(req.user!.role)

  let query = supabase
    .from('payslips')
    .select(`*, users:user_id(full_name, role)`, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  if (!isAdmin) query = query.eq('user_id', req.user!.id)
  else if (user_id) query = query.eq('user_id', user_id as string)
  if (month) query = query.eq('month', Number(month))
  if (year) query = query.eq('year', Number(year))
  if (payment_status) query = query.eq('payment_status', payment_status as string)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data, meta: { total: count ?? 0 } })
}))

// POST /hrms/payslips/generate - generate payslips for a month for all active staff
router.post('/payslips/generate', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year, user_ids } = req.body
    const school_id = req.user!.school_id

    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' })

    // Get target users (active staff with salary structures)
    let salaryQuery = supabase.from('salary_structures').select('*, users:user_id(full_name)').eq('school_id', school_id).eq('is_active', true)
    if (user_ids?.length) salaryQuery = salaryQuery.in('user_id', user_ids)
    const { data: salaries } = await salaryQuery

    if (!salaries?.length) return res.status(400).json({ success: false, error: 'No salary structures found' })

    const generated = []
    for (const s of salaries) {
      const gross = s.basic_salary + (s.hra ?? 0) + (s.da ?? 0) + (s.conveyance_allowance ?? 0) + (s.medical_allowance ?? 0) + (s.other_allowances ?? 0)
      const totalDeductions = (s.pf_deduction ?? 0) + (s.professional_tax ?? 0) + (s.other_deductions ?? 0)
      const net = gross - totalDeductions

      const payslipData = {
        school_id, user_id: s.user_id, month, year,
        basic_salary: s.basic_salary, hra: s.hra, da: s.da,
        conveyance_allowance: s.conveyance_allowance, medical_allowance: s.medical_allowance,
        other_allowances: s.other_allowances, gross_salary: gross,
        pf_deduction: s.pf_deduction, professional_tax: s.professional_tax, other_deductions: s.other_deductions,
        lop_days: 0, lop_amount: 0, total_deductions: totalDeductions, net_salary: net,
        payment_status: 'pending', generated_by: req.user!.id,
      }

      const { data, error } = await supabase.from('payslips').upsert(payslipData, { onConflict: 'user_id,month,year' }).select().single()
      if (!error) generated.push(data)
    }

    // Staff with no active salary structure get silently skipped above —
    // surface exactly who, so "why did only N payslips get generated"
    // isn't a mystery. Not scoped by user_ids since that param is only
    // used to narrow which of the eligible staff to run, not to exclude
    // ineligible ones from this notice.
    const coveredIds = new Set((salaries ?? []).map(s => s.user_id))
    const { data: allStaff } = await supabase.from('users').select('id, full_name, role').eq('school_id', school_id).neq('role', 'student')
    const skipped = (allStaff ?? [])
      .filter(u => !coveredIds.has(u.id))
      .map(u => ({ user_id: u.id, full_name: u.full_name, role: u.role }))

    res.json({ success: true, data: generated, count: generated.length, skipped })
  })
)

router.post('/payslips/:id/approve', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: payslip } = await supabase.from('payslips').select('payment_status').eq('id', id).eq('school_id', school_id).single()
    if (!payslip) return res.status(404).json({ success: false, error: 'Payslip not found' })

    if (payslip.payment_status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot approve a payslip with status '${payslip.payment_status}'` })
    }

    const { data, error } = await supabase
      .from('payslips')
      .update({ payment_status: 'approved', approved_by: req.user!.id, approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('school_id', school_id)
      .select()
      .single()

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ── PATCH /payslips/:id — UPDATED with approval guard ──────────
// REPLACE your existing PATCH /payslips/:id handler with this version.
// Only change: marking payment_status='paid' now requires the
// payslip to already be 'approved' (by Principal). Everything else
// (lop recalculation etc) is unchanged.
router.patch('/payslips/:id', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { payment_status, payment_date, payment_mode, remarks, lop_days, lop_amount } = req.body
    const school_id = req.user!.school_id

    if (payment_status === 'paid') {
      const { data: existing } = await supabase.from('payslips').select('payment_status').eq('id', id).eq('school_id', school_id).single()
      if (!existing) return res.status(404).json({ success: false, error: 'Payslip not found' })
      if (existing.payment_status !== 'approved') {
        return res.status(400).json({
          success: false,
          error: `Payslip must be approved by Principal before marking as paid (current status: '${existing.payment_status}')`,
        })
      }
    }

    const update: any = {}
    if (payment_status) update.payment_status = payment_status
    if (payment_date) update.payment_date = payment_date
    if (payment_mode) update.payment_mode = payment_mode
    if (remarks !== undefined) update.remarks = remarks
    if (lop_days !== undefined) update.lop_days = lop_days
    if (lop_amount !== undefined) update.lop_amount = lop_amount

    if (lop_amount !== undefined) {
      const { data: existing } = await supabase.from('payslips').select('gross_salary, total_deductions').eq('id', id).single()
      if (existing) {
        update.net_salary = existing.gross_salary - existing.total_deductions - lop_amount
      }
    }

    const { data, error } = await supabase.from('payslips').update(update).eq('id', id).eq('school_id', school_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// GET /hrms/payroll/summary - month-wise summary
router.get('/payroll/summary', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year } = req.query
    const school_id = req.user!.school_id
    const m = Number(month) || new Date().getMonth() + 1
    const y = Number(year) || new Date().getFullYear()

    const { data, error } = await supabase.from('payslips').select('gross_salary, total_deductions, net_salary, payment_status').eq('school_id', school_id).eq('month', m).eq('year', y)
    if (error) return res.status(500).json({ success: false, error: error.message })

    const summary = {
      month: m, year: y,
      // Payslips generated this period — NOT the school's total staff
      // count. Staff with no salary structure never get a payslip, so
      // this number can legitimately be far smaller than headcount.
      payslip_count: data?.length ?? 0,
      total_gross: data?.reduce((s, p) => s + Number(p.gross_salary), 0) ?? 0,
      total_deductions: data?.reduce((s, p) => s + Number(p.total_deductions), 0) ?? 0,
      total_net: data?.reduce((s, p) => s + Number(p.net_salary), 0) ?? 0,
      paid_count: data?.filter(p => p.payment_status === 'paid').length ?? 0,
      pending_count: data?.filter(p => p.payment_status === 'pending').length ?? 0,
    }
    res.json({ success: true, data: summary })
  })
)

// ═══════════════════════════════════════════════════════════════
// STAFF ATTENDANCE
// ═══════════════════════════════════════════════════════════════

router.get('/attendance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { date, user_id, month, year } = req.query
  const school_id = req.user!.school_id

  let query = supabase.from('staff_attendance').select('*, users:user_id(full_name, role)').eq('school_id', school_id)

  if (date) query = query.eq('date', date as string)
  if (user_id) query = query.eq('user_id', user_id as string)
  if (month && year) {
    const m = String(month).padStart(2, '0')
    query = query.gte('date', `${year}-${m}-01`).lte('date', `${year}-${m}-31`)
  }

  const { data, error } = await query.order('date', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/attendance', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { records, date } = req.body
    const school_id = req.user!.school_id
    if (!date || !records?.length) return res.status(400).json({ success: false, error: 'date and records required' })

    const rows = records.map((r: any) => ({
      school_id, user_id: r.user_id, date, status: r.status,
      check_in: r.check_in || null, check_out: r.check_out || null,
      remarks: r.remarks || null, marked_by: req.user!.id,
    }))

    const { data, error } = await supabase.from('staff_attendance').upsert(rows, { onConflict: 'user_id,date' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data, count: rows.length })
  })
)

// GET /hrms/attendance/report — monthly per-staff rollup, same shape and
// working-days math as the student attendance report (shared academic
// calendar: weekly-off + holidays). department is an optional filter,
// staff's equivalent of "class-wise" scoping for students.
//
// Approved leave is excluded from a staff member's OWN denominator, not
// just from their numerator — a day they were legitimately on approved
// leave shouldn't drag their % down the way an unexplained absence
// would. This is per-user: the shared `working_days` figure (school was
// open, other staff got marked) is unaffected for everyone else. Two
// signals feed this: an explicit 'on_leave' staff_attendance row for
// that day, and any leave_requests row with status='approved' overlapping
// the report range (covers the common case where nobody bothers marking
// daily attendance for someone already on approved leave).
router.get('/attendance/report', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { month, year, department, from, to } = req.query
  const school_id = req.user!.school_id

  const now = new Date()
  const y = year ? Number(year) : now.getFullYear()
  const m = month ? Number(month) : now.getMonth() + 1
  const mStr = String(m).padStart(2, '0')
  const fromDate = (from as string) || `${y}-${mStr}-01`
  const toDate = (to as string) || `${y}-${mStr}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

  const { data: staffRaw, error: staffErr } = await supabase
    .from('users')
    .select('id, full_name, role, staff_profiles!staff_profiles_user_id_fkey(department)')
    .eq('school_id', school_id).neq('role', 'student').order('full_name')
  if (staffErr) return res.status(500).json({ success: false, error: staffErr.message })

  let staff = (staffRaw ?? []).map((u: any) => ({ id: u.id, full_name: u.full_name, role: u.role, department: u.staff_profiles?.[0]?.department ?? null }))
  if (department) staff = staff.filter(s => s.department === department)

  const nonWorkingSets = await getNonWorkingDaySets(school_id, fromDate, toDate)

  const userIds = staff.map(s => s.id)
  const [{ data: rawRecords, error: attErr }, { data: approvedLeaves, error: leaveErr }] = await Promise.all([
    userIds.length
      ? supabase.from('staff_attendance').select('user_id, date, status')
          .eq('school_id', school_id).in('user_id', userIds).gte('date', fromDate).lte('date', toDate)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from('leave_requests').select('user_id, from_date, to_date')
          .eq('school_id', school_id).eq('status', 'approved').in('user_id', userIds)
          .lte('from_date', toDate).gte('to_date', fromDate)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })
  if (leaveErr) return res.status(500).json({ success: false, error: leaveErr.message })

  const records = (rawRecords ?? []).filter(r => isWorkingDate(r.date, nonWorkingSets))
  const workingDaySet = new Set(records.map(r => r.date))
  const workingDays = workingDaySet.size

  const byUser = new Map<string, { present: number; absent: number; half_day: number }>()
  const leaveDatesByUser = new Map<string, Set<string>>()
  const addLeaveDate = (userId: string, date: string) => {
    if (!leaveDatesByUser.has(userId)) leaveDatesByUser.set(userId, new Set())
    leaveDatesByUser.get(userId)!.add(date)
  }

  for (const r of records) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { present: 0, absent: 0, half_day: 0 })
    const counts = byUser.get(r.user_id)!
    if (r.status === 'present') counts.present++
    else if (r.status === 'absent') counts.absent++
    else if (r.status === 'half_day') counts.half_day++
    else if (r.status === 'on_leave') addLeaveDate(r.user_id, r.date)
  }

  for (const lr of approvedLeaves ?? []) {
    const start = lr.from_date < fromDate ? fromDate : lr.from_date
    const end = lr.to_date > toDate ? toDate : lr.to_date
    for (const key of dateRangeStrings(start, end)) {
      if (isWorkingDate(key, nonWorkingSets)) addLeaveDate(lr.user_id, key)
    }
  }

  const data = staff.map(s => {
    const counts = byUser.get(s.id) ?? { present: 0, absent: 0, half_day: 0 }
    const leaveDates = leaveDatesByUser.get(s.id) ?? new Set<string>()
    // Only subtract leave days that were actually working days to begin
    // with — a leave date that fell on a holiday/weekly-off was never
    // in the denominator, so it can't be subtracted twice. This also
    // becomes the displayed on_leave count, so it reflects BOTH signals
    // (explicit staff_attendance mark and approved leave_requests), not
    // just whichever one happened to have a daily attendance row.
    const on_leave = [...leaveDates].filter(d => workingDaySet.has(d)).length
    const effectiveWorkingDays = Math.max(0, workingDays - on_leave)
    const percentage = effectiveWorkingDays > 0 ? Math.round((counts.present / effectiveWorkingDays) * 100) : 0
    return { user_id: s.id, full_name: s.full_name, role: s.role, department: s.department, ...counts, on_leave, working_days: effectiveWorkingDays, percentage }
  })

  res.json({
    success: true,
    data: { staff: data, working_days: workingDays, holidays_in_month: nonWorkingSets.holidays.size, month: m, year: y },
  })
}))

// ═══════════════════════════════════════════════════════════════
// RECRUITMENT
// ═══════════════════════════════════════════════════════════════

const APPLICATION_STAGES = ['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined', 'rejected', 'withdrawn']

// GET /hrms/job-postings
router.get('/job-postings', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('job_postings')
    .select('*, application_count:job_applications(count)')
    .eq('school_id', school_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  const result = (data ?? []).map((j: any) => ({ ...j, application_count: j.application_count?.[0]?.count ?? 0 }))
  res.json({ success: true, data: result })
}))

// POST /hrms/job-postings
router.post('/job-postings', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = JobPostingSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data, error } = await supabase.from('job_postings').insert({ ...body, school_id, posted_by: req.user!.id }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// PATCH /hrms/job-postings/:id
router.patch('/job-postings/:id', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, vacancies } = req.body
    const update: any = {}
    if (status) update.status = status
    if (vacancies !== undefined) update.vacancies = vacancies
    const { data, error } = await supabase.from('job_postings').update(update).eq('id', id).eq('school_id', req.user!.school_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// GET /hrms/applications - recruitment pipeline (kanban data)
router.get('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { job_posting_id, status, search } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('job_applications')
    .select('*, job_postings(title, department), assigned_user:assigned_to(full_name)')
    .eq('school_id', school_id)
    .order('created_at', { ascending: false })

  if (job_posting_id) query = query.eq('job_posting_id', job_posting_id as string)
  if (status) query = query.eq('status', status as string)
  if (search) query = query.or(`candidate_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// GET /hrms/applications/stats - pipeline counts
router.get('/applications/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const counts = await Promise.all(
    APPLICATION_STAGES.map(s =>
      supabase.from('job_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', s)
        .then(({ count }) => ({ status: s, count: count ?? 0 }))
    )
  )
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  res.json({ success: true, data: { by_status: counts, total } })
}))

// GET /hrms/applications/:id
router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const { data, error } = await supabase
    .from('job_applications')
    .select('*, job_postings(title, department, designation), assigned_user:assigned_to(full_name), application_status_history(*, users:changed_by(full_name))')
    .eq('id', id).eq('school_id', school_id).single()

  if (error || !data) return res.status(404).json({ success: false, error: 'Application not found' })
  res.json({ success: true, data })
}))

// POST /hrms/applications - new candidate application
router.post('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = JobApplicationSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { count } = await supabase.from('job_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
  const appNumber = `CAND${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data, error } = await supabase
    .from('job_applications')
    .insert({ ...body, school_id, application_number: appNumber, assigned_to: req.user!.id })
    .select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  await supabase.from('application_status_history').insert({ application_id: data.id, status: 'applied', changed_by: req.user!.id })

  res.status(201).json({ success: true, data })
}))

// PATCH /hrms/applications/:id - move pipeline stage / update
const VALID_STAFF_ROLES = ['school_admin', 'principal', 'teacher', 'accountant', 'counselor'] as const

router.patch('/applications/:id', requireRole('school_admin', 'principal', 'counselor'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, interview_date, interview_notes, rating, notes, role, email } = req.body
    const school_id = req.user!.school_id

    if (status && !APPLICATION_STAGES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' })
    }

    // Approval gate: only school_admin/principal can authorize sending
    // an offer, and only from the 'selected' stage.
    if (status === 'offer_sent') {
      if (!['school_admin', 'principal'].includes(req.user!.role)) {
        return res.status(403).json({ success: false, error: 'Only School Admin or Principal can approve sending an offer' })
      }
      const { data: existing } = await supabase.from('job_applications').select('status').eq('id', id).eq('school_id', school_id).single()
      if (!existing) return res.status(404).json({ success: false, error: 'Application not found' })
      if (existing.status !== 'selected') {
        return res.status(400).json({ success: false, error: `Candidate must be 'selected' before an offer can be sent (current: '${existing.status}')` })
      }
    }

    // 'joined' requires a valid role AND an email on file (email is
    // the login identifier for their new team-member account).
    if (status === 'joined') {
      if (!role || !VALID_STAFF_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          error: `A valid role is required when marking a candidate as joined. Must be one of: ${VALID_STAFF_ROLES.join(', ')}`,
        })
      }

      const { data: appCheck } = await supabase.from('job_applications').select('email').eq('id', id).eq('school_id', school_id).single()
      const effectiveEmail = email ?? appCheck?.email
      if (!effectiveEmail) {
        return res.status(400).json({
          success: false,
          error: 'This candidate has no email on file. Add an email before marking them as joined.',
        })
      }
    }

    const update: any = {}
    if (status) update.status = status
    if (interview_date !== undefined) update.interview_date = interview_date
    if (interview_notes !== undefined) update.interview_notes = interview_notes
    if (rating !== undefined) update.rating = rating
    if (notes !== undefined) update.notes = notes
    if (email !== undefined) update.email = email
    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase.from('job_applications').update(update).eq('id', id).eq('school_id', school_id).select('*, job_postings(title, department, designation)').single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    if (status) {
      await supabase.from('application_status_history').insert({
        application_id: id, status,
        notes: status === 'offer_sent' ? `Offer approved by ${req.user!.full_name ?? req.user!.role}` : (interview_notes || notes),
        changed_by: req.user!.id,
      })
    }

    let newUserId: string | null = null

    if (status === 'joined') {
      const { data: existingUser } = await supabase.from('users').select('id').eq('email', data.email).eq('school_id', school_id).maybeSingle()

      if (!existingUser && data.email) {
        const { data: newUser, error: userErr } = await supabase.from('users').insert({
          id: crypto.randomUUID(),
          school_id,
          full_name: data.candidate_name,
          email: data.email,
          phone: data.phone,
          role,
          is_active: true,
        }).select().single()

        if (userErr) {
          return res.status(400).json({ success: false, error: `Application updated but failed to create team member: ${userErr.message}` })
        }

        if (newUser) {
          newUserId = newUser.id
          await supabase.from('staff_profiles').insert({
            school_id,
            user_id: newUser.id,
            designation: data.current_designation || data.job_postings?.designation || null,
            department: data.job_postings?.department || null,
            date_of_joining: new Date().toISOString().split('T')[0],
            employment_type: 'full_time',
            employment_status: 'active',
            phone: data.phone || null,
          })
          await assignDefaultUserRole(newUser.id, school_id, role)
        }
      } else if (existingUser) {
        newUserId = existingUser.id
      }
    }

    res.json({ success: true, data, new_user_id: newUserId })
  })
)
// ═══════════════════════════════════════════════════════════════
// ROLE PERMISSIONS (legacy table — superseded by /api/rbac/roles/:id/permissions
// and role_permissions_v2. Kept for backward compatibility only;
// no longer used by the frontend after the RBAC unification.)
// ═══════════════════════════════════════════════════════════════

router.get('/role-permissions', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('role_permissions').select('*').eq('school_id', req.user!.school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.put('/role-permissions', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { permissions } = req.body // array of { role, module, can_view, can_create, can_edit, can_delete }
    const school_id = req.user!.school_id
    if (!Array.isArray(permissions)) return res.status(400).json({ success: false, error: 'permissions array required' })

    const rows = permissions.map((p: any) => ({ ...p, school_id }))
    const { data, error } = await supabase.from('role_permissions').upsert(rows, { onConflict: 'school_id,role,module' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════

router.get('/reports/headcount', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data, error } = await supabase.from('staff_profiles').select('department, employment_type, employment_status').eq('school_id', school_id)
  if (error) return res.status(500).json({ success: false, error: error.message })

  const byDept: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  for (const p of data ?? []) {
    const d = p.department || 'Unassigned'
    byDept[d] = (byDept[d] ?? 0) + 1
    byType[p.employment_type] = (byType[p.employment_type] ?? 0) + 1
    byStatus[p.employment_status] = (byStatus[p.employment_status] ?? 0) + 1
  }

  res.json({
    success: true,
    data: {
      by_department: Object.entries(byDept).map(([k, v]) => ({ name: k, count: v })),
      by_employment_type: Object.entries(byType).map(([k, v]) => ({ name: k, count: v })),
      by_status: Object.entries(byStatus).map(([k, v]) => ({ name: k, count: v })),
    },
  })
}))

router.get('/reports/leave-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { year } = req.query
  const school_id = req.user!.school_id
  const y = Number(year) || new Date().getFullYear()

  const { data, error } = await supabase
    .from('leave_requests')
    .select('status, total_days, leave_types(name), users:user_id(full_name)')
    .eq('school_id', school_id)
    .gte('from_date', `${y}-01-01`)
    .lte('from_date', `${y}-12-31`)

  if (error) return res.status(500).json({ success: false, error: error.message })

  const approved = (data ?? []).filter((d: any) => d.status === 'approved')
  const totalDaysTaken = approved.reduce((s: number, d: any) => s + Number(d.total_days), 0)

  const byType: Record<string, number> = {}
  for (const d of approved) {
    const name = (d as any).leave_types?.name ?? 'Unknown'
    byType[name] = (byType[name] ?? 0) + Number(d.total_days)
  }

  res.json({
    success: true,
    data: {
      year: y,
      total_requests: data?.length ?? 0,
      approved: approved.length,
      total_days_taken: totalDaysTaken,
      by_leave_type: Object.entries(byType).map(([k, v]) => ({ name: k, days: v })),
    },
  })
}))

router.get('/reports/payroll-summary', requireRole('school_admin', 'principal', 'accountant'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year } = req.query
    const school_id = req.user!.school_id
    const y = Number(year) || new Date().getFullYear()

    const { data, error } = await supabase
      .from('payslips')
      .select('month, gross_salary, total_deductions, net_salary, payment_status')
      .eq('school_id', school_id)
      .eq('year', y)

    if (error) return res.status(500).json({ success: false, error: error.message })

    const byMonth: Record<number, any> = {}
    for (const p of data ?? []) {
      if (!byMonth[p.month]) byMonth[p.month] = { month: p.month, gross: 0, deductions: 0, net: 0, count: 0 }
      byMonth[p.month].gross += Number(p.gross_salary)
      byMonth[p.month].deductions += Number(p.total_deductions)
      byMonth[p.month].net += Number(p.net_salary)
      byMonth[p.month].count += 1
    }

    res.json({ success: true, data: { year: y, monthly: Object.values(byMonth).sort((a: any, b: any) => a.month - b.month) } })
  })
)

// ═══════════════════════════════════════════════════════════════
// CURRENT USER'S PERMISSIONS (legacy — for old frontend route/menu
// guarding via role_permissions table. Superseded by
// /api/rbac/permissions/me, which is now used by the frontend's
// usePermissions() hook. Kept for backward compatibility.)
// ═══════════════════════════════════════════════════════════════
router.get('/permissions/me', asyncHandler(async (req: AuthRequest, res: Response) => {
  const perms = await getPermissionsForRole(req.user!.school_id, req.user!.role)
  res.json({ success: true, data: { role: req.user!.role, permissions: perms } })
}))

export default router