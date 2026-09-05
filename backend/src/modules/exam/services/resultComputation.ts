// ═══════════════════════════════════════════════════════════════
// RESULT COMPUTATION CORE — pure functions, no DB calls.
//
// Every function here is deterministic given its inputs, so the same
// pipeline serves both a single exam's report card
// (POST /:id/generate-results) and a composite Term's blended report card
// (POST /result-groups/:id/generate-results) — the caller is responsible
// for fetching rows and passing them in, and for the actual DB write.
//
// Backward compatibility is load-bearing here: LEGACY_CLASS_RULE and
// LEGACY_SUBJECT_RULE are the literal defaults a class/subject with zero
// configured rows resolves to, and computeReportCard() run against them
// must reproduce exam/routes.ts's original generate-results math exactly
// — same rounding (Math.round to an INTEGER, not routing through the new
// rounding_mode/decimals machinery), same "sum of each subject's
// pass_marks" aggregate check (not a percentage bar), same remarks text
// ('Promoted'/'Detained'), same computeGrade() band boundaries. See the
// inline notes on each sentinel field for exactly which legacy behavior
// it's replicating.
// ═══════════════════════════════════════════════════════════════

// 'compartment' is a real exam_type (see 20260905000000_compartment_exams.sql)
// so a compartment re-take exam flows through the entire ordinary exam
// lifecycle unmodified, but it's deliberately never a valid key in
// exam_class_result_rules/exam_subject_result_overrides — a compartment
// exam always resolves the class's DEFAULT rule (examType: null passed to
// resolveEffectiveClassRule at finalize time), never a type-specific one.
export type ExamType = 'unit_test' | 'monthly' | 'half_yearly' | 'annual' | 'pre_board' | 'practical' | 'other' | 'compartment'
export type ResultStatus = 'pass' | 'fail' | 'compartment' | 'not_eligible' | 'withheld'

export interface GradeBand {
  min_percent: number
  max_percent: number
  grade_label: string
  grade_point: number | null
  is_pass: boolean
}

export interface RemarksBand {
  match_status: ResultStatus
  min_percent: number | null
  max_percent: number | null
  remark_text: string
}

export interface EffectiveClassRule {
  promotion_policy: 'standard' | 'no_detention'
  pass_criteria_mode: 'aggregate' | 'per_subject'
  pass_criteria_requires_aggregate: boolean
  // null is the legacy sentinel: "no percentage bar configured — fall back
  // to obtained >= sum of each subject's own pass_marks", exactly as
  // exam/routes.ts always did before this feature existed. A real class
  // rule row always stores a number (DB default 33) — once a school
  // configures anything at all for a class, the aggregate check becomes
  // percentage-based, which is a deliberate, expected simplification for
  // an explicit opt-in, not something that needs to match legacy math.
  aggregate_pass_percent: number | null
  best_of_subjects_count: number | null
  allow_additional_subject_substitution: boolean
  compartment_policy: 'none' | 'allow'
  compartment_max_failed_subjects: number | null
  min_attendance_percent: number | null
  max_grace_marks_per_subject: number
  max_grace_marks_total: number
  rounding_mode: 'nearest' | 'floor' | 'ceil'
  rounding_decimals: number
  grading_mode: 'marks' | 'grade_only' | 'cgpa'
  grade_bands: GradeBand[] | null
  remarks_bands: RemarksBand[] | null
}

export interface EffectiveSubjectRule {
  pass_criteria_mode: 'aggregate' | 'per_subject'
  aggregate_pass_percent: number | null
  grading_mode: 'marks' | 'grade_only' | 'cgpa'
  grade_bands: GradeBand[] | null
  is_additional: boolean
  include_in_aggregate: boolean
  subject_group_key: string | null
}

// The literal legacy default — resolved for any class with zero rows in
// exam_class_result_rules. rounding_decimals: 0 + rounding_mode: 'nearest'
// reproduces Math.round(pct) exactly (legacy always rounded the display
// percentage to a whole number, never configurable).
export const LEGACY_CLASS_RULE: EffectiveClassRule = {
  promotion_policy: 'standard',
  pass_criteria_mode: 'aggregate',
  pass_criteria_requires_aggregate: true,
  aggregate_pass_percent: null,
  best_of_subjects_count: null,
  allow_additional_subject_substitution: false,
  compartment_policy: 'none',
  compartment_max_failed_subjects: null,
  min_attendance_percent: null,
  max_grace_marks_per_subject: 0,
  max_grace_marks_total: 0,
  rounding_mode: 'nearest',
  rounding_decimals: 0,
  grading_mode: 'marks',
  grade_bands: null,
  remarks_bands: null,
}

export const LEGACY_SUBJECT_RULE: EffectiveSubjectRule = {
  pass_criteria_mode: 'aggregate',
  aggregate_pass_percent: null,
  grading_mode: 'marks',
  grade_bands: null,
  is_additional: false,
  include_in_aggregate: true,
  subject_group_key: null,
}

// ── Resolution ──────────────────────────────────────────────────

// examType: null means "class default only" — used by composite Result
// Groups (services/resultGroups), which aren't tied to any single
// exam_type, so they must never accidentally pick up a type-specific
// override the way a real exam with that type would.
export function resolveEffectiveClassRule(
  rulesByClassAndType: Map<string, EffectiveClassRule>,
  classId: string,
  examType: ExamType | null,
): EffectiveClassRule {
  return (
    (examType != null ? rulesByClassAndType.get(`${classId}:${examType}`) : undefined) ??
    rulesByClassAndType.get(`${classId}:`) ??
    LEGACY_CLASS_RULE
  )
}

export function resolveEffectiveSubjectRule(
  classRule: EffectiveClassRule,
  overridesByKey: Map<string, Partial<EffectiveSubjectRule>>,
  classId: string,
  examType: ExamType | null,
  subjectName: string,
): EffectiveSubjectRule {
  const base: EffectiveSubjectRule = {
    pass_criteria_mode: classRule.pass_criteria_mode,
    aggregate_pass_percent: classRule.aggregate_pass_percent,
    grading_mode: classRule.grading_mode,
    grade_bands: classRule.grade_bands,
    is_additional: false,
    include_in_aggregate: true,
    subject_group_key: null,
  }
  const override =
    (examType != null ? overridesByKey.get(`${classId}:${examType}:${subjectName}`) : undefined) ??
    overridesByKey.get(`${classId}::${subjectName}`)
  if (!override) return base
  return {
    pass_criteria_mode: override.pass_criteria_mode ?? base.pass_criteria_mode,
    aggregate_pass_percent: override.aggregate_pass_percent ?? base.aggregate_pass_percent,
    grading_mode: override.grading_mode ?? base.grading_mode,
    grade_bands: override.grade_bands ?? base.grade_bands,
    is_additional: override.is_additional ?? base.is_additional,
    include_in_aggregate: override.include_in_aggregate ?? base.include_in_aggregate,
    subject_group_key: override.subject_group_key ?? base.subject_group_key,
  }
}

// ── Rounding ────────────────────────────────────────────────────

export function roundValue(value: number, mode: 'nearest' | 'floor' | 'ceil', decimals: number): number {
  const factor = Math.pow(10, decimals)
  const scaled = value * factor
  const rounded = mode === 'floor' ? Math.floor(scaled) : mode === 'ceil' ? Math.ceil(scaled) : Math.round(scaled)
  return rounded / factor
}

// ── Grading ─────────────────────────────────────────────────────

// Moved verbatim from exam/routes.ts — the exact fallback every
// unconfigured class/subject must keep producing forever. Do not change
// these boundaries; add a grade scale instead if a different table is needed.
export function computeGrade(obtained: number, max: number): string {
  if (!obtained || !max) return 'F'
  const pct = (obtained / max) * 100
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B+'
  if (pct >= 60) return 'B'
  if (pct >= 50) return 'C'
  if (pct >= 33) return 'D'
  return 'F'
}

export function gradeForPercent(
  obtained: number,
  max: number,
  bands: GradeBand[] | null,
): { grade: string; grade_point: number | null; is_pass: boolean } {
  if (!bands || !bands.length) {
    const grade = computeGrade(obtained, max)
    return { grade, grade_point: null, is_pass: grade !== 'F' }
  }
  const pct = max > 0 ? (obtained / max) * 100 : 0
  const band = bands.find(b => pct >= b.min_percent && pct <= b.max_percent) ?? bands[bands.length - 1]
  return { grade: band.grade_label, grade_point: band.grade_point, is_pass: band.is_pass }
}

// ── Remarks ─────────────────────────────────────────────────────

export function remarksFor(status: ResultStatus, percentage: number | null, bands: RemarksBand[] | null): string {
  if (!bands || !bands.length) {
    // Exact legacy strings — generate-results never said "Pass"/"Fail".
    return status === 'pass' ? 'Promoted' : 'Detained'
  }
  const candidates = bands.filter(b => b.match_status === status)
  const narrowed = candidates.find(b =>
    b.min_percent != null && b.max_percent != null && percentage != null &&
    percentage >= b.min_percent && percentage <= b.max_percent,
  )
  const fallback = candidates.find(b => b.min_percent == null && b.max_percent == null)
  return (narrowed ?? fallback ?? candidates[0])?.remark_text ?? (status === 'pass' ? 'Promoted' : 'Detained')
}

// ── Per-subject outcome ─────────────────────────────────────────

// An optional THIRD-and-beyond component (Written/Oral/Project/Internal
// Assessment/...), additive alongside Theory/Practical which stay exactly
// as they are everywhere — every existing subject has zero of these.
// subject.max_marks is always the server-recomputed grand total
// (plain-or-split-total + sum of every extra component's own max_marks,
// same "never trust a client-sent combined total" rule already applied to
// Theory+Practical) — this function trusts it as-is rather than
// re-deriving it, so it must never add these back into maxMarks itself.
export interface ExamSubjectExtraComponent {
  id: string
  max_marks: number
  pass_marks: number
}

export interface ExamSubjectRow {
  id: string
  subject_name: string
  max_marks: number
  pass_marks: number
  theory_max_marks: number | null
  theory_pass_marks: number | null
  practical_max_marks: number | null
  practical_pass_marks: number | null
  extra_components?: ExamSubjectExtraComponent[]
}

export interface StudentMarkRow {
  marks_obtained: number | null
  is_absent: boolean
  theory_marks_obtained: number | null
  practical_marks_obtained: number | null
  theory_is_absent: boolean
  practical_is_absent: boolean
  extra_component_marks?: { component_id: string; obtained: number | null; is_absent: boolean }[]
  grade: string | null // manually-entered grade label, used only when grading_mode='grade_only'
  grace_marks_applied: number
  result_status_override: string | null
}

export interface SubjectOutcome {
  exam_subject_id: string
  subject_name: string
  max_marks: number
  obtained_marks: number
  is_pass: boolean
  grade: string | null
  grade_point: number | null
  is_additional: boolean
  include_in_aggregate: boolean
  subject_group_key: string | null
  status_override: string | null
  moderation_marks_applied: number
}

// A cohort-wide, auditable, reversible adjustment — the systemic
// counterpart to per-student grace marks (PATCH .../override), which only
// ever touch one student at a time. exam_subject_id null means "every
// subject in the exam." 'flat_grace_band' adds grace_amount to any
// student's raw percentage falling within [band_min_percent,
// band_max_percent] (either bound null means unbounded on that side);
// 'scale_factor' multiplies every matching student's raw obtained marks.
// Deleting a rule and re-running generate-results is the entire "reverse
// it" mechanism — nothing here is ever separately materialized.
export interface ModerationRule {
  exam_subject_id: string | null
  rule_type: 'flat_grace_band' | 'scale_factor'
  band_min_percent: number | null
  band_max_percent: number | null
  grace_amount: number | null
  scale_factor: number | null
}

// Applied to the RAW obtained marks — before any per-student grace marks
// fold in, before per-component (Theory/Practical) pass checks are
// decided — same stage a board's own moderation would apply, upstream of
// anything student-specific. Scoped to whichever subject-level total the
// caller passes in: for a split subject that's the Theory+Practical sum,
// not each component separately — a school moderates a subject's overall
// score, not component by component. Multiple matching rules apply in
// order; result is always clamped to [0, maxMarks].
function applyModerationToObtained(obtained: number, maxMarks: number, examSubjectId: string, rules: ModerationRule[]): number {
  if (!rules.length || maxMarks <= 0) return obtained
  let result = obtained
  const percent = (obtained / maxMarks) * 100
  for (const rule of rules) {
    if (rule.exam_subject_id != null && rule.exam_subject_id !== examSubjectId) continue
    if (rule.rule_type === 'scale_factor' && rule.scale_factor != null) {
      result = result * rule.scale_factor
    } else if (rule.rule_type === 'flat_grace_band' && rule.grace_amount != null) {
      const min = rule.band_min_percent ?? -Infinity
      const max = rule.band_max_percent ?? Infinity
      if (percent >= min && percent <= max) result = result + rule.grace_amount
    }
  }
  // Rounded to 2 decimals — a scale_factor multiply routinely produces
  // float noise (e.g. 50 * 1.1 = 55.00000000000001) that would otherwise
  // show up verbatim on a report card.
  const rounded = Math.round(result * 100) / 100
  return Math.min(Math.max(rounded, 0), maxMarks)
}

// A grade_only subject is deliberately excluded from the numeric
// aggregate (obtainedForAggregate/maxForAggregate = 0, include_in_aggregate
// forced false below) — it contributes only to the per-subject pass check
// (when the class/subject rule requires one) and shows as a standalone
// grade line on the report card, matching how CBSE co-scholastic grades
// sit alongside, not inside, the percentage.
export function computeSubjectOutcome(
  subject: ExamSubjectRow,
  mark: StudentMarkRow | undefined,
  rule: EffectiveSubjectRule,
  moderationRules: ModerationRule[] = [],
): SubjectOutcome {
  const base = {
    exam_subject_id: subject.id,
    subject_name: subject.subject_name,
    is_additional: rule.is_additional,
    subject_group_key: rule.subject_group_key,
  }

  if (mark?.result_status_override) {
    return {
      ...base,
      max_marks: subject.max_marks,
      obtained_marks: 0,
      is_pass: false,
      grade: null,
      grade_point: null,
      include_in_aggregate: false,
      status_override: mark.result_status_override,
      moderation_marks_applied: 0,
    }
  }

  if (rule.grading_mode === 'grade_only') {
    const bands = rule.grade_bands ?? []
    const band = bands.find(b => b.grade_label === mark?.grade)
    return {
      ...base,
      max_marks: 0,
      obtained_marks: 0,
      is_pass: band?.is_pass ?? true,
      grade: mark?.grade ?? null,
      grade_point: band?.grade_point ?? null,
      include_in_aggregate: false,
      status_override: null,
      moderation_marks_applied: 0,
    }
  }

  const isSplit = subject.theory_max_marks != null && subject.practical_max_marks != null
  let obtained: number
  let maxMarks = subject.max_marks
  let componentsPassed = true

  if (isSplit) {
    const theoryObtained = mark?.theory_is_absent ? 0 : Number(mark?.theory_marks_obtained ?? 0)
    const practicalObtained = mark?.practical_is_absent ? 0 : Number(mark?.practical_marks_obtained ?? 0)
    obtained = theoryObtained + practicalObtained
    if (rule.pass_criteria_mode === 'per_subject') {
      const theoryPass = subject.theory_pass_marks == null || theoryObtained >= subject.theory_pass_marks
      const practicalPass = subject.practical_pass_marks == null || practicalObtained >= subject.practical_pass_marks
      componentsPassed = theoryPass && practicalPass
    }
  } else {
    obtained = mark?.is_absent ? 0 : Number(mark?.marks_obtained ?? 0)
  }

  // Extra components (Written/Oral/Project/Internal Assessment/...) —
  // additive alongside Theory/Practical above, which are untouched by
  // this. Each one's own marks add to the subject total; under
  // per_subject criteria each must also individually clear its own pass
  // mark, same semantics as the Theory/Practical check above, generalized
  // to however many extra components this subject actually has.
  if (subject.extra_components?.length) {
    for (const ec of subject.extra_components) {
      const cm = mark?.extra_component_marks?.find(m => m.component_id === ec.id)
      const componentObtained = cm?.is_absent ? 0 : Number(cm?.obtained ?? 0)
      obtained += componentObtained
      if (rule.pass_criteria_mode === 'per_subject' && componentObtained < ec.pass_marks) {
        componentsPassed = false
      }
    }
  }

  // Moderation applies to the RAW obtained marks — before per-student
  // grace marks fold in, upstream of anything student-specific — same
  // stage a board's own moderation circular would apply.
  const rawObtained = obtained
  obtained = applyModerationToObtained(obtained, maxMarks, subject.id, moderationRules)
  const moderationMarksApplied = obtained - rawObtained

  const graceApplied = mark?.grace_marks_applied ?? 0
  const obtainedWithGrace = obtained + graceApplied
  const meetsSubjectPassMark = obtainedWithGrace >= subject.pass_marks
  const subjectPassed = rule.pass_criteria_mode === 'per_subject' ? (componentsPassed && meetsSubjectPassMark) : true

  const graded = gradeForPercent(obtainedWithGrace, maxMarks, rule.grade_bands)

  return {
    ...base,
    moderation_marks_applied: moderationMarksApplied,
    max_marks: maxMarks,
    obtained_marks: obtainedWithGrace,
    is_pass: subjectPassed,
    grade: graded.grade,
    grade_point: graded.grade_point,
    include_in_aggregate: rule.include_in_aggregate,
    status_override: null,
  }
}

// ── Subject groups — "pass at least one of" ────────────────────

export function resolveSubjectGroups(outcomes: SubjectOutcome[]): Map<string, boolean> {
  const groupPass = new Map<string, boolean>()
  for (const o of outcomes) {
    if (!o.subject_group_key) continue
    const current = groupPass.get(o.subject_group_key) ?? false
    groupPass.set(o.subject_group_key, current || o.is_pass)
  }
  return groupPass
}

// ── Best-of-N ────────────────────────────────────────────────────

// Marks the lowest-percentage subjects (beyond the top N) as excluded from
// the aggregate. Only ever touches subjects already flagged
// include_in_aggregate — grade_only/excluded subjects are left alone.
export function applyBestOfN(outcomes: SubjectOutcome[], n: number | null): SubjectOutcome[] {
  if (n == null) return outcomes
  const eligible = outcomes.filter(o => o.include_in_aggregate && !o.status_override)
  if (eligible.length <= n) return outcomes
  const sorted = [...eligible].sort((a, b) => {
    const pctA = a.max_marks > 0 ? a.obtained_marks / a.max_marks : 0
    const pctB = b.max_marks > 0 ? b.obtained_marks / b.max_marks : 0
    return pctB - pctA
  })
  const keepIds = new Set(sorted.slice(0, n).map(o => o.exam_subject_id))
  return outcomes.map(o =>
    o.include_in_aggregate && !keepIds.has(o.exam_subject_id) && eligible.includes(o)
      ? { ...o, include_in_aggregate: false }
      : o,
  )
}

// ── Additional-subject substitution ─────────────────────────────

// A failed compulsory subject's contribution can be replaced by a passing
// additional subject's, one-for-one, when the class rule allows it.
export function applySubstitution(outcomes: SubjectOutcome[], allow: boolean): SubjectOutcome[] {
  if (!allow) return outcomes
  const failedCompulsory = outcomes.filter(o => o.include_in_aggregate && !o.is_additional && !o.is_pass && !o.status_override)
  const passingAdditional = outcomes.filter(o => o.is_additional && o.is_pass && !o.status_override)
  if (!failedCompulsory.length || !passingAdditional.length) return outcomes

  const result = [...outcomes]
  const usedAdditional = new Set<string>()
  for (const failed of failedCompulsory) {
    const sub = passingAdditional.find(a => !usedAdditional.has(a.exam_subject_id))
    if (!sub) break
    usedAdditional.add(sub.exam_subject_id)
    const idx = result.findIndex(o => o.exam_subject_id === failed.exam_subject_id)
    result[idx] = { ...result[idx], obtained_marks: sub.obtained_marks, max_marks: sub.max_marks || result[idx].max_marks, is_pass: true }
  }
  return result
}

// ── Grace marks ──────────────────────────────────────────────────
// Note: grace marks are read from student_marks.grace_marks_applied
// (already folded into computeSubjectOutcome's obtained_marks via
// `obtainedWithGrace` above, since a specific per-subject amount is set
// manually per student — see PATCH .../override). This function only
// enforces the class rule's ceilings and reports the total actually in
// effect, for the report card's audit-trail column; it never invents
// grace marks on its own.
export function summarizeGraceMarks(
  perSubjectGrace: number[],
  maxPerSubject: number,
  maxTotal: number,
): { total: number; exceededCeiling: boolean } {
  const cappedPerSubject = perSubjectGrace.map(g => Math.min(g, maxPerSubject || g))
  const total = cappedPerSubject.reduce((s, g) => s + g, 0)
  const exceededCeiling =
    perSubjectGrace.some((g, i) => maxPerSubject > 0 && g > maxPerSubject) ||
    (maxTotal > 0 && total > maxTotal)
  return { total: Math.min(total, maxTotal || total), exceededCeiling }
}

// ── Attendance eligibility ───────────────────────────────────────
// Pure — the caller resolves the actual percentage (via
// countWorkingDays/isWorkingDate/getNonWorkingDaySets against the
// `attendance` table, same math as GET /sis/attendance/report) and passes
// it in here.
export function checkAttendanceEligibility(attendancePercent: number | null, minRequired: number | null): boolean {
  if (minRequired == null || attendancePercent == null) return true
  return attendancePercent >= minRequired
}

// ── Full per-student report card ─────────────────────────────────

export interface ComputeReportCardInput {
  subjects: ExamSubjectRow[]
  marksBySubjectId: Map<string, StudentMarkRow>
  classRule: EffectiveClassRule
  resolveSubjectRule: (subjectName: string) => EffectiveSubjectRule
  attendancePercent?: number | null
  moderationRules?: ModerationRule[]
}

export interface ComputedReportCard {
  total_marks: number
  obtained_marks: number
  percentage: number
  grade: string | null
  overall_cgpa: number | null
  is_pass: boolean
  result_status: ResultStatus
  grace_marks_applied_total: number
  moderation_marks_applied_total: number
  remarks: string
  remarks_source: 'legacy' | 'rule' | 'manual'
  subject_outcomes: SubjectOutcome[]
}

export function computeReportCard(input: ComputeReportCardInput): ComputedReportCard {
  const { subjects, marksBySubjectId, classRule, resolveSubjectRule, moderationRules = [] } = input

  // 1. Eligibility gate — short-circuits everything else.
  const eligible = checkAttendanceEligibility(input.attendancePercent ?? null, classRule.min_attendance_percent)
  if (!eligible) {
    return {
      total_marks: 0, obtained_marks: 0, percentage: 0, grade: null, overall_cgpa: null,
      is_pass: false, result_status: 'not_eligible', grace_marks_applied_total: 0,
      moderation_marks_applied_total: 0,
      remarks: remarksFor('not_eligible', null, classRule.remarks_bands),
      remarks_source: classRule.remarks_bands ? 'rule' : 'legacy',
      subject_outcomes: [],
    }
  }

  // 2. Per-subject outcomes.
  let outcomes = subjects.map(s =>
    computeSubjectOutcome(s, marksBySubjectId.get(s.id), resolveSubjectRule(s.subject_name), moderationRules),
  )

  // 3. Subject groups — "at least one of" overrides individual per-subject
  // failure for grouped subjects (still contributes real marks to the
  // aggregate; only the pass/fail verdict is grouped).
  const groupPass = resolveSubjectGroups(outcomes)
  outcomes = outcomes.map(o =>
    o.subject_group_key && groupPass.has(o.subject_group_key)
      ? { ...o, is_pass: groupPass.get(o.subject_group_key)! }
      : o,
  )

  // 4. Best-of-N, then additional-subject substitution.
  outcomes = applyBestOfN(outcomes, classRule.best_of_subjects_count)
  outcomes = applySubstitution(outcomes, classRule.allow_additional_subject_substitution)

  // 5. Aggregate.
  const aggregateSubjects = outcomes.filter(o => o.include_in_aggregate && !o.status_override)
  const totalMax = aggregateSubjects.reduce((s, o) => s + o.max_marks, 0)
  const totalObtained = aggregateSubjects.reduce((s, o) => s + o.obtained_marks, 0)

  const rawPercentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
  const percentage = roundValue(rawPercentage, classRule.rounding_mode, classRule.rounding_decimals)

  let aggregatePass: boolean
  if (classRule.aggregate_pass_percent == null) {
    // Legacy sentinel: obtained >= sum of each aggregate subject's own
    // pass_marks (exam_subjects.pass_marks), not a percentage bar —
    // exact replication of generate-results' original passTotal check.
    const passTotal = subjects.reduce((s, sub) => s + Number(sub.pass_marks), 0)
    aggregatePass = totalObtained >= passTotal
  } else {
    aggregatePass = rawPercentage >= classRule.aggregate_pass_percent
  }

  const perSubjectPass = aggregateSubjects.every(o => o.is_pass)
  const failedCount = aggregateSubjects.filter(o => !o.is_pass).length

  let structurallyPassed: boolean
  if (classRule.pass_criteria_mode === 'per_subject') {
    structurallyPassed = perSubjectPass && (!classRule.pass_criteria_requires_aggregate || aggregatePass)
  } else {
    structurallyPassed = aggregatePass
  }

  // 6. Compartment.
  let status: ResultStatus = structurallyPassed ? 'pass' : 'fail'
  if (
    !structurallyPassed &&
    classRule.compartment_policy === 'allow' &&
    classRule.compartment_max_failed_subjects != null &&
    failedCount > 0 &&
    failedCount <= classRule.compartment_max_failed_subjects
  ) {
    status = 'compartment'
  }

  // 7. Grading.
  const graded = gradeForPercent(totalObtained, totalMax, classRule.grade_bands)
  const overall_cgpa = classRule.grading_mode === 'cgpa'
    ? averageGradePoint(aggregateSubjects)
    : null

  // 8. Promotion policy override — last step, only touches status/is_pass,
  // never the computed marks/grade/percentage themselves.
  if (classRule.promotion_policy === 'no_detention') {
    status = 'pass'
  }

  const graceTotal = Array.from(marksBySubjectId.values()).reduce((s, m) => s + (m.grace_marks_applied || 0), 0)
  const moderationTotal = outcomes.reduce((s, o) => s + (o.moderation_marks_applied || 0), 0)

  return {
    total_marks: totalMax,
    obtained_marks: totalObtained,
    moderation_marks_applied_total: moderationTotal,
    percentage,
    grade: classRule.grading_mode === 'grade_only' ? null : graded.grade,
    overall_cgpa,
    is_pass: status === 'pass',
    result_status: status,
    grace_marks_applied_total: graceTotal,
    remarks: remarksFor(status, percentage, classRule.remarks_bands),
    remarks_source: classRule.remarks_bands ? 'rule' : 'legacy',
    subject_outcomes: outcomes,
  }
}

// ── Compartment re-exam merge ────────────────────────────────────
//
// A compartment exam has its own exam_subjects ids (a new exam, distinct
// from the original) covering only the subjects some student failed —
// matched back to the original exam's subject rows by name, since that's
// the only stable link between the two datesheets. A re-take supersedes
// the original attempt entirely for that subject; it never averages with
// the failed attempt it's replacing.
export function overlayCompartmentMarks(
  originalMarksBySubjectId: Map<string, StudentMarkRow>,
  originalSubjectIdByName: Map<string, string>,
  compartmentMarksBySubjectName: Map<string, StudentMarkRow>,
): Map<string, StudentMarkRow> {
  const merged = new Map(originalMarksBySubjectId)
  for (const [subjectName, mark] of compartmentMarksBySubjectName) {
    const originalId = originalSubjectIdByName.get(subjectName)
    if (!originalId) continue
    merged.set(originalId, mark)
  }
  return merged
}

function averageGradePoint(outcomes: SubjectOutcome[]): number | null {
  const points = outcomes.map(o => o.grade_point).filter((p): p is number => p != null)
  if (!points.length) return null
  return Math.round((points.reduce((s, p) => s + p, 0) / points.length) * 100) / 100
}
