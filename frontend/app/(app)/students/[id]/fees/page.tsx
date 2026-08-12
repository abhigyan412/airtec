'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Wallet, Receipt, FileText, Tag } from 'lucide-react'
import { feeApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn, STATUS_COLORS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/PageHeader'
import { QueryError } from '@/components/shared/QueryError'
import { EmptyState } from '@/components/shared/EmptyState'

// One student's complete fee position.
//
// This route existed and rendered the student PROFILE — it was a stripped copy
// of ../page.tsx with the fee content never written. A class teacher clicking an
// overdue amount on their homeroom follow-ups list landed on demographics.
//
// Backed by /fees/students/:id — the same read the Collect flow uses, so the two
// never disagree about what a family owes.

export default function StudentFeeLedgerPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-student-summary', id],
    queryFn: () => feeApi.student(id).then(r => r.data),
  })

  if (isPending) {
    return (
      <div className="max-w-5xl space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error) {
    return <Card className="p-5"><QueryError error={error} title="Could not load this student's fees" /></Card>
  }

  if (!data) {
    return (
      <Card>
        <EmptyState icon={Wallet} title="No fee record found" description="This student has no fee history yet." />
      </Card>
    )
  }

  const student = data.student
  const summary = data.summary
  const invoices: any[] = data.invoices ?? []
  const payments: any[] = data.payments ?? []
  const arrears: any[] = (data.arrears ?? []).filter((a: any) => a.amount_due > 0)
  const adhoc: any[] = (data.adhoc_charges ?? []).filter((a: any) => a.status !== 'cancelled')

  const name = `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim()
  const settled = (summary?.totalDue ?? 0) <= 0

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="Back to student">
          <Link href={`/students/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          title={name || 'Fee ledger'}
          description={[
            student?.classes?.name && `${student.classes.name}${student.sections?.name ? `-${student.sections.name}` : ''}`,
            student?.admission_number,
          ].filter(Boolean).join(' · ') || 'Fee ledger'}
          icon={Wallet}
          className="mb-0 flex-1"
          actions={
            can('fee.discount') && (
              <Button asChild variant="outline">
                <Link href={`/fees/discounts?student=${id}`}><Tag className="h-4 w-4" /> Concession</Link>
              </Button>
            )
          }
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-medium text-muted-foreground">
            {settled ? 'Nothing outstanding' : 'Total outstanding'}
          </p>
          <p className={cn('text-4xl font-bold tabular-nums tracking-tight', settled ? 'text-success' : 'text-destructive')}>
            {formatCurrency(summary?.totalDue ?? 0)}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t pt-3.5">
            <Metric label="Billed" value={summary?.totalBilled ?? 0} />
            <Metric label="Paid" value={summary?.totalPaid ?? 0} tone="success" />
            <Metric label="On invoices" value={summary?.invoiceDue ?? 0} tone="destructive" />
            {/* Arrears and one-off charges are shown as their own lines because
                the total used to omit them entirely — the school's figure and the
                family's figure disagreed. */}
            {(summary?.arrearsDue ?? 0) > 0 && <Metric label="Arrears" value={summary.arrearsDue} tone="destructive" />}
            {(summary?.adhocDue ?? 0) > 0 && <Metric label="One-off charges" value={summary.adhocDue} tone="destructive" />}
          </div>
        </CardContent>
      </Card>

      {!!arrears.length && (
        <Alert variant="warning" title={`${formatCurrency(summary?.arrearsDue ?? 0)} carried forward from a previous year`}>
          {arrears.map(a => (
            <span key={a.id} className="block">
              {a.from_year?.name ?? 'Previous year'} → {a.to_year?.name ?? 'this year'} · {formatCurrency(a.amount_due)} remaining
            </span>
          ))}
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!invoices.length ? (
            <EmptyState icon={FileText} title="No invoices" description="Nothing has been billed to this student yet." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Invoice</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                    {can('fee.collect') && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id} className="cursor-default">
                      <TableCell>
                        <p className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</p>
                        {Number(inv.late_fee) > 0 && (
                          <p className="text-[11px] text-warning">incl. {formatCurrency(inv.late_fee)} late fee</p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(inv.total_amount)}</TableCell>
                      <TableCell className={cn('text-right font-semibold tabular-nums', inv.amount_due > 0 ? 'text-destructive' : 'text-success')}>
                        {formatCurrency(inv.amount_due)}
                      </TableCell>
                      <TableCell>
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium', STATUS_COLORS[inv.status] ?? 'bg-muted text-muted-foreground')}>
                          {inv.status === 'carried_forward' ? 'carried forward' : inv.status}
                        </span>
                      </TableCell>
                      {can('fee.collect') && (
                        <TableCell className="text-right">
                          {/* Not a per-invoice modal any more. One handover is one
                              payment with one receipt, split across whatever it
                              settles — so collecting always goes through the
                              student's counter screen, never a single row. */}
                          {(inv.status === 'unpaid' || inv.status === 'partial') && (
                            <Button asChild size="sm" variant="secondary">
                              <Link href={`/fees/collect/student/${id}/payment`}>Take payment</Link>
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!!adhoc.length && (
        <Card>
          <CardHeader><CardTitle>One-off charges</CardTitle></CardHeader>
          <div className="divide-y border-t">
            {adhoc.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {a.status}{a.due_date ? ` · due ${formatDate(a.due_date)}` : ''}
                  </p>
                </div>
                <p className={cn('shrink-0 text-sm font-semibold tabular-nums', a.status === 'paid' ? 'text-success' : 'text-foreground')}>
                  {formatCurrency(a.amount)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Receipts</CardTitle></CardHeader>
        {!payments.length ? (
          <EmptyState icon={Receipt} title="No payments recorded" description="Receipts appear here once a payment is taken." />
        ) : (
          <div className="divide-y border-t">
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-foreground">{p.receipt_number}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {formatDate(p.payment_date)} · {p.method}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-success">{formatCurrency(Number(p.amount) - Number(p.refunded_amount ?? 0))}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'destructive' }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums',
        tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground')}>
        {formatCurrency(value)}
      </p>
    </div>
  )
}
