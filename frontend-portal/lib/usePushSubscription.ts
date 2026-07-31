'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// ── Web push subscription (design.md §6.2) ──────────────────────────
//
// Duplicated in frontend/lib/usePushSubscription.ts. The split
// accepted duplication for the API client; this file is the one where
// drift is genuinely dangerous, because a divergent copy fails by
// notifications silently not arriving rather than by a visible error.
// Keep the two in sync — see NOTIFICATIONS.md.

const DISMISSED_KEY = 'airtec_push_prompt_dismissed_at'
/** Re-offer at most once a month. Nagging is how people hit "Block". */
const REOFFER_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export type PushState = {
  /** Browser can do push at all (has SW + PushManager + Notification). */
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  /**
   * iOS Safari outside standalone mode: pushManager doesn't exist, and no
   * amount of JS can create it — the user must Add to Home Screen first.
   * Show instructions instead of a button that cannot work.
   */
  needsHomeScreenInstall: boolean
  /** True when it's reasonable to show our own pre-prompt card. */
  shouldOffer: boolean
  busy: boolean
  error: string | null
}

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; the touch check disambiguates.
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1))

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true)

/** VAPID keys travel as base64url but subscribe() wants a Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function usePushSubscription(app: 'staff' | 'family') {
  const [state, setState] = useState<PushState>({
    supported: false, permission: 'unsupported', subscribed: false,
    needsHomeScreenInstall: false, shouldOffer: false, busy: false, error: null,
  })

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    const needsHomeScreenInstall = !supported && isIOS() && !isStandalone()

    if (!supported) {
      setState(s => ({
        ...s, supported: false, permission: 'unsupported', subscribed: false,
        needsHomeScreenInstall,
        // Worth telling an iPhone user how to enable this; pointless on a
        // browser that simply can't do push.
        shouldOffer: needsHomeScreenInstall && !recentlyDismissed(),
      }))
      return
    }

    const permission = Notification.permission
    let subscribed = false
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      subscribed = !!(await reg?.pushManager.getSubscription())
    } catch { /* registration not ready yet */ }

    setState(s => ({
      ...s, supported: true, permission, subscribed, needsHomeScreenInstall: false,
      // Never re-ask after an explicit browser denial: the browser won't
      // show the dialog again, so our card would be a dead end.
      shouldOffer: permission === 'default' && !subscribed && !recentlyDismissed(),
    }))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const subscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      const reg = await navigator.serviceWorker.ready

      // Ask the browser only after the user accepted our own card.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(s => ({ ...s, busy: false, permission, shouldOffer: false }))
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

      await api.post('/notifications/push/subscribe', { subscription: subscription.toJSON(), app })
      setState(s => ({ ...s, busy: false, subscribed: true, permission: 'granted', shouldOffer: false }))
      return true
    } catch (err: any) {
      setState(s => ({ ...s, busy: false, error: err?.message ?? 'Could not enable notifications' }))
      return false
    }
  }, [app])

  const unsubscribe = useCallback(async () => {
    setState(s => ({ ...s, busy: true }))
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await api.delete('/notifications/push/subscribe', { data: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      setState(s => ({ ...s, busy: false, subscribed: false }))
    } catch (err: any) {
      setState(s => ({ ...s, busy: false, error: err?.message ?? 'Could not turn off notifications' }))
    }
  }, [])

  /** Dismissing costs nothing and is re-offered later; a denial can't be. */
  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* private mode */ }
    setState(s => ({ ...s, shouldOffer: false }))
  }, [])

  return { ...state, subscribe, unsubscribe, dismiss, refresh }
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) ?? 0)
    return at > 0 && Date.now() - at < REOFFER_AFTER_MS
  } catch {
    return false
  }
}
