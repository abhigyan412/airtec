import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { FREQUENCIES, Frequency, findPeriod, periodsForFrequency } from '../../shared/utils/billingPeriod'
import { selectIn, insertChunked } from './lib/db'
import { FeeRequest, requireFeeView, requireFeeManage } from './lib/guards'

// What the state owes the school.
//
// Every other number in this module is money a family owes. This one is not, and
// keeping it in the same tables was the whole problem: an RTE seat billed at the
// school's own rate showed up as a parent's arrears, on the chase list, next to
// their phone number, when in fact the family was admitted free and a government
// is the debtor.
//
// The claim is computed from the STATE's rate — per class band, per month — not
// from the school's fee. Those two numbers are different on purpose and a school
// that conflates them either under-claims or reports revenue it will never see.

const router = Router()

const RateSchema = z.object({
  academic_year_id: z.string().uuid(),
  class_from: z.number().int().min(0),
  class_to: z.number().int().min(0),
  monthly_amount: z.number().min(0),
  annual_allowance: z.number().min(0).default(0),
  note: z.string().max(200).optional(),
}).refine(v => v.class_to >= v.class_from, {
  message: 'The band cannot end below where it starts',
  path: ['class_to'],
})

// ── Rates ─────────────────────────────────────────────────────────────

router.get('/rates', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id } = req.query
  let q = supabase.from('rte_rates').select('*')
    .eq('school_id', req.user!.school_id).order('class_from')
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({
    success: true, data,
    meta: { note: 'The state\'s per-child rate, which is not the school\'s fee. Set from the state notification for this year.' },
  })
}))

router.put('/rates', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = RateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data, error } = await supabase.from('rte_rates').upsert({
    school_id,
    academic_year_id: body.academic_year_id,
    class_from: body.class_from,
    class_to: body.class_to,
    monthly_amount: body.monthly_amount,
    annual_allowance: body.annual_allowance,
    note: body.note ?? null,
  }, { onConflict: 'school_id,academic_year_id,class_from,class_to' }).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.delete('/rates/:id', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { error } = await supabase.from('rte_rates').delete()
    .eq('id', req.params.id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data: { removed: true } })
}))

// ── Raising the claims for a period ───────────────────────────────────

const GenerateSchema = z.object({
  academic_year_id: z.string().uuid(),
  frequency: z.enum(FREQUENCIES as [Frequency, ...Frequency[]]).default('quarterly'),
  period_token: z.string().min(1),
  /** Include the once-a-year uniform/books allowance in this period's claim. */
  include_annual_allowance: z.boolean().default(false),
  preview: z.boolean().default(false),
})

/** Whole months a period spans, which is what the state's monthly rate multiplies. */
function monthsIn(start: string, end: string): number {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1)
}

router.post('/claims/generate', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = GenerateSchema.parse(req.body)
  const school_id = req.user!.school_id

  const { data: year } = await supabase.from('academic_years')
    .select('id, name, start_date, end_date')
    .eq('id', body.academic_year_id).eq('school_id', school_id).maybeSingle()
  if (!year) return res.status(404).json({ success: false, error: 'Academic year not found' })

  const period = findPeriod(body.frequency, body.period_token, year.start_date, year.end_date)
  if (!period) {
    return res.status(400).json({
      success: false,
      error: `'${body.period_token}' is not a valid ${body.frequency} period for ${year.name}`,
    })
  }

  // Who is on an RTE seat. The category is on the assignment, so a student
  // recategorised mid-year is picked up on the next run without a backfill.
  const { data: assignments, error: aErr } = await supabase.from('fee_assignments')
    .select('student_id, students!inner(id, first_name, last_name, admission_number, status, classes(name, numeric_level))')
    .eq('school_id', school_id).eq('academic_year_id', body.academic_year_id)
    .eq('fee_category', 'rte').eq('status', 'active')
    .eq('students.status', 'active')
  if (aErr) return res.status(500).json({ success: false, error: aErr.message })

  const students = (assignments ?? []).map((a: any) => a.students).filter(Boolean)
  if (!students.length) {
    return res.json({
      success: true,
      data: { generated: 0, claims: [], skipped: [], total: 0, message: 'No students are on the RTE category for this year.' },
    })
  }

  const { data: rates } = await supabase.from('rte_rates').select('*')
    .eq('school_id', school_id).eq('academic_year_id', body.academic_year_id)

  const rateFor = (level: number | null) =>
    (rates ?? []).find((r: any) => level != null && level >= r.class_from && level <= r.class_to)

  // Already claimed for this period — the unique index would refuse them anyway,
  // and reporting is better than a constraint violation the user has to read.
  const existing = await selectIn<any>(
    'rte_reimbursement_claims', 'student_id', 'student_id', students.map((s: any) => s.id),
    q => q.eq('academic_year_id', body.academic_year_id).eq('period_key', period.key))
  const claimed = new Set(existing.map(c => c.student_id))

  const months = monthsIn(period.start, period.end)
  const rows: any[] = []
  const skipped: any[] = []

  for (const s of students as any[]) {
    const name = `${s.first_name} ${s.last_name}`
    if (claimed.has(s.id)) { skipped.push({ student: name, reason: 'already_claimed' }); continue }

    const level = s.classes?.numeric_level ?? null
    const rate = rateFor(level)
    if (!rate) {
      // Silently claiming ₹0 would look like a completed run and lose the money.
      skipped.push({ student: name, reason: 'no_rate_for_class', class: s.classes?.name ?? null })
      continue
    }

    const amount = money(
      Number(rate.monthly_amount) * months
      + (body.include_annual_allowance ? Number(rate.annual_allowance) : 0))

    rows.push({
      school_id,
      student_id: s.id,
      academic_year_id: body.academic_year_id,
      period_key: period.key,
      claim_amount: amount,
      status: 'pending',
      created_by: req.user!.id,
      _name: name,
      _class: s.classes?.name ?? null,
    })
  }

  const total = money(rows.reduce((sum, r) => sum + r.claim_amount, 0))

  if (body.preview) {
    return res.json({
      success: true,
      data: {
        period: { ...period, frequency: body.frequency, months },
        would_generate: rows.length,
        total,
        skipped,
        sample: rows.slice(0, 10).map(r => ({ student: r._name, class: r._class, amount: r.claim_amount })),
      },
    })
  }

  if (!rows.length) {
    return res.json({
      success: true,
      data: { generated: 0, total: 0, skipped, message: 'Nothing to claim — every RTE student was skipped (see details).' },
    })
  }

  const inserted = await insertChunked(
    'rte_reimbursement_claims',
    rows.map(({ _name, _class, ...r }) => r),
    'id, student_id, claim_amount')

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id,
    action: 'RTE_CLAIMS_GENERATED', entity_type: 'rte_reimbursement_claim', entity_id: null,
    new_values: { period_key: period.key, generated: inserted.length, total },
  })

  res.status(201).json({
    success: true,
    data: {
      generated: inserted.length, total, skipped,
      period: { ...period, frequency: body.frequency, months },
    },
  })
}))

// ── The ledger, and its ageing ────────────────────────────────────────

router.get('/claims', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id, status } = req.query
  let q = supabase.from('rte_reimbursement_claims')
    .select('*, students(id, first_name, last_name, admission_number, classes(name))')
    .eq('school_id', req.user!.school_id)
    .order('period_key').order('created_at', { ascending: false })
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
  if (status) q = q.eq('status', status as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = data ?? []
  const sum = (f: (r: any) => number) => money(rows.reduce((s, r) => s + f(r), 0))

  // Outstanding is claimed-minus-received, not claimed-minus-nothing: a claim
  // part-paid by the state is the normal case, and treating it as unpaid
  // overstates what is still coming.
  const outstanding = money(rows
    .filter((r: any) => r.status !== 'rejected')
    .reduce((s: number, r: any) => s + (Number(r.claim_amount) - Number(r.received_amount ?? 0)), 0))

  res.json({
    success: true,
    data: rows,
    meta: {
      total_claimed: sum((r: any) => Number(r.claim_amount)),
      total_received: sum((r: any) => Number(r.received_amount ?? 0)),
      outstanding,
      by_status: rows.reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1
        return acc
      }, {}),
      note: 'Owed to the school by the state. Nothing here is a family debt and none of it belongs on the defaulters list.',
    },
  })
}))

const UpdateClaimSchema = z.object({
  status: z.enum(['pending', 'submitted', 'received', 'rejected']),
  submitted_on: z.string().optional(),
  received_on: z.string().optional(),
  received_amount: z.number().min(0).optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(300).optional(),
})

router.patch('/claims/:id', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = UpdateClaimSchema.parse(req.body)
  const school_id = req.user!.school_id

  // "Received" with no figure is the state of a claim nobody has reconciled.
  // Requiring the amount is what makes the outstanding total mean anything.
  if (body.status === 'received' && body.received_amount == null) {
    return res.status(400).json({
      success: false,
      error: 'Recording a claim as received needs the amount that actually came in — a short payment is common and is the number the school has to chase.',
    })
  }

  const { data, error } = await supabase.from('rte_reimbursement_claims').update({
    ...body,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('school_id', school_id).select().maybeSingle()

  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Claim not found' })

  const short = body.status === 'received'
    ? money(Number(data.claim_amount) - Number(data.received_amount ?? 0))
    : 0

  res.json({
    success: true, data,
    meta: short > 0
      ? { shortfall: short, note: `The state paid ${short} less than claimed. That gap stays outstanding.` }
      : {},
  })
}))

// ── The summary the board asks for ────────────────────────────────────

router.get('/summary', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { academic_year_id } = req.query

  const [claimsRes, seatsRes] = await Promise.all([
    (() => {
      let q = supabase.from('rte_reimbursement_claims')
        .select('period_key, claim_amount, received_amount, status')
        .eq('school_id', school_id)
      if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
      return q
    })(),
    (() => {
      let q = supabase.from('fee_assignments')
        .select('student_id', { count: 'exact', head: true })
        .eq('school_id', school_id).eq('fee_category', 'rte').eq('status', 'active')
      if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
      return q
    })(),
  ])

  const claims = claimsRes.data ?? []
  const byPeriod = new Map<string, { claimed: number; received: number; count: number; pending: number }>()
  for (const c of claims as any[]) {
    const cur = byPeriod.get(c.period_key) ?? { claimed: 0, received: 0, count: 0, pending: 0 }
    cur.claimed = money(cur.claimed + Number(c.claim_amount))
    cur.received = money(cur.received + Number(c.received_amount ?? 0))
    cur.count += 1
    if (c.status === 'pending' || c.status === 'submitted') cur.pending += 1
    byPeriod.set(c.period_key, cur)
  }

  const periods = Array.from(byPeriod, ([period_key, v]) => ({
    period_key,
    ...v,
    outstanding: money(v.claimed - v.received),
  })).sort((a, b) => a.period_key.localeCompare(b.period_key))

  res.json({
    success: true,
    data: periods,
    meta: {
      rte_seats: seatsRes.count ?? 0,
      total_claimed: money(periods.reduce((s, p) => s + p.claimed, 0)),
      total_received: money(periods.reduce((s, p) => s + p.received, 0)),
      outstanding: money(periods.reduce((s, p) => s + p.outstanding, 0)),
    },
  })
}))

export default router
