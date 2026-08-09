'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Layers, Plus, Loader2, ChevronDown, ChevronRight, Users, Archive, GitBranch, Bus, Play,
  CalendarClock,
} from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, academicYearsApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { StructureDialog, AssignDialog, BillPeriodDialog, FREQUENCIES } from '@/components/fees/StructureDialogs'
import { FeeCategories } from '@/components/fees/SetupPanels'

// Fee structures: the plans a school bills.
//
// This screen did not exist. What stood in for it was a (class × head) grid of
// amounts on the Billing page — a matrix that could not say "Class 5 pays this
// bundle", could not be versioned, and let an edit silently change what
// already-assigned students were being billed with no record of the old figure.
//
// A plan here is a NAME with lines, a cadence, a late-fee rule and the classes it
// is offered to. It is superseded, never mutated. The list is grouped by name so
// the version history of a plan reads as one thing rather than as four unrelated
// rows sorted alphabetically.

const FREQUENCY_LABELS: Record<string, string> =
  Object.fromEntries(FREQUENCIES.map(f => [f.value, f.label]))

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/10 text-success',
  draft: 'bg-muted text-muted-foreground',
  superseded: 'bg-warning/10 text-warning',
  archived: 'bg-muted text-muted-foreground',
}

export default function FeeStructuresPage() {
  const { can } = usePermissions()
  const canManage = can('fee.structure_manage')

  const [yearId, setYearId] = useState('')
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [tab, setTab] = useState('plans')
  const [creating, setCreating] = useState(false)
  const [versioning, setVersioning] = useState<any>(null)
  const [assigning, setAssigning] = useState<any>(null)

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data as any[]),
  })

  useEffect(() => {
    if (yearId || !years?.length) return
    setYearId((years.find(y => y.is_current) ?? years[0]).id)
  }, [years, yearId])

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-structures', { academic_year_id: yearId }],
    queryFn: () => feeApi.structures.list({ academic_year_id: yearId }).then(r => r.data as any[]),
    enabled: !!yearId,
  })

  const rows = data ?? []

  // Grouped by code — the stable identifier a version carries forward — so v1 and
  // v2 of "Primary" sit together with the live one on top.
  const plans = useMemo(() => {
    const byCode = new Map<string, any[]>()
    for (const s of rows) {
      const key = s.code ?? s.id
      if (!byCode.has(key)) byCode.set(key, [])
      byCode.get(key)!.push(s)
    }
    return Array.from(byCode.values())
      .map(versions => {
        const sorted = versions.slice().sort((a, b) => (b.version ?? 1) - (a.version ?? 1))
        return { current: sorted[0], history: sorted.slice(1) }
      })
      .sort((a, b) => a.current.name.localeCompare(b.current.name, undefined, { numeric: true }))
  }, [rows])

  const visible = showSuperseded
    ? plans
    : plans.filter(p => p.current.status !== 'archived')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee structures"
        description="The named plans a school bills — what each bundles, and who is on it"
        icon={Layers}
        actions={
          tab === 'plans' && (
          <>
            <Select value={yearId} onValueChange={setYearId}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>
                {(years ?? []).map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New structure
              </Button>
            )}
          </>
          )
        }
      />

      {/* The catalogue lives here because it is a PREREQUISITE of a plan, not of
          a billing run: you add "Transport Fee" in order to put a line on a
          structure. It sat on Billing only because the old class-amounts grid
          did, and that grid is gone. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          {canManage && <TabsTrigger value="categories">Fee categories</TabsTrigger>}
        </TabsList>

        <TabsContent value="plans" className="space-y-6">

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : error ? (
        // A failed read is not an empty school. Reporting one as the other sent
        // someone hunting for missing structures when twelve existed and the
        // query had been rejected — the difference between "you have none" and
        // "I could not find out" is the whole message.
        <Alert variant="destructive" title="Could not load the fee structures">
          {(error as any)?.response?.data?.error ?? (error as Error)?.message ?? 'The request failed.'}
          {' '}Nothing has been changed. Reload to try again.
        </Alert>
      ) : !visible.length ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No fee structures for this year"
            description={canManage
              ? 'A structure bundles fee categories into a plan — "Primary, ₹12,000 a quarter". Create one, assign it to some classes, and the billing run has something to raise.'
              : 'Nothing has been configured for this academic year yet.'}
            action={canManage
              ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New structure</Button>
              : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map(plan => (
            <PlanCard
              key={plan.current.id}
              plan={plan}
              canManage={canManage}
              onVersion={() => setVersioning(plan.current)}
              onAssign={() => setAssigning(plan.current)}
            />
          ))}
        </div>
      )}

      {!!plans.length && (
        <button
          type="button"
          onClick={() => setShowSuperseded(v => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          {showSuperseded ? 'Hide archived plans' : 'Show archived plans'}
        </button>
      )}
        </TabsContent>

        {canManage && (
          <TabsContent value="categories"><FeeCategories /></TabsContent>
        )}
      </Tabs>

      {creating && (
        <StructureDialog editing={null} defaultYearId={yearId} onClose={() => setCreating(false)} />
      )}
      {versioning && (
        <StructureDialog editing={versioning} onClose={() => setVersioning(null)} />
      )}
      {assigning && (
        <AssignDialog structure={assigning} onClose={() => setAssigning(null)} />
      )}
    </div>
  )
}

// ── One plan, with its versions ───────────────────────────────────────

function PlanCard({
  plan, canManage, onVersion, onAssign,
}: {
  plan: { current: any; history: any[] }
  canManage: boolean
  onVersion: () => void
  onAssign: () => void
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [billing, setBilling] = useState<any>(null)
  const s = plan.current

  // Fetched only when the card is expanded — the list route already carries the
  // lines, but not how many students are actually on the plan, which is the one
  // number that decides whether a change needs a new version.
  const { data: detail } = useQuery({
    queryKey: ['fee-structure', s.id],
    queryFn: () => feeApi.structures.get(s.id).then(r => r.data),
    enabled: open,
  })

  const lines = (s.fee_structure_lines ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const classes = (s.fee_structure_classes ?? []).map((c: any) => c.classes?.name).filter(Boolean)
  const optionalCount = lines.filter((l: any) => l.is_optional).length

  // The schedule the list already carries, so the collapsed row can answer "when
  // is the next payment due" without expanding or a second request. Enriched
  // with billed/collected once the card is open.
  const schedule: any[] = (detail?.schedule ?? s.fee_structure_schedules ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const today = new Date().toISOString().slice(0, 10)
  const nextDue = schedule.find(r => r.due_date >= today) ?? schedule[schedule.length - 1]

  const archive = async () => {
    setArchiving(true)
    try {
      await feeApi.structures.setStatus(s.id, 'archived')
      toast.success(`${s.name} archived`)
      invalidateFeeQueries(qc)
      setConfirmArchive(false)
    } catch (e: any) {
      // 409 with a count is the useful case: it names how many students still sit
      // on the plan, which is exactly what you need to know to unblock yourself.
      toast.error(e?.response?.data?.error ?? 'Could not archive the structure')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start gap-3 p-4">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{s.name}</h3>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[s.status] ?? 'bg-muted text-muted-foreground')}>
                {s.status}
              </span>
              {(s.version ?? 1) > 1 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  v{s.version}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {FREQUENCY_LABELS[s.frequency] ?? s.frequency}
              {' · '}
              {lines.length} line{lines.length === 1 ? '' : 's'}
              {optionalCount > 0 && ` (${optionalCount} optional)`}
              {' · '}
              {classes.length ? classes.join(', ') : 'any class'}
            </p>
            {/* The one fact a school asks of a plan without opening it. */}
            {nextDue && (
              <p className="mt-1 text-xs">
                <span className="text-muted-foreground">Next: </span>
                <span className="font-medium text-foreground">{nextDue.label ?? nextDue.period_token}</span>
                <span className="text-muted-foreground"> due {formatDate(nextDue.due_date)}</span>
              </p>
            )}
          </div>

          <div className="flex items-baseline gap-1.5 sm:flex-col sm:items-end sm:gap-0">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrency(s.mandatory_total ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">
              {/* The mandatory subtotal is what a student actually pays; the total
                  includes optional lines nobody may have taken. Showing only the
                  total is how a school over-reports what it has billed.
                  Lines charged in named installments only — an admission fee, a
                  caution deposit — are called out rather than folded into the
                  per-installment figure they are not part of. */}
              per installment{(s.total ?? 0) > (s.mandatory_total ?? 0) && ` · up to ${formatCurrency(s.total)}`}
              {(s.periodic_total ?? 0) > 0 && (
                <span className="block">
                  + {formatCurrency(s.periodic_total)} in named installments
                </span>
              )}
            </p>
          </div>

          {canManage && s.status !== 'archived' && (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button size="sm" variant="secondary" onClick={onAssign}>
                <Users className="h-3.5 w-3.5" /> Assign
              </Button>
              <Button size="sm" variant="outline" onClick={onVersion}>
                <GitBranch className="h-3.5 w-3.5" /> New version
              </Button>
              <Button
                size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                aria-label="Archive structure" onClick={() => setConfirmArchive(true)}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {open && (
          <div className="space-y-4 border-t border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              {lines.map((l: any) => {
                const only: string[] = l.period_tokens ?? []
                return (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5 text-foreground">
                      {l.fee_heads?.name ?? 'Fee'}
                      {l.is_optional && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          <Bus className="h-3 w-3" /> optional
                        </span>
                      )}
                      {/* Without this the list reads as if every line were charged
                          every installment, and a ₹2,000 admission fee sitting
                          beside ₹12,000 tuition looks like ₹2,000 a quarter. */}
                      {!!only.length && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <CalendarClock className="h-3 w-3" /> only in {only.join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCurrency(l.amount)}
                      {!!only.length && (
                        <span className="text-[11px]">
                          {only.length === 1 ? ' once' : ` ×${only.length}`}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between border-t pt-1.5 text-sm font-semibold">
                <span className="text-foreground">Billed to everyone</span>
                <span className="tabular-nums text-foreground">{formatCurrency(s.mandatory_total ?? 0)}</span>
              </div>
            </div>

            {/* ── The schedule ── */}
            {!!schedule.length && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment schedule
                </p>
                <div className="overflow-x-auto rounded-lg border border-border bg-background">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Installment</th>
                        <th className="px-3 py-2 text-left font-medium">Bill on</th>
                        <th className="px-3 py-2 text-left font-medium">Due by</th>
                        <th className="px-3 py-2 text-right font-medium">Raised</th>
                        <th className="px-3 py-2 text-right font-medium">Collected</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {schedule.map((r: any) => {
                        const billed = r.status === 'billed'
                        const overdue = !billed && r.bills_on && r.bills_on <= today
                        return (
                          <tr key={r.period_token}>
                            <td className="px-3 py-2 font-medium text-foreground">
                              {r.label ?? r.period_token}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {r.bills_on ? formatDate(r.bills_on) : '—'}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{formatDate(r.due_date)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {billed ? (
                                <span className="text-foreground">
                                  {formatCurrency(r.billed)}
                                  <span className="block text-[11px] text-muted-foreground">
                                    {r.invoices} invoice{r.invoices === 1 ? '' : 's'}
                                  </span>
                                </span>
                              ) : (
                                // Not an error — just a term that has not come
                                // round yet, unless its bill-on date has passed.
                                <span className={cn('text-xs', overdue ? 'font-medium text-warning' : 'text-muted-foreground')}>
                                  {overdue ? 'due to be billed' : 'not yet billed'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-success">
                              {billed ? formatCurrency(r.collected) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {canManage && !billed && detail && (
                                <Button size="sm" variant="secondary" className="h-8"
                                  onClick={() => setBilling(r)}>
                                  <Play className="h-3 w-3" /> Bill now
                                </Button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {!detail && (
                  <p className="text-xs text-muted-foreground">Loading what has been raised…</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">{detail?.assigned_students ?? '—'}</span>{' '}
                student{detail?.assigned_students === 1 ? '' : 's'} on this version
              </span>
              <span>
                Late fee:{' '}
                {s.late_fee_mode === 'none'
                  ? 'none'
                  : `${s.late_fee_mode === 'percent_monthly' ? `${s.late_fee_value}% monthly` : formatCurrency(s.late_fee_value)}${
                      s.late_fee_mode === 'per_day' ? ' per day' : ''
                    }${s.late_fee_grace_days ? `, after ${s.late_fee_grace_days} grace days` : ''}`}
              </span>
              {s.code && <span className="font-mono">{s.code}</span>}
            </div>

            {optionalCount > 0 && (
              <Alert variant="info" title="Optional lines bill nobody by default">
                A student is charged for these only once they are opted in, from
                their fee record under Collect.
              </Alert>
            )}

            {!!plan.history.length && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Earlier versions
                </p>
                {plan.history.map((h: any) => (
                  <p key={h.id} className="text-xs text-muted-foreground">
                    v{h.version} · {formatCurrency(h.mandatory_total ?? 0)} per student ·{' '}
                    <span className="capitalize">{h.status}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {billing && (
        <BillPeriodDialog
          structure={s}
          period={billing}
          onClose={() => setBilling(null)}
        />
      )}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${s.name}?`}
        description="It stops being offered for new assignments. Invoices already raised are untouched, and students still on it keep their plan."
        destructive
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={archive}
      />
    </Card>
  )
}
