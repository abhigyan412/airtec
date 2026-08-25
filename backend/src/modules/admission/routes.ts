import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler, getPagination, NON_STAFF_ROLES } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { getNonWorkingDaySets, isWorkingDate, toLocalDateStr } from '../../shared/utils/academicCalendar'
import { ensureAdmissionApprovalWorkflowDefinition, ensureEntranceResultWorkflowDefinition } from '../rbac/seed'
import {
  getClassSeatAvailability, applyLedgerTransition, checkClassLockOpen,
  releaseExpiredSeatHolds, processExpiredWaitlistOffers,
} from '../../shared/utils/admissionSeatLedger'

const router = Router()
router.use(authenticate)

/**
 * Does this approval finish the workflow — i.e. is the caller about to admit?
 *
 * Needed BEFORE actOnWorkflow runs. The student is created only after the
 * workflow completes, so a section check raised at that point would come too
 * late to refuse: the action is already recorded and the application already
 * flipped to 'admitted'. Refusing here costs nothing instead of leaving an
 * admitted application with no student behind it.
 *
 * Asking only on the final step is deliberate — making the counselor on step 1
 * choose a section is asking months before anyone knows the answer.
 */
async function isFinalApprovalStep(instanceId: string, schoolId: string): Promise<boolean> {
  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('workflow_id, current_step_id')
    .eq('id', instanceId).eq('school_id', schoolId).maybeSingle()
  if (!instance?.current_step_id) return false

  const [{ data: step }, { data: allSteps }] = await Promise.all([
    supabase.from('workflow_steps').select('step_order').eq('id', instance.current_step_id).maybeSingle(),
    supabase.from('workflow_steps').select('step_order').eq('workflow_id', instance.workflow_id),
  ])
  if (!step || !allSteps?.length) return false
  return step.step_order >= Math.max(...allSteps.map((s: any) => Number(s.step_order)))
}

/**
 * Creates the student record an admitted application becomes.
 *
 * section_id is required and validated against the class applied for, because
 * admission_applications only carries applying_for_class_id — there is no
 * section on an application, so nothing here was ever choosing one. Every
 * student admitted through this workflow landed with section_id NULL, which
 * hides them from every section-scoped screen and renders them in
 * /fees/collect as a phantom sectionless "Class 3" row sitting beside the real
 * Class 3-A and 3-B.
 *
 * admission_number was missing for the same reason: POST /students generates
 * one via nextDocumentNumber, this path never did, so admission-created
 * students had no number to be looked up or receipted by.
 */
async function createStudentForApplication(app: any, schoolId: string, sectionId: string) {
  const admissionNumber = await nextDocumentNumber(schoolId, 'ADM')
  return supabase.from('students').insert({
    school_id: schoolId,
    first_name: app.student_first_name,
    last_name: app.student_last_name,
    date_of_birth: app.date_of_birth,
    gender: app.gender,
    class_id: app.applying_for_class_id,
    section_id: sectionId,
    academic_year_id: app.academic_year_id,
    stream: app.stream,
    admission_number: admissionNumber,
    status: 'active',
    // The moment the admission fee was collected is the real "admitted
    // on" date — this call happens a beat later, in the same request,
    // right after fee_paid_at was set. Falls back to today defensively;
    // in practice app.fee_paid_at is always set by here (collect-fee is
    // the only caller).
    admission_date: (app.fee_paid_at ?? new Date().toISOString()).slice(0, 10),
  }).select().single()
}

/**
 * Rejects an admitting approval that names no section, or one belonging to a
 * different class than the application applied for.
 * Returns an error string to send back, or null when the caller may proceed.
 */
async function checkAdmissionSection(
  applicationId: string, schoolId: string, sectionId: unknown,
): Promise<string | null> {
  const { data: app } = await supabase
    .from('admission_applications')
    .select('applying_for_class_id, student_id')
    .eq('id', applicationId).eq('school_id', schoolId).maybeSingle()

  // Already enrolled — this approval creates nobody, so it needs no section.
  if (!app || app.student_id) return null

  if (!sectionId || typeof sectionId !== 'string') {
    return 'section_id is required to admit: pick the section this student will be enrolled into.'
  }
  const { data: section } = await supabase
    .from('sections').select('id, class_id')
    .eq('id', sectionId).eq('school_id', schoolId).maybeSingle()
  if (!section) return 'That section does not exist in this school.'
  if (section.class_id !== app.applying_for_class_id) {
    return 'That section belongs to a different class than the one applied for.'
  }
  return null
}

/**
 * Phase 5 of plan.md: mandatory document checklist, checked at the same
 * final-approval-step point as checkAdmissionSection above and following
 * its exact shape deliberately — this is an admission-module-level
 * pre-check, not a change to shared/middleware/workflow-engine.ts, which
 * TC approvals, HR exits, comp-off, and leave requests also depend on and
 * have no business knowing about admission document types.
 *
 * No requirements configured for the applied-for class = no block, same
 * "absence is permissive" convention used throughout this module.
 */
async function checkDocumentCompleteness(applicationId: string, schoolId: string): Promise<string | null> {
  const { data: app } = await supabase
    .from('admission_applications')
    .select('applying_for_class_id')
    .eq('id', applicationId).eq('school_id', schoolId).maybeSingle()
  if (!app?.applying_for_class_id) return null

  const { data: required } = await supabase
    .from('admission_document_requirements' as any)
    .select('document_type')
    .eq('school_id', schoolId).eq('class_id', app.applying_for_class_id)
  if (!required?.length) return null

  const { data: docs } = await supabase
    .from('application_documents')
    .select('document_type, is_verified')
    .eq('application_id', applicationId)
  const verifiedTypes = new Set((docs ?? []).filter((d: any) => d.is_verified).map((d: any) => d.document_type))
  const missing = (required as any[]).map(r => r.document_type).filter(t => !verifiedTypes.has(t))
  if (!missing.length) return null
  return `Missing verified document(s): ${missing.join(', ')}`
}

/**
 * Runs checkDocumentCompleteness and, if it blocks, checks for a valid
 * Principal override (decisions.md Phase 5: Principal-only, reason
 * required, logged) before deciding whether the caller is actually
 * stopped. Body fields: override_document_gap: true, override_reason.
 */
async function enforceDocumentCompleteness(applicationId: string, schoolId: string, req: AuthRequest): Promise<string | null> {
  const docProblem = await checkDocumentCompleteness(applicationId, schoolId)
  if (!docProblem) return null

  const canOverride = req.user!.role === 'principal' && req.body.override_document_gap === true
  if (!canOverride) return docProblem
  if (!req.body.override_reason?.trim()) return 'A reason is required to override missing documents.'

  await supabase.from('admission_applications').update({
    document_gap_override_at: new Date().toISOString(),
    document_gap_override_by: req.user!.id,
    document_gap_override_reason: req.body.override_reason.trim(),
  }).eq('id', applicationId).eq('school_id', schoolId)
  return null
}

/**
 * Re-checks the class still has room, right where checkAdmissionSection
 * and enforceDocumentCompleteness already run — before actOnWorkflow, not
 * after, same reasoning as isFinalApprovalStep's own doc comment. No seat
 * is reserved for an application until this exact moment (see
 * completeAdmissionWorkflow below), so a class that filled up while this
 * one was going through documents/entrance-test/approval must be caught
 * here, not discovered as a negative-availability surprise afterward.
 */
async function checkSeatStillAvailable(applicationId: string, schoolId: string): Promise<string | null> {
  const { data: app } = await supabase
    .from('admission_applications')
    .select('applying_for_class_id')
    .eq('id', applicationId).eq('school_id', schoolId).maybeSingle()
  if (!app?.applying_for_class_id) return null

  const seats = await getClassSeatAvailability(schoolId, app.applying_for_class_id)
  if (seats.capacity > 0 && seats.available <= 0) {
    return 'No seats remain available for this class. Consider waitlisting the inquiry instead of admitting.'
  }
  return null
}

/**
 * Runs once the admission-approval workflow instance completes (its
 * final step is acted on). Approval no longer means admitted directly:
 * it means the seat is reserved for the first time, the fee-hold clock
 * starts, and the application moves to Fee Pending — POST
 * .../collect-fee is what actually admits, confirms the seat, and
 * creates the student (see that endpoint). A rejection at any step
 * releases nothing, because nothing was ever reserved before this point.
 */
async function completeAdmissionWorkflow(
  id: string, schoolId: string, sectionId: unknown, approved: boolean, userId: string,
): Promise<'fee_pending' | 'rejected'> {
  if (!approved) {
    const { data: app } = await supabase
      .from('admission_applications')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id).eq('school_id', schoolId)
      .select('inquiry_id')
      .single()
    if (app?.inquiry_id) {
      await supabase.from('admission_inquiries').update({ status: 'rejected' }).eq('id', app.inquiry_id)
    }
    return 'rejected'
  }

  const { data: app } = await supabase
    .from('admission_applications')
    .select('applying_for_class_id, inquiry_id')
    .eq('id', id).eq('school_id', schoolId).maybeSingle()

  if (app?.applying_for_class_id) {
    await applyLedgerTransition(schoolId, app.applying_for_class_id, 'reserve', userId)
  }

  const { data: schoolRow } = await supabase.from('schools').select('admission_fee_hold_days').eq('id', schoolId).maybeSingle()
  const holdDays = (schoolRow as any)?.admission_fee_hold_days ?? 7
  const deadline = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000).toISOString()

  await supabase.from('admission_applications').update({
    status: 'fee_pending',
    admitted_section_id: typeof sectionId === 'string' ? sectionId : null,
    fee_hold_deadline: deadline,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('school_id', schoolId)

  // Keep the source inquiry's own pipeline stage in step with its
  // application — rejected and admitted already mirror back (see the
  // early-return above and POST .../collect-fee); this was the missing
  // middle transition, leaving a converted inquiry stuck showing "Docs
  // Submitted" even once its application had actually moved to Fee Pending.
  if (app?.inquiry_id) {
    await supabase.from('admission_inquiries').update({ status: 'fee_pending' }).eq('id', app.inquiry_id)
  }

  return 'fee_pending'
}

/**
 * Rejects a new inquiry/application for an academic year whose admission
 * cycle is explicitly closed. A school that never configures a cycle for
 * a year gets no admission_cycles row at all, which is treated as always
 * open — same NULL-means-unrestricted convention as schools.enabled_modules.
 */
export async function checkAdmissionCycleOpen(schoolId: string, academicYearId: unknown): Promise<string | null> {
  if (!academicYearId || typeof academicYearId !== 'string') return null

  const { data: cycle } = await supabase
    .from('admission_cycles' as any)
    .select('opens_at, closes_at')
    .eq('school_id', schoolId)
    .eq('academic_year_id', academicYearId)
    .maybeSingle()
  if (!cycle) return null

  const now = new Date()
  if (cycle.opens_at && now < new Date(cycle.opens_at)) {
    return `Admission for this academic year has not opened yet (opens ${new Date(cycle.opens_at).toLocaleDateString()}).`
  }
  if (cycle.closes_at && now > new Date(cycle.closes_at)) {
    return `Admission for this academic year closed on ${new Date(cycle.closes_at).toLocaleDateString()}.`
  }
  return null
}

// checkClassLockOpen, getClassSeatAvailability, and applyLedgerTransition
// now live in shared/utils/admissionSeatLedger.ts (imported above) — moved
// there in Phase 3 so the fee-hold expiry cron sweep can reuse them
// without a routes-file-to-routes-file import.

// ── Schemas ─────────────────────────────────────────────────
const CreateInquirySchema = z.object({
  student_name: z.string().min(1),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  parent_name: z.string().min(1),
  parent_phone: z.string().min(1),
  parent_email: z.string().optional(),
  applying_for_class_id: z.string().optional(),
  academic_year_id: z.string().optional(),
  stream: z.string().optional(),
  previous_school: z.string().optional(),
  previous_class: z.string().optional(),
  previous_percentage: z.number().optional(),
  source_id: z.string().optional(),
  counselor_id: z.string().optional(),
  notes: z.string().optional(),
  budget_range: z.string().optional(),
})
const UpdateInquirySchema = CreateInquirySchema.partial().extend({
  status: z.enum(['new','follow_up','interested','documents_submitted','entrance_exam','approved','waitlisted','fee_pending','admitted','rejected','lost']).optional(),
  waitlist_rank: z.number().int().optional(),
})

const CreateFollowUpSchema = z.object({
  follow_up_date: z.string(),
  channel: z.enum(['call', 'whatsapp', 'email', 'visit', 'sms']),
  notes: z.string().optional(),
  outcome: z.string().optional(),
  next_follow_up_date: z.string().optional(),
})

const CreateApplicationSchema = z.object({
  inquiry_id: z.string().uuid().optional(),
  student_first_name: z.string().min(1),
  student_last_name: z.string().min(1),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  father_name: z.string().optional(),
  father_phone: z.string().min(10),
  mother_name: z.string().optional(),
  mother_phone: z.string().optional(),
  applying_for_class_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  stream: z.string().optional(),
  previous_school: z.string().optional(),
})

const CollectFeeSchema = z.object({
  // Optional: falls back to the applying-for class's configured
  // admission_fee_amount (class-settings) when omitted — see
  // POST /applications/:id/collect-fee.
  amount: z.number().positive().optional(),
  method: z.enum(['cash', 'cheque', 'neft', 'card', 'upi', 'online', 'dd', 'wallet']),
  reference: z.string().optional(),
})

const AdmissionCycleSchema = z.object({
  academic_year_id: z.string().uuid(),
  opens_at: z.string().optional(),
  closes_at: z.string().optional(),
  notes: z.string().optional(),
})

// slot_type is deliberately generic — entrance_exam and interview now,
// campus_tour later — so all three share one scheduling entity instead
// of three near-identical ones.
const CreateSlotSchema = z.object({
  slot_type: z.enum(['entrance_exam', 'interview', 'campus_tour']),
  academic_year_id: z.string().uuid().optional(),
  class_id: z.string().uuid().optional(),
  title: z.string().min(1),
  location: z.string().optional(),
  starts_at: z.string(),
  ends_at: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  assigned_staff_id: z.string().uuid().optional(),
  notes: z.string().optional(),
})
const UpdateSlotSchema = CreateSlotSchema.partial()

const BookSlotSchema = z.object({
  inquiry_id: z.string().uuid().optional(),
  application_id: z.string().uuid().optional(),
}).refine(v => v.inquiry_id || v.application_id, { message: 'Either inquiry_id or application_id is required' })

const UpdateBookingSchema = z.object({
  status: z.enum(['booked', 'attended', 'no_show', 'cancelled']).optional(),
  result: z.string().optional(),
  // Phase 6b-i: manual marks entry (not auto-evaluation — a human types
  // these in, same as the exam module's student_marks.marks_obtained).
  marks_obtained: z.number().min(0).optional(),
  max_marks: z.number().positive().optional(),
})

// ── INQUIRIES ───────────────────────────────────────────────

router.get('/inquiries', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', search, status, counselor_id, source_id, academic_year_id } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('admission_inquiries')
    .select(`
      *,
      classes:applying_for_class_id(id, name, numeric_level),
      academic_years(id, name),
      users:counselor_id(id, full_name),
      inquiry_sources:source_id(id, name)
    `, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('student_name', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (counselor_id) query = query.eq('counselor_id', counselor_id)
  if (source_id) query = query.eq('source_id', source_id as string)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id as string)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

router.get('/inquiries/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  // remaining-work-plan.md Section B4: optional year scope, matching the
  // academic_year_id filter every other list view on this module already
  // gained 2026-08-25 — without it, this endpoint silently mixed every
  // session's activity together forever.
  const { academic_year_id } = req.query

  const statuses = ['new', 'follow_up', 'interested', 'documents_submitted', 'entrance_exam', 'approved', 'waitlisted', 'admitted', 'rejected', 'lost']
  const [counts, { data: sourceRows }] = await Promise.all([
    Promise.all(
      statuses.map(s => {
        let q = supabase.from('admission_inquiries')
          .select('*', { count: 'exact', head: true })
          .eq('school_id', school_id)
          .eq('status', s)
        if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
        return q.then(({ count }) => ({ status: s, count: count ?? 0 }))
      })
    ),
    // Grouped in JS rather than a per-source count(*) loop — sources are
    // admin-defined and open-ended (unlike the fixed status enum above),
    // so there's no fixed list to loop over up front. Also carries each
    // row's own status now, so the per-source conversion rate below can be
    // computed from the same single query rather than a second round trip.
    (() => {
      let q = supabase.from('admission_inquiries').select('status, inquiry_sources(name)').eq('school_id', school_id)
      if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
      return q
    })(),
  ])

  const total = counts.reduce((s, c) => s + c.count, 0)
  const admitted = counts.find(c => c.status === 'admitted')?.count ?? 0
  const conversion_rate = total > 0 ? Math.round((admitted / total) * 100) : 0

  // Funnel per source: how many inquiries came in vs. how many actually
  // converted all the way to admitted — the specific gap named in the
  // competitive comparison ("no lead-source/conversion funnel analytics").
  // "Reached application" reuses this same admission_inquiries.status
  // (documents_submitted onward means the inquiry has, at minimum,
  // progressed past a bare lead) rather than a second query against
  // admission_applications, since every application-stage status is
  // already mirrored back onto its source inquiry (see the 2026-08-21
  // "Fee sequencing rework" follow-up fix in plan.md).
  const PAST_INQUIRY_STAGE = new Set(['documents_submitted', 'entrance_exam', 'approved', 'waitlisted', 'fee_pending', 'admitted'])
  const bySourceStats = new Map<string, { total: number; reached_application: number; admitted: number }>()
  for (const row of (sourceRows ?? []) as any[]) {
    const name = row.inquiry_sources?.name ?? 'Unknown'
    const entry = bySourceStats.get(name) ?? { total: 0, reached_application: 0, admitted: 0 }
    entry.total++
    if (PAST_INQUIRY_STAGE.has(row.status)) entry.reached_application++
    if (row.status === 'admitted') entry.admitted++
    bySourceStats.set(name, entry)
  }
  const by_source = [...bySourceStats.entries()]
    .map(([source, s]) => ({
      source,
      count: s.total,
      reached_application: s.reached_application,
      admitted: s.admitted,
      conversion_rate: s.total > 0 ? Math.round((s.admitted / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  res.json({
    success: true,
    data: {
      by_status: counts,
      by_source,
      total,
      conversion_rate,
    },
  })
}))

// GET /admission-alerts — Phase 9: stage-aging (inquiries stuck at the
// same status past the school's threshold) and occupancy risk (a class
// running low on confirmed seats as its admission cycle nears close).
//
// Occupancy risk is checked against the SOONEST upcoming cycle close
// date, not per-class — admission_cycles is per (school, academic_year),
// not per class (Phase 1 deliberately kept the seat ledger un-year-scoped
// since classes/sections aren't year-scoped anywhere in this schema), so
// there's no clean class-to-cycle link to check individually. A school
// with one active cycle (the common case) gets exactly the intended
// behavior; multiple simultaneous cycles use whichever closes first.
router.get('/admission-alerts', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const now = new Date()

    const { data: school } = await supabase
      .from('schools')
      .select('admission_stage_aging_days, admission_occupancy_warning_percent, admission_occupancy_warning_days')
      .eq('id', school_id).maybeSingle()
    const agingDays = (school as any)?.admission_stage_aging_days ?? 10
    const occPercent = (school as any)?.admission_occupancy_warning_percent ?? 70
    const occDays = (school as any)?.admission_occupancy_warning_days ?? 60

    const ACTIVE_STATUSES = ['new', 'follow_up', 'interested', 'documents_submitted', 'entrance_exam', 'approved', 'waitlisted', 'fee_pending']
    const agingCutoff = new Date(now.getTime() - agingDays * 24 * 60 * 60 * 1000).toISOString()

    const { data: staleInquiries } = await supabase
      .from('admission_inquiries')
      .select('id, student_name, status, status_changed_at')
      .eq('school_id', school_id)
      .in('status', ACTIVE_STATUSES)
      .lt('status_changed_at', agingCutoff)
      .order('status_changed_at', { ascending: true })
      .limit(50)

    const stageAgingCounts = new Map<string, number>()
    for (const inq of (staleInquiries ?? []) as any[]) {
      stageAgingCounts.set(inq.status, (stageAgingCounts.get(inq.status) ?? 0) + 1)
    }

    const occCutoff = new Date(now.getTime() + occDays * 24 * 60 * 60 * 1000)
    const { data: soonestCycle } = await supabase
      .from('admission_cycles' as any)
      .select('closes_at')
      .eq('school_id', school_id)
      .not('closes_at', 'is', null)
      .gte('closes_at', now.toISOString())
      .order('closes_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    let occupancyWarnings: any[] = []
    const cycleClosesAt = (soonestCycle as any)?.closes_at ?? null
    if (cycleClosesAt && new Date(cycleClosesAt) <= occCutoff) {
      const [{ data: classes }, { data: ledgers }] = await Promise.all([
        supabase.from('classes').select('id, name').eq('school_id', school_id),
        supabase.from('admission_seat_ledger' as any).select('class_id, capacity, confirmed').eq('school_id', school_id),
      ])
      const ledgerByClass = new Map((ledgers ?? []).map((l: any) => [l.class_id, l]))
      occupancyWarnings = (classes ?? [])
        .map((c) => {
          const l = ledgerByClass.get(c.id) as any
          if (!l || !l.capacity) return null
          const occupancy_percent = Math.round((l.confirmed / l.capacity) * 100)
          if (occupancy_percent >= occPercent) return null
          return { class_id: c.id, class_name: c.name, occupancy_percent, capacity: l.capacity, confirmed: l.confirmed }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => a.occupancy_percent - b.occupancy_percent)
    }

    res.json({
      success: true,
      data: {
        stage_aging_days_threshold: agingDays,
        stage_aging_by_status: [...stageAgingCounts.entries()].map(([status, count]) => ({ status, count })),
        stage_aging_examples: staleInquiries ?? [],
        occupancy_warning_percent_threshold: occPercent,
        occupancy_warning_days_threshold: occDays,
        cycle_closes_at: cycleClosesAt,
        occupancy_warnings: occupancyWarnings,
      },
    })
  })
)

// GET /inquiry-sources — the list the "New Inquiry" form's Source
// dropdown needs. Nothing fetched this before — the form field existed
// in state but had no dropdown wired to it, so source_id was always
// null on every inquiry created through the app.
router.get('/inquiry-sources', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('inquiry_sources').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/inquiry-sources', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' })
    const { data, error } = await supabase
      .from('inquiry_sources').insert({ school_id: req.user!.school_id, name: name.trim() }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.get('/inquiries/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
 
  const { data, error } = await supabase
    .from('admission_inquiries')
    .select(`
      *,
      classes:applying_for_class_id(id, name, numeric_level),
      users:counselor_id(id, full_name, phone),
      inquiry_follow_ups(*, users:counselor_id(full_name))
    `)
    .eq('id', id)
    .eq('school_id', school_id)
    .single()
 
  if (error || !data) return res.status(404).json({ success: false, error: 'Inquiry not found' })
 
  const { data: linkedApplication } = await supabase
    .from('admission_applications')
    .select('id, application_number, status')
    .eq('inquiry_id', id)
    .eq('school_id', school_id)
    .maybeSingle()
 
  res.json({ success: true, data: { ...data, linked_application: linkedApplication ?? null } })
}))

router.post('/inquiries', requirePermissionV2('admission.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateInquirySchema.parse(req.body)
  const school_id = req.user!.school_id

  const cycleProblem = await checkAdmissionCycleOpen(school_id, body.academic_year_id)
  if (cycleProblem) return res.status(400).json({ success: false, error: cycleProblem })

  const counselor_id = body.counselor_id ?? (req.user!.role === 'counselor' ? req.user!.id : undefined)
 
  const inquiryNumber = await nextDocumentNumber(school_id, 'INQ')
 
  // Sanitize empty strings to null for fields that may be UUIDs or
  // optional dates/numbers — an empty string "" is not a valid uuid
  // and Postgres will reject the insert with "invalid input syntax
  // for type uuid" if any of these are left as "" from an unselected
  // dropdown on the frontend.
  const cleanBody = Object.fromEntries(
    Object.entries({ ...body, counselor_id }).map(([k, v]) => [k, v === '' ? null : v])
  )
 
  const { data, error } = await supabase
    .from('admission_inquiries')
    .insert({ ...cleanBody, school_id, inquiry_number: inquiryNumber })
    .select()
    .single()
 
  if (error) return res.status(400).json({ success: false, error: error.message })
 
  res.status(201).json({ success: true, data })
}))



router.post('/inquiries/:id/convert-to-application', requirePermissionV2('admission.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
 
  const { data: inquiry, error: inqErr } = await supabase
    .from('admission_inquiries')
    .select('*')
    .eq('id', id)
    .eq('school_id', school_id)
    .single()
 
  if (inqErr || !inquiry) {
    return res.status(404).json({ success: false, error: 'Inquiry not found' })
  }
 
  // Prevent duplicate conversion — check if an application already
  // exists for this inquiry.
  const { data: existingApp } = await supabase
    .from('admission_applications')
    .select('id')
    .eq('inquiry_id', id)
    .eq('school_id', school_id)
    .maybeSingle()
 
  if (existingApp) {
    return res.status(400).json({
      success: false,
      error: 'This inquiry already has a linked application',
      application_id: existingApp.id,
    })
  }
 
  // Split the inquiry's single student_name into first/last (best
  // effort — admission_applications has separate first/last name
  // columns while admission_inquiries has one combined field).
  const nameParts = (inquiry.student_name ?? '').trim().split(/\s+/)
  const student_first_name = nameParts[0] ?? inquiry.student_name ?? 'Unknown'
  const student_last_name = nameParts.slice(1).join(' ') || '-'
 
  const appNumber = await nextDocumentNumber(school_id, 'APP')
 
  const { data: application, error } = await supabase
    .from('admission_applications')
    .insert({
      school_id,
      inquiry_id: id,
      application_number: appNumber,
      student_first_name,
      student_last_name,
      date_of_birth: inquiry.date_of_birth || null,
      gender: inquiry.gender || null,
      father_phone: inquiry.parent_phone, // required field on applications; inquiries only have one parent_phone
      father_name: inquiry.parent_name || null,
      applying_for_class_id: inquiry.applying_for_class_id || null,
      academic_year_id: inquiry.academic_year_id || null,
      previous_school: inquiry.previous_school || null,
      counselor_id: inquiry.counselor_id || req.user!.id,
    })
    .select()
    .single()
 
  if (error) {
    return res.status(400).json({ success: false, error: error.message })
  }
 
  // Mark the inquiry as having moved into formal application stage
  await supabase.from('admission_inquiries').update({ status: 'documents_submitted' }).eq('id', id)
 
  // Auto-start the Admission Approval Workflow (Counselor -> Principal -> School Admin)
  await ensureAdmissionApprovalWorkflowDefinition(school_id)
  const wfResult = await startWorkflow({
    schoolId: school_id,
    workflowName: 'Admission Approval Workflow',
    entityType: 'admission_application',
    entityId: application.id,
    initiatedBy: req.user!.id,
  })
 
  if (!wfResult.success) {
    console.error(`Failed to start admission workflow for converted application ${application.id}:`, wfResult.error)
  }
 
  res.status(201).json({ success: true, data: application })
}))
 
router.patch('/inquiries/:id', requirePermissionV2('admission.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const body = UpdateInquirySchema.parse(req.body)
  const school_id = req.user!.school_id
 
  // 'admitted' and 'fee_pending' can ONLY be set automatically when the
  // linked admission_application's workflow completes with final approval
  // (see completeAdmissionWorkflow, called from POST /applications/:id/approve
  // and /workflow-action) or its fee is collected — never via direct manual
  // status change. Without this, a manual pick here could drift from what
  // the linked application is actually doing, which is exactly the kind of
  // cross-page desync this status is meant to prevent, not cause.
  if (body.status === 'admitted' || body.status === 'fee_pending') {
    return res.status(400).json({
      success: false,
      error: `Inquiries can't be marked '${body.status}' directly. Convert this inquiry to a formal application and progress it through the Admission Approval Workflow — this status updates automatically from there.`,
    })
  }
 
  const { data, error } = await supabase
    .from('admission_inquiries')
    // Phase 7: every other write path in this module tracks who acted —
    // this was the one gap, since a direct PATCH can change anything
    // (status included) with no actor otherwise recorded.
    .update({ ...body, updated_by: req.user!.id })
    .eq('id', id)
    .eq('school_id', school_id)
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  res.json({ success: true, data })
}))

// ── FOLLOW-UPS ──────────────────────────────────────────────

router.post('/inquiries/:id/follow-ups', requirePermissionV2('admission.follow_up'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const body = CreateFollowUpSchema.parse(req.body)
  const school_id = req.user!.school_id

  // Verify inquiry belongs to school
  const { data: inquiry } = await supabase
    .from('admission_inquiries').select('id').eq('id', id).eq('school_id', school_id).single()
  if (!inquiry) return res.status(404).json({ success: false, error: 'Inquiry not found' })

  const { data, error } = await supabase
    .from('inquiry_follow_ups')
    .insert({ ...body, inquiry_id: id, counselor_id: req.user!.id })
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // Auto-update inquiry status to follow_up if still new
  await supabase
    .from('admission_inquiries')
    .update({ status: 'follow_up' })
    .eq('id', id)
    .eq('status', 'new')

  res.status(201).json({ success: true, data })
}))

// ── APPLICATIONS ────────────────────────────────────────────

router.get('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', status, search, class_id, date_from, date_to, academic_year_id } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('admission_applications')
    .select(`
      *,
      classes:applying_for_class_id(id, name, numeric_level),
      users:counselor_id(id, full_name)
    `, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (class_id) query = query.eq('applying_for_class_id', class_id as string)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id as string)
  // One box searching name/phone/application number — same multi-column
  // .or() ilike idiom used for job-application search in hrms/routes.ts.
  if (search) {
    query = query.or(
      `student_first_name.ilike.%${search}%,student_last_name.ilike.%${search}%,father_phone.ilike.%${search}%,application_number.ilike.%${search}%`
    )
  }
  if (date_from) query = query.gte('created_at', `${date_from}T00:00:00`)
  // A plain date string compared with .lte() means midnight — that
  // silently excludes the rest of the "to" day itself, so push the
  // bound to the end of that day instead.
  if (date_to) query = query.lte('created_at', `${date_to}T23:59:59`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  // Batch-attach each application's live workflow state — same "one
  // query, then match in JS" idiom used elsewhere in this file (e.g.
  // the scorecard avg-rating batch-attach in hrms/routes.ts). The
  // admission_applications.status column itself only ever moves
  // pending -> admitted/rejected (see POST .../workflow-action below);
  // everything in between only lives in workflow_instances/steps, so a
  // list view has no way to show real progress without this.
  const appIds = (data ?? []).map(a => a.id)
  const { data: instances } = appIds.length
    ? await supabase.from('workflow_instances').select('entity_id, status, current_step_id').eq('entity_type', 'admission_application').in('entity_id', appIds)
    : { data: [] }
  const stepIds = [...new Set((instances ?? []).map(i => i.current_step_id).filter(Boolean))]
  const { data: steps } = stepIds.length
    ? await supabase.from('workflow_steps').select('id, action_name').in('id', stepIds)
    : { data: [] }
  const stepNameById = new Map((steps ?? []).map(s => [s.id, s.action_name]))
  const instanceByAppId = new Map((instances ?? []).map(i => [i.entity_id, i]))

  const withWorkflow = (data ?? []).map(app => {
    const instance = instanceByAppId.get(app.id)
    return {
      ...app,
      workflow_status: instance?.status ?? null,
      current_step_name: instance?.current_step_id ? stepNameById.get(instance.current_step_id) ?? null : null,
    }
  })

  res.json({ success: true, data: withWorkflow, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

// GET /applications/:id — single application detail
router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const { data, error } = await supabase
    .from('admission_applications')
    .select(`
      *,
      classes ( id, name, numeric_level ),
      users:counselor_id ( id, full_name )
    `)
    .eq('id', id)
    .eq('school_id', school_id)
    .single()

  if (error || !data) {
    return res.status(404).json({ success: false, error: 'Application not found' })
  }

  // Same workflow_status/current_step_name attachment as GET /applications
  // (list) — keeps this page's own header badge showing the same live
  // stage instead of a bare "Pending" while the pipeline below it shows
  // the real detail.
  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('status, current_step_id')
    .eq('entity_type', 'admission_application')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let current_step_name: string | null = null
  if (instance?.current_step_id) {
    const { data: step } = await supabase.from('workflow_steps').select('action_name').eq('id', instance.current_step_id).maybeSingle()
    current_step_name = step?.action_name ?? null
  }

  res.json({ success: true, data: { ...data, workflow_status: instance?.status ?? null, current_step_name } })
}))

router.post('/applications', requirePermissionV2('admission.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateApplicationSchema.parse(req.body)
  const school_id = req.user!.school_id

  const cycleProblem = await checkAdmissionCycleOpen(school_id, body.academic_year_id)
  if (cycleProblem) return res.status(400).json({ success: false, error: cycleProblem })

  if (body.applying_for_class_id) {
    const lockProblem = await checkClassLockOpen(school_id, body.applying_for_class_id)
    if (lockProblem) return res.status(400).json({ success: false, error: lockProblem })

    const seats = await getClassSeatAvailability(school_id, body.applying_for_class_id)
    if (seats.capacity > 0 && seats.available <= 0) {
      return res.status(400).json({ success: false, error: 'No seats available for this class. Consider waitlisting the inquiry instead.' })
    }
  }

  const appNumber = await nextDocumentNumber(school_id, 'APP')

  const { data, error } = await supabase
    .from('admission_applications')
    .insert({ ...body, school_id, application_number: appNumber, counselor_id: req.user!.id })
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // No seat is reserved here — only checked for availability above. A
  // seat is held (and the fee-hold clock started) only once the
  // Counselor -> Principal -> Admin approval chain actually completes and
  // the application moves to Fee Pending (see the workflow-completion
  // handlers below). Reserving this early would tie up a seat for the
  // entire vetting process — documents, entrance test, multi-step
  // approval — before the school has actually decided to admit anyone.

  // If linked to inquiry, update inquiry status
  if (body.inquiry_id) {
    await supabase.from('admission_inquiries')
      .update({ status: 'documents_submitted' }).eq('id', body.inquiry_id)
  }

  // Start the Admission Approval Workflow for this new application.
  // Fire-and-forget: don't fail application creation if the workflow
  // fails to start — just log it so an admin can manually start it
  // later via POST /applications/:id/start-workflow if needed.
  await ensureAdmissionApprovalWorkflowDefinition(school_id)
  const wfResult = await startWorkflow({
    schoolId: school_id,
    workflowName: 'Admission Approval Workflow',
    entityType: 'admission_application',
    entityId: data.id,
    initiatedBy: req.user!.id,
  })

  if (!wfResult.success) {
    console.error(`Failed to start admission workflow for application ${data.id}:`, wfResult.error)
  }

  res.status(201).json({ success: true, data })
}))

// ── APPROVAL WORKFLOW ────────────────────────────────────────
// This endpoint now delegates entirely to the workflow engine
// (workflow_instances / workflow_approvals / workflow_steps), so
// there is a single source of truth for approval state. The old
// counselor_approved_at / accountant_approved_at / principal_approved_at
// columns on admission_applications are no longer written to by this
// endpoint, but remain in the table (unused) for backward compatibility.
//
// Body: { status: 'approved' | 'rejected', notes?: string }
// (Kept loosely typed to also accept the old { action: 'approve'|'reject' }
// shape from any legacy frontend callers — see normalization below.)
router.post(
  '/applications/:id/approve',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    // This had no gate at all before — any authenticated user could hit
    // it. Only excluding NON_STAFF_ROLES here rather than gating on
    // admission.approve specifically: actOnWorkflow() below already does
    // the real, authoritative per-step check (it verifies the caller
    // holds whatever RBAC role the current workflow step's role_id names
    // — Counselor/Accountant/Principal per the pipeline this workflow is
    // documented as using). Accountant, a legitimate step actor here,
    // isn't granted admission.approve by default, so gating on that code
    // would have blocked their real approval step before actOnWorkflow
    // ever got a chance to correctly authorize them.
    if (NON_STAFF_ROLES.includes(req.user!.role)) {
      return res.status(403).json({ success: false, error: 'Not authorized to act on admission applications' })
    }

    // Normalize legacy { action: 'approve' | 'reject' } -> { status }
    const rawStatus = req.body.status ?? (req.body.action === 'approve' ? 'approved' : req.body.action === 'reject' ? 'rejected' : undefined)
    const notes = req.body.notes

    if (!['approved', 'rejected'].includes(rawStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Must be approved or rejected (or legacy action: approve/reject).' })
    }

    // Find the active workflow instance for this application
    const { data: instance, error: instErr } = await supabase
      .from('workflow_instances')
      .select('id, status')
      .eq('entity_type', 'admission_application')
      .eq('entity_id', id)
      .eq('school_id', school_id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (instErr || !instance) {
      return res.status(404).json({
        success: false,
        error: 'No workflow found for this application. This application may predate the workflow system — use POST /applications/:id/start-workflow first.',
      })
    }

    if (instance.status !== 'in_progress') {
      return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
    }

    // Before acting, not after — see isFinalApprovalStep.
    if (rawStatus === 'approved' && await isFinalApprovalStep(instance.id, school_id)) {
      const problem = await checkAdmissionSection(id, school_id, req.body.section_id)
        ?? await enforceDocumentCompleteness(id, school_id, req)
        ?? await checkSeatStillAvailable(id, school_id)
      if (problem) return res.status(400).json({ success: false, error: problem })
    }

    const result = await actOnWorkflow({
      instanceId: instance.id,
      userId: req.user!.id,
      schoolId: school_id,
      status: rawStatus,
      notes,
    })

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    let newAppStatus: 'fee_pending' | 'rejected' | null = null
    if (result.completed) {
      newAppStatus = await completeAdmissionWorkflow(
        id, school_id, req.body.section_id, result.instance.status === 'approved', req.user!.id,
      )
    }

    res.json({
      success: true,
      data: {
        instance: result.instance,
        completed: result.completed,
        next_step: result.nextStep ?? null,
        application_status: newAppStatus,
      },
      message: 'Note: prefer POST /applications/:id/workflow-action for full control (approve/reject/comment/escalate).',
    })
  })
)

// ── WORKFLOW: generic action endpoint (approve/reject/escalate/comment) ──
// Same reasoning as POST /applications/:id/approve above — excludes
// non-staff only, defers to actOnWorkflow's own per-step role check.
router.post('/applications/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { status, notes, section_id } = req.body
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'Not authorized to act on admission applications' })
  }

  if (!['approved', 'rejected', 'escalated', 'commented'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be approved, rejected, escalated, or commented.' })
  }

  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'admission_application')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instErr || !instance) {
    return res.status(404).json({ success: false, error: 'No workflow instance found for this application. It may not have been started.' })
  }

  // Before acting, not after — see isFinalApprovalStep.
  if (status === 'approved' && await isFinalApprovalStep(instance.id, school_id)) {
    const problem = await checkAdmissionSection(id, school_id, section_id)
      ?? await enforceDocumentCompleteness(id, school_id, req)
      ?? await checkSeatStillAvailable(id, school_id)
    if (problem) return res.status(400).json({ success: false, error: problem })
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

  let newAppStatus: 'fee_pending' | 'rejected' | null = null
  if (result.completed) {
    newAppStatus = await completeAdmissionWorkflow(
      id, school_id, section_id, result.instance.status === 'approved', req.user!.id,
    )
  }

  res.json({
    success: true,
    data: {
      instance: result.instance,
      completed: result.completed,
      next_step: result.nextStep ?? null,
      application_status: newAppStatus,
    },
  })
}))

// ── WORKFLOW: status (pipeline UI) ────────────────────────────────
router.get('/applications/:id/workflow-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const status = await getWorkflowStatus('admission_application', id, school_id)

  if (!status) {
    return res.json({ success: true, data: null, message: 'No workflow started for this application' })
  }

  res.json({ success: true, data: status })
}))

// ── WORKFLOW: manually (re)start (admin/principal only) ────────────
router.post('/applications/:id/start-workflow', requirePermissionV2('admission.approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: application, error: appErr } = await supabase
      .from('admission_applications')
      .select('id')
      .eq('id', id)
      .eq('school_id', school_id)
      .single()

    if (appErr || !application) {
      return res.status(404).json({ success: false, error: 'Application not found' })
    }

    await ensureAdmissionApprovalWorkflowDefinition(school_id)
    const result = await startWorkflow({
      schoolId: school_id,
      workflowName: 'Admission Approval Workflow',
      entityType: 'admission_application',
      entityId: id,
      initiatedBy: req.user!.id,
    })

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    res.json({ success: true, data: result.instance })
  })
)

// ── APPLICATION DOCUMENTS ─────────────────────────────────────
// Uses the same base64-in-JSON upload pattern as student-documents /
// staff-documents (no multer) — a public 'admission-documents' bucket,
// path scoped ${school_id}/${application_id}/${timestamp}_${file_name}.
router.get('/applications/:id/documents', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: app } = await supabase
      .from('admission_applications').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' })

    const { data, error } = await supabase
      .from('application_documents')
      .select('*, users:uploaded_by(full_name), verifier:verified_by(full_name)')
      .eq('application_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/applications/:id/documents', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { file_base64, file_name, mime_type, document_type, document_name, notes } = req.body

    if (!file_base64 || !file_name) {
      return res.status(400).json({ success: false, error: 'file_base64 and file_name are required' })
    }

    const { data: app } = await supabase
      .from('admission_applications').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' })

    const base64Data = file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const filePath = `${school_id}/${id}/${Date.now()}_${file_name}`

    const { error: uploadErr } = await supabase.storage
      .from('admission-documents')
      .upload(filePath, buffer, { contentType: mime_type ?? 'application/octet-stream', upsert: false })
    if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })

    const { data: urlData } = supabase.storage.from('admission-documents').getPublicUrl(filePath)
    const fileSize = buffer.length > 1024 * 1024
      ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB`
      : `${(buffer.length / 1024).toFixed(0)} KB`

    const { data, error } = await supabase
      .from('application_documents')
      .insert({
        application_id: id,
        school_id,
        document_type: document_type ?? 'other',
        document_name: document_name ?? file_name,
        file_url: urlData.publicUrl,
        mime_type,
        file_size: fileSize,
        uploaded_by: req.user!.id,
        notes,
      })
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.patch('/applications/:id/documents/:docId', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, docId } = req.params
    const school_id = req.user!.school_id
    const { is_verified } = req.body

    if (typeof is_verified !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_verified (boolean) is required' })
    }

    const { data, error } = await supabase
      .from('application_documents')
      .update({
        is_verified,
        verified_by: is_verified ? req.user!.id : null,
        verified_at: is_verified ? new Date().toISOString() : null,
      })
      .eq('id', docId)
      .eq('application_id', id)
      .eq('school_id', school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// Phase 7: soft delete — a hard delete erased a verified document's
// entire trail (who uploaded it, who verified it) with no trace at all.
// GET .../documents already filters deleted_at IS NULL.
router.delete('/applications/:id/documents/:docId', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, docId } = req.params
    const school_id = req.user!.school_id

    const { error } = await supabase
      .from('application_documents')
      .update({ deleted_at: new Date().toISOString(), deleted_by: req.user!.id })
      .eq('id', docId)
      .eq('application_id', id)
      .eq('school_id', school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── ADMISSION FEE ────────────────────────────────────────────
// Deliberately admission-internal: an application has no student_id
// until it's admitted, and fee_invoices.student_id is NOT NULL, so this
// does not create a Fee-module invoice. It's a lightweight paid/unpaid
// record with an audit trail, not an accounting entry.
//
// Only usable once the admission-approval chain has completed and the
// application is Fee Pending — paying is what actually admits: confirms
// the seat (reserved -> confirmed) and creates the student + parent
// records, using the section chosen at approval time
// (admitted_section_id). Before Fee Pending there's nothing to pay for
// yet (no seat is even reserved); after Admitted there's nothing left to
// pay again.
router.post('/applications/:id/collect-fee', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const body = CollectFeeSchema.parse(req.body)

    const { data: existing } = await supabase
      .from('admission_applications')
      .select('*')
      .eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!existing) return res.status(404).json({ success: false, error: 'Application not found' })
    if (existing.status !== 'fee_pending') {
      return res.status(400).json({
        success: false,
        error: existing.status === 'admitted'
          ? 'This application has already been admitted and its fee collected.'
          : 'The admission fee can only be collected once the application has cleared Counselor → Principal → Admin approval and is Fee Pending.',
      })
    }

    // amount is optional on the request — falls back to the class's own
    // configured admission_fee_amount (Settings → Slots → Entrance Mode
    // & Admission Fee) so a school that's set one doesn't have to type it
    // in by hand every time. Still overridable per-application (a
    // scholarship, a sibling discount) by just sending an amount.
    let amount = body.amount
    if (amount === undefined && existing.applying_for_class_id) {
      const { data: classSetting } = await supabase
        .from('admission_class_settings' as any)
        .select('admission_fee_amount')
        .eq('school_id', school_id).eq('class_id', existing.applying_for_class_id).maybeSingle()
      amount = (classSetting as any)?.admission_fee_amount ?? undefined
    }
    if (amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'No admission fee is configured for this class, and no amount was given. Enter an amount, or set one for this class first.',
      })
    }

    const { data: app, error } = await supabase
      .from('admission_applications')
      .update({
        application_fee_paid: true,
        application_fee_amount: amount,
        fee_paid_at: new Date().toISOString(),
        fee_payment_method: body.method,
        fee_payment_reference: body.reference ?? null,
        fee_collected_by: req.user!.id,
        fee_hold_deadline: null,
        status: 'admitted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('school_id', school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    await applyLedgerTransition(school_id, app.applying_for_class_id, 'confirm', req.user!.id)

    let createdStudent = null
    if (!app.student_id) {
      const { data: student } = await createStudentForApplication(app, school_id, app.admitted_section_id)
      if (student) {
        createdStudent = student
        await supabase.from('admission_applications').update({ student_id: student.id }).eq('id', id)
        await supabase.from('parents').insert({
          school_id, student_id: student.id,
          father_name: app.father_name, father_phone: app.father_phone,
          mother_name: app.mother_name, mother_phone: app.mother_phone,
        })
      }
      if (app.inquiry_id) {
        await supabase.from('admission_inquiries').update({ status: 'admitted' }).eq('id', app.inquiry_id)
      }
    }

    res.json({ success: true, data: { ...app, status: 'admitted', student: createdStudent } })
  })
)

// POST /applications/:id/extend-fee-hold — Principal/School Admin manual
// override, decisions.md Phase 3: allowed, logged. "Admission Officer"
// isn't a real base role yet (see decisions.md's blocking decision on
// role-mapping), so this stays school_admin/principal until Phase 10.
router.post('/applications/:id/extend-fee-hold', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const days = Number(req.body.days)
    const reason = req.body.reason

    if (!Number.isInteger(days) || days <= 0) {
      return res.status(400).json({ success: false, error: 'days must be a positive integer' })
    }

    const { data: app } = await supabase
      .from('admission_applications').select('status, fee_hold_deadline, application_fee_paid')
      .eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' })
    if (app.application_fee_paid) return res.status(400).json({ success: false, error: 'Fee already paid — there is no hold to extend.' })
    // No hold exists to extend before Fee Pending — a seat isn't reserved
    // (and no deadline set) until the admission-approval chain completes.
    if (app.status !== 'fee_pending') {
      return res.status(400).json({ success: false, error: 'There is no active fee hold to extend — this application has not reached Fee Pending yet.' })
    }

    // Extend from the later of "now" or the existing deadline — extending
    // an already-expired hold restarts the clock from today, not from a
    // date that's already passed.
    const base = app.fee_hold_deadline && new Date(app.fee_hold_deadline) > new Date() ? new Date(app.fee_hold_deadline) : new Date()
    const newDeadline = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('admission_applications')
      .update({
        fee_hold_deadline: newDeadline,
        fee_hold_extended_at: new Date().toISOString(),
        fee_hold_extended_by: req.user!.id,
        fee_hold_extension_reason: reason ?? null,
      })
      .eq('id', id).eq('school_id', school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// POST /applications/expire-fee-holds — manual trigger for the same sweep
// the hourly cron runs, scoped to the caller's own school. Same pattern
// as notifications' POST /run-fee-reminders.
router.post('/applications/expire-fee-holds', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await releaseExpiredSeatHolds(req.user!.school_id)
    res.json({ success: true, data: result })
  })
)

// POST /inquiries/process-waitlist-offers — manual trigger for the same
// sweep the hourly cron runs, scoped to the caller's own school. Same
// pattern as the fee-hold trigger above and notifications' own
// POST /run-fee-reminders.
router.post('/inquiries/process-waitlist-offers', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await processExpiredWaitlistOffers(req.user!.school_id)
    res.json({ success: true, data: result })
  })
)

// ── OFFER LETTER ────────────────────────────────────────────────
// Issuing just stamps a number + audit trail here — the actual printable
// HTML lives in the documents module (every other printable document in
// this app follows that split: TC/certificate issuance vs. rendering).
// Gated on 'admitted' — same "gate on real state" reasoning already used
// for the HR offer letter and relieving letter in documents/routes.ts.
router.post('/applications/:id/issue-offer-letter', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: app } = await supabase
      .from('admission_applications').select('status, offer_letter_number').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' })
    if (app.status !== 'admitted') {
      return res.status(400).json({ success: false, error: 'Offer letter can only be issued once the application has been admitted.' })
    }
    if (app.offer_letter_number) {
      return res.status(400).json({ success: false, error: `Offer letter already issued: ${app.offer_letter_number}` })
    }

    const offerLetterNumber = await nextDocumentNumber(school_id, 'OFR')
    const { data, error } = await supabase
      .from('admission_applications')
      .update({
        offer_letter_number: offerLetterNumber,
        offer_letter_issued_at: new Date().toISOString(),
        offer_letter_issued_by: req.user!.id,
      })
      .eq('id', id)
      .eq('school_id', school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// ── SEAT AVAILABILITY ──────────────────────────────────────────
// Per-class breakdown for the "how many seats are left" widget on the
// application form. capacity 0 (no sections configured) is surfaced as
// unlimited=true rather than available:0, matching getClassSeatAvailability.
router.get('/admission-seats', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: classes, error } = await supabase
      .from('classes').select('id, name, numeric_level').eq('school_id', school_id).order('numeric_level')
    if (error) return res.status(500).json({ success: false, error: error.message })

    const data = await Promise.all((classes ?? []).map(async (c) => {
      const seats = await getClassSeatAvailability(school_id, c.id)
      return {
        class_id: c.id,
        class_name: c.name,
        numeric_level: c.numeric_level,
        unlimited: seats.capacity === 0,
        ...seats,
      }
    }))
    res.json({ success: true, data })
  })
)

// PATCH /admission-seats/:classId — School Admin / Principal adjust
// capacity or the frozen buffer directly. decisions.md, Phase 1: both
// roles may act independently (no dual-approval), a reason is recorded
// when given but not required, and "last changed by X at Y" is exactly
// updated_by/updated_at on the ledger row — no separate audit trail.
router.patch('/admission-seats/:classId', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { classId } = req.params
    const school_id = req.user!.school_id
    const { capacity, frozen, locked, reason } = req.body

    if (capacity === undefined && frozen === undefined && locked === undefined) {
      return res.status(400).json({ success: false, error: 'Provide capacity, frozen, and/or locked' })
    }
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 0)) {
      return res.status(400).json({ success: false, error: 'capacity must be a non-negative integer' })
    }
    if (frozen !== undefined && (!Number.isInteger(frozen) || frozen < 0)) {
      return res.status(400).json({ success: false, error: 'frozen must be a non-negative integer' })
    }
    // Locking (and unlocking) is School Admin only — Principal keeps
    // capacity/frozen access but not this. decisions.md: "Director-only
    // unlock" mapped onto the existing role set as School Admin, the
    // closest existing base value with that authority, and lock/unlock
    // treated the same way rather than splitting them further.
    if (locked !== undefined) {
      if (typeof locked !== 'boolean') return res.status(400).json({ success: false, error: 'locked must be a boolean' })
      if (req.user!.role !== 'school_admin') {
        return res.status(403).json({ success: false, error: 'Only School Admin can lock or unlock a class.' })
      }
    }

    // Ensure a row exists (a class touched before its first application
    // or backfill may not have one yet) before updating it.
    await getClassSeatAvailability(school_id, classId)

    const update: Record<string, unknown> = { updated_by: req.user!.id, updated_reason: reason ?? null }
    if (capacity !== undefined) update.capacity = capacity
    if (frozen !== undefined) update.frozen = frozen
    if (locked !== undefined) {
      update.is_locked = locked
      update.locked_at = locked ? new Date().toISOString() : null
      update.locked_by = locked ? req.user!.id : null
      update.lock_reason = locked ? (reason ?? null) : null
    }

    const { data, error } = await supabase
      .from('admission_seat_ledger' as any)
      .update(update)
      .eq('school_id', school_id).eq('class_id', classId)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ── CLASS DISPLAY STYLE ───────────────────────────────────────────
// User request: numeric ("Class 11") vs Roman ("Class XI") numbering,
// single source of truth for the school. Lives on `schools` like every
// other school-level setting. Any authenticated staff member can read it
// (needed everywhere a class name renders); only School Admin can change
// it, matching the other display-affecting settings in this file.
router.get('/class-display-style', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data } = await supabase.from('schools').select('class_display_style').eq('id', req.user!.school_id).maybeSingle()
  res.json({ success: true, data: { style: (data as any)?.class_display_style ?? 'numeric' } })
}))

router.patch('/class-display-style', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { style } = req.body
    if (!['numeric', 'roman'].includes(style)) {
      return res.status(400).json({ success: false, error: "style must be 'numeric' or 'roman'" })
    }
    const { error } = await supabase.from('schools').update({ class_display_style: style }).eq('id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data: { style } })
  })
)

// ── ADMISSION PROCESS SETTINGS ────────────────────────────────────
// remaining-work-plan.md Section A4: these six columns (fee-hold
// duration/grace, waitlist response window, stage-aging threshold,
// occupancy-warning threshold/lead-time) have existed since Phases 3/4/9
// shipped, each with a safe default, but with no way to change them short
// of editing the database directly. One combined GET/PATCH — same
// "school-level tuning knobs" grouping as class-display-style, but
// bundled since these six are read together everywhere they're used and
// a school configuring one is likely configuring the rest at the same
// sitting.
const ADMISSION_SETTINGS_COLUMNS = [
  'admission_fee_hold_days',
  'admission_fee_hold_grace_days',
  'admission_waitlist_response_days',
  'admission_stage_aging_days',
  'admission_occupancy_warning_percent',
  'admission_occupancy_warning_days',
] as const

router.get('/admission-settings', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data } = await supabase
      .from('schools')
      .select(ADMISSION_SETTINGS_COLUMNS.join(', '))
      .eq('id', req.user!.school_id)
      .maybeSingle()
    const row = (data as any) ?? {}
    res.json({
      success: true,
      data: {
        admission_fee_hold_days: row.admission_fee_hold_days ?? 7,
        admission_fee_hold_grace_days: row.admission_fee_hold_grace_days ?? 0,
        admission_waitlist_response_days: row.admission_waitlist_response_days ?? 3,
        admission_stage_aging_days: row.admission_stage_aging_days ?? 10,
        admission_occupancy_warning_percent: row.admission_occupancy_warning_percent ?? 70,
        admission_occupancy_warning_days: row.admission_occupancy_warning_days ?? 60,
      },
    })
  })
)

router.patch('/admission-settings', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const update: Record<string, number> = {}
    for (const key of ADMISSION_SETTINGS_COLUMNS) {
      const value = req.body[key]
      if (value === undefined) continue
      if (!Number.isInteger(value) || value < 0) {
        return res.status(400).json({ success: false, error: `${key} must be a non-negative integer` })
      }
      if (key === 'admission_occupancy_warning_percent' && value > 100) {
        return res.status(400).json({ success: false, error: 'admission_occupancy_warning_percent must be between 0 and 100' })
      }
      update[key] = value
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: `Provide at least one of: ${ADMISSION_SETTINGS_COLUMNS.join(', ')}` })
    }
    const { error } = await supabase.from('schools').update(update).eq('id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data: update })
  })
)

// ── CLASS SETTINGS (Phase 6a) ────────────────────────────────────
// Entrance mode + admission fee, per class — School Admin/Principal
// owned. No row for a class = 'interview' / 40% pass mark (the schema
// defaults), same "absence has a sane default" convention as everything
// else in this module — except admission_fee_amount, which stays null
// (not configured) rather than defaulting to a number nobody chose;
// POST /applications/:id/collect-fee falls back to a typed-in amount
// when it's null.
router.get('/class-settings', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: classes, error } = await supabase
      .from('classes').select('id, name, numeric_level').eq('school_id', school_id).order('numeric_level')
    if (error) return res.status(500).json({ success: false, error: error.message })

    const { data: settings } = await supabase
      .from('admission_class_settings' as any)
      .select('class_id, entrance_mode, pass_marks_percent, admission_fee_amount')
      .eq('school_id', school_id)
    const settingByClass = new Map((settings ?? []).map((s: any) => [s.class_id, s]))

    const data = (classes ?? []).map(c => {
      const s = settingByClass.get(c.id) as any
      return {
        class_id: c.id,
        class_name: c.name,
        numeric_level: c.numeric_level,
        entrance_mode: s?.entrance_mode ?? 'interview',
        pass_marks_percent: s?.pass_marks_percent ?? 40,
        admission_fee_amount: s?.admission_fee_amount ?? null,
      }
    })
    res.json({ success: true, data })
  })
)

router.patch('/class-settings/:classId', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { classId } = req.params
    const school_id = req.user!.school_id
    const { entrance_mode, pass_marks_percent, admission_fee_amount } = req.body

    if (entrance_mode !== undefined && !['interview', 'written_mcq', 'written_subjective', 'observation', 'previous_academic_percentage'].includes(entrance_mode)) {
      return res.status(400).json({ success: false, error: 'entrance_mode must be one of: interview, written_mcq, written_subjective, observation, previous_academic_percentage' })
    }
    if (pass_marks_percent !== undefined && (!Number.isInteger(pass_marks_percent) || pass_marks_percent < 0 || pass_marks_percent > 100)) {
      return res.status(400).json({ success: false, error: 'pass_marks_percent must be an integer between 0 and 100' })
    }
    if (admission_fee_amount !== undefined && admission_fee_amount !== null && (typeof admission_fee_amount !== 'number' || !Number.isFinite(admission_fee_amount) || admission_fee_amount < 0)) {
      return res.status(400).json({ success: false, error: 'admission_fee_amount must be a non-negative number, or null to clear it' })
    }
    if (entrance_mode === undefined && pass_marks_percent === undefined && admission_fee_amount === undefined) {
      return res.status(400).json({ success: false, error: 'Provide entrance_mode, pass_marks_percent, and/or admission_fee_amount' })
    }

    const { data: existing } = await supabase
      .from('admission_class_settings' as any)
      .select('entrance_mode, pass_marks_percent, admission_fee_amount, created_by')
      .eq('school_id', school_id).eq('class_id', classId).maybeSingle()

    const { data, error } = await supabase
      .from('admission_class_settings' as any)
      .upsert({
        school_id, class_id: classId,
        entrance_mode: entrance_mode ?? (existing as any)?.entrance_mode ?? 'interview',
        pass_marks_percent: pass_marks_percent ?? (existing as any)?.pass_marks_percent ?? 40,
        admission_fee_amount: admission_fee_amount !== undefined ? admission_fee_amount : (existing as any)?.admission_fee_amount ?? null,
        created_by: (existing as any)?.created_by ?? req.user!.id,
        updated_by: req.user!.id,
      }, { onConflict: 'school_id,class_id' })
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ── DOCUMENT REQUIREMENTS ───────────────────────────────────────
// Mandatory document checklist per class, School Admin owned. No rows for
// a class = no checklist = never blocks (checkDocumentCompleteness).
router.get('/document-requirements', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id } = req.query
    let query = supabase
      .from('admission_document_requirements' as any)
      .select('*, classes:class_id(name)')
      .eq('school_id', req.user!.school_id)
      .order('document_type')
    if (class_id) query = query.eq('class_id', class_id as string)

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/document-requirements', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, document_type } = req.body
    if (!class_id || !document_type) {
      return res.status(400).json({ success: false, error: 'class_id and document_type are required' })
    }
    const { data, error } = await supabase
      .from('admission_document_requirements' as any)
      .insert({ school_id: req.user!.school_id, class_id, document_type, created_by: req.user!.id })
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/document-requirements/:id', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase
      .from('admission_document_requirements' as any)
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── ADMISSION CYCLES ───────────────────────────────────────────
// Per-school, per-academic-year open/close window. No row for a year =
// always open (checkAdmissionCycleOpen treats absence as unrestricted).
router.get('/admission-cycles', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('admission_cycles' as any)
      .select('*, academic_years(id, name)')
      .eq('school_id', req.user!.school_id)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/admission-cycles', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const body = AdmissionCycleSchema.parse(req.body)

    const { data: existing } = await supabase
      .from('admission_cycles' as any)
      .select('created_by')
      .eq('school_id', school_id).eq('academic_year_id', body.academic_year_id).maybeSingle()

    const { data, error } = await supabase
      .from('admission_cycles' as any)
      .upsert(
        { school_id, ...body, created_by: (existing as any)?.created_by ?? req.user!.id, updated_by: req.user!.id },
        { onConflict: 'school_id,academic_year_id' },
      )
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/admission-cycles/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase
      .from('admission_cycles' as any)
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── ENTRANCE TEST / INTERVIEW SCHEDULING ────────────────────────
// admission_slots + admission_slot_bookings. Deliberately generic
// (slot_type) rather than exam-specific, so campus-tour booking reuses
// this instead of a second scheduling system.
router.get('/admission-slots', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { slot_type, from, to, class_id } = req.query
    const school_id = req.user!.school_id

    let query = supabase
      .from('admission_slots' as any)
      .select('*, classes:class_id(name, numeric_level), academic_years(name), users:assigned_staff_id(full_name)')
      .eq('school_id', school_id)
      .order('starts_at')

    if (slot_type) query = query.eq('slot_type', slot_type as string)
    if (from) query = query.gte('starts_at', from as string)
    if (to) query = query.lte('starts_at', to as string)
    // User request: strictly filter slot options by the candidate's own
    // class when booking — a class-agnostic slot (no class_id set) is
    // NOT shown here, "strictly filtered" means exactly that class only.
    if (class_id) query = query.eq('class_id', class_id as string)

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/admission-slots', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const body = CreateSlotSchema.parse(req.body)

    const { data, error } = await supabase
      .from('admission_slots' as any)
      .insert({ ...body, school_id, created_by: req.user!.id })
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.patch('/admission-slots/:id', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = UpdateSlotSchema.parse(req.body)
    const { data, error } = await supabase
      .from('admission_slots' as any)
      .update({ ...body, updated_by: req.user!.id })
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/admission-slots/:id', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase
      .from('admission_slots' as any)
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// POST /admission-slots/:id/book — capacity is enforced here (not just
// displayed): a full slot rejects new bookings rather than silently
// overbooking. capacity null/undefined means unlimited.
router.post('/admission-slots/:id/book', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const body = BookSlotSchema.parse(req.body)

    const { data: slot } = await supabase
      .from('admission_slots' as any).select('slot_type, capacity').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!slot) return res.status(404).json({ success: false, error: 'Slot not found' })

    if ((slot as any).capacity != null) {
      const { data: existing } = await supabase
        .from('admission_slot_bookings' as any).select('id, status').eq('slot_id', id)
      const activeCount = ((existing ?? []) as any[]).filter(b => b.status !== 'cancelled').length
      if (activeCount >= (slot as any).capacity) {
        return res.status(400).json({ success: false, error: 'This slot is fully booked.' })
      }
    }

    const { data, error } = await supabase
      .from('admission_slot_bookings' as any)
      .insert({ slot_id: id, school_id, ...body, booked_by: req.user!.id })
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    // Entering the entrance-exam stage advances an inquiry that's still
    // early in the funnel — never overrides a status already further
    // along (e.g. an inquiry already 'approved' shouldn't regress).
    if (body.inquiry_id && (slot as any).slot_type === 'entrance_exam') {
      const { data: inquiry } = await supabase.from('admission_inquiries').select('status').eq('id', body.inquiry_id).maybeSingle()
      if (inquiry && ['new', 'follow_up', 'interested'].includes(inquiry.status)) {
        await supabase.from('admission_inquiries').update({ status: 'entrance_exam' }).eq('id', body.inquiry_id)
      }
    }

    res.status(201).json({ success: true, data })
  })
)

router.get('/admission-slot-bookings', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { inquiry_id, application_id, slot_id } = req.query
    if (!inquiry_id && !application_id && !slot_id) {
      return res.status(400).json({ success: false, error: 'inquiry_id, application_id, or slot_id query param is required' })
    }
    let query = supabase
      .from('admission_slot_bookings' as any)
      .select('*, admission_slots(*), admission_inquiries(student_name), admission_applications(student_first_name, student_last_name)')
      .eq('school_id', req.user!.school_id)
      .order('booked_at', { ascending: false })
    // An application converted from an inquiry inherits that inquiry's
    // booking history — a booking row only ever has one of the two FKs
    // set, made at whichever stage the candidate was in when it was
    // booked, but the application detail page needs to show bookings made
    // either before or after conversion, not just the ones with
    // application_id set (convert-to-application doesn't relink existing
    // bookings, so pre-conversion ones would otherwise vanish from view).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const validInquiryId = typeof inquiry_id === 'string' && uuidRe.test(inquiry_id) ? inquiry_id : null
    const validApplicationId = typeof application_id === 'string' && uuidRe.test(application_id) ? application_id : null
    if (validInquiryId && validApplicationId) {
      query = query.or(`inquiry_id.eq.${validInquiryId},application_id.eq.${validApplicationId}`)
    } else if (validInquiryId) {
      query = query.eq('inquiry_id', validInquiryId)
    } else if (validApplicationId) {
      query = query.eq('application_id', validApplicationId)
    }
    if (slot_id) query = query.eq('slot_id', slot_id as string)

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/admission-slot-bookings/:id', requirePermissionV2('admission.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = UpdateBookingSchema.parse(req.body)
    const school_id = req.user!.school_id
    const update: Record<string, unknown> = { ...body }

    // Found live 2026-08-25: a genuinely empty update (every field
    // undefined — the frontend's marks inputs fire on blur even when
    // nothing changed, e.g. tabbing through an already-empty field, since
    // undefined !== null) reaches here as {} once JSON.stringify drops the
    // undefined keys. Supabase's .update({}).select().single() then
    // returns zero rows (an empty patch is a no-op, so nothing comes back
    // from the RETURNING clause), and .single() throws Postgres's own
    // "Cannot coerce the result to a single JSON object" — a real error a
    // user could see for what is, from their side, a no-op. Guarded here
    // rather than only in the frontend, since this endpoint shouldn't
    // depend on every caller getting that comparison right.
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' })
    }

    // Phase 6b-i: pass/fail is a plain percentage-vs-threshold computation
    // (same spirit as the exam module's computeGrade() percentage bucket)
    // — not evaluation of an answer, so it stays inside "marks entry"
    // rather than crossing into the still-blocked 6b-ii auto-evaluation.
    // Merges with whichever of marks_obtained/max_marks isn't part of
    // this particular update, so setting just one field still recomputes
    // correctly against the other's stored value.
    if (body.marks_obtained !== undefined || body.max_marks !== undefined) {
      const { data: existing } = await supabase
        .from('admission_slot_bookings' as any)
        .select('marks_obtained, max_marks, slot_id')
        .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()

      const marksObtained = body.marks_obtained ?? (existing as any)?.marks_obtained
      const maxMarks = body.max_marks ?? (existing as any)?.max_marks

      if (marksObtained != null && maxMarks != null && maxMarks > 0) {
        let passPercent = 40
        const { data: slot } = await supabase.from('admission_slots' as any).select('class_id').eq('id', (existing as any)?.slot_id).maybeSingle()
        if ((slot as any)?.class_id) {
          const { data: setting } = await supabase
            .from('admission_class_settings' as any)
            .select('pass_marks_percent')
            .eq('school_id', school_id).eq('class_id', (slot as any).class_id).maybeSingle()
          passPercent = (setting as any)?.pass_marks_percent ?? 40
        }
        update.is_pass = (marksObtained / maxMarks) * 100 >= passPercent
      }
    }

    const { data, error } = await supabase
      .from('admission_slot_bookings' as any)
      .update(update)
      .eq('id', req.params.id)
      .eq('school_id', school_id)
      .select()
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    // Phase 6c: marks entry completing (both fields present) is what
    // triggers result publishing — auto-starts the workflow the same way
    // converting an inquiry auto-starts the Admission Approval Workflow.
    // Guarded so re-editing already-scored marks doesn't restart it.
    const row = data as any
    if (row.marks_obtained != null && row.max_marks != null) {
      const { data: existingInstance } = await supabase
        .from('workflow_instances')
        .select('id')
        .eq('entity_type', 'admission_slot_booking')
        .eq('entity_id', row.id)
        .eq('school_id', school_id)
        .maybeSingle()

      if (!existingInstance) {
        await ensureEntranceResultWorkflowDefinition(school_id)
        const wfResult = await startWorkflow({
          schoolId: school_id,
          workflowName: 'Entrance Result Publishing',
          entityType: 'admission_slot_booking',
          entityId: row.id,
          initiatedBy: req.user!.id,
        })
        if (!wfResult.success) {
          console.error(`Failed to start result-publishing workflow for booking ${row.id}:`, wfResult.error)
        }
      }
    }

    res.json({ success: true, data })
  })
)

// GET/POST workflow endpoints for the result-publishing workflow started
// above — thin wrappers around the same shared engine, no section or
// document-completeness logic (those are specific to admitting a
// student, not publishing a test score).
router.get('/admission-slot-bookings/:id/workflow-status', requirePermissionV2('admission.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = await getWorkflowStatus('admission_slot_booking', req.params.id, req.user!.school_id)
    res.json({ success: true, data: status })
  })
)

router.post('/admission-slot-bookings/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { status, notes } = req.body
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'Not authorized to act on entrance results' })
  }
  if (!['approved', 'rejected', 'escalated', 'commented'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be approved, rejected, escalated, or commented.' })
  }

  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'admission_slot_booking')
    .eq('entity_id', id)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instErr || !instance) {
    return res.status(404).json({ success: false, error: 'No result-publishing workflow found for this booking. Marks must be entered first — it starts automatically.' })
  }
  if (instance.status !== 'in_progress') {
    return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
  }

  const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status, notes })
  if (!result.success) return res.status(400).json({ success: false, error: result.error })

  if (result.completed && result.instance.status === 'approved') {
    await supabase.from('admission_slot_bookings' as any)
      .update({ result_published: true, result_published_at: new Date().toISOString() })
      .eq('id', id).eq('school_id', school_id)
  }

  res.json({ success: true, data: { instance: result.instance, completed: result.completed, next_step: result.nextStep ?? null } })
}))

// ── CLASSES & SECTIONS helpers ───────────────────────────────
router.get('/classes', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('classes')
    .select('*, sections(*)')
    .eq('school_id', req.user!.school_id)
    .order('numeric_level')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// GET /classes/strength — TODAY's occupied seats vs enrolled students,
// per section, for the dashboard's class-wise strength widget. "Occupied"
// is students actually marked present today, not just enrolled — a
// section showing full-but-half-empty every day is a more useful signal
// than a static enrollment count that only changes on admission/transfer.
// present is derived from the students table's real section_id, never
// from attendance.section_id — that column is left null whenever a
// teacher marks a whole class at once without picking one section, which
// would silently undercount if trusted directly (same issue fixed for
// GET /students/attendance/today).
//
// capacity (sections.max_strength) rides along too but the dashboard no
// longer divides by it — it's a configured seat limit, not how many
// students are actually in the section, so using it as the denominator
// made every section's "present" fraction reflect classroom capacity
// instead of the class's real headcount.
//
// enrolled/is_working_day/marked_today ride along so the frontend can
// tell "0 present because nobody's here" apart from "0 present because
// nobody's marked attendance yet" or "0 present because it's a holiday".
router.get('/classes/strength', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const today = toLocalDateStr(new Date())

  const [{ data: classes, error: classErr }, { data: students, error: stuErr }, { data: records, error: attErr }, nonWorkingSets] = await Promise.all([
    supabase.from('classes').select('id, name, numeric_level, sections(id, name, max_strength)').eq('school_id', school_id).order('numeric_level'),
    supabase.from('students').select('id, class_id, section_id').eq('school_id', school_id).eq('status', 'active'),
    supabase.from('attendance').select('student_id, status').eq('school_id', school_id).eq('date', today),
    getNonWorkingDaySets(school_id, today, today),
  ])
  if (classErr) return res.status(500).json({ success: false, error: classErr.message })
  if (stuErr) return res.status(500).json({ success: false, error: stuErr.message })
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })

  const is_working_day = isWorkingDate(today, nonWorkingSets)
  const statusByStudent = new Map((records ?? []).map(r => [r.student_id, r.status]))

  const enrolledBySection = new Map<string, number>()
  const presentBySection = new Map<string, number>()
  const markedBySection = new Map<string, number>()
  for (const s of students ?? []) {
    if (!s.section_id) continue
    enrolledBySection.set(s.section_id, (enrolledBySection.get(s.section_id) ?? 0) + 1)
    const status = statusByStudent.get(s.id)
    if (status) markedBySection.set(s.section_id, (markedBySection.get(s.section_id) ?? 0) + 1)
    if (status === 'present') presentBySection.set(s.section_id, (presentBySection.get(s.section_id) ?? 0) + 1)
  }

  const sections = (classes ?? []).flatMap((c: any) => (c.sections ?? []).map((sec: any) => ({
    class_id: c.id, class_name: c.name, numeric_level: c.numeric_level,
    section_id: sec.id, section_name: sec.name,
    capacity: sec.max_strength ?? 0,
    enrolled: enrolledBySection.get(sec.id) ?? 0,
    occupied: presentBySection.get(sec.id) ?? 0,
    marked_today: markedBySection.get(sec.id) ?? 0,
  })))

  // date/is_working_day nested inside data (not sibling fields) — matches
  // the shape GET /students/attendance/today already uses, so both
  // dashboard widgets unwrap the same way instead of one being a special
  // case. A previous version put them as siblings of a top-level `data`
  // array, which silently broke the frontend's single `.then(r => r.data)`
  // unwrap (it grabbed `.data` off the wrong object and got undefined).
  res.json({ success: true, data: { sections, date: today, is_working_day } })
}))

// POST /classes — create a class (e.g. "Class 11")
router.post('/classes', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name, numeric_level, stream } = req.body
    const school_id = req.user!.school_id
    if (!name) return res.status(400).json({ success: false, error: 'name is required' })

    const { data, error } = await supabase
      .from('classes')
      .insert({ school_id, name, numeric_level: numeric_level ?? null, stream: stream || null })
      .select('*, sections(*)')
      .single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// PATCH /classes/:id — rename a class / edit its level or stream label
router.patch('/classes/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { name, numeric_level, stream } = req.body
    const school_id = req.user!.school_id

    const update: Record<string, any> = {}
    if (name !== undefined) update.name = name
    if (numeric_level !== undefined) update.numeric_level = numeric_level
    if (stream !== undefined) update.stream = stream || null

    const { data, error } = await supabase
      .from('classes').update(update).eq('id', id).eq('school_id', school_id)
      .select('*, sections(*)').single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// DELETE /classes/:id — refuses if any student is still assigned to it
router.delete('/classes/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { count } = await supabase.from('students').select('*', { count: 'exact', head: true })
      .eq('class_id', id).eq('school_id', school_id)
    if (count) {
      return res.status(400).json({ success: false, error: `Cannot delete — ${count} student(s) are assigned to this class` })
    }

    await supabase.from('sections').delete().eq('class_id', id).eq('school_id', school_id)
    const { error } = await supabase.from('classes').delete().eq('id', id).eq('school_id', school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// POST /classes/:id/sections — add a section (or stream, e.g. "PCM") to a class
router.post('/classes/:id/sections', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { name, max_strength } = req.body
    const school_id = req.user!.school_id
    if (!name) return res.status(400).json({ success: false, error: 'name is required' })

    const { data: cls } = await supabase.from('classes').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!cls) return res.status(404).json({ success: false, error: 'Class not found' })

    const { data, error } = await supabase
      .from('sections')
      .insert({ school_id, class_id: id, name, max_strength: max_strength ?? 40 })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

// PATCH /sections/:id — rename a section/stream
router.patch('/sections/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { name, max_strength } = req.body
    const school_id = req.user!.school_id

    const update: Record<string, any> = {}
    if (name !== undefined) update.name = name
    if (max_strength !== undefined) update.max_strength = max_strength

    const { data, error } = await supabase
      .from('sections').update(update).eq('id', id).eq('school_id', school_id)
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// DELETE /sections/:id — refuses if any student is still assigned to it
router.delete('/sections/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { count } = await supabase.from('students').select('*', { count: 'exact', head: true })
      .eq('section_id', id).eq('school_id', school_id)
    if (count) {
      return res.status(400).json({ success: false, error: `Cannot delete — ${count} student(s) are assigned to this section` })
    }

    const { error } = await supabase.from('sections').delete().eq('id', id).eq('school_id', school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── SUBJECTS — the master list every subject_name field in the app
// (timetable, homework, syllabus) should draw from, so "Mathematics"
// typed in one place is the exact same string everywhere else instead
// of drifting into "Maths"/"maths"/etc. class_id null = offered to
// every class; set = specific to that one class (e.g. senior-secondary
// electives), same nullable-scope pattern used for sections.
router.get('/subjects', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id } = req.query
  const school_id = req.user!.school_id

  let query = supabase.from('subjects').select('*').eq('school_id', school_id).order('name')
  if (class_id) query = query.or(`class_id.eq.${class_id},class_id.is.null`)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/subjects', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name, class_id, is_elective } = req.body
    const school_id = req.user!.school_id
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' })

    const { data, error } = await supabase
      .from('subjects')
      .insert({ school_id, name: name.trim(), class_id: class_id || null, is_elective: !!is_elective })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/subjects/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('subjects').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── ACADEMIC CALENDAR — holiday list + weekly-off pattern. This is
// the source of truth attendance.report reads "working days" from,
// so a date only counts against a student's attendance % if it's
// neither a weekly-off weekday nor an explicitly declared holiday.
router.get('/holidays', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { year, from, to } = req.query
  const school_id = req.user!.school_id

  let query = supabase.from('holidays').select('*').eq('school_id', school_id).order('date')
  // Explicit from/to (e.g. dashboard's "upcoming events" widget) takes
  // priority over year (the Academic Calendar settings page's year
  // browser) — the two callers want different slices of the same table.
  if (from || to) {
    if (from) query = query.gte('date', from as string)
    if (to) query = query.lte('date', to as string)
  } else if (year) {
    query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/holidays', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { date, name } = req.body
    const school_id = req.user!.school_id
    if (!date || !name?.trim()) return res.status(400).json({ success: false, error: 'date and name are required' })

    const { data, error } = await supabase
      .from('holidays')
      .insert({ school_id, date, name: name.trim() })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/holidays/:id', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('holidays').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// weekly_off_days: array of JS Date.getDay() indices (0=Sun..6=Sat) that
// never count as a working day, regardless of the holiday list above.
router.get('/weekly-off', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('schools').select('weekly_off_days').eq('id', req.user!.school_id).single()
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data: { weekly_off_days: data?.weekly_off_days ?? [0] } })
}))

router.patch('/weekly-off', requirePermissionV2('settings.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { weekly_off_days } = req.body
    if (!Array.isArray(weekly_off_days) || weekly_off_days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return res.status(400).json({ success: false, error: 'weekly_off_days must be an array of integers 0-6' })
    }
    const { data, error } = await supabase
      .from('schools').update({ weekly_off_days }).eq('id', req.user!.school_id)
      .select('weekly_off_days').single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// low_attendance_threshold_pct: the cumulative-attendance cutoff (as a %
// of the academic year so far) below which a student surfaces on the
// Principal dashboard's low-attendance panel. School-level, not
// hardcoded, so each school can tune it. Read is open to any
// authenticated staff (the Principal dashboard needs it); write is
// school_admin only — the Principal role stays read-only for this
// setting, unlike weekly-off above which predates that requirement.
router.get('/low-attendance-threshold', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('schools').select('low_attendance_threshold_pct').eq('id', req.user!.school_id).single()
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data: { low_attendance_threshold_pct: data?.low_attendance_threshold_pct ?? 60 } })
}))

// Deliberately kept on requireRole (not settings.manage, which Principal
// also holds) — the comment above this route explicitly documents that
// Principal should stay read-only here, unlike the other settings.manage
// routes in this file. No existing/new permission code captures "School
// Admin only, explicitly excluding Principal" without adding a
// single-purpose code for one route, so the original hardcoded check
// stays as the more faithful source of truth for this one setting.
router.patch('/low-attendance-threshold', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { low_attendance_threshold_pct } = req.body
    if (!Number.isInteger(low_attendance_threshold_pct) || low_attendance_threshold_pct < 1 || low_attendance_threshold_pct > 100) {
      return res.status(400).json({ success: false, error: 'low_attendance_threshold_pct must be an integer 1-100' })
    }
    const { data, error } = await supabase
      .from('schools').update({ low_attendance_threshold_pct }).eq('id', req.user!.school_id)
      .select('low_attendance_threshold_pct').single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.get('/academic-years', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('academic_years')
    .select('*')
    .eq('school_id', req.user!.school_id)
    .order('is_current', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

export default router