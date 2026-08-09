'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, Check, X, Pencil, Tag, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/shared/EmptyState'

// The setup panels, lifted out of their own page.
//
// What a class pays and the run that bills it were two separate destinations, so
// checking an amount meant leaving the billing screen and coming back. edut keeps
// them adjacent for the same reason — the structure IS the billing plan. They now
// live on one page as tabs, and these are the pieces it composes.

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly',
  annually: 'Annually', one_time: 'One-time',
}

// ── Fee categories ────────────────────────────────────────────────────

export function FeeCategories() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const { data: heads, isPending } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data as any[]),
  })
  const { data: structures } = useQuery({
    queryKey: ['fee-structures', {}],
    queryFn: () => feeApi.structures.list().then(r => r.data as any[]),
  })

  // Where each category is actually priced. Read off the structures' LINES now,
  // not off one row per (class, head) — a head appears once per plan, and the
  // plan carries the classes, so "priced on 3 plans covering 9 classes" is the
  // honest reading of a model that no longer has a cell per class.
  const usage = useMemo(() => {
    const m = new Map<string, { plans: number; classes: number; min: number; max: number; frequencies: Set<string> }>()
    for (const s of structures ?? []) {
      // Superseded and archived versions would double-count a head that has been
      // re-versioned once, which reads as twice the coverage there really is.
      if (s.status !== 'active') continue
      const classCount = (s.fee_structure_classes ?? []).length
      for (const l of s.fee_structure_lines ?? []) {
        const cur = m.get(l.fee_head_id) ?? { plans: 0, classes: 0, min: Infinity, max: 0, frequencies: new Set<string>() }
        cur.plans += 1
        cur.classes += classCount
        cur.min = Math.min(cur.min, Number(l.amount))
        cur.max = Math.max(cur.max, Number(l.amount))
        cur.frequencies.add(s.frequency)
        m.set(l.fee_head_id, cur)
      }
    }
    return m
  }, [structures])

  const add = async () => {
    if (!name.trim()) return toast.error('A name is required')
    setAdding(true)
    try {
      await feeApi.heads.create({ name: name.trim(), description: description.trim() || undefined })
      toast.success(`${name.trim()} added`)
      setName(''); setDescription('')
      invalidateFeeQueries(qc)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not add the category')
    } finally {
      setAdding(false)
    }
  }

  const rename = useMutation({
    mutationFn: (id: string) => feeApi.heads.update(id, { name: editName.trim() }),
    onSuccess: () => { toast.success('Renamed'); setEditingId(null); invalidateFeeQueries(qc) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not rename'),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add a fee category</CardTitle>
          <p className="text-sm text-muted-foreground">
            The individual charges a bill is made of — Tuition, Transport, Exam, Lab.
            Each appears as its own line on the invoice and on the parent&apos;s receipt.
          </p>
        </CardHeader>
        <CardContent>
          {/* Visible by default rather than behind an "Add" button: on a setup
              screen the thing you came to do should already be open. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={name} onChange={e => setName(e.target.value)}
                placeholder="Transport Fee"
                onKeyDown={e => { if (e.key === 'Enter') add() }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">Description</Label>
              <Input id="cat-desc" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Optional — what this covers" />
            </div>
            <div className="flex items-end">
              <Button onClick={add} disabled={adding || !name.trim()}>
                {adding && <Loader2 className="h-4 w-4 animate-spin" />} Add category
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {(heads ?? []).length} categor{(heads ?? []).length === 1 ? 'y' : 'ies'} · bundle them into a plan under{' '}
            <Link
              href="/fees/structures"
              className="rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Structures
            </Link>
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !(heads ?? []).length ? (
            <EmptyState icon={Tag} title="No categories yet" description="Add the first one above." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Category</TableHead>
                    <TableHead>Billed</TableHead>
                    <TableHead className="text-right">On plans</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(heads ?? []).map(h => {
                    const u = usage.get(h.id)
                    const isEditing = editingId === h.id
                    return (
                      <TableRow key={h.id} className="cursor-default">
                        <TableCell>
                          {isEditing ? (
                            <Input autoFocus className="h-8 w-48" value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') rename.mutate(h.id); if (e.key === 'Escape') setEditingId(null) }} />
                          ) : (
                            <>
                              <p className="font-medium text-foreground">{h.name}</p>
                              {h.description && <p className="text-xs text-muted-foreground">{h.description}</p>}
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          {u?.frequencies.size
                            ? Array.from(u.frequencies).map(f => (
                                <Badge key={f} variant="secondary" className="mr-1 text-xs">{FREQUENCY_LABELS[f]}</Badge>
                              ))
                            : <span className="text-xs text-muted-foreground">Not billed yet</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {u?.plans ? (
                            <span className="text-foreground">
                              {u.plans}
                              {u.classes > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {' '}({u.classes} class{u.classes === 1 ? '' : 'es'})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">none</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {u ? (u.min === u.max ? formatCurrency(u.min) : `${formatCurrency(u.min)}–${formatCurrency(u.max)}`) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-1.5">
                              <Button size="icon" className="h-8 w-8 bg-success text-success-foreground hover:bg-success/90"
                                onClick={() => rename.mutate(h.id)} disabled={rename.isPending} aria-label="Save">
                                {rename.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button size="icon" variant="secondary" className="h-8 w-8"
                                onClick={() => setEditingId(null)} aria-label="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Rename"
                              onClick={() => { setEditingId(h.id); setEditName(h.name) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
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
    </div>
  )
}

// ── Discount authority ────────────────────────────────────────────────

export function DiscountLimits() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [single, setSingle] = useState('')
  const [monthly, setMonthly] = useState('')

  const { data, isPending } = useQuery({
    queryKey: ['fee-discount-limits'],
    queryFn: () => feeApi.discounts.limits().then(r => r.data as any[]),
  })

  const save = useMutation({
    mutationFn: (roleId: string) => feeApi.discounts.updateLimit(roleId, {
      max_single_discount: Number(single) || 0,
      max_monthly_total: monthly === '' ? null : Number(monthly),
    }),
    onSuccess: () => { toast.success('Limit saved'); setEditing(null); invalidateFeeQueries(qc) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save'),
  })

  const rows = data ?? []
  const unconfigured = rows.filter(r => !r.configured).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Discount authority
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Only roles that can grant a concession appear here. Anything within a
          role&apos;s ceiling is approved the moment it is granted; anything above goes
          to the Principal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!!unconfigured && !isPending && (
          <Alert
            variant="info"
            title={`${rows.filter(r => !r.configured).map(r => r.role_name).join(', ')} ${unconfigured === 1 ? 'has' : 'have'} no ceiling set`}
          >
            Every concession {unconfigured === 1 ? 'that role' : 'those roles'} grants
            goes to the Principal. That may be exactly what you want — set a figure
            below only if it isn&apos;t.
          </Alert>
        )}

        {isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !rows.length ? (
          <EmptyState icon={ShieldCheck} title="No roles configured" description="Create roles under Team & Settings first." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Max per concession</TableHead>
                  <TableHead className="text-right">Max per month</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const isEditing = editing === r.role_id
                  return (
                    <TableRow key={r.role_id} className="cursor-default">
                      <TableCell>
                        <p className="font-medium text-foreground">{r.role_name}</p>
                        {!r.configured && <p className="text-xs text-warning">Not configured — everything needs approval</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input type="number" autoFocus className="ml-auto h-8 w-32 text-right"
                            value={single} onChange={e => setSingle(e.target.value)} />
                        ) : (
                          <span className={cn('font-semibold tabular-nums', r.max_single_discount > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                            {formatCurrency(r.max_single_discount)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input type="number" className="ml-auto h-8 w-32 text-right" placeholder="No cap"
                            value={monthly} onChange={e => setMonthly(e.target.value)} />
                        ) : (
                          <span className="tabular-nums text-muted-foreground">
                            {r.max_monthly_total == null ? 'No cap' : formatCurrency(r.max_monthly_total)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1.5">
                            <Button size="icon" className="h-8 w-8 bg-success text-success-foreground hover:bg-success/90"
                              onClick={() => save.mutate(r.role_id)} disabled={save.isPending} aria-label="Save">
                              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </Button>
                            <Button size="icon" variant="secondary" className="h-8 w-8"
                              onClick={() => setEditing(null)} aria-label="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit"
                            onClick={() => {
                              setEditing(r.role_id)
                              setSingle(String(r.max_single_discount ?? 0))
                              setMonthly(r.max_monthly_total == null ? '' : String(r.max_monthly_total))
                            }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <Alert variant="info" title="Percentage concessions are always reviewed">
          A percentage has no rupee value until it meets a particular fee, so it
          cannot be checked against a ceiling. Only fixed amounts auto-approve.
        </Alert>
      </CardContent>
    </Card>
  )
}

// ── What a fee category actually does ─────────────────────────────────
//
// fee_category was a label: written by the assign form, read by one report,
// branched on by nothing. Tagging forty children "RTE" changed no bill, kept
// them on the chase list, and left the nightly sweep texting their parents for
// money the state owes.
//
// A rule here is the school's standing terms for a category, and the billing run
// applies it when it builds an invoice. That timing is the whole point: a
// concession granted by hand AFTER a term is billed comes off nothing, which is
// how a school ends up with approved concessions and ₹0 discounted.

// Each row is one condition. The sibling rows are keyed by order rather than by
// category deliberately: "the second child" maintains itself as families come
// and go, where a hand-applied "Sibling" tag has to be remembered by a person.
type RuleRow = {
  key: string
  label: string
  hint: string
  category?: string
  minSiblingOrder?: number
}

const RULE_ROWS: RuleRow[] = [
  { key: 'rte', label: 'RTE', category: 'rte',
    hint: 'Admitted free under §12(1)(c); the state reimburses at its own rate' },
  { key: 'staff_ward', label: 'Staff ward', category: 'staff_ward',
    hint: 'Absorbed by the school' },
  { key: 'scholarship', label: 'Scholarship', category: 'scholarship',
    hint: 'Funded from a trust or an award' },
  { key: 'sibling_2', label: 'Second child', minSiblingOrder: 2,
    hint: 'Derived from the family, senior child first — no tagging needed' },
  { key: 'sibling_3', label: 'Third child and beyond', minSiblingOrder: 3,
    hint: 'Applies to the third and every later child' },
  { key: 'sibling', label: 'Sibling (manual tag)', category: 'sibling',
    hint: 'Legacy: fires on the hand-applied category. Prefer the rows above.' },
]

export function ConcessionRules({ academicYearId }: { academicYearId?: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const [headId, setHeadId] = useState('')

  const { data, isPending } = useQuery({
    queryKey: ['fee-concession-rules', academicYearId],
    queryFn: () => feeApi.discounts.rules.list(academicYearId),
    enabled: !!academicYearId,
  })
  const { data: heads } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data as any[]),
  })

  const rows: any[] = data?.data ?? []
  // Matched on the whole condition, not just the category — a sibling-order rule
  // carries no category, and two rows must never claim the same stored rule.
  const ruleFor = (row: RuleRow) => rows.find(r =>
    (r.fee_category ?? null) === (row.category ?? null)
    && (r.min_sibling_order ?? null) === (row.minSiblingOrder ?? null))

  const save = useMutation({
    mutationFn: (row: RuleRow) => feeApi.discounts.rules.save({
      academic_year_id: academicYearId,
      fee_category: row.category ?? null,
      min_sibling_order: row.minSiblingOrder ?? null,
      discount_type: type,
      discount_value: Number(value) || 0,
      fee_head_id: headId || null,
    }),
    onSuccess: (res: any) => {
      const n = res.meta?.students_on_category ?? 0
      // The reach, said out loud. "12% off" is a different decision at 2
      // students than at 114, and the rule is invisible until the next run.
      toast.success(
        n ? `Saved — applies to ${n} student${n === 1 ? '' : 's'} today`
          : 'Saved — nobody matches this rule yet',
        { description: res.meta?.note },
      )
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['fee-concession-rules'] })
      invalidateFeeQueries(qc)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save the rule'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => feeApi.discounts.rules.remove(id),
    onSuccess: (res: any) => {
      toast.success('Rule removed', { description: res.meta?.note })
      qc.invalidateQueries({ queryKey: ['fee-concession-rules'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not remove the rule'),
  })

  const startEdit = (row: RuleRow) => {
    const r = ruleFor(row)
    setType(r?.discount_type ?? 'percentage')
    setValue(r ? String(r.discount_value) : '')
    setHeadId(r?.fee_head_id ?? '')
    setEditing(row.key)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" /> What each fee category does
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The school&apos;s standing terms. A student on a category gets these
          terms automatically on the next invoice raised — no per-child concession
          to remember.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="info" title="Applies from the next billing run">
          A concession comes off an invoice when it is raised. Setting a rule now
          does not change invoices already issued — adjust those separately if it
          should reduce them.
        </Alert>

        {isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Category</TableHead>
                  <TableHead>Concession</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {RULE_ROWS.map(c => {
                  const rule = ruleFor(c)
                  const isEditing = editing === c.key
                  return (
                    <TableRow key={c.key} className="cursor-default">
                      <TableCell>
                        <p className="font-medium text-foreground">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.hint}</p>
                      </TableCell>

                      {isEditing ? (
                        <>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Input
                                className="h-9 w-24" type="number" inputMode="decimal"
                                value={value} onChange={e => setValue(e.target.value)}
                                placeholder={type === 'percentage' ? '10' : '1500'}
                              />
                              <div className="flex">
                                {(['percentage', 'fixed'] as const).map(t => (
                                  <button
                                    key={t} type="button" onClick={() => setType(t)}
                                    className={cn('border px-2 py-1.5 text-xs font-medium first:rounded-l-lg last:rounded-r-lg',
                                      type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                                  >
                                    {t === 'percentage' ? '%' : '₹'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <select
                              value={headId}
                              onChange={e => setHeadId(e.target.value)}
                              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
                            >
                              {/* Most real policies waive tuition and still charge
                                  for the bus and the exam, so the head matters. */}
                              <option value="">Every fee head</option>
                              {(heads ?? []).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8"
                                aria-label="Save" disabled={save.isPending}
                                onClick={() => save.mutate(c)}>
                                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8"
                                aria-label="Cancel" onClick={() => setEditing(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>
                            {rule ? (
                              <span className="font-semibold tabular-nums text-foreground">
                                {rule.discount_type === 'percentage'
                                  ? `${rule.discount_value}% off`
                                  : `${formatCurrency(rule.discount_value)} off`}
                              </span>
                            ) : (
                              // Not an error state: no rule is a legitimate answer,
                              // and it is what every category does today.
                              <span className="text-sm text-muted-foreground">
                                Nothing — reporting only
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {rule ? (rule.fee_heads?.name ?? 'Every fee head') : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-8 text-xs"
                                onClick={() => startEdit(c)}>
                                <Pencil className="h-3.5 w-3.5" /> {rule ? 'Edit' : 'Set'}
                              </Button>
                              {rule && (
                                <Button size="icon" variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  aria-label={`Remove the ${c.label} rule`}
                                  disabled={remove.isPending}
                                  onClick={() => remove.mutate(rule.id)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A rule is the school&apos;s policy for a whole category. One family&apos;s
          exception is still a concession granted against that student, and both
          apply — the total never exceeds the line it reduces.
        </p>
      </CardContent>
    </Card>
  )
}
