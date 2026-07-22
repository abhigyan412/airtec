import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'

const router = Router()
router.use(authenticate)

// Students/parents don't get the general staff listing — they only ever
// see homework addressed to them. Resolved via students.user_id /
// parents.user_id, which nothing in the app populates yet (no
// student/parent login flow exists), so this branch is correct but will
// return empty until that gap is closed elsewhere.
const NON_STAFF_ROLES = ['parent', 'student']

async function resolveOwnStudentId(userId: string, role: string, schoolId: string): Promise<string | null> {
  if (role === 'student') {
    const { data } = await supabase.from('students').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle()
    return data?.id ?? null
  }
  const { data: parent } = await supabase.from('parents').select('student_id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle()
  return parent?.student_id ?? null
}

// GET /academics/my-classes — the class/section/SUBJECT combos the
// CALLING user actually teaches, sourced from timetable_periods (the
// same source of truth the Timetable page's "Teacher View" already
// uses). A Teacher's homework/syllabus view is restricted to this list,
// not a free pick of every class (or every subject within a class) in
// the school — that's a School Admin/Principal thing. Subject matters
// here, not just class/section: a Maths teacher for Class 1-A shouldn't
// see Class 1-A's English progress just because they share a section.
router.get('/my-classes', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  const { data, error } = await supabase
    .from('timetable_periods')
    .select('class_id, section_id, subject_name, classes(name), sections(name)')
    .eq('school_id', school_id)
    .eq('teacher_id', req.user!.id)
    .eq('is_break', false)

  if (error) return res.status(500).json({ success: false, error: error.message })

  const seen = new Set<string>()
  const result: any[] = []
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

  res.json({ success: true, data: result })
}))

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
  due_date: z.string().optional(),
  student_ids: z.array(z.string()).optional(),
})

router.get('/homework', requirePermissionV2('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!studentId) return res.json({ success: true, data: [] })

    const { data: student } = await supabase.from('students').select('class_id, section_id').eq('id', studentId).single()
    if (!student) return res.json({ success: true, data: [] })

    const { data: individual } = await supabase.from('homework_students').select('homework_id').eq('student_id', studentId)
    const individualIds = (individual ?? []).map(r => r.homework_id)

    let query = supabase
      .from('homework')
      .select('*, classes(name), sections(name)')
      .eq('school_id', school_id)
      .order('due_date', { ascending: true })

    const orParts = [`and(assignment_type.eq.class,class_id.eq.${student.class_id})`]
    if (individualIds.length) orParts.push(`id.in.(${individualIds.join(',')})`)
    query = query.or(orParts.join(','))

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.json({ success: true, data })
  }

  const { class_id, section_id, subject_name } = req.query
  let query = supabase
    .from('homework')
    .select('*, classes(name), sections(name), users:created_by(full_name)')
    .eq('school_id', school_id)
    .order('assigned_date', { ascending: false })

  if (class_id) query = query.eq('class_id', class_id as string)
  if (section_id) query = query.eq('section_id', section_id as string)
  if (subject_name) query = query.eq('subject_name', subject_name as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
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
        created_by: req.user!.id,
      })
      .select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })

    if (body.assignment_type === 'individual' && body.student_ids?.length) {
      const rows = body.student_ids.map(student_id => ({ homework_id: homework.id, student_id }))
      const { error: linkErr } = await supabase.from('homework_students').insert(rows)
      if (linkErr) {
        await supabase.from('homework').delete().eq('id', homework.id)
        return res.status(400).json({ success: false, error: linkErr.message })
      }
    }

    res.status(201).json({ success: true, data: homework })
  })
)

router.delete('/homework/:id', requirePermissionV2('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('homework').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
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
// /syllabus/stats, and the calendar all agree on what "due" means.
function effectiveDueDate(chapter: { planned_date: string | null; exams?: { start_date: string | null } | null }): string | null {
  return chapter.exams?.start_date ?? chapter.planned_date
}

router.get('/syllabus', requirePermissionV2('syllabus.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, section_id, subject_name } = req.query
    const school_id = req.user!.school_id

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

    const { data: rawData, error } = await query
    const data = (rawData ?? []).map((c: any) => ({ ...c, due_date: effectiveDueDate(c) }))
    if (error) return res.status(500).json({ success: false, error: error.message })
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

    let query = supabase
      .from('syllabus_chapters')
      .select('class_id, section_id, subject_name, status, planned_date, classes(name), sections(name), exams(start_date)')
      .eq('school_id', school_id)
    if (class_id) query = query.eq('class_id', class_id as string)
    if (section_id) query = query.or(`section_id.eq.${section_id},section_id.is.null`)

    const { data: chapters } = await query

    // When scoped to a specific section, every chapter's own section_id
    // may be null (a whole-class chapter folded into this section's
    // reading) — so the group's displayed section identity has to come
    // from the query param's section, looked up once, not from whichever
    // individual chapter happened to be grouped first.
    let queriedSection: { id: string; name: string } | null = null
    if (section_id) {
      const { data: sec } = await supabase.from('sections').select('id, name').eq('id', section_id as string).maybeSingle()
      queriedSection = sec ?? null
    }

    const today = new Date().toISOString().slice(0, 10)

    const groups: Record<string, any> = {}
    for (const c of chapters ?? []) {
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

    let query = supabase
      .from('daily_progress_notes')
      .select('*, classes(name), sections(name), users:teacher_id(full_name), syllabus_chapters(chapter_number, chapter_name)')
      .eq('school_id', school_id)
      .order('note_date', { ascending: false })

    if (class_id) query = query.eq('class_id', class_id as string)
    if (subject_name) query = query.eq('subject_name', subject_name as string)
    if (from) query = query.gte('note_date', from as string)
    if (to) query = query.lte('note_date', to as string)

    const { data, error } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
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
