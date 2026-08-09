import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { authenticate, AuthRequest, invalidateUserProfile } from '../../shared/middleware/auth'
import { requirePermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler, getPagination, NON_STAFF_ROLES } from '../../shared/utils/helpers'
import { getPermissionsForRole } from '../../shared/middleware/permissions'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { assignDefaultUserRole, ensureExitWorkflowDefinition, ensureRegularizationWorkflowDefinition, ensureCompOffWorkflowDefinition, ensureLeaveApprovalWorkflowDefinition } from '../rbac/seed'
import { getNonWorkingDaySets, countWorkingDays, isWorkingDate, dateRangeStrings, toLocalDateStr } from '../../shared/utils/academicCalendar'
import { createNotification, createNotifications } from '../../shared/utils/notifications'
import { runLeaveAccrual, runLeaveYearEnd } from '../../shared/utils/leavePolicy'
import { runHrAlerts } from '../../shared/utils/hrAlerts'

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
  shift_id: z.string().uuid().nullable().optional(),
  leave_delegate_id: z.string().uuid().nullable().optional(),
})

const StaffShiftSchema = z.object({
  name: z.string().min(1),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  off_days: z.array(z.number().int().min(0).max(6)).default([0]),
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

const LeaveTypeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  default_days_per_year: z.number().min(0).default(0),
  is_paid: z.boolean().default(true),
  carry_forward: z.boolean().default(false),
  accrual_frequency: z.enum(['annual', 'monthly']).default('annual'),
  max_carry_forward_days: z.number().min(0).default(0),
  is_encashable: z.boolean().default(false),
  is_comp_off: z.boolean().default(false),
})

const CompOffRequestSchema = z.object({
  worked_date: z.string(),
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

// Same earnings/deductions shape as SalaryStructureSchema minus user_id
// (the promote route already has it from the URL param) — kept as its
// own schema rather than reusing SalaryStructureSchema.omit() so the two
// can drift independently if payroll fields change later.
const PromoteTransferSchema = z.object({
  designation: z.string().optional(),
  department: z.string().optional(),
  branch: z.string().optional(),
  effective_from: z.string(),
  reason: z.string().optional(),
  salary: z.object({
    basic_salary: z.number(),
    hra: z.number().optional(),
    da: z.number().optional(),
    conveyance_allowance: z.number().optional(),
    medical_allowance: z.number().optional(),
    other_allowances: z.number().optional(),
    pf_deduction: z.number().optional(),
    professional_tax: z.number().optional(),
    other_deductions: z.number().optional(),
  }).optional(),
})

const InitiateExitSchema = z.object({
  resignation_date: z.string(),
  last_working_day: z.string(),
  notice_period_days: z.number().optional(),
  reason: z.string().optional(),
})

const DEFAULT_EXIT_CHECKLIST = [
  'ID card returned',
  'Laptop/asset returned',
  'Access revoked',
  'Library dues cleared',
  'Handover completed',
]

// ═══════════════════════════════════════════════════════════════
// STAFF DIRECTORY
// ═══════════════════════════════════════════════════════════════

// GET /hrms/staff - list all staff with profiles
// Previously had no gate — any authenticated user, including a parent
// or student account, could browse the full staff directory (email,
// phone, staff_profiles details).
router.get('/staff', requirePermissionV2('staff.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    .neq('role', 'parent')
    .range(from, to)
    .order('full_name')

  if (role) query = query.eq('role', role as string)
  if (search) query = query.ilike('full_name', `%${search}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  let filtered = data ?? []
  // staff_profiles.user_id is UNIQUE, so PostgREST embeds it as a single
  // object, not an array — but that shape isn't guaranteed stable across
  // schema-cache reloads (seen flip mid-session), so normalize either way
  // rather than assuming one.
  filtered = filtered.map((u: any) => {
    const profile = Array.isArray(u.staff_profiles) ? u.staff_profiles[0] : u.staff_profiles
    return { ...u, staff_profile: profile ?? null, staff_profiles: undefined }
  })

  if (department) filtered = filtered.filter((u: any) => u.staff_profile?.department === department)
  if (employment_status) filtered = filtered.filter((u: any) => u.staff_profile?.employment_status === employment_status)

  // Optional department-scoped role assignment (user_roles.department_scope):
  // a role can be granted restricted to one department instead of the
  // whole school. requirePermissionV2 already confirmed staff.view;
  // this narrows the result set further when the caller's assignment
  // carries a scope. Cheap re-fetch — resolved permissions are cached.
  const { departmentScope } = await getPermissionsForUser(req.user!.id, school_id)
  if (departmentScope) filtered = filtered.filter((u: any) => u.staff_profile?.department === departmentScope)

  res.json({ success: true, data: filtered, meta: { total: count ?? 0 } })
}))

// GET /hrms/staff/org-chart — flat list for client-side tree assembly.
// staff_profiles.reporting_to has existed since the baseline schema but
// nothing ever set it (no UI) or read it outside a single joined field
// on GET /staff/:user_id — this is the first place it's used to build
// an actual hierarchy, replacing the flat department-only grouping on
// the Staff Directory page as the real "see the structure" view.
router.get('/staff/org-chart', requirePermissionV2('staff.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, staff_profiles!staff_profiles_user_id_fkey(designation, department, reporting_to, photo_url)')
    .eq('school_id', school_id).neq('role', 'student').neq('role', 'parent').order('full_name')
  if (error) return res.status(500).json({ success: false, error: error.message })

  const result = (data ?? []).map((u: any) => {
    const profile = Array.isArray(u.staff_profiles) ? u.staff_profiles[0] : u.staff_profiles
    return { id: u.id, full_name: u.full_name, designation: profile?.designation ?? null, department: profile?.department ?? null, reporting_to: profile?.reporting_to ?? null, photo_url: profile?.photo_url ?? null }
  })
  res.json({ success: true, data: result })
}))

// POST /hrms/hr-alerts/run — manual trigger for the daily probation/
// document-expiry/work-anniversary sweep (index.ts runs it unattended
// every morning). Same reasoning as the other manual-trigger routes:
// a long-lived in-process cron isn't guaranteed to fire on every host.
router.post('/hr-alerts/run', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await runHrAlerts(req.user!.school_id)
  res.json({ success: true, data: result })
}))

// GET /hrms/staff/stats - dashboard stats
router.get('/staff/stats', requirePermissionV2('staff.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  const today = toLocalDateStr(new Date())
  const [{ count: total }, { data: profiles }, { count: pendingLeaves }, { count: openJobs }, { count: pendingApplications }, { data: onLeaveRows }] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school_id).neq('role', 'student').neq('role', 'parent'),
    supabase.from('staff_profiles').select('employment_status, department, probation_end_date').eq('school_id', school_id),
    supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'pending'),
    supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'open'),
    supabase.from('job_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id).in('status', ['applied', 'shortlisted', 'interview_scheduled']),
    // "On Leave" must mean approved leave covering TODAY, not the static
    // employment_status='on_leave' field — that field is only ever set
    // manually via the profile's Employment Status dropdown and has no
    // relationship to actual leave_requests, so it goes stale the moment
    // someone's leave ends and nobody remembers to flip it back.
    supabase.from('leave_requests').select('user_id').eq('school_id', school_id).eq('status', 'approved').lte('from_date', today).gte('to_date', today),
  ])

  // Active = everyone NOT in a terminal status (resigned/suspended/
  // terminated) — computed as total minus those, not "count rows whose
  // status literally equals 'active'". That second form silently drops
  // anyone with no staff_profiles row at all (e.g. a School Admin
  // account that never went through staff onboarding) even though
  // they're clearly still active, and it's inconsistent with the
  // Directory table's own fallback (`employment_status ?? 'active'`)
  // for the exact same missing-profile case.
  const NON_ACTIVE_STATUSES = new Set(['resigned', 'suspended', 'terminated'])
  const nonActiveCount = (profiles ?? []).filter(p => NON_ACTIVE_STATUSES.has(p.employment_status)).length
  const active = (total ?? 0) - nonActiveCount
  const onLeave = new Set((onLeaveRows ?? []).map(r => r.user_id)).size
  // "Ending soon" includes already-overdue probation too — that's the
  // more urgent case, not one to silently drop from the count.
  const thirtyDaysOut = toLocalDateStr(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  const probationEndingSoon = (profiles ?? []).filter(p => p.probation_end_date && p.probation_end_date <= thirtyDaysOut).length
  const { count: documentsExpiringSoon } = await supabase
    .from('staff_documents').select('*', { count: 'exact', head: true })
    .eq('school_id', school_id).not('expiry_date', 'is', null).lte('expiry_date', thirtyDaysOut)
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
      probation_ending_soon: probationEndingSoon,
      documents_expiring_soon: documentsExpiringSoon ?? 0,
      by_department: Object.entries(byDept).map(([department, count]) => ({ department, count })),
    },
  })
}))

// GET /hrms/staff/:user_id - full staff profile
// Previously had no gate — any authenticated user could pull any other
// staff member's full profile including salary structure, leave
// balances and recent payslips, by user_id.
router.get('/staff/:user_id', requirePermissionV2('staff.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

  const { departmentScope } = await getPermissionsForUser(req.user!.id, school_id)
  if (departmentScope && profile?.department !== departmentScope) {
    return res.status(403).json({ success: false, error: 'This staff member is outside your assigned department' })
  }

  // Audit sensitive reads: this response carries bank/PAN details and
  // salary structure. Only worth logging when someone views ANOTHER
  // staff member's record — not their own. Best-effort, matches the
  // fire-and-forget notification idiom elsewhere in this file.
  if (user_id !== req.user!.id) {
    supabase.from('audit_logs').insert({
      school_id, user_id: req.user!.id, action: 'VIEW', entity_type: 'staff_salary_bank_details', entity_id: user_id,
      ip_address: req.ip ?? null,
    }).then(({ error: auditErr }) => { if (auditErr) console.error('Failed to write audit log:', auditErr.message) })
  }

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
//
// designation/department are deliberately stripped here — every change
// to those two fields must go through POST /staff/:user_id/promote
// instead, which closes/opens a staff_position_history row. Without
// this, this generic edit form would keep silently overwriting position
// history's "current" state with no record of what changed or why.
router.put('/staff/:user_id/profile', requirePermissionV2('staff.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const body = StaffProfileSchema.omit({ user_id: true, designation: true, department: true }).parse(req.body)

    const cleanData = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]))

    const { data: existing } = await supabase.from('staff_profiles').select('id, department').eq('user_id', user_id).maybeSingle()

    const { departmentScope } = await getPermissionsForUser(req.user!.id, school_id)
    if (departmentScope && existing?.department !== departmentScope) {
      return res.status(403).json({ success: false, error: 'This staff member is outside your assigned department' })
    }

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

// POST /hrms/staff/:user_id/photo — same base64-upload-then-store-the-
// public-URL shape as POST /students/:id/photo, just onto staff_profiles
// (which may not exist yet for this user, hence upsert) and the
// staff-photos bucket instead.
router.post('/staff/:user_id/photo', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const school_id = req.user!.school_id
  const { photo_base64, file_name, mime_type } = req.body
  if (!photo_base64) return res.status(400).json({ success: false, error: 'No photo provided' })

  const { data: user } = await supabase.from('users').select('id').eq('id', user_id).eq('school_id', school_id).maybeSingle()
  if (!user) return res.status(404).json({ success: false, error: 'Staff member not found' })

  const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${school_id}/${user_id}/${file_name ?? 'photo.jpg'}`
  const { error: uploadErr } = await supabase.storage.from('staff-photos').upload(filePath, buffer, { contentType: mime_type ?? 'image/jpeg', upsert: true })
  if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
  const { data: urlData } = supabase.storage.from('staff-photos').getPublicUrl(filePath)

  const { data: existing } = await supabase.from('staff_profiles').select('id').eq('user_id', user_id).maybeSingle()
  if (existing) {
    await supabase.from('staff_profiles').update({ photo_url: urlData.publicUrl }).eq('user_id', user_id)
  } else {
    await supabase.from('staff_profiles').insert({ school_id, user_id, photo_url: urlData.publicUrl })
  }
  res.json({ success: true, data: { photo_url: urlData.publicUrl } })
}))

// ═══════════════════════════════════════════════════════════════
// STAFF SHIFTS — optional per-staff override of the school-wide
// weekly-off schedule. Reuses staff.edit: assigning a shift is the
// same domain as any other staff_profiles field edit.
// ═══════════════════════════════════════════════════════════════

router.get('/shifts', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('staff_shifts').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/shifts', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = StaffShiftSchema.parse(req.body)
  const { data, error } = await supabase.from('staff_shifts').insert({ ...body, school_id: req.user!.school_id }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.patch('/shifts/:id', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = StaffShiftSchema.partial().parse(req.body)
  const { data, error } = await supabase.from('staff_shifts').update(body).eq('id', req.params.id).eq('school_id', req.user!.school_id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/shifts/:id', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Unassign first so no staff_profiles row is left pointing at a
  // deleted shift (the FK has no ON DELETE behavior specified).
  await supabase.from('staff_profiles').update({ shift_id: null }).eq('shift_id', req.params.id).eq('school_id', req.user!.school_id)
  const { error } = await supabase.from('staff_shifts').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ═══════════════════════════════════════════════════════════════
// CAREER LIFECYCLE — promotion/transfer history, probation
// ═══════════════════════════════════════════════════════════════

// GET /hrms/staff/:user_id/position-history
router.get('/staff/:user_id/position-history', requirePermissionV2('staff.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const { data, error } = await supabase
      .from('staff_position_history')
      .select('*, changed_by_user:changed_by(full_name)')
      .eq('user_id', user_id)
      .eq('school_id', school_id)
      .order('effective_from', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// POST /hrms/staff/:user_id/promote — the only write path for
// designation/department (see the comment on PUT .../profile above).
// Closes the currently-open staff_position_history row and opens a new
// one; optionally versions the salary structure the same way
// PUT /salary-structure does (deactivate old active row, insert new).
router.post('/staff/:user_id/promote', requirePermissionV2('staff.promote'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const body = PromoteTransferSchema.parse(req.body)

    const dayBefore = new Date(`${body.effective_from}T00:00:00`)
    dayBefore.setDate(dayBefore.getDate() - 1)
    const effectiveToForPrevious = toLocalDateStr(dayBefore)

    await supabase.from('staff_position_history')
      .update({ effective_to: effectiveToForPrevious })
      .eq('user_id', user_id).eq('school_id', school_id).is('effective_to', null)

    let salaryStructureId: string | null = null
    if (body.salary) {
      await supabase.from('salary_structures').update({ is_active: false }).eq('user_id', user_id).eq('is_active', true)
      const { data: newSalary, error: salaryErr } = await supabase
        .from('salary_structures')
        .insert({ ...body.salary, user_id, school_id, effective_from: body.effective_from, created_by: req.user!.id, is_active: true })
        .select('id').single()
      if (salaryErr) return res.status(400).json({ success: false, error: `Salary update failed: ${salaryErr.message}` })
      salaryStructureId = newSalary?.id ?? null
    }

    const { data: history, error: historyErr } = await supabase
      .from('staff_position_history')
      .insert({
        school_id, user_id,
        designation: body.designation ?? null,
        department: body.department ?? null,
        branch: body.branch ?? null,
        salary_structure_id: salaryStructureId,
        effective_from: body.effective_from,
        effective_to: null,
        reason: body.reason ?? null,
        changed_by: req.user!.id,
      })
      .select().single()
    if (historyErr) return res.status(400).json({ success: false, error: historyErr.message })

    // Keep staff_profiles' "current" fields in sync for the Profile tab —
    // this call is now the only place that writes them.
    const profileUpdate: Record<string, any> = {}
    if (body.designation !== undefined) profileUpdate.designation = body.designation
    if (body.department !== undefined) profileUpdate.department = body.department
    if (Object.keys(profileUpdate).length) {
      await supabase.from('staff_profiles').update(profileUpdate).eq('user_id', user_id).eq('school_id', school_id)
    }

    res.status(201).json({ success: true, data: history })
  })
)

// POST /hrms/staff/:user_id/probation/confirm
//
// Logged as a CLOSED (effective_to = effective_from), zero-duration
// history entry rather than an open one — this doesn't change the
// person's actual position/department, so it must not compete with the
// real currently-open row for "current" status. It's an audit-trail
// annotation, not a new position period.
router.post('/staff/:user_id/probation/confirm', requirePermissionV2('staff.promote'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const today = toLocalDateStr(new Date())

    await supabase.from('staff_profiles').update({ probation_end_date: null }).eq('user_id', user_id).eq('school_id', school_id)
    const { data, error } = await supabase.from('staff_position_history').insert({
      school_id, user_id, effective_from: today, effective_to: today,
      reason: 'Probation confirmed', changed_by: req.user!.id,
    }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// POST /hrms/staff/:user_id/probation/extend — body: { new_probation_end_date }
// Same closed-entry reasoning as confirm above.
router.post('/staff/:user_id/probation/extend', requirePermissionV2('staff.promote'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const { new_probation_end_date } = req.body
    if (!new_probation_end_date) return res.status(400).json({ success: false, error: 'new_probation_end_date is required' })
    const today = toLocalDateStr(new Date())

    const { error: profErr } = await supabase.from('staff_profiles')
      .update({ probation_end_date: new_probation_end_date }).eq('user_id', user_id).eq('school_id', school_id)
    if (profErr) return res.status(400).json({ success: false, error: profErr.message })

    const { data, error } = await supabase.from('staff_position_history').insert({
      school_id, user_id, effective_from: today, effective_to: today,
      reason: `Probation extended to ${new_probation_end_date}`, changed_by: req.user!.id,
    }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// STAFF DOCUMENTS — per-staff document repository with optional expiry
// and simple e-acknowledgment. Mirrors GET/POST/DELETE /students/:id/
// documents in sis/routes.ts exactly (same base64 -> storage bucket ->
// getPublicUrl() shape), just a new bucket/table for staff.
// ═══════════════════════════════════════════════════════════════

// GET /hrms/staff/:user_id/documents — self-or-staff.edit, same guard
// shape as GET /leave-balances/:user_id.
router.get('/staff/:user_id/documents', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const school_id = req.user!.school_id

  if (user_id !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.edit')) {
      return res.status(403).json({ success: false, error: 'Missing permission: staff.edit' })
    }
  }

  const { data, error } = await supabase
    .from('staff_documents')
    .select('*, uploaded_by_user:uploaded_by(full_name), acknowledged_by_user:acknowledged_by(full_name)')
    .eq('user_id', user_id).eq('school_id', school_id)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// POST /hrms/staff/:user_id/documents — HR/admin upload, staff.edit.
router.post('/staff/:user_id/documents', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const school_id = req.user!.school_id
  const { file_base64, file_name, mime_type, document_type, document_name, notes, expiry_date, requires_acknowledgment } = req.body
  if (!file_base64) return res.status(400).json({ success: false, error: 'No file provided' })

  const base64Data = file_base64.replace(/^data:[\w/]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${school_id}/${user_id}/${Date.now()}_${file_name}`
  const { error: uploadErr } = await supabase.storage.from('staff-documents').upload(filePath, buffer, { contentType: mime_type ?? 'application/pdf', upsert: false })
  if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
  const { data: urlData } = supabase.storage.from('staff-documents').getPublicUrl(filePath)

  const { data, error } = await supabase.from('staff_documents').insert({
    school_id, user_id, document_type: document_type ?? 'other', document_name: document_name ?? file_name,
    file_url: urlData.publicUrl,
    file_size: buffer.length > 1024 * 1024 ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB` : `${(buffer.length / 1024).toFixed(0)} KB`,
    mime_type, notes, expiry_date: expiry_date || null, requires_acknowledgment: !!requires_acknowledgment,
    uploaded_by: req.user!.id,
  }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// DELETE /hrms/staff/:user_id/documents/:doc_id — staff.edit.
router.delete('/staff/:user_id/documents/:doc_id', requirePermissionV2('staff.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, doc_id } = req.params
  const { error } = await supabase.from('staff_documents').delete().eq('id', doc_id).eq('user_id', user_id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// POST /hrms/staff/:user_id/documents/:doc_id/acknowledge — self-only.
// A personal attestation, not an HR action — nobody can acknowledge on
// someone else's behalf, regardless of permissions held.
router.post('/staff/:user_id/documents/:doc_id/acknowledge', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, doc_id } = req.params
  if (user_id !== req.user!.id) {
    return res.status(403).json({ success: false, error: 'You can only acknowledge your own documents' })
  }
  const { data, error } = await supabase.from('staff_documents')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: req.user!.id })
    .eq('id', doc_id).eq('user_id', user_id).eq('school_id', req.user!.school_id)
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ═══════════════════════════════════════════════════════════════
// STAFF EXIT — resignation, clearance checklist, full & final
// settlement. Reuses the generic workflow engine for the one real
// approval step (settlement) rather than hand-rolling a second
// approval mechanism; the clearance checklist is deliberately a plain
// table, not a workflow step, per its own simple checked/unchecked
// nature.
// ═══════════════════════════════════════════════════════════════

// GET /hrms/staff/:user_id/exit — most recent exit record (if any),
// with its checklist and workflow status attached.
router.get('/staff/:user_id/exit', requirePermissionV2('staff.exit_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id

    const { data: exit } = await supabase
      .from('staff_exits').select('*').eq('user_id', user_id).eq('school_id', school_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (!exit) return res.json({ success: true, data: null })

    const [{ data: checklist }, workflowStatus] = await Promise.all([
      supabase.from('staff_exit_checklist_items').select('*').eq('exit_id', exit.id).order('item_name'),
      getWorkflowStatus('staff_exit', exit.id, school_id),
    ])

    res.json({ success: true, data: { ...exit, checklist: checklist ?? [], workflow: workflowStatus } })
  })
)

// POST /hrms/staff/:user_id/exit — initiate. Resignation-recorded and
// notice-period-started are the same moment in practice, so status
// starts at 'notice_period' directly rather than sitting at 'initiated'
// with a separate manual transition nobody would reliably click.
router.post('/staff/:user_id/exit', requirePermissionV2('staff.exit_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id
    const body = InitiateExitSchema.parse(req.body)

    const { data: existing } = await supabase.from('staff_exits').select('id, status')
      .eq('user_id', user_id).eq('school_id', school_id).neq('status', 'settled').maybeSingle()
    if (existing) return res.status(400).json({ success: false, error: `An exit is already in progress for this staff member (status: ${existing.status})` })

    const { data: exit, error } = await supabase.from('staff_exits').insert({
      school_id, user_id,
      resignation_date: body.resignation_date,
      last_working_day: body.last_working_day,
      notice_period_days: body.notice_period_days ?? null,
      reason: body.reason ?? null,
      status: 'notice_period',
      initiated_by: req.user!.id,
    }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    const { error: checklistErr } = await supabase.from('staff_exit_checklist_items')
      .insert(DEFAULT_EXIT_CHECKLIST.map(item_name => ({ exit_id: exit.id, item_name })))
    if (checklistErr) console.error('Failed to seed exit checklist:', checklistErr.message)

    res.status(201).json({ success: true, data: exit })
  })
)

// PATCH /hrms/exit/:exit_id/checklist/:item_id — toggle one item.
// Flips the exit to 'cleared' once every item is checked.
router.patch('/exit/:exit_id/checklist/:item_id', requirePermissionV2('staff.exit_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { exit_id, item_id } = req.params
    const { is_completed, notes } = req.body
    const school_id = req.user!.school_id

    const { data: exit } = await supabase.from('staff_exits').select('id, status').eq('id', exit_id).eq('school_id', school_id).maybeSingle()
    if (!exit) return res.status(404).json({ success: false, error: 'Exit record not found' })

    const update: Record<string, any> = { is_completed: !!is_completed, notes: notes ?? null }
    if (is_completed) { update.completed_by = req.user!.id; update.completed_at = new Date().toISOString() }
    else { update.completed_by = null; update.completed_at = null }

    const { data, error } = await supabase.from('staff_exit_checklist_items')
      .update(update).eq('id', item_id).eq('exit_id', exit_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    const { data: allItems } = await supabase.from('staff_exit_checklist_items').select('is_completed').eq('exit_id', exit_id)
    const allDone = (allItems ?? []).length > 0 && (allItems ?? []).every(i => i.is_completed)
    if (allDone && exit.status === 'notice_period') {
      await supabase.from('staff_exits').update({ status: 'cleared', updated_at: new Date().toISOString() }).eq('id', exit_id)
    } else if (!allDone && exit.status === 'cleared') {
      // Unchecking something after clearance reopens it — status should
      // reflect reality, not a point-in-time snapshot that's now stale.
      await supabase.from('staff_exits').update({ status: 'notice_period', updated_at: new Date().toISOString() }).eq('id', exit_id)
    }

    res.json({ success: true, data })
  })
)

// POST /hrms/exit/:exit_id/submit-settlement — computes the full &
// final figures and starts the one-step approval workflow.
//
// Leave payout uses gross/30 as the per-day rate — a documented
// placeholder. LOP and outstanding-advances deductions are returned as
// 0 for now; Phase 2 (payroll LOP) and the loans/advances table wire
// real values into these same response fields without changing this
// route's shape.
router.post('/exit/:exit_id/submit-settlement', requirePermissionV2('staff.exit_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { exit_id } = req.params
    const school_id = req.user!.school_id

    const { data: exit } = await supabase.from('staff_exits').select('*').eq('id', exit_id).eq('school_id', school_id).maybeSingle()
    if (!exit) return res.status(404).json({ success: false, error: 'Exit record not found' })

    // Already submitted — return the existing workflow status rather than
    // recomputing (leave balances drift after submission) and starting a
    // second, duplicate workflow instance for the same exit.
    const existingStatus = await getWorkflowStatus('staff_exit', exit_id, school_id)
    if (existingStatus && (existingStatus as any).status === 'in_progress') {
      return res.json({
        success: true,
        data: {
          pending_leave_days: exit.pending_leave_days, leave_payout: exit.leave_payout,
          lop_deduction: exit.lop_deduction, advances_deduction: exit.advances_deduction,
          net_settlement: exit.net_settlement, workflow: existingStatus,
        },
      })
    }

    if (exit.status !== 'cleared') return res.status(400).json({ success: false, error: `Clearance checklist must be complete first (current status: ${exit.status})` })

    const [{ data: salary }, { data: leaveBalances }] = await Promise.all([
      supabase.from('salary_structures').select('*').eq('user_id', exit.user_id).eq('is_active', true).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('leave_balances').select('total_days, used_days').eq('user_id', exit.user_id).eq('year', new Date().getFullYear()),
    ])

    const gross = salary
      ? Number(salary.basic_salary) + Number(salary.hra ?? 0) + Number(salary.da ?? 0) + Number(salary.conveyance_allowance ?? 0) + Number(salary.medical_allowance ?? 0) + Number(salary.other_allowances ?? 0)
      : 0
    const perDayRate = gross / 30
    const pendingLeaveDays = (leaveBalances ?? []).reduce((s, b) => s + Math.max(0, Number(b.total_days) - Number(b.used_days)), 0)
    const leavePayout = Math.round(pendingLeaveDays * perDayRate)
    const lopDeduction = 0 // wired in by Phase 2's payroll LOP work
    const advancesDeduction = 0 // wired in once the loans/advances table exists
    const netSettlement = leavePayout - lopDeduction - advancesDeduction

    await supabase.from('staff_exits').update({
      pending_leave_days: pendingLeaveDays, leave_payout: leavePayout,
      lop_deduction: lopDeduction, advances_deduction: advancesDeduction, net_settlement: netSettlement,
      updated_at: new Date().toISOString(),
    }).eq('id', exit_id)

    await ensureExitWorkflowDefinition(school_id)
    const wfResult = await startWorkflow({
      schoolId: school_id,
      workflowName: 'Staff Exit Settlement Workflow',
      entityType: 'staff_exit',
      entityId: exit_id,
      initiatedBy: req.user!.id,
      entityContext: { net_settlement: netSettlement },
    })

    if (!wfResult.success) {
      return res.status(400).json({ success: false, error: `Could not start settlement approval: ${wfResult.error}` })
    }

    res.json({
      success: true,
      data: {
        pending_leave_days: pendingLeaveDays, per_day_rate: perDayRate, leave_payout: leavePayout,
        lop_deduction: lopDeduction, advances_deduction: advancesDeduction, net_settlement: netSettlement,
        workflow: wfResult.instance,
      },
    })
  })
)

// POST /hrms/exit/:exit_id/workflow-action — approve/reject the
// settlement. Single-step workflow whose default approver roles
// (HR/Principal) already hold staff.exit_manage, so this is gated
// directly on the permission rather than the NON_STAFF_ROLES-only
// fallback used for admission/TC's multi-step workflows, where the
// documented step actor (Accountant) didn't hold the broader module
// permission by default.
router.post('/exit/:exit_id/workflow-action', requirePermissionV2('staff.exit_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { exit_id } = req.params
    const { status, notes } = req.body
    const school_id = req.user!.school_id

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Must be approved or rejected.' })
    }

    const { data: exit } = await supabase.from('staff_exits').select('*').eq('id', exit_id).eq('school_id', school_id).maybeSingle()
    if (!exit) return res.status(404).json({ success: false, error: 'Exit record not found' })

    const { data: instance, error: instErr } = await supabase
      .from('workflow_instances').select('id, status')
      .eq('entity_type', 'staff_exit').eq('entity_id', exit_id).eq('school_id', school_id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (instErr || !instance) return res.status(404).json({ success: false, error: 'No settlement workflow found for this exit. Submit for settlement first.' })
    if (instance.status !== 'in_progress') return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })

    const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status, notes })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })

    if (result.completed && result.instance.status === 'approved') {
      await supabase.from('staff_exits').update({ status: 'settled', updated_at: new Date().toISOString() }).eq('id', exit_id)

      // Reuses team.ts's exact DELETE /:id deactivation logic.
      await supabase.from('users').update({ is_active: false }).eq('id', exit.user_id).eq('school_id', school_id)
      invalidateUserProfile(exit.user_id)
      await supabase.from('staff_profiles').update({ employment_status: 'resigned' }).eq('user_id', exit.user_id).eq('school_id', school_id)
      await supabase.from('staff_position_history')
        .update({ effective_to: exit.last_working_day })
        .eq('user_id', exit.user_id).eq('school_id', school_id).is('effective_to', null)
    }

    res.json({ success: true, data: { instance: result.instance, completed: result.completed } })
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
//
// Whenever no leave_balances row exists yet, this is the fallback used
// as "what's available." For an 'annual' type that's simply the full
// yearly allowance (today's original behavior). For a 'monthly' accrual
// type it must NOT be the full year up front — only what would have
// accrued by now (or the full year if asking about a past/completed
// year), otherwise a brand-new monthly-accrual balance row would show
// as fully available on day one, before runLeaveAccrual has ever run.
function defaultTotalDaysForType(leaveType: { default_days_per_year: number; accrual_frequency?: string | null }, year: number): number {
  const perYear = leaveType?.default_days_per_year ?? 0
  if (leaveType?.accrual_frequency !== 'monthly') return perYear
  const monthsElapsed = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12
  return Math.round((perYear / 12) * monthsElapsed * 100) / 100
}

async function getLeaveBalanceSnapshot(userId: string, leaveTypeId: string, year: number) {
  const [{ data: balance }, { data: leaveType }] = await Promise.all([
    supabase.from('leave_balances').select('total_days, used_days').eq('user_id', userId).eq('leave_type_id', leaveTypeId).eq('year', year).maybeSingle(),
    supabase.from('leave_types').select('default_days_per_year, accrual_frequency').eq('id', leaveTypeId).single(),
  ])
  const total_days = balance?.total_days ?? (leaveType ? defaultTotalDaysForType(leaveType, year) : 0)
  const used_days = balance?.used_days ?? 0
  return { total_days, used_days, remaining_days: total_days - used_days }
}

// An "Absent" mark made directly on the attendance sheet — e.g. a real
// emergency, never applied for in advance through the formal leave flow
// — still needs to show up in the person's leave record, not just
// silently become a Loss-of-Pay figure at payroll time with no trace
// anywhere else. Whenever a day's status transitions into or out of
// 'absent' (direct marking or an approved regularization), this keeps
// the school's unpaid ("Leave Without Pay" — the leave_types row with
// is_paid=false) balance in sync. Purely a record-keeping mirror:
// payroll's own LOP calculation reads staff_attendance directly and
// doesn't depend on this at all, so there's no double-deduction risk.
async function syncUnpaidLeaveOnAttendanceChange(schoolId: string, userId: string, date: string, previousStatus: string | null, newStatus: string): Promise<void> {
  const wasAbsent = previousStatus === 'absent'
  const isAbsent = newStatus === 'absent'
  if (wasAbsent === isAbsent) return

  const { data: lwpType } = await supabase
    .from('leave_types').select('id').eq('school_id', schoolId).eq('is_paid', false).limit(1).maybeSingle()
  if (!lwpType) return // no unpaid leave type configured for this school — nothing to sync against

  const year = new Date(`${date}T00:00:00`).getFullYear()
  const delta = isAbsent ? 1 : -1

  const { data: balance } = await supabase
    .from('leave_balances').select('id, used_days').eq('user_id', userId).eq('leave_type_id', lwpType.id).eq('year', year).maybeSingle()

  if (balance) {
    await supabase.from('leave_balances').update({ used_days: Math.max(0, balance.used_days + delta) }).eq('id', balance.id)
  } else if (delta > 0) {
    const { data: leaveType } = await supabase.from('leave_types').select('default_days_per_year, accrual_frequency').eq('id', lwpType.id).single()
    const total_days = leaveType ? defaultTotalDaysForType(leaveType, year) : 0
    await supabase.from('leave_balances').insert({ school_id: schoolId, user_id: userId, leave_type_id: lwpType.id, year, total_days, used_days: 1 })
  }
  // delta < 0 with no existing balance row: nothing to reverse, no-op.
}

// GET /hrms/leave-types
router.get('/leave-types', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('leave_types').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// POST /hrms/leave-types — create a leave policy. No CRUD existed for
// this before Phase 4; every leave_types row previously only came from
// the demo seeder, so a real school had no way to define its own leave
// types at all. Reuses staff.leave_approve — leave-type policy config is
// the same "leave administration" domain as approving individual
// requests, already held by School Admin/Principal/Vice Principal/HR.
router.post('/leave-types', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = LeaveTypeSchema.parse(req.body)
  const { data, error } = await supabase.from('leave_types').insert({ ...body, school_id: req.user!.school_id }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// PATCH /hrms/leave-types/:id
router.patch('/leave-types/:id', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = LeaveTypeSchema.partial().parse(req.body)
  const { data, error } = await supabase
    .from('leave_types').update(body).eq('id', req.params.id).eq('school_id', req.user!.school_id)
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// DELETE /hrms/leave-types/:id
router.delete('/leave-types/:id', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('leave_types').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// GET /hrms/leave-requests - list (admin sees all, staff sees own)
router.get('/leave-requests', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, user_id, page = '1', limit = '20' } = req.query
  const { from, to } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id
  const isAdmin = ['school_admin', 'principal'].includes(req.user!.role)

  let query = supabase
    .from('leave_requests')
    .select(`*, leave_types(name, code, is_paid), users:user_id(full_name, role, staff_profiles!staff_profiles_user_id_fkey(photo_url)), approver:approved_by(full_name)`, { count: 'exact' })
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
        supabase.from('leave_types').select('id, default_days_per_year, accrual_frequency').in('id', leaveTypeIds),
      ])
    : [{ data: [] }, { data: [] }]

  const withWarnings = (data ?? []).map(r => {
    const year = new Date(r.from_date).getFullYear()
    const bal = (allBalances ?? []).find(b => b.user_id === r.user_id && b.leave_type_id === r.leave_type_id && b.year === year)
    const lt = (allLeaveTypes ?? []).find(t => t.id === r.leave_type_id)
    const total_days = bal?.total_days ?? (lt ? defaultTotalDaysForType(lt, year) : 0)
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
  await ensureLeaveApprovalWorkflowDefinition(school_id)
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
// The actual leave approve/reject decision — previously had no gate at
// all, relying entirely on actOnWorkflow's internal per-step actor
// check below. staff.leave_approve is an exact-fit code already held
// broadly (School Admin/Principal/Vice Principal/HR by default), so
// unlike the admission/TC workflow-action routes this one is safe to
// gate directly rather than falling back to a NON_STAFF_ROLES-only
// check.
router.patch('/leave-requests/:id', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
  let { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'leave_request')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instErr || !instance) {
    // Self-heal rather than dead-end here: this request predates
    // ensureLeaveApprovalWorkflowDefinition being wired into
    // POST /leave-requests (that gap meant "Leave Approval Workflow"
    // had no seeded definition for this school, so the original
    // startWorkflow call at creation time silently failed) — start it
    // now so the approver isn't stuck with a raw error and no action
    // to take from the UI.
    await ensureLeaveApprovalWorkflowDefinition(school_id)
    const backfill = await startWorkflow({
      schoolId: school_id,
      workflowName: 'Leave Approval Workflow',
      entityType: 'leave_request',
      entityId: id,
      initiatedBy: leaveReq.user_id,
    })
    if (!backfill.success || !backfill.instance) {
      return res.status(404).json({
        success: false,
        error: `Could not start a workflow for this leave request: ${backfill.error ?? 'unknown error'}`,
      })
    }
    instance = backfill.instance
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
      const { data: lt } = await supabase.from('leave_types').select('default_days_per_year, accrual_frequency').eq('id', leaveReq.leave_type_id).single()
      const total_days_allowed = lt ? defaultTotalDaysForType(lt, year) : 0
      await supabase.from('leave_balances').insert({
        school_id, user_id: leaveReq.user_id, leave_type_id: leaveReq.leave_type_id, year,
        total_days: total_days_allowed, used_days: leaveReq.total_days,
      })
      exceeds_balance = leaveReq.total_days > total_days_allowed
    }
  }

  if (result.completed) {
    try {
      await createNotification({
        schoolId: school_id, userId: leaveReq.user_id,
        type: result.instance.status === 'approved' ? 'leave_approved' : 'leave_rejected',
        title: result.instance.status === 'approved' ? 'Leave request approved' : 'Leave request rejected',
        message: result.instance.status === 'approved'
          ? `Your leave request for ${leaveReq.from_date} to ${leaveReq.to_date} was approved.`
          : `Your leave request for ${leaveReq.from_date} to ${leaveReq.to_date} was rejected.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`,
        link: '/hr/my-leave',
        relatedEntityType: 'leave_request', relatedEntityId: id,
      })
    } catch (notifyErr) {
      console.error('Failed to create leave notification:', notifyErr)
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
router.post('/leave-requests/:id/start-workflow', requirePermissionV2('staff.leave_approve'),
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
// Previously had no gate — any authenticated user could view any other
// user's leave balances. Every user also legitimately calls this for
// their OWN id (My Leave page), so this can't be a blanket
// requirePermissionV2 — self-access must keep working regardless of
// permissions, everyone else needs staff.edit.
router.get('/leave-balances/:user_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const year = Number(req.query.year) || new Date().getFullYear()
  const school_id = req.user!.school_id

  if (user_id !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.edit')) {
      return res.status(403).json({ success: false, error: 'Missing permission: staff.edit' })
    }
  }

  const { data: leaveTypes } = await supabase.from('leave_types').select('*').eq('school_id', school_id)
  const { data: balances } = await supabase.from('leave_balances').select('*').eq('user_id', user_id).eq('year', year)

  const result = (leaveTypes ?? []).map(lt => {
    const bal = (balances ?? []).find(b => b.leave_type_id === lt.id)
    const fallbackTotal = defaultTotalDaysForType(lt, year)
    return {
      leave_type_id: lt.id,
      name: lt.name,
      code: lt.code,
      total_days: bal?.total_days ?? fallbackTotal,
      used_days: bal?.used_days ?? 0,
      remaining_days: (bal?.total_days ?? fallbackTotal) - (bal?.used_days ?? 0),
    }
  })

  res.json({ success: true, data: result })
}))

// POST /hrms/leave-accrual/run — manual trigger for the monthly accrual
// sweep (backend/src/index.ts runs it unattended on the 1st), scoped to
// the caller's own school like every other route. Same reasoning as
// POST /notifications/run-fee-reminders: a long-lived in-process cron
// isn't guaranteed to fire on every host.
router.post('/leave-accrual/run', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await runLeaveAccrual(req.user!.school_id)
  res.json({ success: true, data: result })
}))

// POST /hrms/leave-year-end/run — manual trigger for carry-forward/
// encashment processing. Optional body: { for_year } to reprocess a
// specific year (defaults to the current year).
router.post('/leave-year-end/run', requirePermissionV2('staff.leave_approve'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const forYear = req.body?.for_year ? Number(req.body.for_year) : undefined
  const result = await runLeaveYearEnd(req.user!.school_id, forYear)
  res.json({ success: true, data: result })
}))

// ═══════════════════════════════════════════════════════════════
// PAYROLL
// ═══════════════════════════════════════════════════════════════

// GET /hrms/salary-structure/:user_id
// Same self-or-staff exception as leave-balances above — previously any
// authenticated user could pull any other user's active salary
// structure (basic, HRA, DA, all allowances) with no gate at all.
router.get('/salary-structure/:user_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params
  const school_id = req.user!.school_id

  if (user_id !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.payroll_manage')) {
      return res.status(403).json({ success: false, error: 'Missing permission: staff.payroll_manage' })
    }
    supabase.from('audit_logs').insert({
      school_id, user_id: req.user!.id, action: 'VIEW', entity_type: 'salary_structure', entity_id: user_id,
      ip_address: req.ip ?? null,
    }).then(({ error: auditErr }) => { if (auditErr) console.error('Failed to write audit log:', auditErr.message) })
  }

  const { data, error } = await supabase
    .from('salary_structures').select('*').eq('user_id', user_id).eq('is_active', true)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// PUT /hrms/salary-structure - create/update salary structure
router.put('/salary-structure', requirePermissionV2('staff.payroll_manage'),
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
    .select(`*, users:user_id(full_name, role, staff_profiles!staff_profiles_user_id_fkey(photo_url))`, { count: 'exact' })
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

// One simple, clearly-illustrative annualized slab — deliberately not a
// full tax engine (no regime switching, no investment declarations, no
// Form 16). Computed on (monthly gross * 12), divided back to a monthly
// deduction. Schools needing actual statutory accuracy should still
// verify/override via the payslip's own `tds` field after generation.
function computeMonthlyTDS(monthlyGross: number): number {
  const annual = monthlyGross * 12
  let tax = 0
  if (annual > 1500000) tax += (annual - 1500000) * 0.30
  if (annual > 1200000) tax += (Math.min(annual, 1500000) - 1200000) * 0.20
  if (annual > 900000)  tax += (Math.min(annual, 1200000) - 900000) * 0.15
  if (annual > 600000)  tax += (Math.min(annual, 900000) - 600000) * 0.10
  if (annual > 300000)  tax += (Math.min(annual, 600000) - 300000) * 0.05
  return Math.round(tax / 12)
}

// Picks the matching professional_tax_slabs band for a school, falling
// back to the salary structure's own flat professional_tax value when
// no slabs are configured — so schools that never touch this new
// feature see identical behavior to before.
function computeProfessionalTax(gross: number, slabs: { min_gross: number; max_gross: number | null; amount: number }[], fallback: number): number {
  if (!slabs.length) return fallback
  const band = slabs.find(s => gross >= s.min_gross && (s.max_gross == null || gross <= s.max_gross))
  return band ? Number(band.amount) : fallback
}

// POST /hrms/payslips/generate - generate payslips for a month for all active staff
router.post('/payslips/generate', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year, user_ids, confirm } = req.body
    const school_id = req.user!.school_id

    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' })

    // Get target users (active staff with salary structures)
    let salaryQuery = supabase.from('salary_structures').select('*, users:user_id(full_name)').eq('school_id', school_id).eq('is_active', true)
    if (user_ids?.length) salaryQuery = salaryQuery.in('user_id', user_ids)
    const { data: salariesRaw } = await salaryQuery

    if (!salariesRaw?.length) return res.status(400).json({ success: false, error: 'No salary structures found' })

    // Resigned/terminated staff are never eligible for a NEW payslip,
    // regardless of whether they still have an active salary structure
    // on file — a departed employee shouldn't be part of payroll going
    // forward. This doesn't touch payslips already generated before
    // they left; those remain exactly as they were (still legitimately
    // owed and payable via Bank Export).
    const { data: statusRows } = await supabase.from('staff_profiles').select('user_id, employment_status').in('user_id', salariesRaw.map(s => s.user_id))
    const statusByUser = new Map((statusRows ?? []).map(p => [p.user_id, p.employment_status]))
    const EXCLUDED_STATUSES = new Set(['resigned', 'terminated'])
    const salaries = salariesRaw.filter(s => !EXCLUDED_STATUSES.has(statusByUser.get(s.user_id) ?? 'active'))
    const excludedForStatus = salariesRaw
      .filter(s => EXCLUDED_STATUSES.has(statusByUser.get(s.user_id) ?? 'active'))
      .map(s => ({ user_id: s.user_id, full_name: (s as any).users?.full_name, reason: 'resigned' as const }))

    if (!salaries.length) return res.status(400).json({ success: false, error: 'No eligible staff — everyone matched is resigned or terminated' })

    const targetUserIds = salaries.map(s => s.user_id)
    const mStr = String(month).padStart(2, '0')
    const fromDate = `${year}-${mStr}-01`
    const toDate = `${year}-${mStr}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`

    const [{ rollupByUser }, { data: school }, { data: ptSlabs }, { data: activeLoans }, { data: encashProfiles }, { data: bonuses }, { data: existingPayslips }] = await Promise.all([
      computeStaffAttendanceRollup(school_id, targetUserIds, fromDate, toDate),
      supabase.from('schools').select('lop_grace_days, lop_per_day_formula').eq('id', school_id).single(),
      supabase.from('professional_tax_slabs').select('min_gross, max_gross, amount').eq('school_id', school_id),
      supabase.from('staff_loans').select('*').eq('school_id', school_id).eq('status', 'active').in('user_id', targetUserIds),
      supabase.from('staff_profiles').select('user_id, pending_leave_encashment_days').in('user_id', targetUserIds).gt('pending_leave_encashment_days', 0),
      supabase.from('staff_bonuses').select('user_id, amount, reason').eq('school_id', school_id).eq('month', month).eq('year', year).in('user_id', targetUserIds),
      supabase.from('payslips').select('user_id, payment_status, loan_deduction, leave_encashment').eq('school_id', school_id).eq('month', month).eq('year', year).in('user_id', targetUserIds),
    ])

    const graceDays = school?.lop_grace_days ?? 0
    const formula = school?.lop_per_day_formula ?? 'gross_30'
    const loanByUser = new Map((activeLoans ?? []).map(l => [l.user_id, l]))
    const encashDaysByUser = new Map((encashProfiles ?? []).map(p => [p.user_id, p.pending_leave_encashment_days]))
    const bonusByUser = new Map((bonuses ?? []).map(b => [b.user_id, b]))
    // Once a payslip is approved or paid it's a finalized, real-world
    // record — someone may already have been paid against it. Silently
    // re-running Generate must not recompute (and overwrite) that row,
    // or it reverts payment_status back to 'pending' out from under an
    // already-paid payslip. Only 'pending' or missing payslips are
    // (re)computed; approved/paid ones are left untouched and reported
    // back as skipped, same transparency as the other skip reasons below.
    const existingPayslipByUser = new Map((existingPayslips ?? []).map(p => [p.user_id, p]))
    const finalizedStatusByUser = new Map((existingPayslips ?? []).map(p => [p.user_id, p.payment_status]))

    // Safety check: LOP treats an unmarked working day the same as an
    // absence, so generating payroll before a month's attendance has
    // actually been marked silently turns "nobody marked it yet" into
    // "everyone gets docked for it." If most of the elapsed working days
    // across the target staff have no attendance record at all, require
    // an explicit confirm=true rather than generating straight away.
    const totalWorkingDays = targetUserIds.reduce((sum, uid) => sum + (rollupByUser.get(uid)?.working_days ?? 0), 0)
    const totalUnmarked = targetUserIds.reduce((sum, uid) => sum + (rollupByUser.get(uid)?.unmarked ?? 0), 0)
    const unmarkedRatio = totalWorkingDays > 0 ? totalUnmarked / totalWorkingDays : 0

    if (!confirm && unmarkedRatio > 0.5) {
      return res.status(409).json({
        success: false,
        needs_confirmation: true,
        error: `Only ${Math.round((1 - unmarkedRatio) * 100)}% of this month's working days have attendance marked so far — generating now will count the rest as Loss of Pay for most staff. Mark attendance first, or confirm to generate anyway.`,
        coverage_pct: Math.round((1 - unmarkedRatio) * 100),
        unmarked_days: totalUnmarked,
        working_days: totalWorkingDays,
      })
    }

    const generated = []
    const alreadyFinalized: { user_id: string; full_name: any; reason: 'already_finalized'; payment_status: string }[] = []
    for (const s of salaries) {
      const existingStatus = finalizedStatusByUser.get(s.user_id)
      if (existingStatus === 'approved' || existingStatus === 'paid') {
        alreadyFinalized.push({ user_id: s.user_id, full_name: (s as any).users?.full_name, reason: 'already_finalized', payment_status: existingStatus })
        continue
      }

      const gross = s.basic_salary + (s.hra ?? 0) + (s.da ?? 0) + (s.conveyance_allowance ?? 0) + (s.medical_allowance ?? 0) + (s.other_allowances ?? 0)

      // LOP — the actual point of this rewrite. Previously hardcoded to
      // 0 at generation time; now computed from the same unmarked/absent
      // attendance data the Attendance Report already surfaces.
      const rollup = rollupByUser.get(s.user_id)
      const lopDays = rollup ? Math.max(0, (rollup.unmarked + rollup.absent) - graceDays) : 0
      const perDayRate = formula === 'working_days' && rollup && rollup.working_days > 0 ? gross / rollup.working_days : gross / 30
      const lopAmount = Math.round(lopDays * perDayRate)

      const tds = computeMonthlyTDS(gross)
      const professionalTax = computeProfessionalTax(gross, ptSlabs ?? [], s.professional_tax ?? 0)

      // A pending payslip already existing for this exact month means
      // this is a RE-generate (e.g. attendance got corrected, Generate
      // was run again before anyone approved it) — not a first-time
      // creation. Loan installments and leave-encashment days are each
      // consumed exactly once, at first-generation time; re-deriving
      // them here would either advance the loan an extra installment it
      // never actually collected, or — since the source days get zeroed
      // the first time — silently compute 0 the second time and drop
      // the encashment amount the employee already earned. Both are
      // carried forward unchanged from the existing pending row instead.
      const existingSlip = existingPayslipByUser.get(s.user_id)
      const isRegenerate = !!existingSlip

      // Loan recovery — deduct the installment (or whatever remains, if
      // less), advance the loan's own progress, and settle it once paid off.
      let loanDeduction = 0
      if (isRegenerate) {
        loanDeduction = Number(existingSlip!.loan_deduction ?? 0)
      } else {
        const loan = loanByUser.get(s.user_id)
        if (loan) {
          const remainingInstallments = loan.installments_total - loan.installments_paid
          const remainingPrincipal = loan.principal_amount - (loan.installment_amount * loan.installments_paid)
          loanDeduction = remainingInstallments <= 1 ? Math.min(loan.installment_amount, remainingPrincipal) : loan.installment_amount
          const newPaidCount = loan.installments_paid + 1
          await supabase.from('staff_loans').update({
            installments_paid: newPaidCount,
            status: newPaidCount >= loan.installments_total ? 'settled' : 'active',
            updated_at: new Date().toISOString(),
          }).eq('id', loan.id)
        }
      }

      const totalDeductions = (s.pf_deduction ?? 0) + professionalTax + (s.other_deductions ?? 0) + lopAmount + tds + loanDeduction

      // Leave encashment — a distinct earnings line credited by the
      // year-end sweep (runLeaveYearEnd), picked up and cleared here
      // rather than paid out at year-end itself, so the payout uses
      // THIS month's gross rather than a stale January figure (same
      // reasoning as LOP/loan recovery being computed fresh here).
      const encashDays = isRegenerate ? 0 : (encashDaysByUser.get(s.user_id) ?? 0)
      const leaveEncashment = isRegenerate ? Number(existingSlip!.leave_encashment ?? 0) : (encashDays > 0 ? Math.round(encashDays * (gross / 30)) : 0)

      // Bonus — a one-off award staged in staff_bonuses for this exact
      // month (see that table's migration), snapshotted onto the
      // payslip the same way leave_encashment is: added on top of gross
      // rather than folded into it, so it never feeds PF/PT/TDS.
      const bonus = bonusByUser.get(s.user_id)
      const bonusAmount = Number(bonus?.amount ?? 0)
      const net = gross - totalDeductions + leaveEncashment + bonusAmount

      const payslipData = {
        school_id, user_id: s.user_id, month, year,
        basic_salary: s.basic_salary, hra: s.hra, da: s.da,
        conveyance_allowance: s.conveyance_allowance, medical_allowance: s.medical_allowance,
        other_allowances: s.other_allowances, gross_salary: gross,
        pf_deduction: s.pf_deduction, pf_employer: s.pf_employer ?? 0, professional_tax: professionalTax,
        other_deductions: s.other_deductions, tds, loan_deduction: loanDeduction, leave_encashment: leaveEncashment,
        bonus_amount: bonusAmount, bonus_reason: bonus?.reason ?? null,
        lop_days: lopDays, lop_amount: lopAmount, total_deductions: totalDeductions, net_salary: net,
        payment_status: 'pending', generated_by: req.user!.id,
      }

      const { data, error } = await supabase.from('payslips').upsert(payslipData, { onConflict: 'user_id,month,year' }).select().single()
      if (!error) {
        generated.push(data)
        if (encashDays > 0) {
          await supabase.from('staff_profiles').update({ pending_leave_encashment_days: 0 }).eq('user_id', s.user_id)
        }
      }
    }

    // Staff with no active salary structure get silently skipped above —
    // surface exactly who, so "why did only N payslips get generated"
    // isn't a mystery. Not scoped by user_ids since that param is only
    // used to narrow which of the eligible staff to run, not to exclude
    // ineligible ones from this notice. Resigned/terminated staff with
    // no salary structure aren't worth flagging here either — that's
    // covered by excludedForStatus, not a "go set up their pay" nag.
    const coveredIds = new Set(salaries.map(s => s.user_id))
    const excludedIds = new Set(excludedForStatus.map(s => s.user_id))
    const { data: allStaff } = await supabase.from('users').select('id, full_name, role').eq('school_id', school_id).neq('role', 'student').neq('role', 'parent')
    const missingStructure = (allStaff ?? [])
      .filter(u => !coveredIds.has(u.id) && !excludedIds.has(u.id))
      .map(u => ({ user_id: u.id, full_name: u.full_name, role: u.role, reason: 'no_salary_structure' as const }))
    const skipped = [...missingStructure, ...excludedForStatus, ...alreadyFinalized]

    // Best-effort — a notification failure shouldn't turn an already-
    // generated payroll run into an error for the caller.
    try {
      const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      await createNotifications(generated.map(g => g.user_id), {
        schoolId: school_id, type: 'payslip_generated',
        title: 'Payslip ready', message: `Your payslip for ${monthName} is ready.`,
        link: '/hr/my-payslips',
      })
    } catch (notifyErr) {
      console.error('Failed to create payslip notifications:', notifyErr)
    }

    res.json({ success: true, data: generated, count: generated.length, skipped })
  })
)

router.post('/payslips/:id/approve', requirePermissionV2('staff.payroll_manage'),
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
router.patch('/payslips/:id', requirePermissionV2('staff.payroll_manage'),
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

    // total_deductions must include lop_amount, not just net_salary — a
    // manual LOP edit used to leave the two out of sync (net_salary
    // reflected the new LOP, total_deductions silently didn't). net_salary
    // must also keep adding back leave_encashment and bonus_amount
    // (earnings lines, not deductions) — generation includes both, so
    // recomputing here without them would silently drop them on the
    // first manual LOP edit.
    if (lop_amount !== undefined) {
      const { data: existing } = await supabase.from('payslips').select('gross_salary, total_deductions, lop_amount, leave_encashment, bonus_amount').eq('id', id).single()
      if (existing) {
        const deductionsWithoutOldLop = existing.total_deductions - Number(existing.lop_amount ?? 0)
        update.total_deductions = deductionsWithoutOldLop + lop_amount
        update.net_salary = existing.gross_salary - update.total_deductions + Number(existing.leave_encashment ?? 0) + Number(existing.bonus_amount ?? 0)
      }
    }

    const { data, error } = await supabase.from('payslips').update(update).eq('id', id).eq('school_id', school_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// GET /hrms/payroll/summary - month-wise summary
router.get('/payroll/summary', requirePermissionV2('staff.payroll_view'),
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

// GET /hrms/payslips/:id — single payslip, for the self-service payslip
// page as well as admin detail views. Self-or-staff pattern, same as
// leave-balances/salary-structure earlier this session: a user can
// always see their own payslip; anyone else needs staff.payroll_view.
router.get('/payslips/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const { data: payslip, error } = await supabase
    .from('payslips').select('*, users:user_id(full_name, role)').eq('id', id).eq('school_id', school_id).single()
  if (error || !payslip) return res.status(404).json({ success: false, error: 'Payslip not found' })

  if (payslip.user_id !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.payroll_view')) {
      return res.status(403).json({ success: false, error: 'Missing permission: staff.payroll_view' })
    }
    supabase.from('audit_logs').insert({
      school_id, user_id: req.user!.id, action: 'VIEW', entity_type: 'payslip', entity_id: payslip.user_id,
      ip_address: req.ip ?? null,
    }).then(({ error: auditErr }) => { if (auditErr) console.error('Failed to write audit log:', auditErr.message) })
  }

  res.json({ success: true, data: payslip })
}))

// GET /hrms/payroll/bank-export — CSV of approved-but-unpaid payslips
// for a month, for the bank disbursement file. First CSV route in this
// codebase — hand-rolled with Express's own headers, no new dependency.
router.get('/payroll/bank-export', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year } = req.query
    const school_id = req.user!.school_id
    const m = Number(month) || new Date().getMonth() + 1
    const y = Number(year) || new Date().getFullYear()

    // payslips.user_id and staff_profiles.user_id are siblings (both FK
    // to users, not to each other) — PostgREST can't embed one from the
    // other in a single select. `staff_profiles:user_id(...)` silently
    // resolved to users' own columns instead (users_1.bank_account_number
    // does not exist), so this is a separate lookup joined in JS, same
    // shape as the leave-balance batch lookups elsewhere in this file.
    const { data, error } = await supabase
      .from('payslips')
      .select('user_id, net_salary, users:user_id(full_name)')
      .eq('school_id', school_id).eq('month', m).eq('year', y).eq('payment_status', 'approved')
    if (error) return res.status(500).json({ success: false, error: error.message })

    const userIds = [...new Set((data ?? []).map(p => p.user_id))]
    const { data: profiles } = userIds.length
      ? await supabase.from('staff_profiles').select('user_id, bank_account_number, bank_ifsc, bank_name').in('user_id', userIds)
      : { data: [] }
    const profileByUser = new Map((profiles ?? []).map(p => [p.user_id, p]))

    const rows = (data ?? []).map((p: any) => {
      const profile = profileByUser.get(p.user_id)
      return [p.users?.full_name ?? '', profile?.bank_name ?? '', profile?.bank_account_number ?? '', profile?.bank_ifsc ?? '', p.net_salary]
    })

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Staff Name', 'Bank Name', 'Account Number', 'IFSC', 'Net Amount'].map(escapeCsv).join(',')
    const csv = [header, ...rows.map(r => r.map(escapeCsv).join(','))].join('\r\n')

    // Always about other staff's bank details, in bulk — always audited,
    // unlike the single-record routes above where a self-view is exempt.
    supabase.from('audit_logs').insert({
      school_id, user_id: req.user!.id, action: 'VIEW', entity_type: 'payroll_bank_export',
      new_values: { month: m, year: y, row_count: rows.length }, ip_address: req.ip ?? null,
    }).then(({ error: auditErr }) => { if (auditErr) console.error('Failed to write audit log:', auditErr.message) })

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="bank-disbursement-${y}-${String(m).padStart(2, '0')}.csv"`)
    res.send(csv)
  })
)

// ═══════════════════════════════════════════════════════════════
// STAFF LOANS / ADVANCES
// ═══════════════════════════════════════════════════════════════

const StaffLoanSchema = z.object({
  user_id: z.string().uuid(),
  principal_amount: z.number().positive(),
  reason: z.string().optional(),
  installment_amount: z.number().positive(),
  installments_total: z.number().int().positive(),
})

router.post('/loans', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = StaffLoanSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data, error } = await supabase.from('staff_loans').insert({ ...body, school_id, issued_by: req.user!.id }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// GET /hrms/loans?user_id= — self-or-staff.payroll_view, same pattern as payslips/:id.
router.get('/loans', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.query
  const school_id = req.user!.school_id
  const targetUserId = (user_id as string) ?? req.user!.id

  if (targetUserId !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.payroll_view')) {
      return res.status(403).json({ success: false, error: 'Missing permission: staff.payroll_view' })
    }
  }

  const { data, error } = await supabase.from('staff_loans').select('*').eq('school_id', school_id).eq('user_id', targetUserId).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.patch('/loans/:id', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status } = req.body
    if (!['active', 'settled', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })
    const { data, error } = await supabase.from('staff_loans').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('school_id', req.user!.school_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// STAFF BONUSES — one-off festival/performance bonuses, picked up by
// POST /payslips/generate for the matching month (see migration
// 20260809000000_staff_bonuses.sql for why this is its own table
// rather than a salary_structures column).
// ═══════════════════════════════════════════════════════════════

const StaffBonusSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int(),
  amount: z.number().positive(),
  reason: z.string().min(1),
})

// GET /hrms/bonuses?month=&year= — bonuses staged for a payroll run,
// before or after generation (generation just snapshots amount+reason
// onto the payslip; the row here stays as the editable source record).
router.get('/bonuses', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year } = req.query
    const school_id = req.user!.school_id
    const m = Number(month) || new Date().getMonth() + 1
    const y = Number(year) || new Date().getFullYear()

    const { data, error } = await supabase
      .from('staff_bonuses').select('*, users:user_id(full_name, staff_profiles!staff_profiles_user_id_fkey(photo_url))')
      .eq('school_id', school_id).eq('month', m).eq('year', y)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// POST /hrms/bonuses — one row per user_id in the body, so "give
// everyone ₹2000 for Diwali" is a single call with every staff ID
// rather than N separate requests. Upserts on (user_id, month, year) —
// resubmitting for someone already awarded that month just updates the
// amount/reason instead of erroring or duplicating.
router.post('/bonuses', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = StaffBonusSchema.parse(req.body)
    const school_id = req.user!.school_id

    const rows = body.user_ids.map(user_id => ({
      school_id, user_id, month: body.month, year: body.year,
      amount: body.amount, reason: body.reason, created_by: req.user!.id,
    }))
    const { data, error } = await supabase
      .from('staff_bonuses').upsert(rows, { onConflict: 'user_id,month,year' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/bonuses/:id', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('staff_bonuses').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// PAYROLL SETTINGS — LOP grace/formula, professional tax slabs
// ═══════════════════════════════════════════════════════════════

router.get('/payroll/settings', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const [{ data: school }, { data: slabs }] = await Promise.all([
      supabase.from('schools').select('lop_grace_days, lop_per_day_formula').eq('id', school_id).single(),
      supabase.from('professional_tax_slabs').select('*').eq('school_id', school_id).order('min_gross'),
    ])
    res.json({ success: true, data: { ...school, professional_tax_slabs: slabs ?? [] } })
  })
)

router.put('/payroll/settings', requirePermissionV2('staff.payroll_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { lop_grace_days, lop_per_day_formula, professional_tax_slabs } = req.body
    const school_id = req.user!.school_id

    if (lop_grace_days !== undefined || lop_per_day_formula !== undefined) {
      const update: any = {}
      if (lop_grace_days !== undefined) update.lop_grace_days = lop_grace_days
      if (lop_per_day_formula !== undefined) update.lop_per_day_formula = lop_per_day_formula
      const { error } = await supabase.from('schools').update(update).eq('id', school_id)
      if (error) return res.status(400).json({ success: false, error: error.message })
    }

    if (Array.isArray(professional_tax_slabs)) {
      await supabase.from('professional_tax_slabs').delete().eq('school_id', school_id)
      if (professional_tax_slabs.length) {
        const { error } = await supabase.from('professional_tax_slabs').insert(
          professional_tax_slabs.map((s: any) => ({ school_id, min_gross: s.min_gross, max_gross: s.max_gross ?? null, amount: s.amount }))
        )
        if (error) return res.status(400).json({ success: false, error: error.message })
      }
    }

    res.json({ success: true })
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

router.post('/attendance', requirePermissionV2('staff.attendance_mark'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { records, date } = req.body
    const school_id = req.user!.school_id
    if (!date || !records?.length) return res.status(400).json({ success: false, error: 'date and records required' })

    // Fetch what each of these users was previously marked as (if
    // anything) before this upsert overwrites it — syncUnpaidLeaveOnAttendanceChange
    // needs the transition, not just the new status.
    const userIds = records.map((r: any) => r.user_id)
    const { data: existingRows } = await supabase.from('staff_attendance').select('user_id, status').eq('school_id', school_id).eq('date', date).in('user_id', userIds)
    const previousStatusByUser = new Map((existingRows ?? []).map(r => [r.user_id, r.status]))

    const rows = records.map((r: any) => ({
      school_id, user_id: r.user_id, date, status: r.status,
      check_in: r.check_in || null, check_out: r.check_out || null,
      overtime_hours: r.overtime_hours || 0,
      remarks: r.remarks || null, marked_by: req.user!.id,
    }))

    const { data, error } = await supabase.from('staff_attendance').upsert(rows, { onConflict: 'user_id,date' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })

    await Promise.all(rows.map(r => syncUnpaidLeaveOnAttendanceChange(school_id, r.user_id, date, previousStatusByUser.get(r.user_id) ?? null, r.status)))

    res.json({ success: true, data, count: rows.length })
  })
)

// Shared attendance rollup — extracted from GET /attendance/report so
// payslip generation's LOP computation (below) can reuse the exact same
// calendar-aware logic instead of duplicating ~80 lines of it. See the
// comment that used to sit on the route for the full "why" on working-
// days math and the on_leave dual-signal handling; unchanged here.
async function computeStaffAttendanceRollup(schoolId: string, userIds: string[], fromDate: string, toDate: string) {
  const nonWorkingSets = await getNonWorkingDaySets(schoolId, fromDate, toDate)

  const today = toLocalDateStr(new Date())
  const effectiveToDate = toDate > today ? today : toDate
  const workingDays = countWorkingDays(fromDate, effectiveToDate, nonWorkingSets)

  const [{ data: rawRecords, error: attErr }, { data: approvedLeaves, error: leaveErr }, { data: shiftAssignments }] = await Promise.all([
    userIds.length
      ? supabase.from('staff_attendance').select('user_id, date, status, overtime_hours')
          .eq('school_id', schoolId).in('user_id', userIds).gte('date', fromDate).lte('date', toDate)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from('leave_requests').select('user_id, from_date, to_date')
          .eq('school_id', schoolId).eq('status', 'approved').in('user_id', userIds)
          .lte('from_date', toDate).gte('to_date', fromDate)
      : Promise.resolve({ data: [], error: null }),
    // Per-user shift override — see the comment on rollupByUser below for
    // why this only forks the calculation for users who actually have one.
    userIds.length
      ? supabase.from('staff_profiles').select('user_id, staff_shifts(off_days)').eq('school_id', schoolId).in('user_id', userIds).not('shift_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])
  if (attErr) throw new Error(attErr.message)
  if (leaveErr) throw new Error(leaveErr.message)

  const shiftOffDaysByUser = new Map<string, Set<number>>()
  for (const row of shiftAssignments ?? []) {
    const shift = Array.isArray((row as any).staff_shifts) ? (row as any).staff_shifts[0] : (row as any).staff_shifts
    if (shift?.off_days) shiftOffDaysByUser.set((row as any).user_id, new Set(shift.off_days))
  }

  const records = (rawRecords ?? []).filter(r => isWorkingDate(r.date, nonWorkingSets))

  const byUser = new Map<string, { present: number; absent: number; half_day: number; overtime_hours: number }>()
  const leaveDatesByUser = new Map<string, Set<string>>()
  const addLeaveDate = (userId: string, date: string) => {
    if (!leaveDatesByUser.has(userId)) leaveDatesByUser.set(userId, new Set())
    leaveDatesByUser.get(userId)!.add(date)
  }

  for (const r of records) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { present: 0, absent: 0, half_day: 0, overtime_hours: 0 })
    const counts = byUser.get(r.user_id)!
    if (r.status === 'present') counts.present++
    else if (r.status === 'absent') counts.absent++
    else if (r.status === 'half_day') counts.half_day++
    else if (r.status === 'on_leave') addLeaveDate(r.user_id, r.date)
    counts.overtime_hours += Number((r as any).overtime_hours ?? 0)
  }

  for (const lr of approvedLeaves ?? []) {
    const start = lr.from_date < fromDate ? fromDate : lr.from_date
    const end = lr.to_date > toDate ? toDate : lr.to_date
    for (const key of dateRangeStrings(start, end)) {
      if (key <= effectiveToDate && isWorkingDate(key, nonWorkingSets)) addLeaveDate(lr.user_id, key)
    }
  }

  const rollupByUser = new Map<string, { present: number; absent: number; half_day: number; overtime_hours: number; on_leave: number; unmarked: number; working_days: number; percentage: number }>()
  for (const userId of userIds) {
    const counts = byUser.get(userId) ?? { present: 0, absent: 0, half_day: 0, overtime_hours: 0 }
    const leaveDates = leaveDatesByUser.get(userId) ?? new Set<string>()
    const on_leave = leaveDates.size

    // Users with no shift (the overwhelming majority) keep the cheap
    // shared `workingDays` figure. A user with a shift whose off-days
    // differ from the school-wide pattern gets their own count instead
    // — holidays still apply to everyone, only the weekly-off check
    // becomes per-user.
    const shiftOffDays = shiftOffDaysByUser.get(userId)
    const userWorkingDays = shiftOffDays
      ? dateRangeStrings(fromDate, effectiveToDate).filter(d => !nonWorkingSets.holidays.has(d) && !shiftOffDays.has(new Date(`${d}T00:00:00`).getDay())).length
      : workingDays

    const effectiveWorkingDays = Math.max(0, userWorkingDays - on_leave)
    const unmarked = Math.max(0, effectiveWorkingDays - (counts.present + counts.absent + counts.half_day))
    const percentage = effectiveWorkingDays > 0 ? Math.round((counts.present / effectiveWorkingDays) * 100) : 0
    rollupByUser.set(userId, { ...counts, on_leave, unmarked, working_days: effectiveWorkingDays, percentage })
  }

  return { rollupByUser, workingDays, holidaysInMonth: nonWorkingSets.holidays.size }
}

// GET /hrms/attendance/report — monthly per-staff rollup, same shape and
// working-days math as the student attendance report (shared academic
// calendar: weekly-off + holidays). department is an optional filter,
// staff's equivalent of "class-wise" scoping for students.
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
    .select('id, full_name, role, staff_profiles!staff_profiles_user_id_fkey(department, photo_url)')
    .eq('school_id', school_id).neq('role', 'student').neq('role', 'parent').order('full_name')
  if (staffErr) return res.status(500).json({ success: false, error: staffErr.message })

  let staff = (staffRaw ?? []).map((u: any) => {
    const profile = Array.isArray(u.staff_profiles) ? u.staff_profiles[0] : u.staff_profiles
    return { id: u.id, full_name: u.full_name, role: u.role, department: profile?.department ?? null, photo_url: profile?.photo_url ?? null }
  })
  if (department) staff = staff.filter(s => s.department === department)

  const { rollupByUser, workingDays, holidaysInMonth } = await computeStaffAttendanceRollup(school_id, staff.map(s => s.id), fromDate, toDate)

  const data = staff.map(s => ({
    user_id: s.id, full_name: s.full_name, role: s.role, department: s.department, photo_url: s.photo_url,
    ...rollupByUser.get(s.id)!,
  }))

  res.json({
    success: true,
    data: { staff: data, working_days: workingDays, holidays_in_month: holidaysInMonth, month: m, year: y },
  })
}))

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE REGULARIZATION — staff-initiated correction requests,
// routed through the generic workflow engine (same as Phase 1's exit
// settlement) rather than only admins being able to fix a mismarked
// day directly.
// ═══════════════════════════════════════════════════════════════

const RegularizeSchema = z.object({
  date: z.string(),
  requested_status: z.enum(['present', 'absent', 'half_day', 'on_leave']),
  reason: z.string().min(1),
})

// POST /hrms/attendance/regularize — self-service, no permission gate
// beyond authenticate. user_id is always the caller's own, exact same
// pattern as POST /leave-requests.
router.post('/attendance/regularize', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = RegularizeSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data, error } = await supabase.from('staff_attendance_regularizations').insert({
    school_id, user_id: req.user!.id, ...body, status: 'pending',
  }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  await ensureRegularizationWorkflowDefinition(school_id)
  const wfResult = await startWorkflow({
    schoolId: school_id, workflowName: 'Attendance Regularization Workflow',
    entityType: 'staff_attendance_regularization', entityId: data.id, initiatedBy: req.user!.id,
  })
  if (!wfResult.success) console.error('Failed to start regularization workflow:', wfResult.error)

  res.status(201).json({ success: true, data })
}))

// GET /hrms/attendance/regularizations?user_id=&status= — self-or-
// staff.attendance_mark, same isAdmin-branch shape as GET /leave-requests.
router.get('/attendance/regularizations', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, status } = req.query
  const school_id = req.user!.school_id
  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
  const isAdmin = isSuperRole || permissionCodes.has('staff.attendance_mark')

  let query = supabase.from('staff_attendance_regularizations')
    .select('*, users:user_id(full_name, role, staff_profiles!staff_profiles_user_id_fkey(photo_url))').eq('school_id', school_id).order('created_at', { ascending: false })

  if (!isAdmin) query = query.eq('user_id', req.user!.id)
  else if (user_id) query = query.eq('user_id', user_id as string)
  if (status) query = query.eq('status', status as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// POST /hrms/attendance/regularizations/:id/workflow-action — single-
// step, gated directly on staff.attendance_mark (the same permission
// that gates marking attendance in the first place — no Accountant-
// style actor mismatch risk here the way admission/TC's multi-step
// workflows had).
router.post('/attendance/regularizations/:id/workflow-action', requirePermissionV2('staff.attendance_mark'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, notes } = req.body
    const school_id = req.user!.school_id

    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })

    const { data: reg } = await supabase.from('staff_attendance_regularizations').select('*').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!reg) return res.status(404).json({ success: false, error: 'Regularization request not found' })

    const { data: instance, error: instErr } = await supabase
      .from('workflow_instances').select('id, status')
      .eq('entity_type', 'staff_attendance_regularization').eq('entity_id', id).eq('school_id', school_id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (instErr || !instance) return res.status(404).json({ success: false, error: 'No workflow found for this request' })
    if (instance.status !== 'in_progress') return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })

    const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status, notes })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })

    if (result.completed) {
      await supabase.from('staff_attendance_regularizations').update({
        status: result.instance.status, reviewed_by: req.user!.id, reviewed_at: new Date().toISOString(),
      }).eq('id', id)

      // On approval, actually apply the correction — same upsert-on-
      // conflict call POST /attendance itself uses.
      if (result.instance.status === 'approved') {
        const { data: existingAtt } = await supabase
          .from('staff_attendance').select('status').eq('school_id', school_id).eq('user_id', reg.user_id).eq('date', reg.date).maybeSingle()

        await supabase.from('staff_attendance').upsert({
          school_id, user_id: reg.user_id, date: reg.date, status: reg.requested_status,
          marked_by: req.user!.id, remarks: `Regularized: ${reg.reason}`,
        }, { onConflict: 'user_id,date' })

        await syncUnpaidLeaveOnAttendanceChange(school_id, reg.user_id, reg.date, existingAtt?.status ?? null, reg.requested_status)
      }
    }

    res.json({ success: true, data: { instance: result.instance, completed: result.completed } })
  })
)

// ═══════════════════════════════════════════════════════════════
// COMP-OFF — staff claims a day worked on a holiday/weekend, approved
// like a leave request, credited to the school's comp-off-flagged leave
// type on approval. Routed through the generic workflow engine, same
// shape as attendance regularization above.
// ═══════════════════════════════════════════════════════════════

// POST /hrms/comp-off — self-service claim, user_id always the caller's own.
router.post('/comp-off', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CompOffRequestSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data, error } = await supabase.from('staff_comp_off_requests').insert({
    school_id, user_id: req.user!.id, ...body, status: 'pending',
  }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  await ensureCompOffWorkflowDefinition(school_id)
  const wfResult = await startWorkflow({
    schoolId: school_id, workflowName: 'Comp-Off Approval Workflow',
    entityType: 'staff_comp_off_request', entityId: data.id, initiatedBy: req.user!.id,
  })
  if (!wfResult.success) console.error('Failed to start comp-off workflow:', wfResult.error)

  res.status(201).json({ success: true, data })
}))

// GET /hrms/comp-off?user_id=&status= — self-or-staff.leave_approve, same
// isAdmin-branch shape as GET /leave-requests / GET /attendance/regularizations.
router.get('/comp-off', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, status } = req.query
  const school_id = req.user!.school_id
  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
  const isAdmin = isSuperRole || permissionCodes.has('staff.leave_approve')

  let query = supabase.from('staff_comp_off_requests')
    .select('*, users:user_id(full_name, role, staff_profiles!staff_profiles_user_id_fkey(photo_url))').eq('school_id', school_id).order('created_at', { ascending: false })

  if (!isAdmin) query = query.eq('user_id', req.user!.id)
  else if (user_id) query = query.eq('user_id', user_id as string)
  if (status) query = query.eq('status', status as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// POST /hrms/comp-off/:id/workflow-action — single-step, gated directly
// on staff.leave_approve — the same permission that gates approving a
// leave request, since a comp-off claim credits the exact same balance.
router.post('/comp-off/:id/workflow-action', requirePermissionV2('staff.leave_approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, notes } = req.body
    const school_id = req.user!.school_id

    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })

    const { data: reqRow } = await supabase.from('staff_comp_off_requests').select('*').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!reqRow) return res.status(404).json({ success: false, error: 'Comp-off request not found' })

    const { data: instance, error: instErr } = await supabase
      .from('workflow_instances').select('id, status')
      .eq('entity_type', 'staff_comp_off_request').eq('entity_id', id).eq('school_id', school_id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (instErr || !instance) return res.status(404).json({ success: false, error: 'No workflow found for this request' })
    if (instance.status !== 'in_progress') return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })

    if (status === 'approved') {
      const { data: compOffType } = await supabase
        .from('leave_types').select('id, default_days_per_year, accrual_frequency').eq('school_id', school_id).eq('is_comp_off', true).maybeSingle()
      if (!compOffType) {
        return res.status(400).json({ success: false, error: 'No leave type is configured as comp-off yet — mark one via Manage Leave Types first.' })
      }
    }

    const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status, notes })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })

    if (result.completed) {
      await supabase.from('staff_comp_off_requests').update({
        status: result.instance.status, reviewed_by: req.user!.id, reviewed_at: new Date().toISOString(),
      }).eq('id', id)

      if (result.instance.status === 'approved') {
        const { data: compOffType } = await supabase
          .from('leave_types').select('id, default_days_per_year, accrual_frequency').eq('school_id', school_id).eq('is_comp_off', true).single()
        const year = new Date().getFullYear()
        const { data: balance } = await supabase
          .from('leave_balances').select('*').eq('user_id', reqRow.user_id).eq('leave_type_id', compOffType!.id).eq('year', year).maybeSingle()

        if (balance) {
          await supabase.from('leave_balances').update({ total_days: balance.total_days + 1 }).eq('id', balance.id)
        } else {
          await supabase.from('leave_balances').insert({
            school_id, user_id: reqRow.user_id, leave_type_id: compOffType!.id, year,
            total_days: defaultTotalDaysForType(compOffType!, year) + 1, used_days: 0,
          })
        }
      }
    }

    res.json({ success: true, data: { instance: result.instance, completed: result.completed } })
  })
)

// ═══════════════════════════════════════════════════════════════
// RECRUITMENT
// ═══════════════════════════════════════════════════════════════

const APPLICATION_STAGES = ['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined', 'rejected', 'withdrawn']

function avgRating(scorecards: { rating: number | null }[]): number | null {
  const rated = scorecards.filter(s => s.rating != null).map(s => Number(s.rating))
  if (!rated.length) return null
  return Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
}

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
router.post('/job-postings', requirePermissionV2('staff.recruitment_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = JobPostingSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data, error } = await supabase.from('job_postings').insert({ ...body, school_id, posted_by: req.user!.id }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// PATCH /hrms/job-postings/:id
router.patch('/job-postings/:id', requirePermissionV2('staff.recruitment_manage'),
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

  // Batch-attach avg_rating/interview_count so the kanban card can show
  // it without a per-card round trip — same one-query-then-match-in-JS
  // shape as the leave-balance batch-warnings code in GET /leave-requests.
  const appIds = (data ?? []).map(a => a.id)
  const { data: scorecards } = appIds.length
    ? await supabase.from('job_application_interviewers').select('application_id, rating').in('application_id', appIds)
    : { data: [] }

  const withRatings = (data ?? []).map(a => {
    const rows = (scorecards ?? []).filter(s => s.application_id === a.id)
    return { ...a, avg_rating: avgRating(rows), interview_count: rows.length }
  })

  res.json({ success: true, data: withRatings })
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
    .select(`*, job_postings(title, department, designation), assigned_user:assigned_to(full_name), application_status_history(*, users:changed_by(full_name)),
      job_application_interviewers(id, interviewer_id, rating, notes, created_at, interviewer:interviewer_id(full_name))`)
    .eq('id', id).eq('school_id', school_id).single()

  if (error || !data) return res.status(404).json({ success: false, error: 'Application not found' })
  res.json({ success: true, data: { ...data, avg_rating: avgRating((data as any).job_application_interviewers ?? []) } })
}))

// POST /hrms/applications - new candidate application
router.post('/applications', requirePermissionV2('staff.recruitment_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = JobApplicationSchema.parse(req.body)
  const school_id = req.user!.school_id

  const appNumber = await nextDocumentNumber(school_id, 'CAND')

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

router.patch('/applications/:id', requirePermissionV2('staff.recruitment_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, interview_date, interview_notes, rating, notes, role, email, background_check_status, background_check_notes } = req.body
    const school_id = req.user!.school_id

    if (status && !APPLICATION_STAGES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' })
    }
    const BACKGROUND_CHECK_STATUSES = ['not_started', 'in_progress', 'cleared', 'flagged']
    if (background_check_status && !BACKGROUND_CHECK_STATUSES.includes(background_check_status)) {
      return res.status(400).json({ success: false, error: 'Invalid background_check_status' })
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
    if (background_check_status !== undefined) update.background_check_status = background_check_status
    if (background_check_notes !== undefined) update.background_check_notes = background_check_notes
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

// POST /hrms/applications/:id/interviews — self-authored scorecard
// upsert. Not gated on staff.recruitment_manage: the person best placed
// to score a candidate (a subject-matter teacher on the interview
// panel) usually isn't whoever manages the recruitment pipeline. Same
// NON_STAFF_ROLES-only exclusion already used for admission/TC
// workflow-action routes, rather than a bespoke permission code.
const ScorecardSchema = z.object({
  rating: z.number().min(1).max(5),
  notes: z.string().optional(),
})
router.post('/applications/:id/interviews', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'Only staff can submit an interview scorecard' })
  }
  const { id } = req.params
  const school_id = req.user!.school_id
  const body = ScorecardSchema.parse(req.body)

  const { data: application } = await supabase.from('job_applications').select('id').eq('id', id).eq('school_id', school_id).single()
  if (!application) return res.status(404).json({ success: false, error: 'Application not found' })

  const { data, error } = await supabase
    .from('job_application_interviewers')
    .upsert({
      application_id: id, school_id, interviewer_id: req.user!.id,
      rating: body.rating, notes: body.notes, updated_at: new Date().toISOString(),
    }, { onConflict: 'application_id,interviewer_id' })
    .select('*, interviewer:interviewer_id(full_name)')
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// ═══════════════════════════════════════════════════════════════
// ROLE PERMISSIONS (legacy table — superseded by /api/rbac/roles/:id/permissions
// and role_permissions_v2. Kept for backward compatibility only;
// no longer used by the frontend after the RBAC unification.)
// ═══════════════════════════════════════════════════════════════

router.get('/role-permissions', requirePermissionV2('role.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('role_permissions').select('*').eq('school_id', req.user!.school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.put('/role-permissions', requirePermissionV2('role.manage'),
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

// Resolves a department filter to the user_ids it covers — shared by
// every report endpoint below so the one Department filter control on
// the page narrows all of them consistently, not just the by-department
// breakdown that already existed.
async function getUserIdsForDepartment(schoolId: string, department: string): Promise<string[]> {
  const { data } = await supabase.from('staff_profiles').select('user_id').eq('school_id', schoolId).eq('department', department)
  return (data ?? []).map(p => p.user_id)
}

router.get('/reports/headcount', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { department } = req.query as { department?: string }

  // Base the count on ALL staff (users table), not just rows that happen
  // to have a staff_profiles entry — a user with no profile (e.g. a
  // School Admin account that never went through staff onboarding) was
  // previously dropped from every breakdown here entirely, undercounting
  // relative to GET /staff/stats' total_staff. Same fix, same reasoning
  // as the Active-count bug on the Staff Directory.
  const [{ data: users, error: usersErr }, { data: profiles, error: profErr }] = await Promise.all([
    supabase.from('users').select('id').eq('school_id', school_id).neq('role', 'student').neq('role', 'parent'),
    supabase.from('staff_profiles').select('user_id, department, employment_type, employment_status').eq('school_id', school_id),
  ])
  if (usersErr) return res.status(500).json({ success: false, error: usersErr.message })
  if (profErr) return res.status(500).json({ success: false, error: profErr.message })

  const profileByUser = new Map((profiles ?? []).map(p => [p.user_id, p]))
  const NON_ACTIVE_STATUSES = new Set(['resigned', 'suspended', 'terminated'])

  const byDept: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  for (const u of users ?? []) {
    const p = profileByUser.get(u.id)
    const d = p?.department || 'Unassigned'
    if (department && d !== department) continue
    byDept[d] = (byDept[d] ?? 0) + 1
    const type = p?.employment_type || 'full_time'
    byType[type] = (byType[type] ?? 0) + 1
    // Same Active/Resigned/Suspended/Terminated model as GET /staff/stats
    // — a missing profile, or the deprecated 'on_leave' value (no longer
    // settable, kept only for legacy rows), both default to active.
    const status = NON_ACTIVE_STATUSES.has(p?.employment_status ?? '') ? p!.employment_status : 'active'
    byStatus[status] = (byStatus[status] ?? 0) + 1
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
  const { year, department } = req.query
  const school_id = req.user!.school_id
  const y = Number(year) || new Date().getFullYear()

  // Empty-but-valid result when a department filter matches nobody,
  // rather than an unfiltered .in('user_id', []) call (which some
  // PostgREST versions treat as "no filter at all" instead of "match
  // nothing").
  const deptUserIds = department ? await getUserIdsForDepartment(school_id, department as string) : null
  if (deptUserIds && deptUserIds.length === 0) {
    return res.json({ success: true, data: { year: y, total_requests: 0, approved: 0, total_days_taken: 0, by_leave_type: [], unpaid_emergency_days: 0 } })
  }

  // Total Requests / Approved / Days Taken / by-type are all one
  // coherent story about FORMAL leave applications, so they all read
  // from leave_requests consistently — mixing in leave_balances.used_days
  // (which also absorbs emergency absences, comp-off credits, and in a
  // freshly-seeded demo school isn't even seeded from the same numbers
  // as leave_requests) broke that story: "372 days taken" against "27
  // approved requests" doesn't hang together as a sentence.
  let reqQuery = supabase
    .from('leave_requests')
    .select('status, total_days, leave_types(name)')
    .eq('school_id', school_id)
    .gte('from_date', `${y}-01-01`)
    .lte('from_date', `${y}-12-31`)
  if (deptUserIds) reqQuery = reqQuery.in('user_id', deptUserIds)
  const { data: requests, error: reqErr } = await reqQuery
  if (reqErr) return res.status(500).json({ success: false, error: reqErr.message })

  const approved = (requests ?? []).filter((d: any) => d.status === 'approved')
  const totalDaysTaken = approved.reduce((s: number, d: any) => s + Number(d.total_days), 0)

  const byType: Record<string, number> = {}
  for (const d of approved as any[]) {
    const name = d.leave_types?.name ?? 'Unknown'
    byType[name] = (byType[name] ?? 0) + Number(d.total_days)
  }

  // Emergency absences — marked 'absent' directly on the attendance
  // sheet, never going through a formal application — are a genuinely
  // different thing from the requests above and reported as their own
  // distinct figure rather than folded into "by_leave_type", where they'd
  // recreate the same apples-vs-oranges confusion. This is exactly what
  // syncUnpaidLeaveOnAttendanceChange keeps updated.
  const { data: lwpType } = await supabase.from('leave_types').select('id').eq('school_id', school_id).eq('is_paid', false).limit(1).maybeSingle()
  let unpaidEmergencyDays = 0
  if (lwpType) {
    let lwpQuery = supabase.from('leave_balances').select('used_days').eq('school_id', school_id).eq('leave_type_id', lwpType.id).eq('year', y)
    if (deptUserIds) lwpQuery = lwpQuery.in('user_id', deptUserIds)
    const { data: lwpBalances } = await lwpQuery
    unpaidEmergencyDays = (lwpBalances ?? []).reduce((s, b) => s + Number(b.used_days), 0)
  }

  res.json({
    success: true,
    data: {
      year: y,
      total_requests: requests?.length ?? 0,
      approved: approved.length,
      total_days_taken: totalDaysTaken,
      by_leave_type: Object.entries(byType).map(([k, v]) => ({ name: k, days: v })),
      unpaid_emergency_days: unpaidEmergencyDays,
    },
  })
}))

router.get('/reports/payroll-summary', requirePermissionV2('staff.payroll_view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year, department } = req.query
    const school_id = req.user!.school_id
    const y = Number(year) || new Date().getFullYear()

    const deptUserIds = department ? await getUserIdsForDepartment(school_id, department as string) : null
    if (deptUserIds && deptUserIds.length === 0) {
      return res.json({ success: true, data: { year: y, monthly: [] } })
    }

    let query = supabase
      .from('payslips')
      .select('month, gross_salary, total_deductions, net_salary, payment_status')
      .eq('school_id', school_id)
      .eq('year', y)
    if (deptUserIds) query = query.in('user_id', deptUserIds)
    const { data, error } = await query

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
// REPORTS — ANALYTICS (attrition, attendance, recruitment funnel,
// payroll cost breakdown, document compliance). One consolidated
// endpoint rather than one per widget, same shape as the Principal
// Dashboard's single big aggregation call — this is inherently a slow
// analytics endpoint, not a hot path, same accepted tradeoff.
//
// Two definitions worth stating explicitly, since neither has a
// purpose-built field anywhere in the schema:
//   - Attrition/turnover rate = exits in the period ÷ CURRENT total
//     staff × 100. There's no historical daily-headcount table, so this
//     is the standard simplified formula, not the textbook
//     average-headcount version.
//   - "Documents missing" = staff with ZERO staff_documents rows at
//     all. There's no "required document types" concept anywhere in
//     this schema, so nothing is invented here — this is the honest,
//     derivable proxy, and the frontend labels it exactly as that.
// ═══════════════════════════════════════════════════════════════

async function computeAttrition(schoolId: string, year: number, targetUserIds: string[]) {
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`
  const { data: exits } = await supabase
    .from('staff_exits').select('user_id, last_working_day, reason')
    .eq('school_id', schoolId).gte('last_working_day', yStart).lte('last_working_day', yEnd)
    .in('user_id', targetUserIds.length ? targetUserIds : ['00000000-0000-0000-0000-000000000000'])

  const exitUserIds = (exits ?? []).map(e => e.user_id)
  const { data: profiles } = exitUserIds.length
    ? await supabase.from('staff_profiles').select('user_id, department, date_of_joining').in('user_id', exitUserIds)
    : { data: [] }
  const profileByUser = new Map((profiles ?? []).map(p => [p.user_id, p]))

  const byDept: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  let tenureSumDays = 0, tenureCount = 0
  for (const e of exits ?? []) {
    const p = profileByUser.get(e.user_id)
    const dept = p?.department || 'Unassigned'
    byDept[dept] = (byDept[dept] ?? 0) + 1
    const reason = (e.reason || '').trim() || 'Not specified'
    byReason[reason] = (byReason[reason] ?? 0) + 1
    if (p?.date_of_joining) {
      const days = Math.round((new Date(`${e.last_working_day}T00:00:00`).getTime() - new Date(`${p.date_of_joining}T00:00:00`).getTime()) / 86400000)
      if (days >= 0) { tenureSumDays += days; tenureCount++ }
    }
  }

  // Top 5 reasons + "Other" — reason is free text, so a long tail of
  // one-off phrasing isn't worth charting individually.
  const reasonEntries = Object.entries(byReason).sort((a, b) => b[1] - a[1])
  const by_reason = reasonEntries.slice(0, 5).map(([name, count]) => ({ name, count }))
  const otherCount = reasonEntries.slice(5).reduce((s, [, c]) => s + c, 0)
  if (otherCount > 0) by_reason.push({ name: 'Other', count: otherCount })

  const exitCount = exits?.length ?? 0
  const turnover_rate_pct = targetUserIds.length ? Math.round((exitCount / targetUserIds.length) * 1000) / 10 : 0

  return {
    turnover_rate_pct,
    exit_count: exitCount,
    by_department: Object.entries(byDept).map(([name, count]) => ({ name, count })),
    avg_tenure_days: tenureCount ? Math.round(tenureSumDays / tenureCount) : 0,
    by_reason,
  }
}

async function computeAttendanceAnalytics(schoolId: string, year: number, targetUserIds: string[]) {
  if (!targetUserIds.length) {
    return { avg_attendance_pct: 0, by_department_absenteeism: [], unmarked_trend: [], total_lop_days: 0 }
  }
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`

  const [{ rollupByUser }, { data: profiles }] = await Promise.all([
    computeStaffAttendanceRollup(schoolId, targetUserIds, yStart, yEnd),
    supabase.from('staff_profiles').select('user_id, department').in('user_id', targetUserIds),
  ])
  const deptByUser = new Map((profiles ?? []).map(p => [p.user_id, p.department || 'Unassigned']))

  let sumPresent = 0, sumWorkingDays = 0
  const byDeptAgg: Record<string, { absent: number; working: number }> = {}
  for (const uid of targetUserIds) {
    const r = rollupByUser.get(uid)
    if (!r) continue
    sumPresent += r.present
    sumWorkingDays += r.working_days
    const dept = deptByUser.get(uid) ?? 'Unassigned'
    if (!byDeptAgg[dept]) byDeptAgg[dept] = { absent: 0, working: 0 }
    byDeptAgg[dept].absent += r.absent
    byDeptAgg[dept].working += r.working_days
  }

  const avg_attendance_pct = sumWorkingDays > 0 ? Math.round((sumPresent / sumWorkingDays) * 1000) / 10 : 0
  const by_department_absenteeism = Object.entries(byDeptAgg)
    .map(([name, v]) => ({ name, absent_pct: v.working > 0 ? Math.round((v.absent / v.working) * 1000) / 10 : 0 }))
    .sort((a, b) => b.absent_pct - a.absent_pct)
    .slice(0, 5)

  // One point per elapsed month — capped at the current month for the
  // current year, same "don't project into days that haven't happened
  // yet" reasoning computeStaffAttendanceRollup already applies
  // internally. Parallelized; each call reuses the exact same
  // shift/leave-aware logic the LOP calculation itself trusts, rather
  // than a cheaper approximation.
  const now = new Date()
  const lastMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12
  const unmarked_trend = await Promise.all(
    Array.from({ length: lastMonth }, (_, i) => i + 1).map(async (m) => {
      const mStr = String(m).padStart(2, '0')
      const from = `${year}-${mStr}-01`
      const to = `${year}-${mStr}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`
      const { rollupByUser: monthRollup } = await computeStaffAttendanceRollup(schoolId, targetUserIds, from, to)
      const unmarked = targetUserIds.reduce((s, uid) => s + (monthRollup.get(uid)?.unmarked ?? 0), 0)
      return { month: m, unmarked }
    })
  )

  // Reuses the exact lop_days figure already computed and stored at
  // payslip-generation time — not recomputed independently, so this
  // always agrees with what the Payroll page itself shows.
  const { data: lopRows } = await supabase.from('payslips').select('lop_days').eq('school_id', schoolId).eq('year', year).in('user_id', targetUserIds)
  const total_lop_days = (lopRows ?? []).reduce((s, p) => s + Number(p.lop_days ?? 0), 0)

  return { avg_attendance_pct, by_department_absenteeism, unmarked_trend, total_lop_days }
}

async function computeRecruitmentFunnel(schoolId: string, year: number, department?: string) {
  const yStart = `${year}-01-01T00:00:00`, yEnd = `${year}-12-31T23:59:59`
  const { data: appsRaw } = await supabase
    .from('job_applications').select('id, created_at, status, job_postings(department)')
    .eq('school_id', schoolId).gte('created_at', yStart).lte('created_at', yEnd)

  // job_postings carries its own department — applications are
  // pre-hire candidates with no staff_profiles row yet, so the posting
  // they applied against is the only meaningful department filter here.
  const apps = (appsRaw ?? []).filter((a: any) => {
    if (!department) return true
    const posting = Array.isArray(a.job_postings) ? a.job_postings[0] : a.job_postings
    return posting?.department === department
  })

  const appIds = apps.map((a: any) => a.id)
  const { data: history } = appIds.length
    ? await supabase.from('application_status_history').select('application_id, status, created_at').in('application_id', appIds)
    : { data: [] }
  const historyByApp = new Map<string, any[]>()
  for (const h of history ?? []) {
    if (!historyByApp.has(h.application_id)) historyByApp.set(h.application_id, [])
    historyByApp.get(h.application_id)!.push(h)
  }

  let timeToHireSum = 0, timeToHireCount = 0
  let offeredCount = 0, acceptedCount = 0, declinedCount = 0
  for (const a of apps as any[]) {
    const hist = historyByApp.get(a.id) ?? []
    const offerEvent = hist.find(h => h.status === 'offer_sent')
    const joinedEvent = hist.find(h => h.status === 'joined')
    if (offerEvent) {
      offeredCount++
      if (joinedEvent) acceptedCount++
      else if (['withdrawn', 'rejected'].includes(a.status)) declinedCount++
    }
    if (joinedEvent) {
      const days = (new Date(joinedEvent.created_at).getTime() - new Date(a.created_at).getTime()) / 86400000
      if (days >= 0) { timeToHireSum += days; timeToHireCount++ }
    }
  }

  return {
    total_applications: apps.length,
    avg_time_to_hire_days: timeToHireCount ? Math.round(timeToHireSum / timeToHireCount) : 0,
    applied_to_offer_rate_pct: apps.length ? Math.round((offeredCount / apps.length) * 1000) / 10 : 0,
    offers_accepted: acceptedCount,
    offers_declined: declinedCount,
  }
}

async function computePayrollCost(schoolId: string, year: number, targetUserIds: string[]) {
  if (!targetUserIds.length) {
    return { by_department: [], total_pf: 0, total_pt: 0, total_tds: 0, avg_cost_per_employee: 0 }
  }
  const { data } = await supabase
    .from('payslips').select('user_id, gross_salary, pf_deduction, pf_employer, professional_tax, tds')
    .eq('school_id', schoolId).eq('year', year).in('user_id', targetUserIds)

  const payingUserIds = [...new Set((data ?? []).map(p => p.user_id))]
  const { data: profiles } = payingUserIds.length
    ? await supabase.from('staff_profiles').select('user_id, department').in('user_id', payingUserIds)
    : { data: [] }
  const deptByUser = new Map((profiles ?? []).map(p => [p.user_id, p.department || 'Unassigned']))

  const byDept: Record<string, number> = {}
  let totalPf = 0, totalPt = 0, totalTds = 0, totalCost = 0
  for (const p of data ?? []) {
    // "Cost to school," not take-home — gross plus the employer's own
    // PF contribution, distinct from total_pf below (the employee's
    // deducted share, a liability collected on their behalf).
    const cost = Number(p.gross_salary) + Number(p.pf_employer ?? 0)
    const dept = deptByUser.get(p.user_id) ?? 'Unassigned'
    byDept[dept] = (byDept[dept] ?? 0) + cost
    totalPf += Number(p.pf_deduction ?? 0)
    totalPt += Number(p.professional_tax ?? 0)
    totalTds += Number(p.tds ?? 0)
    totalCost += cost
  }

  return {
    by_department: Object.entries(byDept).map(([name, cost]) => ({ name, cost: Math.round(cost) })),
    total_pf: Math.round(totalPf),
    total_pt: Math.round(totalPt),
    total_tds: Math.round(totalTds),
    avg_cost_per_employee: payingUserIds.length ? Math.round(totalCost / payingUserIds.length) : 0,
  }
}

async function computeDocumentCompliance(schoolId: string, targetUserIds: string[]) {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3)
  const qStartStr = toLocalDateStr(new Date(now.getFullYear(), quarter * 3, 1))
  const qEndStr = toLocalDateStr(new Date(now.getFullYear(), quarter * 3 + 3, 0))

  if (!targetUserIds.length) return { expiring_this_quarter: 0, staff_with_no_documents: 0 }

  const [{ count: expiringCount }, { data: allDocs }] = await Promise.all([
    supabase.from('staff_documents').select('*', { count: 'exact', head: true })
      .eq('school_id', schoolId).not('expiry_date', 'is', null).gte('expiry_date', qStartStr).lte('expiry_date', qEndStr).in('user_id', targetUserIds),
    supabase.from('staff_documents').select('user_id').eq('school_id', schoolId).in('user_id', targetUserIds),
  ])
  const usersWithDocs = new Set((allDocs ?? []).map(d => d.user_id))
  const staff_with_no_documents = targetUserIds.filter(uid => !usersWithDocs.has(uid)).length

  return { expiring_this_quarter: expiringCount ?? 0, staff_with_no_documents }
}

router.get('/reports/analytics', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { year, department, compare } = req.query
  const school_id = req.user!.school_id
  const y = Number(year) || new Date().getFullYear()
  const doCompare = compare === 'true'

  // The one Department filter control on the page is meant to narrow
  // every panel — this resolves it once into a concrete user_id list
  // reused by every section below, same as the 3 existing endpoints.
  const { data: allUsers } = await supabase.from('users').select('id').eq('school_id', school_id).neq('role', 'student').neq('role', 'parent')
  let targetUserIds = (allUsers ?? []).map(u => u.id)
  if (department) {
    const deptIds = new Set(await getUserIdsForDepartment(school_id, department as string))
    targetUserIds = targetUserIds.filter(id => deptIds.has(id))
  }

  const computeForYear = async (yr: number) => {
    const [attrition, attendance, recruitment, payroll_cost] = await Promise.all([
      computeAttrition(school_id, yr, targetUserIds),
      computeAttendanceAnalytics(school_id, yr, targetUserIds),
      computeRecruitmentFunnel(school_id, yr, department as string | undefined),
      computePayrollCost(school_id, yr, targetUserIds),
    ])
    return { attrition, attendance, recruitment, payroll_cost }
  }

  const thirtyDaysOut = toLocalDateStr(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  const [current, previous, documents, openJobs, docsExpiringSoon] = await Promise.all([
    computeForYear(y),
    doCompare ? computeForYear(y - 1) : Promise.resolve(null),
    computeDocumentCompliance(school_id, targetUserIds),
    supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'open'),
    // Same 30-day definition as GET /staff/stats' documents_expiring_soon
    // — the KPI strip and the Staff Directory tile should never disagree
    // about what "expiring soon" means.
    supabase.from('staff_documents').select('*', { count: 'exact', head: true })
      .eq('school_id', school_id).not('expiry_date', 'is', null).lte('expiry_date', thirtyDaysOut).in('user_id', targetUserIds.length ? targetUserIds : ['00000000-0000-0000-0000-000000000000']),
  ])

  const total_payroll_ytd = current.payroll_cost.by_department.reduce((s, d) => s + d.cost, 0)

  res.json({
    success: true,
    data: {
      year: y,
      kpis: {
        attrition_rate_pct: current.attrition.turnover_rate_pct,
        avg_attendance_pct: current.attendance.avg_attendance_pct,
        total_payroll_ytd,
        open_positions: openJobs.count ?? 0,
        documents_expiring: docsExpiringSoon.count ?? 0,
      },
      attrition: current.attrition,
      attendance: current.attendance,
      recruitment: current.recruitment,
      payroll_cost: current.payroll_cost,
      documents,
      previous: previous ? { year: y - 1, ...previous } : null,
    },
  })
}))

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