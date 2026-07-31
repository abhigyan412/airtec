'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FileText, Receipt } from 'lucide-react'
import { studentsApi, feeApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatCurrency, formatDate, formatRelativeDue, statusVariant, cn } from '@/lib/utils'

export default function PortalFeesPage() {
  // Fees is parent-only (see (portal)/layout.tsx nav) — this catches a
  // student navigating here directly by URL, not just hiding the tab.
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (user && user.role !== 'parent') router.replace('/')
  }, [user, router])

  const { data: me, isPending: mePending } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data, isPending: summaryPending } = useQuery({
    queryKey: ['portal-fee-summary', me?.id],
    queryFn: () => feeApi.studentSummary(me.id).then(r => r.data),
    enabled: !!me?.id,
  })

  // `isLoading` is `isPending && isFetching`, and a DISABLED query is never
  // fetching — so while `me` is still resolving, isLoading reads false, the
  // skeleton is skipped, and the page renders totalDue = 0. On a fees screen
  // that means a parent who owes money is briefly told, full-width and in
  // green, that they are all paid up. Gate on isPending, which stays true
  // until the query actually has data.
  const isLoading = mePending || summaryPending

  if (user && user.role !== 'parent') return null

  const summary = data?.summary
  const invoices: any[] = data?.invoices ?? []
  const payments: any[] = data?.payments ?? []

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
                : nextDue
                  ? 'Please clear this at the school office to keep the account current.'
                  : 'No due date has been set on these invoices yet.'}
            </p>

            <div className="mt-4 flex items-start gap-8 border-t pt-3.5">
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
            </div>
          </Card>

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
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium text-foreground">
                        {inv.invoice_number}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {inv.due_date ? `Due ${formatDate(inv.due_date)}` : formatDate(inv.invoice_date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(inv.total_amount)}
                      </p>
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
                        {formatDate(p.payment_date)} · {p.payment_mode}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-success">
                      {formatCurrency(p.amount_paid)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
