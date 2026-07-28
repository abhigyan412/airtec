import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { runFeeReminders } from '../../shared/utils/feeReminders'

const router = Router()
router.use(authenticate)

// ── GET /notifications — the logged-in user's own notifications,
// newest first. Scoped to req.user.id, not school_id — a user only
// ever sees their own notifications regardless of role.
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', unread_only } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))

  let query = supabase.from('notifications').select('*', { count: 'exact' })
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (unread_only === 'true') query = query.eq('is_read', false)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

router.get('/unread-count', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { count, error } = await supabase.from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user!.id).eq('is_read', false)
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data: { count: count ?? 0 } })
}))

router.patch('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id).eq('user_id', req.user!.id)
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Notification not found' })
  res.json({ success: true, data })
}))

router.patch('/read-all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.user!.id).eq('is_read', false)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── POST /notifications/run-fee-reminders — manual trigger for the
// same job the daily cron runs, scoped to the caller's own school.
// Useful for testing, and as a fallback if the school doesn't trust
// the background scheduler (e.g. a serverless/cold-start host where
// a long-lived cron process isn't guaranteed to actually be running).
router.post('/run-fee-reminders', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await runFeeReminders(req.user!.school_id)
    res.json({ success: true, data: result })
  })
)

export default router
