'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FileText, Receipt, CalendarClock, Wallet } from 'lucide-react'
import { studentsApi, feeApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'
import { PayDialog } from '@/components/fees/PayDialog'
import { formatCurrency, formatDate, formatRelativeDue, statusVariant, cn } from '@/lib/utils'
import { invoiceHeads, invoiceTitle } from '@/lib/fees'

export default function PortalFeesPage() {
  // Fees is parent-only (see (portal)/layout.tsx nav) — this catches a
  // student navigating here directly by URL, not just hiding the tab.
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (user && user.role !== 'parent') router.replace('/')
  }, [user, router])

  const { data: me, isPending: mePending, error: meError } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data, isPending: summaryPending, error: summaryError } = useQuery({
    queryKey: ['portal-fee-summary', me?.id],
    queryFn: () => feeApi.student(me.id).then(r => r.data),
    enabled: !!me?.id,
  })

  const [paying, setPaying] = useState(false)

  // `isLoading` is `isPending && isFetching`, and a DISABLED query is never
  // fetching — so while `me` is still resolving, isLoading reads false, the
  // skeleton is skipped, and the page renders totalDue = 0. On a fees screen
  // that means a parent who owes money is briefly told, full-width and in
  // green, that they are all paid up. Gate on isPending, which stays true
  // until the query actually has data.
  const isLoading = mePending || summaryPending
  // The same reasoning one step further. isPending stops the page rendering ₹0
  // while the request is IN FLIGHT; this stops it rendering ₹0 when the request
  // has FAILED, which produced the identical green "all paid up" panel and was
  // the only one of the two that persisted on screen.
  const loadError = meError ?? summaryError

  if (user && user.role !== 'parent') return null

  const summary = data?.summary
  const invoices: any[] = data?.invoices ?? []
  const payments: any[] = data?.payments ?? []
  const upcoming: any[] = data?.upcoming ?? []
  // What can actually be paid online right now. Arrears and unbilled one-off
  // charges are in totalDue but have no invoice to settle, so offering to
  // collect them here would take money the allocator cannot place.
  const payableNow = summary?.invoiceDue ?? 0

  const totalDue = summary?.totalDue ?? 0
  const settled = totalDue <= 0

  // The one date a parent is looking for: the soonest deadline still owing.
  // Invoices arrive newest-first, so the nearest due date is not row one.
  // Sliced to YYYY-MM-DD because formatRelativeDue compares ISO days as
  // strings, and a timestamp suffix would break the "due today" branch.
  const nextDueISO = invoices
    .filter(inv => inv.status !== 'paid' && inv.due_date)
    .map(inv => String(inv.due_date).slice(0, 10))
    .sort()[0]
  const nextDue = nextDueISO ? formatRelativeDue(nextDueISO) : null

  return (
    <div className="space-y-5">
      <PageHeader title="Fees" description="Invoices and payments on your child's account." />

      {isLoading ? (
        <>
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-52 w-full rounded-lg" />
          <Skeleton className="h-52 w-full rounded-lg" />
        </>
      ) : (
        <>
          {/* The whole page answers one question — how much, by when — so that
              answer gets the full width and the largest type on screen.
              Billed and paid sit underneath as context, not as peers. */}
          <Card className="p-5">
            {loadError ? (
              <QueryError error={loadError} title="Could not load your fee position" />
            ) : (
            <>
            <p className="text-sm font-medium text-muted-foreground">
              {settled ? 'Nothing due' : 'Amount due'}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p
                className={cn(
                  'text-4xl font-bold tabular-nums tracking-tight',
                  settled ? 'text-success' : 'text-destructive',
                )}
              >
                {formatCurrency(totalDue)}
              </p>
              {!settled && nextDue && (
                <p
                  className={cn(
                    'text-sm font-semibold',
                    nextDue.overdue ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {nextDue.label}
                </p>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {settled
                ? "You're all paid up — there's nothing outstanding right now."
                : payableNow > 0
                  ? 'Pay online below, or at the school office.'
                  : 'Please clear this at the school office to keep the account current.'}
            </p>

            {payableNow > 0 && (
              <Button className="mt-4 w-full" onClick={() => setPaying(true)}>
                <Wallet className="mr-2 h-4 w-4" /> Pay {formatCurrency(payableNow)} now
              </Button>
            )}
            {!settled && payableNow > 0 && payableNow < totalDue && (
              // The difference is arrears or an unbilled charge. Saying so beats
              // a parent paying and wondering why they still owe something.
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {formatCurrency(totalDue - payableNow)} of the total isn&apos;t on an
                invoice yet — settle that at the office.
              </p>
            )}
            </>
            )}

            {/* The total above now includes carried-forward arrears and one-off
                charges, which it previously omitted — a family could clear every
                invoice on this page and still be a defaulter in the school's own
                records. Where those exist they are named, so the figure is not a
                number the parent cannot account for. */}
            <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3 border-t pt-3.5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total billed</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                  {formatCurrency(summary?.totalBilled ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Paid so far</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-success">
                  {formatCurrency(summary?.totalPaid ?? 0)}
                </p>
              </div>
              {(summary?.arrearsDue ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">From last year</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-destructive">
                    {formatCurrency(summary.arrearsDue)}
                  </p>
                </div>
              )}
              {(summary?.adhocDue ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">One-off charges</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-destructive">
                    {formatCurrency(summary.adhocDue)}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* What is coming, before it is billed. The schedule lives on the
              school's fee plan, so a family can budget for the next term instead
              of finding out when the invoice lands. */}
          {upcoming.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Coming up</CardTitle>
              </CardHeader>
              <div className="divide-y border-t">
                {upcoming.slice(0, 4).map((u: any) => (
                  <div key={u.period_token} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="truncate text-sm font-medium text-foreground">{u.label}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      due {formatDate(u.due_date)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="px-5 pb-3.5 pt-1 text-xs text-muted-foreground">
                Not billed yet — you&apos;ll be notified here when each one is raised.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            {invoices.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No invoices yet"
                description="The school hasn't raised any fee invoices for your child. You'll get a notification here as soon as one is issued."
              />
            ) : (
              <div className="divide-y border-t">
                {invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    {/* The term and the heads lead; the invoice number is the
                        reference you quote back to the office, not the thing
                        being described. A parent has no way to look one up. */}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {invoiceTitle(inv)}
                      </p>
                      {invoiceHeads(inv.line_items) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{invoiceHeads(inv.line_items)}</p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {inv.due_date ? `Due ${formatDate(inv.due_date)}` : formatDate(inv.invoice_date)}
                        {' · '}
                        <span className="font-mono">{inv.invoice_number}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {/* Outstanding, not the original bill. A partially paid
                          invoice showed its full amount here, so a parent who
                          had paid most of it was told they still owed all of it. */}
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(inv.amount_due ?? inv.total_amount)}
                      </p>
                      {inv.amount_due != null && Number(inv.amount_paid) > 0 && inv.status !== 'paid' && (
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {formatCurrency(inv.amount_paid)} of {formatCurrency(inv.total_amount)} paid
                        </p>
                      )}
                      <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            {payments.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No payments recorded yet"
                description="Once a fee payment is received at the school office, the receipt will appear here."
              />
            ) : (
              <div className="divide-y border-t">
                {payments.map((p: any) => (
                  <div key={p.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium text-foreground">
                        {p.receipt_number}
                      </p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                        {formatDate(p.payment_date)} · {p.method}
                        {p.status === 'bounced' && ' · returned by bank'}
                      </p>
                    </div>
                    <p className={cn(
                      'shrink-0 text-sm font-semibold tabular-nums',
                      p.status === 'bounced' ? 'text-muted-foreground line-through' : 'text-success',
                    )}>
                      {formatCurrency(Number(p.amount) - Number(p.refunded_amount ?? 0))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {paying && (
        <PayDialog outstanding={payableNow} onClose={() => setPaying(false)} />
      )}
    </div>
  )
}
