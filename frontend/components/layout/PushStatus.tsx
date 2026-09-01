'use client'

import { BellRing, BellOff, TriangleAlert, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { usePushSubscription, describeBlocker } from '@/lib/usePushSubscription'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ── Push status & controls ──────────────────────────────────────────
//
// Duplicated in frontend-portal/components/layout/PushStatus.tsx.
//
// This row is ALWAYS rendered, and that is the whole point of it. Push
// used to be reachable only through PushPrompt, which returns null unless
// the browser permission is still 'default' and the card wasn't dismissed
// in the last 30 days. So one "Not now" hid the only switch for a month,
// a browser-level "Block" hid it forever, and an unsupported browser hid
// it with no message at all — a feature with no off-ramp and no error.
// Whatever state push is in, this says so and offers the next step.

export function PushStatus({ app }: { app: 'staff' | 'family' }) {
  const {
    ready, blocker, subscribed, serverKnown, canEnable, busy, error,
    subscribe, unsubscribe, sendTest,
  } = usePushSubscription(app)

  // Nothing until the first probe lands, so the row doesn't flash "Off"
  // at someone who has notifications switched on.
  if (!ready) return null

  const blocked = describeBlocker(blocker)
  // Subscribed in the browser but the server has no row: pushes are being
  // skipped. refresh() tries to repair this automatically; if it is still
  // false here, the repair itself failed.
  const brokenSync = subscribed && serverKnown === false
  const on = subscribed && !brokenSync

  const handleTest = async () => {
    const { delivered, reason } = await sendTest()
    if (delivered) toast.success('Sent — it should appear on this device now.')
    else toast.error(reason ?? 'The test notification did not go out.')
  }

  return (
    <div className="flex-shrink-0 border-t border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <StatusIcon on={on} blocked={!!blocked || brokenSync} />
        <p className="flex-1 text-xs font-semibold text-foreground">Push on this device</p>
        <span className={cn('text-[11px] font-semibold',
          on ? 'text-success' : blocked || brokenSync ? 'text-destructive' : 'text-muted-foreground')}>
          {on ? 'On' : blocked ? 'Unavailable' : brokenSync ? 'Not working' : 'Off'}
        </span>
      </div>

      {blocked && (
        <div className="mt-1.5 pl-[26px]">
          <p className="text-xs font-medium text-foreground">{blocked.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{blocked.detail}</p>
        </div>
      )}

      {brokenSync && (
        <p className="mt-1.5 pl-[26px] text-[11px] leading-relaxed text-muted-foreground">
          This browser is subscribed but the server has no record of it, so nothing is being sent.
          Turn it off and on again to re-register.
        </p>
      )}

      {error && <p className="mt-1.5 pl-[26px] text-[11px] leading-relaxed text-destructive">{error}</p>}

      {!blocked && (
        <div className="mt-2 flex items-center gap-2 pl-[26px]">
          {canEnable && (
            <Button size="sm" onClick={subscribe} disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Turn on
            </Button>
          )}
          {subscribed && (
            <>
              <Button size="sm" variant="ghost" onClick={handleTest} disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Send test
              </Button>
              <Button size="sm" variant="ghost" onClick={unsubscribe} disabled={busy}>
                Turn off
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ on, blocked }: { on: boolean; blocked: boolean }) {
  if (blocked) return <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
  if (on) return <BellRing className="h-4 w-4 shrink-0 text-success" />
  return <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" />
}
