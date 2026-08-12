'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Smartphone, Loader2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { QueryError } from '@/components/shared/QueryError'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// Online payment, from the school's side of the desk.
//
// Two jobs, and the second is the one that actually prevents a mistake:
//
//   * Raise a payment request the family can settle from their phone, so a fee
//     does not require a trip to the office during working hours.
//
//   * SHOW MONEY IN FLIGHT. A parent who started paying five minutes ago has an
//     order sitting unresolved; a cashier who cannot see it takes the same fee
//     again in cash, and the family ends up paying twice. This card is mostly
//     here so that cannot happen quietly.

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3001'

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  created: { label: 'Awaiting payment', className: 'bg-warning/10 text-warning' },
  paid: { label: 'Paid', className: 'bg-success/10 text-success' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
}

export function OnlinePaymentCard({
  studentId, outstanding,
}: {
  studentId: string
  outstanding: number
}) {
  const { can } = usePermissions()
  const [asking, setAsking] = useState(false)
  const canCollect = can('fee.collect')

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-orders', studentId],
    queryFn: () => feeApi.gateway.list({ student_id: studentId }).then(r => r.data as any[]),
  })

  const orders = data ?? []
  const inFlight = orders.filter(o => o.status === 'created')

  // Nothing to show and nothing to start: don't occupy space on the page.
  //
  // Explicitly NOT on error. This card carries the "a payment is already in
  // flight for this student, do not take the cash again" warning, so a failed
  // request silently deleting it is the one outcome that costs a family money
  // twice — the card disappeared exactly when it had something to say.
  if (!isPending && !error && !orders.length && (!canCollect || outstanding <= 0)) return null

  if (error) {
    return (
      <Card className="p-5">
        <QueryError
          error={error}
          title="Could not check for payments in progress"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          A parent may have an online payment in flight. Check with them before taking cash.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" /> Pay from phone
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ask the family to settle this on their own device, and see anything
            they have already started.
          </p>
        </div>
        {canCollect && outstanding > 0 && (
          <Button size="sm" onClick={() => setAsking(true)}>Request payment</Button>
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        {isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <>
            {!!inFlight.length && (
              // The whole reason this card exists. Said before the list, because a
              // cashier about to take cash needs it before they look at anything.
              <Alert variant="warning" title={`${inFlight.length} payment${inFlight.length === 1 ? '' : 's'} in progress`}>
                {formatCurrency(inFlight.reduce((s, o) => s + Number(o.amount), 0))} has been
                started online and not finished. Check with the family before taking
                this at the counter, or they may pay twice.
              </Alert>
            )}

            {!orders.length ? (
              <p className="py-2 text-sm text-muted-foreground">
                Nothing has been paid online for this student yet.
              </p>
            ) : (
              orders.slice(0, 5).map(o => {
                const style = STATUS_STYLE[o.status] ?? STATUS_STYLE.created
                return (
                  <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(o.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(o.created_at)}
                        {o.fee_payments?.receipt_number && ` · receipt ${o.fee_payments.receipt_number}`}
                        {o.failure_reason && ` · ${o.failure_reason}`}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', style.className)}>
                      {style.label}
                    </span>
                  </div>
                )
              })
            )}
          </>
        )}
      </CardContent>

      {asking && (
        <RequestPaymentDialog
          studentId={studentId}
          outstanding={outstanding}
          onClose={() => setAsking(false)}
        />
      )}
    </Card>
  )
}

function RequestPaymentDialog({
  studentId, outstanding, onClose,
}: {
  studentId: string
  outstanding: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(outstanding))
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  const entered = Number(amount)
  const valid = Number.isFinite(entered) && entered > 0 && entered <= outstanding + 0.01
  const link = `${PORTAL_URL}/fees`

  const submit = async () => {
    if (!valid) return
    setLoading(true)
    try {
      const res = await feeApi.gateway.createOrder({ student_id: studentId, amount: entered })
      setCreated(res.data)
      invalidateFeeQueries(qc)
      qc.invalidateQueries({ queryKey: ['fee-orders', studentId] })
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not create the payment request')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the link and copy it manually')
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? 'Payment requested' : 'Request an online payment'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'The family can now pay this from the parent app.'
              : `${formatCurrency(outstanding)} is outstanding on invoices.`}
          </DialogDescription>
        </DialogHeader>

        {!created ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="request-amount">Amount</Label>
              <Input
                id="request-amount" type="number" inputMode="decimal" autoFocus
                value={amount} onChange={e => setAmount(e.target.value)}
                className={cn(!valid && amount !== '' && 'border-destructive')}
              />
              {!valid && amount !== '' && (
                <p className="text-xs font-medium text-destructive">
                  {entered > outstanding
                    ? `Only ${formatCurrency(outstanding)} is outstanding.`
                    : 'Enter an amount above zero.'}
                </p>
              )}
            </div>
            <Alert variant="info" title="Nothing is charged yet">
              This only creates the request. The family completes it themselves,
              and the receipt is issued when their bank confirms — not now.
            </Alert>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/60 p-4 text-center">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {formatCurrency(created.amount)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">awaiting payment</p>
            </div>

            <div className="space-y-1.5">
              <Label>Where they pay</Label>
              <div className="flex gap-2">
                <Input readOnly value={link} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                They sign in to the parent app with their own account — the link
                carries no access on its own.
              </p>
            </div>

            {created.simulated && (
              <Alert variant="warning" title="No payment provider is connected">
                This request cannot actually take money until the school configures
                a provider. It is safe to create, but do not tell the family it is live.
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {!created ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button onClick={submit} disabled={!valid || loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create request
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
