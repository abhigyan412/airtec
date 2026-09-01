'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

// ── Web push subscription (design.md §6.2) ──────────────────────────
//
// Duplicated in frontend-portal/lib/usePushSubscription.ts. The split
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
  /** The user (or their admin policy) said no. Only site settings can undo it. */
  | 'permission-denied'

export type PushState = {
  /** Browser can do push at all (has SW + PushManager + Notification). */
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
  supported: false, permission: 'unsupported', subscribed: false, serverKnown: null,
  blocker: 'none', needsHomeScreenInstall: false, shouldOffer: false,
  canEnable: false, busy: false, error: null, ready: false,
}

export function usePushSubscription(app: 'staff' | 'family') {
  const [state, setState] = useState<PushState>(INITIAL)
  // Set once the component unmounts, so a slow probe doesn't setState into
  // a torn-down tree.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

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
        ...s, supported: false, permission: 'unsupported', subscribed: false, serverKnown: null,
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
      ...s, supported: true, permission, subscribed,
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

    // Reconcile with the server. The browser holding a subscription says
    // nothing about whether the row that makes push actually send ever
    // got written — if that POST failed once, this browser reports
    // "notifications on" forever while every push is skipped server-side.
    try {
      const { data } = await api.get('/notifications/push/subscriptions', {
        params: { endpoint: subscription.endpoint },
      })
      let known: boolean = !!data?.data?.thisDevice

      if (!known && !resynced.has(subscription.endpoint)) {
        resynced.add(subscription.endpoint)
        // The register endpoint upserts on endpoint, so re-sending is safe
        // and repairs the mismatch instead of just reporting it.
        await api.post('/notifications/push/subscribe', { subscription: subscription.toJSON(), app })
        known = true
      }
      if (alive.current) setState(s => ({ ...s, serverKnown: known }))
    } catch {
      // Offline or the endpoint is unreachable: leave it unknown rather
      // than claiming either answer.
      if (alive.current) setState(s => ({ ...s, serverKnown: null }))
    }
  }, [app])

  useEffect(() => { refresh() }, [refresh])

  const subscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
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
  }, [app])

  const unsubscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
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
