import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, AuthRequest, requireRole } from '../../shared/middleware/auth'
import { requirePermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler, NON_STAFF_ROLES, resolveOwnStudentId } from '../../shared/utils/helpers'
import { createNotifications, getRecipientUserIdsForStudents } from '../../shared/utils/notifications'
import { readWorkbook } from '../timetable/import/xlsx'

const router = Router()
router.use(authenticate)

// The class/section/SUBJECT combos the given user actually teaches,
// sourced from timetable_periods (the same source of truth the Timetable
// page's "Teacher View" already uses). A Teacher's homework/syllabus view
// is restricted to this list, not a free pick of every class (or every
// subject within a class) in the school — that's a School Admin/Principal
// thing. Subject matters here, not just class/section: a Maths teacher for
// Class 1-A shouldn't see Class 1-A's English progress just because they
// share a section. Backs both GET /my-classes (below, for the frontend's
// own class picker) and the server-side scoping in Phase 5 — one query,
// two consumers, so the two can never drift apart.
type OwnClassCombo = { class_id: string; class_name: any; section_id: string | null; section_name: any; subject_name: string }

async function getOwnClassCombos(userId: string, schoolId: string): Promise<OwnClassCombo[]> {
  const { data, error } = await supabase
    .from('timetable_periods')
    .select('class_id, section_id, subject_name, classes(name), sections(name)')
    .eq('school_id', schoolId)
    .eq('teacher_id', userId)
    .eq('is_break', false)

  if (error) throw new Error(error.message)

  const seen = new Set<string>()
  const result: OwnClassCombo[] = []
  for (const row of data ?? []) {
    const key = `${row.class_id}::${row.section_id ?? 'none'}::${row.subject_name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      class_id: row.class_id,
      class_name: (row as any).classes?.name,
      section_id: row.section_id,
      section_name: (row as any).sections?.name ?? null,
      subject_name: row.subject_name,
    })
  }
  return result
}

router.get('/my-classes', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await getOwnClassCombos(req.user!.id, req.user!.school_id)
  res.json({ success: true, data: result })
}))

// plan.md Phase 5: GET /homework, /syllabus, /syllabus/stats and
// /progress-notes all used to trust class_id/section_id/subject_name query
// params directly — restricting a Teacher to their own classes was purely
// a frontend class-picker convention, not enforced server-side. "Senior
// management" here means the same signal the frontend already uses
// (isSeniorManagement = canPlanSyllabus in homework/page.tsx): holding
// syllabus.plan, or a super role. Everyone else gets filtered to their own
// timetabled class+subject(+section) combos, regardless of what they pass
// in the query string.
async function resolveClassScope(req: AuthRequest): Promise<{ senior: true } | { senior: false; combos: OwnClassCombo[] }> {
  const school_id = req.user!.school_id
  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
  if (isSuperRole || permissionCodes.has('syllabus.plan')) return { senior: true }
  const combos = await getOwnClassCombos(req.user!.id, school_id)
  return { senior: false, combos }
}

// Whole-class rows (section_id null) are visible if the caller teaches
// that class+subject in ANY of their own sections — that's what "whole
// class" means to begin with. A row scoped to one specific section is
// only visible if that's actually one of the caller's own sections.
function inClassScope(combos: OwnClassCombo[], classId: string | null, subjectName: string | null, sectionId: string | null): boolean {
  const pairMatch = combos.some(c => c.class_id === classId && c.subject_name === subjectName)
  if (!pairMatch) return false
  if (sectionId == null) return true
  return combos.some(c => c.class_id === classId && c.subject_name === subjectName && c.section_id === sectionId)
}

// ═══════════════════════════════════════════════════════════════
// HOMEWORK / CLASSWORK
// ═══════════════════════════════════════════════════════════════

const CreateHomeworkSchema = z.object({
  class_id: z.string(),
  section_id: z.string().optional(),
  subject_name: z.string().min(1),
  type: z.enum(['homework', 'classwork']).default('homework'),
  assignment_type: z.enum(['class', 'individual']).default('class'),
  title: z.string().min(1),
  description: z.string().optional(),
  attachment_url: z.string().optional(),
  // plan.md Phase 10 — the standout cross-link: optional, most homework
  // won't have one, same nullable-optional-link shape as
  // daily_progress_notes.chapter_id.
  chapter_id: z.string().optional(),
  // plan.md Phase 4: lets the Assign modal attach a file at create time,
  // same base64-in-JSON pattern as the submission upload below — the
  // homework row doesn't exist yet when the file is picked, so this
  // uploads server-side right after insert rather than needing a
  // stand-alone pre-upload endpoint.
  file_base64: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  due_date: z.string().optional(),
  student_ids: z.array(z.string()).optional(),
})

const UpdateHomeworkSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  attachment_url: z.string().optional(),
  due_date: z.string().optional(),
  file_base64: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
})

router.get('/homework', requirePermissionV2('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!studentId) return res.json({ success: true, data: [] })

    const { data: student } = await supabase.from('students').select('class_id, section_id').eq('id', studentId).single()
    if (!student) return res.json({ success: true, data: [] })

    // Every homework item — class-wide or individual — gets a
    // homework_students row per target student since plan.md Phase 1 (see
    // POST /homework below), so this doubles as both "which homework is
    // mine" and "what's my submission/grade state on it". A student who
    // joined the class after a class-wide item was posted has no row for
    // it — the first OR clause below still surfaces the item for them,
    // just with my_submission: null.
    const { data: mine } = await supabase.from('homework_students').select('*').eq('student_id', studentId)
    const mineByHomeworkId = new Map((mine ?? []).map(r => [r.homework_id, r]))

    let query = supabase
      .from('homework')
      .select('*, classes(name), sections(name)')
      .eq('school_id', school_id)
      .order('due_date', { ascending: true })

    const orParts = [`and(assignment_type.eq.class,class_id.eq.${student.class_id})`]
    if (mineByHomeworkId.size) orParts.push(`id.in.(${[...mineByHomeworkId.keys()].join(',')})`)
    query = query.or(orParts.join(','))

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    const merged = (data ?? []).map(hw => ({ ...hw, my_submission: mineByHomeworkId.get(hw.id) ?? null }))
    return res.json({ success: true, data: merged })
  }

  const { class_id, section_id, subject_name } = req.query
  const scope = await resolveClassScope(req)
  if (!scope.senior && !scope.combos.length) return res.json({ success: true, data: [] })

  let query = supabase
    .from('homework')
    .select('*, classes(name), sections(name), users:created_by(full_name)')
    .eq('school_id', school_id)
    .order('assigned_date', { ascending: false })

  if (class_id) query = query.eq('class_id', class_id as string)
  // A whole-class item (section_id null) belongs to every section of its
  // class, including whichever one is being filtered to here — same
  // "section is null OR matches" convention GET /syllabus and
  // /syllabus/stats already use just below. A plain .eq() would silently
  // drop every whole-class assignment the moment a section filter is
  // applied, which is exactly what a Teacher's own class picker does the
  // instant they narrow down to one section.
  if (section_id) query = query.or(`section_id.eq.${section_id},section_id.is.null`)
  if (subject_name) query = query.eq('subject_name', subject_name as string)
  if (!scope.senior) query = query.in('class_id', [...new Set(scope.combos.map(c => c.class_id))])

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })

  const result = scope.senior
    ? (data ?? [])
    : (data ?? []).filter((hw: any) => inClassScope(scope.combos, hw.class_id, hw.subject_name, hw.section_id))

  res.json({ success: true, data: result })
}))

router.post('/homework', requirePermissionV2('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateHomeworkSchema.parse(req.body)
    const school_id = req.user!.school_id

    if (body.assignment_type === 'individual' && !body.student_ids?.length) {
      return res.status(400).json({ success: false, error: 'student_ids required for an individual assignment' })
    }

    const { data: homework, error } = await supabase
      .from('homework')
      .insert({
        school_id,
        class_id: body.class_id,
        section_id: body.assignment_type === 'class' ? (body.section_id || null) : null,
        subject_name: body.subject_name,
        type: body.type,
        assignment_type: body.assignment_type,
        title: body.title,
        description: body.description || null,
        attachment_url: body.attachment_url || null,
        due_date: body.due_date || null,
        chapter_id: body.chapter_id || null,
        created_by: req.user!.id,
      })
      .select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })

    // Best-effort, not rolled back on failure: the attachment is decoration
    // on an assignment, not the point of it — losing the file shouldn't
    // cost the teacher the title/description/due-date they just filled in.
    if (body.file_base64 && body.file_name) {
      const base64Data = body.file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const filePath = `${school_id}/assignments/${homework.id}/${Date.now()}_${body.file_name}`
      const { error: uploadErr } = await supabase.storage
        .from('homework-submissions')
        .upload(filePath, buffer, { contentType: body.mime_type ?? 'application/octet-stream', upsert: false })
      if (uploadErr) {
        console.error('Failed to upload homework attachment:', uploadErr.message)
      } else {
        const { data: urlData } = supabase.storage.from('homework-submissions').getPublicUrl(filePath)
        const { error: patchErr } = await supabase.from('homework').update({ attachment_url: urlData.publicUrl }).eq('id', homework.id)
        if (!patchErr) homework.attachment_url = urlData.publicUrl
      }
    }

    // Every homework item gets a homework_students row per real target
    // student — whole-class included, not just individual (was: only
    // 'individual' got these rows, which is also why the teacher
    // dashboard's homework_assigned metric and GET /homework's portal view
    // used to silently exclude whole-class homework). This is what
    // submission (below) and grading actually write against — see
    // plan.md Phase 1/2.
    let targetStudentIds: string[] = []
    if (body.assignment_type === 'individual') {
      targetStudentIds = body.student_ids ?? []
    } else {
      let studentsQuery = supabase.from('students').select('id')
        .eq('school_id', school_id).eq('class_id', body.class_id).eq('status', 'active')
      if (body.section_id) studentsQuery = studentsQuery.eq('section_id', body.section_id)
      const { data: classStudents } = await studentsQuery
      targetStudentIds = (classStudents ?? []).map(s => s.id)
    }

    if (targetStudentIds.length) {
      const rows = targetStudentIds.map(student_id => ({ homework_id: homework.id, student_id }))
      const { error: linkErr } = await supabase.from('homework_students').insert(rows)
      if (linkErr) {
        await supabase.from('homework').delete().eq('id', homework.id)
        return res.status(400).json({ success: false, error: linkErr.message })
      }
    }

    try {
      const recipients = await getRecipientUserIdsForStudents(targetStudentIds)
      await createNotifications(recipients, {
        schoolId: school_id, type: 'homework_assigned',
        title: `New ${body.type === 'classwork' ? 'classwork' : 'homework'}: ${body.subject_name}`,
        message: `"${body.title}"${body.due_date ? ` — due ${body.due_date}` : ''}`,
        link: '/homework',
        relatedEntityType: 'homework', relatedEntityId: homework.id,
      })
    } catch (notifyErr) {
      console.error('Failed to create homework notifications:', notifyErr)
    }

    res.status(201).json({ success: true, data: homework })
  })
)

// plan.md Phase 3 — previously POST+DELETE only, so fixing a typo in a due
// date meant deleting and recreating the whole assignment (and losing its
// homework_students links). Deliberately narrow: assignment_type and the
// class/student targets stay out of scope — re-targeting an assignment that
// may already have real submissions against it is a different, riskier
// operation than fixing its title or due date.
router.patch('/homework/:id', requirePermissionV2('homework.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { file_base64, file_name, mime_type, ...body } = UpdateHomeworkSchema.parse(req.body)

    const { data: existing } = await supabase.from('homework').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!existing) return res.status(404).json({ success: false, error: 'Homework not found' })

    if (file_base64 && file_name) {
      const base64Data = file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const filePath = `${school_id}/assignments/${id}/${Date.now()}_${file_name}`
      const { error: uploadErr } = await supabase.storage
        .from('homework-submissions')
        .upload(filePath, buffer, { contentType: mime_type ?? 'application/octet-stream', upsert: false })
      if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
      const { data: urlData } = supabase.storage.from('homework-submissions').getPublicUrl(filePath)
      body.attachment_url = urlData.publicUrl
    }

    if (!Object.keys(body).length) {
      return res.status(400).json({ success: false, error: 'No changes provided' })
    }

    const { data, error } = await supabase.from('homework').update(body).eq('id', id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/homework/:id', requirePermissionV2('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('homework').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// plan.md Phase 6/9: the school-level submission-policy toggles. Kept as
// their own small endpoint rather than folded into an existing settings
// surface — Phase 9's placement decision resolved 2026-08-27: extend this
// same minimal endpoint/card rather than build a separate "Academics
// Settings" page for one more toggle.
router.get('/homework-settings', requirePermissionV2('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data } = await supabase.from('schools')
      .select('homework_accept_late_submissions, homework_late_grace_days, homework_resubmission_allowed')
      .eq('id', req.user!.school_id).maybeSingle()
    const row = (data as any) ?? {}
    res.json({
      success: true,
      data: {
        homework_accept_late_submissions: row.homework_accept_late_submissions ?? true,
        homework_late_grace_days: row.homework_late_grace_days ?? 0,
        homework_resubmission_allowed: row.homework_resubmission_allowed ?? false,
      },
    })
  })
)

router.patch('/homework-settings', requireRole('school_admin'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const update: Record<string, number | boolean> = {}
    if (req.body.homework_accept_late_submissions !== undefined) {
      if (typeof req.body.homework_accept_late_submissions !== 'boolean') {
        return res.status(400).json({ success: false, error: 'homework_accept_late_submissions must be a boolean' })
      }
      update.homework_accept_late_submissions = req.body.homework_accept_late_submissions
    }
    if (req.body.homework_late_grace_days !== undefined) {
      if (!Number.isInteger(req.body.homework_late_grace_days) || req.body.homework_late_grace_days < 0) {
        return res.status(400).json({ success: false, error: 'homework_late_grace_days must be a non-negative integer' })
      }
      update.homework_late_grace_days = req.body.homework_late_grace_days
    }
    if (req.body.homework_resubmission_allowed !== undefined) {
      if (typeof req.body.homework_resubmission_allowed !== 'boolean') {
        return res.status(400).json({ success: false, error: 'homework_resubmission_allowed must be a boolean' })
      }
      update.homework_resubmission_allowed = req.body.homework_resubmission_allowed
    }
    if (!Object.keys(update).length) return res.status(400).json({ success: false, error: 'No changes provided' })

    const { error } = await supabase.from('schools').update(update).eq('id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data: update })
  })
)

// ── SUBMISSION + GRADING (plan.md Phase 1/2) ─────────────────
// homework_students.status ('assigned'|'submitted'|'graded') existed
// since the teacher-dashboard migration, read by three dashboard
// surfaces, written by nothing — these are that write-side.
function uploadHomeworkSubmissionFile(schoolId: string, homeworkId: string, studentId: string, file_base64: string, file_name: string, mime_type?: string) {
  const base64Data = file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${schoolId}/${homeworkId}/${studentId}/${Date.now()}_${file_name}`
  return { buffer, filePath }
}

const SubmitHomeworkSchema = z.object({
  submission_text: z.string().optional(),
  file_base64: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
})

async function recordHomeworkSubmission(params: {
  homeworkId: string; studentId: string; schoolId: string
  submission_text?: string; file_base64?: string; file_name?: string; mime_type?: string
}): Promise<{ success: true; data: any } | { success: false; status: number; error: string }> {
  const { homeworkId, studentId, schoolId, submission_text, file_base64, file_name, mime_type } = params

  const [{ data: hw }, { data: school }] = await Promise.all([
    supabase.from('homework').select('id, due_date, class_id, section_id, assignment_type').eq('id', homeworkId).eq('school_id', schoolId).maybeSingle(),
    supabase.from('schools').select('homework_accept_late_submissions, homework_late_grace_days, homework_resubmission_allowed').eq('id', schoolId).maybeSingle(),
  ])
  if (!hw) return { success: false, status: 404, error: 'Homework not found' }

  const { data: existing } = await supabase.from('homework_students')
    .select('id, status').eq('homework_id', homeworkId).eq('student_id', studentId).maybeSingle()

  // Caught live while verifying Phase 6: with no check here, any student
  // could submit against any homework_id in the school by guessing/reusing
  // an id, creating a phantom homework_students row for an assignment
  // never targeted at them. No fanned-out row already existing is only
  // legitimate for class-wide homework whose class/section genuinely
  // matches this student (covers a student who joined after a whole-class
  // item posted, or homework created before the Phase 1 fan-out fix) —
  // never for an individual assignment they weren't explicitly listed for.
  if (!existing) {
    if ((hw as any).assignment_type !== 'class') {
      return { success: false, status: 403, error: 'This homework was not assigned to you.' }
    }
    const { data: student } = await supabase.from('students').select('class_id, section_id').eq('id', studentId).maybeSingle()
    const classMatches = student?.class_id === (hw as any).class_id
    const sectionMatches = !(hw as any).section_id || (hw as any).section_id === student?.section_id
    if (!classMatches || !sectionMatches) {
      return { success: false, status: 403, error: 'This homework was not assigned to you.' }
    }
  }

  // plan.md Phase 9: resubmission after grading is off by default —
  // chosen conservative, unlike most other toggles in this module, since
  // an ungated resubmission could be used to game a grade after seeing
  // feedback. When a school does turn it on, a resubmission clears the
  // previous grade/feedback entirely rather than leaving a stale grade
  // sitting against a new answer — the teacher re-grades from scratch.
  const isResubmission = existing?.status === 'graded'
  if (isResubmission && !((school as any)?.homework_resubmission_allowed ?? false)) {
    return { success: false, status: 400, error: 'This homework has already been graded — resubmission is not enabled for this school.' }
  }

  // plan.md Phase 6: past due_date is still accepted by default (a grace
  // period, not a deadline that locks the door) — matching Fedena's model,
  // where a late submission is flagged for the teacher to accept/reject
  // rather than the system silently rejecting it. A school can turn
  // acceptance off entirely; that's the one case where lateness actually
  // blocks the submission instead of just tagging it.
  let is_late = false
  if ((hw as any).due_date) {
    const graceDays = (school as any)?.homework_late_grace_days ?? 0
    const deadline = new Date((hw as any).due_date)
    deadline.setDate(deadline.getDate() + graceDays)
    is_late = new Date() > deadline
    const acceptLate = (school as any)?.homework_accept_late_submissions ?? true
    if (is_late && !acceptLate) {
      return { success: false, status: 400, error: 'This school does not accept homework submitted after the due date.' }
    }
  }

  let submission_file_url: string | undefined
  if (file_base64 && file_name) {
    const { buffer, filePath } = uploadHomeworkSubmissionFile(schoolId, homeworkId, studentId, file_base64, file_name, mime_type)
    const { error: uploadErr } = await supabase.storage
      .from('homework-submissions')
      .upload(filePath, buffer, { contentType: mime_type ?? 'application/octet-stream', upsert: false })
    if (uploadErr) return { success: false, status: 400, error: uploadErr.message }
    const { data: urlData } = supabase.storage.from('homework-submissions').getPublicUrl(filePath)
    submission_file_url = urlData.publicUrl
  }

  const patch = {
    submission_text: submission_text ?? null,
    ...(submission_file_url ? { submission_file_url } : {}),
    submitted_at: new Date().toISOString(),
    status: 'submitted',
    is_late,
    // A resubmission returns to a clean 'submitted' state — the previous
    // grade shouldn't linger against a new answer the teacher hasn't seen.
    ...(isResubmission ? { marks_obtained: null, max_marks: null, feedback: null, graded_at: null, graded_by: null } : {}),
  }

  const { data, error } = existing
    ? await supabase.from('homework_students').update(patch).eq('id', existing.id).select().single()
    : await supabase.from('homework_students').insert({ homework_id: homeworkId, student_id: studentId, ...patch }).select().single()

  if (error) return { success: false, status: 400, error: error.message }
  return { success: true, data }
}

// POST /academics/homework/:id/submit — the calling parent/student
// submitting their OWN homework. Portal-facing, no staff permission.
router.post('/homework/:id/submit', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  if (!NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'This endpoint is for parent/student accounts' })
  }
  const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
  if (!studentId) return res.status(404).json({ success: false, error: 'No student record is linked to this account yet' })

  const body = SubmitHomeworkSchema.parse(req.body)
  if (!body.submission_text && !body.file_base64) {
    return res.status(400).json({ success: false, error: 'Provide submission text or a file' })
  }

  const result = await recordHomeworkSubmission({ homeworkId: req.params.id, studentId, schoolId: school_id, ...body })
  if (!result.success) return res.status(result.status).json({ success: false, error: result.error })
  res.json({ success: true, data: result.data })
}))

// POST /academics/homework/:id/students/:studentId/submit — staff
// recording a submission on a student's behalf (e.g. handed in on paper).
router.post('/homework/:id/students/:studentId/submit', requirePermissionV2('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const body = SubmitHomeworkSchema.parse(req.body)
    if (!body.submission_text && !body.file_base64) {
      return res.status(400).json({ success: false, error: 'Provide submission text or a file' })
    }
    const result = await recordHomeworkSubmission({
      homeworkId: req.params.id, studentId: req.params.studentId, schoolId: school_id, ...body,
    })
    if (!result.success) return res.status(result.status).json({ success: false, error: result.error })
    res.json({ success: true, data: result.data })
  })
)

// GET /academics/homework/:id/students — roster + submission/grade state,
// the data behind the teacher grading view.
router.get('/homework/:id/students', requirePermissionV2('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: hw } = await supabase.from('homework').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!hw) return res.status(404).json({ success: false, error: 'Homework not found' })

    const { data: rows, error } = await supabase.from('homework_students')
      .select('*, students(first_name, last_name, roll_number)')
      .eq('homework_id', req.params.id)
      .order('id')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: { homework: hw, students: rows ?? [] } })
  })
)

// plan.md Phase 7 — "send them a reminder in one click": reminds every
// student on this assignment still at status 'assigned' (never submitted),
// reusing the exact same best-effort notification pathway
// homework_assigned already uses rather than a new delivery mechanism.
router.post('/homework/:id/remind', requirePermissionV2('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: hw } = await supabase.from('homework').select('id, title, subject_name, due_date').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!hw) return res.status(404).json({ success: false, error: 'Homework not found' })

    const { data: pending, error } = await supabase.from('homework_students')
      .select('student_id').eq('homework_id', req.params.id).eq('status', 'assigned')
    if (error) return res.status(500).json({ success: false, error: error.message })

    const studentIds = (pending ?? []).map((r: any) => r.student_id)
    if (!studentIds.length) return res.json({ success: true, data: { reminded: 0 } })

    const recipients = await getRecipientUserIdsForStudents(studentIds)
    try {
      await createNotifications(recipients, {
        schoolId: school_id, type: 'homework_reminder',
        title: `Reminder: ${hw.subject_name}`,
        message: `"${hw.title}" is still pending${hw.due_date ? ` — due ${hw.due_date}` : ''}.`,
        link: '/homework',
        relatedEntityType: 'homework', relatedEntityId: hw.id,
      })
    } catch (notifyErr) {
      console.error('Failed to send homework reminders:', notifyErr)
      return res.status(500).json({ success: false, error: 'Failed to send reminders' })
    }

    res.json({ success: true, data: { reminded: studentIds.length } })
  })
)

const GradeHomeworkSchema = z.object({
  marks_obtained: z.number().nullable().optional(),
  max_marks: z.number().nullable().optional(),
  feedback: z.string().nullable().optional(),
})

// PATCH /academics/homework/:id/students/:studentId/grade
router.patch('/homework/:id/students/:studentId/grade', requirePermissionV2('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, studentId } = req.params
    const school_id = req.user!.school_id
    const body = GradeHomeworkSchema.parse(req.body)

    if (body.marks_obtained == null && !body.feedback) {
      return res.status(400).json({ success: false, error: 'Provide marks and/or feedback' })
    }

    const { data: hw } = await supabase.from('homework').select('id, title, subject_name').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!hw) return res.status(404).json({ success: false, error: 'Homework not found' })

    const { data: existing } = await supabase.from('homework_students')
      .select('id').eq('homework_id', id).eq('student_id', studentId).maybeSingle()

    const patch = {
      marks_obtained: body.marks_obtained ?? null,
      max_marks: body.max_marks ?? null,
      feedback: body.feedback ?? null,
      status: 'graded',
      graded_at: new Date().toISOString(),
      graded_by: req.user!.id,
    }

    const { data, error } = existing
      ? await supabase.from('homework_students').update(patch).eq('id', existing.id).select().single()
      : await supabase.from('homework_students').insert({ homework_id: id, student_id: studentId, ...patch }).select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })

    try {
      const recipients = await getRecipientUserIdsForStudents([studentId])
      await createNotifications(recipients, {
        schoolId: school_id, type: 'homework_graded',
        title: `Graded: ${hw.subject_name}`,
        message: body.marks_obtained != null && body.max_marks != null
          ? `Scored ${body.marks_obtained}/${body.max_marks} on "${hw.title}"`
          : `Feedback added on "${hw.title}"`,
        link: '/homework',
        relatedEntityType: 'homework', relatedEntityId: id,
      })
    } catch (notifyErr) {
      console.error('Failed to create homework_graded notification:', notifyErr)
    }

    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// SYLLABUS — chapter planning (planned date vs actual completion)
// ═══════════════════════════════════════════════════════════════

const CreateChaptersSchema = z.object({
  class_id: z.string(),
  section_id: z.string().optional(), // omitted/undefined = applies to every section of the class
  subject_name: z.string().min(1),
  academic_year_id: z.string().optional(),
  chapters: z.array(z.object({
    chapter_number: z.number().optional(),
    chapter_name: z.string().min(1),
    // A chapter's due date is either linked to a real exam on the
    // school's calendar (exam_id — preferred, stays correct if the exam
    // date moves) or a plain custom date (planned_date) when there's no
    // matching exam yet. exam_id wins if both are somehow given.
    exam_id: z.string().optional(),
    planned_date: z.string().optional(),
  })).min(1),
})

// A chapter's effective due date: the linked exam's start_date if one's
// set, otherwise its own planned_date. Centralized here so /syllabus,
// /syllabus/stats, the calendar, and the principal dashboard's syllabus
// rollup all agree on what "due" means.
export function effectiveDueDate(chapter: { planned_date: string | null; exams?: { start_date: string | null } | null }): string | null {
  return chapter.exams?.start_date ?? chapter.planned_date
}

router.get('/syllabus', requirePermissionV2('syllabus.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, section_id, subject_name } = req.query
    const school_id = req.user!.school_id
    const scope = await resolveClassScope(req)
    if (!scope.senior && !scope.combos.length) return res.json({ success: true, data: [] })

    let query = supabase
      .from('syllabus_chapters')
      .select('*, classes(name), sections(name), exams(name, exam_type, start_date)')
      .eq('school_id', school_id).order('chapter_number')
    if (class_id) query = query.eq('class_id', class_id as string)
    // A section's effective chapter list is "chapters scoped to this
    // section" PLUS "chapters scoped to the whole class" — same
    // null-means-everyone pattern as timetable_periods/homework.
    if (section_id) query = query.or(`section_id.eq.${section_id},section_id.is.null`)
    if (subject_name) query = query.eq('subject_name', subject_name as string)
    if (!scope.senior) query = query.in('class_id', [...new Set(scope.combos.map(c => c.class_id))])

    const { data: rawData, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    let data = (rawData ?? []).map((c: any) => ({ ...c, due_date: effectiveDueDate(c) }))
    if (!scope.senior) data = data.filter((c: any) => inClassScope(scope.combos, c.class_id, c.subject_name, c.section_id))

    // plan.md Phase 10 — homework completion alongside pacing completion,
    // rolled into this same per-chapter response rather than a parallel
    // endpoint. Only chapters with at least one linked homework item get
    // a summary; everything else stays exactly as before.
    if (data.length) {
      const { data: linkedHomework } = await supabase
        .from('homework')
        .select('chapter_id, homework_students(status)')
        .eq('school_id', school_id)
        .in('chapter_id', data.map((c: any) => c.id))
      const summaryByChapter = new Map<string, { items: number; submitted: number; graded: number; pending: number }>()
      for (const hw of (linkedHomework ?? []) as any[]) {
        const s = summaryByChapter.get(hw.chapter_id) ?? { items: 0, submitted: 0, graded: 0, pending: 0 }
        s.items++
        for (const hs of hw.homework_students ?? []) {
          if (hs.status === 'graded') s.graded++
          else if (hs.status === 'submitted') s.submitted++
          else s.pending++
        }
        summaryByChapter.set(hw.chapter_id, s)
      }
      data = data.map((c: any) => ({ ...c, homework_summary: summaryByChapter.get(c.id) ?? null }))
    }

    res.json({ success: true, data })
  })
)

// GET /syllabus/stats — completion summary for admin/principal reporting.
// Pass class_id (+ optional section_id to scope to one section's actual
// effective chapter list) or omit both for a school-wide rollup.
router.get('/syllabus/stats', requirePermissionV2('syllabus.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, section_id } = req.query
    const school_id = req.user!.school_id
    const scope = await resolveClassScope(req)
    if (!scope.senior && !scope.combos.length) return res.json({ success: true, data: [] })

    let query = supabase
      .from('syllabus_chapters')
      .select('class_id, section_id, subject_name, status, planned_date, classes(name), sections(name), exams(start_date)')
      .eq('school_id', school_id)
    if (class_id) query = query.eq('class_id', class_id as string)
    if (section_id) query = query.or(`section_id.eq.${section_id},section_id.is.null`)
    if (!scope.senior) query = query.in('class_id', [...new Set(scope.combos.map(c => c.class_id))])

    // When scoped to a specific section, every chapter's own section_id
    // may be null (a whole-class chapter folded into this section's
    // reading) — so the group's displayed section identity has to come
    // from the query param's section, looked up once, not from whichever
    // individual chapter happened to be grouped first.
    //
    // That lookup does not depend on the chapters, so it runs alongside them
    // rather than after (~245ms per round-trip to this Supabase).
    const [{ data: chapters }, sectionResult] = await Promise.all([
      query,
      section_id
        ? supabase.from('sections').select('id, name').eq('id', section_id as string).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const queriedSection: { id: string; name: string } | null = (sectionResult as any)?.data ?? null

    const today = new Date().toISOString().slice(0, 10)

    const scopedChapters = scope.senior
      ? (chapters ?? [])
      : (chapters ?? []).filter((c: any) => inClassScope(scope.combos, c.class_id, c.subject_name, c.section_id))

    const groups: Record<string, any> = {}
    for (const c of scopedChapters) {
      // When scoped to one section, fold class-wide (section_id null) and
      // section-specific chapters into a single reading for that section
      // — that's the section's real effective syllabus. When not scoped
      // to a section, group per actual section_id so different sections'
      // paces don't get averaged together.
      const groupSectionId = section_id ? (section_id as string) : (c.section_id ?? 'whole-class')
      const key = `${c.class_id}::${groupSectionId}::${c.subject_name}`
      if (!groups[key]) {
        groups[key] = {
          class_id: c.class_id, class_name: (c as any).classes?.name,
          section_id: section_id ? queriedSection?.id ?? null : c.section_id,
          section_name: section_id ? queriedSection?.name ?? null : (c as any).sections?.name ?? null,
          subject_name: c.subject_name,
          total: 0, completed: 0, expected_by_now: 0, behind_schedule: 0,
        }
      }
      groups[key].total++
      if (c.status === 'completed') groups[key].completed++
      // "Expected by now" = every chapter due (whether tied to an exam's
      // actual date or a custom date) that has already passed — the pace
      // the plan calls for, independent of whether it actually got
      // covered. Exam-linked chapters always use the exam's live date,
      // so this stays accurate if the exam schedule shifts.
      const dueDate = effectiveDueDate(c)
      if (dueDate && dueDate <= today) groups[key].expected_by_now++
      if (c.status !== 'completed' && dueDate && dueDate < today) groups[key].behind_schedule++
    }

    const data = Object.values(groups).map((g: any) => {
      const percent_complete = g.total ? Math.round((g.completed / g.total) * 100) : 0
      const percent_expected = g.total ? Math.round((g.expected_by_now / g.total) * 100) : 0
      return { ...g, percent_complete, percent_expected, gap: percent_complete - percent_expected }
    })

    res.json({ success: true, data })
  })
)

const ImportChaptersSchema = z.object({ file: z.string().min(1) })

// POST /syllabus/import-chapters — reads chapter names out of an
// uploaded .xlsx so the "Add chapters" rows on the Due Dates page can be
// filled in from a school's existing list instead of typed one at a
// time. Nothing is written here — this only returns names for the rows
// already in front of the user, same "nothing saved until you confirm"
// rule the timetable import follows, just without that flow's
// preview/commit split since there's no ambiguous matching to resolve
// here (a chapter name isn't matched against anything existing).
// Reuses the dependency-free XLSX reader timetable import already built
// (backend/src/modules/timetable/import/xlsx.ts) rather than adding a
// parsing library for a second, much simpler shape: one column, one
// header row, done.
router.post('/syllabus/import-chapters', requirePermissionV2('syllabus.plan'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { file } = ImportChaptersSchema.parse(req.body)
    const cleaned = file.includes(',') ? file.slice(file.indexOf(',') + 1) : file
    const buffer = Buffer.from(cleaned, 'base64')
    if (!buffer.length) return res.status(400).json({ success: false, error: 'That file appears to be empty.' })
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'A chapter list is kilobytes. That file is over 2MB.' })
    }

    let sheets
    try {
      sheets = readWorkbook(buffer)
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err?.message ?? 'Could not read that spreadsheet.' })
    }
    const sheet = sheets[0]
    if (!sheet) return res.status(400).json({ success: false, error: 'That workbook has no sheets.' })

    // Row 1 is always treated as a header and skipped. Column A is the
    // chapter name; anything else on the row is ignored — due dates stay
    // a manual, per-row decision (exam-linked or custom) same as today.
    const chapter_names = sheet.rows
      .slice(1)
      .map(row => (row[0] ?? '').trim())
      .filter(Boolean)
      .slice(0, 200)

    if (!chapter_names.length) {
      return res.status(400).json({
        success: false,
        error: "Couldn't find any chapter names — put one per row in the first column, below a header row.",
      })
    }

    res.json({ success: true, data: { chapter_names } })
  })
)

router.post('/syllabus', requirePermissionV2('syllabus.plan'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateChaptersSchema.parse(req.body)
    const school_id = req.user!.school_id

    const rows = body.chapters.map(ch => ({
      school_id,
      class_id: body.class_id,
      section_id: body.section_id || null,
      subject_name: body.subject_name,
      academic_year_id: body.academic_year_id || null,
      chapter_number: ch.chapter_number ?? null,
      chapter_name: ch.chapter_name,
      exam_id: ch.exam_id || null,
      planned_date: ch.exam_id ? null : (ch.planned_date || null),
      created_by: req.user!.id,
    }))

    const { data, error } = await supabase.from('syllabus_chapters').insert(rows).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data, count: data?.length })
  })
)

// PATCH /syllabus/:id — field-level split: editing the plan itself
// (name/due date) needs syllabus.plan (senior management, who set the
// schedule); logging what actually got covered (status/completion
// date) needs syllabus.log_progress (the teacher who taught it). A
// request touching only log fields must not require plan rights, and
// vice versa — requireAnyPermissionV2 alone would let a log-only
// teacher quietly edit the due-date schedule too.
router.patch('/syllabus/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { chapter_name, exam_id, planned_date, actual_completion_date, status } = req.body
  const school_id = req.user!.school_id

  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
  const hasPlan = isSuperRole || permissionCodes.has('syllabus.plan')
  const hasLog = isSuperRole || permissionCodes.has('syllabus.log_progress')

  const editsPlanFields = chapter_name !== undefined || exam_id !== undefined || planned_date !== undefined
  const editsLogFields = actual_completion_date !== undefined || status !== undefined

  if (editsPlanFields && !hasPlan) {
    return res.status(403).json({ success: false, error: 'Missing permission: syllabus.plan' })
  }
  if (editsLogFields && !hasLog) {
    return res.status(403).json({ success: false, error: 'Missing permission: syllabus.log_progress' })
  }

  const update: Record<string, any> = {}
  if (chapter_name !== undefined) update.chapter_name = chapter_name
  if (exam_id !== undefined) { update.exam_id = exam_id || null; update.planned_date = null }
  else if (planned_date !== undefined) { update.planned_date = planned_date || null; update.exam_id = null }
  if (actual_completion_date !== undefined) update.actual_completion_date = actual_completion_date || null
  if (status !== undefined) update.status = status
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('syllabus_chapters').update(update).eq('id', id).eq('school_id', school_id)
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/syllabus/:id', requirePermissionV2('syllabus.plan'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('syllabus_chapters').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// SYLLABUS DOCUMENTS — Organizational Settings -> Syllabus Setup's
// "upload a reference document" option. A raw file (a CBSE-issued
// syllabus PDF, last year's plan, whatever the school already has) kept
// as-is against a class/section/subject — distinct from
// syllabus_chapters, which is the structured chapter list the Import
// and Type-it-in options both write into. syllabus.plan-gated, same
// permission as defining chapters: this is a setup action, not a
// day-to-day one.
// ═══════════════════════════════════════════════════════════════

const UploadSyllabusDocSchema = z.object({
  class_id: z.string(),
  section_id: z.string().optional(),
  subject_name: z.string().min(1),
  document_name: z.string().min(1),
  file_base64: z.string().min(1),
  file_name: z.string().min(1),
  mime_type: z.string().optional(),
})

router.get('/syllabus/documents', requirePermissionV2('syllabus.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, section_id, subject_name } = req.query
    const school_id = req.user!.school_id
    let query = supabase
      .from('syllabus_documents')
      .select('*, classes(name), sections(name), users:uploaded_by(full_name)')
      .eq('school_id', school_id)
      .order('created_at', { ascending: false })
    if (class_id) query = query.eq('class_id', class_id as string)
    // A whole-class document (section_id null) applies to every section —
    // same "section is null OR matches" convention used throughout this
    // module (GET /syllabus, /syllabus/stats, and — after the earlier fix
    // — GET /homework).
    if (section_id) query = query.or(`section_id.eq.${section_id},section_id.is.null`)
    if (subject_name) query = query.eq('subject_name', subject_name as string)
    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/syllabus/documents', requirePermissionV2('syllabus.plan'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = UploadSyllabusDocSchema.parse(req.body)
    const school_id = req.user!.school_id

    const base64Data = body.file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'That file is over 15MB.' })
    }
    const filePath = `${school_id}/${body.class_id}/${Date.now()}_${body.file_name}`
    const { error: uploadErr } = await supabase.storage
      .from('syllabus-documents')
      .upload(filePath, buffer, { contentType: body.mime_type ?? 'application/octet-stream', upsert: false })
    if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
    const { data: urlData } = supabase.storage.from('syllabus-documents').getPublicUrl(filePath)

    const { data, error } = await supabase.from('syllabus_documents').insert({
      school_id,
      class_id: body.class_id,
      section_id: body.section_id || null,
      subject_name: body.subject_name,
      document_name: body.document_name,
      file_url: urlData.publicUrl,
      file_size: buffer.length > 1024 * 1024 ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB` : `${(buffer.length / 1024).toFixed(0)} KB`,
      mime_type: body.mime_type,
      uploaded_by: req.user!.id,
    }).select('*, classes(name), sections(name), users:uploaded_by(full_name)').single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/syllabus/documents/:id', requirePermissionV2('syllabus.plan'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('syllabus_documents').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// DAILY PROGRESS LOGS — a teacher's day-by-day entry against a specific
// chapter. This IS the source of truth for "covered vs left": logging
// progress as 'completed' against a chapter flips that chapter's status
// and completion date, driving the /syllabus/stats meter. chapter_id is
// optional so a general remark unrelated to any one chapter is still
// possible, but the primary flow is chapter-linked.
// ═══════════════════════════════════════════════════════════════

const CreateNoteSchema = z.object({
  class_id: z.string(),
  section_id: z.string().optional(),
  subject_name: z.string().min(1),
  chapter_id: z.string().optional(),
  progress_status: z.enum(['started', 'in_progress', 'completed']).optional(),
  note_date: z.string().optional(),
  note: z.string().optional(),
})

router.get('/progress-notes', requirePermissionV2('syllabus.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, subject_name, from, to } = req.query
    const school_id = req.user!.school_id
    const scope = await resolveClassScope(req)
    if (!scope.senior && !scope.combos.length) return res.json({ success: true, data: [] })

    let query = supabase
      .from('daily_progress_notes')
      .select('*, classes(name), sections(name), users:teacher_id(full_name), syllabus_chapters(chapter_number, chapter_name)')
      .eq('school_id', school_id)
      .order('note_date', { ascending: false })

    if (class_id) query = query.eq('class_id', class_id as string)
    if (subject_name) query = query.eq('subject_name', subject_name as string)
    if (from) query = query.gte('note_date', from as string)
    if (to) query = query.lte('note_date', to as string)
    if (!scope.senior) query = query.in('class_id', [...new Set(scope.combos.map(c => c.class_id))])

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })

    const result = scope.senior
      ? (data ?? [])
      : (data ?? []).filter((n: any) => inClassScope(scope.combos, n.class_id, n.subject_name, n.section_id))

    res.json({ success: true, data: result })
  })
)

router.post('/progress-notes', requirePermissionV2('syllabus.log_progress'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateNoteSchema.parse(req.body)
    const school_id = req.user!.school_id
    const note_date = body.note_date || new Date().toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('daily_progress_notes')
      .insert({
        school_id,
        class_id: body.class_id,
        section_id: body.section_id || null,
        subject_name: body.subject_name,
        chapter_id: body.chapter_id || null,
        progress_status: body.progress_status || null,
        teacher_id: req.user!.id,
        note_date,
        note: body.note || '',
      })
      .select('*, syllabus_chapters(chapter_number, chapter_name)').single()
    if (error) return res.status(400).json({ success: false, error: error.message })

    // Logging progress against a chapter updates the chapter itself —
    // this is what the syllabus meter actually reads.
    if (body.chapter_id && body.progress_status) {
      const chapterUpdate: Record<string, any> = {
        status: body.progress_status === 'completed' ? 'completed' : 'in_progress',
        updated_at: new Date().toISOString(),
      }
      if (body.progress_status === 'completed') chapterUpdate.actual_completion_date = note_date

      const { error: chErr } = await supabase
        .from('syllabus_chapters').update(chapterUpdate).eq('id', body.chapter_id).eq('school_id', school_id)
      if (chErr) return res.status(400).json({ success: false, error: `Logged, but failed to update chapter: ${chErr.message}` })
    }

    res.status(201).json({ success: true, data })
  })
)

router.delete('/progress-notes/:id', requirePermissionV2('syllabus.log_progress'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('daily_progress_notes').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

export default router
