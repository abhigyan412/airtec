import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler, NON_STAFF_ROLES, resolveOwnStudentId, fetchAllRows } from '../../shared/utils/helpers'
import { createNotifications, getRecipientUserIdsForStudents } from '../../shared/utils/notifications'
import { resolveEffectiveClassRule, resolveEffectiveSubjectRule, computeReportCard } from './services/resultComputation'
import { loadClassRules, loadSubjectOverrides } from './services/resultRuleLoader'

// Mounted at /exams/result-groups inside exam/routes.ts — inherits that
// router's router.use(authenticate).
//
// Composite "Term" results — a weighted blend of several exams (e.g. UT1
// 20% + UT2 20% + Half Yearly 60%) into one result, alongside each member
// exam's own standalone result, untouched. A group is always scoped to one
// class and always resolves the class's DEFAULT rule (never a
// type-specific override — a Term isn't any one of the 7 exam_type
// values), via resolveEffectiveClassRule(..., null).
const router = Router()

const ACTIVE_RESULT_STATUSES = ['result_declared', 'result_frozen', 'result_verified', 'result_published']

router.get('/', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, academic_year_id } = req.query
  let query = supabase.from('result_groups').select('*, classes(name), academic_years(name)').eq('school_id', school_id)
  if (class_id) query = query.eq('class_id', class_id as string)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id as string)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

const CreateGroupSchema = z.object({ name: z.string().min(1), class_id: z.string(), academic_year_id: z.string().optional() })

router.post('/', requirePermissionV2('exam.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateGroupSchema.parse(req.body)
  const { data, error } = await supabase
    .from('result_groups')
    .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.get('/:id', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: group } = await supabase.from('result_groups').select('*, classes(name)').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })
  const [{ data: members }, { data: subjects }] = await Promise.all([
    supabase.from('result_group_exams').select('*, exams(name, exam_type, status)').eq('result_group_id', req.params.id),
    supabase.from('result_group_subjects').select('*').eq('result_group_id', req.params.id).order('subject_name'),
  ])
  res.json({ success: true, data: { ...group, members: members ?? [], subjects: subjects ?? [] } })
}))

router.patch('/:id', requirePermissionV2('exam.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ name: z.string().min(1).optional() }).parse(req.body)
  const { data, error } = await supabase.from('result_groups').update(body).eq('id', req.params.id).eq('school_id', req.user!.school_id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Result group not found' })
  res.json({ success: true, data })
}))

router.delete('/:id', requirePermissionV2('exam.create'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('result_groups').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── Member exams ────────────────────────────────────────────────

const AddMemberSchema = z.object({ exam_id: z.string(), weight_percent: z.number().gt(0).lte(100) })

router.post('/:id/exams', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = AddMemberSchema.parse(req.body)
  const { data, error } = await supabase.from('result_group_exams').insert({ result_group_id: req.params.id, ...body }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.patch('/:id/exams/:member_id', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ weight_percent: z.number().gt(0).lte(100) }).parse(req.body)
  const { data, error } = await supabase.from('result_group_exams').update(body).eq('id', req.params.member_id).eq('result_group_id', req.params.id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Member exam not found' })
  res.json({ success: true, data })
}))

router.delete('/:id/exams/:member_id', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('result_group_exams').delete().eq('id', req.params.member_id).eq('result_group_id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── Subjects — synced from member exams, then editable ────────────

// Unions member exams' exam_subjects (scoped to the group's own class_id
// — a member exam can span multiple classes, only this group's class's
// rows are relevant), inserting whatever subject names aren't already in
// the group's curated list. Never removes or overwrites an existing row
// — re-running is safe, it only ever adds. Exported so
// termTemplates.routes.ts's apply endpoint can run the exact same sync a
// manual "Sync Subjects" click would, instead of a second copy of this
// logic drifting out of step with it.
export async function syncGroupSubjectsFromMembers(resultGroupId: string, classId: string): Promise<{ added: number }> {
  const { data: members } = await supabase.from('result_group_exams').select('exam_id').eq('result_group_id', resultGroupId)
  const examIds = (members ?? []).map(m => m.exam_id)
  if (!examIds.length) return { added: 0 }

  const [{ data: examSubjects }, { data: existing }] = await Promise.all([
    supabase.from('exam_subjects').select('subject_name, max_marks, pass_marks, theory_max_marks, theory_pass_marks, practical_max_marks, practical_pass_marks').eq('class_id', classId).in('exam_id', examIds),
    supabase.from('result_group_subjects').select('subject_name').eq('result_group_id', resultGroupId),
  ])
  const existingNames = new Set((existing ?? []).map(s => s.subject_name))
  // Prefer a split representative over a plain one for the same subject
  // name — some member exams may not split a subject that others do (e.g.
  // a Unit Test recording one combined mark for Science while Half Yearly
  // splits it Theory+Practical); the split row carries strictly more
  // information, so it wins regardless of which was encountered first.
  const uniqueByName = new Map<string, any>()
  for (const s of examSubjects ?? []) {
    const current = uniqueByName.get(s.subject_name)
    const isSplit = s.theory_max_marks != null && s.practical_max_marks != null
    if (!current || (isSplit && !(current.theory_max_marks != null && current.practical_max_marks != null))) {
      uniqueByName.set(s.subject_name, s)
    }
  }
  const toInsert = Array.from(uniqueByName.values())
    .filter(s => !existingNames.has(s.subject_name))
    .map(s => {
      const isSplit = s.theory_max_marks != null && s.practical_max_marks != null
      return {
        result_group_id: resultGroupId, subject_name: s.subject_name,
        max_marks: isSplit ? s.theory_max_marks + s.practical_max_marks : s.max_marks,
        pass_marks: s.pass_marks,
        theory_max_marks: s.theory_max_marks, theory_pass_marks: s.theory_pass_marks,
        practical_max_marks: s.practical_max_marks, practical_pass_marks: s.practical_pass_marks,
      }
    })

  if (toInsert.length) {
    const { error } = await supabase.from('result_group_subjects').insert(toInsert)
    if (error) throw new Error(error.message)
  }
  return { added: toInsert.length }
}

// ── Component Exam Release — a lighter release point for one MEMBER
// exam of a Term, separate from the Term's own official publish ────
//
// A real school almost always reports the composite Term as the official
// result, so a member exam (a Unit Test feeding a Half Yearly, say)
// essentially never runs its own full Freeze->Verify->Publish chain — but
// its own marks are real and final well before the Term's blended result
// exists. This resolves whether a school configured a REAL multi-step
// workflow for that exam's release (attached per Term Template, entity_
// type='exam_component' so its workflow_instances never collide with the
// original 'exam'-typed Freeze/Verify/Publish ones — see the migration
// comment) or should fall back to a single Freeze action.
//
// An exam can in principle belong to more than one Term; the first
// membership whose template has a configured workflow wins. Exported for
// exam/routes.ts's generate-results / start-component-workflow /
// component-freeze to share the same resolution logic.
export async function resolveComponentRelease(examId: string, schoolId: string): Promise<{ isTermMember: boolean; workflowId: string | null }> {
  const { data: memberships } = await supabase
    .from('result_group_exams')
    .select('result_groups(term_template_id)')
    .eq('exam_id', examId)
  if (!memberships?.length) return { isTermMember: false, workflowId: null }

  for (const m of memberships as any[]) {
    const templateId = m.result_groups?.term_template_id
    if (!templateId) continue
    const { data: template } = await supabase
      .from('term_templates').select('component_workflow_id').eq('id', templateId).eq('school_id', schoolId).maybeSingle()
    if (template?.component_workflow_id) return { isTermMember: true, workflowId: template.component_workflow_id }
  }
  return { isTermMember: true, workflowId: null }
}

router.post('/:id/subjects/sync', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: group } = await supabase.from('result_groups').select('class_id').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })

  const { data: members } = await supabase.from('result_group_exams').select('exam_id').eq('result_group_id', req.params.id)
  if (!(members ?? []).length) return res.status(400).json({ success: false, error: 'Add at least one member exam first.' })

  let added: number
  try {
    ({ added } = await syncGroupSubjectsFromMembers(req.params.id, group.class_id))
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message })
  }
  const { data } = await supabase.from('result_group_subjects').select('*').eq('result_group_id', req.params.id).order('subject_name')
  res.json({ success: true, data, added })
}))

router.delete('/:id/subjects/:subject_id', requirePermissionV2('exam.schedule'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('result_group_subjects').delete().eq('id', req.params.subject_id).eq('result_group_id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── Generate results ────────────────────────────────────────────

router.post('/:id/generate-results', requirePermissionV2('exam.result_generate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: group } = await supabase.from('result_groups').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })

  const { data: members } = await supabase.from('result_group_exams').select('*, exams(status)').eq('result_group_id', req.params.id)
  if (!members?.length) return res.status(400).json({ success: false, error: 'Add at least one member exam first.' })

  const totalWeight = members.reduce((s, m) => s + Number(m.weight_percent), 0)
  if (Math.abs(totalWeight - 100) > 0.01) {
    return res.status(400).json({ success: false, error: `Member exam weights must sum to 100% (currently ${totalWeight}%).` })
  }
  const notDeclared = members.filter((m: any) => !ACTIVE_RESULT_STATUSES.includes(m.exams?.status))
  if (notDeclared.length) {
    return res.status(400).json({ success: false, error: 'Every member exam must have its own results generated first (Generate Results on that exam).' })
  }

  const { data: groupSubjects } = await supabase.from('result_group_subjects').select('*').eq('result_group_id', req.params.id)
  if (!groupSubjects?.length) return res.status(400).json({ success: false, error: 'No subjects set up — sync subjects from the member exams first.' })

  const examIds = members.map((m: any) => m.exam_id)
  // Unbounded .select() calls silently truncate at Postgres/PostgREST's
  // default row cap (found the same bug in the single-exam
  // generate-results while verifying this feature — student_marks in
  // particular routinely exceeds it for a real school). All three of
  // these can plausibly exceed 1000 rows, so all three go through
  // fetchAllRows.
  const [allExamSubjects, allMarks, students] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      supabase.from('exam_subjects').select('id, exam_id, subject_name, max_marks, theory_max_marks, practical_max_marks', { count: 'exact' }).in('exam_id', examIds).eq('class_id', group.class_id).order('id').range(from, to)),
    fetchAllRows<any>((from, to) =>
      supabase.from('student_marks').select('exam_subject_id, student_id, marks_obtained, theory_marks_obtained, practical_marks_obtained, is_absent, theory_is_absent, practical_is_absent', { count: 'exact' }).in('exam_id', examIds).order('id').range(from, to)),
    fetchAllRows<any>((from, to) =>
      supabase.from('students').select('id', { count: 'exact' }).eq('school_id', school_id).eq('class_id', group.class_id).eq('status', 'active').order('id').range(from, to)),
  ])
  if (!students.length) return res.status(400).json({ success: false, error: 'No active students in this class.' })

  const subjectByExamAndName = new Map<string, { id: string; max_marks: number; theory_max_marks: number | null; practical_max_marks: number | null }>()
  for (const s of allExamSubjects) subjectByExamAndName.set(`${s.exam_id}:${s.subject_name}`, {
    id: s.id, max_marks: Number(s.max_marks),
    theory_max_marks: s.theory_max_marks == null ? null : Number(s.theory_max_marks),
    practical_max_marks: s.practical_max_marks == null ? null : Number(s.practical_max_marks),
  })
  const markByExamSubjectAndStudent = new Map<string, { marks_obtained: number | null; theory_marks_obtained: number | null; practical_marks_obtained: number | null; is_absent: boolean; theory_is_absent: boolean; practical_is_absent: boolean }>()
  for (const m of allMarks) markByExamSubjectAndStudent.set(`${m.exam_subject_id}:${m.student_id}`, {
    marks_obtained: m.marks_obtained == null ? null : Number(m.marks_obtained),
    theory_marks_obtained: m.theory_marks_obtained == null ? null : Number(m.theory_marks_obtained),
    practical_marks_obtained: m.practical_marks_obtained == null ? null : Number(m.practical_marks_obtained),
    is_absent: !!m.is_absent, theory_is_absent: !!m.theory_is_absent, practical_is_absent: !!m.practical_is_absent,
  })
  const weightByExam = new Map(members.map((m: any) => [m.exam_id, Number(m.weight_percent)]))

  const classRules = await loadClassRules(school_id, [group.class_id])
  const subjectOverrides = await loadSubjectOverrides(school_id, [group.class_id])
  // null exam_type: a composite Term always uses the class default rule,
  // never a type-specific override (see module comment above).
  const classRule = resolveEffectiveClassRule(classRules, group.class_id, null)

  const subjectMarkRows: any[] = []
  const groupCards: any[] = []

  for (const student of students) {
    const examSubjectRowsForRule = groupSubjects.map(gs => ({
      id: gs.id, subject_name: gs.subject_name, max_marks: Number(gs.max_marks), pass_marks: Number(gs.pass_marks),
      theory_max_marks: gs.theory_max_marks == null ? null : Number(gs.theory_max_marks),
      theory_pass_marks: gs.theory_pass_marks == null ? null : Number(gs.theory_pass_marks),
      practical_max_marks: gs.practical_max_marks == null ? null : Number(gs.practical_max_marks),
      practical_pass_marks: gs.practical_pass_marks == null ? null : Number(gs.practical_pass_marks),
    }))
    const marksBySubjectIdForRule = new Map<string, any>()

    for (const gs of groupSubjects) {
      const gsIsSplit = gs.theory_max_marks != null && gs.practical_max_marks != null

      if (!gsIsSplit) {
        let weightedSum = 0, weightTotal = 0, contributing = 0
        for (const examId of examIds) {
          const es = subjectByExamAndName.get(`${examId}:${gs.subject_name}`)
          if (!es) continue
          const mk = markByExamSubjectAndStudent.get(`${es.id}:${student.id}`)
          if (!mk) continue
          const obtained = mk.is_absent ? null : mk.marks_obtained
          if (obtained == null) continue
          const pct = es.max_marks > 0 ? (obtained / es.max_marks) * 100 : 0
          const w = weightByExam.get(examId) ?? 0
          weightedSum += pct * w
          weightTotal += w
          contributing++
        }
        const weighted_percent = weightTotal > 0 ? weightedSum / weightTotal : null
        const marks_obtained = weighted_percent != null ? (weighted_percent / 100) * Number(gs.max_marks) : 0

        subjectMarkRows.push({
          school_id, result_group_id: req.params.id, result_group_subject_id: gs.id, student_id: student.id,
          weighted_percent, marks_obtained, contributing_exam_count: contributing,
          theory_marks_obtained: null, practical_marks_obtained: null,
        })
        marksBySubjectIdForRule.set(gs.id, {
          marks_obtained, is_absent: contributing === 0,
          theory_marks_obtained: null, practical_marks_obtained: null, theory_is_absent: false, practical_is_absent: false,
          grade: null, grace_marks_applied: 0, result_status_override: null,
        })
        continue
      }

      // Split subject: Theory and Practical are blended as two separate
      // weighted averages across member exams, not one flattened number —
      // otherwise a school with per-subject pass criteria (must pass both
      // components separately) would never get that check applied at the
      // Term level. A member exam that itself never split this subject
      // (e.g. a Unit Test recording one combined mark) has no Theory/
      // Practical breakdown of its own to contribute — rather than drop
      // out of one channel, its single percentage counts toward BOTH, so
      // it still carries its intended weight instead of silently
      // penalizing (or inflating) whichever component it can't speak to.
      let theoryWeightedSum = 0, theoryWeightTotal = 0
      let practicalWeightedSum = 0, practicalWeightTotal = 0
      let contributing = 0
      for (const examId of examIds) {
        const es = subjectByExamAndName.get(`${examId}:${gs.subject_name}`)
        if (!es) continue
        const mk = markByExamSubjectAndStudent.get(`${es.id}:${student.id}`)
        if (!mk) continue
        const w = weightByExam.get(examId) ?? 0
        const esIsSplit = es.theory_max_marks != null && es.practical_max_marks != null

        if (esIsSplit) {
          let contributed = false
          if (!mk.theory_is_absent && mk.theory_marks_obtained != null && es.theory_max_marks! > 0) {
            theoryWeightedSum += (mk.theory_marks_obtained / es.theory_max_marks!) * 100 * w
            theoryWeightTotal += w
            contributed = true
          }
          if (!mk.practical_is_absent && mk.practical_marks_obtained != null && es.practical_max_marks! > 0) {
            practicalWeightedSum += (mk.practical_marks_obtained / es.practical_max_marks!) * 100 * w
            practicalWeightTotal += w
            contributed = true
          }
          if (contributed) contributing++
        } else {
          const obtained = mk.is_absent ? null : mk.marks_obtained
          if (obtained != null && es.max_marks > 0) {
            const pct = (obtained / es.max_marks) * 100
            theoryWeightedSum += pct * w
            theoryWeightTotal += w
            practicalWeightedSum += pct * w
            practicalWeightTotal += w
            contributing++
          }
        }
      }

      const theoryPct = theoryWeightTotal > 0 ? theoryWeightedSum / theoryWeightTotal : null
      const practicalPct = practicalWeightTotal > 0 ? practicalWeightedSum / practicalWeightTotal : null
      const theory_marks_obtained = theoryPct != null ? (theoryPct / 100) * Number(gs.theory_max_marks) : 0
      const practical_marks_obtained = practicalPct != null ? (practicalPct / 100) * Number(gs.practical_max_marks) : 0
      const marks_obtained = theory_marks_obtained + practical_marks_obtained
      const weighted_percent = Number(gs.max_marks) > 0 ? (marks_obtained / Number(gs.max_marks)) * 100 : null

      subjectMarkRows.push({
        school_id, result_group_id: req.params.id, result_group_subject_id: gs.id, student_id: student.id,
        weighted_percent, marks_obtained, contributing_exam_count: contributing,
        theory_marks_obtained, practical_marks_obtained,
      })
      marksBySubjectIdForRule.set(gs.id, {
        marks_obtained, is_absent: contributing === 0,
        theory_marks_obtained, practical_marks_obtained, theory_is_absent: theoryPct == null, practical_is_absent: practicalPct == null,
        grade: null, grace_marks_applied: 0, result_status_override: null,
      })
    }

    const result = computeReportCard({
      subjects: examSubjectRowsForRule,
      marksBySubjectId: marksBySubjectIdForRule,
      classRule,
      resolveSubjectRule: subjectName => resolveEffectiveSubjectRule(classRule, subjectOverrides, group.class_id, null, subjectName),
    })

    groupCards.push({
      school_id, result_group_id: req.params.id, student_id: student.id,
      total_marks: result.total_marks, obtained_marks: result.obtained_marks, percentage: result.percentage,
      grade: result.grade, overall_cgpa: result.overall_cgpa, is_pass: result.is_pass, result_status: result.result_status,
      grace_marks_applied_total: result.grace_marks_applied_total, remarks: result.remarks, remarks_source: result.remarks_source,
    })
  }

  groupCards.sort((a, b) => b.percentage - a.percentage)
  groupCards.forEach((c, i) => { c.rank = i + 1 })

  const { error: subMarksErr } = await supabase.from('result_group_subject_marks').upsert(subjectMarkRows, { onConflict: 'result_group_subject_id,student_id' })
  if (subMarksErr) return res.status(400).json({ success: false, error: subMarksErr.message })
  const { data, error } = await supabase.from('result_group_cards').upsert(groupCards, { onConflict: 'result_group_id,student_id' }).select()
  if (error) return res.status(400).json({ success: false, error: error.message })
  await supabase.from('result_groups').update({ status: 'result_declared', updated_at: new Date().toISOString() }).eq('id', req.params.id)
  res.json({ success: true, data: { report_cards_generated: data?.length } })
}))

// ── Publish ─────────────────────────────────────────────────────

router.post('/:id/publish', requirePermissionV2('exam.result_publish'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: group } = await supabase.from('result_groups').select('id, name, status').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })
  if (group.status !== 'result_declared') {
    return res.status(400).json({ success: false, error: 'Generate results before publishing.' })
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('result_groups').update({ status: 'result_published', updated_at: now }).eq('id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  await supabase.from('result_group_cards').update({ published_at: now }).eq('result_group_id', req.params.id)

  try {
    const { data: cards } = await supabase.from('result_group_cards').select('student_id').eq('result_group_id', req.params.id)
    const studentIds = [...new Set((cards ?? []).map(c => c.student_id))]
    const recipients = await getRecipientUserIdsForStudents(studentIds)
    await createNotifications(recipients, {
      schoolId: school_id, type: 'exam_result_published',
      title: 'Term results published',
      message: `Results for "${group.name}" are now available.`,
      link: '/exams', relatedEntityType: 'result_group', relatedEntityId: req.params.id,
    })
  } catch (notifyErr) {
    console.error('Failed to create result_group publish notifications:', notifyErr)
  }

  res.json({ success: true })
}))

// ── Results — same staff-always / published+own-child-only gating as
// GET /exams/:id/results ────────────────────────────────────────

router.get('/:id/results', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, section_id } = req.query

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const { data: group } = await supabase.from('result_groups').select('status').eq('id', req.params.id).eq('school_id', school_id).single()
    if (!group || group.status !== 'result_published') {
      return res.json({ success: true, data: [], message: 'Results have not been published yet' })
    }
  }

  let query = supabase
    .from('result_group_cards')
    .select('*, students!inner(id, first_name, last_name, admission_number, roll_number, class_id, section_id, classes(name, numeric_level), sections(name))')
    .eq('result_group_id', req.params.id)
    .eq('school_id', school_id)
  if (class_id) query = query.eq('students.class_id', class_id as string)
  if (section_id) query = query.eq('students.section_id', section_id as string)

  const { data, error } = await query.order('rank')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.get('/:id/results/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  let { student_id } = req.params

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const { data: group } = await supabase.from('result_groups').select('status').eq('id', req.params.id).eq('school_id', school_id).single()
    if (!group || group.status !== 'result_published') {
      return res.json({ success: true, data: { report_card: null, subjects: [] }, message: 'Results have not been published yet' })
    }
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId) return res.json({ success: true, data: { report_card: null, subjects: [] } })
    student_id = ownStudentId
  }

  const { data: reportCard } = await supabase.from('result_group_cards').select('*, students(first_name, last_name, admission_number, classes(name))').eq('result_group_id', req.params.id).eq('student_id', student_id).maybeSingle()
  const { data: subjects } = await supabase.from('result_group_subject_marks').select('*, result_group_subjects(subject_name, max_marks, pass_marks)').eq('result_group_id', req.params.id).eq('student_id', student_id)
  res.json({ success: true, data: { report_card: reportCard, subjects: subjects ?? [] } })
}))

// ── Co-scholastic grading ────────────────────────────────────────
// Qualitative grades (Discipline, Work Education, ...) graded once per
// Term by the class teacher — not tied to any member exam's datesheet,
// no marks/max-marks concept, never fed into computeReportCard's
// percentage. Gated exam.marks_entry (a class-teacher action), not
// exam.result_settings_manage (that's for configuring the AREA list
// itself, see coscholasticAreas.routes.ts).

router.get('/:id/coscholastic', requirePermissionV2('exam.marks_entry'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: group } = await supabase.from('result_groups').select('id, class_id').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })

  const [{ data: students }, { data: rawAreas }, { data: assessments }, { data: scaleLinks }] = await Promise.all([
    supabase.from('students').select('id, first_name, last_name, roll_number, admission_number').eq('class_id', group.class_id).eq('school_id', school_id).eq('status', 'active').order('roll_number'),
    supabase.from('coscholastic_areas').select('*').or(`school_id.eq.${school_id},school_id.is.null`).order('sort_order'),
    supabase.from('coscholastic_assessments').select('*').eq('result_group_id', req.params.id).eq('school_id', school_id),
    // This school's own choice of grade scale per area (never a column on
    // coscholastic_areas itself — its 5 seeded rows are shared across
    // every school). An area with none configured falls back to free
    // text on the grading grid.
    supabase.from('coscholastic_area_grade_scales').select('area_id, exam_grade_scales(id, name, exam_grade_bands(grade_label, sort_order))').eq('school_id', school_id),
  ])
  const scaleByArea = new Map((scaleLinks ?? []).map((l: any) => [l.area_id, l.exam_grade_scales]))
  const areas = (rawAreas ?? []).map(a => ({ ...a, grade_scale: scaleByArea.get(a.id) ?? null }))
  res.json({ success: true, data: { students: students ?? [], areas, assessments: assessments ?? [] } })
}))

const CoscholasticGradeSchema = z.object({ area_id: z.string(), grade_label: z.string().min(1), remarks: z.string().optional() })
const SetCoscholasticSchema = z.object({ grades: z.array(CoscholasticGradeSchema).min(1) })

router.put('/:id/coscholastic/:student_id', requirePermissionV2('exam.marks_entry'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { id: result_group_id, student_id } = req.params
  const { grades } = SetCoscholasticSchema.parse(req.body)

  const { data: group } = await supabase.from('result_groups').select('id').eq('id', result_group_id).eq('school_id', school_id).maybeSingle()
  if (!group) return res.status(404).json({ success: false, error: 'Result group not found' })

  const rows = grades.map(g => ({
    school_id, result_group_id, student_id, area_id: g.area_id,
    grade_label: g.grade_label, remarks: g.remarks ?? null,
    assessed_by: req.user!.id, assessed_at: new Date().toISOString(),
  }))
  const { data, error } = await supabase.from('coscholastic_assessments')
    .upsert(rows, { onConflict: 'result_group_id,student_id,area_id' })
    .select()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

export default router
