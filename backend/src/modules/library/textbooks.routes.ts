import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// TEXTBOOK DISTRIBUTION — RTE/state-scheme free textbooks are a give,
// not a lend. This is a compliance record for audits (which students,
// which scheme, how many books), never expected back and never a
// book_loan. See reports.routes.ts for the audit-export view.
// ═══════════════════════════════════════════════════════════════
router.get('/', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('textbook_distributions')
      .select('*, students(first_name, last_name, admission_number, class_id, classes(name)), book_titles(title)')
      .eq('school_id', req.user!.school_id).order('distributed_at', { ascending: false })
    if (req.query.academic_year_id) q = q.eq('academic_year_id', req.query.academic_year_id as string)
    if (req.query.scheme) q = q.eq('scheme', req.query.scheme as string)
    if (req.query.student_id) q = q.eq('student_id', req.query.student_id as string)
    const { data, error } = await q.limit(500)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const DistributeSchema = z.object({
  student_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  title_id: z.string().uuid().optional(),
  book_name: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive().max(50).default(1),
  scheme: z.enum(['rte', 'state_free_textbook', 'other']),
  notes: z.string().max(500).optional(),
})

router.post('/', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DistributeSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('textbook_distributions')
      .insert({ school_id: req.user!.school_id, distributed_by: req.user!.id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// Bulk variant — a whole class/scheme gets the same book(s) at year
// start, the actual common case, not one-student-at-a-time entry.
const BulkDistributeSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(200),
  academic_year_id: z.string().uuid(),
  title_id: z.string().uuid().optional(),
  book_name: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive().max(50).default(1),
  scheme: z.enum(['rte', 'state_free_textbook', 'other']),
  notes: z.string().max(500).optional(),
})

router.post('/bulk', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = BulkDistributeSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { student_ids, ...rest } = parsed.data
    const rows = student_ids.map(student_id => ({ school_id: req.user!.school_id, distributed_by: req.user!.id, student_id, ...rest }))
    const { data, error } = await supabase.from('textbook_distributions').insert(rows).select('*')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: { distributed_count: data?.length ?? 0 } })
  })
)

export default router
