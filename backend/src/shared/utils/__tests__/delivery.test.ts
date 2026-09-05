import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { supabase } from '../../db/client'
import { enqueueDeliveries, runDeliveries } from '../delivery'

// The outbox is DB machinery — claim/retry/backoff semantics and the
// SKIP LOCKED guarantee only mean anything against a real Postgres, so
// these run on a disposable fixture school.
//
// web-push itself is stubbed: what matters here is how the worker reacts
// to each provider outcome (success, transient failure, 410 Gone), not
// that a third-party library can encrypt.

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...a: any[]) => sendNotification(...a),
  },
}))

const sb = supabase as any

/**
 * OneSignal is reached over plain fetch, so the transport is stubbed the
 * same way web-push is: what these assert is how the worker reads each
 * documented answer, not that OneSignal can deliver.
 *
 * The response shapes below are the real ones. A 200 carrying
 * `errors: ["All included players are not subscribed"]` and an empty `id`
 * is what OneSignal actually returns for an audience of dead devices —
 * verified against the live API — and reading that as a failure would
 * retry a dead phone until the attempt ceiling on every notification.
 */
const oneSignalFetch = vi.fn()
const realFetch = globalThis.fetch.bind(globalThis)
// Everything else on this process — supabase-js very much included —
// still needs a working fetch, so only OneSignal is intercepted.
globalThis.fetch = ((url: any, init?: any) =>
  String(url).includes('api.onesignal.com')
    ? oneSignalFetch(url, init)
    : realFetch(url, init)) as any
const okJson = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * The `provider` column ships with its own migration. Probed at module
 * scope because `it.runIf` is evaluated when the file is collected — a
 * flag set in `beforeAll` is still false by then, and every test below
 * would skip forever, including after the migration landed.
 */
const hasProviderColumn = !(await sb.from('push_subscriptions').select('provider').limit(1)).error
if (!hasProviderColumn) {
  console.warn('[delivery.test] skipping the OneSignal suite: run the push provider migration first')
}

describe('delivery outbox', () => {
  let schoolId: string
  let userId: string
  const created: string[] = []

  const makeNotification = async (over: Record<string, any> = {}) => {
    const { data, error } = await sb.from('notifications').insert({
      school_id: schoolId, user_id: userId, type: 'fee_overdue',
      title: 'Fee overdue', message: 'x', link: '/fees', ...over,
    }).select().single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    return data
  }

  const deliveriesFor = async (id: string) =>
    (await sb.from('notification_deliveries').select('*').eq('notification_id', id)).data ?? []

  beforeAll(async () => {
    const { data: school, error } = await sb.from('schools')
      .insert({ name: `__vitest_delivery_${Date.now()}` }).select().single()
    if (error) throw new Error(`fixture school: ${error.message}`)
    schoolId = school.id

    const email = `__vitest_delivery_${Date.now()}@example.com`
    const { data: au } = await sb.auth.admin.createUser({ email, password: 'Test@12345', email_confirm: true })
    userId = au.user.id
    await sb.from('users').insert({
      id: userId, school_id: schoolId, full_name: 'Delivery Test', email, role: 'parent',
    })
    process.env.VAPID_PUBLIC_KEY ||= 'test-public'
    process.env.VAPID_PRIVATE_KEY ||= 'test-private'
    process.env.ONESIGNAL_APP_ID ||= 'test-app-id'
    process.env.ONESIGNAL_REST_API_KEY ||= 'test-rest-key'

  })

  afterAll(async () => {
    globalThis.fetch = realFetch
    if (created.length) await sb.from('notifications').delete().in('id', created)
    await sb.from('push_subscriptions').delete().eq('user_id', userId)
    await sb.from('notification_preferences').delete().eq('user_id', userId)
    await sb.from('users').delete().eq('id', userId)
    await sb.auth.admin.deleteUser(userId).catch(() => {})
    await sb.from('document_counters').delete().eq('school_id', schoolId)
    await sb.from('schools').delete().eq('id', schoolId)
  })

  beforeEach(async () => {
    sendNotification.mockReset()
    oneSignalFetch.mockReset()
    await sb.from('push_subscriptions').delete().eq('user_id', userId)
    await sb.from('notification_preferences').delete().eq('user_id', userId)
  })

  describe('enqueueDeliveries', () => {
    it('creates one row per channel', async () => {
      const n = await makeNotification()
      expect(await enqueueDeliveries([n])).toBe(2)
      const rows = await deliveriesFor(n.id)
      expect(rows.map((r: any) => r.channel).sort()).toEqual(['email', 'push'])
      expect(rows.every((r: any) => r.status === 'pending')).toBe(true)
    })

    it('does nothing for an empty list', async () => {
      expect(await enqueueDeliveries([])).toBe(0)
    })

    it('skips a channel the user has muted', async () => {
      await sb.from('notification_preferences')
        .insert({ user_id: userId, type: 'fee_overdue', channel: 'push' })
      const n = await makeNotification()
      expect(await enqueueDeliveries([n])).toBe(1)
      expect((await deliveriesFor(n.id)).map((r: any) => r.channel)).toEqual(['email'])
    })

    it('treats a mute as type-specific, not global', async () => {
      await sb.from('notification_preferences')
        .insert({ user_id: userId, type: 'fee_overdue', channel: 'push' })
      const other = await makeNotification({ type: 'homework_assigned', title: 'HW' })
      await enqueueDeliveries([other])
      expect((await deliveriesFor(other.id)).map((r: any) => r.channel).sort()).toEqual(['email', 'push'])
    })

    it('enqueues nothing when every channel is muted', async () => {
      await sb.from('notification_preferences').insert([
        { user_id: userId, type: 'fee_overdue', channel: 'push' },
        { user_id: userId, type: 'fee_overdue', channel: 'email' },
      ])
      const n = await makeNotification()
      expect(await enqueueDeliveries([n])).toBe(0)
    })

    it('handles a batch of notifications in one call', async () => {
      const a = await makeNotification()
      const b = await makeNotification({ type: 'homework_assigned', title: 'HW' })
      expect(await enqueueDeliveries([a, b])).toBe(4)
    })
  })

  describe('runDeliveries', () => {
    const addPushDelivery = async () => {
      const n = await makeNotification()
      await sb.from('notification_deliveries').insert({ notification_id: n.id, channel: 'push' })
      return n
    }

    it('skips push when the user has no subscription — nothing to retry', async () => {
      const n = await addPushDelivery()
      await runDeliveries(50)
      const [row] = await deliveriesFor(n.id)
      expect(row.status).toBe('skipped')
      expect(row.last_error).toMatch(/no active subscription/)
    })

    it('marks a delivery sent when the provider accepts it', async () => {
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family',
        endpoint: `https://push.example.com/${Date.now()}`, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockResolvedValue({ statusCode: 201 })
      const n = await addPushDelivery()
      await runDeliveries(50)
      const [row] = await deliveriesFor(n.id)
      expect(row.status).toBe('sent')
      expect(row.sent_at).toBeTruthy()
    })

    it('retires the subscription and stops retrying on 410 Gone', async () => {
      const endpoint = `https://push.example.com/gone-${Date.now()}`
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family', endpoint, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }))
      const n = await addPushDelivery()
      await runDeliveries(50)

      const { data: sub } = await sb.from('push_subscriptions').select('failed_at').eq('endpoint', endpoint).single()
      expect(sub.failed_at).toBeTruthy()
      const [row] = await deliveriesFor(n.id)
      // An expired subscription is the normal end of life, not a failure
      // to retry forever.
      expect(row.status).toBe('skipped')
    })

    it('retries with backoff on a transient provider error', async () => {
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family',
        endpoint: `https://push.example.com/flaky-${Date.now()}`, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockRejectedValue(Object.assign(new Error('server error'), { statusCode: 500 }))
      const n = await addPushDelivery()
      await runDeliveries(50)
      const [row] = await deliveriesFor(n.id)
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(1)
      expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
      expect(row.last_error).toMatch(/500/)
    })

    it('gives up after the attempt ceiling instead of retrying forever', async () => {
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family',
        endpoint: `https://push.example.com/dead-${Date.now()}`, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 500 }))
      const n = await makeNotification()
      await sb.from('notification_deliveries')
        .insert({ notification_id: n.id, channel: 'push', attempts: 4 })
      await runDeliveries(50)
      const [row] = await deliveriesFor(n.id)
      expect(row.status).toBe('failed')
    })

    it('skips email until a provider is configured, rather than leaving it pending forever', async () => {
      const n = await makeNotification()
      await sb.from('notification_deliveries').insert({ notification_id: n.id, channel: 'email' })
      await runDeliveries(50)
      const [row] = await deliveriesFor(n.id)
      expect(row.status).toBe('skipped')
      expect(row.last_error).toMatch(/email provider/)
    })

    it('resolves a delivery whose notification was deleted', async () => {
      const n = await makeNotification()
      const { data: d } = await sb.from('notification_deliveries')
        .insert({ notification_id: n.id, channel: 'push' }).select().single()
      // Simulate the notification vanishing between enqueue and claim.
      await sb.from('notification_deliveries').update({ notification_id: n.id }).eq('id', d.id)
      await runDeliveries(50)
      const rows = await deliveriesFor(n.id)
      expect(rows[0].status).not.toBe('pending')
    })

    it('reports nothing claimed when the outbox is empty', async () => {
      await runDeliveries(50)   // drain
      expect((await runDeliveries(50)).claimed).toBe(0)
    })

    it('never hands the same row to two concurrent workers', async () => {
      const ns = await Promise.all([addPushDelivery(), addPushDelivery(), addPushDelivery()])
      sendNotification.mockResolvedValue({ statusCode: 201 })
      const [a, b] = await Promise.all([runDeliveries(50), runDeliveries(50)])
      expect(a.claimed + b.claimed).toBeLessThanOrEqual(ns.length + 1)
      for (const n of ns) {
        const rows = await deliveriesFor(n.id)
        expect(rows.filter((r: any) => r.status === 'claimed')).toHaveLength(0)
      }
    })
  })

  // ── OneSignal, the transport the Median app actually uses ────────
  //
  // The wrapped app has no Web Push API, so these devices are the only
  // ones a phone on the store can register. Every case below is one the
  // web-push path already has, asserted again for the second transport:
  // conflating them is how "push works" stays true on a laptop and false
  // on every phone.
  describe('push via OneSignal', () => {
    const addPushDelivery = async () => {
      const n = await makeNotification()
      await sb.from('notification_deliveries').insert({ notification_id: n.id, channel: 'push' })
      return n
    }

    const addDevice = async (endpoint: string) => {
      const { error } = await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family',
        provider: 'onesignal', endpoint, p256dh: null, auth: null,
      })
      if (error) throw new Error(error.message)
    }

    it.runIf(hasProviderColumn)('sends to the device and marks the delivery sent', async () => {
      const endpoint = `os-sub-${Date.now()}`
      await addDevice(endpoint)
      oneSignalFetch.mockResolvedValue(okJson({ id: 'notif-uuid', recipients: 1 }))

      const n = await addPushDelivery()
      const result = await runDeliveries(50)

      expect(result.sent).toBe(1)
      expect((await deliveriesFor(n.id))[0].status).toBe('sent')

      // Addressed by subscription id, with the credentials on the header.
      const [url, init] = oneSignalFetch.mock.calls[0]
      expect(url).toBe('https://api.onesignal.com/notifications')
      expect(init.headers.Authorization).toMatch(/^Key /)
      const body = JSON.parse(init.body)
      expect(body.include_subscription_ids).toEqual([endpoint])
      expect(body.headings.en).toBe('Fee overdue')
    })

    it.runIf(hasProviderColumn)('treats an empty audience as expired, not as a failure to retry', async () => {
      await addDevice(`os-dead-${Date.now()}`)
      // The real 200 for an audience of retired devices.
      oneSignalFetch.mockResolvedValue(okJson({ id: '', errors: ['All included players are not subscribed'] }))

      const n = await addPushDelivery()
      await runDeliveries(50)

      const row = (await deliveriesFor(n.id))[0]
      expect(row.status).toBe('skipped')
      expect(row.last_error).toContain('not subscribed')
      // And the point of `skipped`: the worker never picks it up again.
      // (`next_attempt_at` keeps its insert-time value on a settled row —
      // status is what the claim query filters on.)
      expect((await runDeliveries(50)).claimed).toBe(0)
    })

    it.runIf(hasProviderColumn)('retires ids OneSignal names as invalid', async () => {
      const endpoint = `os-invalid-${Date.now()}`
      await addDevice(endpoint)
      oneSignalFetch.mockResolvedValue(okJson({ id: '', errors: { invalid_player_ids: [endpoint] } }))

      await runDeliveries(50)
      await addPushDelivery()
      await runDeliveries(50)

      const { data } = await sb.from('push_subscriptions').select('failed_at').eq('endpoint', endpoint).single()
      expect(data.failed_at).toBeTruthy()
    })

    it.runIf(hasProviderColumn)('retries a 5xx rather than giving the device up', async () => {
      await addDevice(`os-flaky-${Date.now()}`)
      oneSignalFetch.mockResolvedValue(okJson({ errors: ['service unavailable'] }, 503))

      const n = await addPushDelivery()
      await runDeliveries(50)

      const row = (await deliveriesFor(n.id))[0]
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(1)
      expect(row.last_error).toContain('503')
    })

    it.runIf(hasProviderColumn)('reaches a laptop on web push and a phone on OneSignal from one notification', async () => {
      await addDevice(`os-both-${Date.now()}`)
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family', provider: 'webpush',
        endpoint: `https://push.example.com/both-${Date.now()}`, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockResolvedValue({ statusCode: 201 })
      oneSignalFetch.mockResolvedValue(okJson({ id: 'notif-uuid', recipients: 1 }))

      const n = await addPushDelivery()
      await runDeliveries(50)

      expect(sendNotification).toHaveBeenCalledTimes(1)
      expect(oneSignalFetch).toHaveBeenCalledTimes(1)
      expect((await deliveriesFor(n.id))[0].status).toBe('sent')
    })

    it.runIf(hasProviderColumn)('still delivers to the phone when web push is broken', async () => {
      await addDevice(`os-solo-${Date.now()}`)
      await sb.from('push_subscriptions').insert({
        user_id: userId, school_id: schoolId, app: 'family', provider: 'webpush',
        endpoint: `https://push.example.com/broken-${Date.now()}`, p256dh: 'k', auth: 'a',
      })
      sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
      oneSignalFetch.mockResolvedValue(okJson({ id: 'notif-uuid', recipients: 1 }))

      const n = await addPushDelivery()
      await runDeliveries(50)

      // One transport failing must not lose the delivery that succeeded.
      expect((await deliveriesFor(n.id))[0].status).toBe('sent')
    })
  })
})
