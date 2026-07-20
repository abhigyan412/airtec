import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'

const router = Router()
router.use(authenticate)

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
  status: z.enum(['new','follow_up','interested','documents_submitted','entrance_exam','approved','fee_pending','admitted','rejected','lost']).optional(),
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

// ── INQUIRIES ───────────────────────────────────────────────

router.get('/inquiries', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', search, status, counselor_id } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('admission_inquiries')
    .select(`
      *,
      classes:applying_for_class_id(id, name),
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

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

router.get('/inquiries/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  const statuses = ['new', 'follow_up', 'interested', 'documents_submitted', 'approved', 'admitted', 'rejected', 'lost']
  const counts = await Promise.all(
    statuses.map(s =>
      supabase.from('admission_inquiries')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', school_id)
        .eq('status', s)
        .then(({ count }) => ({ status: s, count: count ?? 0 }))
    )
  )

  const total = counts.reduce((s, c) => s + c.count, 0)
  const admitted = counts.find(c => c.status === 'admitted')?.count ?? 0
  const conversion_rate = total > 0 ? Math.round((admitted / total) * 100) : 0

  res.json({
    success: true,
    data: {
      by_status: counts,
      total,
      conversion_rate,
    },
  })
}))

router.get('/inquiries/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
 
  const { data, error } = await supabase
    .from('admission_inquiries')
    .select(`
      *,
      classes:applying_for_class_id(id, name),
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

router.post('/inquiries', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateInquirySchema.parse(req.body)
  const school_id = req.user!.school_id
 
  const counselor_id = body.counselor_id ?? (req.user!.role === 'counselor' ? req.user!.id : undefined)
 
  const { count } = await supabase
    .from('admission_inquiries').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
  const inquiryNumber = `INQ${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`
 
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



router.post('/inquiries/:id/convert-to-application', asyncHandler(async (req: AuthRequest, res: Response) => {
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
 
  const { count } = await supabase
    .from('admission_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
  const appNumber = `APP${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`
 
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
 
  // Auto-start the Admission Approval Workflow (Counselor -> Accountant -> Principal)
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
 
router.patch('/inquiries/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const body = UpdateInquirySchema.parse(req.body)
  const school_id = req.user!.school_id
 
  // 'admitted' can ONLY be set automatically when the linked
  // admission_application's workflow completes with final approval
  // (see POST /applications/:id/approve and /workflow-action) —
  // never via direct manual status change. This prevents the CRM
  // showing "Admitted" for someone who was never actually enrolled
  // as a student.
  if (body.status === 'admitted') {
    return res.status(400).json({
      success: false,
      error: "Inquiries can't be marked 'admitted' directly. Convert this inquiry to a formal application and complete the Admission Approval Workflow — the inquiry will update automatically once the student is enrolled.",
    })
  }
 
  const { data, error } = await supabase
    .from('admission_inquiries')
    .update(body)
    .eq('id', id)
    .eq('school_id', school_id)
    .select()
    .single()
 
  if (error) return res.status(400).json({ success: false, error: error.message })
 
  res.json({ success: true, data })
}))

// ── FOLLOW-UPS ──────────────────────────────────────────────

router.post('/inquiries/:id/follow-ups', asyncHandler(async (req: AuthRequest, res: Response) => {
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
  const { page = '1', limit = '20', status } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  let query = supabase
    .from('admission_applications')
    .select(`
      *,
      classes:applying_for_class_id(id, name),
      users:counselor_id(id, full_name)
    `, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

// GET /applications/:id — single application detail
router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const { data, error } = await supabase
    .from('admission_applications')
    .select(`
      *,
      classes ( id, name ),
      users:counselor_id ( id, full_name )
    `)
    .eq('id', id)
    .eq('school_id', school_id)
    .single()

  if (error || !data) {
    return res.status(404).json({ success: false, error: 'Application not found' })
  }

  res.json({ success: true, data })
}))

router.post('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateApplicationSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { count } = await supabase
    .from('admission_applications').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
  const appNumber = `APP${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data, error } = await supabase
    .from('admission_applications')
    .insert({ ...body, school_id, application_number: appNumber, counselor_id: req.user!.id })
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  // If linked to inquiry, update inquiry status
  if (body.inquiry_id) {
    await supabase.from('admission_inquiries')
      .update({ status: 'documents_submitted' }).eq('id', body.inquiry_id)
  }

  // Start the Admission Approval Workflow for this new application.
  // Fire-and-forget: don't fail application creation if the workflow
  // fails to start — just log it so an admin can manually start it
  // later via POST /applications/:id/start-workflow if needed.
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

    let createdStudent = null

    if (result.completed) {
      const newAppStatus = result.instance.status === 'approved' ? 'admitted' : 'rejected'

      const { data: app } = await supabase
        .from('admission_applications')
        .update({ status: newAppStatus, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('school_id', school_id)
        .select()
        .single()

      // On final approval, create the student + parent records
      // (mirrors the old endpoint's behaviour on principal final approval)
      if (newAppStatus === 'admitted' && app && !app.student_id) {
        const { data: student } = await supabase.from('students').insert({
          school_id,
          first_name: app.student_first_name,
          last_name: app.student_last_name,
          date_of_birth: app.date_of_birth,
          gender: app.gender,
          class_id: app.applying_for_class_id,
          academic_year_id: app.academic_year_id,
          stream: app.stream,
          status: 'active',
        }).select().single()

        if (student) {
          createdStudent = student
          await supabase.from('admission_applications').update({ student_id: student.id }).eq('id', id)

          await supabase.from('parents').insert({
            school_id, student_id: student.id,
            father_name: app.father_name, father_phone: app.father_phone,
            mother_name: app.mother_name, mother_phone: app.mother_phone,
          })
        }

        // If linked to an inquiry, mark it admitted too
        if (app.inquiry_id) {
          await supabase.from('admission_inquiries').update({ status: 'admitted' }).eq('id', app.inquiry_id)
        }
      }

      if (newAppStatus === 'rejected' && app?.inquiry_id) {
        await supabase.from('admission_inquiries').update({ status: 'rejected' }).eq('id', app.inquiry_id)
      }
    }

    res.json({
      success: true,
      data: {
        instance: result.instance,
        completed: result.completed,
        next_step: result.nextStep ?? null,
        student: createdStudent,
      },
      message: 'Note: prefer POST /applications/:id/workflow-action for full control (approve/reject/comment/escalate).',
    })
  })
)

// ── WORKFLOW: generic action endpoint (approve/reject/escalate/comment) ──
router.post('/applications/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { status, notes } = req.body
  const school_id = req.user!.school_id

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

  let createdStudent = null

  if (result.completed) {
    const newAppStatus = result.instance.status === 'approved' ? 'admitted' : 'rejected'

    const { data: app } = await supabase
      .from('admission_applications')
      .update({ status: newAppStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('school_id', school_id)
      .select()
      .single()

    if (newAppStatus === 'admitted' && app && !app.student_id) {
      const { data: student } = await supabase.from('students').insert({
        school_id,
        first_name: app.student_first_name,
        last_name: app.student_last_name,
        date_of_birth: app.date_of_birth,
        gender: app.gender,
        class_id: app.applying_for_class_id,
        academic_year_id: app.academic_year_id,
        stream: app.stream,
        status: 'active',
      }).select().single()

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

    if (newAppStatus === 'rejected' && app?.inquiry_id) {
      await supabase.from('admission_inquiries').update({ status: 'rejected' }).eq('id', app.inquiry_id)
    }
  }

  res.json({
    success: true,
    data: {
      instance: result.instance,
      completed: result.completed,
      next_step: result.nextStep ?? null,
      student: createdStudent,
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
router.post('/applications/:id/start-workflow', requireRole('school_admin', 'principal'),
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

// POST /classes — create a class (e.g. "Class 11")
router.post('/classes', requireRole('school_admin', 'principal'),
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
router.patch('/classes/:id', requireRole('school_admin', 'principal'),
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
router.delete('/classes/:id', requireRole('school_admin', 'principal'),
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
router.post('/classes/:id/sections', requireRole('school_admin', 'principal'),
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
router.patch('/sections/:id', requireRole('school_admin', 'principal'),
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
router.delete('/sections/:id', requireRole('school_admin', 'principal'),
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