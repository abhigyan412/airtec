import webpush from 'web-push'
import { supabase } from '../db/client'

// ── Delivery outbox (design.md §5.2) ────────────────────────────────
//
// createNotification() writes the in-app row and enqueues `pending`
// delivery rows; nothing calls a provider on the request path. A worker
// claims batches and dispatches them, so a slow or down push service
// never delays the teacher who just saved attendance.
//
// The outbox lives in Postgres rather than Redis deliberately: with
// claim_pending_deliveries() doing FOR UPDATE SKIP LOCKED, we get
// ordering, retries, backoff and multi-instance safety from the database
// already in the stack. Swap the claim query if volume ever justifies it.

const CHANNELS = ['push', 'email'] as const
type Channel = (typeof CHANNELS)[number]

const MAX_ATTEMPTS = 5
/** 1m, 5m, 25m, 2h — capped. Enough to ride out a provider blip. */
const backoffMinutes = (attempts: number) => Math.min(5 ** (attempts - 1), 120)

let vapidReady = false
function configureVapid(): boolean {
  if (vapidReady) return true
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(VAPID_SUBJECT ?? 'mailto:admin@dpslucknow.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  vapidReady = true
  return true
}

/**
 * One `pending` row per (notification, channel) the user hasn't muted.
 *
 * Preferences are opt-out: a row in notification_preferences means muted,
 * so absence means enabled and a new notification type needs no backfill.
 */
export async function enqueueDeliveries(notifications: any[]): Promise<number> {
  if (!notifications.length) return 0

  const userIds = [...new Set(notifications.map(n => n.user_id))]
  const types = [...new Set(notifications.map(n => n.type))]

  const { data: muted } = await supabase
    .from('notification_preferences')
    .select('user_id, type, channel')
    .in('user_id', userIds)
    .in('type', types)
  const mutedKey = new Set((muted ?? []).map((m: any) => `${m.user_id}|${m.type}|${m.channel}`))

  const rows: any[] = []
  for (const n of notifications) {
    for (const channel of CHANNELS) {
      if (mutedKey.has(`${n.user_id}|${n.type}|${channel}`)) continue
      rows.push({ notification_id: n.id, channel })
    }
  }
  if (!rows.length) return 0

  const { error } = await supabase.from('notification_deliveries').insert(rows)
  if (error) { console.error('[delivery] enqueue failed:', error.message); return 0 }
  return rows.length
}

async function settle(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from('notification_deliveries').update(patch).eq('id', id)
  if (error) console.error(`[delivery] settle ${id}: ${error.message}`)
}

async function fail(row: any, message: string) {
  const attempts = row.attempts ?? 1
  if (attempts >= MAX_ATTEMPTS) {
    await settle(row.id, { status: 'failed', last_error: message.slice(0, 500) })
    return
  }
  const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000)
  await settle(row.id, { status: 'pending', last_error: message.slice(0, 500), next_attempt_at: next.toISOString() })
}

/**
 * Returns true only when a push actually reached at least one endpoint.
 * The caller counts real deliveries with it: "processed" and "delivered"
 * are different numbers, and conflating them is how a test-push button
 * reports success while the notification went nowhere.
 */
async function deliverPush(row: any, notification: any): Promise<boolean> {
  if (!configureVapid()) { await settle(row.id, { status: 'skipped', last_error: 'VAPID keys not configured' }); return false }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', notification.user_id)
    .is('failed_at', null)

  if (!subs?.length) { await settle(row.id, { status: 'skipped', last_error: 'no active subscription' }); return false }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.message,
    link: notification.link ?? '/',
    // Collapses repeats of the same alert in the OS tray rather than
    // stacking one per delivery attempt.
    tag: `${notification.type}:${notification.related_entity_id ?? notification.id}`,
  })

  let delivered = 0
  const errors: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
      delivered++
      await supabase.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id)
    } catch (err: any) {
      const status = err?.statusCode
      // 404/410 mean the browser dropped the subscription. That is the
      // normal end of a subscription's life, not an error — retiring it
      // stops every future send from retrying a dead endpoint.
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').update({ failed_at: new Date().toISOString() }).eq('id', sub.id)
      } else {
        errors.push(`${status ?? '?'}: ${err?.message ?? 'unknown'}`)
      }
    }
  }

  if (delivered) { await settle(row.id, { status: 'sent', sent_at: new Date().toISOString() }); return true }
  if (errors.length) { await fail(row, errors.join('; ')); return false }
  // Every subscription was expired — nothing to retry.
  await settle(row.id, { status: 'skipped', last_error: 'all subscriptions expired' })
  return false
}

async function deliverEmail(row: any, _notification: any): Promise<boolean> {
  // No provider wired yet (design.md §8 puts email in phase 3). Marked
  // skipped rather than left pending so the outbox doesn't accumulate rows
  // that can never succeed and the backlog stays an honest signal.
  await settle(row.id, { status: 'skipped', last_error: 'email provider not configured' })
  return false
}

/**
 * Claim a bounded batch and dispatch it. Safe to run concurrently: the
 * claim happens inside a SQL function using FOR UPDATE SKIP LOCKED.
 *
 * `sent` counts deliveries that actually reached a provider, not rows
 * taken off the queue — a batch that is entirely skipped reports 0.
 */
export async function runDeliveries(batchSize = 100): Promise<{ claimed: number; sent: number }> {
  // Return anything a previous crash stranded mid-flight.
  await supabase.rpc('requeue_stale_deliveries', { older_than: '5 minutes' })

  const { data: claimed, error } = await supabase.rpc('claim_pending_deliveries', { batch_size: batchSize })
  if (error) { console.error('[delivery] claim failed:', error.message); return { claimed: 0, sent: 0 } }
  const rows = (claimed ?? []) as any[]
  if (!rows.length) return { claimed: 0, sent: 0 }

  const ids = [...new Set(rows.map(r => r.notification_id))]
  const { data: notifications } = await supabase.from('notifications').select('*').in('id', ids)
  const byId = new Map((notifications ?? []).map((n: any) => [n.id, n]))

  let sent = 0
  for (const row of rows) {
    const notification = byId.get(row.notification_id)
    if (!notification) { await settle(row.id, { status: 'skipped', last_error: 'notification deleted' }); continue }
    try {
      const ok = row.channel === 'push'
        ? await deliverPush(row, notification)
        : await deliverEmail(row, notification)
      if (ok) sent++
    } catch (err: any) {
      await fail(row, err?.message ?? 'unknown error')
    }
  }
  return { claimed: rows.length, sent }
}

/** Fire-and-forget nudge so the common case doesn't wait for the next tick. */
export function kickDeliveries() {
  setImmediate(() => {
    runDeliveries().catch(err => console.error('[delivery] run failed:', err?.message))
  })
}
