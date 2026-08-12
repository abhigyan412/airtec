'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Wallet, Phone, Mail, Receipt, FileText, Loader2, ArrowRightLeft, Printer, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn, STATUS_COLORS } from '@/lib/utils'
import { invoiceHeads, invoiceTitle } from '@/lib/fees'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'
import { OptionalFeesCard, AdhocChargesCard } from '@/components/fees/StudentExtras'
import { OnlinePaymentCard } from '@/components/fees/OnlinePaymentCard'

// One student's fee position — the page both entry paths converge on.
//
// Three things here that the module did not have anywhere:
//
//   * Guardian contacts, click-to-call. Chasing a due means phoning someone, and
//     the number lived only in the defaulters table, on a different screen.
//   * Requests against individual lines — waive this late fee, cancel that
//     receipt, refund it. Previously the only way to undo a mis-keyed payment
//     was to delete the row, which took the receipt number with it.
//   * A route to the printed receipt for every payment.

export default function StudentFeeProfilePage() {
  const { studentId } = useParams<{ studentId: string }>()
  const { can } = usePermissions()
  const [requestTarget, setRequestTarget] = useState<
    { kind: 'late_fee_waiver' | 'payment_cancel' | 'refund'; id: string; label: string; max?: number } | null
  >(null)
  const [bounceTarget, setBounceTarget] = useState<any>(null)

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-student-summary', studentId],
    queryFn: () => feeApi.student(studentId).then(r => r.data),
  })

  const { data: requests } = useQuery({
    queryKey: ['fee-requests', { student_id: studentId }],
    queryFn: () => feeApi.requests.list({ student_id: studentId }).then(r => r.data as any[]),
  })

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error) {
    // "No fee record" on a failed read looks exactly like a student who owes
    // nothing, on the screen a cashier uses to decide what to take.
    return <Card className="p-5"><QueryError error={error} title="Could not load this student's fees" /></Card>
  }

  if (!data) {
    return <Card><EmptyState icon={Wallet} title="No fee record" description="This student has no fee history yet." /></Card>
  }

  const student = data.student
  const summary = data.summary
  const invoices: any[] = data.invoices ?? []
  const payments: any[] = data.payments ?? []
  const arrears: any[] = (data.arrears ?? []).filter((a: any) => a.amount_due > 0)
  const name = `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim()
  const settled = (summary?.totalDue ?? 0) <= 0
  const pending: any[] = (requests ?? []).filter(r => r.status === 'pending')

  const canCollect = can('fee.collect')
  const openInvoices = invoices.filter(i => i.status === 'unpaid' || i.status === 'partial')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground">
            <Link href="/fees/collect"><ArrowLeft className="h-3.5 w-3.5" /> Collect</Link>
          </Button>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[student?.admission_number, [student?.classes?.name, student?.sections?.name].filter(Boolean).join('-')]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        {canCollect && !settled && (
          <Button asChild>
            <Link href={`/fees/collect/student/${studentId}/payment`}>
              <Wallet className="h-4 w-4" /> Collect payment
            </Link>
          </Button>
        )}
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
            {(summary?.invoiceDue ?? 0) > 0 && <Metric label="On invoices" value={summary.invoiceDue} tone="destructive" />}
            {(summary?.arrearsDue ?? 0) > 0 && <Metric label="Arrears" value={summary.arrearsDue} tone="destructive" />}
            {(summary?.adhocDue ?? 0) > 0 && <Metric label="One-off" value={summary.adhocDue} tone="destructive" />}
            {/* Advance is money the school already holds, so it is netted off the
                headline figure above. Shown separately or the arithmetic on this
                card does not add up for anyone checking it. */}
            {(summary?.advanceHeld ?? 0) > 0 && <Metric label="Advance held" value={summary.advanceHeld} tone="success" />}
          </div>
          {data.assignment ? (
            <p className="mt-3 text-xs text-muted-foreground">
              On <span className="font-medium text-foreground">{data.assignment.fee_structures?.name}</span>
              {data.assignment.fee_structures?.frequency && ` · billed ${data.assignment.fee_structures.frequency.replace('_', '-')}`}
              {data.assignment.fee_category && data.assignment.fee_category !== 'general' &&
                ` · ${data.assignment.fee_category.replace('_', ' ')}`}
            </p>
          ) : (
            // Not on a plan means the billing run skips them entirely, which is
            // invisible until a term ends with nothing billed.
            <p className="mt-3 text-xs font-medium text-warning">
              Not on a fee plan — billing runs will skip this student.
            </p>
          )}
        </CardContent>
      </Card>

      {!!pending.length && (
        <Alert variant="warning" title={`${pending.length} request${pending.length === 1 ? '' : 's'} awaiting approval`}>
          {pending.map(r => (
            <span key={r.id} className="block">
              {KIND_LABEL[r.kind] ?? r.kind}
              {r.amount ? ` · ${formatCurrency(r.amount)}` : ''} — {r.reason}
            </span>
          ))}
        </Alert>
      )}

      <GuardianCard studentId={studentId} />

      {/* Above the ledger deliberately: an in-progress online payment has to be
          seen BEFORE someone starts taking the same money at the counter. */}
      <OnlinePaymentCard studentId={studentId} outstanding={summary?.invoiceDue ?? 0} />

      {/* Optional fees and one-off charges live here rather than in Setup: both
          are decisions about THIS student, taken while you have their record
          open, not configuration you do once for the school. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <OptionalFeesCard studentId={studentId} studentName={name} />
        <AdhocChargesCard studentId={studentId} studentName={name} />
      </div>

      {/* Outstanding, line by line */}
      <Card>
        <CardHeader><CardTitle>Outstanding dues</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!openInvoices.length && !arrears.length ? (
            <EmptyState icon={Wallet} title="All clear" description="Nothing outstanding on this student." className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Item</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openInvoices.map(inv => (
                    <TableRow key={inv.id} className="cursor-default">
                      {/* What the money is FOR, then the filing detail. An
                          invoice number alone answers no question a parent
                          standing at the counter is actually asking. */}
                      <TableCell>
                        <span className="block text-sm font-medium text-foreground">{invoiceTitle(inv)}</span>
                        {invoiceHeads(inv.line_items) && (
                          <span className="block text-xs text-muted-foreground">{invoiceHeads(inv.line_items)}</span>
                        )}
                        <span className="block font-mono text-[11px] text-muted-foreground">{inv.invoice_number}</span>
                        {Number(inv.late_fee) > 0 && (
                          <span className="block text-[11px] text-warning">
                            includes {formatCurrency(inv.late_fee)} late fee
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inv.due_date ? formatDate(inv.due_date) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(inv.total_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{formatCurrency(inv.amount_paid)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-destructive">{formatCurrency(inv.amount_due)}</TableCell>
                      <TableCell className="text-right">
                        {canCollect && Number(inv.late_fee) > 0 && (
                          <Button
                            size="sm" variant="ghost" className="h-8 text-xs text-warning"
                            onClick={() => setRequestTarget({
                              kind: 'late_fee_waiver', id: inv.id,
                              label: `Waive ${formatCurrency(inv.late_fee)} late fee on ${inv.invoice_number}`,
                            })}
                          >
                            Request waiver
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {arrears.map(a => (
                    <TableRow key={a.id} className="cursor-default">
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-foreground">
                          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                          Arrear · {a.from_year?.name ?? 'previous year'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">Carried forward</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(a.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{formatCurrency(a.amount_paid)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-destructive">{formatCurrency(a.amount_due)}</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader><CardTitle>Payment history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!payments.length ? (
            <EmptyState icon={Receipt} title="No payments yet" description="Receipts appear here once a payment is taken." className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(p => {
                    const cancelled = p.status === 'cancelled'
                    const refunded = Number(p.refunded_amount ?? 0)
                    // What the school actually still holds from this transaction.
                    const net = Number(p.amount) - refunded
                    return (
                      <TableRow key={p.id} className={cn('cursor-default', cancelled && 'opacity-60')}>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(p.payment_date)}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{p.receipt_number}</span>
                          {Number(p.unallocated_amount ?? 0) > 0 && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatCurrency(p.unallocated_amount)} held as advance
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm capitalize">{p.method}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn('font-semibold tabular-nums', cancelled ? 'text-muted-foreground line-through' : 'text-success')}>
                            {formatCurrency(net)}
                          </span>
                          {refunded > 0 && (
                            <span className="block text-[11px] text-warning">
                              {formatCurrency(refunded)} refunded
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Print receipt">
                              <Link href={`/fees/receipts?open=${p.id}`}><Printer className="h-3.5 w-3.5" /></Link>
                            </Button>
                            {/* A cancelled receipt has nothing left to cancel or
                                refund, and a fully refunded one has nothing left
                                to give back. */}
                            {/* Only an instrument a bank can return. Cash does
                                not bounce, and offering it would invite the
                                action to be used as a general-purpose undo. */}
                            {canCollect && !cancelled && net > 0 && ['cheque', 'dd'].includes(p.method) && (
                              <Button
                                size="sm" variant="ghost" className="h-8 text-xs text-warning hover:text-warning"
                                onClick={() => setBounceTarget(p)}
                              >
                                <Undo2 className="h-3 w-3" /> Bounced
                              </Button>
                            )}
                            {canCollect && !cancelled && net > 0 && (
                              <>
                                <Button
                                  size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive"
                                  onClick={() => setRequestTarget({
                                    kind: 'payment_cancel', id: p.id,
                                    label: `Cancel receipt ${p.receipt_number} (${formatCurrency(net)})`,
                                  })}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => setRequestTarget({
                                    kind: 'refund', id: p.id, max: net,
                                    label: `Refund against receipt ${p.receipt_number}`,
                                  })}
                                >
                                  Refund
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {requestTarget && (
        <RequestDialog target={requestTarget} onClose={() => setRequestTarget(null)} />
      )}
      {bounceTarget && (
        <BounceDialog payment={bounceTarget} onClose={() => setBounceTarget(null)} />
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  late_fee_waiver: 'Late fee waiver',
  payment_cancel: 'Payment cancellation',
  refund: 'Refund',
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

/** Who to phone. Reads from the student record rather than the fee tables. */
function GuardianCard({ studentId }: { studentId: string }) {
  const { data } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => import('@/lib/api').then(m => m.studentsApi.get(studentId)).then((r: any) => r.data),
  })

  const parents: any[] = data?.parents ?? []
  const contacts = parents.flatMap(p => [
    p.father_name && { name: p.father_name, relation: 'Father', phone: p.father_phone, email: p.father_email },
    p.mother_name && { name: p.mother_name, relation: 'Mother', phone: p.mother_phone, email: p.mother_email },
    p.guardian_name && { name: p.guardian_name, relation: 'Guardian', phone: p.guardian_phone, email: null },
  ].filter(Boolean)) as any[]

  if (!contacts.length) return null

  return (
    <Card>
      <CardHeader><CardTitle>Parent / guardian</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {contacts.map((g, i) => (
          <div key={i} className="rounded-xl border border-border p-3">
            <p className="text-sm font-medium text-foreground">
              {g.name} <span className="text-xs font-normal text-muted-foreground">({g.relation})</span>
            </p>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {/* tel: and mailto: — chasing a due ends in a phone call, and
                  retyping a number off a screen is where mistakes happen. */}
              {g.phone && (
                <a href={`tel:${g.phone}`} className="inline-flex w-fit items-center gap-1 hover:text-primary hover:underline">
                  <Phone className="h-3 w-3" /> {g.phone}
                </a>
              )}
              {g.email && (
                <a href={`mailto:${g.email}`} className="inline-flex w-fit items-center gap-1 hover:text-primary hover:underline">
                  <Mail className="h-3 w-3" /> {g.email}
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Recording a dishonoured cheque.
 *
 * Distinct from cancelling, and the dialog says so: cancelling asserts the money
 * never arrived, a bounce asserts it arrived, was credited to the family, and the
 * bank then took it back. The allocations are reversed, so every invoice the
 * cheque settled goes back to being owed.
 *
 * Unlike a waiver or a refund this is NOT routed for approval — it is not a
 * decision the school is making, it is a fact the bank has reported, and holding
 * it in a queue would leave the family showing as paid on money nobody has.
 */
function BounceDialog({ payment, onClose }: { payment: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [fee, setFee] = useState('')
  const [loading, setLoading] = useState(false)

  const net = Number(payment.amount) - Number(payment.refunded_amount ?? 0)

  const submit = async () => {
    setLoading(true)
    try {
      const res = await feeApi.payments.bounce(payment.id, {
        reason: reason.trim() || undefined,
        bounce_fee: Number(fee) || 0,
      })
      toast.success(
        `${formatCurrency(res.data.reversed)} reversed`,
        { description: res.meta?.note },
      )
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not record the bounce')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={`Mark ${payment.receipt_number} as bounced?`}
      description={`${formatCurrency(net)} by ${payment.method}${payment.cheque_number ? ` · cheque ${payment.cheque_number}` : ''}`}
      destructive
      confirmLabel="Record bounce"
      loading={loading}
      onConfirm={submit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="bounce-reason">What did the bank say?</Label>
          <Input
            id="bounce-reason" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Insufficient funds, signature mismatch…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bounce-fee">Bank charge to pass on</Label>
          <Input
            id="bounce-fee" type="number" inputMode="decimal" value={fee}
            onChange={e => setFee(e.target.value)} placeholder="0"
          />
          <p className="text-xs text-muted-foreground">
            Recorded against this receipt. Raise it as a one-off charge to actually bill it.
          </p>
        </div>
        <Alert variant="warning" title="The dues come back">
          Every invoice this receipt settled returns to being owed, and the ledger
          entries are reversed. This is not a cancellation — the record of the
          cheque and its bounce both stay on the account.
        </Alert>
      </div>
    </ConfirmDialog>
  )
}

function RequestDialog({
  target, onClose,
}: {
  target: { kind: 'late_fee_waiver' | 'payment_cancel' | 'refund'; id: string; label: string; max?: number }
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState(target.max != null ? String(target.max) : '')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (reason.trim().length < 3) return toast.error('Give a reason — it is what the approver decides on')
    setLoading(true)
    try {
      await feeApi.requests.create({
        kind: target.kind,
        target_id: target.id,
        reason: reason.trim(),
        ...(target.kind === 'refund' && amount ? { amount: Number(amount) } : {}),
      })
      toast.success('Request raised — it needs an approver before it takes effect')
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not raise the request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={KIND_LABEL[target.kind]}
      description={target.label}
      confirmLabel="Raise request"
      loading={loading}
      onConfirm={submit}
    >
      <div className="space-y-4">
        {target.kind === 'refund' && (
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Amount to refund *</Label>
            <Input
              id="refund-amount" type="number" value={amount}
              onChange={e => setAmount(e.target.value)}
              max={target.max}
            />
            {target.max != null && (
              <p className="text-xs text-muted-foreground">Up to {formatCurrency(target.max)}</p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="req-reason">Reason *</Label>
          <Textarea
            id="req-reason" rows={2} className="resize-none" value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="What happened, and why should this be approved?"
          />
        </div>
        <Alert variant="info" title="Nothing changes yet">
          This is a request. The money only moves once someone with fee-management
          rights approves it — and it cannot be you.
        </Alert>
      </div>
    </ConfirmDialog>
  )
}
