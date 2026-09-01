'use client'

import { BellRing, X, Loader2 } from 'lucide-react'
import { usePushSubscription } from '@/lib/usePushSubscription'
import { Button } from '@/components/ui/button'

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

  // Only the sell, and only when there is something to sell. Every other
  // state — an iPhone that must be installed first, an insecure origin, a
  // site the user has blocked, push already on — is PushStatus's job, and
  // PushStatus is always rendered. That split is deliberate: this card is
  // dismissible, and dismissing it must never be what hides the controls
  // or the reason notifications aren't arriving.
  if (!shouldOffer || needsHomeScreenInstall) return null

  return (
    <div className="relative border-b bg-primary/5 px-4 py-3">
      <DismissButton label="Not now" onClick={dismiss} />
      <div className="flex items-start gap-2.5 pr-12">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{copy.headline}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.detail}</p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={subscribe} disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The corner dismiss. A 44px target that keeps its 14px glyph, so it stays a
 *  quiet affordance without being a 20px thing to hit with a thumb. */
function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )
}
