import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler, getPagination, NON_STAFF_ROLES, resolveOwnStudentId, fetchAllRows } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus, canActOnStep } from '../../shared/middleware/workflow-engine'
import { toLocalDateStr } from '../../shared/utils/academicCalendar'
import { createNotifications, getRecipientUserIdsForStudents } from '../../shared/utils/notifications'
import { runExamAutoStart } from '../../shared/utils/examAutoStart'
import { ensureResultFreezePublishWorkflowDefinition } from '../rbac/seed'
import resultSettingsRouter from './resultSettings.routes'
import resultGroupsRouter from './resultGroups.routes'
import termTemplatesRouter from './termTemplates.routes'
import {
  ExamType, EffectiveSubjectRule, LEGACY_SUBJECT_RULE,
  resolveEffectiveClassRule, resolveEffectiveSubjectRule, gradeForPercent, computeReportCard,
} from './services/resultComputation'
import { loadClassRules, loadSubjectOverrides, syncSubjectSplitOverride, fillSubjectMarksDefaults } from './services/resultRuleLoader'

const router = Router()
router.use(authenticate)
router.use('/result-settings', resultSettingsRouter)
router.use('/result-groups', resultGroupsRouter)
router.use('/term-templates', termTemplatesRouter)

const CreateExamSchema = z.object({
    name: z.string().min(1),
    exam_type: z.enum(['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']),
    academic_year_id: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    grading_system: z.enum(['marks', 'grades', 'cgpa']).default('marks'),
    default_time_slot_id: z.string().optional(),
})

// theory_max_marks/practical_max_marks either both given or both omitted
// (route-enforced below, not a DB CHECK) — when given, max_marks is always
// server-recomputed as their sum, never trusted from the client, so the
// combined total can't drift from its two components.
const CreateExamSubjectSchema = z.object({
    exam_id: z.string(),
    class_id: z.string(),
    subject_name: z.string().min(1),
    exam_date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    // Practical's own schedule, independent of Theory's exam_date/start_time/
    // end_time above — only meaningful when the subject is split, but not
    // enforced as such (a school may want to record it before deciding).
    practical_exam_date: z.string().optional(),
    practical_start_time: z.string().optional(),
    practical_end_time: z.string().optional(),
    max_marks: z.number().default(100),
    pass_marks: z.number().default(33),
    exam_hall: z.string().optional(),
    theory_max_marks: z.number().optional(),
    theory_pass_marks: z.number().optional(),
    practical_max_marks: z.number().optional(),
    practical_pass_marks: z.number().optional(),
})

const UpdateExamSubjectSchema = z.object({
    exam_date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    practical_exam_date: z.string().nullable().optional(),
    practical_start_time: z.string().nullable().optional(),
    practical_end_time: z.string().nullable().optional(),
    max_marks: z.number().optional(),
    pass_marks: z.number().optional(),
    exam_hall: z.string().optional(),
    theory_max_marks: z.number().nullable().optional(),
    theory_pass_marks: z.number().nullable().optional(),
    practical_max_marks: z.number().nullable().optional(),
    practical_pass_marks: z.number().nullable().optional(),
})

const CreateTimeSlotSchema = z.object({
    name: z.string().min(1),
    start_time: z.string().min(1),
    end_time: z.string().min(1),
})

const CreateTemplateSchema = z.object({
    name: z.string().min(1),
    exam_type: z.enum(['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']),
    grading_system: z.enum(['marks', 'grades', 'cgpa']).default('marks'),
    subjects: z.array(z.object({
        class_id: z.string(),
        subject_name: z.string().min(1),
        time_slot_id: z.string().optional(),
        max_marks: z.number().default(100),
        pass_marks: z.number().default(33),
        theory_max_marks: z.number().optional(),
        theory_pass_marks: z.number().optional(),
        practical_max_marks: z.number().optional(),
        practical_pass_marks: z.number().optional(),
    })).min(1),
})

const ApplyTemplateSchema = z.object({
    name: z.string().min(1),
    academic_year_id: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    subjects: z.array(z.object({
        template_subject_id: z.string(),
        exam_date: z.string().optional(),
        // Only meaningful when the template subject is split — the date its
        // Practical component falls on, independent of exam_date (Theory's).
        practical_exam_date: z.string().optional(),
    })).min(1),
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
    // "Results declared" spans every stage from the initial declaration
    // through the freeze/verify/publish workflow (see the status-flow
    // comment above the freeze-workflow routes below) — not just the
    // literal 'result_declared' value, and NOT 'completed' (an exam can
    // be completed with marks still unentered/unpublished).
    const [total, draft, ongoing, completed, resultsDeclared] = await Promise.all([
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'draft'),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'ongoing'),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'completed'),
        supabase.from('exams').select('*', { count: 'exact', head: true }).eq('school_id', school_id).in('status', ['result_declared', 'result_frozen', 'result_verified', 'result_published']),
    ])
    res.json({ success: true, data: {
        total: total.count ?? 0, draft: draft.count ?? 0, ongoing: ongoing.count ?? 0,
        completed: completed.count ?? 0, results_declared: resultsDeclared.count ?? 0,
    } })
}))

// GET /exams/upcoming — for the dashboard's Academic Snapshot widget.
// Separate from GET / (which paginates and orders by created_at, not
// start_date) since a dashboard widget needs "what's coming up", not
// "what was created recently".
//
// A `days` param still narrows to a rolling N-day window if a caller
// wants that. Without it, "upcoming" defaults to the rest of the
// CURRENT ACADEMIC YEAR (e.g. 1 Apr 2026 - 31 Mar 2027 for this school,
// whatever is_current actually spans) rather than a fixed 7 days — a
// school's exam calendar is planned a year at a time, so a widget that
// only looked 7 days ahead read as empty ("No exams") for most of the
// year even with a full datesheet already scheduled.
router.get('/upcoming', asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const today = toLocalDateStr(new Date())

    let endStr: string
    if (req.query.days) {
        const end = new Date()
        end.setDate(end.getDate() + Number(req.query.days))
        endStr = toLocalDateStr(end)
    } else {
        const { data: currentYear } = await supabase
            .from('academic_years').select('end_date')
            .eq('school_id', school_id).eq('is_current', true).maybeSingle()
        endStr = currentYear?.end_date ?? (() => {
            // No academic year configured — fall back to a year out
            // rather than erroring the whole widget.
            const end = new Date()
            end.setFullYear(end.getFullYear() + 1)
            return toLocalDateStr(end)
        })()
    }

    const { data, error } = await supabase
        .from('exams')
        .select('id, name, exam_type, start_date, end_date, status, academic_years(name)')
        .eq('school_id', school_id)
        .gte('start_date', today)
        .lte('start_date', endStr)
        .order('start_date', { ascending: true })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
}))

// GET /exams/needs-attention — dashboard widget: five categories of exam/
// term work waiting on the requester right now. Scoped to the CURRENT
// academic year only (same is_current lookup + graceful "no filter"
// fallback as /upcoming above) so counts stay a realistic per-year size
// instead of scanning the whole historical table.
const NEEDS_ATTENTION_ACTIVE_RESULT_STATUSES = ['result_declared', 'result_frozen', 'result_verified', 'result_published']

router.get('/needs-attention', asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id

    const { data: currentYear } = await supabase
        .from('academic_years').select('id')
        .eq('school_id', school_id).eq('is_current', true).maybeSingle()
    const academic_year_id = (currentYear as any)?.id ?? null
    const applyYear = (q: any) => academic_year_id ? q.eq('academic_year_id', academic_year_id) : q
    // result_groups.academic_year_id is optional and, in practice, often
    // left unset by the Terms UI — an exact .eq() would silently hide
    // every un-tagged Term forever, defeating the point of this category.
    // A Term explicitly tagged to a DIFFERENT year is still excluded;
    // only the "no year info at all" case is treated as "still current"
    // rather than "wrong year".
    const applyGroupYear = (q: any) => academic_year_id ? q.or(`academic_year_id.eq.${academic_year_id},academic_year_id.is.null`) : q

    const [ongoingRes, completedRes, workflowRes, draftGroupsRes, declaredGroupsRes] = await Promise.all([
        applyYear(supabase.from('exams').select('id, name').eq('school_id', school_id).eq('status', 'ongoing')),
        applyYear(supabase.from('exams').select('id, name').eq('school_id', school_id).eq('status', 'completed')),
        supabase.from('workflow_instances')
            .select('id, entity_id, current_step:current_step_id ( role_id, action_name )')
            .eq('school_id', school_id).eq('entity_type', 'exam').eq('status', 'in_progress'),
        applyGroupYear(supabase.from('result_groups').select('id, name').eq('school_id', school_id).eq('status', 'draft')),
        applyGroupYear(supabase.from('result_groups').select('id, name').eq('school_id', school_id).eq('status', 'result_declared')),
    ])
    for (const r of [ongoingRes, completedRes, workflowRes, draftGroupsRes, declaredGroupsRes]) {
        if ((r as any).error) return res.status(500).json({ success: false, error: (r as any).error.message })
    }

    const ongoingExams = (ongoingRes.data ?? []) as { id: string; name: string }[]
    const completedExams = (completedRes.data ?? []) as { id: string; name: string }[]
    const ongoingIds = ongoingExams.map(e => e.id)
    const completedIds = completedExams.map(e => e.id)

    const workflowInstances = (workflowRes.data ?? []) as { id: string; entity_id: string; current_step: { role_id: string; action_name: string } | null }[]
    const draftGroups = (draftGroupsRes.data ?? []) as { id: string; name: string }[]
    const declaredGroups = (declaredGroupsRes.data ?? []) as { id: string; name: string }[]
    const draftGroupIds = draftGroups.map(g => g.id)

    // These three blocks share no data with each other — each depends only
    // on the Promise.all above — so they run as one further Promise.all
    // rather than three sequential awaits (found via a live "socket
    // hang up"-style slowness report: sequential here was stacking every
    // block's round trip, including canActOnStep's own up-to-3-deep
    // internal chain, one after another instead of concurrently).
    const [marksAndResults, workflow, groups] = await Promise.all([
        (async () => {
            const [ongoingMarksRows, completedCardRows] = await Promise.all([
                ongoingIds.length
                    ? fetchAllRows<{ exam_id: string }>((from, to) =>
                        supabase.from('student_marks').select('exam_id', { count: 'exact' }).in('exam_id', ongoingIds).order('exam_id').range(from, to))
                    : Promise.resolve([]),
                completedIds.length
                    ? fetchAllRows<{ exam_id: string }>((from, to) =>
                        supabase.from('report_cards').select('exam_id', { count: 'exact' }).in('exam_id', completedIds).order('exam_id').range(from, to))
                    : Promise.resolve([]),
            ])
            const examsWithMarks = new Set(ongoingMarksRows.map(r => r.exam_id))
            const examsWithResults = new Set(completedCardRows.map(r => r.exam_id))
            return {
                marksNotStarted: ongoingExams.filter(e => !examsWithMarks.has(e.id)),
                resultsNotGenerated: completedExams.filter(e => !examsWithResults.has(e.id)),
            }
        })(),
        (async () => {
            // Exam lookup FIRST, role-permission checks second — narrows to
            // instances pointing at a real, current-year exam before paying
            // for any canActOnStep round trip (each up to 3 sequential
            // internal queries), rather than checking permissions for
            // instances that turn out to be stale/wrong-year and get
            // filtered out anyway. A live orphaned pair in this school's own
            // dev data (workflow_instances pointing at deleted exams) is
            // exactly the case this ordering now skips entirely.
            const entityIds = [...new Set(workflowInstances.map(wi => wi.entity_id))]
            const { data: workflowExamsRaw } = entityIds.length
                ? await applyYear(supabase.from('exams').select('id, name').eq('school_id', school_id).in('id', entityIds))
                : { data: [] as { id: string; name: string }[] }
            const workflowExamById = new Map((workflowExamsRaw ?? []).map((e: any) => [e.id, e.name]))
            const liveInstances = workflowInstances.filter(wi => workflowExamById.has(wi.entity_id))

            const roleIds = [...new Set(liveInstances.map(wi => wi.current_step?.role_id).filter((x): x is string => !!x))]
            const roleAllowance = await Promise.all(roleIds.map(async roleId => {
                const check = await canActOnStep({ schoolId: school_id, userId: req.user!.id, roleId })
                return [roleId, check.allowed] as const
            }))
            const allowedRoleIds = new Set(roleAllowance.filter(([, allowed]) => allowed).map(([roleId]) => roleId))
            return {
                workflowItems: liveInstances
                    .filter(wi => wi.current_step?.role_id && allowedRoleIds.has(wi.current_step.role_id))
                    .map(wi => ({ id: wi.entity_id, name: workflowExamById.get(wi.entity_id)!, action_name: wi.current_step!.action_name })),
            }
        })(),
        (async () => {
            const [groupExamsRes, groupSubjectsRes] = draftGroupIds.length
                ? await Promise.all([
                    supabase.from('result_group_exams').select('result_group_id, weight_percent, exams(status)').in('result_group_id', draftGroupIds),
                    supabase.from('result_group_subjects').select('result_group_id').in('result_group_id', draftGroupIds),
                ])
                : [{ data: [] as any[] }, { data: [] as any[] }]
            const membersByGroup = new Map<string, { weight_percent: number; exams: { status: string } | null }[]>()
            for (const m of (groupExamsRes.data ?? []) as any[]) {
                const arr = membersByGroup.get(m.result_group_id) ?? []
                arr.push(m)
                membersByGroup.set(m.result_group_id, arr)
            }
            const groupsWithSubjects = new Set(((groupSubjectsRes.data ?? []) as any[]).map(s => s.result_group_id))
            return {
                readyToGenerate: draftGroups.filter(g => {
                    const members = membersByGroup.get(g.id) ?? []
                    if (!members.length) return false
                    const totalWeight = members.reduce((s, m) => s + Number(m.weight_percent), 0)
                    if (Math.abs(totalWeight - 100) > 0.01) return false
                    if (members.some(m => !NEEDS_ATTENTION_ACTIVE_RESULT_STATUSES.includes(m.exams?.status ?? ''))) return false
                    if (!groupsWithSubjects.has(g.id)) return false
                    return true
                }),
            }
        })(),
    ])
    const { marksNotStarted, resultsNotGenerated } = marksAndResults
    const { workflowItems } = workflow
    const { readyToGenerate } = groups

    const cap = <T,>(arr: T[]) => arr.slice(0, 10)
    const items = [
        ...cap(marksNotStarted).map(e => ({
            type: 'marks_not_started', entity_type: 'exam' as const, id: e.id, name: e.name,
            message: 'Ongoing — no marks entered yet',
            href: `/exams/${e.id}?tab=Marks+Entry`,
        })),
        ...cap(resultsNotGenerated).map(e => ({
            type: 'results_not_generated', entity_type: 'exam' as const, id: e.id, name: e.name,
            message: 'Completed — results not generated yet',
            href: `/exams/${e.id}?tab=Results`,
        })),
        ...cap(workflowItems).map(w => ({
            type: 'workflow_waiting_on_you', entity_type: 'exam' as const, id: w.id, name: w.name,
            message: `Waiting on your ${w.action_name}`,
            href: `/exams/${w.id}?tab=Results`,
        })),
        ...cap(readyToGenerate).map(g => ({
            type: 'term_ready_to_generate', entity_type: 'term' as const, id: g.id, name: g.name,
            message: 'All member exams ready — results can be generated',
            href: `/exams/result-groups/${g.id}`,
        })),
        ...cap(declaredGroups).map(g => ({
            type: 'term_ready_to_publish', entity_type: 'term' as const, id: g.id, name: g.name,
            message: 'Results generated — ready to publish',
            href: `/exams/result-groups/${g.id}`,
        })),
    ]

    res.json({
        success: true,
        data: {
            items,
            counts: {
                marks_not_started: marksNotStarted.length,
                results_not_generated: resultsNotGenerated.length,
                workflow_waiting_on_you: workflowItems.length,
                term_ready_to_generate: readyToGenerate.length,
                term_ready_to_publish: declaredGroups.length,
            },
        },
    })
}))

router.get('/subjects/add', asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({ success: true, message: 'use POST' })
}))

router.post('/subjects/add', requirePermissionV2('exam.schedule'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateExamSubjectSchema.parse(req.body)
        const isSplit = body.theory_max_marks != null || body.practical_max_marks != null
        if (isSplit && (body.theory_max_marks == null || body.practical_max_marks == null)) {
            return res.status(400).json({ success: false, error: 'Theory and Practical max marks must both be set to split this subject.' })
        }
        const { data, error } = await supabase
            .from('exam_subjects')
            .insert({
                ...body,
                school_id: req.user!.school_id,
                start_time: body.start_time || null,
                end_time: body.end_time || null,
                exam_date: body.exam_date || null,
                practical_exam_date: body.practical_exam_date || null,
                practical_start_time: body.practical_start_time || null,
                practical_end_time: body.practical_end_time || null,
                // Never trust a client-sent combined total when split — it's
                // always the server-computed sum of the two components.
                max_marks: isSplit ? body.theory_max_marks! + body.practical_max_marks! : body.max_marks,
            })
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })

        // Auto-serve this datesheet's split state into Result Settings so
        // the Subject Overrides tab reflects reality without the admin
        // configuring the same fact twice. Marks defaults only ever fill a
        // still-empty field (fillSubjectMarksDefaults) — must run after the
        // split sync above so a freshly-created override row is found
        // rather than raced into a second insert.
        const { data: examRow } = await supabase.from('exams').select('exam_type').eq('id', body.exam_id).maybeSingle()
        if (examRow) {
            await syncSubjectSplitOverride(req.user!.school_id, body.class_id, examRow.exam_type, body.subject_name, isSplit)
            await fillSubjectMarksDefaults(req.user!.school_id, body.class_id, examRow.exam_type, body.subject_name, isSplit
                ? { theory_max_marks: body.theory_max_marks, theory_pass_marks: body.theory_pass_marks, practical_max_marks: body.practical_max_marks, practical_pass_marks: body.practical_pass_marks }
                : { max_marks: body.max_marks, pass_marks: body.pass_marks })
        }

        res.status(201).json({ success: true, data })
    })
)

// ── PATCH/DELETE /subjects/:id — exam_subjects rows could only ever be
// created before this (POST /subjects/add above); no way to correct a
// typo'd date/marks or remove a row short of touching the DB directly.
// Also what the "apply template" flow below leans on — a template just
// creates dateless rows, these are what let a date get filled in per
// row afterward.
router.patch('/subjects/:id', requirePermissionV2('exam.schedule'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = UpdateExamSubjectSchema.parse(req.body)
        const update: Record<string, any> = { ...body }
        // Both components sent as real numbers -> (re)split, max_marks is
        // always their server-computed sum, never a client-sent total.
        // Both sent as explicit null -> remove the split; max_marks then
        // comes from whatever plain max_marks the same request also sent
        // (the Edit modal always includes one when unchecking the split),
        // or is left untouched if it didn't.
        if (body.theory_max_marks != null && body.practical_max_marks != null) {
            update.max_marks = body.theory_max_marks + body.practical_max_marks
        } else if (body.theory_max_marks === null && body.practical_max_marks === null) {
            update.theory_pass_marks = null
            update.practical_max_marks = null
            update.practical_pass_marks = null
        }
        const { data, error } = await supabase
            .from('exam_subjects')
            .update(update)
            .eq('id', req.params.id)
            .eq('school_id', req.user!.school_id)
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        if (!data) return res.status(404).json({ success: false, error: 'Subject not found' })

        if (body.theory_max_marks !== undefined || body.practical_max_marks !== undefined || body.max_marks !== undefined || body.pass_marks !== undefined) {
            const isSplit = data.theory_max_marks != null && data.practical_max_marks != null
            const { data: examRow } = await supabase.from('exams').select('exam_type').eq('id', data.exam_id).maybeSingle()
            if (examRow) {
                if (body.theory_max_marks !== undefined || body.practical_max_marks !== undefined) {
                    await syncSubjectSplitOverride(req.user!.school_id, data.class_id, examRow.exam_type, data.subject_name, isSplit)
                }
                await fillSubjectMarksDefaults(req.user!.school_id, data.class_id, examRow.exam_type, data.subject_name, isSplit
                    ? { theory_max_marks: data.theory_max_marks, theory_pass_marks: data.theory_pass_marks, practical_max_marks: data.practical_max_marks, practical_pass_marks: data.practical_pass_marks }
                    : { max_marks: data.max_marks, pass_marks: data.pass_marks })
            }
        }

        res.json({ success: true, data })
    })
)

router.delete('/subjects/:id', requirePermissionV2('exam.schedule'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { error } = await supabase.from('exam_subjects').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true })
    })
)

// ── EXAM TIME SLOTS — school-wide reusable named windows (e.g. "Morning
// Session · 9:00-12:00"), picked by name instead of re-typing the same
// start/end time on every subject/every exam.
router.get('/time-slots', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
        .from('exam_time_slots').select('*').eq('school_id', req.user!.school_id).order('start_time')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
}))

router.post('/time-slots', requirePermissionV2('exam.schedule'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateTimeSlotSchema.parse(req.body)
        const { data, error } = await supabase
            .from('exam_time_slots').insert({ ...body, school_id: req.user!.school_id }).select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.status(201).json({ success: true, data })
    })
)

router.delete('/time-slots/:id', requirePermissionV2('exam.schedule'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { error } = await supabase.from('exam_time_slots').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true })
    })
)

// ── EXAM TEMPLATES — a reusable class+subject+time-slot blueprint for a
// recurring exam type (e.g. "Half Yearly Examination"). A school's exam
// calendar is structurally fixed year to year; only actual dates shift.
// POST /templates/:id/apply below is what turns a blueprint into a real
// exams row + its exam_subjects, in one call instead of one-at-a-time.
router.get('/templates', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
        .from('exam_templates')
        .select('*, exam_template_subjects(*, classes(name), exam_time_slots(name, start_time, end_time))')
        .eq('school_id', req.user!.school_id)
        .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
}))

router.post('/templates', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateTemplateSchema.parse(req.body)
        const school_id = req.user!.school_id

        const { data: template, error: templateErr } = await supabase
            .from('exam_templates')
            .insert({ name: body.name, exam_type: body.exam_type, grading_system: body.grading_system, school_id, created_by: req.user!.id })
            .select().single()
        if (templateErr) return res.status(400).json({ success: false, error: templateErr.message })

        const { error: subjectsErr } = await supabase
            .from('exam_template_subjects')
            .insert(body.subjects.map(s => ({ ...s, template_id: template.id })))
        if (subjectsErr) {
            // Roll back the orphaned template rather than leaving a
            // subject-less template behind that "New Template" would
            // otherwise never let you fix (no edit route — recreate-only,
            // matching certificate_templates' existing convention).
            await supabase.from('exam_templates').delete().eq('id', template.id)
            return res.status(400).json({ success: false, error: subjectsErr.message })
        }

        // A template only ever has one exam_type, so every subject in it
        // syncs against that same type — auto-serving the blueprint's split
        // structure into Result Settings as soon as it's authored, not just
        // once it's applied to a real exam.
        for (const s of body.subjects) {
            const isSplit = s.theory_max_marks != null && s.practical_max_marks != null
            await syncSubjectSplitOverride(school_id, s.class_id, body.exam_type, s.subject_name, isSplit)
            await fillSubjectMarksDefaults(school_id, s.class_id, body.exam_type, s.subject_name, isSplit
                ? { theory_max_marks: s.theory_max_marks, theory_pass_marks: s.theory_pass_marks, practical_max_marks: s.practical_max_marks, practical_pass_marks: s.practical_pass_marks }
                : { max_marks: s.max_marks, pass_marks: s.pass_marks })
        }

        res.status(201).json({ success: true, data: template })
    })
)

router.delete('/templates/:id', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { error } = await supabase.from('exam_templates').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true })
    })
)

router.post('/templates/:id/apply', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = ApplyTemplateSchema.parse(req.body)
        const school_id = req.user!.school_id

        const { data: templateSubjects, error: tsErr } = await supabase
            .from('exam_template_subjects')
            .select('*, exam_time_slots(start_time, end_time)')
            .eq('template_id', req.params.id)
        if (tsErr) return res.status(400).json({ success: false, error: tsErr.message })
        if (!templateSubjects?.length) return res.status(404).json({ success: false, error: 'Template not found or has no subjects' })

        const { data: template, error: templateErr } = await supabase
            .from('exam_templates').select('exam_type, grading_system').eq('id', req.params.id).eq('school_id', school_id).single()
        if (templateErr || !template) return res.status(404).json({ success: false, error: 'Template not found' })

        let academic_year_id = body.academic_year_id
        if (!academic_year_id) {
            const { data: currentYear } = await supabase.from('academic_years').select('id').eq('school_id', school_id).eq('is_current', true).maybeSingle()
            academic_year_id = currentYear?.id
        }

        const { data: exam, error: examErr } = await supabase
            .from('exams')
            .insert({
                school_id, created_by: req.user!.id, name: body.name,
                exam_type: template.exam_type, grading_system: template.grading_system,
                academic_year_id, start_date: body.start_date || null, end_date: body.end_date || null,
            })
            .select().single()
        if (examErr) return res.status(400).json({ success: false, error: examErr.message })

        const dateBySubjectId = new Map(body.subjects.map(s => [s.template_subject_id, s.exam_date]))
        const practicalDateBySubjectId = new Map(body.subjects.map(s => [s.template_subject_id, s.practical_exam_date]))
        const subjectRows = templateSubjects.map((ts: any) => {
            const isSplit = ts.theory_max_marks != null && ts.practical_max_marks != null
            return {
                exam_id: exam.id, school_id, class_id: ts.class_id, subject_name: ts.subject_name,
                // Never trust the template's own stored max_marks when
                // split — recomputed as the sum, same rule as
                // POST /subjects/add, so it can't drift from its components.
                max_marks: isSplit ? ts.theory_max_marks + ts.practical_max_marks : ts.max_marks,
                pass_marks: ts.pass_marks,
                theory_max_marks: ts.theory_max_marks,
                theory_pass_marks: ts.theory_pass_marks,
                practical_max_marks: ts.practical_max_marks,
                practical_pass_marks: ts.practical_pass_marks,
                exam_date: dateBySubjectId.get(ts.id) || null,
                start_time: ts.exam_time_slots?.start_time ?? null,
                end_time: ts.exam_time_slots?.end_time ?? null,
                practical_exam_date: practicalDateBySubjectId.get(ts.id) || null,
                practical_start_time: isSplit ? (ts.exam_time_slots?.start_time ?? null) : null,
                practical_end_time: isSplit ? (ts.exam_time_slots?.end_time ?? null) : null,
            }
        })
        const { error: insertErr } = await supabase.from('exam_subjects').insert(subjectRows)
        if (insertErr) {
            // Same reasoning as the template-creation rollback above — an
            // exam with zero datesheet rows is a dead end with no bulk
            // recovery, so don't leave one behind on a partial failure.
            await supabase.from('exams').delete().eq('id', exam.id)
            return res.status(400).json({ success: false, error: insertErr.message })
        }

        // Belt-and-braces has_practical sync — covers a template created
        // before this feature existed, or applied via a path (the Exam
        // Structure wizard) that never runs POST /templates' own
        // create-time sync. Batched, not a per-subject loop calling
        // syncSubjectSplitOverride/fillSubjectMarksDefaults: that was
        // exactly the O(subjects) cost that hung generate-structure the
        // first time it shipped (see that route's own comment) — a
        // 480-subject template applying here hit the identical wall.
        // Only has_practical is synced (not marks defaults): this route
        // is the ONE place in the split-sync family that's genuinely
        // redundant with something else keeping it current — the
        // resulting exam_subjects rows themselves already carry the
        // real split marks, and Result Settings' own defaults already
        // fed the template's own marks in the first place (via
        // generate-structure or manual entry) — so re-deriving and
        // writing marks defaults back here would mostly be an expensive
        // no-op, the same call this session already made once before.
        const classIds = [...new Set((templateSubjects as any[]).map((ts: any) => ts.class_id))]
        if (classIds.length) {
            let existingQuery = supabase.from('exam_subject_result_overrides')
                .select('id, class_id, subject_name, has_practical')
                .eq('school_id', school_id).in('class_id', classIds)
            existingQuery = template.exam_type ? existingQuery.eq('exam_type', template.exam_type) : existingQuery.is('exam_type', null)
            const { data: existingOverrides } = await existingQuery

            const existingByKey = new Map((existingOverrides ?? []).map((o: any) => [`${o.class_id}:${o.subject_name}`, o]))
            const toSetTrueIds: string[] = []
            const toSetFalseIds: string[] = []
            const toInsert: any[] = []

            for (const ts of templateSubjects as any[]) {
                const isSplit = ts.theory_max_marks != null && ts.practical_max_marks != null
                const existing = existingByKey.get(`${ts.class_id}:${ts.subject_name}`)
                if (existing) {
                    if (existing.has_practical !== isSplit) (isSplit ? toSetTrueIds : toSetFalseIds).push(existing.id)
                } else if (isSplit) {
                    // Same "no clutter for a false default with no row
                    // yet" rule syncSubjectSplitOverride already follows.
                    toInsert.push({ school_id, class_id: ts.class_id, exam_type: template.exam_type, subject_name: ts.subject_name, has_practical: true })
                }
            }

            const now = new Date().toISOString()
            if (toSetTrueIds.length) await supabase.from('exam_subject_result_overrides').update({ has_practical: true, updated_at: now }).in('id', toSetTrueIds)
            if (toSetFalseIds.length) await supabase.from('exam_subject_result_overrides').update({ has_practical: false, updated_at: now }).in('id', toSetFalseIds)
            if (toInsert.length) await supabase.from('exam_subject_result_overrides').insert(toInsert)
        }

        res.status(201).json({ success: true, data: exam })
    })
)

const GenerateStructureSchema = z.object({
    rows: z.array(z.object({
        label: z.string().min(1),
        exam_type: z.enum(['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other']),
        count: z.number().int().min(1).max(12),
        class_ids: z.array(z.string()).min(1),
    })).min(1),
})

// POST /templates/generate-structure — bootstraps a school's whole exam
// calendar in one submit: "Unit Tests: 2, Classes 1-12" / "Pre-Board: 2,
// Classes 10 & 12" becomes a real, numbered set of Exam Templates
// ("Unit Test 1", "Unit Test 2", ...), each with every selected class's
// subjects already pre-filled — pulled from that class's master subject
// list (same source GET /admission/subjects reads) and Result Settings'
// subject-override defaults (max/pass marks, has_practical + its own
// default split marks). Those defaults already fed a real datesheet's
// Add Subject form; this is the same data now also feeding template
// creation, so a template no longer starts from a blank subject list.
//
// Deliberately batched, not per-class/per-subject round trips: a school
// with 24 classes where most subjects apply school-wide (class_id IS
// NULL) turns "2 classes x 2 templates" naive looping into thousands of
// sequential Supabase calls — that's not a hypothetical, it's what
// actually hung this endpoint the first time it shipped. Subjects and
// overrides are fetched ONCE per row (covering every class in that row
// in one query each, not one query per class), the per-class subject
// list is computed in memory from that, and it's reused as-is across
// every one of the row's `count` template instances instead of being
// re-fetched per instance. This also intentionally does NOT write back
// into Result Settings (no syncSubjectSplitOverride/
// fillSubjectMarksDefaults here, unlike POST /templates and
// POST /subjects/add) — those calls are exactly what made the O(subjects)
// cost so expensive, and here they'd mostly be echoing back the very
// defaults this endpoint just read, not recording a new fact about a
// real exam the way those other two routes are.
router.post('/templates/generate-structure', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = GenerateStructureSchema.parse(req.body)
        const school_id = req.user!.school_id

        const createdTemplates: any[] = []
        let subjectsAdded = 0

        for (const row of body.rows) {
            const classIdList = row.class_ids.join(',')
            const [{ data: subjects }, { data: overrides }] = await Promise.all([
                supabase.from('subjects').select('name, class_id').eq('school_id', school_id).or(`class_id.in.(${classIdList}),class_id.is.null`),
                supabase.from('exam_subject_result_overrides').select('*').eq('school_id', school_id).in('class_id', row.class_ids).or(`exam_type.eq.${row.exam_type},exam_type.is.null`),
            ])

            // Computed once per row, shared across every one of its
            // `count` template instances (identical class_ids/exam_type
            // means an identical subject list every time).
            const subjectRowsByClass = new Map<string, any[]>()
            for (const class_id of row.class_ids) {
                const classSubjects = (subjects ?? []).filter((s: any) => s.class_id === class_id || s.class_id == null)
                const classOverrides = (overrides ?? []).filter((o: any) => o.class_id === class_id)
                const rows = classSubjects.map((subj: any) => {
                    // Exam-type-specific override first, else the class
                    // default — the exact same precedence AddSubjectModal
                    // already uses for the real datesheet.
                    const override =
                        classOverrides.find((o: any) => o.subject_name === subj.name && o.exam_type === row.exam_type) ??
                        classOverrides.find((o: any) => o.subject_name === subj.name && o.exam_type == null)

                    if (override?.has_practical) {
                        const theory_max_marks = override.default_theory_max_marks ?? 70
                        const theory_pass_marks = override.default_theory_pass_marks ?? 25
                        const practical_max_marks = override.default_practical_max_marks ?? 30
                        const practical_pass_marks = override.default_practical_pass_marks ?? 10
                        return {
                            class_id, subject_name: subj.name,
                            max_marks: theory_max_marks + practical_max_marks, pass_marks: theory_pass_marks + practical_pass_marks,
                            theory_max_marks, theory_pass_marks, practical_max_marks, practical_pass_marks,
                        }
                    }
                    return {
                        class_id, subject_name: subj.name,
                        max_marks: override?.default_max_marks ?? 100,
                        pass_marks: override?.default_pass_marks ?? 33,
                    }
                })
                subjectRowsByClass.set(class_id, rows)
            }

            for (let i = 1; i <= row.count; i++) {
                const name = row.count > 1 ? `${row.label} ${i}` : row.label

                const { data: template, error: templateErr } = await supabase
                    .from('exam_templates')
                    .insert({ name, exam_type: row.exam_type, grading_system: 'marks', school_id, created_by: req.user!.id })
                    .select().single()
                if (templateErr) {
                    // Roll back everything generated so far in this
                    // request — a partially-generated structure is more
                    // confusing to sort out by hand than none at all.
                    for (const t of createdTemplates) await supabase.from('exam_templates').delete().eq('id', t.id)
                    return res.status(400).json({ success: false, error: templateErr.message })
                }
                createdTemplates.push(template)

                const templateSubjectRows = row.class_ids.flatMap(class_id =>
                    (subjectRowsByClass.get(class_id) ?? []).map(r => ({ ...r, template_id: template.id })))

                if (templateSubjectRows.length) {
                    const { error: subjectsErr } = await supabase.from('exam_template_subjects').insert(templateSubjectRows)
                    if (subjectsErr) {
                        for (const t of createdTemplates) await supabase.from('exam_templates').delete().eq('id', t.id)
                        return res.status(400).json({ success: false, error: subjectsErr.message })
                    }
                    subjectsAdded += templateSubjectRows.length
                }
            }
        }

        res.status(201).json({ success: true, data: { templates: createdTemplates, subjects_added: subjectsAdded } })
    })
)

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { data, error } = await supabase
        .from('exams')
        .select('*, academic_years(name), exam_subjects(*, classes(name)), default_time_slot:default_time_slot_id(id, name, start_time, end_time)')
        .eq('id', id)
        .eq('school_id', req.user!.school_id)
        .single()
    if (error || !data) return res.status(404).json({ success: false, error: 'Exam not found' })

    // Which composite Terms (Result Groups) this exam is a member of, if
    // any — surfaced so the Results tab can steer staff toward publishing
    // the Term instead of this exam standalone, rather than leaving two
    // silently-conflicting "the result" numbers live for the same
    // subject/period. A pure lookup — membership never blocks anything.
    const { data: memberships } = await supabase
        .from('result_group_exams')
        .select('result_groups(id, name, status)')
        .eq('exam_id', id)
    ;(data as any).term_memberships = (memberships ?? []).map((m: any) => m.result_groups).filter(Boolean)

    res.json({ success: true, data })
}))

router.post('/', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const body = CreateExamSchema.parse(req.body)
        const school_id = req.user!.school_id

        // The frontend form has never sent this (dead code fetching
        // academic years and not using them) — every exam has been
        // created with a null academic year. Default to the current one
        // rather than leaving it unset.
        let academic_year_id = body.academic_year_id
        if (!academic_year_id) {
            const { data: currentYear } = await supabase.from('academic_years').select('id').eq('school_id', school_id).eq('is_current', true).maybeSingle()
            academic_year_id = currentYear?.id
        }

        const { data, error } = await supabase
            .from('exams')
            .insert({ ...body, academic_year_id, school_id, created_by: req.user!.id })
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.status(201).json({ success: true, data })
    })
)

// The early lifecycle (before results ever enter the picture) is a strict
// staircase: Datesheet gets built while Draft, the exam is Published, it
// Starts (Ongoing — the point marks entry opens up, see POST /:id/marks
// below), then Completed (the point Generate Results opens up, see
// POST /:id/generate-results). This route only ever moves an exam one
// step forward through that staircase — no skipping ("draft" straight to
// "completed") and no going backward. Everything past Completed
// (result_declared/frozen/verified/published) is written directly by
// generate-results and the freeze/publish workflow, never through here,
// so an exam already in one of those later stages can't be touched by
// this route either — fromIdx comes back -1 and gets rejected the same
// way an invalid target status would.
const EXAM_STATUS_SEQUENCE = ['draft', 'published', 'ongoing', 'completed']

router.patch('/:id/status', requirePermissionV2('exam.create'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const { status } = req.body

        const { data: current } = await supabase.from('exams').select('status, start_date').eq('id', id).eq('school_id', req.user!.school_id).maybeSingle()
        if (!current) return res.status(404).json({ success: false, error: 'Exam not found' })

        const fromIdx = EXAM_STATUS_SEQUENCE.indexOf(current.status)
        const toIdx = EXAM_STATUS_SEQUENCE.indexOf(status)
        if (fromIdx === -1 || toIdx !== fromIdx + 1) {
            return res.status(400).json({
                success: false,
                error: `Exams move through their stages in order — Draft → Published → Ongoing → Completed. Cannot move from '${current.status}' to '${status}'.`,
            })
        }

        // Publishing an exam whose start_date has already arrived jumps
        // straight to Ongoing — the daily auto-start sweep (examAutoStart.ts)
        // only runs once, just after midnight, so an exam published later
        // that same day (or published late, past its date) would otherwise
        // sit stuck as "Published" until the NEXT day's sweep even though
        // its date has clearly arrived.
        let effectiveStatus = status
        if (status === 'published' && current.start_date && current.start_date <= toLocalDateStr(new Date())) {
            effectiveStatus = 'ongoing'
        }

        const { data, error } = await supabase
            .from('exams')
            .update({ status: effectiveStatus })
            .eq('id', id)
            .eq('school_id', req.user!.school_id)
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true, data })
    })
)

// POST /exams/auto-start/run — manual trigger for the daily exam
// auto-start sweep (index.ts runs it unattended just after midnight).
// Same reasoning as HR's absconded/hr-alerts manual triggers: an
// in-process cron only runs while the process is up, so this is the
// safety net for a host that was down at 00:05, or for testing.
router.post('/auto-start/run', requirePermissionV2('exam.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await runExamAutoStart(req.user!.school_id)
    res.json({ success: true, data: result })
}))

// Response now also carries the resolved effective class rule + subject
// overrides for this class (scoped to the exam's own exam_type), so the
// Marks Entry screen knows up front whether to render theory/practical
// fields or a grade_only Select without a second round trip.
router.get('/:id/marks/:class_id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, class_id } = req.params
    const school_id = req.user!.school_id
    const [{ data: subjects }, { data: students }, { data: exam }] = await Promise.all([
        supabase.from('exam_subjects').select('*').eq('exam_id', id).eq('class_id', class_id).eq('school_id', school_id),
        supabase.from('students').select('id, first_name, last_name, roll_number, admission_number').eq('class_id', class_id).eq('school_id', school_id).eq('status', 'active').order('roll_number'),
        supabase.from('exams').select('exam_type').eq('id', id).eq('school_id', school_id).maybeSingle(),
    ])
    const { data: marks } = await supabase.from('student_marks').select('*').eq('exam_id', id).eq('school_id', school_id).in('student_id', (students ?? []).map(s => s.id))

    const examType = (exam?.exam_type ?? 'other') as ExamType
    const [classRules, subjectOverrides] = await Promise.all([
        loadClassRules(school_id, [class_id]),
        loadSubjectOverrides(school_id, [class_id]),
    ])
    const classRule = resolveEffectiveClassRule(classRules, class_id, examType)
    const subjectRules: Record<string, EffectiveSubjectRule> = {}
    for (const s of subjects ?? []) {
        subjectRules[s.subject_name] = resolveEffectiveSubjectRule(classRule, subjectOverrides, class_id, examType, s.subject_name)
    }

    res.json({ success: true, data: { subjects, students, marks, class_rule: classRule, subject_rules: subjectRules } })
}))

router.post('/:id/marks', requirePermissionV2('exam.marks_entry'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const { exam_subject_id, marks: marksData } = req.body
        const school_id = req.user!.school_id
        const { data: subject } = await supabase.from('exam_subjects').select('*').eq('id', exam_subject_id).single()
        if (!subject) return res.status(404).json({ success: false, error: 'Subject not found' })
        const { data: exam } = await supabase.from('exams').select('exam_type, status').eq('id', id).maybeSingle()
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' })
        // Numbers only start "fitting in" once the exam has actually
        // started — entering marks against a Draft/Published exam would
        // let results exist before the exam even ran.
        if (['draft', 'published'].includes(exam.status)) {
            return res.status(400).json({ success: false, error: `Marks can only be entered once the exam has started. Current status: '${exam.status}'.` })
        }
        const examType = (exam?.exam_type ?? 'other') as ExamType

        const [classRules, subjectOverrides] = await Promise.all([
            loadClassRules(school_id, [subject.class_id]),
            loadSubjectOverrides(school_id, [subject.class_id]),
        ])
        const classRule = resolveEffectiveClassRule(classRules, subject.class_id, examType)
        const subjectRule = resolveEffectiveSubjectRule(classRule, subjectOverrides, subject.class_id, examType, subject.subject_name)

        const isSplit = subject.theory_max_marks != null && subject.practical_max_marks != null

        const rows = marksData.map((m: any) => {
            let marks_obtained: number | null
            let is_absent: boolean
            let theory_marks_obtained: number | null = null
            let practical_marks_obtained: number | null = null
            let theory_is_absent = false
            let practical_is_absent = false

            if (isSplit) {
                theory_is_absent = m.theory_is_absent ?? false
                practical_is_absent = m.practical_is_absent ?? false
                theory_marks_obtained = theory_is_absent ? null : (m.theory_marks_obtained ?? null)
                practical_marks_obtained = practical_is_absent ? null : (m.practical_marks_obtained ?? null)
                is_absent = theory_is_absent && practical_is_absent
                marks_obtained = is_absent ? null : (Number(theory_marks_obtained ?? 0) + Number(practical_marks_obtained ?? 0))
            } else {
                is_absent = m.is_absent ?? false
                marks_obtained = is_absent ? null : m.marks_obtained
            }

            // grade_only: trust the manually-picked grade label as-is (the
            // Marks Entry UI only ever offers labels from the resolved
            // scale, so no further validation is needed here). Otherwise
            // derive it from marks — computeGrade() verbatim when no scale
            // is configured for this class/subject, exactly as before.
            const grade = subjectRule.grading_mode === 'grade_only'
                ? (m.grade ?? null)
                : gradeForPercent(marks_obtained ?? 0, subject.max_marks, subjectRule.grade_bands).grade

            return {
                school_id, exam_id: id, exam_subject_id,
                student_id: m.student_id,
                marks_obtained, is_absent,
                theory_marks_obtained, practical_marks_obtained, theory_is_absent, practical_is_absent,
                grade,
                entered_by: req.user!.id,
            }
        })
        const { data, error } = await supabase.from('student_marks').upsert(rows, { onConflict: 'exam_subject_id,student_id' }).select()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true, data, count: rows.length })
    })
)

const StudentSubjectOverrideSchema = z.object({
    result_status_override: z.string().min(1).nullable().optional(),
    grace_marks_applied: z.number().min(0).optional(),
    reason: z.string().min(1),
})

// PATCH /:id/marks/:student_id/:exam_subject_id/override — the one-off,
// per-student exception path: "Absent - Medical", "Result Withheld", or a
// specific grace-mark award for a borderline case. Deliberately separate
// from the bulk POST /:id/marks above (which is a whole-class sheet save)
// — this always touches exactly one student's one subject, always
// requires a reason, and always overwrites/clears whichever one field
// it's given (never both at once from the same call, so an override
// clear can't accidentally wipe a grace-mark award or vice versa).
// Gated the same as generate-results itself (exam.result_generate), not
// exam.marks_entry — this is a results-level exception, not day-to-day
// marks entry.
router.patch('/:id/marks/:student_id/:exam_subject_id/override', requirePermissionV2('exam.result_generate'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { student_id, exam_subject_id } = req.params
        const school_id = req.user!.school_id
        const body = StudentSubjectOverrideSchema.parse(req.body)

        const update: Record<string, any> = {}
        if (body.result_status_override !== undefined) update.result_status_override = body.result_status_override
        if (body.grace_marks_applied !== undefined) update.grace_marks_applied = body.grace_marks_applied
        if (!Object.keys(update).length) {
            return res.status(400).json({ success: false, error: 'Provide result_status_override or grace_marks_applied to set.' })
        }

        const { data: subject } = await supabase.from('exam_subjects').select('id, max_marks, pass_marks')
            .eq('id', exam_subject_id).eq('school_id', school_id).maybeSingle()
        if (!subject) return res.status(404).json({ success: false, error: 'Subject not found' })
        if (body.grace_marks_applied != null && body.grace_marks_applied > subject.max_marks) {
            return res.status(400).json({ success: false, error: 'Grace marks cannot exceed the subject\'s max marks.' })
        }

        const { data, error } = await supabase
            .from('student_marks')
            .upsert({ school_id, exam_id: req.params.id, exam_subject_id, student_id, ...update, entered_by: req.user!.id },
                { onConflict: 'exam_subject_id,student_id' })
            .select().single()
        if (error) return res.status(400).json({ success: false, error: error.message })
        res.json({ success: true, data })
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

router.post('/:id/generate-results', requirePermissionV2('exam.result_generate'),
    asyncHandler(async (req: AuthRequest, res: Response) => {
        const { id } = req.params
        const school_id = req.user!.school_id

        const [{ data: exam }, rawSubjects] = await Promise.all([
            supabase.from('exams').select('exam_type, status').eq('id', id).eq('school_id', school_id).maybeSingle(),
            // A large exam's own datesheet is unlikely to exceed 1000 rows,
            // but student_marks below routinely does (subjects x students)
            // — both go through fetchAllRows for the same reason: an
            // unbounded .select() silently truncates at Postgres/PostgREST's
            // default row cap, which used to mean generate-results quietly
            // skipped every student past the first ~1000 marks rows on a
            // big school's exam. Found while verifying this refactor.
            fetchAllRows<any>((from, to) =>
                supabase.from('exam_subjects').select('*', { count: 'exact' }).eq('exam_id', id).eq('school_id', school_id).order('id').range(from, to)),
        ])
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' })
        // The result flow only initiates once the exam itself is done —
        // generating results against a still-Ongoing exam would let a
        // report card exist before every mark is even in.
        if (exam.status !== 'completed') {
            return res.status(400).json({ success: false, error: `Results can only be generated once the exam is marked Completed. Current status: '${exam.status}'.` })
        }
        if (!rawSubjects?.length) return res.status(400).json({ success: false, error: 'No subjects found' })
        const examType = (exam?.exam_type ?? 'other') as ExamType

        const rawMarks = await fetchAllRows<any>((from, to) =>
            supabase.from('student_marks').select('*', { count: 'exact' }).eq('exam_id', id).eq('school_id', school_id).order('id').range(from, to))
        if (!rawMarks?.length) return res.status(400).json({ success: false, error: 'No marks uploaded yet' })

        // An exam that's also a Term member still gets its own full
        // report card computed here — reverted from an earlier attempt
        // at skipping this for Term members (kept only the marks-
        // finalization status flip), which turned out to make that
        // exam's own Freeze/Publish flow produce an empty, confusing
        // publish with nothing for anyone to see. TermMembershipWarning
        // (the Results tab banner) is the actual mechanism steering
        // staff toward the Term's blended result as the "official" one —
        // a soft nudge, not a hard block on this exam having its own
        // real, viewable result too.
        const studentIds = [...new Set(rawMarks.map(m => m.student_id))]
        const studentRows = await fetchAllRows<any>((from, to) =>
            supabase.from('students').select('id, class_id', { count: 'exact' }).eq('school_id', school_id).in('id', studentIds).order('id').range(from, to))
        const classIdByStudent = new Map((studentRows ?? []).map(s => [s.id, s.class_id as string]))

        // An exam's datesheet can span multiple classes at once (one
        // "Unit Test 4" covering Class 1 English and Class 2 Economics as
        // separate rows) — each student's total/obtained must only ever
        // be built from THEIR OWN class's subjects, never another class's,
        // so subjects are grouped per class here rather than treated as
        // one flat list shared by every student in the exam.
        const subjectsByClass = new Map<string, typeof rawSubjects>()
        for (const s of rawSubjects) {
            if (!subjectsByClass.has(s.class_id)) subjectsByClass.set(s.class_id, [])
            subjectsByClass.get(s.class_id)!.push(s)
        }
        const involvedClassIds = [...new Set([...subjectsByClass.keys(), ...classIdByStudent.values()])]

        const [classRules, subjectOverrides] = await Promise.all([
            loadClassRules(school_id, involvedClassIds),
            loadSubjectOverrides(school_id, involvedClassIds),
        ])

        const marksByStudent = new Map<string, typeof rawMarks>()
        for (const m of rawMarks) {
            if (!marksByStudent.has(m.student_id)) marksByStudent.set(m.student_id, [])
            marksByStudent.get(m.student_id)!.push(m)
        }

        const reportCards = Array.from(marksByStudent.entries()).map(([student_id, marks]) => {
            const classId = classIdByStudent.get(student_id)
            const subjectsForClass = (classId ? subjectsByClass.get(classId) : undefined) ?? []
            const classRule = resolveEffectiveClassRule(classRules, classId ?? '', examType)

            const examSubjectRows = subjectsForClass.map(s => ({
                id: s.id, subject_name: s.subject_name,
                max_marks: Number(s.max_marks), pass_marks: Number(s.pass_marks),
                theory_max_marks: s.theory_max_marks == null ? null : Number(s.theory_max_marks),
                theory_pass_marks: s.theory_pass_marks == null ? null : Number(s.theory_pass_marks),
                practical_max_marks: s.practical_max_marks == null ? null : Number(s.practical_max_marks),
                practical_pass_marks: s.practical_pass_marks == null ? null : Number(s.practical_pass_marks),
            }))
            const marksBySubjectId = new Map(marks.map(m => [m.exam_subject_id, {
                marks_obtained: m.marks_obtained == null ? null : Number(m.marks_obtained),
                is_absent: m.is_absent,
                theory_marks_obtained: m.theory_marks_obtained == null ? null : Number(m.theory_marks_obtained),
                practical_marks_obtained: m.practical_marks_obtained == null ? null : Number(m.practical_marks_obtained),
                theory_is_absent: m.theory_is_absent,
                practical_is_absent: m.practical_is_absent,
                grade: m.grade,
                grace_marks_applied: Number(m.grace_marks_applied ?? 0),
                result_status_override: m.result_status_override,
            }]))

            const result = computeReportCard({
                subjects: examSubjectRows,
                marksBySubjectId,
                classRule,
                resolveSubjectRule: subjectName =>
                    classId
                        ? resolveEffectiveSubjectRule(classRule, subjectOverrides, classId, examType, subjectName)
                        : LEGACY_SUBJECT_RULE,
            })

            return {
                school_id, exam_id: id, student_id,
                total_marks: result.total_marks, obtained_marks: result.obtained_marks, percentage: result.percentage,
                grade: result.grade, overall_cgpa: result.overall_cgpa,
                is_pass: result.is_pass, result_status: result.result_status,
                grace_marks_applied_total: result.grace_marks_applied_total,
                remarks: result.remarks, remarks_source: result.remarks_source,
            }
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
// Narrowed from the old requireRole('school_admin','principal','teacher')
// to exam.freeze — that let ANY teacher (not just Exam Controller/admin)
// start the result-freeze workflow, which this route's own comment
// already describes as Exam Controller/admin territory. Exam Controller
// holds exam.freeze by default; a plain Teacher no longer does.
router.post('/:id/start-freeze-workflow', requirePermissionV2('exam.freeze'),
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

        await ensureResultFreezePublishWorkflowDefinition(school_id)
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
// in sync by POSITION within this workflow's own (possibly
// school-customized) step list, not by a fixed step count or literal
// action-name — see resultSettings.routes.ts's PUT /workflow, which lets
// a school reconfigure this to any number of steps with any of their own
// roles:
//   first step   approved -> exams.status='result_frozen'
//   last step    approved -> exams.status='result_published'
//                              (report cards become visible; for a 1-step
//                              workflow this is the same step as "first",
//                              and publish wins outright)
//   any step in between (3+ step workflows only) approved
//                -> exams.status='result_verified'
//   any step     rejected -> exams.status='result_declared'
//                              (sent back for correction)
// This drives the actual freeze/verify/publish decisions and, until now,
// had NO gate at all — any authenticated user (including a student or
// parent) could call it. Previously "fixed" with a manual step-aware
// permission check (currentStepOrder === 3 ? exam.result_publish :
// exam.freeze) run BEFORE actOnWorkflow — but actOnWorkflow already
// does the real per-step check via workflow_steps.role_id, so that was
// two independent, driftable sources of truth for the same decision,
// and the hardcoded step-number mapping would silently break if this
// workflow's steps were ever reconfigured. Consolidated to the same
// NON_STAFF_ROLES-only exclusion already used by sis.ts's TC
// workflow-action and admission.ts's approval routes: exclude only
// students/parents here, and let actOnWorkflow's internal actor check
// be the single source of truth for which staff role can act on which
// step.
router.post('/:id/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        return res.status(403).json({ success: false, error: 'Only staff can act on this workflow' })
    }
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
    // to apply on approval (the step that's being approved, not the next
    // one) — position within this workflow's own step list, not a fixed
    // count. actOnWorkflow itself is the sole authority on whether this
    // actor may act on it.
    const beforeStatus = await getWorkflowStatus('exam', id, school_id)
    const currentStepOrder = beforeStatus?.current_step?.step_order
    const allStepOrders = (beforeStatus?.all_steps ?? []).map((s: any) => s.step_order)
    const lastStepOrder = allStepOrders.length ? Math.max(...allStepOrders) : undefined

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

    // Sync exams.status based on outcome. Keyed off this step's POSITION
    // (first / last / in-between) rather than a literal action-name map,
    // so a school-customized workflow (any step count, any role, any
    // label) stays correctly in sync — see the route header comment.
    if (status === 'rejected') {
        // Sent back for correction — revert to result_declared so the
        // exam controller can fix marks and restart the workflow.
        await supabase.from('exams').update({ status: 'result_declared' }).eq('id', id).eq('school_id', school_id)
    } else if (status === 'approved') {
        let newExamStatus: string | undefined
        if (currentStepOrder != null && lastStepOrder != null) {
            if (currentStepOrder === lastStepOrder) newExamStatus = 'result_published'
            else if (currentStepOrder === 1) newExamStatus = 'result_frozen'
            else newExamStatus = 'result_verified'
        }
        if (newExamStatus) {
            await supabase.from('exams').update({ status: newExamStatus }).eq('id', id).eq('school_id', school_id)

            if (newExamStatus === 'result_published') {
                try {
                    const [{ data: exam }, { data: marks }] = await Promise.all([
                        supabase.from('exams').select('name').eq('id', id).single(),
                        supabase.from('student_marks').select('student_id').eq('exam_id', id).eq('school_id', school_id),
                    ])
                    const studentIds = [...new Set((marks ?? []).map(m => m.student_id))]
                    const recipients = await getRecipientUserIdsForStudents(studentIds)
                    await createNotifications(recipients, {
                        schoolId: school_id, type: 'exam_result_published',
                        title: 'Exam results published',
                        message: `Results for "${exam?.name ?? 'the exam'}" are now available.`,
                        link: '/exams',
                        relatedEntityType: 'exam', relatedEntityId: id,
                    })
                } catch (notifyErr) {
                    console.error('Failed to create exam result notifications:', notifyErr)
                }
            }
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

    // Whether the requesting user can act on the CURRENT step right now —
    // computed server-side via the same role/School-Admin/delegate check
    // actOnWorkflow itself enforces, so the frontend never has to guess
    // which of a school's own (possibly custom) roles is authorized.
    let can_act = false
    const currentStep = (status as any).current_step
    if ((status as any).status === 'in_progress' && currentStep?.role_id) {
        const check = await canActOnStep({ schoolId: school_id, userId: req.user!.id, roleId: currentStep.role_id })
        can_act = check.allowed
    }

    res.json({ success: true, data: { ...status, can_act } })
}))

// ── RESULTS — gated by publish status for students/parents ────
//
// users.role is constrained to: super_admin, school_admin, principal,
// teacher, accountant, counselor, parent, student. 'parent' and
// 'student' are the only non-staff roles — everyone else (including
// accountant/counselor, who have no business here but aren't
// students/parents either) is treated as staff for this gate.

router.get('/:id/results', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { class_id, section_id } = req.query
    const school_id = req.user!.school_id

    // Students/parents can only see results once published. Staff can
    // always see them (for review during the freeze/verify steps).
    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        const { data: exam } = await supabase.from('exams').select('status').eq('id', id).eq('school_id', school_id).single()
        if (!exam || exam.status !== 'result_published') {
            return res.json({ success: true, data: [], message: 'Results have not been published yet' })
        }
    }

    // report_cards has no class_id/section_id of its own — only reachable
    // via students, so filtering by either requires !inner (a plain left
    // embed doesn't restrict the parent rows, it just returns null for
    // students that don't match).
    let query = supabase
        .from('report_cards')
        .select('*, students!inner(id, first_name, last_name, admission_number, roll_number, class_id, section_id, classes(name, numeric_level), sections(name))')
        .eq('exam_id', id)
        .eq('school_id', school_id)
    if (class_id) query = query.eq('students.class_id', class_id as string)
    if (section_id) query = query.eq('students.section_id', section_id as string)

    const { data, error } = await query.order('rank')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
}))

// ── GET /:id/scoresheet — class-wise subject-by-subject raw marks ─
// An exam that's a Term member doesn't get a meaningful percentage/
// pass-fail of its own on this screen (the Term's blended result is
// the "official" one — see TermMembershipWarning on the frontend), so
// instead of report_cards' aggregate the Results tab renders this as a
// student x subject grid: every active student in the exam's classes,
// every subject, raw marks — "NA" where nothing's been entered yet,
// "Absent" where the student was actually marked absent. Gated
// identically to /:id/results.
router.get('/:id/scoresheet', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        const { data: exam } = await supabase.from('exams').select('status').eq('id', id).eq('school_id', school_id).single()
        if (!exam || exam.status !== 'result_published') {
            return res.json({ success: true, data: { subjects: [], students: [], marks: [] }, message: 'Results have not been published yet' })
        }
    }

    const rawSubjects = await fetchAllRows<any>((from, to) =>
        supabase.from('exam_subjects')
            .select('id, class_id, subject_name, max_marks, pass_marks, theory_max_marks, practical_max_marks', { count: 'exact' })
            .eq('exam_id', id).eq('school_id', school_id).order('subject_name').range(from, to))
    if (!rawSubjects?.length) return res.json({ success: true, data: { subjects: [], students: [], marks: [] } })

    const classIds = [...new Set(rawSubjects.map(s => s.class_id))]
    const [studentRows, markRows] = await Promise.all([
        fetchAllRows<any>((from, to) =>
            supabase.from('students')
                .select('id, first_name, last_name, roll_number, admission_number, class_id, section_id, classes(name, numeric_level), sections(name)', { count: 'exact' })
                .in('class_id', classIds).eq('school_id', school_id).eq('status', 'active').order('roll_number').range(from, to)),
        fetchAllRows<any>((from, to) =>
            supabase.from('student_marks')
                .select('student_id, exam_subject_id, marks_obtained, is_absent, theory_marks_obtained, practical_marks_obtained, theory_is_absent, practical_is_absent, grade', { count: 'exact' })
                .eq('exam_id', id).eq('school_id', school_id).range(from, to)),
    ])

    res.json({ success: true, data: { subjects: rawSubjects, students: studentRows, marks: markRows } })
}))

router.get('/:id/results/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    let { student_id } = req.params
    const school_id = req.user!.school_id

    if (NON_STAFF_ROLES.includes(req.user!.role)) {
        const { data: exam } = await supabase.from('exams').select('status').eq('id', id).eq('school_id', school_id).single()
        if (!exam || exam.status !== 'result_published') {
            return res.json({ success: true, data: { report_card: null, marks: [] }, message: 'Results have not been published yet' })
        }
        // A student/parent hitting this with someone else's student_id in
        // the URL must still only ever see their own child's/own marks —
        // ignore whatever was requested and substitute their real one.
        const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
        if (!ownStudentId) return res.json({ success: true, data: { report_card: null, marks: [] } })
        student_id = ownStudentId
    }

    const { data: reportCard } = await supabase.from('report_cards').select('*, students(first_name, last_name, admission_number, classes(name))').eq('exam_id', id).eq('student_id', student_id).single()
    const { data: marks } = await supabase.from('student_marks').select('*, exam_subjects(subject_name, max_marks, pass_marks, exam_date)').eq('exam_id', id).eq('student_id', student_id)
    res.json({ success: true, data: { report_card: reportCard, marks } })
}))

export default router