import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'

const router = Router()
router.use(authenticate)

const CreateExamSchema = z.object({
    name: z.string().min(1),
    exam_type: z.enum(['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']),
    academic_year_id: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    grading_system: z.enum(['marks', 'grades', 'cgpa']).default('marks'),
})

const CreateExamSubjectSchema = z.object({
    exam_id: z.string(),
    class_id: z.string(),
    subject_name: z.string().min(1),
    exam_date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    max_marks: z.number().default(100),
    pass_marks: z.number().default(33),
    exam_hall: z.string().optional(),
})

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page = '1', limit = '20', status } = req.query
    const { from, to } = getPagination(Number(page), Number(limit))
    let query = supabase
        .from('exams')
        .select('*, academic_years(name)', { count: 'exact' })
        .eq('school_id', req.user!.school_id)
        .range(from, to)
        .order('created_at', { ascending: false })
    if (status) query = query.eq('status', status as string)
    const { data, error, count } = await query
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data, meta: { total: count ?? 0 } })
}))

router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const [total, draft, ongoing, completed] = await Promise.all([
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'draft'),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'ongoing'),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'completed'),
    ])
    res.json({ success: true, data: { total: total.count ?? 0, draft: draft.count ?? 0, ongoing: ongoing.count ?? 0, completed: completed.count ?? 0 } })
}))

router.get('/subjects/add', asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({ success: true, message: 'use POST' })
}))

router.post('/subjects/add', requireRole('school_admin', 'principal', 'teacher'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateExamSubjectSchema.parse(req.body)
        const { data, error } = await supabase
            .from('exam_subjects')
            .insert({
                ...body,
                school_id: req.user!.school_id,
                start_time: body.start_time || null,
                end_time: body.end_time || null,
                exam_date: body.exam_date || null,
            })
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.status(201).json({ success: true, data })
    })
)

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { data, error } = await supabase
        .from('exams')
        .select('*, academic_years(name), exam_subjects(*, classes(name))')
        .eq('id', id)
        .eq('school_id', req.user!.school_id)
        .single()
    if (error || !data) return res.status(404).json({ success: false, error: 'Exam not found' })
    res.json({ success: true, data })
}))

router.post('/', requireRole('school_admin', 'principal', 'teacher'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateExamSchema.parse(req.body)
        const { data, error } = await supabase
            .from('exams')
            .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id })
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.status(201).json({ success: true, data })
    })
)

router.patch('/:id/status', requireRole('school_admin', 'principal'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const { status } = req.body
        const { data, error } = await supabase
            .from('exams')
            .update({ status })
            .eq('id', id)
            .eq('school_id', req.user!.school_id)
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true, data })
    })
)

router.get('/:id/marks/:class_id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, class_id } = req.params
    const school_id = req.user!.school_id
    const { data: subjects } = await supabase.from('exam_subjects').select('*').eq('exam_id', id).eq('class_id', class_id).eq('school_id', school_id)
    const { data: students } = await supabase.from('students').select('id, first_name, last_name, roll_number, admission_number').eq('class_id', class_id).eq('school_id', school_id).eq('status', 'active').order('roll_number')
    const { data: marks } = await supabase.from('student_marks').select('*').eq('exam_id', id).eq('school_id', school_id).in('student_id', (students ?? []).map(s => s.id))
    res.json({ success: true, data: { subjects, students, marks } })
}))

router.post('/:id/marks', requireRole('school_admin', 'principal', 'teacher'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const { exam_subject_id, marks: marksData } = req.body
        const school_id = req.user!.school_id
        const { data: subject } = await supabase.from('exam_subjects').select('*').eq('id', exam_subject_id).single()
        if (!subject) return res.status(404).json({ success: false, error: 'Subject not found' })
        const rows = marksData.map((m: any) => ({
            school_id, exam_id: id, exam_subject_id,
            student_id: m.student_id,
            marks_obtained: m.is_absent ? null : m.marks_obtained,
            is_absent: m.is_absent ?? false,
            grade: computeGrade(m.marks_obtained, subject.max_marks),
            entered_by: req.user!.id,
        }))
        const { data, error } = await supabase.from('student_marks').upsert(rows, { onConflict: 'exam_subject_id,student_id' }).select()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true, data, count: rows.length })
    })
)

// ═══════════════════════════════════════════════════════════════
// RESULT FREEZE & PUBLISH WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
// 3-step workflow on entity_type='exam':
//   Step 1 (Exam Controller / freeze)  — marks review complete, results
//                                          generated and frozen for review
//   Step 2 (Principal / verify)        — principal reviews generated
//                                          results before publishing
//   Step 3 (Principal / publish)       — final publish; report cards
//                                          become visible to students/parents
//
// exams.status mirrors progress:
//   'result_declared' -> results generated, awaiting freeze (old behavior,
//                          kept as-is for when generate-results runs)
//   'result_frozen'   -> step 1 done, awaiting principal verification
//   'result_verified' -> step 2 done, awaiting final publish
//   'result_published'-> step 3 done, visible to students/parents
//
// GET /:id/results and /:id/results/:student_id are gated: students/
// parents (non-staff roles) only see report cards once
// exams.status = 'result_published'. Staff (teacher/admin/principal/
// exam controller) can always see them for review purposes.

router.post('/:id/generate-results', requireRole('school_admin', 'principal'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const school_id = req.user!.school_id
        const { data: subjects } = await supabase.from('exam_subjects').select('*').eq('exam_id', id).eq('school_id', school_id)
        if (!subjects?.length) return res.status(400).json({ success: false, error: 'No subjects found' })
        const { data: allMarks } = await supabase.from('student_marks').select('*').eq('exam_id', id).eq('school_id', school_id)
        if (!allMarks?.length) return res.status(400).json({ success: false, error: 'No marks uploaded yet' })
        const byStudent: Record<string, any[]> = {}
        for (const mark of allMarks) {
            if (!byStudent[mark.student_id]) byStudent[mark.student_id] = []
            byStudent[mark.student_id].push(mark)
        }
        const reportCards = Object.entries(byStudent).map(([student_id, marks]) => {
            const totalMax = subjects.reduce((s, sub) => s + Number(sub.max_marks), 0)
            const obtained = marks.reduce((s, m) => s + (m.is_absent ? 0 : Number(m.marks_obtained ?? 0)), 0)
            const percentage = totalMax > 0 ? Math.round((obtained / totalMax) * 100) : 0
            const passTotal = subjects.reduce((s, sub) => s + Number(sub.pass_marks), 0)
            const isPassed = obtained >= passTotal
            return { school_id, exam_id: id, student_id, total_marks: totalMax, obtained_marks: obtained, percentage, grade: computeGrade(obtained, totalMax), is_pass: isPassed, remarks: isPassed ? 'Promoted' : 'Detained' }
        })
        reportCards.sort((a, b) => b.percentage - a.percentage)
        reportCards.forEach((rc, i) => { (rc as any).rank = i + 1 })
        const { data, error } = await supabase.from('report_cards').upsert(reportCards, { onConflict: 'exam_id,student_id' }).select()
        if (error) return res.status(400).json({ success: false, error: error.message })
        await supabase.from('exams').update({ status: 'result_declared' }).eq('id', id)
        res.json({ success: true, data: { report_cards_generated: data?.length } })
    })
)

// ── POST /:id/start-freeze-workflow ───────────────────────────
// Starts the Result Freeze & Publish workflow for an exam that
// already has results generated (status='result_declared').
// Typically called by the Exam Controller right after
// generate-results, or by an admin to (re)start it.
router.post('/:id/start-freeze-workflow', requireRole('school_admin', 'principal', 'teacher'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const school_id = req.user!.school_id

        const { data: exam, error: examErr } = await supabase
            .from('exams').select('id, status').eq('id', id).eq('school_id', school_id).single()

        if (examErr || !exam) return res.status(404).json({ success: false, error: 'Exam not found' })

        if (!['result_declared'].includes(exam.status)) {
            return res.status(400).json({
                success: false,
                error: `Exam must have results generated first (status='result_declared'). Current status: '${exam.status}'.`,
            })
        }

        const result = await startWorkflow({
            schoolId: school_id,
            workflowName: 'Result Freeze & Publish Workflow',
            entityType: 'exam',
            entityId: id,
            initiatedBy: req.user!.id,
        })

        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error })
        }

        res.json({ success: true, data: result.instance })
    })
)

// ── POST /:id/workflow-action ─────────────────────────────────
// Body: { status: 'approved' | 'rejected' | 'commented', notes?: string }
// Advances the Result Freeze & Publish workflow. exams.status is kept
// in sync with each step:
//   step 1 (Exam Controller/freeze)  approved -> exams.status='result_frozen'
//   step 2 (Principal/verify)        approved -> exams.status='result_verified'
//   step 3 (Principal/publish)       approved -> exams.status='result_published'
//                                                  (report cards become visible)
//   any step rejected                          -> exams.status='result_declared'
//                                                  (sent back for correction)
router.post('/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { status, notes } = req.body
    const school_id = req.user!.school_id

    if (!['approved', 'rejected', 'commented'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status. Must be approved, rejected, or commented.' })
    }

    const { data: instance, error: instErr } = await supabase
        .from('workflow_instances')
        .select('id, status')
        .eq('entity_type', 'exam')
        .eq('entity_id', id)
        .eq('school_id', school_id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (instErr || !instance) {
        return res.status(404).json({ success: false, error: 'No workflow instance found for this exam. Use POST /:id/start-freeze-workflow first.' })
    }

    if (instance.status !== 'in_progress') {
        return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
    }

    // Look up the CURRENT step before acting, so we know which exams.status
    // to apply on approval (the step that's being approved, not the next one)
    const beforeStatus = await getWorkflowStatus('exam', id, school_id)
    const currentStepOrder = beforeStatus?.current_step?.step_order

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

    // Sync exams.status based on outcome.
    // Actual seeded step order is: step1=Exam Controller/verify,
    // step2=Principal/freeze, step3=Principal/publish (NOT
    // freeze->verify->publish as might be assumed from the names).
    if (status === 'rejected') {
        // Sent back for correction — revert to result_declared so the
        // exam controller can fix marks and restart the workflow.
        await supabase.from('exams').update({ status: 'result_declared' }).eq('id', id).eq('school_id', school_id)
    } else if (status === 'approved') {
        const STEP_STATUS_MAP: Record<number, string> = {
            1: 'result_verified',  // step 1: Exam Controller / verify
            2: 'result_frozen',    // step 2: Principal / freeze
            3: 'result_published', // step 3: Principal / publish
        }
        const newExamStatus = currentStepOrder ? STEP_STATUS_MAP[currentStepOrder] : undefined
        if (newExamStatus) {
            await supabase.from('exams').update({ status: newExamStatus }).eq('id', id).eq('school_id', school_id)
        }
    }

    res.json({
        success: true,
        data: { instance: result.instance, completed: result.completed, next_step: result.nextStep ?? null },
    })
}))

// ── GET /:id/workflow-status ──────────────────────────────────
router.get('/:id/workflow-status', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const status = await getWorkflowStatus('exam', id, school_id)

    if (!status) {
        return res.json({ success: true, data: null, message: 'No freeze/publish workflow started for this exam' })
    }

    res.json({ success: true, data: status })
}))

// ── RESULTS — gated by publish status for students/parents ────
//
// users.role is constrained to: super_admin, school_admin, principal,
// teacher, accountant, counselor, parent, student. 'parent' and
// 'student' are the only non-staff roles — everyone else (including
// accountant/counselor, who have no business here but aren't
// students/parents either) is treated as staff for this gate.
const NON_STAFF_ROLES = ['parent', 'student']

router.get('/:id/results', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    // Students/parents can only see results once published. Staff can
    // always see them (for review during the freeze/verify steps).
    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        const { data: exam } = await supabase.from('exams').select('status').eq('id', id).eq('school_id', school_id).single()
        if (!exam || exam.status !== 'result_published') {
            return res.json({ success: true, data: [], message: 'Results have not been published yet' })
        }
    }

    const { data, error } = await supabase
        .from('report_cards')
        .select('*, students(id, first_name, last_name, admission_number, roll_number, class_id, classes(name), sections(name))')
        .eq('exam_id', id)
        .eq('school_id', school_id)
        .order('rank')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
}))

router.get('/:id/results/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, student_id } = req.params
    const school_id = req.user!.school_id

    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        const { data: exam } = await supabase.from('exams').select('status').eq('id', id).eq('school_id', school_id).single()
        if (!exam || exam.status !== 'result_published') {
            return res.json({ success: true, data: { report_card: null, marks: [] }, message: 'Results have not been published yet' })
        }
    }

    const { data: reportCard } = await supabase.from('report_cards').select('*, students(first_name, last_name, admission_number, classes(name))').eq('exam_id', id).eq('student_id', student_id).single()
    const { data: marks } = await supabase.from('student_marks').select('*, exam_subjects(subject_name, max_marks, pass_marks, exam_date)').eq('exam_id', id).eq('student_id', student_id)
    res.json({ success: true, data: { report_card: reportCard, marks } })
}))

function computeGrade(obtained: number, max: number): string {
    if (!obtained || !max) return 'F'
    const pct = (obtained / max) * 100
    if (pct >= 90) return 'A+'
    if (pct >= 80) return 'A'
    if (pct >= 70) return 'B+'
    if (pct >= 60) return 'B'
    if (pct >= 50) return 'C'
    if (pct >= 33) return 'D'
    return 'F'
}

export default router