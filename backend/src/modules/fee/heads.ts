import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { FeeRequest, requireFeeView, requireFeeManage } from './lib/guards'

// The catalogue: the individual charges a bill is made of.
const router = Router()

const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')

const CreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  description: z.string().optional(),
  default_amount: z.number().min(0).default(0),
  is_refundable: z.boolean().default(false),
})

const UpdateSchema = CreateSchema.partial().extend({ is_active: z.boolean().optional() })

router.get('/', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { include_inactive } = req.query
  let q = supabase.from('fee_heads').select('*').eq('school_id', req.user!.school_id).order('name')
  if (!include_inactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CreateSchema.parse(req.body)
  const { data, error } = await supabase.from('fee_heads').insert({
    school_id: req.user!.school_id,
    name: body.name.trim(),
    // Auto-derived so nobody has to invent one, but explicit if given — it is the
    // stable identifier reports and imports key on.
    code: slug(body.code ?? body.name),
    description: body.description,
    default_amount: body.default_amount,
    is_refundable: body.is_refundable,
  }).select().single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'A fee head with that code already exists' })
    }
    return res.status(400).json({ success: false, error: error.message })
  }
  res.status(201).json({ success: true, data })
}))

router.patch('/:id', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = UpdateSchema.parse(req.body)
  const patch: any = { ...body }
  if (body.code) patch.code = slug(body.code)
  if (body.name) patch.name = body.name.trim()

  const { data, error } = await supabase.from('fee_heads').update(patch)
    .eq('id', req.params.id).eq('school_id', req.user!.school_id).select().maybeSingle()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Fee head not found' })
  res.json({ success: true, data })
}))

// Deactivate rather than delete: structure lines and issued invoice lines
// reference it, and removing the row would leave both unreadable.
router.delete('/:id', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  // Checked. A failed count read as 0, which took the DELETE branch and hard
  // deleted a head that structure lines and issued invoices still reference —
  // exactly what the comment above says must never happen.
  const { count, error: countErr } = await supabase.from('fee_structure_lines')
    .select('id', { count: 'exact', head: true }).eq('fee_head_id', req.params.id)
  if (countErr) return res.status(500).json({ success: false, error: countErr.message })

  if ((count ?? 0) > 0) {
    const { data, error } = await supabase.from('fee_heads').update({ is_active: false })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id).select().maybeSingle()
    if (error) return res.status(400).json({ success: false, error: error.message })
    return res.json({
      success: true, data,
      meta: { deactivated: true, reason: `Used by ${count} structure line(s), so it was retired rather than deleted.` },
    })
  }

  const { error } = await supabase.from('fee_heads').delete()
    .eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data: { deleted: true } })
}))

export default router
