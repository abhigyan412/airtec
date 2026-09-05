import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'

// Mounted at /exams/coscholastic-areas inside exam/routes.ts — inherits
// that router's router.use(authenticate).
//
// CBSE-style qualitative grading areas (Discipline, Work Education,
// Health & Physical Education, Attitude & Values, Life Skills — seeded as
// system rows in 20260905010000_coscholastic_grading.sql). Same
// system-row/is_system convention resultSettings.routes.ts's grade-scales
// CRUD already established: reads see school rows + system rows, writes
// (name/sort_order) are school-scoped and can never touch a system row.
//
// Which grade scale an area grades against (reusing exam_grade_scales —
// the same reusable letter-grade table scholastic grading already uses)
// is tracked in a SEPARATE school-scoped mapping table
// (coscholastic_area_grade_scales), never a column on this table — the 5
// seeded areas are shared rows (school_id IS NULL) across every school, so
// a column here would leak one school's scale choice to every other
// school. See 20260905040000_coscholastic_grade_scale.sql.
const router = Router()

router.get('/', requirePermissionV2('exam.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const [{ data: areas, error }, { data: scaleLinks }] = await Promise.all([
    supabase.from('coscholastic_areas').select('*').or(`school_id.eq.${school_id},school_id.is.null`).order('sort_order'),
    supabase.from('coscholastic_area_grade_scales').select('area_id, exam_grade_scales(id, name, exam_grade_bands(grade_label, sort_order))').eq('school_id', school_id),
  ])
  if (error) return res.status(500).json({ success: false, error: error.message })
  const scaleByArea = new Map((scaleLinks ?? []).map((l: any) => [l.area_id, l.exam_grade_scales]))
  const data = (areas ?? []).map(a => ({ ...a, grade_scale: scaleByArea.get(a.id) ?? null }))
  res.json({ success: true, data })
}))

const CreateAreaSchema = z.object({ name: z.string().min(1), sort_order: z.number().int().default(0) })

router.post('/', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = CreateAreaSchema.parse(req.body)
  const { data, error } = await supabase
    .from('coscholastic_areas')
    .insert({ ...body, school_id: req.user!.school_id, created_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data: { ...data, grade_scale: null } })
}))

router.patch('/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('coscholastic_areas').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Area not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in areas cannot be renamed — add a custom area instead.' })
  const body = z.object({ name: z.string().min(1).optional(), sort_order: z.number().int().optional() }).parse(req.body)
  const { data, error } = await supabase.from('coscholastic_areas').update({ ...body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/:id', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { data: existing } = await supabase.from('coscholastic_areas').select('is_system, school_id').eq('id', req.params.id).maybeSingle()
  if (!existing || existing.school_id !== school_id) return res.status(404).json({ success: false, error: 'Area not found' })
  if (existing.is_system) return res.status(400).json({ success: false, error: 'Built-in areas cannot be deleted.' })
  const { error } = await supabase.from('coscholastic_areas').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// PUT (not PATCH) /:id/grade-scale — this school's own choice of which
// scale this area grades against, valid on a system OR custom area alike
// (see the file-level comment). null clears it (falls back to free text).
router.put('/:id/grade-scale', requirePermissionV2('exam.result_settings_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { grade_scale_id } = z.object({ grade_scale_id: z.string().nullable() }).parse(req.body)
  const { data: area } = await supabase.from('coscholastic_areas').select('id').eq('id', req.params.id).or(`school_id.eq.${school_id},school_id.is.null`).maybeSingle()
  if (!area) return res.status(404).json({ success: false, error: 'Area not found' })

  if (grade_scale_id == null) {
    const { error } = await supabase.from('coscholastic_area_grade_scales').delete().eq('school_id', school_id).eq('area_id', req.params.id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    return res.json({ success: true, data: null })
  }
  const { data, error } = await supabase.from('coscholastic_area_grade_scales')
    .upsert({ school_id, area_id: req.params.id, grade_scale_id, updated_at: new Date().toISOString() }, { onConflict: 'school_id,area_id' })
    .select('exam_grade_scales(id, name, exam_grade_bands(grade_label, sort_order))').single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data: (data as any)?.exam_grade_scales ?? null })
}))

export default router
