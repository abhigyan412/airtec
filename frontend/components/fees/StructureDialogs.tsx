'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Search, Users, Play, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, classesApi, academicYearsApi, invalidateFeeQueries } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { CheckboxField } from '@/components/ui/checkbox'
import { StudentSearch, StudentLite, studentLabel } from '@/components/shared/StudentSearch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// Building a plan, and putting students on it.
//
// These are two dialogs rather than two pages because both are things you do
// *from* the structures list while looking at it — you add a plan, then assign it,
// then look at the list again to check it landed.

// `period` is the noun the amount is charged per — "₹12,000 each quarter" is the
// sentence a school says, and deriving it from the label gives you "each annual".
export const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly', period: 'month' },
  { value: 'quarterly', label: 'Quarterly', period: 'quarter' },
  { value: 'half_yearly', label: 'Half-yearly', period: 'half-year' },
  { value: 'annually', label: 'Annually', period: 'year' },
  { value: 'one_time', label: 'One-time', period: '' },
] as const

const LATE_FEE_MODES = [
  { value: 'none', label: 'No late fee', hint: 'Nothing is added when a bill goes past its due date' },
  { value: 'fixed', label: 'Fixed amount', hint: 'A flat charge, once, after the grace period' },
  { value: 'per_day', label: 'Per day', hint: 'Charged for every day past the grace period' },
  { value: 'percent_monthly', label: 'Percent per month', hint: 'A percentage of the outstanding, monthly' },
] as const

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'rte', label: 'RTE' },
  { value: 'staff_ward', label: 'Staff ward' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'scholarship', label: 'Scholarship' },
] as const

// period_tokens: which installments this line is charged in. Empty = every one,
// which is what every line did before the column existed and is still right for
// tuition, transport and the rest. A list is the once-a-year case — an admission
// fee or caution deposit that must not repeat each quarter.
//
// `limited` is held separately from the list because "restricted, nothing picked
// yet" and "charged every installment" are different states that an empty array
// cannot tell apart — and confusing them is how a line ends up billing nowhere.
type Line = {
  key: string; fee_head_id: string; amount: string; is_optional: boolean
  limited: boolean
  period_tokens: string[]
}

const blankLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  fee_head_id: '',
  amount: '',
  is_optional: false,
  limited: false,
  period_tokens: [],
})

/** 'Quarter 1 (Apr–Jun)' → 'Q1 · Apr–Jun'. Readable without being a paragraph. */
function shortPeriod(p: any): string {
  const range = /\(([^)]+)\)/.exec(p.label ?? '')?.[1]
  return range ? `${p.token} · ${range}` : (p.label ?? p.token)
}

/**
 * Which installments one line is charged in.
 *
 * Deliberately two states rather than a checkbox per period on show at all
 * times: the overwhelming majority of lines bill every installment, and a row of
 * four ticked boxes on every line would make the common case look like a
 * decision. Picking "only in" opens the tokens.
 *
 * Two things this control got wrong before, both silent:
 *  - it showed bare tokens, so a monthly plan offered twelve buttons reading
 *    '2025-04' … '2026-03' and you had to know the school's year to pick April;
 *  - unticking the last chip fell back to "every installment", so an admission
 *    fee could turn into a quarterly charge with no click that said so.
 * The mode is now held by the caller, and an empty limited selection is an
 * error the form refuses to save rather than a silent change of meaning.
 */
function PeriodPicker({
  periods, selected, limited, onChange,
}: {
  periods: any[]
  selected: string[]
  /** Held above so deselecting the last chip cannot flip the meaning of the line. */
  limited: boolean
  onChange: (next: { limited: boolean; tokens: string[] }) => void
}) {
  const toggle = (token: string) =>
    onChange({
      limited: true,
      tokens: selected.includes(token) ? selected.filter(t => t !== token) : [...selected, token],
    })

  return (
    <div className="space-y-1 pl-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Charged</span>
        <button
          type="button"
          onClick={() => onChange({ limited: false, tokens: [] })}
          className={cn('rounded-full border px-2 py-0.5 font-medium transition-colors',
            !limited ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40')}
        >
          every installment
        </button>
        <button
          type="button"
          // Defaults to the FIRST installment, because that is what this control
          // exists for — admission and caution money are charged when the year
          // opens. Landing on an empty selection would mean "bills nowhere".
          onClick={() => { if (!limited) onChange({ limited: true, tokens: periods[0] ? [periods[0].token] : [] }) }}
          className={cn('rounded-full border px-2 py-0.5 font-medium transition-colors',
            limited ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40')}
        >
          only in…
        </button>

        {limited && (
          <span className="flex flex-wrap items-center gap-1">
            {periods.map(p => (
              <button
                key={p.token}
                type="button"
                onClick={() => toggle(p.token)}
                className={cn('rounded-md border px-1.5 py-0.5 transition-colors',
                  selected.includes(p.token)
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40')}
                title={p.label}
              >
                {shortPeriod(p)}
              </button>
            ))}
          </span>
        )}
      </div>

      {limited && !selected.length && (
        <p className="flex items-center gap-1 font-medium text-destructive">
          <AlertTriangle className="h-3 w-3" />
          Pick at least one installment — otherwise this line is never charged.
        </p>
      )}
    </div>
  )
}

/** YYYY-MM-DD plus N days, in UTC so a local timezone cannot shift the date. */
function addDays(iso: string, days: number): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number | null {
  if (!from || !to) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** The default a school actually uses: due a fortnight after the term opens. */
const DEFAULT_DUE_OFFSET = 15

// The exact set the billing resolver emits. Anything unmapped falls through to
// the raw code rather than being hidden — a skip nobody can read is how a class
// goes unbilled for a term.
const SKIP_REASONS: Record<string, string> = {
  already_billed: 'Already invoiced for this installment',
  no_class: 'Not assigned to a class',
  not_assigned: 'Not on a fee plan',
  nothing_billable: 'Nothing on their plan is billable',
}

// ── Build or supersede a plan ─────────────────────────────────────────
//
// One dialog for both, because they are the same form — the difference is what
// happens on submit. Editing a live structure in place is not offered anywhere:
// students are already billed against these figures, so a change writes a new
// version and marks the old one superseded.

export function StructureDialog({
  editing, defaultYearId, onClose,
}: {
  /** The structure being superseded, or null to create a fresh plan. */
  editing: any | null
  defaultYearId?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isVersion = !!editing

  const [yearId, setYearId] = useState(editing?.academic_year_id ?? defaultYearId ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [frequency, setFrequency] = useState<string>(editing?.frequency ?? 'quarterly')
  const [classIds, setClassIds] = useState<string[]>(
    (editing?.fee_structure_classes ?? []).map((c: any) => c.class_id))
  const [lines, setLines] = useState<Line[]>(
    (editing?.fee_structure_lines ?? []).length
      ? editing.fee_structure_lines
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((l: any) => ({
            key: l.id, fee_head_id: l.fee_head_id, amount: String(l.amount), is_optional: !!l.is_optional,
            limited: !!(l.period_tokens ?? []).length,
            period_tokens: (l.period_tokens ?? []) as string[],
          }))
      : [blankLine()])
  const [lateMode, setLateMode] = useState<string>(editing?.late_fee_mode ?? 'none')
  const [lateValue, setLateValue] = useState(String(editing?.late_fee_value ?? ''))
  const [graceDays, setGraceDays] = useState(String(editing?.late_fee_grace_days ?? 0))
  const [startsOn, setStartsOn] = useState(editing?.starts_on ?? '')
  const [activate, setActivate] = useState(true)
  const [saving, setSaving] = useState(false)

  // The schedule, keyed by period token. Seeded from the existing structure when
  // versioning, then filled in from the derived periods for anything missing.
  const [schedule, setSchedule] = useState<Record<string, { bills_on: string; due_date: string }>>(
    Object.fromEntries(((editing?.fee_structure_schedules ?? []) as any[]).map(r => [
      r.period_token, { bills_on: r.bills_on ?? '', due_date: r.due_date ?? '' },
    ])))
  const [dueOffset, setDueOffset] = useState(String(DEFAULT_DUE_OFFSET))

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data as any[]),
  })
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list().then((r: any) => r.data as any[]),
  })
  const { data: heads } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data as any[]),
  })

  // The installments this cadence produces, cut from the academic year's OWN
  // start date — so an April–March school gets Q1 = Apr–Jun with nothing to
  // configure. Server-derived rather than recomputed here, or the dates the form
  // shows and the dates the billing run uses could disagree.
  const { data: periodData } = useQuery({
    queryKey: ['fee-billing-periods', yearId, frequency],
    queryFn: () => feeApi.billing.periods(yearId, frequency).then(r => r.data as any[]),
    enabled: !!yearId && !!frequency,
  })

  const periods: any[] = useMemo(
    () => (periodData ?? []).find((g: any) => g.frequency === frequency)?.periods ?? [],
    [periodData, frequency])

  // Fill any period the user has not touched. Runs when the cadence changes, so
  // switching quarterly → monthly produces twelve sensible rows rather than an
  // empty table the user has to type out.
  useEffect(() => {
    if (!periods.length) return
    setSchedule(prev => {
      const next = { ...prev }
      let changed = false
      for (const p of periods) {
        if (next[p.token]?.due_date) continue
        next[p.token] = {
          bills_on: p.start,
          due_date: addDays(p.start, Number(dueOffset) || DEFAULT_DUE_OFFSET),
        }
        changed = true
      }
      return changed ? next : prev
    })
    // dueOffset is deliberately NOT a dependency: re-running on every keystroke
    // would fight the user typing in the offset box. Applying it is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods])

  // Switching cadence strands the tokens: Q1–Q4 mean nothing on a monthly plan,
  // and 2025-04 means nothing on a quarterly one. Silently dropping them — what
  // this form used to do at submit — turned an admission fee back into a
  // recurring charge with nothing on screen to say so, and the server now
  // refuses the stale tokens outright. So they are cleared where the user can
  // see it: the affected lines stay restricted, show as needing an installment,
  // and block the save until repointed.
  useEffect(() => {
    if (!periods.length) return
    const exists = new Set(periods.map(p => p.token))
    let stranded = 0
    setLines(prev => {
      const next = prev.map(l => {
        if (!l.limited) return l
        const kept = l.period_tokens.filter(t => exists.has(t))
        if (kept.length === l.period_tokens.length) return l
        stranded += 1
        return { ...l, period_tokens: kept }
      })
      return stranded ? next : prev
    })
    if (stranded) {
      toast.warning(
        `${stranded} line${stranded === 1 ? '' : 's'} lost their installments in the change of cadence`,
        { description: 'Pick which installments they are charged in before saving.' },
      )
    }
  }, [periods])

  /** Re-derive every due date from the offset. The bulk action most schools want. */
  const applyOffset = () => {
    const n = Number(dueOffset)
    if (!Number.isFinite(n) || n < 0) return toast.error('Enter a number of days')
    setSchedule(Object.fromEntries(periods.map(p => [
      p.token, { bills_on: p.start, due_date: addDays(p.start, n) },
    ])))
    toast.success(`Every installment now falls due ${n} day${n === 1 ? '' : 's'} after its period opens`)
  }

  const setSchedRow = (token: string, patch: Partial<{ bills_on: string; due_date: string }>) =>
    setSchedule(prev => ({ ...prev, [token]: { ...prev[token], ...patch } }))

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(v => v.map(l => (l.key === key ? { ...l, ...patch } : l)))

  // A head already on the plan is dropped from the other rows' options: two lines
  // for the same head are two invoice lines with the same name, which nobody can
  // read on a receipt and the model has no reason to allow.
  const headOptions = (forKey: string) => {
    const taken = new Set(lines.filter(l => l.key !== forKey && l.fee_head_id).map(l => l.fee_head_id))
    return (heads ?? []).filter(h => !taken.has(h.id))
  }

  const parsed = lines
    .filter(l => l.fee_head_id && l.amount !== '')
    .map(l => ({
      fee_head_id: l.fee_head_id, amount: Number(l.amount), is_optional: l.is_optional,
      period_tokens: l.limited ? l.period_tokens : [],
    }))
    .filter(l => Number.isFinite(l.amount) && l.amount >= 0)

  // A line restricted to installments but pinned to none bills NOWHERE. It used
  // to be unreachable only by luck — unticking the last chip quietly meant
  // "every installment" instead — and the server now refuses it, so the form
  // names it here rather than letting the save fail.
  const unpinned = lines.filter(l => l.limited && !l.period_tokens.length && l.fee_head_id)

  // The recurring figure is what a student pays each time the plan bills, so
  // period-limited lines are counted separately rather than inflating it.
  const mandatory = parsed
    .filter(l => !l.is_optional && !l.period_tokens.length).reduce((a, l) => a + l.amount, 0)
  const optional = parsed
    .filter(l => l.is_optional && !l.period_tokens.length).reduce((a, l) => a + l.amount, 0)
  const periodic = parsed.filter(l => l.period_tokens.length).reduce((a, l) => a + l.amount, 0)

  const valid = !!yearId && name.trim().length > 1 && parsed.length > 0 && !unpinned.length

  const submit = async () => {
    if (unpinned.length) {
      return toast.error('Some lines are charged "only in…" but name no installment', {
        description: 'Pick the installments they are charged in, or set them back to every installment.',
      })
    }
    if (!valid) return toast.error('A year, a name and at least one priced line are needed')
    setSaving(true)
    const body: any = {
      academic_year_id: yearId,
      name: name.trim(),
      frequency,
      class_ids: classIds,
      lines: parsed,
      late_fee_mode: lateMode,
      late_fee_value: lateMode === 'none' ? 0 : Number(lateValue) || 0,
      late_fee_grace_days: Number(graceDays) || 0,
      starts_on: startsOn || undefined,
      // Only periods this cadence actually has. Switching quarterly → monthly
      // leaves stale Q1–Q4 entries in state, and sending them would schedule
      // installments the plan can never bill.
      schedule: periods
        .filter(p => schedule[p.token]?.due_date)
        .map(p => ({
          period_token: p.token,
          label: p.label,
          bills_on: schedule[p.token].bills_on || undefined,
          due_date: schedule[p.token].due_date,
        })),
      activate,
    }
    try {
      if (isVersion) {
        const res = await feeApi.structures.newVersion(editing.id, body)
        toast.success(
          `${res.data.name} v${res.data.version} created`,
          { description: res.meta?.note },
        )
      } else {
        await feeApi.structures.create(body)
        toast.success(`${body.name} created`)
      }
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not save the structure')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isVersion ? `New version of ${editing.name}` : 'New fee structure'}
          </DialogTitle>
          <DialogDescription>
            {isVersion
              ? `Version ${(editing.version ?? 1) + 1}. The current version is kept and marked superseded, so invoices already raised can still be explained.`
              : 'A named plan: the heads it bundles, what each costs, and the classes it is offered to.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Academic year *</Label>
              <Select value={yearId} onValueChange={setYearId} disabled={isVersion}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {(years ?? []).map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="structure-name">Name *</Label>
              <Input
                id="structure-name" value={name} onChange={e => setName(e.target.value)}
                placeholder="Primary — Classes 1 to 5" disabled={isVersion}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="structure-start">Takes effect</Label>
              <Input
                id="structure-start" type="date" value={startsOn}
                onChange={e => setStartsOn(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {/* A fee revised mid-session starts on the day it was agreed, not
                    the previous April — which is why this is not just the year. */}
                Blank means the start of the academic year.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>How often is it billed? *</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {frequency === 'one_time'
                ? 'The amounts below are charged once, not per period.'
                : `The amounts below are what is charged each ${FREQUENCIES.find(f => f.value === frequency)?.period}.`}
            </p>
          </div>

          {/* ── The lines ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>What it charges for *</Label>
              <Button
                type="button" size="sm" variant="ghost" className="h-8 text-xs"
                onClick={() => setLines(v => [...v, blankLine()])}
                disabled={(heads ?? []).length <= lines.length}
              >
                <Plus className="h-3.5 w-3.5" /> Add a line
              </Button>
            </div>

            {!(heads ?? []).length ? (
              <Alert variant="warning" title="No fee categories yet">
                A structure is built out of fee categories — Tuition, Transport, Exam.
                Add them under Billing → Fee categories first.
              </Alert>
            ) : (
              <div className="space-y-2 rounded-xl border border-border p-3">
                {lines.map(line => (
                  <div key={line.key} className="space-y-1.5">
                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_130px_auto_auto]">
                      <Select
                        value={line.fee_head_id}
                        onValueChange={v => setLine(line.key, { fee_head_id: v })}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="Fee category" /></SelectTrigger>
                        <SelectContent>
                          {headOptions(line.key).map(h => (
                            <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-9" type="number" inputMode="decimal" placeholder="Amount"
                        value={line.amount} onChange={e => setLine(line.key, { amount: e.target.value })}
                      />
                      {/* Optional is the flag that makes transport billable only to
                          the children who take the bus. Without a per-student
                          opt-in row, an optional line bills nobody — which is the
                          safe default and needs no backfill. */}
                      <CheckboxField
                        className="px-1"
                        label="Optional"
                        checked={line.is_optional}
                        onChange={e => setLine(line.key, { is_optional: e.target.checked })}
                      />
                      <Button
                        type="button" size="icon" variant="ghost"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        aria-label="Remove line"
                        disabled={lines.length === 1}
                        onClick={() => setLines(v => v.filter(l => l.key !== line.key))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Which installments this line is charged in.
                        "Every installment" is the default and the common case.
                        The alternative is what an admission fee or a caution
                        deposit needs: charged once, not four times, without
                        having to keep the head off the plan and raise it by hand
                        per student. */}
                    {periods.length > 1 && (
                      <PeriodPicker
                        periods={periods}
                        selected={line.period_tokens}
                        limited={line.limited}
                        onChange={next => setLine(line.key, {
                          limited: next.limited,
                          period_tokens: next.tokens,
                        })}
                      />
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-2.5 text-sm">
                  <span className="text-muted-foreground">
                    Everyone pays{' '}
                    <span className="font-semibold tabular-nums text-foreground">{formatCurrency(mandatory)}</span>
                    {' '}each installment
                  </span>
                  {optional > 0 && (
                    <span className="text-muted-foreground">
                      Optional extras{' '}
                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(optional)}</span>
                    </span>
                  )}
                  {periodic > 0 && (
                    <span className="text-muted-foreground">
                      Charged in named installments{' '}
                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(periodic)}</span>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── The schedule ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>When each installment is due</Label>
                <p className="text-xs text-muted-foreground">
                  {periods.length
                    ? `${periods.length} installment${periods.length === 1 ? '' : 's'} a year · ${formatCurrency(mandatory)} each`
                    : 'Pick an academic year to see the installments'}
                </p>
              </div>
              {periods.length > 1 && (
                // One rule covers almost every school; the table below is the
                // escape hatch for the one term that is different.
                <div className="flex items-end gap-1.5">
                  <div className="space-y-1">
                    <Label htmlFor="due-offset" className="text-xs font-normal text-muted-foreground">
                      Due this many days after each period opens
                    </Label>
                    <Input
                      id="due-offset" type="number" className="h-9 w-20"
                      value={dueOffset} onChange={e => setDueOffset(e.target.value)}
                    />
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-9" onClick={applyOffset}>
                    Apply to all
                  </Button>
                </div>
              )}
            </div>

            {!periods.length ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Choose an academic year and a cadence, and the installments appear here.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Installment</th>
                      <th className="px-3 py-2 text-left font-medium">Bill on</th>
                      <th className="px-3 py-2 text-left font-medium">Due by</th>
                      <th className="px-3 py-2 text-right font-medium">Grace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {periods.map(p => {
                      const row = schedule[p.token] ?? { bills_on: '', due_date: '' }
                      const gap = daysBetween(row.bills_on || p.start, row.due_date)
                      return (
                        <tr key={p.token}>
                          <td className="px-3 py-2">
                            <span className="font-medium text-foreground">{p.label}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            <Input
                              type="date" className="h-8 w-[150px]"
                              value={row.bills_on}
                              onChange={e => setSchedRow(p.token, { bills_on: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input
                              type="date" className="h-8 w-[150px]"
                              value={row.due_date}
                              onChange={e => setSchedRow(p.token, { due_date: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums">
                            {/* A negative gap means the bill is due before it is
                                raised, which is always a typo. */}
                            {gap == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : gap < 0 ? (
                              <span className="font-medium text-destructive">due before billed</span>
                            ) : (
                              <span className="text-muted-foreground">{gap}d</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">Bill on</strong> is when the
              invoice should be raised; <strong className="font-medium text-foreground">Due by</strong> is
              when the money is expected. Late fees, if any, start counting after the due date.
            </p>
          </div>

          {/* ── Who it is offered to ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Offered to</Label>
              <button
                type="button" onClick={() => setClassIds([])}
                className="text-xs font-medium text-primary hover:underline"
              >
                Any class
              </button>
            </div>
            <div className="grid max-h-[150px] gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-3">
              {(classes ?? []).map(c => (
                <CheckboxField
                  key={c.id} label={c.name}
                  checked={classIds.includes(c.id)}
                  onChange={e => setClassIds(v => e.target.checked ? [...v, c.id] : v.filter(x => x !== c.id))}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {classIds.length
                ? `Assigning it to a student outside these ${classIds.length} class${classIds.length === 1 ? '' : 'es'} is refused rather than done quietly.`
                : 'No classes named — it can be assigned to anyone.'}
            </p>
          </div>

          {/* ── Late fee ── */}
          <div className="space-y-2">
            <Label>If it is paid late</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select value={lateMode} onValueChange={setLateMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LATE_FEE_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {lateMode !== 'none' && (
                <>
                  <div className="space-y-1">
                    <Input
                      type="number" inputMode="decimal" value={lateValue}
                      onChange={e => setLateValue(e.target.value)}
                      placeholder={lateMode === 'percent_monthly' ? '2' : '100'}
                    />
                    <p className="text-xs text-muted-foreground">
                      {lateMode === 'percent_monthly' ? '% of the outstanding' : 'Rupees'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Input
                      type="number" value={graceDays} onChange={e => setGraceDays(e.target.value)} placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Grace days</p>
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {LATE_FEE_MODES.find(m => m.value === lateMode)?.hint}
              {lateMode !== 'none' && ' Late fees are only applied when the sweep is run from Recovery.'}
            </p>
          </div>

          {!isVersion && (
            <CheckboxField
              label="Make it active straight away"
              hint="A draft can be built up and reviewed first; only an active plan can be billed."
              checked={activate}
              onChange={e => setActivate(e.target.checked)}
            />
          )}

          {isVersion && (
            <Alert variant="info" title="Students stay on the old version until reassigned">
              This creates version {(editing.version ?? 1) + 1} and supersedes the current one.
              Anyone already assigned keeps being billed the figures they were put on.
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {/* A disabled button that will not say why is a dead end. The commonest
              way to reach one here is typing an amount without choosing the fee
              category beside it — the row looks filled in, and the totals quietly
              read ₹0 because a line with no head is not a line. */}
          {!valid && (
            <p className="mr-auto text-xs text-muted-foreground">
              Still needed: {[
                !yearId && 'an academic year',
                name.trim().length <= 1 && 'a name',
                !parsed.length && (lines.some(l => l.amount !== '' && !l.fee_head_id)
                  ? 'a fee category on the priced line'
                  : 'at least one priced line'),
              ].filter(Boolean).join(', ')}
            </p>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isVersion ? `Create version ${(editing.version ?? 1) + 1}` : 'Create structure'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Raising one installment ───────────────────────────────────────────
//
// This replaces the Billing screen. That screen asked five questions — year,
// cadence, period, categories, due date — of which four are now answered by the
// plan you clicked from, and the fifth (the due date) is a property of the plan's
// schedule rather than of whoever happens to be running it.
//
// What is kept is the part that mattered: preview writes nothing and shows
// exactly what generate will do, skipped students are named rather than silently
// dropped, and a large run has to be confirmed deliberately.

export function BillPeriodDialog({
  structure, period, onClose,
}: {
  structure: any
  /** A row from the plan's schedule. */
  period: any
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [typed, setTyped] = useState('')

  const body = {
    academic_year_id: structure.academic_year_id,
    frequency: structure.frequency,
    period_token: period.period_token,
    structure_id: structure.id,
  }

  // Previewed on open rather than behind a button: you arrived here by clicking
  // "Bill now" on a specific installment, so the only question left is "what
  // exactly will that do", and making the user ask for it twice is friction.
  useEffect(() => {
    let cancelled = false
    feeApi.billing.preview(body)
      .then(r => { if (!cancelled) setPreview(r.data) })
      .catch(e => {
        if (!cancelled) toast.error(e?.response?.data?.error ?? 'Could not work out what would be billed')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure.id, period.period_token])

  const bills: any[] = preview?.bills ?? []
  const skipped: any[] = preview?.skipped ?? []
  const needsTyping = bills.length > 100
  const ready = bills.length > 0 && (!needsTyping || typed.trim().toUpperCase() === 'BILL')

  const skipSummary = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1
    return counts
  }, [skipped])

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await feeApi.billing.generate(body)
      const n = res.data.generated
      if (!n) toast.info(res.data.message ?? 'Nothing to bill')
      else toast.success(`${n} invoice${n === 1 ? '' : 's'} raised · ${formatCurrency(res.data.total_amount ?? 0)}`)
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not raise the invoices')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bill {period.label ?? period.period_token}</DialogTitle>
          <DialogDescription>
            {structure.name} · due {formatDate(period.due_date)}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Working out who gets billed…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {formatCurrency(preview?.totals?.amount ?? 0)}
              </p>
              <p className="text-sm text-muted-foreground">
                across {bills.length} student{bills.length === 1 ? '' : 's'}
                {(preview?.totals?.discount ?? 0) > 0 &&
                  ` · after ${formatCurrency(preview.totals.discount)} of concessions`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Each invoice falls due {formatDate(period.due_date)}, from this plan&apos;s schedule.
              </p>
            </div>

            {!!skipped.length && (
              // A class going unbilled for a term because nobody was assigned is
              // exactly the failure this list exists to make visible.
              <Alert variant="warning" title={`${skipped.length} student${skipped.length === 1 ? '' : 's'} skipped`}>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(skipSummary).map(([reason, count]) => (
                    <li key={reason}>{count} — {SKIP_REASONS[reason] ?? reason}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {!bills.length && (
              <Alert variant="info" title="Nothing to raise">
                Every student on this plan already has an invoice for this
                installment, or nobody is assigned to it yet.
              </Alert>
            )}

            {!!bills.length && (
              <Alert variant="info" title="Safe to re-run">
                If students join later, bill this installment again — only the ones
                without an invoice are picked up.
              </Alert>
            )}

            {needsTyping && (
              <div className="space-y-1.5">
                <Label htmlFor="bill-confirm">
                  This bills {bills.length} families at once. Type <strong>BILL</strong> to confirm.
                </Label>
                <Input id="bill-confirm" value={typed} onChange={e => setTyped(e.target.value)} placeholder="BILL" />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={generating}>Cancel</Button>
          <Button onClick={generate} disabled={!ready || generating || loading}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Raise {bills.length} invoice{bills.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Putting students on a plan ────────────────────────────────────────
//
// Preview before write, always. Billing 400 families is not something to discover
// the shape of afterwards, and the skipped counts are the useful half: "already on
// another plan" and "outside the classes this is offered to" are the two ways an
// assignment silently does less than you expected.

export function AssignDialog({ structure, onClose }: { structure: any; onClose: () => void }) {
  const qc = useQueryClient()
  const offeredTo: string[] = useMemo(
    () => (structure.fee_structure_classes ?? []).map((c: any) => c.class_id),
    [structure])

  const [classIds, setClassIds] = useState<string[]>(offeredTo)
  const [students, setStudents] = useState<StudentLite[]>([])
  const [byStudent, setByStudent] = useState(false)
  const [category, setCategory] = useState('general')
  const [startDate, setStartDate] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [previewing, setPreviewing] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list().then((r: any) => r.data as any[]),
  })

  // Only the classes the plan is offered to can be picked. Anything else is
  // rejected server-side anyway, so offering it here would just be a trap.
  const selectable = (classes ?? []).filter(c => !offeredTo.length || offeredTo.includes(c.id))

  // student_ids wins on the server when both are sent, so only one is ever put
  // in the body — a leftover class selection must not widen a named list.
  const body = () => ({
    structure_id: structure.id,
    class_ids: byStudent ? [] : classIds,
    student_ids: byStudent ? students.map(s => s.id) : [],
    fee_category: category,
    start_date: startDate || undefined,
  })

  const runPreview = async () => {
    setPreviewing(true)
    try {
      const res = await feeApi.assignments.preview(body())
      setPreview(res.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not build the preview')
    } finally {
      setPreviewing(false)
    }
  }

  const runAssign = async () => {
    setAssigning(true)
    try {
      const res = await feeApi.assignments.create(body())
      const n = res.data.assigned
      if (n === 0) toast.info(res.data.message ?? 'Nobody new to assign')
      else toast.success(`${n} student${n === 1 ? '' : 's'} put on ${structure.name}`)
      invalidateFeeQueries(qc)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not assign the plan')
    } finally {
      setAssigning(false)
    }
  }

  const skipped = preview?.skipped
  const skippedTotal = skipped
    ? skipped.already_on_this + skipped.on_another_plan + skipped.out_of_scope
    : 0

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign {structure.name}</DialogTitle>
          <DialogDescription>
            Puts students on this plan so the next billing run picks them up.
            Nothing is invoiced here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{byStudent ? 'Students' : 'Classes'}</Label>
              {/* A fee category is rarely a property of a whole class — siblings
                  and staff wards are a handful of children scattered across the
                  school — and the plan itself sometimes needs to go to named
                  students too. The API has always taken either. */}
              <button
                type="button"
                onClick={() => { setPreview(null); setByStudent(v => !v) }}
                className="text-xs font-medium text-primary hover:underline"
              >
                {byStudent ? 'Pick whole classes instead' : 'Pick individual students instead'}
              </button>
            </div>

            {byStudent ? (
              <>
                <StudentSearch
                  value={null}
                  onSelect={s => {
                    if (!s) return
                    setPreview(null)
                    setStudents(v => (v.some(x => x.id === s.id) ? v : [...v, s]))
                  }}
                />
                {!!students.length && (
                  <div className="flex flex-wrap gap-1.5 rounded-xl border border-border p-3">
                    {students.map(s => (
                      <span
                        key={s.id}
                        className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                      >
                        {studentLabel(s)}
                        <button
                          type="button"
                          aria-label={`Remove ${s.first_name} ${s.last_name}`}
                          onClick={() => { setPreview(null); setStudents(v => v.filter(x => x.id !== s.id)) }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {students.length
                    ? `${students.length} student${students.length === 1 ? '' : 's'} named. Anyone outside the classes this plan is offered to is reported, not assigned.`
                    : 'Search by name or admission number. Nothing is assigned until you preview.'}
                </p>
              </>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setPreview(null); setClassIds(classIds.length === selectable.length ? [] : selectable.map(c => c.id)) }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {classIds.length === selectable.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="grid max-h-[150px] gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                  {selectable.map(c => (
                    <CheckboxField
                      key={c.id} label={c.name}
                      checked={classIds.includes(c.id)}
                      onChange={e => {
                        setPreview(null)
                        setClassIds(v => e.target.checked ? [...v, c.id] : v.filter(x => x !== c.id))
                      }}
                    />
                  ))}
                </div>
                {!classIds.length && (
                  <p className="text-xs text-muted-foreground">
                    Nothing selected — every eligible student in the school is considered.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Fee category</Label>
              <Select value={category} onValueChange={v => { setPreview(null); setCategory(v) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* Said plainly, because the obvious assumption is the wrong one:
                  picking RTE here does NOT reduce anybody's bill. It groups them
                  in reporting. The money comes off via a concession. */}
              <p className="text-xs text-muted-foreground">
                For reporting only — it does not change what they are billed.
                Grant a concession for that.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-start">Starts from</Label>
              <Input
                id="assign-start" type="date" value={startDate}
                onChange={e => { setPreview(null); setStartDate(e.target.value) }}
              />
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={runPreview} disabled={previewing}>
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Preview
          </Button>

          {preview && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {preview.eligible_count} student{preview.eligible_count === 1 ? '' : 's'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(preview.per_student_total)} each per period ·{' '}
                  {formatCurrency(preview.grand_total)} in total
                </p>
              </div>

              {!!preview.sample?.length && (
                <p className="text-xs text-muted-foreground">
                  {preview.sample.map((s: any) => s.name).join(', ')}
                  {preview.eligible_count > preview.sample.length &&
                    ` and ${preview.eligible_count - preview.sample.length} more`}
                </p>
              )}

              {skippedTotal > 0 && (
                <Alert variant="warning" title={`${skippedTotal} skipped`}>
                  <ul className="mt-1 space-y-0.5">
                    {skipped.already_on_this > 0 && <li>{skipped.already_on_this} already on this plan</li>}
                    {skipped.on_another_plan > 0 && (
                      <li>
                        {skipped.on_another_plan} on a different plan for this year —
                        move them off it first
                      </li>
                    )}
                    {skipped.out_of_scope > 0 && (
                      <li>{skipped.out_of_scope} outside the classes this plan is offered to</li>
                    )}
                  </ul>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={assigning}>Cancel</Button>
          <Button onClick={runAssign} disabled={assigning || !preview || !preview.eligible_count}>
            {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Assign {preview ? `${preview.eligible_count} student${preview.eligible_count === 1 ? '' : 's'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
