'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import {
  enableForegroundNotifications, grantPrivacyConsent, medianReady,
  oneSignalInfo, oneSignalLogin, oneSignalLogout, oneSignalRegister,
} from './median'

// ── Web push subscription (design.md §6.2) ──────────────────────────
//
// Duplicated in frontend/lib/usePushSubscription.ts. The split
// accepted duplication for the API client; this file is the one where
// drift is genuinely dangerous, because a divergent copy fails by
// notifications silently not arriving rather than by a visible error.
// Keep the two in sync — see NOTIFICATIONS.md.
//
// Every state this hook can be in has to be *nameable*. The first version
// collapsed "this browser can't do push" into a single `supported: false`,
// the prompt rendered null on it, and the result was a feature that was
// dead on every phone with no error anywhere — not in the UI, not in the
// console, not in the delivery outbox beyond a terse "no active
// subscription". `blocker` exists so the UI can always say which wall it
// hit.

const DISMISSED_KEY = 'airtec_push_prompt_dismissed_at'
/** Re-offer at most once a month. Nagging is how people hit "Block". */
const REOFFER_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export type PushBlocker =
  | 'none'
  /** iOS Safari in a tab. pushManager does not exist until Add to Home Screen. */
  | 'ios-needs-install'
  /** Served over plain http from something other than localhost. */
  | 'insecure-context'
  /** Secure, not iOS, still no service worker or PushManager. */
  | 'unsupported-browser'
  /**
   * Inside the Median app, where push is native and the OS permission is
   * off. Distinct from 'permission-denied' because it is recoverable from
   * the phone's own settings, and because the browser advice under
   * 'unsupported-browser' is actively wrong here.
   */
  | 'median-push-off'
  /** The user (or their admin policy) said no. Only site settings can undo it. */
  | 'permission-denied'

export type PushState = {
  /**
   * How this device receives push. The Median app has no Web Push API at
   * all, so it registers a OneSignal subscription id instead; every state
   * below means the same thing either way, which is what lets the UI stay
   * ignorant of the split.
   */
  transport: 'webpush' | 'onesignal'
  /** This device can do push at all. */
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  /** This browser holds a PushSubscription. */
  subscribed: boolean
  /**
   * Whether the server has a row for this browser's subscription.
   * `null` until the check completes. A `true`/`false` split from
   * `subscribed` is the exact bug this hook was blind to: the browser is
   * subscribed, the server has nothing, and every push is skipped.
   */
  serverKnown: boolean | null
  /** The one reason push cannot be switched on right now, if there is one. */
  blocker: PushBlocker
  /** Back-compat alias for `blocker === 'ios-needs-install'`. */
  needsHomeScreenInstall: boolean
  /** True when it's reasonable to show our own pre-prompt card. */
  shouldOffer: boolean
  /** Subscribing is possible from here — the button will do something. */
  canEnable: boolean
  busy: boolean
  error: string | null
  /** The first probe has finished; before this the state is all defaults. */
  ready: boolean
}

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; the touch check disambiguates.
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1))

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true)

/**
 * Service workers — and therefore push — exist only in a secure context.
 * `localhost` counts; `http://192.168.1.x:3000` does not, which is how a
 * feature that works on the dev laptop is missing on the phone testing
 * against that same laptop.
 */
const isSecure = () =>
  typeof window !== 'undefined' &&
  (window.isSecureContext ?? location.protocol === 'https:')

/** Human-readable text for each wall, and what to do about it. */
export function describeBlocker(blocker: PushBlocker): { title: string; detail: string } | null {
  switch (blocker) {
    case 'ios-needs-install':
      return {
        title: 'Add this app to your home screen first',
        detail: 'iPhone and iPad only deliver notifications to an installed app. Tap Share, then Add to Home Screen, and open it from the new icon.',
      }
    case 'insecure-context':
      return {
        title: 'Not available over an insecure connection',
        detail: `Notifications need HTTPS. This page is on ${typeof location !== 'undefined' ? location.protocol + '//' + location.host : 'an http address'}, so the browser blocks them. Open the site over https to switch them on.`,
      }
    case 'unsupported-browser':
      return {
        title: 'This browser cannot show notifications',
        detail: 'It has no push support — or it is in a private window, where push is disabled. Try a normal window in Chrome, Edge, Firefox or Safari.',
      }
    case 'median-push-off':
      return {
        title: 'Notifications are switched off for this app',
        detail: 'Open your phone\u2019s Settings, find this app under Notifications, and allow them \u2014 then come back and switch this on.',
      }
    case 'permission-denied':
      return {
        title: 'Notifications are blocked for this site',
        detail: 'The browser will not ask again. Re-allow them in the address-bar site settings (the lock or ⓘ icon), then come back and switch this on.',
      }
    default:
      return null
  }
}

/** VAPID keys travel as base64url but subscribe() wants a Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

/** Whatever the server said went wrong, preferred over axios's own prose. */
function messageFor(err: any, fallback: string): string {
  return err?.response?.data?.error ?? err?.message ?? fallback
}

/**
 * Endpoints this page load has already re-synced, so a hook mounted in
 * several places doesn't re-POST the same subscription once per mount.
 */
const resynced = new Set<string>()

const INITIAL: PushState = {
  transport: 'webpush',
  supported: false, permission: 'unsupported', subscribed: false, serverKnown: null,
  blocker: 'none', needsHomeScreenInstall: false, shouldOffer: false,
  canEnable: false, busy: false, error: null, ready: false,
}

export function usePushSubscription(app: 'staff' | 'family') {
  const [state, setState] = useState<PushState>(INITIAL)
  // Only so OneSignal can label the device with our user id. Delivery
  // never depends on it, so a missing user must not stop push working.
  const { user } = useAuth()
  const userId = user?.id ?? null
  // Set once the component unmounts, so a slow probe doesn't setState into
  // a torn-down tree.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  /**
   * Reconcile one device id with the server, whichever transport made it.
   * Returns what the server believes, or null when we could not ask.
   *
   * The browser (or the OS) holding a subscription proves nothing on its
   * own: if the POST that registers it ever failed, this device reports
   * "on" while the server has no row and every push is silently skipped.
   */
  const reconcile = useCallback(async (
    endpoint: string,
    register: () => Promise<void>,
  ): Promise<boolean | null> => {
    try {
      const { data } = await api.get('/notifications/push/subscriptions', { params: { endpoint } })
      let known: boolean = !!data?.data?.thisDevice
      if (!known && !resynced.has(endpoint)) {
        resynced.add(endpoint)
        // Registration upserts on endpoint, so re-sending is safe and
        // repairs the mismatch instead of just reporting it.
        await register()
        known = true
      }
      return known
    } catch {
      // Offline or the endpoint is unreachable: leave it unknown rather
      // than claiming either answer.
      return null
    }
  }, [])

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return

    const webPushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

    // ── Native (Median app) ──────────────────────────────────────
    // Checked first and unconditionally preferred: a WebView that one day
    // ships PushManager still should not be routed through a web push
    // service when the wrapper has a real APNs/FCM connection.
    //
    // The second attempt is the one that matters in the app. A quick
    // no-hint miss is cheap to be wrong about *unless* the fallback
    // verdict would be 'unsupported-browser' — the one answer that is
    // both false inside the app and useless everywhere ("install
    // Chrome"). An iPhone in a Safari tab has a better answer already, so
    // it is not made to wait; nor is an insecure origin.
    const worthWaiting = !webPushable && !(isIOS() && !isStandalone()) && isSecure()
    const median = (await medianReady())
      ?? (worthWaiting ? await medianReady({ force: true, timeoutMs: 2500 }) : null)

    if (median) {
      const info = await oneSignalInfo()
      const deviceId = info?.deviceId ?? null
      const optedIn = !!info?.optedIn

      if (!alive.current) return
      // Only claim the OS said no when the device is registered and still
      // not allowed. Before registration there is nothing to report but
      // "off" — saying "switched off in Settings" to someone who has
      // never been asked sends them to a screen that already looks right.
      const blocker: PushBlocker = deviceId && !optedIn ? 'median-push-off' : 'none'
      setState(s => ({
        ...s, transport: 'onesignal', supported: true,
        permission: optedIn ? 'granted' : 'default',
        subscribed: optedIn && !!deviceId,
        blocker, needsHomeScreenInstall: false,
        canEnable: !optedIn,
        ready: true,
        shouldOffer: !optedIn && blocker === 'none' && !recentlyDismissed(),
      }))

      if (!deviceId || !optedIn) {
        if (alive.current) setState(s => ({ ...s, serverKnown: null }))
        return
      }
      // Session-scoped in the app, so it is asserted on every probe.
      await enableForegroundNotifications()

      const known = await reconcile(deviceId, () =>
        api.post('/notifications/push/subscribe', { provider: 'onesignal', subscriptionId: deviceId, app })
          .then(() => undefined))
      if (alive.current) setState(s => ({ ...s, serverKnown: known }))
      return
    }

    // ── Web push (a real browser) ────────────────────────────────
    const supported = webPushable

    if (!supported) {
      // Order matters: an iPhone in a Safari tab is *also* missing the
      // APIs, and "add to home screen" is the useful thing to say — not
      // "your browser is unsupported".
      const blocker: PushBlocker =
        isIOS() && !isStandalone() ? 'ios-needs-install'
          : !isSecure() ? 'insecure-context'
            : 'unsupported-browser'

      if (!alive.current) return
      setState(s => ({
        ...s, transport: 'webpush',
        supported: false, permission: 'unsupported', subscribed: false, serverKnown: null,
        blocker, needsHomeScreenInstall: blocker === 'ios-needs-install',
        canEnable: false, ready: true,
        // Worth telling an iPhone user how to enable this; pointless on a
        // browser that simply can't do push.
        shouldOffer: blocker === 'ios-needs-install' && !recentlyDismissed(),
      }))
      return
    }

    const permission = Notification.permission
    let subscription: PushSubscription | null = null
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      subscription = (await reg?.pushManager.getSubscription()) ?? null
    } catch { /* registration not ready yet */ }

    const subscribed = !!subscription
    const blocker: PushBlocker = permission === 'denied' ? 'permission-denied' : 'none'

    if (!alive.current) return
    setState(s => ({
      ...s, transport: 'webpush', supported: true, permission, subscribed,
      blocker, needsHomeScreenInstall: false,
      canEnable: blocker === 'none' && !subscribed,
      ready: true,
      // Never re-ask after an explicit browser denial: the browser won't
      // show the dialog again, so our card would be a dead end.
      shouldOffer: permission === 'default' && !subscribed && !recentlyDismissed(),
    }))

    if (!subscription) {
      if (alive.current) setState(s => ({ ...s, serverKnown: null }))
      return
    }

    const known = await reconcile(subscription.endpoint, () =>
      api.post('/notifications/push/subscribe', { subscription: subscription!.toJSON(), app })
        .then(() => undefined))
    if (alive.current) setState(s => ({ ...s, serverKnown: known }))
  }, [app, reconcile])

  useEffect(() => { refresh() }, [refresh])

  const subscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      // ── Native (Median app) ────────────────────────────────────
      // Same two-stage resolution as refresh(): by the time someone taps
      // Turn on we have already decided this is the app, so waiting is
      // correct rather than merely affordable.
      if (await medianReady() ?? await medianReady({ force: true, timeoutMs: 2500 })) {
        // Prompts the OS. Already-granted is a no-op, so this is also the
        // repair path for a device that was opted out and has since been
        // re-allowed in phone settings.
        // Consent first: while OneSignal is waiting on it there is no
        // device id to read, and the app looks identical to one the user
        // has denied. No-op unless the build requires it.
        const before = await oneSignalInfo()
        if (before?.requiresPrivacyConsent) await grantPrivacyConsent()

        await oneSignalRegister()
        if (userId) await oneSignalLogin(userId)

        const info = await oneSignalInfo()
        const deviceId = info?.deviceId
        const optedIn = !!info?.optedIn

        if (!deviceId || !optedIn) {
          // The OS said no, or OneSignal has not finished registering the
          // device. Both are "not on", and neither is our error to retry.
          setState(s => ({
            ...s, busy: false, subscribed: false, canEnable: true, shouldOffer: false,
            blocker: 'median-push-off',
          }))
          return false
        }

        await enableForegroundNotifications()
        await api.post('/notifications/push/subscribe', {
          provider: 'onesignal', subscriptionId: deviceId, app,
        })
        resynced.add(deviceId)
        setState(s => ({
          ...s, busy: false, subscribed: true, serverKnown: true,
          permission: 'granted', blocker: 'none', canEnable: false, shouldOffer: false,
        }))
        return true
      }

      // navigator.serviceWorker.ready never settles if nothing ever
      // registers a worker, which would hang this button forever with no
      // explanation. Bound the wait and say so.
      const reg = await withTimeout(
        navigator.serviceWorker.ready,
        10_000,
        'The app\'s background worker did not start, so notifications cannot be switched on. Reload the page and try again.',
      )

      // Ask the browser only after the user accepted our own card.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(s => ({
          ...s, busy: false, permission, shouldOffer: false,
          blocker: permission === 'denied' ? 'permission-denied' : s.blocker,
          canEnable: permission === 'default',
          error: permission === 'denied'
            ? 'You blocked notifications for this site. Re-allow them in the browser\'s site settings to switch this on.'
            : null,
        }))
        return false
      }

      const { data } = await api.get('/notifications/vapid-public-key')
      const publicKey: string = data?.data?.publicKey
      if (!publicKey) throw new Error('Push is not configured on the server')

      const existing = await reg.pushManager.getSubscription()
      const subscription = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,     // required by Chrome; we never send silent pushes
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      // If this throws, the browser is subscribed and the server is not —
      // so surface it rather than reporting success. refresh() would
      // otherwise repair it on the next mount, but the user deserves to
      // know now that nothing will arrive.
      await api.post('/notifications/push/subscribe', { subscription: subscription.toJSON(), app })
      resynced.add(subscription.endpoint)

      setState(s => ({
        ...s, busy: false, subscribed: true, serverKnown: true,
        permission: 'granted', blocker: 'none', canEnable: false, shouldOffer: false,
      }))
      return true
    } catch (err: any) {
      setState(s => ({ ...s, busy: false, error: messageFor(err, 'Could not enable notifications') }))
      return false
    }
  }, [app, userId])

  const unsubscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      // ── Native (Median app) ────────────────────────────────────
      // The OS permission is the user's to revoke, not ours; what we can
      // do is stop addressing this device and unbind the identity, which
      // is what "off" has to mean here.
      if (await medianReady()) {
        const info = await oneSignalInfo()
        const deviceId = info?.deviceId
        if (deviceId) {
          await api.delete('/notifications/push/subscribe', { data: { endpoint: deviceId } })
          resynced.delete(deviceId)
        }
        await oneSignalLogout()
        setState(s => ({ ...s, busy: false, subscribed: false, serverKnown: null, canEnable: true }))
        return
      }

      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await api.delete('/notifications/push/subscribe', { data: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
        resynced.delete(sub.endpoint)
      }
      setState(s => ({ ...s, busy: false, subscribed: false, serverKnown: null, canEnable: s.blocker === 'none' }))
    } catch (err: any) {
      setState(s => ({ ...s, busy: false, error: messageFor(err, 'Could not turn off notifications') }))
    }
  }, [])

  /**
   * Ask the server to push one notification to this account right now.
   * Resolves to what actually happened, not to whether the request
   * succeeded — the endpoint reports the delivery row's own status, so a
   * push that was skipped comes back as `delivered: false` with a reason.
   */
  const sendTest = useCallback(async (): Promise<{ delivered: boolean; reason: string | null }> => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      const { data } = await api.post('/notifications/test-push')
      const result = data?.data ?? {}
      setState(s => ({ ...s, busy: false }))
      return { delivered: !!result.delivered, reason: result.reason ?? null }
    } catch (err: any) {
      const reason = messageFor(err, 'The test notification could not be sent')
      setState(s => ({ ...s, busy: false, error: reason }))
      return { delivered: false, reason }
    }
  }, [])

  /** Dismissing costs nothing and is re-offered later; a denial can't be. */
  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* private mode */ }
    setState(s => ({ ...s, shouldOffer: false }))
  }, [])

  return { ...state, subscribe, unsubscribe, sendTest, dismiss, refresh }
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) ?? 0)
    return at > 0 && Date.now() - at < REOFFER_AFTER_MS
  } catch {
    return false
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}
