import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { FREQUENCIES, Frequency, findPeriod, periodsForFrequency } from '../../shared/utils/billingPeriod'
import { alreadyBilled, resolveBilling } from './lib/resolve'
import { insertChunked, selectAll, selectIn } from './lib/db'
import { postInvoice } from './lib/ledger'
import { FeeRequest, requireFeeView, requireFeeInvoiceGenerate } from './lib/guards'

// Raising a period's invoices.
//
// preview writes nothing and returns exactly what generate will do; generate
// re-resolves from scratch rather than trusting the preview it was handed, so a
// stale tab or an edited body cannot bill an amount nobody approved.
//
// Re-running is safe: period_key carries a unique index, so a double-submit
// inserts nothing and a deliberate re-run bills only newly admitted students.

const router = Router()

const RunSchema = z.object({
  academic_year_id: z.string().uuid(),
  frequency: z.enum(FREQUENCIES as [Frequency, ...Frequency[]]),
  period_token: z.string().min(1),
  /** Empty = every head on each student's plan. */
  fee_head_ids: z.array(z.string().uuid()).default([]),
  class_ids: z.array(z.string().uuid()).default([]),
  section_ids: z.array(z.string().uuid()).default([]),
  /** Bill one plan's students only — how the Structures screen raises a period. */
  structure_id: z.string().uuid().optional(),
  /** Explicit override. Normally left out so the plan's own schedule decides. */
  due_date: z.string().optional(),
})
type Run = z.infer<typeof RunSchema>

async function loadYear(schoolId: string, id: string) {
  const { data } = await supabase.from('academic_years')
    .select('id, name, start_date, end_date').eq('id', id).eq('school_id', schoolId).maybeSingle()
  return data
}

async function targetStudentIds(schoolId: string, body: Run): Promise<string[]> {
  // Billing one plan means billing the students ON it, which is an assignment
  // lookup — not a class filter. A plan offered to Class 5 may have half of 5-B
  // on a scholarship plan instead, and a class filter would bill them twice.
  // Both scans are PAGED. A school-wide run over more than 1,000 active
  // students used to bill the first thousand, return `success: true` with
  // `generated: 1000`, and leave the rest uninvoiced with nothing reporting the
  // truncation — a whole term's fees, missing, silently.
  if (body.structure_id) {
    const rows = await selectAll<any>('fee_assignments', 'student_id, students!inner(status)', q => q
      .eq('school_id', schoolId).eq('structure_id', body.structure_id).eq('status', 'active')
      .eq('students.status', 'active'))
    return rows.map((a: any) => a.student_id)
  }

  const rows = await selectAll<any>('students', 'id', q => {
    let scoped = q.eq('school_id', schoolId)
      // A student who left in April must never appear in a term run — that is how
      // a school ends up chasing arrears from a family that owes nothing.
      .eq('status', 'active')
    if (body.class_ids.length) scoped = scoped.in('class_id', body.class_ids)
    if (body.section_ids.length) scoped = scoped.in('section_id', body.section_ids)
    return scoped
  })
  return rows.map(s => s.id)
}

/**
 * due_date per structure for one period, read off each plan's schedule.
 *
 * The date is a property of the PLAN now, not of whoever happens to run the
 * billing — so two runs of the same quarter cannot land on two different due
 * dates, and a parent portal can show "due 15 Jul" before the invoice exists.
 */
async function scheduleDueDates(structureIds: string[], periodToken: string) {
  const map = new Map<string, string>()
  if (!structureIds.length) return map
  const rows = await selectIn<any>(
    'fee_structure_schedules', 'structure_id, due_date', 'structure_id', structureIds,
    q => q.eq('period_token', periodToken))
  for (const r of rows) map.set(r.structure_id, r.due_date)
  return map
}

async function resolve(schoolId: string, body: Run) {
  const year = await loadYear(schoolId, body.academic_year_id)
  if (!year) return { error: 'Academic year not found' } as const

  const period = findPeriod(body.frequency, body.period_token, year.start_date, year.end_date)
  if (!period) return { error: `'${body.period_token}' is not a valid ${body.frequency} period for ${year.name}` } as const

  const studentIds = await targetStudentIds(schoolId, body)
  const billed = await alreadyBilled(schoolId, body.academic_year_id, period.key)

  const result = await resolveBilling({
    schoolId,
    academicYearId: body.academic_year_id,
    studentIds,
    feeHeadIds: body.fee_head_ids,
    alreadyBilledIds: billed,
    // Lines can name the periods they bill in, so the resolver has to be told
    // which one this run is raising — otherwise a once-a-year admission fee
    // lands on all four quarters.
    periodToken: period.token,
  })

  // Precedence: an explicit override, then the plan's own schedule, then the end
  // of the period. The last is a floor, not a default anyone should hit — a plan
  // with no schedule row for this period has simply not been set up yet.
  const dueBy = await scheduleDueDates(
    Array.from(new Set(result.bills.map(b => b.structure_id))), body.period_token)

  const dueFor = (structureId: string) =>
    body.due_date || dueBy.get(structureId) || period.end

  return { year, period, dueDate: body.due_date || period.end, dueBy, dueFor, result } as const
}

router.get('/periods', requireFeeView, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { academic_year_id, frequency } = req.query as { academic_year_id?: string; frequency?: Frequency }
  if (!academic_year_id) return res.status(400).json({ success: false, error: 'academic_year_id is required' })

  const year = await loadYear(req.user!.school_id, academic_year_id)
  if (!year) return res.status(404).json({ success: false, error: 'Academic year not found' })

  const wanted = frequency && FREQUENCIES.includes(frequency) ? [frequency] : FREQUENCIES
  res.json({
    success: true,
    // Windows are cut from the academic year's OWN start date, so an April–March
    // school gets Q1 = Apr–Jun with nothing to configure.
    data: wanted.map(f => ({ frequency: f, periods: periodsForFrequency(f, year.start_date, year.end_date) })),
    meta: { academic_year: year },
  })
}))

router.post('/preview', requireFeeInvoiceGenerate, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = RunSchema.parse(req.body)
  const r = await resolve(req.user!.school_id, body)
  if ('error' in r) return res.status(400).json({ success: false, error: r.error })

  res.json({
    success: true,
    data: {
      period: { ...r.period, frequency: body.frequency },
      due_date: r.dueDate,
      // Per-plan, because two plans billing the same quarter may legitimately
      // fall due on different days.
      due_dates: Array.from(r.dueBy, ([structure_id, due_date]) => ({ structure_id, due_date })),
      bills: r.result.bills.map(b => ({ ...b, due_date: r.dueFor(b.structure_id) })),
      skipped: r.result.skipped,
      totals: r.result.totals,
    },
  })
}))

router.post('/generate', requireFeeInvoiceGenerate, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = RunSchema.parse(req.body)
  const school_id = req.user!.school_id

  const r = await resolve(school_id, body)
  if ('error' in r) return res.status(400).json({ success: false, error: r.error })

  if (!r.result.bills.length) {
    return res.json({
      success: true,
      data: {
        generated: 0, total_amount: 0, skipped: r.result.skipped,
        message: r.result.skipped.length
          ? 'Nothing to bill — every selected student was skipped (see details).'
          : 'Nothing to bill — no students matched the selection.',
      },
    })
  }

  // Invoice numbers come from the atomic per-school counter. Independent
  // increments, so they are issued concurrently and the counter serialises them.
  const numbers = await Promise.all(r.result.bills.map(() => nextDocumentNumber(school_id, 'INV')))

  const rows = r.result.bills.map((bill, i) => ({
    school_id,
    student_id: bill.student.id,
    academic_year_id: body.academic_year_id,
    assignment_id: bill.assignment_id,
    invoice_number: numbers[i],
    period_key: r.period.key,
    due_date: r.dueFor(bill.structure_id),
    line_items: bill.line_items,
    subtotal: bill.subtotal,
    discount_total: bill.discount_total,
    late_fee: 0,
    total_amount: bill.total_amount,
    status: 'unpaid',
    created_by: req.user!.id,
  }))

  let inserted: any[] = []
  try {
    inserted = await insertChunked('fee_invoices', rows, 'id, student_id, invoice_number, total_amount')
  } catch (e: any) {
    // The unique index is the backstop against a concurrent run. Hitting it means
    // someone else billed this period in between — "already done", not an error
    // the user has to interpret.
    if (String(e?.message ?? '').includes('fee_invoices_period_uniq')) {
      return res.status(409).json({
        success: false,
        error: 'This period has already been billed for these students. Preview again to see what remains.',
      })
    }
    throw e
  }

  // Post the receivable. Invoices were recorded in the ledger NOWHERE, which is
  // why `receivable` was only ever credited — by waivers and write-offs — and
  // ran permanently negative. Income is recognised when the bill goes out, which
  // is the basis postWriteOff has always assumed.
  //
  // Best-effort, deliberately: a ledger failure must not fail a billing run that
  // has already issued numbered invoices. It is logged loudly by post() and the
  // reconciliation endpoint will surface the gap.
  await Promise.all(inserted.map(inv => postInvoice({
    schoolId: school_id,
    invoiceId: inv.id,
    studentId: inv.student_id,
    netAmount: Number(inv.total_amount),
    memo: `Invoice ${inv.invoice_number}`,
  })))

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id,
    action: 'FEE_BILLING_RUN', entity_type: 'fee_invoice', entity_id: null,
    new_values: {
      period_key: r.period.key, academic_year_id: body.academic_year_id,
      generated: inserted.length, total_amount: r.result.totals.amount, due_date: r.dueDate,
    },
  })

  res.status(201).json({
    success: true,
    data: {
      generated: inserted.length,
      total_amount: r.result.totals.amount,
      period: { ...r.period, frequency: body.frequency },
      due_date: r.dueDate,
      skipped: r.result.skipped,
    },
  })
}))

export default router
