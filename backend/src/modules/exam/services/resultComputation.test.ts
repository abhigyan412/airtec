import { describe, it, expect } from 'vitest'
import {
  computeGrade, gradeForPercent, roundValue, computeReportCard, computeSubjectOutcome,
  resolveEffectiveClassRule, resolveEffectiveSubjectRule, applyBestOfN, applySubstitution,
  LEGACY_CLASS_RULE, LEGACY_SUBJECT_RULE, EffectiveClassRule, EffectiveSubjectRule,
  ExamSubjectRow, StudentMarkRow, GradeBand,
} from './resultComputation'

function subject(overrides: Partial<ExamSubjectRow> = {}): ExamSubjectRow {
  return {
    id: 's1', subject_name: 'Maths', max_marks: 100, pass_marks: 33,
    theory_max_marks: null, theory_pass_marks: null, practical_max_marks: null, practical_pass_marks: null,
    ...overrides,
  }
}

function mark(overrides: Partial<StudentMarkRow> = {}): StudentMarkRow {
  return {
    marks_obtained: 0, is_absent: false, theory_marks_obtained: null, practical_marks_obtained: null,
    theory_is_absent: false, practical_is_absent: false, grade: null, grace_marks_applied: 0,
    result_status_override: null,
    ...overrides,
  }
}

describe('computeGrade — legacy bands, must never change', () => {
  it.each([
    [95, 100, 'A+'], [85, 100, 'A'], [75, 100, 'B+'], [65, 100, 'B'],
    [55, 100, 'C'], [35, 100, 'D'], [20, 100, 'F'], [0, 100, 'F'],
  ])('%i/%i -> %s', (obtained, max, expected) => {
    expect(computeGrade(obtained, max)).toBe(expected)
  })
})

describe('gradeForPercent — falls back to computeGrade() when no scale', () => {
  it('matches computeGrade exactly with no bands', () => {
    expect(gradeForPercent(85, 100, null)).toEqual({ grade: 'A', grade_point: null, is_pass: true })
    expect(gradeForPercent(10, 100, null)).toEqual({ grade: 'F', grade_point: null, is_pass: false })
  })
  it('uses configured bands when given', () => {
    const bands: GradeBand[] = [
      { min_percent: 91, max_percent: 100, grade_label: 'A1', grade_point: 10, is_pass: true },
      { min_percent: 0, max_percent: 90.99, grade_label: 'A2', grade_point: 9, is_pass: true },
    ]
    expect(gradeForPercent(95, 100, bands)).toEqual({ grade: 'A1', grade_point: 10, is_pass: true })
  })
})

describe('roundValue', () => {
  it('nearest/0 decimals matches Math.round', () => {
    expect(roundValue(89.5, 'nearest', 0)).toBe(90)
    expect(roundValue(89.4, 'nearest', 0)).toBe(89)
  })
  it('floor and ceil', () => {
    expect(roundValue(89.9, 'floor', 0)).toBe(89)
    expect(roundValue(89.1, 'ceil', 0)).toBe(90)
  })
})

describe('resolveEffectiveClassRule', () => {
  const custom: EffectiveClassRule = { ...LEGACY_CLASS_RULE, aggregate_pass_percent: 40 }
  it('falls back to LEGACY_CLASS_RULE when nothing configured', () => {
    expect(resolveEffectiveClassRule(new Map(), 'c1', 'unit_test')).toBe(LEGACY_CLASS_RULE)
  })
  it('prefers an exact class+type row over the class default', () => {
    const map = new Map([['c1:', LEGACY_CLASS_RULE], ['c1:pre_board', custom]])
    expect(resolveEffectiveClassRule(map, 'c1', 'pre_board')).toBe(custom)
    expect(resolveEffectiveClassRule(map, 'c1', 'unit_test')).toBe(LEGACY_CLASS_RULE)
  })
})

describe('computeReportCard — byte-identical legacy fallback', () => {
  it('reproduces exam/routes.ts generate-results exactly for an unconfigured class', () => {
    const subjects = [
      subject({ id: 's1', subject_name: 'Maths', max_marks: 100, pass_marks: 33 }),
      subject({ id: 's2', subject_name: 'Science', max_marks: 100, pass_marks: 33 }),
    ]
    const marks = new Map([
      ['s1', mark({ marks_obtained: 89 })], // rounds to a fraction of 100 -> pct 89 alone would be non-integer combined
      ['s2', mark({ marks_obtained: 40 })],
    ])
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: LEGACY_CLASS_RULE,
      resolveSubjectRule: () => LEGACY_SUBJECT_RULE,
    })
    // total=200, obtained=129, pct = 64.5 -> Math.round = 65 (JS rounds .5 up)
    expect(result.total_marks).toBe(200)
    expect(result.obtained_marks).toBe(129)
    expect(result.percentage).toBe(65)
    expect(result.grade).toBe(computeGrade(129, 200))
    // passTotal = 33+33=66, obtained 129 >= 66 -> pass
    expect(result.is_pass).toBe(true)
    expect(result.remarks).toBe('Promoted')
    expect(result.remarks_source).toBe('legacy')
  })

  it('fails and says Detained when below the legacy pass_marks sum', () => {
    const subjects = [subject({ id: 's1', max_marks: 100, pass_marks: 33 })]
    const marks = new Map([['s1', mark({ marks_obtained: 10 })]])
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: LEGACY_CLASS_RULE,
      resolveSubjectRule: () => LEGACY_SUBJECT_RULE,
    })
    expect(result.is_pass).toBe(false)
    expect(result.remarks).toBe('Detained')
  })

  it('a subject with no marks row at all still counts toward total_marks but contributes zero (legacy behavior)', () => {
    const subjects = [subject({ id: 's1', max_marks: 100, pass_marks: 33 }), subject({ id: 's2', max_marks: 100, pass_marks: 33 })]
    const marks = new Map([['s1', mark({ marks_obtained: 90 })]]) // s2 has no row
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: LEGACY_CLASS_RULE,
      resolveSubjectRule: () => LEGACY_SUBJECT_RULE,
    })
    expect(result.total_marks).toBe(200)
    expect(result.obtained_marks).toBe(90)
  })
})

describe('computeReportCard — no_detention', () => {
  it('forces pass/Promoted regardless of marks, but keeps the real percentage', () => {
    const rule: EffectiveClassRule = { ...LEGACY_CLASS_RULE, promotion_policy: 'no_detention' }
    const subjects = [subject({ id: 's1', max_marks: 100, pass_marks: 33 })]
    const marks = new Map([['s1', mark({ marks_obtained: 5 })]])
    const result = computeReportCard({ subjects, marksBySubjectId: marks, classRule: rule, resolveSubjectRule: () => LEGACY_SUBJECT_RULE })
    expect(result.percentage).toBe(5)
    expect(result.is_pass).toBe(true)
    expect(result.result_status).toBe('pass')
  })
})

describe('computeReportCard — per_subject pass criteria', () => {
  const rule: EffectiveClassRule = { ...LEGACY_CLASS_RULE, pass_criteria_mode: 'per_subject', aggregate_pass_percent: 33 }
  it('fails overall if any one subject misses its own pass mark, even with a strong aggregate', () => {
    const subjects = [
      subject({ id: 's1', subject_name: 'Maths', max_marks: 100, pass_marks: 33 }),
      subject({ id: 's2', subject_name: 'Science', max_marks: 100, pass_marks: 33 }),
    ]
    const marks = new Map([
      ['s1', mark({ marks_obtained: 95 })],
      ['s2', mark({ marks_obtained: 10 })], // fails its own pass mark
    ])
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: rule,
      resolveSubjectRule: () => ({ ...LEGACY_SUBJECT_RULE, pass_criteria_mode: 'per_subject' }),
    })
    expect(result.percentage).toBe(53) // (95+10)/200
    expect(result.is_pass).toBe(false)
  })
})

describe('computeSubjectOutcome — theory + practical split', () => {
  it('sums both components and enforces them separately under per_subject mode', () => {
    const s = subject({ id: 's1', max_marks: 100, pass_marks: 33, theory_max_marks: 70, theory_pass_marks: 25, practical_max_marks: 30, practical_pass_marks: 10 })
    const rule: EffectiveSubjectRule = { ...LEGACY_SUBJECT_RULE, pass_criteria_mode: 'per_subject' }
    const passing = computeSubjectOutcome(s, mark({ theory_marks_obtained: 30, practical_marks_obtained: 15 }), rule)
    expect(passing.obtained_marks).toBe(45)
    expect(passing.is_pass).toBe(true)

    // Aggregate total (45) clears pass_marks (33), but practical (5) misses its own pass mark (10).
    const failingPractical = computeSubjectOutcome(s, mark({ theory_marks_obtained: 40, practical_marks_obtained: 5 }), rule)
    expect(failingPractical.obtained_marks).toBe(45)
    expect(failingPractical.is_pass).toBe(false)
  })
})

describe('computeSubjectOutcome — grade_only excluded from aggregate', () => {
  it('contributes zero marks/max but still returns a grade', () => {
    const s = subject({ id: 's1', subject_name: 'Art' })
    const bands: GradeBand[] = [{ min_percent: 0, max_percent: 100, grade_label: 'A', grade_point: null, is_pass: true }]
    const rule: EffectiveSubjectRule = { ...LEGACY_SUBJECT_RULE, grading_mode: 'grade_only', grade_bands: bands }
    const outcome = computeSubjectOutcome(s, mark({ grade: 'A' }), rule)
    expect(outcome.max_marks).toBe(0)
    expect(outcome.obtained_marks).toBe(0)
    expect(outcome.grade).toBe('A')
    expect(outcome.include_in_aggregate).toBe(false)
  })
})

describe('applyBestOfN', () => {
  it('drops the lowest-scoring subjects beyond N from the aggregate', () => {
    const outcomes = [
      { exam_subject_id: 'a', subject_name: 'A', max_marks: 100, obtained_marks: 90, is_pass: true, grade: null, grade_point: null, is_additional: false, include_in_aggregate: true, subject_group_key: null, status_override: null },
      { exam_subject_id: 'b', subject_name: 'B', max_marks: 100, obtained_marks: 30, is_pass: true, grade: null, grade_point: null, is_additional: false, include_in_aggregate: true, subject_group_key: null, status_override: null },
      { exam_subject_id: 'c', subject_name: 'C', max_marks: 100, obtained_marks: 60, is_pass: true, grade: null, grade_point: null, is_additional: false, include_in_aggregate: true, subject_group_key: null, status_override: null },
    ]
    const result = applyBestOfN(outcomes, 2)
    expect(result.find(o => o.exam_subject_id === 'a')!.include_in_aggregate).toBe(true)
    expect(result.find(o => o.exam_subject_id === 'c')!.include_in_aggregate).toBe(true)
    expect(result.find(o => o.exam_subject_id === 'b')!.include_in_aggregate).toBe(false)
  })
  it('is a no-op when n is null', () => {
    const outcomes = [{ exam_subject_id: 'a', subject_name: 'A', max_marks: 100, obtained_marks: 90, is_pass: true, grade: null, grade_point: null, is_additional: false, include_in_aggregate: true, subject_group_key: null, status_override: null }]
    expect(applyBestOfN(outcomes, null)).toEqual(outcomes)
  })
})

describe('applySubstitution', () => {
  it('replaces a failed compulsory subject with a passing additional one', () => {
    const outcomes = [
      { exam_subject_id: 'compulsory', subject_name: 'Sanskrit', max_marks: 100, obtained_marks: 10, is_pass: false, grade: null, grade_point: null, is_additional: false, include_in_aggregate: true, subject_group_key: null, status_override: null },
      { exam_subject_id: 'additional', subject_name: 'IT', max_marks: 100, obtained_marks: 88, is_pass: true, grade: null, grade_point: null, is_additional: true, include_in_aggregate: true, subject_group_key: null, status_override: null },
    ]
    const result = applySubstitution(outcomes, true)
    const compulsory = result.find(o => o.exam_subject_id === 'compulsory')!
    expect(compulsory.obtained_marks).toBe(88)
    expect(compulsory.is_pass).toBe(true)
  })
})

describe('computeReportCard — compartment', () => {
  it('marks compartment instead of a flat fail when within the allowed failed-subject count', () => {
    const rule: EffectiveClassRule = {
      ...LEGACY_CLASS_RULE, pass_criteria_mode: 'per_subject', aggregate_pass_percent: 33,
      compartment_policy: 'allow', compartment_max_failed_subjects: 1,
    }
    const subjects = [
      subject({ id: 's1', subject_name: 'Maths', max_marks: 100, pass_marks: 33 }),
      subject({ id: 's2', subject_name: 'Science', max_marks: 100, pass_marks: 33 }),
    ]
    const marks = new Map([
      ['s1', mark({ marks_obtained: 80 })],
      ['s2', mark({ marks_obtained: 10 })],
    ])
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: rule,
      resolveSubjectRule: () => ({ ...LEGACY_SUBJECT_RULE, pass_criteria_mode: 'per_subject' }),
    })
    expect(result.result_status).toBe('compartment')
    expect(result.is_pass).toBe(false)
  })
})

describe('computeReportCard — attendance eligibility', () => {
  it('short-circuits to not_eligible below the minimum, ignoring marks entirely', () => {
    const rule: EffectiveClassRule = { ...LEGACY_CLASS_RULE, min_attendance_percent: 75 }
    const subjects = [subject({ id: 's1', max_marks: 100, pass_marks: 33 })]
    const marks = new Map([['s1', mark({ marks_obtained: 95 })]])
    const result = computeReportCard({
      subjects, marksBySubjectId: marks, classRule: rule,
      resolveSubjectRule: () => LEGACY_SUBJECT_RULE, attendancePercent: 60,
    })
    expect(result.result_status).toBe('not_eligible')
    expect(result.is_pass).toBe(false)
  })
})
