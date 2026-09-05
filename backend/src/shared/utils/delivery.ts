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

// ── OneSignal (native push inside the Median wrapper) ───────────────
//
// The Median webview has no Web Push API — no PushManager, no
// service-worker push — so a VAPID send can never reach a phone running
// the wrapped app. Those devices register a OneSignal subscription id
// instead and are pushed through APNs/FCM. Two transports, one outbox:
// a delivery row is `sent` if either of them reached a device.

const ONESIGNAL_API = 'https://api.onesignal.com/notifications'

export function oneSignalConfigured(): boolean {
  return !!process.env.ONESIGNAL_APP_ID && !!process.env.ONESIGNAL_REST_API_KEY
}

export function webPushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY
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
 *
 * A user's devices can span both transports at once — a laptop on web
 * push, a phone running the Median app on OneSignal — so this fans out
 * per provider and succeeds if any device was reached.
 */
async function deliverPush(row: any, notification: any): Promise<boolean> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', notification.user_id)
    .is('failed_at', null)

  if (!subs?.length) { await settle(row.id, { status: 'skipped', last_error: 'no active subscription' }); return false }

  const web = subs.filter((s: any) => s.provider !== 'onesignal')
  const native = subs.filter((s: any) => s.provider === 'onesignal')

  const payload = {
    title: notification.title,
    body: notification.message,
    link: notification.link ?? '/',
    // Collapses repeats of the same alert in the OS tray rather than
    // stacking one per delivery attempt.
    tag: `${notification.type}:${notification.related_entity_id ?? notification.id}`,
  }

  let delivered = 0
  let expired = 0
  const errors: string[] = []
  const notes: string[] = []

  const absorb = (r: FanOut) => {
    delivered += r.delivered; expired += r.expired
    errors.push(...r.errors)
    if (r.note) notes.push(r.note)
  }

  if (web.length) {
    if (!webPushConfigured()) errors.push('VAPID keys not configured')
    else if (configureVapid()) absorb(await sendWebPush(web, payload))
  }

  if (native.length) {
    if (!oneSignalConfigured()) errors.push('OneSignal is not configured')
    else absorb(await sendOneSignal(native, payload))
  }

  if (delivered) { await settle(row.id, { status: 'sent', sent_at: new Date().toISOString() }); return true }
  if (errors.length) { await fail(row, errors.join('; ')); return false }
  // Every subscription was expired — nothing to retry.
  if (expired) {
    await settle(row.id, { status: 'skipped', last_error: notes[0] ?? 'all subscriptions expired' })
    return false
  }
  await settle(row.id, { status: 'skipped', last_error: 'no active subscription' })
  return false
}

type FanOut = {
  delivered: number
  expired: number
  /** Retryable failures. A non-empty list makes the delivery row retry. */
  errors: string[]
  /** Why nothing was delivered, when that is not worth retrying. */
  note?: string
}

async function sendWebPush(subs: any[], payload: any): Promise<FanOut> {
  const body = JSON.stringify(payload)
  const out: FanOut = { delivered: 0, expired: 0, errors: [] }

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
      out.delivered++
      await supabase.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id)
    } catch (err: any) {
      const status = err?.statusCode
      // 404/410 mean the browser dropped the subscription. That is the
      // normal end of a subscription's life, not an error — retiring it
      // stops every future send from retrying a dead endpoint.
      if (status === 404 || status === 410) {
        out.expired++
        await supabase.from('push_subscriptions').update({ failed_at: new Date().toISOString() }).eq('id', sub.id)
      } else {
        out.errors.push(`${status ?? '?'}: ${err?.message ?? 'unknown'}`)
      }
    }
  }
  return out
}

/**
 * One REST call for all of this user's app devices. Targeting is by
 * subscription id rather than external_id so a delivery still means "these
 * specific devices" — the same thing a web-push send means — and so a
 * device whose identity was never bound still receives.
 *
 * OneSignal answers 200 with no `id` when the audience turned out empty.
 * That is not an error to retry: it means every id we hold is dead, which
 * is the OneSignal equivalent of a 410.
 */
async function sendOneSignal(subs: any[], payload: any): Promise<FanOut> {
  const out: FanOut = { delivered: 0, expired: 0, errors: [] }
  const ids = subs.map((s: any) => s.endpoint)

  let res: Response
  try {
    res = await fetch(ONESIGNAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${process.env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        include_subscription_ids: ids,
        headings: { en: payload.title },
        contents: { en: payload.body },
        // `targetUrl` in the data payload, NOT OneSignal's `url` field.
        // They look interchangeable and are not: `url` is the Launch URL,
        // which the wrapper hands to a browser — taps opened Chrome,
        // outside the app, signed out, with no JS bridge. `targetUrl` is
        // reserved by Median and navigates the app itself.
        data: { targetUrl: absoluteLink(payload.link) },
        // Same collapse behaviour the web-push payload asks for.
        android_group: payload.tag,
        thread_id: payload.tag,
      }),
    })
  } catch (err: any) {
    out.errors.push(`onesignal: ${err?.message ?? 'request failed'}`)
    return out
  }

  const bodyText = await res.text()
  let json: any = {}
  try { json = bodyText ? JSON.parse(bodyText) : {} } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const detail = json?.errors ? JSON.stringify(json.errors) : bodyText.slice(0, 200)
    out.errors.push(`onesignal ${res.status}: ${detail || 'unknown'}`)
    return out
  }

  // `errors` comes back in two shapes on a 200, and they mean opposite
  // things. An object names specific dead ids; an array is prose about
  // the request as a whole — "All included players are not subscribed"
  // is what an audience of retired devices looks like.
  const errs = json?.errors
  const invalid: string[] = Array.isArray(errs)
    ? []
    : (errs?.invalid_player_ids ?? errs?.invalid_subscription_ids ?? [])
  const messages: string[] = Array.isArray(errs) ? errs.filter((e: any) => typeof e === 'string') : []

  // Ids OneSignal rejected outright. Retire them so every later send
  // stops carrying a dead device.
  if (invalid.length) {
    out.expired += invalid.length
    await supabase.from('push_subscriptions')
      .update({ failed_at: new Date().toISOString() })
      .in('endpoint', invalid)
  }

  const live = ids.filter((id: string) => !invalid.includes(id))

  // A real send always carries a notification id. OneSignal answers 200
  // with an empty one when the audience resolved to nobody, which is its
  // equivalent of a 410 — retrying it forever would never succeed.
  if (json?.id && live.length) {
    out.delivered += live.length
    await supabase.from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .in('endpoint', live)
  } else if (!json?.id) {
    out.expired += live.length
    out.note = messages[0] ?? 'OneSignal accepted the request but reached no device'
  }
  return out
}

/**
 * OneSignal needs somewhere to send the tap; our notifications carry an
 * app-relative path. Falls back to the raw path if no base is configured,
 * which OneSignal treats as no link rather than as an error.
 *
 * APP_BASE_URL is therefore not optional in practice: without it every
 * deep link is relative, and a relative target is not something a native
 * notification can act on.
 */
function absoluteLink(link: string): string {
  if (/^https?:\/\//i.test(link)) return link
  const base = process.env.APP_BASE_URL?.replace(/\/$/, '')
  return base ? `${base}${link.startsWith('/') ? '' : '/'}${link}` : link
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
