'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle2, ShieldCheck, X } from 'lucide-react'
import { feeApi } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Paying from the phone.
//
// The portal could show a bill and nothing else — every rupee had to be carried
// to a counter during office hours. This is the other half.
//
// Three things it deliberately does NOT do:
//
//   * It does not decide the amount. The server caps whatever is entered at what
//     is genuinely outstanding, so a stale tab showing yesterday's balance cannot
//     overpay, and a tampered request cannot underpay.
//   * It does not mark anything paid itself. Success comes from the provider via
//     a signed callback; this screen only asks and then waits.
//   * It does not hide that the provider is simulated when it is. A parent seeing
//     "paid" for money that never moved is worse than no button at all.

type Stage = 'amount' | 'confirming' | 'done' | 'failed'

export function PayDialog({
  outstanding, onClose,
}: {
  outstanding: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(outstanding))
  const [stage, setStage] = useState<Stage>('amount')
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState<any>(null)
  const [receipt, setReceipt] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const entered = Number(amount)
  const valid = Number.isFinite(entered) && entered > 0 && entered <= outstanding + 0.01
  const partial = valid && entered < outstanding - 0.01

  const start = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const res = await feeApi.gateway.createOrder({ amount: entered })
      setOrder(res.data)
      setStage('confirming')
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not start the payment')
    } finally {
      setBusy(false)
    }
  }

  /** Poll the order and land on done/failed. Shared by both completion paths. */
  const settle = async () => {
    const res = await feeApi.gateway.get(order.order_id)
    if (res.data.status === 'paid') {
      setReceipt(res.data.receipt)
      setStage('done')
      qc.invalidateQueries({ queryKey: ['portal-fee-summary'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    } else {
      setError(res.data.failure_reason ?? 'The payment did not go through')
      setStage('failed')
    }
  }

  // The real provider's checkout.
  //
  // The backend has returned a `checkout` object on every order since this flow
  // was built and NOTHING read it — confirm() called /simulate unconditionally,
  // which returns 400 the moment a provider is configured. The pay button was
  // therefore guaranteed to break on the day the school connected Razorpay, and
  // the non-simulated branch of this dialog rendered the words "Opening your
  // bank's secure page…" while opening nothing at all.
  const openCheckout = async () => {
    setBusy(true)
    setError(null)
    try {
      const checkout = order?.checkout
      if (checkout?.redirect_url) {
        // Hosted checkout: leave the app. The webhook records the payment
        // whether or not the browser ever comes back, which is why capture does
        // not depend on this return trip.
        window.location.href = checkout.redirect_url
        return
      }
      setError(
        'This school\'s payment provider is configured but the checkout could not be opened. ' +
        'Please pay at the school office.',
      )
      setStage('failed')
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not open the payment page')
      setStage('failed')
    } finally {
      setBusy(false)
    }
  }

  // The mock driver's stand-in for a checkout sheet. Only ever reachable when
  // the order came back `simulated` AND this caller may complete one.
  const confirm = async (outcome: 'paid' | 'failed') => {
    setBusy(true)
    setError(null)
    try {
      await feeApi.gateway.simulate(order.order_id, outcome)
      await settle()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not complete the payment')
      setStage('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pay fees"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {stage === 'done' ? 'Payment received' : 'Pay fees'}
            </h2>
            {stage !== 'done' && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatCurrency(outstanding)} outstanding
              </p>
            )}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stage === 'amount' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount to pay</Label>
              <Input
                id="pay-amount" type="number" inputMode="decimal" autoFocus
                value={amount} onChange={e => setAmount(e.target.value)}
                className={cn(!valid && amount !== '' && 'border-destructive')}
              />
              <div className="flex gap-1.5 pt-0.5">
                {[
                  { label: 'Full amount', value: outstanding },
                  { label: 'Half', value: Math.round(outstanding / 2) },
                ].map(q => (
                  <button
                    key={q.label} type="button" onClick={() => setAmount(String(q.value))}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              {!valid && amount !== '' && (
                <p className="text-xs font-medium text-destructive">
                  {entered > outstanding
                    ? `Only ${formatCurrency(outstanding)} is outstanding.`
                    : 'Enter an amount above zero.'}
                </p>
              )}
            </div>

            {partial && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                {formatCurrency(outstanding - entered)} will remain outstanding. Your
                payment goes against the oldest bills first.
              </p>
            )}

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <Button className="w-full" onClick={start} disabled={!valid || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pay {valid ? formatCurrency(entered) : ''}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> The school confirms every payment before it is receipted
            </p>
          </div>
        )}

        {stage === 'confirming' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/60 p-4 text-center">
              <p className="text-xs font-medium text-muted-foreground">Paying</p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {formatCurrency(order?.amount ?? entered)}
              </p>
            </div>

            {order?.simulated && order?.can_complete && (
              // Said plainly. A parent must never be shown a receipt for money
              // that did not move.
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
                <p className="text-xs font-semibold text-warning">Test mode</p>
                <p className="mt-0.5 text-xs text-warning/90">
                  Your school has not connected a payment provider yet, so no money
                  will actually move. Use the buttons below to see what happens either way.
                </p>
              </div>
            )}

            {order?.simulated && !order?.can_complete && (
              // Honest dead end. The school is running the simulator, so there is
              // no way to take this money online — and pretending otherwise ends
              // with a family holding a receipt for a payment that never happened.
              <div className="rounded-lg border border-border bg-muted/60 px-3 py-2.5">
                <p className="text-xs font-semibold text-foreground">Online payment isn&apos;t available yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your school hasn&apos;t connected a payment provider. Please pay at
                  the school office — nothing has been charged.
                </p>
              </div>
            )}

            {!order?.simulated && (
              <p className="text-sm text-muted-foreground">
                You&apos;ll be taken to your bank&apos;s secure page to finish paying.
              </p>
            )}

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <div className="flex gap-2">
              {order?.simulated ? (
                order?.can_complete ? (
                  <>
                    <Button className="flex-1" onClick={() => confirm('paid')} disabled={busy}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Complete payment
                    </Button>
                    {/* Inside the simulated guard, where it always belonged. It
                        used to sit outside the ternary, so a parent on a live
                        payment provider was shown a "Simulate failure" button. */}
                    <Button variant="ghost" onClick={() => confirm('failed')} disabled={busy}>
                      Simulate failure
                    </Button>
                  </>
                ) : (
                  <Button className="flex-1" variant="outline" onClick={onClose}>Close</Button>
                )
              ) : (
                <Button className="flex-1" onClick={openCheckout} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Continue to payment
                </Button>
              )}
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <div>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {formatCurrency(receipt?.amount ?? entered)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Receipt <span className="font-mono">{receipt?.receipt_number}</span>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              It has been applied to your oldest outstanding bills and appears in
              your payment history straight away.
            </p>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        )}

        {stage === 'failed' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-destructive">
              {error ?? 'The payment did not go through.'}
            </p>
            <p className="text-sm text-muted-foreground">
              Nothing has been charged. You can try again, or pay at the school office.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => { setStage('amount'); setError(null) }}>
                Try again
              </Button>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
