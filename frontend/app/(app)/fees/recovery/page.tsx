'use client'
import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3, AlertTriangle, Phone, ChevronDown, ChevronUp, Loader2, RefreshCw,
  ArrowRightLeft, CheckCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { QueryError } from '@/components/shared/QueryError'
import { feeApi, academicYearsApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InvoiceList } from '@/components/fees/InvoiceList'
import { FeeCategoryBreakdown } from '@/components/fees/FeeCategoryBreakdown'
import { RteClaims } from '@/components/fees/RteClaims'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'

// Chasing what is late.
//
// Previously two separate pages — Collections (aging + defaulters) and Arrears —
// reached from two buttons on the Overview header. They are one job: money that
// should have arrived and hasn't. Splitting them meant an accountant checking on
// a family had to look in two places and mentally add the totals, which is
// exactly the arithmetic that was wrong on the server as well.

const BUCKETS = [
  { key: 'current', label: 'Not yet due', tone: 'bg-muted text-muted-foreground' },
  { key: '1_30', label: '1–30 days', tone: 'bg-warning/10 text-warning' },
  { key: '31_60', label: '31–60 days', tone: 'bg-warning/20 text-warning' },
  { key: '61_90', label: '61–90 days', tone: 'bg-destructive/10 text-destructive' },
  { key: '90_plus', label: '90+ days', tone: 'bg-destructive/20 text-destructive' },
]

export default function RecoveryPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const [tab, setTab] = useState<'overdue' | 'arrears' | 'invoices' | 'categories' | 'rte'>('overdue')
  const [sweeping, setSweeping] = useState(false)
  const [sweepPreview, setSweepPreview] = useState<any>(null)

  const { data: aging, isPending: agingPending, error: agingError } = useQuery({
    queryKey: ['fee-aging'],
    queryFn: () => feeApi.agingReport().then(r => r.data),
  })

  // Preview first, then confirm.
  //
  // This was a single unconfirmed click that recomputed late fines across every
  // overdue invoice in the school, with the outcome reported only afterwards in
  // a toast. Every other bulk write in the module — billing, assignment,
  // category changes — previews first, and this one moves money onto families'
  // bills.
  const previewFines = async () => {
    setSweeping(true)
    try {
      const res = await feeApi.applyLateFees(true)
      setSweepPreview(res.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not work out the late fines')
    } finally {
      setSweeping(false)
    }
  }

  const applyFines = async () => {
    setSweeping(true)
    try {
      const res = await feeApi.applyLateFees()
      toast.success(
        res.data?.updated
          ? `Late fines updated on ${res.data.updated} of ${res.data.checked} overdue invoices`
          : 'No fines needed updating',
      )
      if (res.data?.failed) {
        toast.error(`${res.data.failed} invoice(s) could not be updated — see the server log.`)
      }
      invalidateFeeQueries(qc)
      setSweepPreview(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not apply late fines')
    } finally {
      setSweeping(false)
    }
  }

  const summary = aging?.summary ?? {}
  const overdueTotal = BUCKETS.filter(b => b.key !== 'current')
    .reduce((s, b) => s + (summary[b.key]?.total ?? 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery"
        description="How late the money is, who owes it, and what carried over from last year"
        icon={BarChart3}
        actions={
          can('fee.structure_manage') && (
            <Button variant="outline" onClick={previewFines} disabled={sweeping}>
              {sweeping ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Apply late fines
            </Button>
          )
        }
      />

      {sweepPreview && (
        <ConfirmDialog
          open
          onOpenChange={o => { if (!o) setSweepPreview(null) }}
          title="Apply late fines?"
          description={
            sweepPreview.would_update === 0
              ? `Checked ${sweepPreview.checked} overdue invoices. Nothing needs changing.`
              : `This will change the late fine on ${sweepPreview.would_update} of ${sweepPreview.checked} overdue invoices, adding ${formatCurrency(sweepPreview.net_change)} to what families owe. Approved waivers are not re-applied.`
          }
          confirmLabel={sweepPreview.would_update === 0 ? 'Close' : 'Apply fines'}
          loading={sweeping}
          onConfirm={sweepPreview.would_update === 0 ? async () => setSweepPreview(null) : applyFines}
        >
          {!!sweepPreview.sample?.length && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Fine</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sweepPreview.sample.map((r: any) => (
                    <TableRow key={r.invoice_number}>
                      <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.days_overdue}d</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.from)} → <strong>{formatCurrency(r.to)}</strong>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ConfirmDialog>
      )}

      {/* Aging */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
          <CardTitle>Aging</CardTitle>
          {!agingPending && (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-destructive">{formatCurrency(overdueTotal)}</span> past due
            </p>
          )}
        </CardHeader>
        <CardContent>
          {agingPending ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
            </div>
          ) : agingError ? (
            // Five ₹0 buckets and "₹0 past due" was what a failed request drew:
            // the school's entire receivables position reading as fully collected.
            <QueryError error={agingError} title="Could not load the aging report" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {BUCKETS.map(b => {
                const cell = summary[b.key] ?? { count: 0, total: 0 }
                return (
                  <div key={b.key} className={cn('rounded-xl border border-border p-4', cell.count === 0 && 'opacity-60')}>
                    <span className={cn('mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold', b.tone)}>
                      {b.label}
                    </span>
                    <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(cell.total)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {cell.count} invoice{cell.count === 1 ? '' : 's'}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overdue">Defaulters</TabsTrigger>
          <TabsTrigger value="arrears">Arrears</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="categories">By category</TabsTrigger>
          {/* Beside the other recovery tabs because it IS recovery — it is simply
              the one debtor here that is a government rather than a family. */}
          <TabsTrigger value="rte">RTE claims</TabsTrigger>
        </TabsList>
        <TabsContent value="overdue"><Defaulters /></TabsContent>
        <TabsContent value="arrears"><Arrears canManage={can('fee.structure_manage')} /></TabsContent>
        <TabsContent value="invoices"><InvoiceList canManage={can('fee.structure_manage')} /></TabsContent>
        <TabsContent value="categories"><FeeCategoryBreakdown /></TabsContent>
        <TabsContent value="rte"><RteClaims /></TabsContent>
      </Tabs>
    </div>
  )
}

// ── Defaulters ────────────────────────────────────────────────────────

function Defaulters() {
  const [minDays, setMinDays] = useState(30)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [includeAll, setIncludeAll] = useState(false)

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-defaulters', minDays, page, includeAll],
    queryFn: () => feeApi.defaulters(minDays, page, undefined, { includeAll }),
    // Keeps the table on screen while the next page loads. Without it the card
    // collapses to skeletons on every click and the page jumps under the cursor.
    placeholderData: prev => prev,
  })

  const excludedStudents = data?.meta?.excluded_students ?? 0
  const excludedOutstanding = data?.meta?.excluded_outstanding ?? 0

  const rows: any[] = data?.data ?? []
  const total = data?.meta?.total ?? rows.length
  const limit = data?.meta?.limit ?? 25

  return (
    <Card id="defaulters">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Defaulters
          </CardTitle>
          {/* The whole position, not this page of it — the count and the money
              are what the card is for, and a page-local sum would understate
              both the moment the list runs past twenty-five families. */}
          {/* Students, not families: /defaulters groups by student_id, so two
              siblings who each owe are two rows here. Calling that "families"
              overstates how many households the school actually has to call. */}
          {!isPending && !!total && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {total} student{total === 1 ? '' : 's'} · {formatCurrency(data?.meta?.total_outstanding ?? 0)} outstanding
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Overdue by at least</span>
          <Select value={String(minDays)} onValueChange={v => { setPage(1); setMinDays(Number(v)) }}>
            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any</SelectItem>
              <SelectItem value="15">15 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Said, not silently done. A chase list that quietly got shorter is
            indistinguishable from a broken one — and the money has not gone
            away, it is simply owed by a government rather than a family. */}
        {!isPending && (excludedStudents > 0 || includeAll) && (
          <div className="px-5 pb-4">
            <Alert
              variant="info"
              title={includeAll
                ? 'Showing every category, including RTE'
                : `${excludedStudents} RTE student${excludedStudents === 1 ? '' : 's'} left off this list`}
            >
              {includeAll ? (
                <>RTE seats are reimbursed by the state, not paid by the family. They
                are on this list only because you asked.{' '}</>
              ) : (
                <>{formatCurrency(excludedOutstanding)} outstanding on RTE seats is a
                state reimbursement, not a family debt — nobody there should be
                telephoned for it.{' '}</>
              )}
              <button
                type="button"
                onClick={() => { setPage(1); setIncludeAll(v => !v) }}
                className="font-medium text-primary hover:underline"
              >
                {includeAll ? 'Hide them again' : 'Show them anyway'}
              </button>
            </Alert>
          </div>
        )}

        {isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : error ? (
          // "Nobody is behind" on a failed read is the most dangerous empty
          // state in the module: it tells a school to stop chasing.
          <div className="p-5"><QueryError error={error} title="Could not load the defaulter list" /></div>
        ) : !rows.length ? (
          <EmptyState
            icon={CheckCircle}
            title="Nobody is behind"
            description={minDays > 0
              ? `No family is overdue by ${minDays}+ days. Lower the threshold to widen the search.`
              : 'Every invoice is either paid or not yet due.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="hidden md:table-cell">Longest overdue</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(d => {
                  const open = expanded === d.student.id
                  return (
                    <Fragment key={d.student.id}>
                      <TableRow onClick={() => setExpanded(open ? null : d.student.id)}>
                        <TableCell className="font-semibold text-foreground">
                          {d.student.first_name} {d.student.last_name}
                          <p className="font-mono text-xs font-normal text-muted-foreground">{d.student.admission_number}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.student.classes?.name}{d.student.sections?.name ? ` · ${d.student.sections.name}` : ''}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-destructive">
                          {formatCurrency(d.total_outstanding)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                            d.max_days_overdue > 90 ? 'bg-destructive/20 text-destructive'
                              : d.max_days_overdue > 60 ? 'bg-destructive/10 text-destructive'
                              : d.max_days_overdue > 30 ? 'bg-warning/20 text-warning' : 'bg-warning/10 text-warning')}>
                            {d.max_days_overdue} days
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground">
                          {d.parent_contact?.father_phone && (
                            <a
                              href={`tel:${d.parent_contact.father_phone}`}
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1 text-xs hover:text-primary hover:underline"
                            >
                              <Phone className="h-3 w-3" /> {d.parent_contact.father_phone}
                            </a>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {open ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-muted/40">
                            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                              {d.invoice_count} overdue invoice{d.invoice_count === 1 ? '' : 's'}
                            </p>
                            <div className="space-y-1.5">
                              {d.invoices.map((inv: any) => (
                                <div key={inv.id} className="flex items-center justify-between gap-4 text-sm">
                                  <span className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</span>
                                  <span className="tabular-nums text-muted-foreground">{inv.days_overdue} days overdue</span>
                                  <span className="font-semibold tabular-nums text-destructive">{formatCurrency(inv.amount_due)}</span>
                                </div>
                              ))}
                            </div>
                            {d.parent_contact && (
                              <p className="mt-2.5 text-xs text-muted-foreground">
                                {d.parent_contact.father_name} · {d.parent_contact.father_phone}
                                {d.parent_contact.mother_name && ` · ${d.parent_contact.mother_name} · ${d.parent_contact.mother_phone}`}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page} limit={limit} total={total}
              onPageChange={p => { setExpanded(null); setPage(p) }}
              label="students"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Arrears ───────────────────────────────────────────────────────────

const ARREAR_STATUS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  partial: 'bg-warning/20 text-warning',
  cleared: 'bg-success/10 text-success',
  waived: 'bg-muted text-muted-foreground',
}

function Arrears({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { can } = usePermissions()
  // Collecting is fee.collect; waiving and carrying forward are arrear_manage.
  // They are different powers and the row shows only the ones this user holds.
  const canCollect = can('fee.collect')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [carryOpen, setCarryOpen] = useState(false)
  const [waiveTarget, setWaiveTarget] = useState<any>(null)
  const [payTarget, setPayTarget] = useState<any>(null)
  const limit = 25

  const params = { page, limit, status: status || undefined }
  const { data, isPending, error } = useQuery({
    queryKey: ['fee-arrears', params],
    queryFn: () => feeApi.arrears.list(params),
  })

  const rows: any[] = data?.data ?? []

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Arrears</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Balances carried forward from previous academic years</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="cleared">Cleared</SelectItem>
              <SelectItem value="waived">Waived</SelectItem>
            </SelectContent>
          </Select>
          {canManage && (
            <Button onClick={() => setCarryOpen(true)}>
              <ArrowRightLeft className="h-4 w-4" /> Carry forward
            </Button>
          )}
        </div>
      </CardHeader>

      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <QueryError error={error} title="Could not load the arrears" />
      ) : !rows.length ? (
        <EmptyState
          icon={ArrowRightLeft}
          title={status ? `No ${status} arrears` : 'No arrears'}
          description={status
            ? 'Nothing matches this filter.'
            : 'At the start of a new academic year, carry forward unpaid balances so they stay visible against the student.'}
          action={canManage && !status
            ? <Button onClick={() => setCarryOpen(true)}><ArrowRightLeft className="h-4 w-4" /> Carry forward</Button>
            : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead>Carried</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(a => (
                  <TableRow key={a.id} className="cursor-default">
                    <TableCell className="font-semibold text-foreground">
                      {a.students?.first_name} {a.students?.last_name}
                      <p className="text-xs font-normal text-muted-foreground">{a.students?.classes?.name}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.from_year?.name ?? '—'} → {a.to_year?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(a.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">{formatCurrency(a.amount_paid)}</TableCell>
                    <TableCell className={cn('text-right font-bold tabular-nums', a.amount_due > 0 ? 'text-destructive' : 'text-success')}>
                      {formatCurrency(a.amount_due)}
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', ARREAR_STATUS[a.status])}>
                        {a.status}
                      </span>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {(a.status === 'pending' || a.status === 'partial') && (
                          <div className="flex justify-end gap-2">
                            {/* The endpoint has existed since arrears were built
                                and NOTHING called it. The only way to clear an
                                arrear in the product was to write it off — while
                                the parent portal told families to "settle that
                                at the office", where no such control existed. */}
                            {canCollect && (
                              <Button size="sm" onClick={() => setPayTarget(a)}>Record payment</Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setWaiveTarget(a)}>Waive</Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={data?.meta?.page ?? page}
            limit={data?.meta?.limit ?? limit}
            total={data?.meta?.total ?? rows.length}
            onPageChange={setPage}
            label="arrears"
          />
        </>
      )}

      {carryOpen && <CarryForwardDialog onClose={() => { setCarryOpen(false); invalidateFeeQueries(qc) }} />}
      {waiveTarget && <WaiveDialog arrear={waiveTarget} onClose={() => setWaiveTarget(null)} />}
      {payTarget && <ArrearPaymentDialog arrear={payTarget} onClose={() => setPayTarget(null)} />}
    </Card>
  )
}

function CarryForwardDialog({ onClose }: { onClose: () => void }) {
  const [fromYear, setFromYear] = useState('')
  const [toYear, setToYear] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data as any[]),
  })

  const submit = async () => {
    setLoading(true)
    try {
      const res = await feeApi.arrears.carryForward(fromYear, toYear)
      toast.success(
        res.data?.carried_forward
          ? `${res.data.carried_forward} balances carried forward · ${formatCurrency(res.data.total_amount ?? 0)}`
          : res.data?.message ?? 'Nothing to carry forward',
      )
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not carry forward')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Carry forward unpaid balances"
      description="Moves every remaining balance from one academic year into the next as an arrear."
      confirmLabel="Carry forward"
      loading={loading}
      onConfirm={submit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>From year *</Label>
          <Select value={fromYear} onValueChange={setFromYear}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {(years ?? []).map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Into year *</Label>
          <Select value={toYear} onValueChange={setToYear}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {(years ?? []).filter(y => y.id !== fromYear).map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Alert variant="info" title="The source invoices are closed, not duplicated">
          Each invoice moves to a &ldquo;carried forward&rdquo; state so the same balance
          is not counted twice — once as an overdue invoice and again as an arrear.
          Safe to re-run.
        </Alert>
      </div>
    </ConfirmDialog>
  )
}

function WaiveDialog({ arrear, onClose }: { arrear: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!reason.trim()) return toast.error('A reason is required')
    setLoading(true)
    try {
      await feeApi.arrears.waive(arrear.id, reason.trim())
      toast.success('Arrear waived')
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not waive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Waive this arrear"
      description={
        <>
          Writes off {formatCurrency(arrear.amount_due)} for {arrear.students?.first_name} {arrear.students?.last_name}.
          This is permanent and recorded against your name in the audit log.
        </>
      }
      destructive
      confirmText="WAIVE"
      confirmLabel="Waive balance"
      loading={loading}
      onConfirm={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="waive-reason">Reason *</Label>
        <Textarea
          id="waive-reason" rows={2} className="resize-none"
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Financial hardship, approved by the Principal"
        />
      </div>
    </ConfirmDialog>
  )
}


// Taking money against a carried-forward balance.
//
// POST /fees/arrears/:id/payment has existed since the arrears model was built.
// Nothing in either app called it, so an arrear could be waived but never
// collected — the product could forgive a debt and could not accept payment of
// one.
function ArrearPaymentDialog({ arrear, onClose }: { arrear: any; onClose: () => void }) {
  const qc = useQueryClient()
  const remaining = Number(arrear.amount_due ?? 0)
  const [amount, setAmount] = useState(String(remaining))
  const [loading, setLoading] = useState(false)

  const entered = Number(amount)
  const valid = Number.isFinite(entered) && entered > 0 && entered <= remaining + 0.01

  const submit = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await feeApi.arrears.recordPayment(arrear.id, { amount: entered })
      toast.success(
        entered >= remaining - 0.01
          ? 'Arrear cleared'
          : `${formatCurrency(entered)} recorded — ${formatCurrency(remaining - entered)} still owing`,
      )
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not record the payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Record a payment against this arrear"
      description={
        <>
          {formatCurrency(remaining)} is outstanding for {arrear.students?.first_name}{' '}
          {arrear.students?.last_name}, carried forward from {arrear.from_year?.name ?? 'the previous year'}.
        </>
      }
      confirmLabel="Record payment"
      loading={loading}
      onConfirm={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="arrear-amount">Amount *</Label>
        <Input
          id="arrear-amount" type="number" inputMode="decimal" min={0} max={remaining} step="0.01"
          value={amount} onChange={e => setAmount(e.target.value)}
        />
        {!valid && amount !== '' && (
          <p className="text-xs text-destructive">
            Enter an amount between ₹0 and {formatCurrency(remaining)}.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          An arrear is settled directly rather than through an invoice, so this does not
          issue a fee receipt. Record the cash or transfer in your day book as usual.
        </p>
      </div>
    </ConfirmDialog>
  )
}
