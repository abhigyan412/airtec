'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Landmark, Loader2, Plus, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, academicYearsApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// What the state owes the school.
//
// Every other figure in this module is money a family owes. This one is not, and
// that distinction is the reason the screen exists: an RTE child is admitted free
// under §12(1)(c) and the state reimburses at ITS rate, on its own timetable,
// which is late often enough that schools track it as a receivable. Before this
// the amount simply vanished — the seat either showed as a parent's arrears or,
// once a concession rule zeroed it, as nothing at all.

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  submitted: 'bg-primary/10 text-primary',
  received: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
}

export function RteClaims() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('fee.structure_manage')
  const [generating, setGenerating] = useState(false)
  const [settling, setSettling] = useState<any>(null)

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data as any[]),
  })
  const yearId = (years ?? []).find((y: any) => y.is_current)?.id ?? (years ?? [])[0]?.id

  const { data: summary } = useQuery({
    queryKey: ['rte-summary', yearId],
    queryFn: () => feeApi.rte.summary(yearId),
    enabled: !!yearId,
  })
  const { data: claims, isPending, error } = useQuery({
    queryKey: ['rte-claims', yearId],
    queryFn: () => feeApi.rte.claims({ academic_year_id: yearId }),
    enabled: !!yearId,
  })

  const rows: any[] = claims?.data ?? []
  const meta = claims?.meta ?? {}
  const seats = summary?.meta?.rte_seats ?? 0

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted-foreground" /> RTE reimbursement
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {seats} seat{seats === 1 ? '' : 's'} on the RTE category · what the state
              owes, at the state&apos;s rate
            </p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setGenerating(true)}>
              <Plus className="h-3.5 w-3.5" /> Raise claims for a period
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Said once, at the top, because it is the entire point of separating
              this from the fee ledger. */}
          <Alert variant="info" title="Not a family debt">
            An RTE child is admitted free. Everything below is owed to the school by
            the state — it never appears on the defaulters list and no parent is
            reminded about it.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Claimed" value={meta.total_claimed ?? 0} />
            <Figure label="Received" value={meta.total_received ?? 0} tone="success" />
            <Figure label="Still owed by the state" value={meta.outstanding ?? 0} tone="destructive" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Claims</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : error ? (
            <QueryError error={error} title="Could not load the RTE claims" />
          ) : !rows.length ? (
            <EmptyState
              icon={Landmark}
              title="No claims raised yet"
              description={seats
                ? 'Set the state rate for each class band, then raise claims for a period.'
                : 'Nobody is on the RTE category for this year. Tag them under Categories first.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Student</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Claimed</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(c => {
                    // A short payment is common enough that it needs its own
                    // visual state — "received" alone would imply settled.
                    const short = c.status === 'received'
                      ? Number(c.claim_amount) - Number(c.received_amount ?? 0)
                      : 0
                    return (
                      <TableRow key={c.id} className="cursor-default">
                        <TableCell>
                          <p className="font-medium text-foreground">
                            {c.students?.first_name} {c.students?.last_name}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.students?.classes?.name}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {String(c.period_key).split(':')[1] ?? c.period_key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-foreground">
                          {formatCurrency(c.claim_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          {c.received_amount != null ? formatCurrency(c.received_amount) : '—'}
                          {short > 0 && (
                            <span className="block text-[11px] font-medium text-warning">
                              {formatCurrency(short)} short
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium',
                            STATUS_STYLE[c.status] ?? 'bg-muted text-muted-foreground')}>
                            {c.status}
                          </span>
                          {c.received_on && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatDate(c.received_on)}
                            </span>
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            {c.status !== 'received' && (
                              <Button size="sm" variant="ghost" className="h-8 text-xs"
                                onClick={() => setSettling(c)}>
                                Update
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && <RteRates academicYearId={yearId} />}

      {generating && (
        <GenerateClaimsDialog
          academicYearId={yearId}
          onClose={() => { setGenerating(false); qc.invalidateQueries({ queryKey: ['rte-claims'] }); qc.invalidateQueries({ queryKey: ['rte-summary'] }) }}
        />
      )}
      {settling && (
        <SettleClaimDialog
          claim={settling}
          onClose={() => { setSettling(null); qc.invalidateQueries({ queryKey: ['rte-claims'] }); qc.invalidateQueries({ queryKey: ['rte-summary'] }) }}
        />
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'destructive' }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-2xl font-bold tabular-nums',
        tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground')}>
        {formatCurrency(value)}
      </p>
    </div>
  )
}

// ── The state's rate schedule ─────────────────────────────────────────

function RteRates({ academicYearId }: { academicYearId?: string }) {
  const qc = useQueryClient()
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('5')
  const [monthly, setMonthly] = useState('')
  const [allowance, setAllowance] = useState('')

  const { data } = useQuery({
    queryKey: ['rte-rates', academicYearId],
    queryFn: () => feeApi.rte.rates(academicYearId),
    enabled: !!academicYearId,
  })
  const rows: any[] = data?.data ?? []

  const save = useMutation({
    mutationFn: () => feeApi.rte.saveRate({
      academic_year_id: academicYearId,
      class_from: Number(from), class_to: Number(to),
      monthly_amount: Number(monthly) || 0,
      annual_allowance: Number(allowance) || 0,
    }),
    onSuccess: () => {
      toast.success('Rate saved')
      setMonthly(''); setAllowance('')
      qc.invalidateQueries({ queryKey: ['rte-rates'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save the rate'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => feeApi.rte.removeRate(id),
    onSuccess: () => { toast.success('Rate removed'); qc.invalidateQueries({ queryKey: ['rte-rates'] }) },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>The state&apos;s rate</CardTitle>
        <p className="text-sm text-muted-foreground">
          Per child per month, from the state notification for this year — not the
          school&apos;s own fee. Claims are computed from these.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="rte-from">Class from</Label>
            <Input id="rte-from" type="number" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rte-to">Class to</Label>
            <Input id="rte-to" type="number" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rte-monthly">₹ per month</Label>
            <Input id="rte-monthly" type="number" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="2242" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rte-allow">Annual allowance</Label>
            <Input id="rte-allow" type="number" value={allowance} onChange={e => setAllowance(e.target.value)} placeholder="1100" />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || !monthly}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save band
            </Button>
          </div>
        </div>

        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            No rates set. Claims cannot be raised until at least one band exists —
            a child in a class with no rate is reported as skipped rather than
            claimed at zero.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Classes</TableHead>
                <TableHead className="text-right">Per month</TableHead>
                <TableHead className="text-right">Annual allowance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-default">
                  <TableCell className="font-medium text-foreground">
                    {r.class_from === r.class_to ? `Class ${r.class_from}` : `Classes ${r.class_from}–${r.class_to}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(r.monthly_amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.annual_allowance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label="Remove band" onClick={() => remove.mutate(r.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Raising a period's claims ─────────────────────────────────────────

function GenerateClaimsDialog({ academicYearId, onClose }: { academicYearId?: string; onClose: () => void }) {
  const [token, setToken] = useState('Q1')
  const [allowance, setAllowance] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const { data: periodData } = useQuery({
    queryKey: ['fee-billing-periods', academicYearId, 'quarterly'],
    queryFn: () => feeApi.billing.periods(academicYearId!, 'quarterly').then(r => r.data as any[]),
    enabled: !!academicYearId,
  })
  const periods: any[] = (periodData ?? []).find((g: any) => g.frequency === 'quarterly')?.periods ?? []

  const body = (isPreview: boolean) => ({
    academic_year_id: academicYearId,
    frequency: 'quarterly',
    period_token: token,
    include_annual_allowance: allowance,
    preview: isPreview,
  })

  const run = async (isPreview: boolean) => {
    setBusy(true)
    try {
      const res = await feeApi.rte.generate(body(isPreview))
      if (isPreview) return setPreview(res.data)
      const n = res.data.generated ?? 0
      if (!n) toast.info(res.data.message ?? 'Nothing to claim')
      else toast.success(`${n} claim${n === 1 ? '' : 's'} raised — ${formatCurrency(res.data.total)}`)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not raise the claims')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise RTE claims</DialogTitle>
          <DialogDescription>
            One claim per RTE child for the period, priced from the state&apos;s rate.
            Re-running is safe — a child already claimed for is skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select value={token} onValueChange={v => { setPreview(null); setToken(v) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {periods.map(p => <SelectItem key={p.token} value={p.token}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={allowance}
              onChange={e => { setPreview(null); setAllowance(e.target.checked) }} />
            <span>
              Include the annual uniform/books allowance
              <span className="block text-xs text-muted-foreground">
                Claimed once a year, so tick this on one period only.
              </span>
            </span>
          </label>

          <Button variant="outline" className="w-full" onClick={() => run(true)} disabled={busy}>
            {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Preview
          </Button>

          {preview && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {preview.would_generate} claim{preview.would_generate === 1 ? '' : 's'}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(preview.total)} over {preview.period?.months} month
                {preview.period?.months === 1 ? '' : 's'}
              </p>
              {!!preview.skipped?.length && (
                <Alert variant="warning" title={`${preview.skipped.length} skipped`}>
                  {/* Named, because a child with no rate band is money the school
                      would otherwise never claim and never notice missing. */}
                  {preview.skipped.slice(0, 5).map((s: any, i: number) => (
                    <span key={i} className="block">
                      {s.student} — {s.reason === 'no_rate_for_class'
                        ? `no state rate set for ${s.class ?? 'their class'}`
                        : 'already claimed for this period'}
                    </span>
                  ))}
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => run(false)} disabled={busy || !preview || !preview.would_generate}>
            {busy && preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Raise {preview?.would_generate ?? 0} claim{preview?.would_generate === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Recording what the state actually paid ────────────────────────────

function SettleClaimDialog({ claim, onClose }: { claim: any; onClose: () => void }) {
  const [status, setStatus] = useState<string>(claim.status === 'pending' ? 'submitted' : 'received')
  const [amount, setAmount] = useState(String(claim.claim_amount))
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await feeApi.rte.updateClaim(claim.id, {
        status,
        reference: reference || undefined,
        ...(status === 'received'
          ? { received_amount: Number(amount) || 0, received_on: new Date().toISOString().slice(0, 10) }
          : {}),
        ...(status === 'submitted' ? { submitted_on: new Date().toISOString().slice(0, 10) } : {}),
      })
      toast.success('Claim updated', { description: res.meta?.note })
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not update the claim')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update claim</DialogTitle>
          <DialogDescription>
            {claim.students?.first_name} {claim.students?.last_name} ·{' '}
            {formatCurrency(claim.claim_amount)} claimed
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Submitted to the state</SelectItem>
                <SelectItem value="received">Money received</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {status === 'received' && (
            <div className="space-y-1.5">
              <Label htmlFor="rte-amt">Amount actually received</Label>
              <Input id="rte-amt" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
              {/* A short payment is the normal case and is the number the school
                  has to keep chasing, so it is asked for rather than assumed. */}
              {Number(amount) < Number(claim.claim_amount) && (
                <p className="text-xs text-warning">
                  {formatCurrency(Number(claim.claim_amount) - Number(amount))} less than claimed —
                  that gap stays outstanding.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rte-ref">Reference</Label>
            <Input id="rte-ref" value={reference} onChange={e => setReference(e.target.value)}
              placeholder="Sanction or UTR number" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
