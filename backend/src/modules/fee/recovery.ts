import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { agingBucket, amountDue, daysOverdue, money } from '../../shared/utils/feeMoney'
import { chunk, selectAll } from './lib/db'
import { postLateFee } from './lib/ledger'
import {
  FeeRequest, attachFeeScope, requireFeeView, requireFeeCollect, requireFeeArrearManage,
  scopeInvoiceQuery, studentsEmbed,
} from './lib/guards'

// Chasing what is late.
//
// Every read here is an ordinary indexed query because fee_invoices.amount_paid
// is maintained by trigger. Under the old model each of these re-summed payments
// per invoice before it could return a row, which is why none could paginate.

const router = Router()
const STUDENT_COLUMNS = 'id, first_name, last_name, admission_number, class_id, section_id, classes(name), sections(name)'
const OPEN = ['unpaid', 'partial']

router.get('/dues', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { class_id, academic_year_id, due_on_or_before, page = '1', limit = '50' } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const scope = req.feeScope!

  // Filtering an embedded column only narrows the parent rows on an INNER join;
  // with the default left join PostgREST keeps the invoice and nulls the student.
  const filteringOnStudent = !!class_id && scope.kind !== 'student'

  let q = supabase.from('fee_invoices')
    .select(`id, invoice_number, total_amount, amount_paid, due_date, status, created_at,
             ${filteringOnStudent ? `students!inner(${STUDENT_COLUMNS})` : studentsEmbed(scope, STUDENT_COLUMNS)}`,
            { count: 'exact' })
    .eq('school_id', req.user!.school_id).in('status', OPEN)
    .range(from, to).order('due_date', { ascending: true, nullsFirst: false })

  q = scopeInvoiceQuery(q, scope)
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)
  if (filteringOnStudent) q = q.eq('students.class_id', class_id as string)
  // "Already due" as a server-side filter, so a caller that only wants the
  // count can ask for it with limit=1 instead of paging the whole list and
  // measuring the array — which is what the dashboard tile used to do, and why
  // it read 50 for a school with 1,111 open invoices. Nulls drop out, which is
  // right: an invoice with no due date is not yet due.
  if (due_on_or_before) q = q.lte('due_date', due_on_or_before as string)

  const { data, error, count } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = (data ?? []).map((i: any) => ({ ...i, amount_due: amountDue(i.total_amount, i.amount_paid) }))
  res.json({
    success: true, data: rows,
    meta: { total: count ?? 0, page: pg, limit: lim, page_outstanding: money(rows.reduce((s, r) => s + r.amount_due, 0)) },
  })
}))

// Staff-only: this is the school's whole receivables position.
router.get('/aging-report', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id } = req.query

  // Paged. This is the one number a bursar takes to a board meeting, and it was
  // capped at 1,000 invoices — so past about 250 students the school's stated
  // receivables position was short by however much fell off the end.
  const data = await selectAll<any>(
    'fee_invoices',
    `id, invoice_number, total_amount, amount_paid, due_date, status, students(${STUDENT_COLUMNS})`,
    q => {
      let scoped = q.eq('school_id', req.user!.school_id).in('status', OPEN)
      if (academic_year_id) scoped = scoped.eq('academic_year_id', academic_year_id as string)
      return scoped
    },
  )

  const today = new Date()
  const buckets: Record<string, any[]> = { current: [], '1_30': [], '31_60': [], '61_90': [], '90_plus': [] }

  for (const inv of data ?? []) {
    const due = amountDue(inv.total_amount, inv.amount_paid)
    if (due <= 0) continue
    const days = inv.due_date ? daysOverdue(inv.due_date, today) : -1
    buckets[agingBucket(days)].push({ ...inv, amount_due: due, days_overdue: days })
  }

  res.json({
    success: true,
    data: {
      buckets,
      summary: Object.fromEntries(Object.entries(buckets).map(([k, rows]) => [k, {
        count: rows.length, total: money(rows.reduce((s, r) => s + r.amount_due, 0)),
      }])),
    },
  })
}))

// Staff-only, emphatically: returns parents' names and phone numbers alongside
// what each family owes.
// Defaulters is the one list here that cannot paginate in the database: a
// defaulter is a STUDENT, assembled by summing their open invoices, and no
// `.range()` over invoices maps onto a page of students — a student whose four
// quarters straddle the page boundary would appear twice, each time owing half
// of what they actually owe.
//
// So the scan stays whole and the PAGE is cut after grouping. Two things follow,
// both deliberate:
//
//   * The header figures (how many families, how much) are computed across every
//     defaulter, not the twenty on screen. A page-local total is a number no one
//     can act on.
//   * The scan itself is read in slices, because PostgREST caps a single response
//     and a school with four billed quarters is already past a 1,000-row default.
//     Silently dropping the tail would quietly shorten the chase list, which is
//     the one failure mode this screen must not have.
//
// The hand-rolled slice loop this used to be was the only correct paging in the
// module, and it is now the shared selectAll() helper — with its two flaws
// fixed. It terminated on `batch.length < PAGE`, which silently required the
// page size to equal the server's cap exactly, and it had no upper bound.
async function allOpenDatedInvoices(schoolId: string) {
  return selectAll<any>(
    'fee_invoices',
    `id, invoice_number, total_amount, amount_paid, due_date, student_id,
     students(id, first_name, last_name, admission_number, classes(name), sections(name),
              parents(father_name, father_phone, mother_name, mother_phone))`,
    q => q.eq('school_id', schoolId).in('status', OPEN).not('due_date', 'is', null),
  )
}

// Categories excluded from the chase list unless asked for.
//
// An RTE seat is admitted free and reimbursed by the state at the state's rate,
// on the state's timetable. Whatever is outstanding on it is owed by a
// government, not by the family — so it does not belong on a list whose entire
// purpose is deciding who to telephone. Leaving it in was not a cosmetic bug:
// this screen shows parents' phone numbers next to a "Request waiver" button.
const NOT_THE_FAMILYS_DEBT = ['rte']

/**
 * fee_category per student for the current year, for the categories we filter on.
 *
 * Paged, and the reason is not performance. A short read here defaults every
 * student past row 1,000 to 'general', which puts RTE families back on the chase
 * list — a screen that shows parents' phone numbers next to a "Request waiver"
 * button, for a debt owed by a state government rather than by them.
 */
async function categoryOfStudents(schoolId: string): Promise<Map<string, string>> {
  const rows = await selectAll<any>(
    'fee_assignments', 'student_id, fee_category',
    q => q.eq('school_id', schoolId).eq('status', 'active'),
  )
  return new Map(rows.map((a: any) => [a.student_id, a.fee_category ?? 'general']))
}

router.get('/defaulters', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const minDays = Number(req.query.min_days_overdue) || 30
  const { page = '1', limit = '25', category, include_all_categories } =
    req.query as Record<string, string | undefined>
  const { limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  const [data, categoryOf] = await Promise.all([
    allOpenDatedInvoices(school_id),
    categoryOfStudents(school_id),
  ])

  // Three modes, in order of precedence: one named category (to look AT the RTE
  // seats deliberately), everything (an audit), or the default — everyone whose
  // debt is actually theirs.
  const wanted = (studentId: string) => {
    const c = categoryOf.get(studentId) ?? 'general'
    if (category) return c === category
    if (include_all_categories === 'true') return true
    return !NOT_THE_FAMILYS_DEBT.includes(c)
  }

  const today = new Date()
  const byStudent: Record<string, any> = {}
  const excluded = { students: new Set<string>(), outstanding: 0 }

  for (const inv of data ?? []) {
    const due = amountDue(inv.total_amount, inv.amount_paid)
    if (due <= 0) continue
    const days = daysOverdue(inv.due_date!, today)
    if (days < minDays) continue

    const sid = inv.student_id
    if (!wanted(sid)) {
      // Tallied rather than dropped in silence. A chase list that quietly got
      // shorter is indistinguishable from one that is broken, and the money is
      // still owed to the school — by the state — so somebody has to see it.
      excluded.students.add(sid)
      excluded.outstanding = money(excluded.outstanding + due)
      continue
    }

    if (!byStudent[sid]) {
      const s = inv.students as any
      byStudent[sid] = {
        student: s, parent_contact: s?.parents?.[0] ?? null,
        fee_category: categoryOf.get(sid) ?? 'general',
        total_outstanding: 0, max_days_overdue: 0, invoice_count: 0, invoices: [],
      }
    }
    byStudent[sid].total_outstanding = money(byStudent[sid].total_outstanding + due)
    byStudent[sid].max_days_overdue = Math.max(byStudent[sid].max_days_overdue, days)
    byStudent[sid].invoice_count += 1
    byStudent[sid].invoices.push({ id: inv.id, invoice_number: inv.invoice_number, amount_due: due, days_overdue: days })
  }

  // Longest overdue first, then by size — two families at 90 days are not equally
  // urgent, and without the tiebreak the order shuffles between requests, which
  // makes a paged list unusable: the same family can appear on page 1 and page 3.
  const result = Object.values(byStudent).sort((a: any, b: any) =>
    b.max_days_overdue - a.max_days_overdue
    || b.total_outstanding - a.total_outstanding
    || String(a.student?.id).localeCompare(String(b.student?.id)))

  const start = (pg - 1) * lim
  res.json({
    success: true,
    data: result.slice(start, start + lim),
    meta: {
      min_days_overdue: minDays,
      page: pg, limit: lim,
      // Across every defaulter, not the page — these are the figures the screen
      // puts in its header, and a page-local sum would understate the position.
      total: result.length,
      total_defaulters: result.length,
      total_outstanding: money(result.reduce((s: number, r: any) => s + r.total_outstanding, 0)),
      // What this list is deliberately not showing, and why.
      filter: category ? { category } : include_all_categories === 'true' ? { all: true } : { excluding: NOT_THE_FAMILYS_DEBT },
      excluded_students: excluded.students.size,
      excluded_outstanding: excluded.outstanding,
    },
  })
}))

// ── Late fees ─────────────────────────────────────────────────────────
//
// Rules live on the structure now, so a school can charge a flat fee, per day, or
// a percentage per month with a grace period — none of which the old flat
// per-day rate could express.
router.post('/apply-late-fees', requireFeeArrearManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const preview = req.query.preview === 'true' || req.body?.preview === true
  const today = new Date()

  // Paged, and ORDERED. Before this it fined an ARBITRARY 1,000 invoices — no
  // ORDER BY, so a second run fined a different 1,000, and no run ever reached
  // the rest.
  const invoices = await selectAll<any>(
    'fee_invoices',
    `id, invoice_number, student_id, due_date, late_fee, late_fee_waived, total_amount, amount_paid,
     fee_assignments(fee_structures(late_fee_mode, late_fee_value, late_fee_grace_days))`,
    q => q.eq('school_id', school_id).in('status', OPEN).not('due_date', 'is', null),
  )

  const pending: {
    id: string; invoice_number: string; student_id: string
    late_fee: number; previous: number; total_amount: number; days_overdue: number
  }[] = []

  for (const inv of invoices) {
    const rule = (inv.fee_assignments as any)?.fee_structures
    if (!rule || rule.late_fee_mode === 'none' || Number(rule.late_fee_value) <= 0) continue

    const overdue = daysOverdue(inv.due_date!, today) - Number(rule.late_fee_grace_days ?? 0)
    if (overdue <= 0) continue

    // The fee portion is the invoice minus whatever fine is already on it, so a
    // recalculation never compounds on itself.
    const feePortion = money(Number(inv.total_amount) - Number(inv.late_fee ?? 0))

    // What is actually LATE. A percentage-per-month fine is a charge on the
    // overdue balance, not on the original bill: ₹500 still owing on a ₹10,000
    // invoice at 2%/month for 60 days is ₹20, and charging it on the gross was
    // ₹400 — a 20× overcharge that got worse as the family paid the balance
    // down. amount_paid was selected here and never used.
    const unpaidFee = money(Math.max(0, feePortion - Number(inv.amount_paid ?? 0)))
    if (unpaidFee <= 0) continue

    const value = Number(rule.late_fee_value)
    const gross =
      rule.late_fee_mode === 'fixed' ? money(value)
      : rule.late_fee_mode === 'per_day' ? money(value * overdue)
      : money(unpaidFee * (value / 100) * (overdue / 30))

    // A fine the school formally forgave stays forgiven. Nothing used to record
    // the forgiveness, so the next sweep recomputed the same figure from the
    // same overdue date and put it straight back — and the family was chased for
    // money that had been waived, with the ledger disagreeing with the invoice.
    const fine = money(Math.max(0, gross - Number(inv.late_fee_waived ?? 0)))

    const previous = money(Number(inv.late_fee ?? 0))
    if (Math.abs(fine - previous) < 0.01) continue

    pending.push({
      id: inv.id, invoice_number: inv.invoice_number, student_id: inv.student_id,
      late_fee: fine, previous, total_amount: money(feePortion + fine), days_overdue: overdue,
    })
  }

  const delta = money(pending.reduce((s, p) => s + (p.late_fee - p.previous), 0))

  // A write-nothing preview, matching what billing and assignment already offer.
  // This is a school-wide money mutation and it used to be one unconfirmed click.
  if (preview) {
    return res.json({
      success: true,
      data: {
        preview: true, checked: invoices.length, would_update: pending.length,
        net_change: delta,
        sample: pending.slice(0, 20).map(p => ({
          invoice_number: p.invoice_number, days_overdue: p.days_overdue,
          from: p.previous, to: p.late_fee,
        })),
      },
    })
  }

  let updated = 0
  const failures: string[] = []
  for (const batch of chunk(pending, 16)) {
    await Promise.all(batch.map(async row => {
      const { error: e } = await supabase.from('fee_invoices')
        .update({ late_fee: row.late_fee, total_amount: row.total_amount })
        .eq('id', row.id).eq('school_id', school_id)
      if (e) { failures.push(`${row.invoice_number}: ${e.message}`); return }
      updated++

      // Late-fee income is recognised when the fine is LEVIED, once. It used to
      // be credited again on every payment that touched the invoice, because
      // invoice.late_fee is the total fine rather than the unrecovered
      // remainder — two payments against one ₹500 fine posted ₹1,000 of income,
      // and debits still equalled credits so nothing looked wrong.
      await postLateFee({
        schoolId: school_id, invoiceId: row.id, studentId: row.student_id,
        amount: money(row.late_fee - row.previous),
      })
    }))
  }

  res.json({
    success: true,
    data: {
      updated, checked: invoices.length, net_change: delta,
      // Reported rather than swallowed. The old loop counted failures out
      // silently with `if (!e) updated++`.
      failed: failures.length,
      ...(failures.length ? { errors: failures.slice(0, 10) } : {}),
    },
  })
}))

// ── Arrears ───────────────────────────────────────────────────────────
//
// Real carry-forward: the remaining balance moves into the next year AND the
// source invoice is retired. Without that last step the same rupees appear in
// dues, aging, defaulters and arrears at once — every outstanding figure in the
// product inflates the moment a school rolls over a year.
router.post('/arrears/carry-forward', requireFeeArrearManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { from_academic_year_id, to_academic_year_id } = req.body ?? {}
  const school_id = req.user!.school_id

  if (!from_academic_year_id || !to_academic_year_id) {
    return res.status(400).json({ success: false, error: 'Both academic years are required' })
  }
  if (from_academic_year_id === to_academic_year_id) {
    return res.status(400).json({ success: false, error: 'The two years must be different' })
  }

  // One transaction, in Postgres.
  //
  // The shape this replaces could double-count permanently and no retry could
  // repair it. The arrears upsert succeeded, one chunk of invoice-retirement
  // updates failed with NO ERROR CHECK, and the same rupees then existed twice —
  // as arrears AND as unpaid invoices, in /dues, /aging-report and /defaulters
  // at once, which is precisely the double-count this model exists to prevent.
  //
  // It could not self-heal either: the upsert used ignoreDuplicates, so a re-run
  // returned only NEW rows, and the set of invoices to close was derived from
  // that result — the stranded ones were never closed by any retry. The function
  // closes invoices from the ARREARS table instead, so re-running it repairs
  // whatever a half-finished run left behind.
  const { data, error } = await supabase.rpc('fee_carry_forward_arrears', {
    p_school_id: school_id,
    p_from_year: from_academic_year_id,
    p_to_year: to_academic_year_id,
    p_user_id: req.user!.id,
  })
  if (error) return res.status(400).json({ success: false, error: error.message })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'ARREARS_CARRIED_FORWARD',
    entity_type: 'fee_arrear', entity_id: to_academic_year_id,
    new_values: { from_academic_year_id, to_academic_year_id, ...(data as any) },
  })

  res.json({
    success: true,
    data: (data as any)?.carried_forward === 0
      ? { ...(data as any), message: 'Nothing outstanding left to carry in that year' }
      : data,
  })
}))

router.get('/arrears', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { status, page = '1', limit = '50' } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const scope = req.feeScope!

  let q = supabase.from('fee_arrears')
    .select(`*, ${studentsEmbed(scope, 'id, first_name, last_name, admission_number, section_id, classes(name)')},
             from_year:from_academic_year_id(name), to_year:to_academic_year_id(name)`, { count: 'exact' })
    .eq('school_id', req.user!.school_id).range(from, to).order('carried_forward_at', { ascending: false })

  q = scopeInvoiceQuery(q, scope)
  if (status) q = q.eq('status', status as string)

  const { data, error, count } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })

  const rows = (data ?? []).map((a: any) => ({
    ...a,
    amount_due: ['cleared', 'waived'].includes(a.status) ? 0 : amountDue(a.amount, a.amount_paid),
  }))
  res.json({ success: true, data: rows, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

router.post('/arrears/:id/payment', requireFeeCollect, asyncHandler(async (req: FeeRequest, res: Response) => {
  const amount = Number(req.body?.amount)
  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A positive amount is required' })

  const { data: arrear, error: arrearErr } = await supabase.from('fee_arrears')
    .select('*').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
  if (arrearErr) return res.status(500).json({ success: false, error: arrearErr.message })
  if (!arrear) return res.status(404).json({ success: false, error: 'Arrear not found' })
  if (['cleared', 'waived'].includes(arrear.status)) {
    return res.status(400).json({ success: false, error: `Already ${arrear.status}` })
  }

  const remaining = amountDue(arrear.amount, arrear.amount_paid)
  if (money(amount) > remaining + 0.01) {
    return res.status(400).json({ success: false, error: `Only ₹${remaining} remains` })
  }

  const paid = money(Number(arrear.amount_paid) + amount)
  const cleared = paid >= Number(arrear.amount) - 0.01

  const { data, error } = await supabase.from('fee_arrears').update({
    amount_paid: paid, status: cleared ? 'cleared' : 'partial',
    cleared_at: cleared ? new Date().toISOString() : null,
  }).eq('id', req.params.id).select().single()

  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.patch('/arrears/:id/waive', requireFeeArrearManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const reason = String(req.body?.reason ?? '').trim()
  if (!reason) return res.status(400).json({ success: false, error: 'A reason is required to waive an arrear' })

  const { data, error } = await supabase.from('fee_arrears').update({
    status: 'waived', notes: `Waived: ${reason}`, cleared_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('school_id', req.user!.school_id).select().maybeSingle()

  if (error) return res.status(400).json({ success: false, error: error.message })
  if (!data) return res.status(404).json({ success: false, error: 'Arrear not found' })

  await supabase.from('audit_logs').insert({
    school_id: req.user!.school_id, user_id: req.user!.id, action: 'ARREAR_WAIVED',
    entity_type: 'fee_arrear', entity_id: req.params.id, new_values: { reason, amount: data.amount },
  })
  res.json({ success: true, data })
}))

export default router
