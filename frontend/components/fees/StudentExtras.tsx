'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bus, CalendarClock, Check, Plus, Loader2, Receipt, X } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, adhocFeeApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { CheckboxField } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// ── Optional fees ─────────────────────────────────────────────────────
//
// The screen that makes fee_structure_lines.is_optional mean something. The flag
// was inert: an optional transport line was billed to every child on the plan
// whether or not they took the bus, because nothing recorded who had.
//
// An optional line bills NOBODY until there is an opt-in row here — the safe
// default, and why the flag needed no backfill. Toggling does not touch invoices
// already raised, only what the next billing run picks up. Said out loud on the
// card, because "I opted them out and last month still shows it" is the obvious
// next question.
//
// Opting in is also a decision about TIMING, and that half used to be invisible:
// every line read "₹2,000" with no way to tell a monthly bus fare from a kit
// charged once in Q1, and no warning for the one case that quietly does nothing
// — adding a line after the only installment it bills in has been raised. Both
// are now on the row, and the dead case offers the thing that does work: a
// one-off charge.

/** How the plan bills, phrased for a per-installment amount. */
const EACH_INSTALLMENT: Record<string, string> = {
  monthly: 'each month',
  quarterly: 'each quarter',
  half_yearly: 'each half-year',
  annually: 'for the year',
  one_time: 'once',
}

/** "₹1,500 each month" vs "₹2,000 once, in Quarter 1 (Apr–Jun)". */
function chargeSummary(row: any, frequency?: string): string {
  const amount = formatCurrency(row.amount)
  // No periods resolved at all means the plan's year could not be read — say the
  // amount and nothing more rather than inventing a cadence for it.
  if (row.recurs || !row.periods.length) {
    return `${amount} ${EACH_INSTALLMENT[frequency ?? ''] ?? 'each installment'}`
  }
  const when = row.periods.map((p: any) => p.label).join(', ')
  return row.periods.length === 1
    ? `${amount} once, in ${when}`
    : `${amount} in each of: ${when}`
}

/** The installments a period-limited line bills in, and which are already out. */
function PeriodChips({ periods }: { periods: any[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {periods.map(p => (
        <span
          key={p.token}
          title={p.billed ? `${p.label} has been invoiced for this student` : `${p.label} is not billed yet`}
          className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
            p.billed
              ? 'border-border bg-muted text-muted-foreground'
              : 'border-primary/40 bg-primary/10 text-primary')}
        >
          {p.billed && <Check className="h-3 w-3" />}
          {p.label}
          {p.billed && ' billed'}
        </span>
      ))}
    </span>
  )
}

export function OptionalFeesCard({ studentId, studentName }: { studentId: string; studentName?: string }) {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const [busy, setBusy] = useState<string | null>(null)
  // A line whose window has passed cannot be opted into usefully, so the row
  // hands the work to the mechanism that does work: a one-off charge, prefilled.
  const [chargeInstead, setChargeInstead] = useState<any>(null)
  const canManage = can('fee.structure_manage')

  const { data, isPending } = useQuery({
    queryKey: ['fee-optional', studentId],
    // The whole envelope: meta carries the plan's cadence, which is what turns
    // a bare amount into "₹1,500 each quarter".
    queryFn: () => feeApi.assignments.optionals(studentId),
  })

  const rows: any[] = data?.data ?? []
  const frequency: string | undefined = data?.meta?.frequency ?? undefined

  // Empty means either no plan or a plan with no optional lines. Neither is worth
  // a card telling the user nothing.
  if (!isPending && !rows.length) return null

  const toggle = async (row: any) => {
    setBusy(row.structure_line_id)
    try {
      if (row.opted_in) {
        await feeApi.assignments.optOut(studentId, row.structure_line_id)
        toast.success(`${row.name} stopped`, {
          description: 'Invoices already raised keep it; nothing further will be charged.',
        })
      } else {
        // The server says which installment picks it up — the same calculation
        // the row shows, so the toast cannot claim something different.
        const res = await feeApi.assignments.optIn(studentId, row.structure_line_id)
        toast.success(`${row.name} added`, { description: res?.meta?.note })
      }
      invalidateFeeQueries(qc)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not change this')
    } finally {
      setBusy(null)
    }
  }

  const taken = rows.filter(r => r.opted_in)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bus className="h-4 w-4 text-muted-foreground" /> Optional fees
        </CardTitle>
        <p className="mt-0.5 text-sm text-muted-foreground">
          On this student&apos;s plan but billed only to the children who take them.
          {taken.length > 0 && ` Currently taking ${taken.length}.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          rows.map(row => {
            // Every installment this line could bill in is already invoiced, so
            // adding it changes nothing — this year or ever.
            const dead = row.window_passed && !row.opted_in
            return (
              <div
                key={row.structure_line_id}
                className={cn(
                  'space-y-2 rounded-xl border p-3 transition-colors',
                  row.opted_in ? 'border-primary/40 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      {row.name}
                      {/* The distinction the old row hid: an amount charged every
                          installment reads very differently from the same amount
                          charged once. */}
                      {!row.recurs && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          {row.periods.length === 1 ? 'one installment only' : 'named installments'}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chargeSummary(row, frequency)}
                      {row.opted_in && row.opted_in_at ? ` · taken ${formatDate(row.opted_in_at)}` : ''}
                      {row.note ? ` · ${row.note}` : ''}
                    </p>
                    {!row.recurs && row.periods.length > 0 && <PeriodChips periods={row.periods} />}
                  </div>

                  {canManage ? (
                    <div className="flex items-center gap-2">
                      {dead ? (
                        // Not disabled-with-no-recourse: the school still wants to
                        // charge for the thing, and this is the route that bills.
                        <Button size="sm" variant="secondary" onClick={() => setChargeInstead(row)}>
                          <Receipt className="h-3.5 w-3.5" /> Charge once
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={row.opted_in ? 'outline' : 'default'}
                          onClick={() => toggle(row)}
                          disabled={busy === row.structure_line_id}
                        >
                          {busy === row.structure_line_id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {row.opted_in ? 'Stop' : 'Add'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {row.opted_in ? 'Taking' : 'Not taking'}
                    </span>
                  )}
                </div>

                {/* What actually happens next, per row. The generic footnote below
                    could not say this: it depends on which installments the line
                    bills in and which of them are already out. */}
                {dead ? (
                  // text-warning on a tinted ground, not -foreground: the
                  // foreground token is white, which would vanish here.
                  <p className="flex items-start gap-1.5 rounded-lg border border-warning/20 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {row.periods.length === 1
                        ? `${row.periods[0].label} has already been invoiced, so adding this now would charge nothing.`
                        : 'Every installment this is charged in has already been invoiced, so adding it now would charge nothing.'}
                      {' '}Raise it as a one-off charge instead.
                    </span>
                  </p>
                ) : row.opted_in ? (
                  <p className="text-xs text-muted-foreground">
                    {row.next_period
                      ? `Will be charged when ${row.next_period.label} is billed.`
                      : 'Nothing further to charge this year.'}
                  </p>
                ) : row.next_period ? (
                  <p className="text-xs text-muted-foreground">
                    Adding it charges {formatCurrency(row.amount)} when {row.next_period.label} is billed
                    {row.recurs ? ', and in every installment after that.' : '.'}
                  </p>
                ) : null}
              </div>
            )
          })
        )}
        <p className="pt-0.5 text-xs text-muted-foreground">
          Nothing here is back-dated. Changes apply from the next billing run, and
          invoices already raised keep the lines they were issued with.
        </p>
      </CardContent>

      {chargeInstead && (
        <AddChargeDialog
          studentId={studentId}
          studentName={studentName}
          defaultTitle={chargeInstead.name}
          defaultAmount={String(chargeInstead.amount)}
          onClose={() => { setChargeInstead(null); invalidateFeeQueries(qc) }}
        />
      )}
    </Card>
  )
}

// ── One-off charges ───────────────────────────────────────────────────
//
// A field trip, a replaced textbook, a re-exam fee. The endpoints have existed
// since before this release with no screen reaching them, so the only way to
// charge one student for one thing was a direct API call.

export function AdhocChargesCard({ studentId, studentName }: { studentId: string; studentName?: string }) {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const [adding, setAdding] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [billing, setBilling] = useState<string | null>(null)

  const bill = async (row: any) => {
    setBilling(row.id)
    try {
      const res = await adhocFeeApi.bill(row.id)
      toast.success(`Invoice ${res.data?.invoice_number} raised — collect it under Collect`)
      invalidateFeeQueries(qc)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not raise an invoice')
    } finally {
      setBilling(null)
    }
  }
  const canManage = can('fee.structure_manage')

  const { data, isPending } = useQuery({
    queryKey: ['fee-adhoc', studentId],
    queryFn: () => adhocFeeApi.list({ student_id: studentId }).then(r => r.data as any[]),
  })

  const rows = (data ?? []).filter(r => r.status !== 'cancelled')

  const cancel = async () => {
    if (!cancelTarget) return
    setBusy(true)
    try {
      await adhocFeeApi.cancel(cancelTarget.id)
      toast.success('Charge cancelled')
      invalidateFeeQueries(qc)
      setCancelTarget(null)
    } catch (e: any) {
      // 409 when money has already been paid against it — a refund has to come
      // first, or the family is left having paid for something withdrawn.
      toast.error(e?.response?.data?.error ?? 'Could not cancel the charge')
    } finally {
      setBusy(false)
    }
  }

  if (!canManage && !rows.length && !isPending) return null

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" /> One-off charges
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Anything outside the fee structure — a trip, a lost book, a re-exam.
            Each one is raised as an invoice, so it is collected and receipted like
            any other fee.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add a charge
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : !rows.length ? (
          <p className="py-3 text-sm text-muted-foreground">No one-off charges.</p>
        ) : (
          rows.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{row.title}</p>
                <p className="text-xs text-muted-foreground">
                  {row.description ? `${row.description} · ` : ''}
                  {row.due_date ? `due ${formatDate(row.due_date)}` : 'no due date'}
                  {' · '}<span className="capitalize">{row.status}</span>
                  {!row.invoice_id && row.status !== 'paid' && (
                    <span className="text-warning"> · not billed yet</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-semibold tabular-nums',
                  row.status === 'paid' ? 'text-success' : 'text-foreground')}>
                  {formatCurrency(row.amount)}
                </span>
                {canManage && row.status !== 'paid' && (
                  <>
                    {row.invoice_id ? (
                      // Already an invoice line — it is collected at the counter
                      // like anything else, so there is nothing to mark here.
                      <span className="text-xs text-muted-foreground">On invoice</span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => bill(row)} disabled={billing === row.id}>
                        {billing === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Bill it
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setCancelTarget(row)} aria-label="Cancel charge">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>

      {adding && (
        <AddChargeDialog
          studentId={studentId} studentName={studentName}
          onClose={() => { setAdding(false); invalidateFeeQueries(qc) }}
        />
      )}
      {cancelTarget && (
        <ConfirmDialog
          open onOpenChange={o => { if (!o) setCancelTarget(null) }}
          title={`Cancel "${cancelTarget.title}"?`}
          description={cancelTarget.invoice_id
            ? 'The charge is dropped and its invoice voided with it, so the family stops owing for something the school has withdrawn.'
            : 'The charge is dropped from what the family owes.'}
          destructive
          confirmLabel="Cancel charge"
          loading={busy}
          onConfirm={cancel}
        />
      )}
    </Card>
  )
}

function AddChargeDialog({
  studentId, studentName, defaultTitle, defaultAmount, onClose,
}: {
  studentId: string
  studentName?: string
  /** Prefilled when an optional line's window has passed and this is the way to bill it. */
  defaultTitle?: string
  defaultAmount?: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(defaultAmount ?? '')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)

  const value = Number(amount)
  const valid = title.trim().length > 1 && Number.isFinite(value) && value > 0

  const submit = async () => {
    if (!valid) return toast.error('A title and an amount above zero are required')
    setLoading(true)
    try {
      const res = await adhocFeeApi.create({
        student_id: studentId,
        title: title.trim(),
        description: description.trim() || undefined,
        amount: value,
        due_date: dueDate || undefined,
      })
      toast.success(`${formatCurrency(value)} charge added`, {
        description: res.invoice
          ? `Invoice ${res.invoice.invoice_number} raised — collect it like any other fee`
          : undefined,
      })
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not add the charge')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a one-off charge</DialogTitle>
          <DialogDescription>
            {studentName ? `For ${studentName}. ` : ''}An invoice is raised for it
            straight away, so it is collected and receipted like any other fee.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="charge-title">What is it for? *</Label>
            <Input id="charge-title" autoFocus value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Delhi trip, replacement textbook" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="charge-amount">Amount *</Label>
            <Input id="charge-amount" type="number" inputMode="decimal" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="500" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="charge-due">Due date</Label>
            <Input id="charge-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="charge-desc">Note</Label>
            <Input id="charge-desc" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Optional" />
          </div>
          <Alert variant="info" title="An invoice is raised for this">
            It becomes a normal invoice line, so it can be collected at the counter
            and appears on the receipt — rather than only being markable as paid.
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Add charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
