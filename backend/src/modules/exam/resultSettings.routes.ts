import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { RESULT_PRESETS } from './services/presets'
import { ensureResultFreezePublishWorkflowDefinition } from '../rbac/seed'

const RESULT_WORKFLOW_NAME = 'Result Freeze & Publish Workflow'

// Mounted at /exams/result-settings inside exam/routes.ts — inherits that
// router's router.use(authenticate), no separate auth wiring needed here.
//
// Reads are gated on exam.view (same as the rest of the exam module);
// every write is gated on the one new permission this feature adds,
// exam.result_settings_manage (School Admin/Principal/Vice
// Principal/Exam Controller by default — see rbac/seed.ts).
const router = Router()

const EXAM_TYPES = ['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other'] as const
const ExamTypeEnum = z.enum(EXAM_TYPES)

// ═══════════════════════════════════════════════════════════════
// GRADE SCALES
// ═══════════════════════════════════════════════════════════════

router.get('/grade-scales', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data, error } = await supabase
    .from('exam_grade_scales')
    .select('*, exam_grade_bands(*)')
    .or(`school_id.eq.${school_id},school_id.is.null`)
    .order('sort_order', { foreignTable: 'exam_grade_bands' })
    .order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

const CreateGradeScaleSchema = z.object({ name: z.string().min(1), scale_type: z.enum(['grade', 'cgpa']) })

router.post('/grade-scales', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateGradeScaleSchema.parse(req.body)
  const { data, error } = await supabase
    .from('exam_grade_scales')
    .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.patch('/grade-scales/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('exam_grade_scales').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Grade scale not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in grade scales cannot be edited — duplicate it into a custom scale first.' })
  const body = z.object({ name: z.string().min(1).optional() }).parse(req.body)
  const { data, error } = await supabase.from('exam_grade_scales').update(body).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/grade-scales/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('exam_grade_scales').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Grade scale not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in grade scales cannot be deleted.' })
  const [{ count: ruleCount }, { count: overrideCount }] = await Promise.all([
    supabase.from('exam_class_result_rules').select('*', { count: 'exact', head: true }).eq('grade_scale_id', req.params.id),
    supabase.from('exam_subject_result_overrides').select('*', { count: 'exact', head: true }).eq('grade_scale_id', req.params.id),
  ])
  if ((ruleCount ?? 0) > 0 || (overrideCount ?? 0) > 0) {
    return res.status(400).json({ success: false, error: 'This grade scale is in use by a class rule or subject override — remove those first.' })
  }
  const { error } = await supabase.from('exam_grade_scales').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

const BandSchema = z.object({
  min_percent: z.number().min(0).max(100),
  max_percent: z.number().min(0).max(100),
  grade_label: z.string().min(1),
  grade_point: z.number().nullable().optional(),
  is_pass: z.boolean().default(true),
})

router.put('/grade-scales/:id/bands', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: scale } = await supabase.from('exam_grade_scales').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!scale || scale.school_id !== school_id) return res.status(404).json({ success: false, error: 'Grade scale not found' })
  if (scale.is_system) return res.status(400).json({ success: false, error: 'Built-in grade scales cannot be edited — duplicate it into a custom scale first.' })

  const bands = z.array(BandSchema).min(1).parse(req.body.bands)
  const sorted = [...bands].sort((a, b) => b.min_percent - a.min_percent)
  for (const b of sorted) {
    if (b.min_percent > b.max_percent) {
      return res.status(400).json({ success: false, error: `Band "${b.grade_label}": min_percent must not exceed max_percent.` })
    }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].min_percent <= sorted[i + 1].max_percent) {
      return res.status(400).json({ success: false, error: `Bands "${sorted[i].grade_label}" and "${sorted[i + 1].grade_label}" overlap.` })
    }
  }
  if (sorted[0].max_percent < 100) return res.status(400).json({ success: false, error: 'Bands must cover up to 100%.' })
  if (sorted[sorted.length - 1].min_percent > 0) return res.status(400).json({ success: false, error: 'Bands must cover down to 0%.' })

  const { error: delErr } = await supabase.from('exam_grade_bands').delete().eq('grade_scale_id', req.params.id)
  if (delErr) return res.status(400).json({ success: false, error: delErr.message })
  const rows = sorted.map((b, i) => ({ grade_scale_id: req.params.id, ...b, sort_order: i + 1 }))
  const { data, error } = await supabase.from('exam_grade_bands').insert(rows).select()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ═══════════════════════════════════════════════════════════════
// REMARKS RULES — outcome -> free-text remark, same shape as grade scales
// ═══════════════════════════════════════════════════════════════

router.get('/remarks-rules', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data, error } = await supabase
    .from('exam_remarks_rules')
    .select('*, exam_remarks_bands(*)')
    .or(`school_id.eq.${school_id},school_id.is.null`)
    .order('sort_order', { foreignTable: 'exam_remarks_bands' })
    .order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/remarks-rules', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body)
  const { data, error } = await supabase
    .from('exam_remarks_rules')
    .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.patch('/remarks-rules/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('exam_remarks_rules').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Remarks rule not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in remarks rules cannot be edited — duplicate it first.' })
  const body = z.object({ name: z.string().min(1).optional() }).parse(req.body)
  const { data, error } = await supabase.from('exam_remarks_rules').update(body).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/remarks-rules/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('exam_remarks_rules').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Remarks rule not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in remarks rules cannot be deleted.' })
  const { count } = await supabase.from('exam_class_result_rules').select('*', { count: 'exact', head: true }).eq('remarks_rule_id', req.params.id)
  if ((count ?? 0) > 0) return res.status(400).json({ success: false, error: 'This remarks rule is in use by a class rule — remove that first.' })
  const { error } = await supabase.from('exam_remarks_rules').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

const RemarksBandSchema = z.object({
  match_status: z.enum(['pass', 'fail', 'compartment', 'not_eligible', 'withheld']),
  min_percent: z.number().min(0).max(100).nullable().optional(),
  max_percent: z.number().min(0).max(100).nullable().optional(),
  remark_text: z.string().min(1),
})

router.put('/remarks-rules/:id/bands', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: rule } = await supabase.from('exam_remarks_rules').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!rule || rule.school_id !== school_id) return res.status(404).json({ success: false, error: 'Remarks rule not found' })
  if (rule.is_system) return res.status(400).json({ success: false, error: 'Built-in remarks rules cannot be edited — duplicate it first.' })

  const bands = z.array(RemarksBandSchema).min(1).parse(req.body.bands)
  const { error: delErr } = await supabase.from('exam_remarks_bands').delete().eq('remarks_rule_id', req.params.id)
  if (delErr) return res.status(400).json({ success: false, error: delErr.message })
  const rows = bands.map((b, i) => ({ remarks_rule_id: req.params.id, ...b, sort_order: i + 1 }))
  const { data, error } = await supabase.from('exam_remarks_bands').insert(rows).select()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ═══════════════════════════════════════════════════════════════
// CLASS RESULT RULES
// ═══════════════════════════════════════════════════════════════

const ClassRuleBodySchema = z.object({
  promotion_policy: z.enum(['standard', 'no_detention']).optional(),
  pass_criteria_mode: z.enum(['aggregate', 'per_subject']).optional(),
  pass_criteria_requires_aggregate: z.boolean().optional(),
  aggregate_pass_percent: z.number().min(0).max(100).optional(),
  best_of_subjects_count: z.number().int().positive().nullable().optional(),
  allow_additional_subject_substitution: z.boolean().optional(),
  compartment_policy: z.enum(['none', 'allow']).optional(),
  compartment_max_failed_subjects: z.number().int().positive().nullable().optional(),
  min_attendance_percent: z.number().min(0).max(100).nullable().optional(),
  max_grace_marks_per_subject: z.number().min(0).optional(),
  max_grace_marks_total: z.number().min(0).optional(),
  rounding_mode: z.enum(['nearest', 'floor', 'ceil']).optional(),
  rounding_decimals: z.number().int().min(0).max(4).optional(),
  grading_mode: z.enum(['marks', 'grade_only', 'cgpa']).optional(),
  grade_scale_id: z.string().nullable().optional(),
  remarks_rule_id: z.string().nullable().optional(),
  applied_preset_key: z.string().nullable().optional(),
})

// Every row for the class: the default (exam_type null) plus any
// type-specific overrides — the settings-page editor renders all of them
// in one screen.
router.get('/class-rules', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id } = req.query
  let query = supabase.from('exam_class_result_rules').select('*').eq('school_id', school_id)
  if (class_id) query = query.eq('class_id', class_id as string)
  const { data, error } = await query.order('class_id').order('exam_type', { nullsFirst: true })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// Resolves ONE effective rule for a class (+ optional exam_type), same
// precedence resolveEffectiveClassRule() uses: exact type row, else the
// class default, else "unconfigured" (source: 'legacy', data: null).
router.get('/class-rules/:class_id', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id } = req.params
  const exam_type = req.query.exam_type as string | undefined

  if (exam_type) {
    ExamTypeEnum.parse(exam_type)
    const { data: typed } = await supabase.from('exam_class_result_rules').select('*')
      .eq('school_id', school_id).eq('class_id', class_id).eq('exam_type', exam_type).maybeSingle()
    if (typed) return res.json({ success: true, data: typed, source: 'exam_type' })
  }
  const { data: def } = await supabase.from('exam_class_result_rules').select('*')
    .eq('school_id', school_id).eq('class_id', class_id).is('exam_type', null).maybeSingle()
  if (def) return res.json({ success: true, data: def, source: 'class_default' })
  res.json({ success: true, data: null, source: 'legacy' })
}))

router.patch('/class-rules/:class_id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id } = req.params
  const exam_type = (req.query.exam_type as string | undefined) || null
  if (exam_type) ExamTypeEnum.parse(exam_type)
  const body = ClassRuleBodySchema.parse(req.body)

  let existingQuery = supabase.from('exam_class_result_rules').select('id').eq('school_id', school_id).eq('class_id', class_id)
  existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
  const { data: existing } = await existingQuery.maybeSingle()

  const now = new Date().toISOString()
  if (existing) {
    const { data, error } = await supabase.from('exam_class_result_rules')
      .update({ ...body, updated_by: req.user!.id, updated_at: now })
      .eq('id', existing.id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    return res.json({ success: true, data })
  }
  const { data, error } = await supabase.from('exam_class_result_rules')
    .insert({ ...body, school_id, class_id, exam_type, created_by: req.user!.id, updated_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.delete('/class-rules/:class_id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id } = req.params
  const exam_type = (req.query.exam_type as string | undefined) || null
  let query = supabase.from('exam_class_result_rules').delete().eq('school_id', school_id).eq('class_id', class_id)
  query = exam_type ? query.eq('exam_type', exam_type) : query.is('exam_type', null)
  const { error } = await query
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// POST /class-rules/bulk-apply — the same one-exam-type rule, applied to
// several classes' worth of exam_class_result_rules rows in one submit,
// instead of visiting Class Rules once per class. Same
// check-then-update-or-insert per class PATCH /class-rules/:class_id
// already uses (the partial unique indexes on this table still rule out
// a plain .upsert()) — just looped server-side across class_ids rather
// than the caller making N separate requests.
const BulkApplyClassRuleSchema = ClassRuleBodySchema.extend({
  class_ids: z.array(z.string()).min(1),
  exam_type: ExamTypeEnum.nullable().optional(),
})

router.post('/class-rules/bulk-apply', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_ids, exam_type: examTypeRaw, ...body } = BulkApplyClassRuleSchema.parse(req.body)
  const exam_type = examTypeRaw ?? null
  const uniqueClassIds = [...new Set(class_ids)]

  let applied = 0
  for (const class_id of uniqueClassIds) {
    let existingQuery = supabase.from('exam_class_result_rules').select('id').eq('school_id', school_id).eq('class_id', class_id)
    existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
    const { data: existing } = await existingQuery.maybeSingle()

    const now = new Date().toISOString()
    if (existing) {
      const { error } = await supabase.from('exam_class_result_rules')
        .update({ ...body, updated_by: req.user!.id, updated_at: now })
        .eq('id', existing.id)
      if (!error) applied++
    } else {
      const { error } = await supabase.from('exam_class_result_rules')
        .insert({ ...body, school_id, class_id, exam_type, created_by: req.user!.id, updated_by: req.user!.id })
      if (!error) applied++
    }
  }

  res.json({ success: true, data: { applied, total: uniqueClassIds.length } })
}))

// ═══════════════════════════════════════════════════════════════
// SUBJECT-LEVEL OVERRIDES
// ═══════════════════════════════════════════════════════════════

const SubjectOverrideCreateSchema = z.object({
  class_id: z.string(),
  exam_type: ExamTypeEnum.optional(),
  subject_name: z.string().min(1),
  pass_criteria_mode: z.enum(['aggregate', 'per_subject']).optional(),
  aggregate_pass_percent: z.number().min(0).max(100).optional(),
  grading_mode: z.enum(['marks', 'grade_only', 'cgpa']).optional(),
  grade_scale_id: z.string().nullable().optional(),
  has_practical: z.boolean().optional(),
  is_additional: z.boolean().optional(),
  include_in_aggregate: z.boolean().optional(),
  subject_group_key: z.string().nullable().optional(),
  // School-wide default marks Add Subject pre-fills from — applies when
  // has_practical is false; the theory/practical pair applies when it's
  // true. Both sets nullable/independent of each other.
  default_max_marks: z.number().nullable().optional(),
  default_pass_marks: z.number().nullable().optional(),
  default_theory_max_marks: z.number().nullable().optional(),
  default_theory_pass_marks: z.number().nullable().optional(),
  default_practical_max_marks: z.number().nullable().optional(),
  default_practical_pass_marks: z.number().nullable().optional(),
})

const SubjectOverrideUpdateSchema = SubjectOverrideCreateSchema.omit({ class_id: true, subject_name: true, exam_type: true }).partial()

router.get('/subject-overrides', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, exam_type } = req.query
  let query = supabase.from('exam_subject_result_overrides').select('*').eq('school_id', school_id)
  if (class_id) query = query.eq('class_id', class_id as string)
  if (exam_type) query = query.eq('exam_type', exam_type as string)
  const { data, error } = await query.order('subject_name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/subject-overrides', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = SubjectOverrideCreateSchema.parse(req.body)
  const { data, error } = await supabase
    .from('exam_subject_result_overrides')
    .insert({ ...body, exam_type: body.exam_type ?? null, school_id: req.user!.school_id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

router.patch('/subject-overrides/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = SubjectOverrideUpdateSchema.parse(req.body)
  const { data, error } = await supabase
    .from('exam_subject_result_overrides')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('school_id', req.user!.school_id)
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Override not found' })
  res.json({ success: true, data })
}))

router.delete('/subject-overrides/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('exam_subject_result_overrides').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// POST /subject-overrides/bulk-apply — one subject's default Max/Pass
// Marks (or Theory/Practical split), for one exam type, applied to
// several classes' worth of exam_subject_result_overrides rows in one
// submit — the same "configure once, tick the classes" shape
// class-rules/bulk-apply already uses, one level down at the subject
// layer. subject_name is free text (not a class subject_id) since
// different classes carry different subject rosters; a class that
// doesn't actually teach this subject just never reads the override —
// harmless, not an error.
const BulkApplySubjectOverrideSchema = SubjectOverrideUpdateSchema.extend({
  class_ids: z.array(z.string()).min(1),
  exam_type: ExamTypeEnum.nullable().optional(),
  subject_name: z.string().min(1),
})

router.post('/subject-overrides/bulk-apply', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_ids, exam_type: examTypeRaw, subject_name, ...body } = BulkApplySubjectOverrideSchema.parse(req.body)
  const exam_type = examTypeRaw ?? null
  const uniqueClassIds = [...new Set(class_ids)]

  let applied = 0
  for (const class_id of uniqueClassIds) {
    let existingQuery = supabase.from('exam_subject_result_overrides').select('id')
      .eq('school_id', school_id).eq('class_id', class_id).eq('subject_name', subject_name)
    existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      const { error } = await supabase.from('exam_subject_result_overrides')
        .update({ ...body, updated_at: new Date().toISOString() }).eq('id', existing.id)
      if (!error) applied++
    } else {
      const { error } = await supabase.from('exam_subject_result_overrides')
        .insert({ ...body, school_id, class_id, exam_type, subject_name })
      if (!error) applied++
    }
  }

  res.json({ success: true, data: { applied, total: uniqueClassIds.length } })
}))

// POST /subject-overrides/bulk-apply-all — the same Max/Pass Marks
// config, applied to EVERY subject each ticked class actually teaches
// (not one named subject) — "set marks for all class all subject" in
// one submit. Each class gets its own subject list resolved from the
// `subjects` table (class-specific rows + school-wide ones), the exact
// same resolution generate-structure already uses — a class never gets
// an override for a subject it doesn't teach.
//
// Batched, not a per-(class,subject) loop: naive per-pair round trips is
// exactly the O(classes x subjects) blowup that hung generate-structure
// the first time it shipped (see that route's own comment). Since every
// pair gets the IDENTICAL marks config here (that's the whole point),
// existing rows can all be updated in ONE call (.update(body).in('id', ids)),
// and every new row in one batched insert — three total DB round trips
// (subjects fetch, existing-overrides fetch, then the writes) regardless
// of how many classes or subjects are involved.
const BulkApplyAllSubjectOverridesSchema = SubjectOverrideUpdateSchema.extend({
  class_ids: z.array(z.string()).min(1),
  exam_type: ExamTypeEnum.nullable().optional(),
})

router.post('/subject-overrides/bulk-apply-all', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_ids, exam_type: examTypeRaw, ...body } = BulkApplyAllSubjectOverridesSchema.parse(req.body)
  const exam_type = examTypeRaw ?? null
  const uniqueClassIds = [...new Set(class_ids)]

  const classIdList = uniqueClassIds.join(',')
  const { data: subjects } = await supabase.from('subjects').select('name, class_id')
    .eq('school_id', school_id).or(`class_id.in.(${classIdList}),class_id.is.null`)

  const pairs: { class_id: string; subject_name: string }[] = []
  for (const class_id of uniqueClassIds) {
    const names = new Set((subjects ?? [])
      .filter((s: any) => s.class_id === class_id || s.class_id == null)
      .map((s: any) => s.name as string))
    for (const subject_name of names) pairs.push({ class_id, subject_name })
  }
  if (!pairs.length) return res.json({ success: true, data: { applied: 0, updated: 0, created: 0 } })

  let existingQuery = supabase.from('exam_subject_result_overrides').select('id, class_id, subject_name')
    .eq('school_id', school_id).in('class_id', uniqueClassIds)
  existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
  const { data: existingRows } = await existingQuery

  const existingByKey = new Map((existingRows ?? []).map((r: any) => [`${r.class_id}:${r.subject_name}`, r.id as string]))
  const toUpdateIds: string[] = []
  const toInsert: any[] = []
  for (const pair of pairs) {
    const existingId = existingByKey.get(`${pair.class_id}:${pair.subject_name}`)
    if (existingId) toUpdateIds.push(existingId)
    else toInsert.push({ ...body, school_id, class_id: pair.class_id, exam_type, subject_name: pair.subject_name })
  }

  if (toUpdateIds.length) {
    const { error } = await supabase.from('exam_subject_result_overrides')
      .update({ ...body, updated_at: new Date().toISOString() }).in('id', toUpdateIds)
    if (error) return res.status(400).json({ success: false, error: error.message })
  }
  if (toInsert.length) {
    const { error } = await supabase.from('exam_subject_result_overrides').insert(toInsert)
    if (error) return res.status(400).json({ success: false, error: error.message })
  }

  res.json({ success: true, data: { applied: pairs.length, updated: toUpdateIds.length, created: toInsert.length } })
}))

// ═══════════════════════════════════════════════════════════════
// PRESETS — one-time autofill of the class-default row only, never a
// live binding. See services/presets.ts's own header comment.
// ═══════════════════════════════════════════════════════════════

router.get('/presets', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: RESULT_PRESETS })
}))

const ApplyPresetSchema = z.object({ class_ids: z.array(z.string()).min(1) })

router.post('/presets/:key/apply', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const preset = RESULT_PRESETS.find(p => p.key === req.params.key)
  if (!preset) return res.status(404).json({ success: false, error: 'Preset not found' })
  const { class_ids } = ApplyPresetSchema.parse(req.body)

  let grade_scale_id: string | null = null
  if (preset.rule.gradeScaleName) {
    const { data: scale } = await supabase.from('exam_grade_scales').select('id').eq('name', preset.rule.gradeScaleName).is('school_id', null).maybeSingle()
    grade_scale_id = scale?.id ?? null
  }

  const payload = {
    promotion_policy: preset.rule.promotion_policy,
    pass_criteria_mode: preset.rule.pass_criteria_mode,
    pass_criteria_requires_aggregate: preset.rule.pass_criteria_requires_aggregate,
    aggregate_pass_percent: preset.rule.aggregate_pass_percent,
    grading_mode: preset.rule.grading_mode,
    grade_scale_id,
    applied_preset_key: preset.key,
    updated_by: req.user!.id,
  }

  // No plain UNIQUE(school_id,class_id,exam_type) exists to upsert
  // against — exam_type IS NULL rows are only constrained by the partial
  // index from the Phase 1 migration, which supabase-js's upsert() can't
  // target — so this checks for an existing class-default row per class
  // and updates or inserts explicitly, same pattern PATCH
  // /class-rules/:class_id already uses.
  const results = await Promise.all(class_ids.map(async (class_id: string) => {
    const { data: existing } = await supabase.from('exam_class_result_rules').select('id')
      .eq('school_id', school_id).eq('class_id', class_id).is('exam_type', null).maybeSingle()
    return existing
      ? supabase.from('exam_class_result_rules').update(payload).eq('id', existing.id)
      : supabase.from('exam_class_result_rules').insert({ ...payload, school_id, class_id, exam_type: null, created_by: req.user!.id })
  }))
  const failed = results.find(r => r.error)
  if (failed?.error) return res.status(400).json({ success: false, error: failed.error.message })

  res.json({ success: true, data: { applied: class_ids.length } })
}))

// ═══════════════════════════════════════════════════════════════
// PUBLISH WORKFLOW — lets a school reconfigure the Result Freeze &
// Publish approval chain to any number of steps, each assigned to any of
// their own roles, instead of the fixed 3-step Exam Controller -> Principal
// -> Principal default ensureResultFreezePublishWorkflowDefinition seeds.
//
// Editing never deletes a workflow_steps row: workflow_instances.
// current_step_id has a plain FK (no ON DELETE) to workflow_steps, and a
// rejected instance never nulls it out, so a delete-then-reinsert (the
// pattern used above for grade/remarks bands) would either hard-fail with
// an FK violation the moment a school has ever run this workflow once, or
// cascade-delete workflow_approvals audit history for exams that already
// completed it. Instead, saving a new step list retires the current
// workflow_definitions row (renamed out of the way + is_active: false)
// and inserts a fresh one with the canonical name — old exams' instances
// and approvals keep pointing at the untouched old definition/steps
// forever; startWorkflow's own `.eq('is_active', true)` lookup picks up
// the new one automatically, with no change needed there.
// ═══════════════════════════════════════════════════════════════

async function getActiveResultWorkflowDefinition(school_id: string) {
    await ensureResultFreezePublishWorkflowDefinition(school_id)
    const { data } = await supabase
        .from('workflow_definitions')
        .select('id, name')
        .eq('school_id', school_id)
        .eq('name', RESULT_WORKFLOW_NAME)
        .eq('is_active', true)
        .maybeSingle()
    return data
}

router.get('/workflow', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const definition = await getActiveResultWorkflowDefinition(school_id)
    if (!definition) return res.status(500).json({ success: false, error: 'Could not load the result publish workflow' })

    const [{ data: steps }, { count: activeCount }] = await Promise.all([
        supabase.from('workflow_steps').select('id, step_order, role_id, action_name, roles ( name )')
            .eq('workflow_id', definition.id).order('step_order'),
        supabase.from('workflow_instances').select('id', { count: 'exact', head: true })
            .eq('workflow_id', definition.id).eq('status', 'in_progress'),
    ])

    res.json({ success: true, data: { definition_id: definition.id, steps: steps ?? [], editable: (activeCount ?? 0) === 0 } })
}))

const WorkflowStepSchema = z.object({ role_id: z.string(), action_name: z.string().min(1) })
const SaveWorkflowSchema = z.object({ steps: z.array(WorkflowStepSchema).min(1) })

router.put('/workflow', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { steps } = SaveWorkflowSchema.parse(req.body)

    const definition = await getActiveResultWorkflowDefinition(school_id)
    if (!definition) return res.status(500).json({ success: false, error: 'Could not load the result publish workflow' })

    const { count: activeCount } = await supabase
        .from('workflow_instances').select('id', { count: 'exact', head: true })
        .eq('workflow_id', definition.id).eq('status', 'in_progress')
    if ((activeCount ?? 0) > 0) {
        return res.status(400).json({ success: false, error: "Can't change the workflow while an exam's results are mid-approval — finish or reject that first." })
    }

    const roleIds = [...new Set(steps.map(s => s.role_id))]
    const { data: validRoles } = await supabase.from('roles').select('id').eq('school_id', school_id).in('id', roleIds)
    if ((validRoles ?? []).length !== roleIds.length) {
        return res.status(400).json({ success: false, error: 'One or more selected roles are invalid for this school.' })
    }

    const retiredName = `${definition.name} (retired ${new Date().toISOString()})`
    const { error: retireErr } = await supabase.from('workflow_definitions')
        .update({ name: retiredName, is_active: false }).eq('id', definition.id)
    if (retireErr) return res.status(400).json({ success: false, error: retireErr.message })

    const { data: newDefinition, error: defErr } = await supabase
        .from('workflow_definitions')
        .insert({ school_id, name: RESULT_WORKFLOW_NAME, module: 'exam', entity_type: 'exam', is_active: true })
        .select('id').single()
    if (defErr || !newDefinition) return res.status(400).json({ success: false, error: defErr?.message ?? 'Failed to save workflow' })

    const stepRows = steps.map((s, i) => ({
        workflow_id: newDefinition.id, step_order: i + 1, role_id: s.role_id, action_name: s.action_name, is_required: true,
    }))
    const { data: savedSteps, error: stepsErr } = await supabase.from('workflow_steps').insert(stepRows)
        .select('id, step_order, role_id, action_name, roles ( name )')
    if (stepsErr) return res.status(400).json({ success: false, error: stepsErr.message })

    res.json({ success: true, data: { definition_id: newDefinition.id, steps: savedSteps ?? [] } })
}))

export default router
