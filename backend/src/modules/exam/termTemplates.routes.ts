import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { syncGroupSubjectsFromMembers } from './resultGroups.routes'

// Mounted at /exams/term-templates inside exam/routes.ts — inherits that
// router's router.use(authenticate).
//
// Reusable composite-Term blueprints — a school configures the structure
// once ("Term 1 = Unit Test 1 20% + Unit Test 2 20% + Half Yearly 60%")
// and applies it against a class every year instead of manually adding
// each member exam + weight by hand every time (POST /:id/apply below
// creates a real result_groups row + its result_group_exams + syncs
// subjects, in one call — mirrors exam_templates' own
// POST /templates/:id/apply exactly, one level up).
const router = Router()

const ExamTypeEnum = z.enum(['unit_test', 'monthly', 'half_yearly', 'annual', 'pre_board', 'practical', 'other'])

router.get('/', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('term_templates')
    .select('*, term_template_slots(*)')
    .eq('school_id', req.user!.school_id)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  slots: z.array(z.object({
    label: z.string().min(1),
    exam_type: ExamTypeEnum.optional(),
    weight_percent: z.number().gt(0).lte(100),
  })).min(1),
})

router.post('/', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateTemplateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const totalWeight = body.slots.reduce((s, slot) => s + slot.weight_percent, 0)
  if (Math.abs(totalWeight - 100) > 0.01) {
    return res.status(400).json({ success: false, error: `Slot weights must sum to 100% (currently ${totalWeight}%).` })
  }

  const { data: template, error: templateErr } = await supabase
    .from('term_templates')
    .insert({ name: body.name, school_id, created_by: req.user!.id })
    .select().single()
  if (templateErr) return res.status(400).json({ success: false, error: templateErr.message })

  const { error: slotsErr } = await supabase
    .from('term_template_slots')
    .insert(body.slots.map((s, i) => ({ ...s, term_template_id: template.id, sort_order: i })))
  if (slotsErr) {
    // Same rollback reasoning as exam_templates' own creation route — a
    // slot-less template is a dead end with no recovery (no edit route,
    // recreate-only), so don't leave one behind on a partial failure.
    await supabase.from('term_templates').delete().eq('id', template.id)
    return res.status(400).json({ success: false, error: slotsErr.message })
  }

  res.status(201).json({ success: true, data: template })
}))

router.delete('/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('term_templates').delete().eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

const ApplyTemplateSchema = z.object({
  class_ids: z.array(z.string()).min(1),
  name: z.string().min(1),
  academic_year_id: z.string().optional(),
  exam_ids: z.record(z.string(), z.string()), // slot_id -> exam_id, shared across every selected class
})

// A Term is always scoped to one class (result_groups.class_id), but the
// real member exams behind a template's slots are typically NOT
// class-specific — one "Half Yearly Examination" exam already spans
// every class's own exam_subjects rows. So applying to several classes
// at once reuses the exact same exam_ids for every class (one shared
// pick per slot, not one per class) and just creates one result_groups
// row per class — each syncing its OWN subjects from those shared exams,
// since exam_subjects is already class-scoped.
router.post('/:id/apply', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = ApplyTemplateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data: slots, error: slotsErr } = await supabase
    .from('term_template_slots').select('*').eq('term_template_id', req.params.id).order('sort_order')
  if (slotsErr) return res.status(400).json({ success: false, error: slotsErr.message })
  if (!slots?.length) return res.status(404).json({ success: false, error: 'Template not found or has no slots' })

  const { data: template } = await supabase
    .from('term_templates').select('id').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (!template) return res.status(404).json({ success: false, error: 'Template not found' })

  const missing = slots.find(s => !body.exam_ids[s.id])
  if (missing) return res.status(400).json({ success: false, error: `No exam selected for "${missing.label}".` })

  const examIds = Object.values(body.exam_ids)
  const { data: examRows } = await supabase.from('exams').select('id').eq('school_id', school_id).in('id', examIds)
  if ((examRows ?? []).length !== new Set(examIds).size) {
    return res.status(400).json({ success: false, error: 'One or more selected exams could not be found for this school.' })
  }

  const classIds = [...new Set(body.class_ids)]
  const { data: classRows } = await supabase.from('classes').select('id, name').eq('school_id', school_id).in('id', classIds)
  if ((classRows ?? []).length !== classIds.length) {
    return res.status(400).json({ success: false, error: 'One or more selected classes could not be found for this school.' })
  }
  const classNameById = new Map((classRows ?? []).map(c => [c.id, c.name as string]))
  // Multiple Terms sharing a literal name would be indistinguishable in
  // every list they show up in — the class name disambiguates them.
  // A single-class apply keeps the name exactly as typed (unchanged
  // behavior from before multi-class existed).
  const multiClass = classIds.length > 1

  const createdGroupIds: string[] = []
  const createdGroups: any[] = []
  for (const class_id of classIds) {
    const groupName = multiClass ? `${body.name} — ${classNameById.get(class_id) ?? ''}` : body.name
    const { data: group, error: groupErr } = await supabase
      .from('result_groups')
      .insert({ name: groupName, class_id, academic_year_id: body.academic_year_id, school_id, created_by: req.user!.id })
      .select().single()
    if (groupErr) {
      // Same reasoning as every other apply-a-template rollback in this
      // module — leaving some classes' Terms half-created on a failure
      // partway through is worse than undoing the whole request.
      for (const gid of createdGroupIds) await supabase.from('result_groups').delete().eq('id', gid)
      return res.status(400).json({ success: false, error: groupErr.message })
    }
    createdGroupIds.push(group.id)
    createdGroups.push(group)

    const memberRows = slots.map(s => ({ result_group_id: group.id, exam_id: body.exam_ids[s.id], weight_percent: s.weight_percent }))
    const { error: membersErr } = await supabase.from('result_group_exams').insert(memberRows)
    if (membersErr) {
      for (const gid of createdGroupIds) await supabase.from('result_groups').delete().eq('id', gid)
      return res.status(400).json({ success: false, error: membersErr.message })
    }

    try {
      await syncGroupSubjectsFromMembers(group.id, class_id)
    } catch (e: any) {
      // Subjects can always be synced manually afterward from the Term's
      // own page — a sync failure here shouldn't undo the Terms already
      // set up, for this class or any other in the same request.
    }
  }

  res.status(201).json({ success: true, data: createdGroups })
}))

export default router
