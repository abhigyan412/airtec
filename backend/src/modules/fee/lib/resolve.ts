import { supabase } from '../../../shared/db/client'
import { selectAll, selectIn } from './db'
import { ApplicableDiscount, buildLineItems, LineItem, money } from '../../../shared/utils/feeMoney'

// One resolver: what does this student owe for this period.
//
// Called by the billing preview, the billing run, and the single-student invoice
// — so a preview can never show a figure the generate step wouldn't produce.
// Previously three copies existed and two had already drifted.
//
// Against the new model the inputs are an ASSIGNMENT (student → structure), not
// a pile of per-class rows: the plan says what is charged, the assignment says
// who is on it, and the opt-ins say which optional lines they took.

export interface BillingStudent {
  id: string
  first_name: string
  last_name: string
  admission_number: string | null
  class_id: string | null
  section_id: string | null
  class_name: string | null
  section_name: string | null
}

export interface ResolvedBill {
  student: BillingStudent
  assignment_id: string
  structure_id: string
  line_items: LineItem[]
  subtotal: number
  discount_total: number
  total_amount: number
}

export type SkipReason =
  | 'not_assigned' | 'already_billed' | 'nothing_billable' | 'no_class'

/** Shared with the reports; kept here because the resolver labels line items with it. */
export const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  rte: 'RTE',
  staff_ward: 'Staff ward',
  sibling: 'Sibling',
  scholarship: 'Scholarship',
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth']

/**
 * What to print on a receipt for an unnamed rule.
 *
 * "Sibling concession" beats an unexplained deduction, and "concession from the
 * second child" beats both when the rule is what actually decided it.
 */
export function ruleLabel(rule: { fee_category?: string | null; min_sibling_order?: number | null }): string {
  const parts: string[] = []
  if (rule.fee_category) parts.push(`${CATEGORY_LABELS[rule.fee_category] ?? rule.fee_category} concession`)
  if (rule.min_sibling_order) {
    const n = Number(rule.min_sibling_order)
    const ord = ORDINALS[n] ?? `${n}th`
    parts.push(parts.length ? `from the ${ord} child` : `Concession from the ${ord} child`)
  }
  return parts.join(' ') || 'Concession'
}

export interface SkippedStudent { student: BillingStudent; reason: SkipReason }

export interface ResolveResult {
  bills: ResolvedBill[]
  skipped: SkippedStudent[]
  totals: { students: number; subtotal: number; discount: number; amount: number }
}

const STUDENT_COLUMNS =
  'id, first_name, last_name, admission_number, class_id, section_id, classes(name), sections(name)'

const toStudent = (r: any): BillingStudent => ({
  id: r.id,
  first_name: r.first_name,
  last_name: r.last_name,
  admission_number: r.admission_number ?? null,
  class_id: r.class_id ?? null,
  section_id: r.section_id ?? null,
  class_name: (r.classes as any)?.name ?? null,
  section_name: (r.sections as any)?.name ?? null,
})

export interface ResolveInput {
  schoolId: string
  academicYearId: string
  studentIds: string[]
  /** Limit to these heads. Empty = every line on the student's plan. */
  feeHeadIds?: string[]
  /** Students already invoiced for this period, reported rather than re-billed. */
  alreadyBilledIds?: Set<string>
  applyDiscounts?: boolean
  /**
   * The period token being raised, e.g. 'Q1'. Lines restricted to other periods
   * are left off the invoice.
   */
  periodToken?: string
}

/**
 * Does this line bill in the period being raised?
 *
 * No restriction means every period — the behaviour every line had before
 * period_tokens existed, which is why the column is nullable and needs no
 * backfill. A list restricts it: an admission fee tagged {Q1} bills once and is
 * silent for the rest of the year.
 *
 * A caller that does not say which period it is billing gets every line. That is
 * the safe direction: an unknown period must not silently drop charges, and the
 * only caller in that position is a preview that has already named its period.
 */
export function lineBillsInPeriod(periodTokens: unknown, periodToken?: string): boolean {
  if (!periodToken) return true
  if (!Array.isArray(periodTokens) || !periodTokens.length) return true
  return periodTokens.includes(periodToken)
}

export async function resolveBilling(input: ResolveInput): Promise<ResolveResult> {
  const {
    schoolId, academicYearId, studentIds, feeHeadIds, alreadyBilledIds,
    applyDiscounts = true, periodToken,
  } = input

  const empty: ResolveResult = {
    bills: [], skipped: [], totals: { students: 0, subtotal: 0, discount: 0, amount: 0 },
  }
  if (!studentIds.length) return empty

  const studentRows = await selectIn<any>('students', STUDENT_COLUMNS, 'id', studentIds,
    q => q.eq('school_id', schoolId))
  const students = studentRows.map(toStudent)
  if (!students.length) return empty

  // The plan each student is on, with its lines.
  const assignments = await selectIn<any>(
    'fee_assignments',
    `id, student_id, structure_id, fee_category,
     fee_structures(id, name, status,
       fee_structure_lines(id, fee_head_id, amount, is_optional, period_tokens, sort_order, fee_heads(name)))`,
    'student_id',
    students.map(s => s.id),
    q => q.eq('school_id', schoolId).eq('academic_year_id', academicYearId).eq('status', 'active'),
  )
  const byStudent = new Map(assignments.map(a => [a.student_id, a]))

  // Which optional lines each student actually took.
  const optIns = assignments.length
    ? await selectIn<any>(
        'fee_assignment_optionals', 'assignment_id, structure_line_id', 'assignment_id',
        assignments.map(a => a.id),
      )
    : []
  const optedIn = new Set(optIns.map(o => `${o.assignment_id}::${o.structure_line_id}`))

  // Approved concessions only. Pending ones are visible in the UI but must not
  // change what is billed.
  const discountsByStudent = new Map<string, ApplicableDiscount[]>()
  if (applyDiscounts) {
    const rows = await selectIn<any>(
      'fee_discounts', 'student_id, fee_head_id, discount_type, discount_value, reason', 'student_id',
      students.map(s => s.id),
      q => q.eq('school_id', schoolId).eq('is_active', true).eq('approval_status', 'approved'),
    )
    for (const d of rows) {
      const list = discountsByStudent.get(d.student_id) ?? []
      list.push({
        fee_head_id: d.fee_head_id ?? null,
        discount_type: d.discount_type,
        discount_value: Number(d.discount_value),
        label: d.reason ? String(d.reason).slice(0, 60) : 'Concession',
      })
      discountsByStudent.set(d.student_id, list)
    }
  }

  // Policy concessions, keyed by fee category.
  //
  // This is what makes fee_category more than a label: a student on the 'sibling'
  // category picks up the school's sibling terms when the invoice is BUILT,
  // rather than waiting for someone to remember to grant one per child — which
  // is how a school ends up with sixteen approved concessions and nothing taken
  // off any bill.
  //
  // Loaded once per run and merged into the same list as the hand-granted ones,
  // so the arithmetic, the per-head selection and the cap at the line amount all
  // stay in the one implementation that already exists.
  let rules: any[] = []
  const siblingOrder = new Map<string, number>()
  if (applyDiscounts) {
    // THROWS. This read used to swallow its error and fall through to `[]`,
    // which is the most expensive silent failure in the module: on any transient
    // database hiccup every RTE, sibling, staff-ward and scholarship student in
    // the run is billed the full plan amount, the invoices are issued, and
    // nothing anywhere says so. Since these amounts go out on paper to families,
    // there is no version of "carry on with no concessions" that is better than
    // stopping — and every other read in this resolver already throws.
    const { data, error } = await supabase.from('fee_concession_rules')
      .select('fee_category, min_sibling_order, fee_head_id, discount_type, discount_value, note')
      .eq('school_id', schoolId).eq('academic_year_id', academicYearId).eq('is_active', true)
    if (error) {
      throw new Error(
        `Could not read the concession rules, so nothing was billed: ${error.message}. ` +
        'Billing without them would charge every concession student the full amount.',
      )
    }
    rules = (data ?? []) as any[]

    // Sibling order, read only if some rule actually asks for it. It is a view
    // over active students per family, so it is always current — no backfill to
    // run and no trigger to forget when a child is admitted or withdrawn.
    if (rules.some(r => r.min_sibling_order)) {
      const orders = await selectIn<any>(
        'student_sibling_order', 'student_id, sibling_order', 'student_id',
        students.map(s => s.id))
      for (const o of orders) siblingOrder.set(o.student_id, Number(o.sibling_order))
    }
  }

  // Scholarships: money a third party puts in, which until now touched nothing.
  //
  // The table has carried a funding_source (government / trust / school) and an
  // amount since the model rewrite and was read by no billing code, so an
  // awarded scholarship reduced no bill and the school chased the family for it
  // anyway. It reduces the bill like any other concession — the difference that
  // matters is on the reporting side, where forgone revenue and funded revenue
  // must not be added together.
  const scholarshipByStudent = new Map<string, ApplicableDiscount[]>()
  if (applyDiscounts) {
    const rows = await selectIn<any>(
      'fee_scholarships', 'student_id, name, amount, funding_source, academic_year_id', 'student_id',
      students.map(s => s.id),
      q => q.eq('school_id', schoolId))
    for (const s of rows) {
      // A scholarship for another year must not reduce this year's fee. NULL is
      // treated as "this year" — the column is nullable and older rows have it.
      if (s.academic_year_id && s.academic_year_id !== academicYearId) continue
      const list = scholarshipByStudent.get(s.student_id) ?? []
      list.push({
        fee_head_id: null,
        discount_type: 'fixed',
        discount_value: Number(s.amount),
        // An award is ONE figure for the invoice, not a figure per line. Without
        // the budget a ₹4,000 grant took ₹4,000 off tuition and ₹500 off the
        // exam fee — forgiving ₹4,500 of a ₹4,000 award.
        budget: Number(s.amount),
        label: s.name ? String(s.name).slice(0, 60) : 'Scholarship',
      })
      scholarshipByStudent.set(s.student_id, list)
    }
  }

  /**
   * Every policy concession that fires for one student.
   *
   * A rule may name a category, a minimum sibling order, or both — and both
   * means both must hold. Absent conditions do not match everything; a rule with
   * no condition at all cannot exist (the table's check constraint refuses it),
   * because it would discount the whole school in silence.
   */
  const rulesFor = (student: BillingStudent, category: string): ApplicableDiscount[] =>
    rules
      .filter(r => {
        if (r.fee_category && r.fee_category !== category) return false
        if (r.min_sibling_order) {
          // No family, no order — an ungrouped student is an only child, and an
          // only child is never the second sibling.
          const order = siblingOrder.get(student.id)
          if (!order || order < Number(r.min_sibling_order)) return false
        }
        return true
      })
      .map(r => ({
        fee_head_id: r.fee_head_id ?? null,
        discount_type: r.discount_type,
        discount_value: Number(r.discount_value),
        label: r.note ? String(r.note).slice(0, 60) : ruleLabel(r),
      }))

  const bills: ResolvedBill[] = []
  const skipped: SkippedStudent[] = []

  for (const student of students) {
    if (alreadyBilledIds?.has(student.id)) { skipped.push({ student, reason: 'already_billed' }); continue }
    if (!student.class_id) { skipped.push({ student, reason: 'no_class' }); continue }

    const assignment = byStudent.get(student.id)
    if (!assignment?.fee_structures) { skipped.push({ student, reason: 'not_assigned' }); continue }

    const allLines = (assignment.fee_structures.fee_structure_lines ?? []) as any[]
    const billable = allLines
      .filter(l => !l.is_optional || optedIn.has(`${assignment.id}::${l.id}`))
      // A once-a-year line — admission, caution money, annual fund — is on the
      // plan all year and bills in the periods it names. Without this it billed
      // every quarter, which is why such heads had to be kept off plans entirely.
      .filter(l => lineBillsInPeriod(l.period_tokens, periodToken))
      .filter(l => !feeHeadIds?.length || feeHeadIds.includes(l.fee_head_id))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    if (!billable.length) { skipped.push({ student, reason: 'nothing_billable' }); continue }

    // Policy first, then anything granted to this child by hand. Both apply and
    // the total is capped at the line — discountForLine already clamps, so a
    // 50% policy plus a 60% hardship grant reduces the line to zero rather than
    // going negative. The order only affects which label is listed first.
    const applicable = [
      ...rulesFor(student, assignment.fee_category ?? 'general'),
      ...(scholarshipByStudent.get(student.id) ?? []),
      ...(discountsByStudent.get(student.id) ?? []),
    ]

    const totals = buildLineItems(
      billable.map(l => ({
        fee_head_id: l.fee_head_id,
        amount: Number(l.amount),
        fee_head_name: (l.fee_heads as any)?.name ?? 'Fee',
      })),
      applicable,
    )

    bills.push({
      student,
      assignment_id: assignment.id,
      structure_id: assignment.structure_id,
      line_items: totals.line_items,
      subtotal: totals.subtotal,
      discount_total: totals.total_discount,
      // A newly raised invoice carries no late fee; the sweep adds it later,
      // which is also what keeps it out of the preview a school approves.
      total_amount: totals.net_amount,
    })
  }

  return {
    bills, skipped,
    totals: {
      students: bills.length,
      subtotal: money(bills.reduce((s, b) => s + b.subtotal, 0)),
      discount: money(bills.reduce((s, b) => s + b.discount_total, 0)),
      amount: money(bills.reduce((s, b) => s + b.total_amount, 0)),
    },
  }
}

/** Students already holding an invoice for this period, so a re-run skips them. */
export async function alreadyBilled(
  schoolId: string, academicYearId: string, periodKey: string,
): Promise<Set<string>> {
  // Paged. Past 1,000 already-billed students the set came back short, so a
  // preview offered to re-bill families who had already been invoiced — caught
  // only by the period unique index, which surfaces as a 409 nobody can read.
  const rows = await selectAll<any>('fee_invoices', 'student_id', q => q
    .eq('school_id', schoolId).eq('academic_year_id', academicYearId)
    .eq('period_key', periodKey).neq('status', 'cancelled'))
  return new Set(rows.map(r => r.student_id))
}
