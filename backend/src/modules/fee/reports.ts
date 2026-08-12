import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { toLocalDateStr, dateRangeStrings } from '../../shared/utils/academicCalendar'
import { amountDue, daysOverdue, money } from '../../shared/utils/feeMoney'
import { selectIn } from './lib/db'
import { FeeRequest, attachFeeScope, assertCanReadStudent, requireFeeView } from './lib/guards'

const router = Router()
const OPEN = ['unpaid', 'partial']

// ── Where the school stands ───────────────────────────────────────────
//
// Billed and collected come from the SAME set of invoices, so they cannot drift.
// The old version filtered billed by academic year while summing every payment
// ever taken, which made the headline "due" figure simply wrong whenever the
// filter was used.
router.get('/stats', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id } = req.query

  // One round trip returning one row, instead of streaming every invoice in the
  // school into Node to add up.
  //
  // The scan this replaces was capped by PostgREST at 1,000 rows with no error
  // and no indication: on this database, ₹99.3 lakh billed reported against a
  // truth of ₹1.83 crore. Every screen fed by these figures repeated it.
  const { data, error } = await supabase.rpc('fee_stats', {
    p_school_id: req.user!.school_id,
    p_academic_year_id: (academic_year_id as string) || null,
  })
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({ success: true, data })
}))

// ── Does any of this add up? ──────────────────────────────────────────
//
// The ledger has been write-only since it was built: every money path posted to
// fee_ledger_entries and nothing ever read it back, so "do the books balance"
// was a question with no way to ask it. Three invariants, each returning both
// sides and the difference — "off by ₹4,200" is something a bursar can act on,
// where "FAIL" is not.
//
// Intended to be watched, not just visited: an ok that goes false is the first
// sign of a posting bug, and it will show up here long before it shows up in a
// number anyone recognises as wrong.
router.get('/reconciliation', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const [recon, trial] = await Promise.all([
    supabase.rpc('fee_reconciliation', { p_school_id: req.user!.school_id }),
    supabase.from('fee_trial_balance').select('*').eq('school_id', req.user!.school_id).order('account_code'),
  ])
  if (recon.error) return res.status(500).json({ success: false, error: recon.error.message })
  if (trial.error) return res.status(500).json({ success: false, error: trial.error.message })

  const checks = recon.data as any
  const failing = ['balanced', 'receivable_vs_invoices', 'cash_vs_payments'].filter(k => !checks?.[k]?.ok)

  res.json({
    success: true,
    data: { ...checks, trial_balance: trial.data ?? [] },
    meta: {
      ok: failing.length === 0,
      failing,
      note: failing.length
        ? 'The ledger disagrees with the invoices or the payments. Every posting site writes here, so a difference means one of them is wrong.'
        : 'Debits equal credits, the receivable matches what is outstanding, and cash matches what was received.',
    },
  })
}))

// ── Fee position by class and section ─────────────────────────────────
// A school chasing money thinks in classes, not in a flat list of every invoice.
router.get('/classes', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id } = req.query

  // Was two unbounded scans — every active student AND every non-cancelled
  // invoice in the school — joined in JavaScript. Both were capped at 1,000
  // rows, so per-class billed/collected/outstanding were all understated, and
  // the larger the class the more of it went missing.
  const { data, error } = await supabase.rpc('fee_class_positions', {
    p_school_id: req.user!.school_id,
    p_academic_year_id: (academic_year_id as string) || null,
  })
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = (data ?? []).map((b: any) => ({
    ...b,
    student_count: Number(b.student_count),
    billed_student_count: Number(b.billed_student_count),
    billed: Number(b.billed), collected: Number(b.collected),
    outstanding: Number(b.outstanding), overdue: Number(b.overdue),
  }))

  // Natural ordering — "Class 10" after "Class 9", which a plain sort in
  // Postgres cannot do.
  rows.sort((a: any, b: any) =>
    (a.class_name ?? '').localeCompare(b.class_name ?? '', undefined, { numeric: true }) ||
    (a.section_name ?? '').localeCompare(b.section_name ?? ''))

  res.json({
    success: true, data: rows,
    meta: {
      totals: rows.reduce((acc: any, b: any) => ({
        students: acc.students + b.student_count,
        billed: money(acc.billed + b.billed),
        collected: money(acc.collected + b.collected),
        outstanding: money(acc.outstanding + b.outstanding),
        overdue: money(acc.overdue + b.overdue),
      }), { students: 0, billed: 0, collected: 0, outstanding: 0, overdue: 0 }),
    },
  })
}))

// Everyone in one class-section with their position.
router.get('/classes/students', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, section_id } = req.query
  const scope = req.feeScope!

  if (!class_id) return res.status(400).json({ success: false, error: 'class_id is required' })
  if (scope.kind === 'student') return res.status(403).json({ success: false, error: 'You can only view your own records' })
  if (scope.kind === 'section' && section_id !== scope.sectionId) {
    return res.status(403).json({ success: false, error: 'You can only view your own homeroom section' })
  }

  let sq = supabase.from('students')
    .select('id, first_name, last_name, admission_number, classes(name), sections(name)')
    .eq('school_id', school_id).eq('status', 'active').eq('class_id', class_id as string).order('first_name')
  if (section_id) sq = sq.eq('section_id', section_id as string)

  const { data: students, error } = await sq
  if (error) return res.status(500).json({ success: false, error: error.message })
  if (!students?.length) return res.json({ success: true, data: [], meta: { totals: null } })

  // selectIn pages within each chunk now, so a class whose students carry more
  // than 1,000 invoices between them is summed in full rather than truncated.
  const invoices = await selectIn<any>(
    'fee_invoices', 'student_id, total_amount, amount_paid, due_date, status', 'student_id',
    students.map(s => s.id), q => q.eq('school_id', school_id).neq('status', 'cancelled'))

  const today = new Date()
  const byStudent = new Map<string, any>()
  for (const inv of invoices) {
    const cur = byStudent.get(inv.student_id) ?? { billed: 0, collected: 0, outstanding: 0, overdue: 0, nextDue: null, count: 0 }
    cur.count += 1
    cur.billed = money(cur.billed + Number(inv.total_amount))
    cur.collected = money(cur.collected + Number(inv.amount_paid))
    if (OPEN.includes(inv.status)) {
      const due = amountDue(inv.total_amount, inv.amount_paid)
      cur.outstanding = money(cur.outstanding + due)
      if (inv.due_date) {
        if (daysOverdue(inv.due_date, today) > 0) cur.overdue = money(cur.overdue + due)
        // The soonest deadline still owing — the one date a front desk is asked for.
        if (!cur.nextDue || inv.due_date < cur.nextDue) cur.nextDue = inv.due_date
      }
    }
    byStudent.set(inv.student_id, cur)
  }

  const data = students.map(s => {
    const p = byStudent.get(s.id)
    return {
      student_id: s.id,
      name: `${s.first_name} ${s.last_name}`.trim(),
      admission_number: s.admission_number,
      class_name: (s.classes as any)?.name ?? null,
      section_name: (s.sections as any)?.name ?? null,
      billed: p?.billed ?? 0, collected: p?.collected ?? 0,
      outstanding: p?.outstanding ?? 0, overdue: p?.overdue ?? 0,
      next_due_date: p?.nextDue ?? null,
      status: !p || p.count === 0 ? 'not_billed'
        : p.outstanding <= 0 ? 'paid' : p.collected > 0 ? 'partial' : 'pending',
    }
  })

  res.json({
    success: true, data,
    meta: {
      count: data.length,
      totals: data.reduce((a, r) => ({
        billed: money(a.billed + r.billed), collected: money(a.collected + r.collected),
        outstanding: money(a.outstanding + r.outstanding), overdue: money(a.overdue + r.overdue),
      }), { billed: 0, collected: 0, outstanding: 0, overdue: 0 }),
    },
  })
}))

// ── One student's complete position ───────────────────────────────────
router.get('/students/:studentId', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { studentId } = req.params

  const denied = await assertCanReadStudent(req.feeScope!, studentId, school_id)
  if (denied) return res.status(403).json({ success: false, error: denied })

  const [studentRes, invRes, payRes, arrRes, adhocRes, schRes, assignRes] = await Promise.all([
    supabase.from('students')
      .select('id, first_name, last_name, admission_number, classes(name), sections(name), parents(father_name, father_phone, father_email, mother_name, mother_phone, guardian_name, guardian_phone)')
      .eq('id', studentId).eq('school_id', school_id).maybeSingle(),
    supabase.from('fee_invoices')
      // discount_total: an invoice raised BEFORE a concession existed carries
      // zero, which is how the Concessions screen can warn that a grant will not
      // reduce the paper already out.
      .select('id, invoice_number, invoice_date, due_date, total_amount, amount_paid, late_fee, discount_total, status, line_items, period_key')
      .eq('student_id', studentId).eq('school_id', school_id).order('invoice_date', { ascending: false }),
    supabase.from('fee_payments')
      .select('id, receipt_number, payment_date, amount, refunded_amount, unallocated_amount, method, status')
      .eq('student_id', studentId).eq('school_id', school_id).order('payment_date', { ascending: false }),
    supabase.from('fee_arrears')
      .select('id, amount, amount_paid, status, from_year:from_academic_year_id(name), to_year:to_academic_year_id(name)')
      .eq('student_id', studentId).eq('school_id', school_id),
    supabase.from('fee_adhoc_charges')
      .select('*, fee_invoices(invoice_number, status)').eq('student_id', studentId).eq('school_id', school_id),
    supabase.from('fee_scholarships').select('*').eq('student_id', studentId).eq('school_id', school_id),
    supabase.from('fee_assignments')
      // The plan's SCHEDULE comes back with it, which is what lets a family be
      // told "Q3 is due 15 Oct" before the invoice for it exists. Until plans
      // carried dates there was nothing to say.
      .select(`id, fee_category, fee_structures(id, name, code, frequency,
                 fee_structure_schedules(period_token, label, bills_on, due_date, sort_order))`)
      .eq('student_id', studentId).eq('school_id', school_id).eq('status', 'active').maybeSingle(),
  ])

  if (!studentRes.data) return res.status(404).json({ success: false, error: 'Student not found' })

  const invoices = (invRes.data ?? []).map(i => ({ ...i, amount_due: amountDue(i.total_amount, i.amount_paid) }))
  const live = invoices.filter(i => i.status !== 'cancelled')
  const open = live.filter(i => OPEN.includes(i.status))
  const arrears = (arrRes.data ?? []).map(a => ({
    ...a, amount_due: ['cleared', 'waived'].includes(a.status) ? 0 : amountDue(a.amount, a.amount_paid),
  }))

  const invoiceDue = money(open.reduce((s, i) => s + i.amount_due, 0))
  const arrearsDue = money(arrears.reduce((s, a) => s + a.amount_due, 0))
  // A charge that has been billed is already an invoice line; counting it again
  // would show the family twice what they owe for one field trip.
  const unbilledAdhoc = money((adhocRes.data ?? [])
    .filter(a => a.status === 'unbilled').reduce((s, a) => s + Number(a.amount), 0))
  const advance = money((payRes.data ?? [])
    .filter(p => p.status === 'captured').reduce((s, p) => s + Number(p.unallocated_amount ?? 0), 0))

  // Installments not yet invoiced. An invoice that already exists is shown as an
  // invoice — listing it twice would tell a family they owe it twice.
  const billedTokens = new Set(live.map(i => String(i.period_key ?? '').split(':')[1]).filter(Boolean))
  const plan = (assignRes.data as any)?.fee_structures
  const upcoming = ((plan?.fee_structure_schedules ?? []) as any[])
    .filter(s => !billedTokens.has(s.period_token))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .map(s => ({
      period_token: s.period_token,
      label: s.label ?? s.period_token,
      bills_on: s.bills_on,
      due_date: s.due_date,
    }))

  res.json({
    success: true,
    data: {
      student: studentRes.data,
      assignment: assignRes.data ?? null,
      upcoming,
      summary: {
        totalBilled: money(live.reduce((s, i) => s + Number(i.total_amount), 0)),
        totalPaid: money(live.reduce((s, i) => s + Number(i.amount_paid), 0)),
        invoiceDue, arrearsDue, adhocDue: unbilledAdhoc,
        advanceHeld: advance,
        totalDue: money(Math.max(0, invoiceDue + arrearsDue + unbilledAdhoc - advance)),
      },
      invoices, payments: payRes.data ?? [], arrears,
      adhoc_charges: adhocRes.data ?? [], scholarships: schRes.data ?? [],
    },
  })
}))

// ── Collection trend ──────────────────────────────────────────────────
// Bucketed by LOCAL calendar month: slicing the UTC timestamp misfiles any
// payment made in the first ~5.5 hours of a new month (IST) into the previous one.
router.get('/collection-trend', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { from, to } = req.query as { from?: string; to?: string }

  // Both branches are now GROUP BY in Postgres. They used to pull every payment
  // in the window into Node — capped at 1,000, so a busy term showed a fraction
  // of what was actually collected — and they netted refunds by hand while
  // counting bounced and cancelled payments as money. The RPCs value a payment
  // through fee_payment_effective, the same function the invoice trigger uses,
  // so the trend and the invoices cannot disagree.
  if (from && to) {
    if (from > to) return res.status(400).json({ success: false, error: '"from" must be on or before "to"' })
    const days = dateRangeStrings(from, to)
    if (days.length > 366) return res.status(400).json({ success: false, error: 'Range too large — max 366 days' })

    const { data, error } = await supabase.rpc('fee_collection_by_day', {
      p_school_id: school_id, p_from: from, p_to: to,
    })
    if (error) return res.status(500).json({ success: false, error: error.message })

    return res.json({
      success: true,
      data: (data ?? []).map((r: any) => ({
        month: r.day,
        label: new Date(`${r.day}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        collected: money(Number(r.collected)),
      })),
    })
  }

  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6))
  const { data, error } = await supabase.rpc('fee_collection_by_month', {
    p_school_id: school_id, p_months: months,
  })
  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({
    success: true,
    data: (data ?? []).map((r: any) => ({
      month: r.month,
      label: new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      collected: money(Number(r.collected)),
    })),
  })
}))

export default router
