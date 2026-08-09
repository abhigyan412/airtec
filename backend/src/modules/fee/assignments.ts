import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { asyncHandler } from '../../shared/utils/helpers'
import { money } from '../../shared/utils/feeMoney'
import { BillingPeriod, Frequency, periodKey, periodsForFrequency } from '../../shared/utils/billingPeriod'
import { insertChunked, selectIn } from './lib/db'
import {
  FeeRequest, attachFeeScope, assertCanReadStudent, requireFeeView, requireFeeManage,
} from './lib/guards'

// Putting students on a plan.
//
// The step between "here is what Class 5 pays" and "here is Aarav's bill". edut
// calls it assignment and previews it before writing; that is kept, because
// billing 400 families is not something to discover the shape of afterwards.

const router = Router()

const AssignSchema = z.object({
  structure_id: z.string().uuid(),
  class_ids: z.array(z.string().uuid()).default([]),
  section_ids: z.array(z.string().uuid()).default([]),
  student_ids: z.array(z.string().uuid()).default([]),
  fee_category: z.enum(['general', 'rte', 'staff_ward', 'sibling', 'scholarship']).optional(),
  start_date: z.string().optional(),
})

/** Everyone the scope selects who is actually on the roll. */
async function targetStudents(schoolId: string, body: z.infer<typeof AssignSchema>) {
  if (body.student_ids.length) {
    return selectIn<any>('students', 'id, first_name, last_name, class_id', 'id', body.student_ids,
      q => q.eq('school_id', schoolId).eq('status', 'active'))
  }
  let q = supabase.from('students').select('id, first_name, last_name, class_id')
    .eq('school_id', schoolId).eq('status', 'active')
  if (body.class_ids.length) q = q.in('class_id', body.class_ids)
  if (body.section_ids.length) q = q.in('section_id', body.section_ids)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

async function resolveAssign(schoolId: string, body: z.infer<typeof AssignSchema>) {
  const { data: structure } = await supabase
    .from('fee_structures')
    .select('id, name, academic_year_id, status, fee_structure_lines(amount, is_optional, period_tokens), fee_structure_classes(class_id)')
    .eq('id', body.structure_id).eq('school_id', schoolId).maybeSingle()

  if (!structure) return { error: 'Structure not found' } as const
  if (structure.status === 'archived') return { error: 'That structure is archived' } as const

  const students = await targetStudents(schoolId, body)

  // A structure offered to Class 5 should not silently land on Class 9. When the
  // plan names its classes, anyone outside them is reported, not assigned.
  const offeredTo = (structure.fee_structure_classes ?? []).map((c: any) => c.class_id)
  const eligible = offeredTo.length
    ? students.filter((s: any) => offeredTo.includes(s.class_id))
    : students
  const outOfScope = students.length - eligible.length

  const existing = eligible.length
    ? await selectIn<any>('fee_assignments', 'student_id, structure_id', 'student_id',
        eligible.map((s: any) => s.id),
        q => q.eq('school_id', schoolId).eq('academic_year_id', structure.academic_year_id).eq('status', 'active'))
    : []
  const assigned = new Map(existing.map(e => [e.student_id, e.structure_id]))

  const fresh = eligible.filter((s: any) => !assigned.has(s.id))
  const alreadyOnThis = eligible.filter((s: any) => assigned.get(s.id) === body.structure_id).length
  const onAnother = eligible.filter((s: any) => assigned.has(s.id) && assigned.get(s.id) !== body.structure_id).length

  // Per installment, so lines that bill only in named periods are left out — the
  // preview answers "what does each of them owe when this plan next bills", and
  // an admission fee charged once in Q1 is not part of that for Q2, Q3 or Q4.
  const mandatory = money((structure.fee_structure_lines ?? [])
    .filter((l: any) => !l.is_optional && !l.period_tokens?.length)
    .reduce((a: number, l: any) => a + Number(l.amount), 0))

  return {
    structure, fresh, mandatory,
    skipped: { already_on_this: alreadyOnThis, on_another_plan: onAnother, out_of_scope: outOfScope },
  } as const
}

// ── POST /preview ─────────────────────────────────────────────────────
// Writes nothing. Says exactly who gets billed and for how much.
router.post('/preview', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = AssignSchema.parse(req.body)
  const r = await resolveAssign(req.user!.school_id, body)
  if ('error' in r) return res.status(400).json({ success: false, error: r.error })

  res.json({
    success: true,
    data: {
      structure: { id: r.structure.id, name: r.structure.name },
      eligible_count: r.fresh.length,
      per_student_total: r.mandatory,
      grand_total: money(r.mandatory * r.fresh.length),
      skipped: r.skipped,
      sample: r.fresh.slice(0, 10).map((s: any) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` })),
    },
  })
}))

router.post('/', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = AssignSchema.parse(req.body)
  const school_id = req.user!.school_id

  const r = await resolveAssign(school_id, body)
  if ('error' in r) return res.status(400).json({ success: false, error: r.error })
  if (!r.fresh.length) {
    return res.json({ success: true, data: { assigned: 0, skipped: r.skipped, message: 'Nobody new to assign.' } })
  }

  const rows = r.fresh.map((s: any) => ({
    school_id,
    student_id: s.id,
    structure_id: body.structure_id,
    academic_year_id: r.structure.academic_year_id,
    fee_category: body.fee_category ?? 'general',
    start_date: body.start_date ?? null,
    assigned_by: req.user!.id,
  }))

  const inserted = await insertChunked('fee_assignments', rows, 'id, student_id')
  res.status(201).json({ success: true, data: { assigned: inserted.length, skipped: r.skipped } })
}))

// ── PATCH /category ───────────────────────────────────────────────────
//
// Change the fee category on students who are ALREADY on a plan.
//
// It could only be set at assignment time, which made it unusable for the thing
// it exists for: RTE seats, staff wards and siblings are a subset scattered
// across classes, identified as the year goes on, not a whole class known up
// front. Getting one wrong meant unassigning the student and starting again.
//
// Scoped by class, section or an explicit list, so "every child in 5-B" and
// "these nineteen students" are the same call.
const CategorySchema = z.object({
  fee_category: z.enum(['general', 'rte', 'staff_ward', 'sibling', 'scholarship']),
  class_ids: z.array(z.string().uuid()).default([]),
  section_ids: z.array(z.string().uuid()).default([]),
  student_ids: z.array(z.string().uuid()).default([]),
  academic_year_id: z.string().uuid().optional(),
  /** Report what would change without writing it. */
  preview: z.boolean().default(false),
})

router.patch('/category', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const body = CategorySchema.parse(req.body)
  const school_id = req.user!.school_id

  if (!body.class_ids.length && !body.section_ids.length && !body.student_ids.length) {
    // Without this, an empty selection would silently recategorise the entire
    // school — the one mistake this endpoint could make that nobody would notice.
    return res.status(400).json({
      success: false,
      error: 'Choose at least one class, section or student — refusing to recategorise everyone',
    })
  }

  const students = await targetStudents(school_id, {
    structure_id: '', class_ids: body.class_ids, section_ids: body.section_ids,
    student_ids: body.student_ids,
  } as any)
  if (!students.length) return res.json({ success: true, data: { updated: 0, message: 'Nobody matched that selection.' } })

  const existing = await selectIn<any>('fee_assignments', 'id, student_id, fee_category', 'student_id',
    students.map((s: any) => s.id),
    qq => {
      let x = qq.eq('school_id', school_id).eq('status', 'active')
      if (body.academic_year_id) x = x.eq('academic_year_id', body.academic_year_id)
      return x
    })

  // Students in the selection who are on no plan cannot carry a category — there
  // is no assignment to put it on. Reported rather than silently dropped.
  const assignedIds = new Set(existing.map(e => e.student_id))
  const notAssigned = students.filter((s: any) => !assignedIds.has(s.id)).length
  const changing = existing.filter(e => e.fee_category !== body.fee_category)

  if (body.preview) {
    return res.json({
      success: true,
      data: {
        matched: students.length,
        would_change: changing.length,
        already_set: existing.length - changing.length,
        not_on_a_plan: notAssigned,
      },
    })
  }

  if (!changing.length) {
    return res.json({
      success: true,
      data: { updated: 0, already_set: existing.length, not_on_a_plan: notAssigned,
              message: 'Everyone selected is already on that category.' },
    })
  }

  const { error } = await supabase.from('fee_assignments')
    .update({ fee_category: body.fee_category })
    .in('id', changing.map(c => c.id))
  if (error) return res.status(400).json({ success: false, error: error.message })

  await supabase.from('audit_logs').insert({
    school_id, user_id: req.user!.id, action: 'FEE_CATEGORY_CHANGED',
    entity_type: 'fee_assignment', entity_id: null,
    new_values: {
      fee_category: body.fee_category, updated: changing.length,
      class_ids: body.class_ids, section_ids: body.section_ids,
      student_ids: body.student_ids.length,
    },
  })

  res.json({
    success: true,
    data: { updated: changing.length, already_set: existing.length - changing.length, not_on_a_plan: notAssigned },
    meta: {
      note: 'Category is for reporting. It does not change what these students are billed — grant a concession for that.',
    },
  })
}))

router.get('/', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { student_id, structure_id, academic_year_id } = req.query
  const scope = req.feeScope!

  let q = supabase.from('fee_assignments')
    .select(`*, ${scope.kind === 'section' ? 'students!inner' : 'students'}(id, first_name, last_name, admission_number, section_id, classes(name)),
             fee_structures(id, name, code, frequency)`)
    .eq('school_id', req.user!.school_id)

  if (scope.kind === 'student') q = q.eq('student_id', scope.studentId)
  if (scope.kind === 'section') q = q.eq('students.section_id', scope.sectionId)
  if (student_id) q = q.eq('student_id', student_id as string)
  if (structure_id) q = q.eq('structure_id', structure_id as string)
  if (academic_year_id) q = q.eq('academic_year_id', academic_year_id as string)

  const { data, error } = await q
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── Optional lines ────────────────────────────────────────────────────
//
// The half that makes is_optional mean something. Without a row here the line is
// not billed, so the safe default needs no backfill and no migration.
//
// Opting in is a decision about MONEY and TIMING, and the timing half used to be
// invisible: the screen showed "Admission Kit ₹2,000" whether that was charged
// every month or once in Q1, and said nothing about the only case that actually
// goes wrong — opting in after the one installment it bills in has already been
// raised, which charges the family nothing at all, this year or ever. So each
// line now carries the installments it bills in, which of them are already
// invoiced for this student, and the next one that will pick it up.

/** Installments this line bills in — its own, or all of them if unrestricted. */
function applicablePeriods(periodTokens: unknown, all: BillingPeriod[]): BillingPeriod[] {
  if (!Array.isArray(periodTokens) || !periodTokens.length) return all
  return all.filter(p => periodTokens.includes(p.token))
}

/**
 * Timing for one student's optional lines: what has been billed, what is next.
 *
 * Shared by the list and the opt-in, so the warning the screen shows and the
 * note the API returns cannot drift apart.
 */
async function optionalTiming(schoolId: string, studentId: string, assignment: any) {
  const frequency = (assignment.fee_structures as any)?.frequency as Frequency | undefined

  const [{ data: year }, { data: invoices }] = await Promise.all([
    supabase.from('academic_years').select('start_date, end_date')
      .eq('id', assignment.academic_year_id).eq('school_id', schoolId).maybeSingle(),
    // "Billed" means an invoice exists for that period_key — the same test the
    // billing run itself uses to skip a student, so this cannot promise a charge
    // the run would then decline to raise.
    supabase.from('fee_invoices').select('period_key')
      .eq('school_id', schoolId).eq('student_id', studentId)
      .eq('academic_year_id', assignment.academic_year_id).neq('status', 'cancelled'),
  ])

  const all = year && frequency
    ? periodsForFrequency(frequency, year.start_date, year.end_date)
    : []
  const billedKeys = new Set((invoices ?? []).map((i: any) => i.period_key))
  const isBilled = (token: string) => !!frequency && billedKeys.has(periodKey(frequency, token))

  return { frequency: frequency ?? null, all, isBilled }
}

router.get('/:studentId/optionals', attachFeeScope, asyncHandler(async (req: FeeRequest, res: Response) => {
  const school_id = req.user!.school_id
  const denied = await assertCanReadStudent(req.feeScope!, req.params.studentId, school_id)
  if (denied) return res.status(403).json({ success: false, error: denied })

  const { data: assignment } = await supabase.from('fee_assignments')
    .select(`id, academic_year_id,
      fee_structures(name, frequency,
        fee_structure_lines(id, amount, is_optional, period_tokens, fee_heads(name)))`)
    .eq('student_id', req.params.studentId).eq('school_id', school_id).eq('status', 'active').maybeSingle()

  if (!assignment) return res.json({ success: true, data: [] })

  const [{ data: taken }, timing] = await Promise.all([
    supabase.from('fee_assignment_optionals')
      .select('structure_line_id, note, created_at').eq('assignment_id', assignment.id),
    optionalTiming(school_id, req.params.studentId, assignment),
  ])
  const byLine = new Map((taken ?? []).map(t => [t.structure_line_id, t]))

  const lines = ((assignment.fee_structures as any)?.fee_structure_lines ?? [])
    .filter((l: any) => l.is_optional)
    .map((l: any) => {
      const restricted = Array.isArray(l.period_tokens) && l.period_tokens.length > 0
      const applicable = applicablePeriods(l.period_tokens, timing.all)
      const periods = applicable.map(p => ({
        token: p.token, label: p.label, billed: timing.isBilled(p.token),
      }))
      const next = periods.find(p => !p.billed) ?? null

      return {
        structure_line_id: l.id,
        name: (l.fee_heads as any)?.name ?? 'Fee',
        amount: Number(l.amount),
        opted_in: byLine.has(l.id),
        note: byLine.get(l.id)?.note ?? null,
        opted_in_at: byLine.get(l.id)?.created_at ?? null,
        /** false = charged in named installments only, so the amount is not per-period. */
        recurs: !restricted,
        /** Only the installments this line bills in, each flagged if already raised. */
        periods,
        /** The installment that will pick it up. Null = nothing left this year. */
        next_period: next,
        /**
         * Every installment it could bill in has already been invoiced, so opting
         * in now changes nothing — the case that needs a one-off charge instead.
         */
        window_passed: periods.length > 0 && !next,
      }
    })

  res.json({
    success: true,
    data: lines,
    meta: {
      assignment_id: assignment.id,
      structure_name: (assignment.fee_structures as any)?.name ?? null,
      frequency: timing.frequency,
    },
  })
}))

router.post('/:studentId/optionals', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { structure_line_id, note } = req.body ?? {}
  const school_id = req.user!.school_id

  const { data: assignment } = await supabase.from('fee_assignments')
    .select('id, academic_year_id, fee_structures(frequency)')
    .eq('student_id', req.params.studentId).eq('school_id', school_id)
    .eq('status', 'active').maybeSingle()
  if (!assignment) return res.status(400).json({ success: false, error: 'This student is not on a fee plan yet' })

  const { data: line } = await supabase.from('fee_structure_lines')
    .select('id, is_optional, period_tokens').eq('id', structure_line_id).maybeSingle()
  if (!line) return res.status(404).json({ success: false, error: 'Fee line not found' })
  if (!line.is_optional) {
    return res.status(400).json({ success: false, error: 'That line is billed to everyone — there is nothing to opt into' })
  }

  const { data, error } = await supabase.from('fee_assignment_optionals').insert({
    assignment_id: assignment.id, structure_line_id, note: note ?? null, opted_in_by: req.user!.id,
  }).select().single()

  if (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'Already opted in' })
    return res.status(400).json({ success: false, error: error.message })
  }

  // Opting in never back-bills. Which installment picks it up — or that none
  // will, because the ones it bills in are already raised — is said here rather
  // than left for the school to discover when the invoice comes out short.
  const timing = await optionalTiming(school_id, req.params.studentId, assignment)
  const periods = applicablePeriods(line.period_tokens, timing.all)
    .map(p => ({ token: p.token, label: p.label, billed: timing.isBilled(p.token) }))
  const next = periods.find(p => !p.billed) ?? null

  res.status(201).json({
    success: true,
    data,
    meta: {
      next_period: next,
      window_passed: periods.length > 0 && !next,
      note: next
        ? `It will be charged when ${next.label} is billed.`
        : periods.length
          ? 'Every installment this line bills in has already been invoiced, so nothing will be charged this year. Raise a one-off charge instead.'
          : 'It will be charged on the next billing run.',
    },
  })
}))

// Opting out affects FUTURE billing only. Invoices already raised keep their
// lines — quietly rewriting an issued bill is worse than explaining it.
router.delete('/:studentId/optionals/:lineId', requireFeeManage, asyncHandler(async (req: FeeRequest, res: Response) => {
  const { data: assignment } = await supabase.from('fee_assignments')
    .select('id').eq('student_id', req.params.studentId).eq('school_id', req.user!.school_id)
    .eq('status', 'active').maybeSingle()
  if (!assignment) return res.status(404).json({ success: false, error: 'No active plan for this student' })

  const { error } = await supabase.from('fee_assignment_optionals').delete()
    .eq('assignment_id', assignment.id).eq('structure_line_id', req.params.lineId)
  if (error) return res.status(400).json({ success: false, error: error.message })

  res.json({
    success: true,
    data: { opted_out: true, note: 'Invoices already raised are unchanged; this affects future billing only.' },
  })
}))

export default router
