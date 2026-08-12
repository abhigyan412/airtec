import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { toLocalDateStr, dayStartISO, dayEndISO } from '../../shared/utils/academicCalendar'
import { amountDue, money } from '../../shared/utils/feeMoney'
import { toCsv, csvFilename } from '../../shared/utils/csv'
import { selectAll, selectIn } from './lib/db'
import { lineBillsInPeriod } from './lib/resolve'
import { FeeRequest, requireFeeView } from './lib/guards'

// The two reports the module was missing, at opposite ends of time.
//
//   DAY BOOK  — what this counter took today, split by method and by cashier.
//               The report a school runs at 4pm to tally the drawer against the
//               cash box. Everything we had was school-level and cumulative:
//               useful to a principal, useless to the person closing the till.
//
//   FORECAST  — what is expected to come in, month by month. Only possible now
//               that plans carry a schedule; before this, nothing in the system
//               knew a payment was due until an invoice had already been raised.

const router = Router()
const OPEN = ['unpaid', 'partial']

// ── Day book ──────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', cheque: 'Cheque', dd: 'Demand draft', neft: 'NEFT',
  card: 'Card', upi: 'UPI', online: 'Online', wallet: 'Wallet',
}

router.get('/daybook', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const date = String(req.query.date ?? toLocalDateStr(new Date()))
  const format = String(req.query.format ?? 'json')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' })
  }

  // Local-day bounds, WITH AN EXPLICIT OFFSET.
  //
  // The comment here used to say this avoided the UTC-slice bug. It did not.
  // `${date}T00:00:00` is a naive string, and payment_date is a timestamptz, so
  // Postgres resolved it in the DATABASE's timezone — UTC on Supabase — however
  // this process was configured. The day book therefore ran 05:30 to 05:30,
  // dropping the morning counter's first five and a half hours and sweeping up
  // the next morning's takings instead. On a cash-reconciliation document that
  // is a till that does not match.
  const payments = await selectAll<any>(
    'fee_payments',
    `id, receipt_number, payment_date, amount, refunded_amount, unallocated_amount,
     method, status, reference, cheque_number, bank_name, collected_by,
     students(first_name, last_name, admission_number, classes(name), sections(name)),
     users:collected_by(full_name)`,
    q => q.eq('school_id', school_id)
          .gte('payment_date', dayStartISO(date))
          .lte('payment_date', dayEndISO(date)),
  )

  const rows = payments.map((p: any) => ({
    id: p.id,
    receipt_number: p.receipt_number,
    at: p.payment_date,
    student: `${p.students?.first_name ?? ''} ${p.students?.last_name ?? ''}`.trim(),
    admission_number: p.students?.admission_number ?? null,
    class_section: [p.students?.classes?.name, p.students?.sections?.name].filter(Boolean).join('-') || null,
    method: p.method,
    reference: p.reference ?? p.cheque_number ?? null,
    bank_name: p.bank_name ?? null,
    collected_by: p.users?.full_name ?? 'Online',
    status: p.status,
    amount: money(Number(p.amount)),
    refunded: money(Number(p.refunded_amount ?? 0)),
    advance: money(Number(p.unallocated_amount ?? 0)),
    // What the drawer actually holds for this row. A cancelled or bounced
    // receipt is listed — it happened, and a day book that hides it cannot be
    // reconciled against a bank statement — but it contributes nothing.
    net: ['cancelled', 'bounced'].includes(p.status)
      ? 0
      : money(Number(p.amount) - Number(p.refunded_amount ?? 0)),
  }))

  if (format === 'csv') {
    const csv = toCsv(rows, [
      { key: 'receipt_number', label: 'Receipt' },
      { key: 'at', label: 'Time', value: r => new Date(r.at).toLocaleTimeString('en-IN', { hour12: false }) },
      { key: 'student', label: 'Student' },
      { key: 'admission_number', label: 'Admission no' },
      { key: 'class_section', label: 'Class' },
      { key: 'method', label: 'Method', value: r => METHOD_LABELS[r.method] ?? r.method },
      { key: 'reference', label: 'Reference' },
      { key: 'bank_name', label: 'Bank' },
      { key: 'collected_by', label: 'Collected by' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'refunded', label: 'Refunded' },
      { key: 'net', label: 'Net' },
    ])
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('day-book', date)}"`)
    return res.send(csv)
  }

  const live = rows.filter(r => r.net > 0 || !['cancelled', 'bounced'].includes(r.status))

  const byMethod = new Map<string, { method: string; label: string; count: number; total: number }>()
  for (const r of live) {
    const cur = byMethod.get(r.method) ?? {
      method: r.method, label: METHOD_LABELS[r.method] ?? r.method, count: 0, total: 0,
    }
    cur.count += 1
    cur.total = money(cur.total + r.net)
    byMethod.set(r.method, cur)
  }

  const byCollector = new Map<string, { name: string; count: number; total: number }>()
  for (const r of live) {
    const cur = byCollector.get(r.collected_by) ?? { name: r.collected_by, count: 0, total: 0 }
    cur.count += 1
    cur.total = money(cur.total + r.net)
    byCollector.set(r.collected_by, cur)
  }

  const failed = rows.filter(r => ['cancelled', 'bounced'].includes(r.status))

  res.json({
    success: true,
    data: {
      date,
      rows,
      by_method: Array.from(byMethod.values()).sort((a, b) => b.total - a.total),
      by_collector: Array.from(byCollector.values()).sort((a, b) => b.total - a.total),
      totals: {
        receipts: live.length,
        collected: money(live.reduce((s, r) => s + r.net, 0)),
        // Cash is the line that has to match a physical count, so it is called
        // out rather than left for the reader to pick out of the method split.
        cash: money(live.filter(r => r.method === 'cash').reduce((s, r) => s + r.net, 0)),
        bank: money(live.filter(r => r.method !== 'cash').reduce((s, r) => s + r.net, 0)),
        refunded: money(rows.reduce((s, r) => s + r.refunded, 0)),
        advance: money(live.reduce((s, r) => s + r.advance, 0)),
        reversed: failed.length,
      },
    },
  })
}))

// ── Forecast ──────────────────────────────────────────────────────────
//
// Reads forward off the plans' schedules: for each upcoming installment, how many
// students are on that plan and what it charges them. Compared against what has
// actually been raised, so an installment whose bill-on date has passed but which
// was never billed shows up as a gap rather than as future income.

router.get('/forecast', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6))
  const { academic_year_id } = req.query

  let sq = supabase.from('fee_structures')
    .select(`id, name, frequency, academic_year_id,
             fee_structure_lines(id, amount, is_optional, period_tokens),
             fee_structure_schedules(period_token, label, bills_on, due_date)`)
    .eq('school_id', school_id).eq('status', 'active')
  // Plans from a previous year were being folded into this year's forecast.
  if (academic_year_id) sq = sq.eq('academic_year_id', academic_year_id as string)

  const { data: structures, error } = await sq

  if (error) return res.status(500).json({ success: false, error: error.message })
  const plans = structures ?? []
  if (!plans.length) return res.json({ success: true, data: [], meta: { collection_rate: 0 } })

  // Head count per plan, and which optional lines were actually taken — an
  // optional line bills nobody by default, so counting it in full would inflate
  // every forecast by the price of a bus seat times the whole school.
  const assignments = await selectIn<any>(
    'fee_assignments', 'id, structure_id', 'structure_id', plans.map(p => p.id),
    q => q.eq('school_id', school_id).eq('status', 'active'))

  const headcount = new Map<string, number>()
  for (const a of assignments) headcount.set(a.structure_id, (headcount.get(a.structure_id) ?? 0) + 1)

  const optIns = assignments.length
    ? await selectIn<any>('fee_assignment_optionals', 'structure_line_id', 'assignment_id',
        assignments.map(a => a.id))
    : []
  const optInCount = new Map<string, number>()
  for (const o of optIns) optInCount.set(o.structure_line_id, (optInCount.get(o.structure_line_id) ?? 0) + 1)

  // What has already been raised, per period key.
  // Paged, and scoped to the YEAR being forecast. It was neither: every invoice
  // ever raised in the school fed `collectionRate`, so a school in its third
  // year projected against three years of history, and the scan itself stopped
  // at 1,000 rows.
  const invoices = await selectAll<any>(
    'fee_invoices', 'period_key, total_amount, amount_paid',
    q => {
      let scoped = q.eq('school_id', school_id).neq('status', 'cancelled').not('period_key', 'is', null)
      if (academic_year_id) scoped = scoped.eq('academic_year_id', academic_year_id as string)
      return scoped
    },
  )

  const billedByKey = new Map<string, { billed: number; collected: number }>()
  for (const inv of invoices) {
    const cur = billedByKey.get(inv.period_key!) ?? { billed: 0, collected: 0 }
    cur.billed = money(cur.billed + Number(inv.total_amount))
    cur.collected = money(cur.collected + Number(inv.amount_paid))
    billedByKey.set(inv.period_key!, cur)
  }

  // Historical collection rate, used to temper the expectation. Billing ₹10L and
  // forecasting ₹10L of cash is not a forecast, it is a wish.
  const totalBilled = money(Array.from(billedByKey.values()).reduce((s, v) => s + v.billed, 0))
  const totalCollected = money(Array.from(billedByKey.values()).reduce((s, v) => s + v.collected, 0))
  const collectionRate = totalBilled > 0 ? totalCollected / totalBilled : 0

  const today = toLocalDateStr(new Date())
  // setMonth overflows: on 31 August, +6 months is "31 February", which JS
  // resolves to 3 March — two days short of the month boundary, so a schedule
  // row due 28 Feb to 2 Mar silently dropped out of the forecast. Anchoring to
  // the 1st and then taking the month end has no such edge.
  const now = new Date()
  const horizon = new Date(now.getFullYear(), now.getMonth() + months + 1, 0)
  const horizonStr = toLocalDateStr(horizon)

  const buckets = new Map<string, any>()

  for (const plan of plans) {
    const students = headcount.get(plan.id) ?? 0
    if (!students) continue

    const lines = (plan.fee_structure_lines ?? []) as any[]

    // Priced per SCHEDULE ROW, not once for the plan: a line may name the
    // periods it bills in, so an admission fee charged only in Q1 must inflate
    // Q1's expectation and no other. Computing it once per plan — as this did —
    // would forecast that fee four times and then report three quarters as
    // under-billed against a target that was never real.
    const expectedFor = (periodToken: string) => {
      const billing = lines.filter(l => lineBillsInPeriod(l.period_tokens, periodToken))
      const mandatory = money(billing.filter(l => !l.is_optional)
        .reduce((a, l) => a + Number(l.amount), 0))
      const optional = money(billing.filter(l => l.is_optional)
        .reduce((a, l) => a + Number(l.amount) * (optInCount.get(l.id) ?? 0), 0))
      return money(mandatory * students + optional)
    }

    for (const sched of (plan.fee_structure_schedules ?? []) as any[]) {
      if (!sched.due_date || sched.due_date > horizonStr) continue
      const perInstallment = expectedFor(sched.period_token)

      const key = String(sched.due_date).slice(0, 7)
      const periodKey = `${plan.frequency}:${sched.period_token}`
      const actual = billedByKey.get(periodKey)

      const b = buckets.get(key) ?? {
        month: key,
        label: new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        expected: 0, billed: 0, collected: 0, installments: [] as any[], overdue_to_bill: 0,
      }

      b.expected = money(b.expected + perInstallment)
      b.installments.push({
        structure_id: plan.id,
        structure_name: plan.name,
        period: sched.label ?? sched.period_token,
        due_date: sched.due_date,
        students,
        expected: perInstallment,
        billed: !!actual,
      })
      // A bill-on date in the past with nothing raised is not future income, it
      // is a task somebody has missed.
      if (!actual && sched.bills_on && sched.bills_on <= today) {
        b.overdue_to_bill = money(b.overdue_to_bill + perInstallment)
      }
      buckets.set(key, b)
    }
  }

  // Fold in what those periods have actually done, without double counting a
  // plan that shares a period key with another.
  for (const b of buckets.values()) {
    const seen = new Set<string>()
    for (const inst of b.installments) {
      const plan = plans.find(p => p.id === inst.structure_id)!
      const periodKey = `${plan.frequency}:${inst.period}`
      if (seen.has(periodKey)) continue
      seen.add(periodKey)
    }
    b.projected = money(b.expected * collectionRate)
  }

  const data = Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month))

  res.json({
    success: true,
    data,
    meta: {
      collection_rate: Math.round(collectionRate * 100),
      months,
      total_expected: money(data.reduce((s, b) => s + b.expected, 0)),
      total_projected: money(data.reduce((s, b) => s + b.projected, 0)),
      overdue_to_bill: money(data.reduce((s, b) => s + b.overdue_to_bill, 0)),
      note: 'Expected is what the plans schedule. Projected applies the school\'s historical collection rate. Neither nets off concessions granted after billing.',
    },
  })
}))

// ── By fee category ───────────────────────────────────────────────────
//
// fee_assignments.fee_category — general, RTE, staff ward, sibling, scholarship —
// was inert. It was written by the assign form, selected by the billing resolver,
// never read, and surfaced as one word of grey text on a student's profile.
// Nothing branched on it and nothing reported by it.
//
// That is worse than an unused column: an admin assigning forty RTE students
// picks "RTE" and reasonably assumes the system will treat them differently. It
// does not — they are billed the full plan, and the actual concession has to be
// granted separately, per student.
//
// This does not change what anyone is billed. It makes the field answer the
// question a trust board actually asks of it: what are we carrying on each kind
// of seat. Auto-concessions by category are the obvious next step, but they need
// the school's real RTE and staff-ward terms — guessing those would be worse
// than the honest reporting here.

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  rte: 'RTE',
  staff_ward: 'Staff ward',
  sibling: 'Sibling',
  scholarship: 'Scholarship',
}

router.get('/by-category', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { academic_year_id } = req.query

  // Paged. A short read here does not shrink a category — it deletes students
  // from every bucket at once, so the totals look plausible and are simply
  // missing whoever fell past row 1,000.
  const assignments = await selectAll<any>('fee_assignments', 'student_id, fee_category', q => {
    let scoped = q.eq('school_id', school_id).eq('status', 'active')
    if (academic_year_id) scoped = scoped.eq('academic_year_id', academic_year_id as string)
    return scoped
  })
  if (!assignments.length) return res.json({ success: true, data: [], meta: { totals: null } })

  const categoryOf = new Map<string, string>()
  for (const a of assignments) categoryOf.set(a.student_id, a.fee_category ?? 'general')

  const studentIds = Array.from(categoryOf.keys())

  const [invoices, discounts] = await Promise.all([
    selectIn<any>('fee_invoices', 'student_id, status, total_amount, amount_paid, discount_total',
      'student_id', studentIds,
      q => {
        let x = q.eq('school_id', school_id).neq('status', 'cancelled')
        if (academic_year_id) x = x.eq('academic_year_id', academic_year_id as string)
        return x
      }),
    // What has been given away, as opposed to what was never charged. Approved
    // only — a pending concession has not reduced anybody's bill.
    selectIn<any>('fee_discounts', 'student_id, discount_type, discount_value', 'student_id', studentIds,
      q => q.eq('school_id', school_id).eq('is_active', true).eq('approval_status', 'approved')),
  ])

  const blank = () => ({
    students: 0, billed: 0, collected: 0, outstanding: 0,
    concession_on_invoices: 0, students_with_concession: 0,
    concession_unapplied_students: 0, concession_unapplied_invoices: 0,
    concession_unapplied_outstanding: 0,
  })
  const buckets = new Map<string, ReturnType<typeof blank>>()
  const bucket = (c: string) => {
    if (!buckets.has(c)) buckets.set(c, blank())
    return buckets.get(c)!
  }

  for (const c of categoryOf.values()) bucket(c).students += 1

  for (const inv of invoices) {
    const b = bucket(categoryOf.get(inv.student_id) ?? 'general')
    b.billed = money(b.billed + Number(inv.total_amount))
    b.collected = money(b.collected + Number(inv.amount_paid))
    // The concession baked into issued invoices — the real "what we forwent".
    b.concession_on_invoices = money(b.concession_on_invoices + Number(inv.discount_total ?? 0))
    if (OPEN.includes(inv.status)) {
      b.outstanding = money(b.outstanding + amountDue(inv.total_amount, inv.amount_paid))
    }
  }

  const withConcession = new Set(discounts.map(d => d.student_id))
  for (const sid of withConcession) {
    const c = categoryOf.get(sid)
    if (c) bucket(c).students_with_concession += 1
  }

  // Concessions that have come off nothing.
  //
  // A concession bites when an invoice is RAISED — buildLineItems applies it as
  // the line is built — and never reaches back into paper already issued. So one
  // approved in June, after Q1 was billed on 1 April, reduces nothing the family
  // is currently holding. That shows up in the columns above as an approved
  // concession sitting beside ₹0 forgone, which reads as a rounding quirk rather
  // than the thing it is: a family still being invoiced and chased for money
  // somebody has already decided they do not owe.
  //
  // Counted per student AND per invoice: one student with four untouched
  // quarters is a different-sized correction from four students with one each.
  const unappliedFor = new Map<string, { invoices: number; outstanding: number }>()
  for (const inv of invoices) {
    if (!OPEN.includes(inv.status)) continue
    if (Number(inv.discount_total ?? 0) > 0) continue
    if (!withConcession.has(inv.student_id)) continue
    const seen = unappliedFor.get(inv.student_id) ?? { invoices: 0, outstanding: 0 }
    seen.invoices += 1
    seen.outstanding = money(seen.outstanding + amountDue(inv.total_amount, inv.amount_paid))
    unappliedFor.set(inv.student_id, seen)
  }
  for (const [sid, seen] of unappliedFor) {
    const c = categoryOf.get(sid)
    if (!c) continue
    const b = bucket(c)
    b.concession_unapplied_students += 1
    b.concession_unapplied_invoices += seen.invoices
    b.concession_unapplied_outstanding = money(b.concession_unapplied_outstanding + seen.outstanding)
  }

  const data = Array.from(buckets.entries())
    .map(([category, b]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      ...b,
      collection_rate: b.billed > 0 ? Math.round((b.collected / b.billed) * 100) : 0,
      avg_billed_per_student: b.students > 0 ? money(b.billed / b.students) : 0,
    }))
    // Biggest first, but General is nearly always the bulk and is not the
    // interesting row — the point of this report is the small categories.
    .sort((a, b) => b.billed - a.billed)

  // Screen-only was a real limit: this is the table that goes into a board pack
  // and an RTE claim, and retyping it by hand is where the figures stop matching
  // the system they came from.
  if ((req.query.format as string) === 'csv') {
    const csv = toCsv(data, [
      { key: 'label', label: 'Category' },
      { key: 'students', label: 'Students' },
      { key: 'billed', label: 'Billed' },
      { key: 'collected', label: 'Collected' },
      { key: 'outstanding', label: 'Outstanding' },
      { key: 'collection_rate', label: 'Collected %' },
      { key: 'avg_billed_per_student', label: 'Avg billed per student' },
      { key: 'concession_on_invoices', label: 'Concession given' },
      { key: 'students_with_concession', label: 'Students with a concession' },
      { key: 'concession_unapplied_students', label: 'Concessions not applied' },
      { key: 'concession_unapplied_outstanding', label: 'Still billed in full' },
    ])
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('fee-by-category', toLocalDateStr(new Date()))}"`)
    return res.send(csv)
  }

  res.json({
    success: true,
    data,
    meta: {
      totals: data.reduce((acc, r) => ({
        students: acc.students + r.students,
        billed: money(acc.billed + r.billed),
        collected: money(acc.collected + r.collected),
        outstanding: money(acc.outstanding + r.outstanding),
        concession_on_invoices: money(acc.concession_on_invoices + r.concession_on_invoices),
        concession_unapplied_students: acc.concession_unapplied_students + r.concession_unapplied_students,
        concession_unapplied_invoices: acc.concession_unapplied_invoices + r.concession_unapplied_invoices,
        concession_unapplied_outstanding:
          money(acc.concession_unapplied_outstanding + r.concession_unapplied_outstanding),
      }), {
        students: 0, billed: 0, collected: 0, outstanding: 0, concession_on_invoices: 0,
        concession_unapplied_students: 0, concession_unapplied_invoices: 0,
        concession_unapplied_outstanding: 0,
      }),
      note: 'Category is recorded on the assignment. It does not change what a student is billed — concessions are granted separately and shown here as what has already been given.',
    },
  })
}))

export default router
