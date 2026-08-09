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
  const school_id = req.user!.school_id

  let invQ = supabase.from('fee_invoices')
    .select('status, total_amount, amount_paid').eq('school_id', school_id).neq('status', 'cancelled')
  if (academic_year_id) invQ = invQ.eq('academic_year_id', academic_year_id as string)

  const [invRes, arrRes, advRes] = await Promise.all([
    invQ,
    supabase.from('fee_arrears').select('amount, amount_paid')
      .eq('school_id', school_id).in('status', ['pending', 'partial']),
    supabase.from('fee_payments').select('unallocated_amount')
      .eq('school_id', school_id).eq('status', 'captured').gt('unallocated_amount', 0),
  ])
  if (invRes.error) return res.status(500).json({ success: false, error: invRes.error.message })

  const invoices = invRes.data ?? []
  const open = invoices.filter(i => OPEN.includes(i.status))

  const billed = money(invoices.reduce((s, i) => s + Number(i.total_amount), 0))
  const collected = money(invoices.reduce((s, i) => s + Number(i.amount_paid), 0))
  // Only OPEN invoices are still owed. A carried_forward invoice's balance now
  // lives in fee_arrears and is counted there — counting both is the exact
  // double-count this model removes.
  const invoiceDue = money(open.reduce((s, i) => s + amountDue(i.total_amount, i.amount_paid), 0))
  const arrearsDue = money((arrRes.data ?? []).reduce((s, a) => s + amountDue(a.amount, a.amount_paid), 0))
  const advance = money((advRes.data ?? []).reduce((s, p) => s + Number(p.unallocated_amount), 0))

  res.json({
    success: true,
    data: {
      total_billed: billed,
      total_collected: collected,
      total_due: invoiceDue,
      arrears_due: arrearsDue,
      total_outstanding: money(invoiceDue + arrearsDue),
      advance_held: advance,
      paid_invoices: invoices.filter(i => i.status === 'paid').length,
      partial_invoices: invoices.filter(i => i.status === 'partial').length,
      unpaid_invoices: invoices.filter(i => i.status === 'unpaid').length,
      collection_rate: billed > 0 ? Math.round((collected / billed) * 100) : 0,
    },
  })
}))

// ── Fee position by class and section ─────────────────────────────────
// A school chasing money thinks in classes, not in a flat list of every invoice.
router.get('/classes', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { academic_year_id } = req.query

  const { data: students, error: sErr } = await supabase.from('students')
    .select('id, class_id, section_id, classes(name), sections(name)')
    .eq('school_id', school_id).eq('status', 'active')
  if (sErr) return res.status(500).json({ success: false, error: sErr.message })

  let invQ = supabase.from('fee_invoices')
    .select('student_id, total_amount, amount_paid, due_date, status')
    .eq('school_id', school_id).neq('status', 'cancelled')
  if (academic_year_id) invQ = invQ.eq('academic_year_id', academic_year_id as string)
  const { data: invoices, error: iErr } = await invQ
  if (iErr) return res.status(500).json({ success: false, error: iErr.message })

  const key = (c: string, s: string | null) => `${c}__${s ?? 'none'}`
  const group = new Map<string, string>()
  const buckets = new Map<string, any>()

  for (const s of students ?? []) {
    if (!s.class_id) continue
    const k = key(s.class_id, s.section_id)
    group.set(s.id, k)
    if (!buckets.has(k)) {
      buckets.set(k, {
        class_id: s.class_id, class_name: (s.classes as any)?.name ?? null,
        section_id: s.section_id ?? null, section_name: (s.sections as any)?.name ?? null,
        student_count: 0, billed_student_count: 0, billed: 0, collected: 0, outstanding: 0, overdue: 0,
      })
    }
    buckets.get(k).student_count += 1
  }

  const today = new Date()
  const billedStudents = new Map<string, Set<string>>()

  for (const inv of invoices ?? []) {
    const k = group.get(inv.student_id)
    // An invoice for a student who has left is counted nowhere rather than
    // silently folded into another class's totals.
    if (!k) continue
    const b = buckets.get(k)
    b.billed = money(b.billed + Number(inv.total_amount))
    b.collected = money(b.collected + Number(inv.amount_paid))
    if (!billedStudents.has(k)) billedStudents.set(k, new Set())
    billedStudents.get(k)!.add(inv.student_id)

    if (OPEN.includes(inv.status)) {
      const due = amountDue(inv.total_amount, inv.amount_paid)
      b.outstanding = money(b.outstanding + due)
      if (inv.due_date && daysOverdue(inv.due_date, today) > 0) b.overdue = money(b.overdue + due)
    }
  }
  for (const [k, set] of billedStudents) buckets.get(k).billed_student_count = set.size

  const data = Array.from(buckets.values()).sort((a, b) =>
    (a.class_name ?? '').localeCompare(b.class_name ?? '', undefined, { numeric: true }) ||
    (a.section_name ?? '').localeCompare(b.section_name ?? ''))

  res.json({
    success: true, data,
    meta: {
      totals: data.reduce((acc, b) => ({
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

  if (from && to) {
    if (from > to) return res.status(400).json({ success: false, error: '"from" must be on or before "to"' })
    const days = dateRangeStrings(from, to)
    if (days.length > 366) return res.status(400).json({ success: false, error: 'Range too large — max 366 days' })

    const { data, error } = await supabase.from('fee_payments')
      .select('amount, refunded_amount, payment_date').eq('school_id', school_id).eq('status', 'captured')
      .gte('payment_date', `${from}T00:00:00`).lte('payment_date', `${to}T23:59:59`)
    if (error) return res.status(500).json({ success: false, error: error.message })

    const sum = new Map<string, number>()
    for (const p of data ?? []) {
      const k = toLocalDateStr(new Date(p.payment_date))
      sum.set(k, (sum.get(k) ?? 0) + Number(p.amount) - Number(p.refunded_amount ?? 0))
    }
    return res.json({
      success: true,
      data: days.map(d => ({
        month: d,
        label: new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        collected: money(sum.get(d) ?? 0),
      })),
    })
  }

  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6))
  const now = new Date()
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    }
  })

  const { data, error } = await supabase.from('fee_payments')
    .select('amount, refunded_amount, payment_date').eq('school_id', school_id).eq('status', 'captured')
    .gte('payment_date', `${buckets[0].key}-01T00:00:00`)
  if (error) return res.status(500).json({ success: false, error: error.message })

  const sum = new Map<string, number>()
  for (const p of data ?? []) {
    const k = toLocalDateStr(new Date(p.payment_date)).slice(0, 7)
    sum.set(k, (sum.get(k) ?? 0) + Number(p.amount) - Number(p.refunded_amount ?? 0))
  }

  res.json({
    success: true,
    data: buckets.map(b => ({ month: b.key, label: b.label, collected: money(sum.get(b.key) ?? 0) })),
  })
}))

export default router
