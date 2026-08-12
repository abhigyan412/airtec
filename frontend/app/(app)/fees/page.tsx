'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Wallet, TrendingUp, AlertCircle, CheckCircle, Tag, Clock, Users,
  ArrowRight, Receipt, Percent,
} from 'lucide-react'
import { QueryError } from '@/components/shared/QueryError'
import { feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { FeeCollectionTrend } from '@/components/dashboard/FeeCollectionTrend'

// Overview answers two questions and then gets out of the way: where does the
// school stand on money, and what needs doing today.
//
// The old version of this page put the answer to neither above the fold — it led
// with four KPI tiles, then two charts, then a four-tab table where "Pending
// Dues" was tab two. The work queue below is the part that is new: a school's fee
// desk has a small number of recurring jobs (approve these concessions, chase
// these overdue invoices) and they were previously only discoverable by browsing.

const DUE_SOON_DAYS = 7

export default function FeesOverviewPage() {
  const { can } = usePermissions()

  const { data: stats, isPending: statsPending, error: statsError } = useQuery({
    queryKey: ['fee-stats'],
    queryFn: () => feeApi.stats().then(r => r.data),
  })

  const { data: pendingDiscounts } = useQuery({
    queryKey: ['fee-discounts', { approval_status: 'pending' }],
    queryFn: () => feeApi.discounts.list({ approval_status: 'pending' }).then(r => r.data as any[]),
  })

  const { data: dues } = useQuery({
    queryKey: ['fee-dues', { page: 1, limit: 50 }],
    queryFn: () => feeApi.dues({ page: 1, limit: 50 }),
  })

  // Only the count is wanted here, so ask for the smallest page and read the
  // total off meta. Reading `data.length` would report 25 the moment the school
  // has more defaulters than one page.
  const { data: defaulters, error: defaultersError } = useQuery({
    queryKey: ['fee-defaulters', 30, 'count'],
    queryFn: () => feeApi.defaulters(30, 1, 1),
  })

  const { data: recentPayments } = useQuery({
    queryKey: ['fee-payments', { page: 1, limit: 6 }],
    queryFn: () => feeApi.payments.list({ page: 1, limit: 6 }),
  })

  const dueRows: any[] = dues?.data ?? []
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + DUE_SOON_DAYS)
  const dueSoon = dueRows.filter(d => d.due_date && new Date(d.due_date) <= horizon)

  const outstanding = stats?.total_outstanding ?? stats?.total_due ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fees"
        description="Collections, billing and outstanding balances"
        icon={Wallet}
        actions={
          can('fee.collect') && (
            <Button asChild>
              <Link href="/fees/collect"><Receipt className="h-4 w-4" /> Record a payment</Link>
            </Button>
          )
        }
      />

      {statsPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
      ) : statsError ? (
        // Four ₹0 tiles and "Everything billed is collected" is what a failed
        // request used to look like — a school that has taken no money reading
        // as a school that has collected all of it.
        <QueryError error={statsError} title="Could not load the fee position" />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Collected" value={formatCurrency(stats?.total_collected ?? 0)}
            icon={CheckCircle} accent="success"
            hint={`${stats?.collection_rate ?? 0}% of everything billed`}
          />
          <StatCard
            label="Outstanding" value={formatCurrency(outstanding)}
            icon={AlertCircle} accent="destructive"
            // Spelled out because these three used to be one number that quietly
            // omitted arrears and ad-hoc charges entirely.
            hint={
              (stats?.arrears_due ?? 0) > 0 || (stats?.adhoc_due ?? 0) > 0
                ? `Invoices ${formatCurrency(stats?.total_due ?? 0)} · Arrears ${formatCurrency(stats?.arrears_due ?? 0)}`
                : 'Across invoices, arrears and one-off charges'
            }
          />
          <StatCard
            label="Billed" value={formatCurrency(stats?.total_billed ?? 0)}
            icon={TrendingUp} accent="primary"
            hint={`${stats?.paid_invoices ?? 0} paid · ${stats?.partial_invoices ?? 0} partial · ${stats?.unpaid_invoices ?? 0} unpaid`}
          />
          <StatCard
            label="Collection rate" value={`${stats?.collection_rate ?? 0}%`}
            icon={Percent} accent="info"
            hint={outstanding > 0 ? `${formatCurrency(outstanding)} still to come in` : 'Everything billed is collected'}
          />
        </div>
      )}

      {/* What needs doing */}
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <WorkItem
            href="/fees/discounts?status=pending"
            icon={Tag}
            count={pendingDiscounts?.length ?? 0}
            label="discount request"
            description="Waiting on approval"
            accent="warning"
            show={can('fee.discount') || can('fee.view')}
          />
          <WorkItem
            href="/fees/recovery"
            icon={Clock}
            count={dueSoon.length}
            label="invoice"
            description={`Due in the next ${DUE_SOON_DAYS} days`}
            accent="primary"
            show
          />
          <WorkItem
            href="/fees/recovery#defaulters"
            icon={Users}
            count={defaulters?.meta?.total ?? 0}
            label="family"
            description="Overdue by 30 days or more"
            accent="destructive"
            show
          />
        </CardContent>
      </Card>

      <FeeCollectionTrend />

      <FeeForecast />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent receipts</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/fees/collect">View all <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </CardHeader>
        {!(recentPayments?.data ?? []).length ? (
          <EmptyState
            icon={Receipt}
            title="No payments recorded yet"
            description="Receipts appear here as soon as the front desk records a payment."
          />
        ) : (
          <div className="divide-y border-t">
            {(recentPayments?.data ?? []).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.students?.first_name} {p.students?.last_name}
                  </p>
                  {/* `amount_paid` and `payment_mode` are pre-rewrite column
                      names — fee_payments carries `amount` and `method`. Reading
                      the old ones rendered "₹NaN" beside a dangling separator on
                      every row of this card. */}
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{p.receipt_number}</span> · {formatDate(p.payment_date)}
                    {p.method && <> · <span className="capitalize">{p.method}</span></>}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-success">
                  {formatCurrency(p.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * One job on the queue. Renders a settled state rather than disappearing at zero
 * — "nothing pending" is information the person checking wants, and a card that
 * vanishes makes them wonder whether it loaded.
 */
// ── Forecast ──────────────────────────────────────────────────────────
//
// What the school can expect to collect, read forward off the plans' schedules.
// Impossible before those existed: until a plan carried dates, nothing knew a
// payment was due until an invoice for it had already been raised, so the only
// forward-looking number available was last month's, repeated.
//
// Two figures, deliberately both shown. EXPECTED is what the plans schedule.
// PROJECTED applies the school's own historical collection rate, because billing
// ten lakh and forecasting ten lakh of cash is not a forecast, it is a wish.

function FeeForecast() {
  const { data, isPending } = useQuery({
    queryKey: ['fee-forecast'],
    queryFn: () => feeApi.forecast(6),
  })

  const rows: any[] = data?.data ?? []
  const meta = data?.meta

  if (isPending) return <Skeleton className="h-56 w-full rounded-xl" />
  if (!rows.length) return null

  const peak = Math.max(...rows.map(r => r.expected), 1)

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>What&apos;s coming in</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            From the payment schedules on your fee plans · collecting {meta?.collection_rate ?? 0}% historically
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-foreground">
            {formatCurrency(meta?.total_projected ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            projected of {formatCurrency(meta?.total_expected ?? 0)}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(r => (
          <div key={r.month} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{formatCurrency(r.projected)}</span>
                {' of '}{formatCurrency(r.expected)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              {/* Two bars, nested: the pale one is what is scheduled, the solid
                  one what history says will actually arrive. */}
              <div className="h-full rounded-full bg-primary/25" style={{ width: `${(r.expected / peak) * 100}%` }}>
                <div className="h-full rounded-full bg-primary"
                  style={{ width: `${r.expected > 0 ? (r.projected / r.expected) * 100 : 0}%` }} />
              </div>
            </div>
            {r.overdue_to_bill > 0 && (
              // Scheduled, its bill-on date passed, and still not raised. That is
              // not future income — it is a job somebody has missed.
              <p className="text-xs font-medium text-warning">
                {formatCurrency(r.overdue_to_bill)} was due to be billed and hasn&apos;t been
              </p>
            )}
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">{meta?.note}</p>
      </CardContent>
    </Card>
  )
}

function WorkItem({
  href, icon: Icon, count, label, description, accent, show,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  label: string
  description: string
  accent: 'warning' | 'primary' | 'destructive'
  show: boolean
}) {
  if (!show) return null

  const clear = count === 0
  const tone = {
    warning: 'bg-warning/10 text-warning',
    primary: 'bg-primary/10 text-primary',
    destructive: 'bg-destructive/10 text-destructive',
  }[accent]

  return (
    <Link
      href={href}
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-accent/50',
        clear && 'opacity-70',
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', clear ? 'bg-muted text-muted-foreground' : tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-bold tabular-nums text-foreground">
          {clear ? 'All clear' : `${count} ${label}${count === 1 ? '' : 's'}`}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </Link>
  )
}
