import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { runFeeReminders } from '../../shared/utils/feeReminders'
import { runDeliveries } from '../../shared/utils/delivery'
import { createNotification } from '../../shared/utils/notifications'

const router = Router()
router.use(authenticate)

// ── GET /notifications — the logged-in user's own notifications,
// newest first. Scoped to req.user.id, not school_id — a user only
// ever sees their own notifications regardless of role.
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', unread_only, type } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))

  let query = supabase.from('notifications').select('*', { count: 'exact' })
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (unread_only === 'true') query = query.eq('is_read', false)
  if (type) query = query.eq('type', type as string)

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

// ═══════════════════════════════════════════════════════════════
// Push subscriptions & preferences (design.md §5.3)
// Everything below is scoped to req.user.id — a caller can only ever
// read or change their own subscriptions and preferences.
// ═══════════════════════════════════════════════════════════════

// ── GET /notifications/vapid-public-key ─────────────────────────
// The public half of the VAPID pair, needed by pushManager.subscribe().
// It is a public value by design; kept behind auth for symmetry with the
// rest of this router, not for secrecy.
router.get('/vapid-public-key', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return res.status(503).json({ success: false, error: 'Push is not configured on this server' })
  res.json({ success: true, data: { publicKey: key } })
}))

// ── POST /notifications/push/subscribe ──────────────────────────
// Upsert on endpoint: re-subscribing the same browser must not create a
// second row, and a subscription that previously expired should come back
// to life rather than stay retired.
router.post('/push/subscribe', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { subscription, app } = req.body ?? {}
  const endpoint = subscription?.endpoint
  const p256dh = subscription?.keys?.p256dh
  const auth = subscription?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ success: false, error: 'subscription with keys.p256dh and keys.auth is required' })
  }
  if (app !== 'staff' && app !== 'family') {
    return res.status(400).json({ success: false, error: "app must be 'staff' or 'family'" })
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: req.user!.id, school_id: req.user!.school_id, app,
    endpoint, p256dh, auth,
    user_agent: req.get('user-agent') ?? null,
    last_used_at: new Date().toISOString(),
    failed_at: null,
  }, { onConflict: 'endpoint' })

  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true })
}))

// ── DELETE /notifications/push/subscribe ────────────────────────
router.delete('/push/subscribe', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body ?? {}
  if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint is required' })
  const { error } = await supabase.from('push_subscriptions')
    .delete().eq('endpoint', endpoint).eq('user_id', req.user!.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── GET /notifications/preferences ──────────────────────────────
// Opt-outs only: what comes back is what the user has MUTED. Anything
// absent is enabled, which is why a new notification type needs no
// backfill to start reaching people.
router.get('/preferences', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('notification_preferences')
    .select('type, channel, muted_at').eq('user_id', req.user!.id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── PUT /notifications/preferences ──────────────────────────────
// Body: { muted: [{ type, channel }, ...] } — the complete desired set of
// opt-outs. Replaces rather than merges, so unchecking a box in the UI
// actually removes the mute instead of needing a separate delete call.
router.put('/preferences', asyncHandler(async (req: AuthRequest, res: Response) => {
  const muted = Array.isArray(req.body?.muted) ? req.body.muted : null
  if (!muted) return res.status(400).json({ success: false, error: 'muted must be an array' })

  const CHANNELS = ['in_app', 'push', 'email']
  const rows = muted
    .filter((m: any) => m?.type && CHANNELS.includes(m?.channel))
    .map((m: any) => ({ user_id: req.user!.id, type: m.type, channel: m.channel }))

  const { error: delErr } = await supabase.from('notification_preferences').delete().eq('user_id', req.user!.id)
  if (delErr) return res.status(400).json({ success: false, error: delErr.message })
  if (rows.length) {
    const { error } = await supabase.from('notification_preferences').insert(rows)
    if (error) return res.status(400).json({ success: false, error: error.message })
  }
  res.json({ success: true, data: { muted: rows.length } })
}))

// ── POST /notifications/test-push ───────────────────────────────
// Sends the caller a notification addressed to themselves and drains the
// outbox synchronously. This is how someone confirms push actually works
// after enabling it — "did it work?" is otherwise unanswerable until the
// next real event, which might be days away.
//
// Not gated by role: it can only ever notify the caller.
router.post('/test-push', asyncHandler(async (req: AuthRequest, res: Response) => {
  await createNotification({
    schoolId: req.user!.school_id,
    userId: req.user!.id,
    type: 'attendance_absent',   // a real union member; content below says otherwise
    title: 'Test notification',
    message: 'Push is working. This is the only message of its kind you will get.',
    link: '/',
  })
  const result = await runDeliveries(20)
  res.json({ success: true, data: result })
}))

// ── POST /notifications/run-deliveries ──────────────────────────
// Drains the delivery outbox on demand. Exists because the in-process
// cron does not run on a host that sleeps when idle (design.md §7) — an
// external scheduler can hit this instead. Admin-scoped since it is a
// server-wide operation, not a per-user one.
router.post('/run-deliveries', requireRole('school_admin', 'principal'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const result = await runDeliveries()
    res.json({ success: true, data: result })
  })
)

export default router
