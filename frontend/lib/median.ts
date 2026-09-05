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

/**
 * Median ships two different OneSignal integrations and the bridge
 * reports a different object for each — this is the shape mismatch that
 * made "Turn on" fail on a device where push was working fine.
 *
 * v5 (user-centric, Median's default) returns a nested subscription:
 *     { oneSignalId, externalId, subscription: { id, token, optedIn } }
 *
 * Legacy Mode (iOS v3 / Android v4 SDK) returns a flat, device-centric
 * object where the Player ID plays the part of the subscription id:
 *     { oneSignalUserId, oneSignalPushToken, oneSignalSubscribed }
 *
 * Which one a build speaks is decided in App Studio, not by us, and an
 * app can be migrated between them without the site being rebuilt. So
 * nothing above this line is allowed to care: both are normalised to one
 * shape, and `legacy` is inferred from the fields actually present
 * rather than from the `legacy` flag, which the docs' own example
 * contradicts.
 */
export type OneSignalDevice = {
  /** Subscription id (v5) or Player ID (legacy). What a send addresses. */
  deviceId: string | null
  /** Whatever identity we last bound — our user id. */
  externalId: string | null
  /** The device is registered AND allowed to show notifications. */
  optedIn: boolean
  /** OneSignal is waiting on consent before it will initialise at all. */
  requiresPrivacyConsent: boolean
  legacy: boolean
}

function normalise(raw: any): OneSignalDevice | null {
  if (!raw || typeof raw !== 'object') return null
  const legacy = 'oneSignalUserId' in raw || 'oneSignalSubscribed' in raw
  return legacy
    ? {
        deviceId: raw.oneSignalUserId || null,
        externalId: raw.externalId || null,
        // Only the flag. An earlier version also inferred consent from the
        // Player ID being present, on the strength of a doc line saying
        // the id is withheld when the prompt is declined — but that is an
        // iOS behaviour. Android issues a Player ID regardless of
        // permission, so the inference reported "On" for a device
        // OneSignal itself classed as never subscribed, and the panel
        // said push was working while nothing could arrive.
        optedIn: raw.oneSignalSubscribed === true,
        requiresPrivacyConsent: raw.oneSignalRequiresUserPrivacyConsent === true,
        legacy: true,
      }
    : {
        deviceId: raw.subscription?.id || null,
        externalId: raw.externalId || null,
        optedIn: raw.subscription?.optedIn === true,
        requiresPrivacyConsent: raw.requiresUserPrivacyConsent === true,
        legacy: false,
      }
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
 * Device + identity as OneSignal currently sees them, normalised across
 * both integrations.
 *
 * Median documents three ways to read this; the promise is the newest.
 * Older builds only call a global, so fall back to that rather than
 * reporting "no push" on an app that merely predates the promise API.
 */
export async function oneSignalInfo(timeoutMs = 5000): Promise<OneSignalDevice | null> {
  const os = await oneSignal()
  if (!os) return null

  if (typeof os.onesignalInfo === 'function') {
    try {
      const raw = await os.onesignalInfo()
      if (raw) return normalise(raw)
    } catch { /* fall through to the callback form */ }
  }

  if (typeof os.info !== 'function') return null
  return new Promise<OneSignalDevice | null>(resolve => {
    const key = '__airtecOneSignalInfo'
    let settled = false
    const finish = (v: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { delete (window as any)[key] } catch { /* non-configurable */ }
      resolve(normalise(v))
    }
    ;(window as any)[key] = (data: any) => finish(data)
    const timer = setTimeout(() => finish(null), timeoutMs)
    try { os.info({ callback: key }) } catch { finish(null) }
  })
}

/**
 * Poll until the device is actually subscribed, or give up.
 *
 * register() resolves when the OS prompt is answered, not when OneSignal
 * has finished registering the subscription with its own servers — that
 * is a network round trip afterwards. Reading the device once, straight
 * after register(), catches the pre-registration state on a perfectly
 * healthy phone and reports it as a refusal. Answering "notifications
 * are switched off" to someone who has just granted them is the worst
 * available answer, so wait for the state to settle before concluding
 * anything.
 *
 * Returns the last reading either way, so the caller can tell a genuine
 * refusal (a device id, still not opted in) from a build that never got
 * far enough to have one.
 */
export async function waitForPushOptIn(timeoutMs = 8000): Promise<OneSignalDevice | null> {
  const deadline = Date.now() + timeoutMs
  let last: OneSignalDevice | null = null
  for (;;) {
    last = await oneSignalInfo()
    if (last?.optedIn && last.deviceId) return last
    if (Date.now() >= deadline) return last
    await new Promise(r => setTimeout(r, 400))
  }
}

/**
 * OneSignal will not initialise — no device id, no token, nothing — while
 * it is waiting on consent, and an app configured that way looks
 * identical from here to one the user has denied. Granting is only ever
 * reached from an explicit "Turn on", so the consent is real.
 */
export async function grantPrivacyConsent(): Promise<void> {
  const os = await oneSignal()
  await os?.userPrivacyConsent?.grant?.()
}

/**
 * Show notifications even while the app is the focused window.
 *
 * Median suppresses them by default, which is a sane default for a
 * marketing app and the wrong one here: the alerts this app sends —
 * a period needing cover, a teacher marked absent — are most useful to
 * someone already looking at it, and silently dropping them is
 * indistinguishable from push being broken. It is also the first thing
 * anyone testing push does: open the app and wait.
 *
 * Session-scoped, so it is re-asserted on every probe rather than set
 * once at sign-in.
 */
export async function enableForegroundNotifications(): Promise<void> {
  const os = await oneSignal()
  try { await os?.enableForegroundNotifications?.(true) } catch { /* older build */ }
}

/** Ask the OS for notification permission. No-op outside the app. */
export async function oneSignalRegister(): Promise<void> {
  const os = await oneSignal()
  await os?.register?.()
}

/**
 * Bind this device to our user, so a notification can also be addressed
 * by external id from the OneSignal dashboard. Delivery does not depend
 * on it — the server addresses device ids — but without it every device
 * in OneSignal is anonymous, which makes debugging one user's missing
 * notification guesswork.
 *
 * The two integrations spell this differently, and calling the wrong one
 * is silent: v5 has login/logout, Legacy Mode has externalUserId.set and
 * .remove. Try the modern name first, fall back to the legacy pair.
 */
export async function oneSignalLogin(externalId: string): Promise<void> {
  const os = await oneSignal()
  if (!os) return
  if (typeof os.login === 'function') { await os.login(externalId); return }
  await os.externalUserId?.set?.({ externalId })
}

export async function oneSignalLogout(): Promise<void> {
  const os = await oneSignal()
  if (!os) return
  if (typeof os.logout === 'function') { await os.logout(); return }
  await os.externalUserId?.remove?.()
}
