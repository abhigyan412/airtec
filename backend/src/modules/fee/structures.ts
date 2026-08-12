import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { Frequency, periodsForFrequency, unknownPeriodTokens } from '../../shared/utils/billingPeriod'
import { FeeRequest, requireFeeView, requireFeeManage } from './lib/guards'

// A structure is a NAMED, VERSIONED billing plan — heads bundled with amounts,
// a cadence, a late-fee rule, and the classes it is offered to.
//
// The old model was a flat (class, head, amount) matrix. It could not express
// "Class 5 pays this bundle", could not be versioned, and — worst — editing an
// amount silently changed what already-assigned students were billed under, with
// no record of the old figure. A live structure is now superseded, never mutated.

const router = Router()

const SELECT = `
  *,
  fee_structure_lines(id, fee_head_id, amount, is_optional, period_tokens, sort_order, fee_heads(id, name, code)),
  fee_structure_classes(class_id, classes(id, name)),
  fee_structure_schedules(id, period_token, label, bills_on, due_date, sort_order)
`

const LineSchema = z.object({
  fee_head_id: z.string().uuid(),
  amount: z.number().min(0),
  is_optional: z.boolean().default(false),
  /**
   * Periods this line bills in. Omitted or empty = every period, which is what
   * every line did before the column existed. `['Q1']` is the once-a-year case:
   * an admission fee or caution deposit that must not repeat each quarter.
   */
  period_tokens: z.array(z.string().min(1)).nullish(),
})

/** Empty and undefined both mean "every period"; only NULL is stored for it. */
const normalisePeriods = (tokens?: string[] | null) =>
  tokens && tokens.length ? Array.from(new Set(tokens)) : null

/** Lines that bill in every period — the recurring cost of being on this plan. */
const recurring = (lines: any[]) => lines.filter((l: any) => !l.period_tokens?.length)
/** Lines restricted to particular periods — charged during the year, not every time. */
const periodic = (lines: any[]) => lines.filter((l: any) => l.period_tokens?.length)

/** One installment: when it is raised and when the money is due. */
const ScheduleSchema = z.object({
  period_token: z.string().min(1),
  label: z.string().optional(),
  bills_on: z.string().optional(),
  due_date: z.string().min(1),
})

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

// Kept as a plain object so the versions route can call .partial() on it —
// a .refine() would make it a ZodEffects, which has no .partial().
const BaseSchema = z.object({
  academic_year_id: z.string().uuid(),
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annually', 'one_time']),
  late_fee_mode: z.enum(['none', 'fixed', 'per_day', 'percent_monthly']).default('none'),
  late_fee_value: z.number().min(0).default(0),
  late_fee_grace_days: z.number().int().min(0).max(90).default(0),
  starts_on: DATE.optional(),
  ends_on: DATE.optional(),
  class_ids: z.array(z.string().uuid()).default([]),
  lines: z.array(LineSchema).min(1, 'A structure needs at least one fee head'),
  schedule: z.array(ScheduleSchema).default([]),
  activate: z.boolean().default(true),
})

const endsAfterStart = (v: { starts_on?: string; ends_on?: string }) =>
  !v.starts_on || !v.ends_on || v.starts_on <= v.ends_on
const RANGE_ERROR = { message: 'The plan cannot end before it starts', path: ['ends_on'] as const }

const CreateSchema = BaseSchema.refine(endsAfterStart, RANGE_ERROR)
const VersionSchema = BaseSchema.partial().refine(endsAfterStart, RANGE_ERROR)

const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')

// ── Period tokens have to be real installments ────────────────────────
//
// A line pinned to an installment the cadence does not have bills in NO period
// at all — the resolver looks for its token in the period being raised and never
// finds it. It is silent: the plan looks correct, the line sits on it all year,
// and the charge simply never appears.
//
// The way in is a version raised to change something else: carry `['2025-04']`
// forward onto a plan switched to quarterly and the admission fee vanishes. So
// the tokens are checked against the cadence's own installments before anything
// is written, and the save is refused with the line named.

async function loadYear(schoolId: string, academicYearId: string) {
  const { data } = await supabase.from('academic_years')
    .select('id, name, start_date, end_date')
    .eq('id', academicYearId).eq('school_id', schoolId).maybeSingle()
  return data
}

/** Head names for an error message, so it says "Admission Fee" not a UUID. */
async function headNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data } = await supabase.from('fee_heads').select('id, name').in('id', ids)
  return new Map((data ?? []).map((h: any) => [h.id, h.name]))
}

/**
 * Throws a message the user can act on if any line or schedule row names an
 * installment this cadence cannot raise.
 */
async function assertPeriodsExist(
  schoolId: string,
  academicYearId: string,
  frequency: Frequency,
  lines: z.infer<typeof LineSchema>[],
  schedule: z.infer<typeof ScheduleSchema>[],
) {
  const year = await loadYear(schoolId, academicYearId)
  if (!year) throw new Error('Academic year not found')

  const periods = periodsForFrequency(frequency, year.start_date, year.end_date)
  const available = periods.map(p => p.token).join(', ')

  const badLines = lines
    .map(l => ({
      line: l,
      unknown: unknownPeriodTokens(frequency, l.period_tokens ?? [], year.start_date, year.end_date),
    }))
    .filter(x => x.unknown.length)

  if (badLines.length) {
    const names = await headNames(badLines.map(x => x.line.fee_head_id))
    const [first] = badLines
    const label = names.get(first.line.fee_head_id) ?? 'A fee line'
    throw new Error(
      `${label} is set to be charged only in ${first.unknown.join(', ')}, which a ` +
      `${frequency.replace('_', '-')} plan does not have. Its installments are ${available}. ` +
      'Pick from those, or charge the line in every installment.',
    )
  }

  const badSchedule = unknownPeriodTokens(
    frequency, schedule.map(s => s.period_token), year.start_date, year.end_date)
  if (badSchedule.length) {
    throw new Error(
      `The schedule sets a due date for ${badSchedule.join(', ')}, which a ` +
      `${frequency.replace('_', '-')} plan does not have. Its installments are ${available}.`,
    )
  }
}

/** Write lines, class links and schedule. Shared by create and new-version. */
async function writeChildren(
  structureId: string,
  lines: z.infer<typeof LineSchema>[],
  classIds: string[],
  schedule: z.infer<typeof ScheduleSchema>[] = [],
) {
  if (lines.length) {
    const { error } = await supabase.from('fee_structure_lines').insert(
      lines.map((l, i) => ({
        structure_id: structureId,
        fee_head_id: l.fee_head_id,
        amount: l.amount,
        is_optional: l.is_optional,
        // Built explicitly rather than spread: an empty array would pass the
        // column's check constraint only as NULL, and a spread would carry
        // whatever shape the caller happened to send.
        period_tokens: normalisePeriods(l.period_tokens),
        sort_order: i,
      })))
    if (error) throw new Error(error.message)
  }
  if (classIds.length) {
    const { error } = await supabase.from('fee_structure_classes').insert(
      classIds.map(class_id => ({ structure_id: structureId, class_id })))
    if (error) throw new Error(error.message)
  }
  if (schedule.length) {
    // Two rows for the same period would give the billing run two due dates to
    // choose between, so a duplicated token is refused here rather than letting
    // the unique index surface as a raw Postgres error.
    const seen = new Set<string>()
    for (const s of schedule) {
      if (seen.has(s.period_token)) throw new Error(`Duplicate period "${s.period_token}" in the schedule`)
      seen.add(s.period_token)
    }
    const { error } = await supabase.from('fee_structure_schedules').insert(
      schedule.map((s, i) => ({
        structure_id: structureId,
        period_token: s.period_token,
        label: s.label ?? null,
        bills_on: s.bills_on || null,
        due_date: s.due_date,
        sort_order: i,
      })))
    if (error) throw new Error(error.message)
  }
}

router.get('/', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id, status, class_id } = req.query
  let q = supabase.from('fee_structures').select(SELECT)
    .eq('school_id', req.user!.school_id).order('name').order('version', { ascending: false })

  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
  if (status) q = q.eq('status', status as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = (data ?? []).map((s: any) => {
    const lines = (s.fee_structure_lines ?? []) as any[]
    const sum = (ls: any[]) => money(ls.reduce((a: number, l: any) => a + Number(l.amount), 0))
    return {
      ...s,
      total: sum(lines),
      // Per INSTALLMENT, so it counts only what recurs. A once-a-year admission
      // fee on a quarterly plan is not part of "what this plan charges each
      // quarter", and folding it in overstated three quarters out of four.
      mandatory_total: sum(recurring(lines).filter((l: any) => !l.is_optional)),
      // What the same student is additionally charged at some point in the year,
      // reported separately rather than hidden or averaged into the figure above.
      periodic_total: sum(periodic(lines).filter((l: any) => !l.is_optional)),
    }
  })

  const filtered = class_id
    ? rows.filter((s: any) => (s.fee_structure_classes ?? []).some((c: any) => c.class_id === class_id))
    : rows

  res.json({ success: true, data: filtered })
}))

router.get('/:id', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { data, error } = await supabase.from('fee_structures').select(SELECT)
    .eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
  if (error) return res.status(500).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Structure not found' })

  const [{ count }, invRes] = await Promise.all([
    supabase.from('fee_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('structure_id', req.params.id).eq('status', 'active'),
    // What this plan has actually raised, per period. Reached through the
    // assignment because that is the only link an invoice keeps to its plan —
    // period_key alone would count every plan billing the same quarter.
    supabase.from('fee_invoices')
      .select('period_key, total_amount, amount_paid, fee_assignments!inner(structure_id)')
      .eq('school_id', req.user!.school_id)
      .eq('fee_assignments.structure_id', req.params.id)
      .neq('status', 'cancelled'),
  ])

  const raised = new Map<string, { invoices: number; billed: number; collected: number }>()
  for (const inv of (invRes.data ?? []) as any[]) {
    const token = String(inv.period_key ?? '').split(':')[1]
    if (!token) continue
    const cur = raised.get(token) ?? { invoices: 0, billed: 0, collected: 0 }
    cur.invoices += 1
    cur.billed = money(cur.billed + Number(inv.total_amount))
    cur.collected = money(cur.collected + Number(inv.amount_paid))
    raised.set(token, cur)
  }

  const schedule = ((data as any).fee_structure_schedules ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s: any) => ({
      ...s,
      ...(raised.get(s.period_token) ?? { invoices: 0, billed: 0, collected: 0 }),
      status: (raised.get(s.period_token)?.invoices ?? 0) > 0 ? 'billed' : 'pending',
    }))

  res.json({
    success: true,
    data: { ...data, assigned_students: count ?? 0, schedule },
  })
}))

router.post('/', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CreateSchema.parse(req.body)
  const school_id = req.user!.school_id

  // Before the header exists, so a rejected plan leaves nothing behind.
  try {
    await assertPeriodsExist(school_id, body.academic_year_id, body.frequency, body.lines, body.schedule)
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message })
  }

  const { data: structure, error } = await supabase.from('fee_structures').insert({
    school_id,
    academic_year_id: body.academic_year_id,
    name: body.name.trim(),
    code: slug(body.code ?? body.name),
    frequency: body.frequency,
    late_fee_mode: body.late_fee_mode,
    late_fee_value: body.late_fee_value,
    late_fee_grace_days: body.late_fee_grace_days,
    starts_on: body.starts_on ?? null,
    ends_on: body.ends_on ?? null,
    status: body.activate ? 'active' : 'draft',
    created_by: req.user!.id,
  }).select().single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'A structure with that code already exists for this year' })
    }
    return res.status(400).json({ success: false, error: error.message })
  }

  try {
    await writeChildren(structure.id, body.lines, body.class_ids, body.schedule)
  } catch (e: any) {
    // The header without its lines is a structure that bills nothing, so it is
    // removed rather than left as a trap.
    await supabase.from('fee_structures').delete().eq('id', structure.id)
    return res.status(400).json({ success: false, error: e.message })
  }

  res.status(201).json({ success: true, data: structure })
}))

// ── POST /:id/versions ────────────────────────────────────────────────
//
// The only way to change a structure that students are already on. The old
// version is marked superseded and keeps its lines, so an invoice raised last
// term can still be explained.
router.post('/:id/versions', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = VersionSchema.parse(req.body ?? {})
  const school_id = req.user!.school_id

  const { data: current, error: currentErr } = await supabase.from('fee_structures').select(SELECT)
    .eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
  if (currentErr) return res.status(500).json({ success: false, error: currentErr.message })
  if (!current) return res.status(404).json({ success: false, error: 'Structure not found' })

  const lines = body.lines ?? (current.fee_structure_lines ?? []).map((l: any) => ({
    fee_head_id: l.fee_head_id, amount: Number(l.amount), is_optional: l.is_optional,
    // Carried like the amounts are: a version raised to change tuition must not
    // quietly turn a once-a-year admission fee back into a quarterly one.
    period_tokens: l.period_tokens ?? null,
  }))
  const classIds = body.class_ids ?? (current.fee_structure_classes ?? []).map((c: any) => c.class_id)
  // Carried forward like the lines are: a version raised to change an amount
  // should not silently drop the due dates the school already agreed.
  const schedule = body.schedule ?? (current.fee_structure_schedules ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s: any) => ({
      period_token: s.period_token, label: s.label ?? undefined,
      bills_on: s.bills_on ?? undefined, due_date: s.due_date,
    }))

  const academicYearId = body.academic_year_id ?? current.academic_year_id
  const frequency = (body.frequency ?? current.frequency) as Frequency

  // The case this exists for: a version raised to change an amount, on a plan
  // whose cadence also changed. The carried-forward tokens belong to the OLD
  // cadence, and storing them would leave those lines billing in no period at
  // all — so the version is refused until the lines are repointed.
  try {
    await assertPeriodsExist(school_id, academicYearId, frequency, lines, schedule)
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message })
  }

  const { data: next, error } = await supabase.from('fee_structures').insert({
    school_id,
    academic_year_id: academicYearId,
    name: body.name ?? current.name,
    code: current.code,
    frequency,
    late_fee_mode: body.late_fee_mode ?? current.late_fee_mode,
    late_fee_value: body.late_fee_value ?? current.late_fee_value,
    late_fee_grace_days: body.late_fee_grace_days ?? current.late_fee_grace_days,
    starts_on: body.starts_on ?? current.starts_on,
    ends_on: body.ends_on ?? current.ends_on,
    version: (current.version ?? 1) + 1,
    supersedes_id: current.id,
    status: 'active',
    created_by: req.user!.id,
  }).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  try { await writeChildren(next.id, lines, classIds, schedule) }
  catch (e: any) {
    await supabase.from('fee_structures').delete().eq('id', next.id)
    return res.status(400).json({ success: false, error: e.message })
  }

  await supabase.from('fee_structures').update({ status: 'superseded' }).eq('id', current.id)

  res.status(201).json({
    success: true, data: next,
    meta: { note: 'Students already assigned stay on the previous version until reassigned.' },
  })
}))

router.patch('/:id/status', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const status = String(req.body?.status ?? '')
  if (!['draft', 'active', 'archived'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be draft, active or archived' })
  }

  if (status === 'archived') {
    const { count } = await supabase.from('fee_assignments')
      .select('id', { count: 'exact', head: true }).eq('structure_id', req.params.id).eq('status', 'active')
    if ((count ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        error: `${count} student(s) are still on this plan. Move them to another structure before archiving it.`,
      })
    }
  }

  const { data, error } = await supabase.from('fee_structures').update({ status })
    .eq('id', req.params.id).eq('school_id', req.user!.school_id).select().maybeSingle()
  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Structure not found' })
  res.json({ success: true, data })
}))

export default router
