// Board presets — a one-time "apply and edit" convenience, never a live
// binding. Applying one only ever populates the SAME fields a human could
// set by hand through Result Settings' Class Rules tab (the class-default
// row, exam_type=null — never a type-specific override, since a preset
// can't anticipate a school's own exam-type usage). Every field stays
// fully editable afterward; the engine itself never branches on which
// preset (if any) was applied.

export type PresetKey = 'cbse_up_to_8' | 'cbse_9_10' | 'cbse_11_12' | 'icse' | 'generic'

export interface ResultPreset {
  key: PresetKey
  name: string
  description: string
  // Informational only (shown in the UI to suggest which classes to
  // select) — numeric_level range, matching the Nursery=-2..Class 12=12
  // convention used everywhere else in this app.
  classRange: { min: number; max: number }
  rule: {
    promotion_policy: 'standard' | 'no_detention'
    pass_criteria_mode: 'aggregate' | 'per_subject'
    pass_criteria_requires_aggregate: boolean
    aggregate_pass_percent: number
    grading_mode: 'marks' | 'grade_only' | 'cgpa'
    // Name of a system (school_id IS NULL) exam_grade_scales row to
    // resolve to a real grade_scale_id at apply time — never a raw id,
    // since ids aren't known until the Phase 1 seed migration has run.
    gradeScaleName?: string
  }
}

export const RESULT_PRESETS: ResultPreset[] = [
  {
    key: 'cbse_up_to_8',
    name: 'CBSE — Up to Class 8',
    description: 'RTE no-detention — every student is promoted regardless of marks. Real marks/percentage still shown.',
    classRange: { min: -2, max: 8 },
    rule: {
      promotion_policy: 'no_detention',
      pass_criteria_mode: 'aggregate',
      pass_criteria_requires_aggregate: true,
      aggregate_pass_percent: 33,
      grading_mode: 'marks',
    },
  },
  {
    key: 'cbse_9_10',
    name: 'CBSE — Classes 9–10',
    description: 'Must pass every subject individually, graded on CBSE\'s 9-point CGPA scale.',
    classRange: { min: 9, max: 10 },
    rule: {
      promotion_policy: 'standard',
      pass_criteria_mode: 'per_subject',
      pass_criteria_requires_aggregate: true,
      aggregate_pass_percent: 33,
      grading_mode: 'cgpa',
      gradeScaleName: 'CBSE 9-Point CGPA',
    },
  },
  {
    key: 'cbse_11_12',
    name: 'CBSE — Classes 11–12',
    description: 'Must pass every subject individually. Marks/percentage-based — CBSE does not issue CGPA at this level.',
    classRange: { min: 11, max: 12 },
    rule: {
      promotion_policy: 'standard',
      pass_criteria_mode: 'per_subject',
      pass_criteria_requires_aggregate: true,
      aggregate_pass_percent: 33,
      grading_mode: 'marks',
    },
  },
  {
    key: 'icse',
    name: 'ICSE / ISC — All Classes',
    description: 'Must pass every subject individually. Marks/percentage throughout — no CGPA at any level.',
    classRange: { min: -2, max: 12 },
    rule: {
      promotion_policy: 'standard',
      pass_criteria_mode: 'per_subject',
      pass_criteria_requires_aggregate: true,
      aggregate_pass_percent: 33,
      grading_mode: 'marks',
    },
  },
  {
    key: 'generic',
    name: 'Generic (Legacy Defaults)',
    description: 'The same aggregate-only, sum-of-pass-marks behavior every class already had before Result Settings existed — an explicit, editable starting point rather than the invisible fallback.',
    classRange: { min: -2, max: 12 },
    rule: {
      promotion_policy: 'standard',
      pass_criteria_mode: 'aggregate',
      pass_criteria_requires_aggregate: true,
      aggregate_pass_percent: 33,
      grading_mode: 'marks',
    },
  },
]
