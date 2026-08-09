'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Printer, Wallet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { invoiceHeads, invoiceTitle } from '@/lib/fees'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'

// Collect, as a page rather than a modal.
//
// A modal forces a choice: show the dues or show the form. At a counter you need
// both — the parent is asking "what is this for" while the cashier types. So the
// dues sit beside the amount field, and the amount defaults to the whole
// position because that is what is being handed over most of the time.
//
// ONE amount, ONE receipt. The server splits it across the open invoices
// oldest-first and records an allocation per invoice it settles. A parent handing
// over ₹5,000 cannot be expected to know which of three invoices it belongs to,
// and should not walk away with three receipt numbers for one handover.

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'neft', label: 'NEFT' },
  { value: 'card', label: 'Card' },
  { value: 'dd', label: 'Demand draft' },
  { value: 'online', label: 'Online' },
] as const

export default function CollectPaymentPage() {
  const { studentId } = useParams<{ studentId: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [reference, setReference] = useState('')
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [bankName, setBankName] = useState('')
  const [notes, setNotes] = useState('')
  // Which invoices this money may settle. Empty = everything open, which is the
  // default and the overwhelmingly common case.
  const [restrictTo, setRestrictTo] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<any>(null)

  const { data, isPending } = useQuery({
    queryKey: ['fee-student-summary', studentId],
    queryFn: () => feeApi.student(studentId).then(r => r.data),
  })

  // Oldest first — the same order the server settles them in, so the table reads
  // as the sequence the money will actually be applied in.
  const invoices: any[] = useMemo(() => (data?.invoices ?? [])
    .filter((i: any) => i.status === 'unpaid' || i.status === 'partial')
    .slice()
    .sort((a: any, b: any) =>
      String(a.due_date ?? a.invoice_date ?? '').localeCompare(String(b.due_date ?? b.invoice_date ?? ''))),
    [data])

  const invoiceDue = data?.summary?.invoiceDue ?? 0
  const advanceHeld = data?.summary?.advanceHeld ?? 0

  const selected = restrictTo.length ? invoices.filter(i => restrictTo.includes(i.id)) : invoices
  const targetDue = restrictTo.length
    ? selected.reduce((s, i) => s + Number(i.amount_due), 0)
    : invoiceDue

  // Default to the position once it loads — in an effect, so a cashier who has
  // started typing isn't overwritten by a refetch.
  useEffect(() => {
    if (!done && amount === '' && targetDue > 0) setAmount(String(targetDue))
  }, [targetDue, amount, done])

  const entered = Number(amount)
  const valid = Number.isFinite(entered) && entered > 0
  // Overpayment is accepted and held as advance credit rather than refused: a
  // parent paying ahead is normal, and turning them away at the counter is worse
  // than carrying a credit balance.
  const advance = valid ? Math.max(0, entered - targetDue) : 0
  const settling = valid ? Math.min(entered, targetDue) : 0
  const remainder = Math.max(0, targetDue - settling)

  const student = data?.student
  const name = `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim()

  const toggleInvoice = (id: string) => {
    setRestrictTo(prev => {
      const current = prev.length ? prev : invoices.map(i => i.id)
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
      // Back to "all selected" is expressed as no restriction, so the server does
      // its own oldest-first resolution rather than being handed a frozen list.
      return next.length === invoices.length ? [] : next
    })
    setAmount('')
  }

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const res = await feeApi.payments.collect({
        student_id: studentId,
        amount: entered,
        method,
        reference: method !== 'cash' && method !== 'cheque' ? reference || undefined : undefined,
        cheque_number: method === 'cheque' ? chequeNumber || undefined : undefined,
        cheque_date: method === 'cheque' ? chequeDate || undefined : undefined,
        bank_name: method === 'cheque' || method === 'dd' ? bankName || undefined : undefined,
        notes: notes || undefined,
        invoice_ids: restrictTo.length ? restrictTo : undefined,
      })
      setDone(res.data)
      invalidateFeeQueries(qc)
      toast.success(`${formatCurrency(entered)} collected · receipt ${res.data.receipt_number}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not record the payment')
    } finally {
      setSaving(false)
    }
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground">
          <Link href={`/fees/collect/student/${studentId}`}><ArrowLeft className="h-3.5 w-3.5" /> Back to student</Link>
        </Button>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Collect payment</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[name, student?.admission_number, [student?.classes?.name, student?.sections?.name].filter(Boolean).join('-')]
            .filter(Boolean).join(' · ')}
        </p>
      </div>

      {done && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {formatCurrency(done.amount)} collected · receipt {done.receipt_number}
              </p>
              <p className="text-xs text-muted-foreground">
                {done.settled_invoices?.length
                  ? `Settled ${done.settled_invoices.length} invoice${done.settled_invoices.length === 1 ? '' : 's'}`
                  : 'Held entirely as advance credit'}
                {done.advance > 0 && ` · ${formatCurrency(done.advance)} kept as advance`}
                {/* The student's WHOLE position, refetched — not the response's
                    remaining_outstanding, which counts only the invoices this
                    payment was restricted to. Reading "₹0 outstanding" off a
                    one-invoice payment is how a family gets told they are clear
                    when two older bills are still open. */}
                {invoiceDue > 0 && ` · ${formatCurrency(invoiceDue)} still outstanding`}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/fees/receipts?open=${done.payment_id}`}>
                  <Printer className="h-3.5 w-3.5" /> Print receipt
                </Link>
              </Button>
              <Button size="sm" onClick={() => router.push(`/fees/collect/student/${studentId}`)}>Done</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Outstanding dues</CardTitle>
            {restrictTo.length > 0 && (
              <button
                type="button"
                onClick={() => { setRestrictTo([]); setAmount('') }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Pay against everything
              </button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {!invoices.length ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Nothing outstanding.{' '}
                {/* Not a dead end: a family can still pay ahead, and the credit is
                    applied automatically by the next billing run. */}
                Anything taken now is held as advance credit.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {/* No point offering a restriction when there is only one
                          thing to restrict to — the tick would do nothing. */}
                      {invoices.length > 1 && <TableHead className="w-10" />}
                      <TableHead>Item</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map(inv => {
                      const isOn = !restrictTo.length || restrictTo.includes(inv.id)
                      return (
                        <TableRow key={inv.id} className={cn('cursor-default', !isOn && 'opacity-50')}>
                          {invoices.length > 1 && (
                            <TableCell>
                              <Checkbox
                                checked={isOn}
                                onChange={() => toggleInvoice(inv.id)}
                                aria-label={`Settle ${inv.invoice_number}`}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            {/* The cashier is reading this out loud to whoever
                                is handing over the money — it has to name the
                                term and the heads, not just the reference. */}
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
                          <TableCell className="text-right font-semibold tabular-nums text-destructive">
                            {formatCurrency(inv.amount_due)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              Payments settle the oldest dues first, so late fees stop accruing on
              the earliest invoice before anything newer is touched. Untick a row to
              keep this payment off it.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {restrictTo.length ? `Outstanding on ${restrictTo.length} selected` : 'Outstanding on invoices'}
              </p>
              <p className="text-2xl font-bold tabular-nums text-destructive">{formatCurrency(targetDue)}</p>
            </div>

            {advanceHeld > 0 && (
              // A family that already has credit sitting on their account should
              // not be asked for the full amount again.
              <Alert variant="info" title={`${formatCurrency(advanceHeld)} advance already held`}>
                It is applied automatically when the next invoice is raised.
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount *</Label>
              <Input
                id="amount" type="number" inputMode="decimal" value={amount}
                onChange={e => setAmount(e.target.value)}
                className={cn(!valid && amount !== '' && 'border-destructive focus-visible:ring-destructive')}
              />
              {targetDue > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[
                    { label: 'Full', value: targetDue },
                    { label: 'Half', value: Math.round(targetDue / 2) },
                  ].map(q => (
                    <button
                      key={q.label} type="button" onClick={() => setAmount(String(q.value))}
                      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {q.label} · {formatCurrency(q.value)}
                    </button>
                  ))}
                </div>
              )}
              {!valid && amount !== '' && (
                <p className="text-xs font-medium text-destructive">Enter an amount greater than zero.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {method === 'cheque' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cheque">Cheque number</Label>
                  <Input id="cheque" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cheque-date">Cheque date</Label>
                  <Input id="cheque-date" type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} />
                </div>
              </div>
            )}
            {(method === 'cheque' || method === 'dd') && (
              <div className="space-y-1.5">
                <Label htmlFor="bank">Bank</Label>
                <Input id="bank" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Drawn on" />
              </div>
            )}
            {method !== 'cash' && method !== 'cheque' && (
              <div className="space-y-1.5">
                <Label htmlFor="ref">Reference</Label>
                <Input id="ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR / reference" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            {remainder > 0.01 && (
              <Alert variant="warning" title="Part payment">
                {formatCurrency(remainder)} stays outstanding. A receipt is still
                issued for {formatCurrency(entered)}.
              </Alert>
            )}
            {advance > 0.01 && (
              <Alert variant="info" title={`${formatCurrency(advance)} held as advance`}>
                That is more than is outstanding. The excess sits as credit on the
                account and is applied to the next invoice raised.
              </Alert>
            )}

            <Button className="w-full" onClick={submit} disabled={!valid || saving || !!done}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {done ? 'Collected' : `Collect ${valid ? formatCurrency(entered) : ''}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
