'use client'

// ── The Median wrapper, and why push needs a second transport ────────
//
// Duplicated in frontend-portal/lib/median.ts — same reasoning as
// usePushSubscription.ts, which is the only consumer.
//
// The app on the stores is this site inside a native WebView built by
// median.co. A WebView has no Web Push API: no PushManager, no
// service-worker push, on either platform. So `'PushManager' in window`
// is false in the app and always will be, and the push code read that as
// "this browser is too old" and told people to go and install Chrome —
// inside an app where installing a browser would not have helped.
//
// Median pushes natively through OneSignal to APNs/FCM instead, driven
// from the page by an injected `window.median` bridge. This module is the
// whole of our contact with it: detection, and the four OneSignal calls
// the notification UI needs. Everything here answers falsy in a normal
// browser, so callers can ask unconditionally.

type OneSignalSubscription = { id?: string; token?: string; optedIn?: boolean }

/** What `median.onesignal.onesignalInfo()` resolves to. */
export type MedianOneSignalInfo = {
  /** OneSignal's own user id. Not what we address devices by. */
  oneSignalId?: string
  /** Whatever we last passed to `login()` — our user id. */
  externalId?: string
  /** The device. `id` is what a send is addressed to. */
  subscription?: OneSignalSubscription
  requiresUserPrivacyConsent?: boolean
}

declare global {
  interface Window {
    median?: any
    /** Pre-rename builds. Median still ships it as an alias. */
    gonative?: any
    median_library_ready?: () => void
    gonative_library_ready?: () => void
  }
}

/**
 * Median's default user agent carries the app name; the bridge object is
 * the stronger signal but is injected a beat after first paint. Either is
 * enough to decide it is worth *waiting* for the bridge.
 */
const UA_HINT = /\bmedian\b|\bgonative\b/i

export function inMedianApp(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.median || !!window.gonative || UA_HINT.test(navigator.userAgent)
}

function bridge(): any | null {
  if (typeof window === 'undefined') return null
  return window.median ?? window.gonative ?? null
}

let readyOnce: Promise<any | null> | null = null

/**
 * The bridge, once it can actually be called — or null in a normal
 * browser.
 *
 * Median's documented signal is a global `median_library_ready()` it
 * calls after injection, so this wraps rather than overwrites any handler
 * already on the page. It also polls, because a page that loads *after*
 * injection never sees that callback fire and would otherwise wait out
 * the timeout for a bridge already sitting in `window`.
 *
 * Without a hint this answers immediately, because making every desktop
 * wait seconds before push can be probed would trade one broken platform
 * for a slow one. But the hint is only a hint: the user agent is
 * configurable in App Studio and may say nothing about Median, and the
 * bridge is injected a beat after first paint. So `force` exists for the
 * one caller that can afford to wait — the code path that is otherwise
 * about to tell someone their browser cannot do notifications at all.
 * Being slow there is free; being wrong there is the whole bug.
 */
export function medianReady(
  { timeoutMs = 4000, force = false }: { timeoutMs?: number; force?: boolean } = {},
): Promise<any | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (readyOnce) return readyOnce

  // A negative answer from the fast path is not worth remembering: it may
  // only mean "no hint yet", and a later forced call must be free to wait.
  if (!force && !inMedianApp() && !bridge()?.onesignal) return Promise.resolve(null)

  readyOnce = new Promise(resolve => {
    if (bridge()?.onesignal) return resolve(bridge())

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      resolve(bridge())
    }

    const chain = (key: 'median_library_ready' | 'gonative_library_ready') => {
      const prev = window[key]
      window[key] = () => { try { prev?.() } finally { finish() } }
    }
    chain('median_library_ready')
    chain('gonative_library_ready')

    const poll = setInterval(() => { if (bridge()?.onesignal) finish() }, 200)
    const timer = setTimeout(finish, timeoutMs)
  }).then(b => {
    // Only a real bridge is worth caching. Caching a miss would mean one
    // early probe, before injection, permanently decides this is not an
    // app — and no later call could ever recover.
    if (!b) readyOnce = null
    return b
  })
  return readyOnce
}

/** The bridge if this is a Median app with OneSignal wired up, else null. */
export async function oneSignal(): Promise<any | null> {
  const b = await medianReady()
  return b?.onesignal ?? null
}

/**
 * Device + identity as OneSignal currently sees them.
 *
 * Median documents three ways to read this; the promise is the newest.
 * Older builds only call a global, so fall back to that rather than
 * reporting "no push" on an app that merely predates the promise API.
 */
export async function oneSignalInfo(timeoutMs = 5000): Promise<MedianOneSignalInfo | null> {
  const os = await oneSignal()
  if (!os) return null

  if (typeof os.onesignalInfo === 'function') {
    try { return await os.onesignalInfo() } catch { /* fall through to the callback form */ }
  }

  if (typeof os.info !== 'function') return null
  return new Promise<MedianOneSignalInfo | null>(resolve => {
    const key = '__airtecOneSignalInfo'
    let settled = false
    const finish = (v: MedianOneSignalInfo | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { delete (window as any)[key] } catch { /* non-configurable */ }
      resolve(v)
    }
    ;(window as any)[key] = (data: MedianOneSignalInfo) => finish(data ?? null)
    const timer = setTimeout(() => finish(null), timeoutMs)
    try { os.info({ callback: key }) } catch { finish(null) }
  })
}

/** Ask the OS for notification permission. No-op outside the app. */
export async function oneSignalRegister(): Promise<void> {
  const os = await oneSignal()
  await os?.register?.()
}

/**
 * Bind this device to our user, so a notification can also be addressed
 * by external id from the OneSignal dashboard. Delivery does not depend
 * on it — the server addresses subscription ids — but without it every
 * device in OneSignal is anonymous, which makes debugging one user's
 * missing notification guesswork.
 */
export async function oneSignalLogin(externalId: string): Promise<void> {
  const os = await oneSignal()
  await os?.login?.(externalId)
}

export async function oneSignalLogout(): Promise<void> {
  const os = await oneSignal()
  await os?.logout?.()
}
