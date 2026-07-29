'use client'

import { BellRing, Share, X, Loader2 } from 'lucide-react'
import { usePushSubscription } from '@/lib/usePushSubscription'

// ── Permission pre-prompt (design.md §6.2) ──────────────────────────
//
// Rendered inside the open notification panel, where the user already has
// context, rather than as a floating banner on page load. The browser
// dialog only fires after they accept this card: a cold prompt is denied
// at high rates, and a denial is effectively permanent — the browser won't
// re-ask and the user has to dig through site settings to undo it.
// Dismissing this costs nothing and is re-offered in 30 days.

export function PushPrompt({ app, copy }: {
  app: 'staff' | 'family'
  copy: { headline: string; detail: string }
}) {
  const { shouldOffer, needsHomeScreenInstall, busy, error, subscribe, dismiss } = usePushSubscription(app)

  if (!shouldOffer) return null

  // iOS Safari outside standalone: pushManager doesn't exist, so a
  // "Turn on" button would be a lie. Explain the one path that works.
  if (needsHomeScreenInstall) {
    return (
      <div className="relative border-b border-gray-100 bg-indigo-50/60 px-4 py-3">
        <button onClick={dismiss} aria-label="Dismiss"
          className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:text-gray-600">
          <X className="h-3.5 w-3.5" />
        </button>
        <p className="pr-6 text-sm font-semibold text-gray-900">Get alerts on your phone</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          On iPhone, add this app to your home screen first: tap
          <Share className="mx-1 inline h-3.5 w-3.5 align-text-bottom" />
          <span className="font-medium">Share</span> then{' '}
          <span className="font-medium">Add to Home Screen</span>, and open it from there.
        </p>
      </div>
    )
  }

  return (
    <div className="relative border-b border-gray-100 bg-indigo-50/60 px-4 py-3">
      <button onClick={dismiss} aria-label="Not now"
        className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:text-gray-600">
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2.5 pr-6">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{copy.headline}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{copy.detail}</p>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={subscribe} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Turn on
            </button>
            <button onClick={dismiss}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
