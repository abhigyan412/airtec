// DB-aware loaders that build the Map<key, rule> inputs
// resolveEffectiveClassRule()/resolveEffectiveSubjectRule() (in
// ./resultComputation, pure functions) expect. Kept separate from that
// file specifically so the resolution/computation logic itself stays
// DB-free and unit-testable without a database.
import { supabase } from '../../../shared/db/client'
import { EffectiveClassRule, EffectiveSubjectRule, GradeBand, RemarksBand } from './resultComputation'

async function loadGradeBands(scaleIds: string[]): Promise<Map<string, GradeBand[]>> {
  const map = new Map<string, GradeBand[]>()
  if (!scaleIds.length) return map
  const { data } = await supabase.from('exam_grade_bands').select('*').in('grade_scale_id', scaleIds).order('sort_order')
  for (const row of data ?? []) {
    if (!map.has(row.grade_scale_id)) map.set(row.grade_scale_id, [])
    map.get(row.grade_scale_id)!.push({
      min_percent: Number(row.min_percent),
      max_percent: Number(row.max_percent),
      grade_label: row.grade_label,
      grade_point: row.grade_point == null ? null : Number(row.grade_point),
      is_pass: row.is_pass,
    })
  }
  return map
}

async function loadRemarksBands(ruleIds: string[]): Promise<Map<string, RemarksBand[]>> {
  const map = new Map<string, RemarksBand[]>()
  if (!ruleIds.length) return map
  const { data } = await supabase.from('exam_remarks_bands').select('*').in('remarks_rule_id', ruleIds).order('sort_order')
  for (const row of data ?? []) {
    if (!map.has(row.remarks_rule_id)) map.set(row.remarks_rule_id, [])
    map.get(row.remarks_rule_id)!.push({
      match_status: row.match_status,
      min_percent: row.min_percent == null ? null : Number(row.min_percent),
      max_percent: row.max_percent == null ? null : Number(row.max_percent),
      remark_text: row.remark_text,
    })
  }
  return map
}

// Keys: "classId:examType" for a type-specific row, "classId:" (empty
// suffix) for the class default (exam_type IS NULL) — matches exactly
// what resolveEffectiveClassRule() looks up.
export async function loadClassRules(school_id: string, classIds: string[]): Promise<Map<string, EffectiveClassRule>> {
  const map = new Map<string, EffectiveClassRule>()
  const ids = [...new Set(classIds)]
  if (!ids.length) return map
  const { data: rows } = await supabase.from('exam_class_result_rules').select('*').eq('school_id', school_id).in('class_id', ids)
  if (!rows?.length) return map

  const scaleIds = [...new Set(rows.map(r => r.grade_scale_id).filter(Boolean))] as string[]
  const ruleIds = [...new Set(rows.map(r => r.remarks_rule_id).filter(Boolean))] as string[]
  const [gradeBandsByScale, remarksBandsByRule] = await Promise.all([loadGradeBands(scaleIds), loadRemarksBands(ruleIds)])

  for (const row of rows) {
    const rule: EffectiveClassRule = {
      promotion_policy: row.promotion_policy,
      pass_criteria_mode: row.pass_criteria_mode,
      pass_criteria_requires_aggregate: row.pass_criteria_requires_aggregate,
      aggregate_pass_percent: Number(row.aggregate_pass_percent),
      best_of_subjects_count: row.best_of_subjects_count,
      allow_additional_subject_substitution: row.allow_additional_subject_substitution,
      compartment_policy: row.compartment_policy,
      compartment_max_failed_subjects: row.compartment_max_failed_subjects,
      min_attendance_percent: row.min_attendance_percent == null ? null : Number(row.min_attendance_percent),
      max_grace_marks_per_subject: Number(row.max_grace_marks_per_subject),
      max_grace_marks_total: Number(row.max_grace_marks_total),
      rounding_mode: row.rounding_mode,
      rounding_decimals: row.rounding_decimals,
      grading_mode: row.grading_mode,
      grade_bands: row.grade_scale_id ? (gradeBandsByScale.get(row.grade_scale_id) ?? null) : null,
      remarks_bands: row.remarks_rule_id ? (remarksBandsByRule.get(row.remarks_rule_id) ?? null) : null,
    }
    map.set(`${row.class_id}:${row.exam_type ?? ''}`, rule)
  }
  return map
}

// Keys: "classId:examType:subjectName" / "classId::subjectName" (empty
// exam_type slot for the default) — matches resolveEffectiveSubjectRule().
export async function loadSubjectOverrides(school_id: string, classIds: string[]): Promise<Map<string, Partial<EffectiveSubjectRule>>> {
  const map = new Map<string, Partial<EffectiveSubjectRule>>()
  const ids = [...new Set(classIds)]
  if (!ids.length) return map
  const { data: rows } = await supabase.from('exam_subject_result_overrides').select('*').eq('school_id', school_id).in('class_id', ids)
  if (!rows?.length) return map

  const scaleIds = [...new Set(rows.map(r => r.grade_scale_id).filter(Boolean))] as string[]
  const gradeBandsByScale = await loadGradeBands(scaleIds)

  for (const row of rows) {
    const override: Partial<EffectiveSubjectRule> = {
      pass_criteria_mode: row.pass_criteria_mode ?? undefined,
      aggregate_pass_percent: row.aggregate_pass_percent == null ? undefined : Number(row.aggregate_pass_percent),
      grading_mode: row.grading_mode ?? undefined,
      grade_bands: row.grade_scale_id ? (gradeBandsByScale.get(row.grade_scale_id) ?? null) : undefined,
      is_additional: row.is_additional,
      include_in_aggregate: row.include_in_aggregate,
      subject_group_key: row.subject_group_key,
    }
    map.set(`${row.class_id}:${row.exam_type ?? ''}:${row.subject_name}`, override)
  }
  return map
}

// Keeps exam_subject_result_overrides.has_practical in sync with whatever a
// real exam_subjects row (or exam_template_subjects row) actually says, so
// Result Settings never drifts out of sync with the datesheet/template that
// "auto serves" it. No plain unique constraint exists on
// (school_id,class_id,exam_type,subject_name) to .upsert() against — only
// the two partial indexes above — so this uses the same
// check-then-update-or-insert pattern as PATCH /class-rules/:class_id.
// Touches ONLY has_practical: an admin's other configured fields on this
// override (pass_criteria_mode, grading_mode, subject_group_key, ...) are
// never overwritten by this sync.
export async function syncSubjectSplitOverride(
  school_id: string,
  class_id: string,
  exam_type: string | null,
  subject_name: string,
  hasPractical: boolean,
): Promise<void> {
  let existingQuery = supabase.from('exam_subject_result_overrides').select('id, has_practical')
    .eq('school_id', school_id).eq('class_id', class_id).eq('subject_name', subject_name)
  existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
  const { data: existing } = await existingQuery.maybeSingle()

  if (existing) {
    if (existing.has_practical === hasPractical) return
    await supabase.from('exam_subject_result_overrides')
      .update({ has_practical: hasPractical, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return
  }
  // Nothing to sync in the "not split" direction for a subject that has no
  // override row yet — has_practical already defaults to false, and
  // creating an empty row would just be settings-page clutter with no
  // configuration behind it.
  if (!hasPractical) return
  await supabase.from('exam_subject_result_overrides')
    .insert({ school_id, class_id, exam_type, subject_name, has_practical: true })
}

type MarksDefaults = {
  max_marks?: number | null; pass_marks?: number | null
  theory_max_marks?: number | null; theory_pass_marks?: number | null
  practical_max_marks?: number | null; practical_pass_marks?: number | null
}

// Fills exam_subject_result_overrides.default_{max,pass}_marks (or the
// theory/practical pair, when split) from whatever a real exam_subjects/
// exam_template_subjects row actually used — but ONLY into a field that's
// still null. Unlike syncSubjectSplitOverride's has_practical (a "current
// truth" flag, safe to always overwrite), a school's default marks are
// policy an admin may set deliberately in Result Settings — one exam
// happening to use a different total shouldn't silently redefine the
// school-wide default. Call this *after* syncSubjectSplitOverride in the
// same request so a freshly-inserted row is found here rather than raced
// into a second insert against the partial unique indexes.
export async function fillSubjectMarksDefaults(
  school_id: string,
  class_id: string,
  exam_type: string | null,
  subject_name: string,
  marks: MarksDefaults,
): Promise<void> {
  let existingQuery = supabase.from('exam_subject_result_overrides')
    .select('id, default_max_marks, default_pass_marks, default_theory_max_marks, default_theory_pass_marks, default_practical_max_marks, default_practical_pass_marks')
    .eq('school_id', school_id).eq('class_id', class_id).eq('subject_name', subject_name)
  existingQuery = exam_type ? existingQuery.eq('exam_type', exam_type) : existingQuery.is('exam_type', null)
  const { data: existing } = await existingQuery.maybeSingle()

  const fillable: [keyof MarksDefaults, string][] = [
    ['max_marks', 'default_max_marks'], ['pass_marks', 'default_pass_marks'],
    ['theory_max_marks', 'default_theory_max_marks'], ['theory_pass_marks', 'default_theory_pass_marks'],
    ['practical_max_marks', 'default_practical_max_marks'], ['practical_pass_marks', 'default_practical_pass_marks'],
  ]

  if (existing) {
    const patch: Record<string, number> = {}
    for (const [from, to] of fillable) {
      if ((existing as any)[to] == null && marks[from] != null) patch[to] = marks[from]!
    }
    if (!Object.keys(patch).length) return
    await supabase.from('exam_subject_result_overrides')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return
  }
  const insertRow: Record<string, any> = { school_id, class_id, exam_type, subject_name }
  for (const [from, to] of fillable) insertRow[to] = marks[from] ?? null
  await supabase.from('exam_subject_result_overrides').insert(insertRow)
}
