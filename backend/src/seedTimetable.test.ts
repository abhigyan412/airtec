import { describe, it, expect } from 'vitest'
import {
  buildTimetable, benchFor, splitWeeklyPeriods,
  subjectsFor, shapeFor, planFor, SCHOOL_DAYS, WEEKLY_TEACHING_PERIODS, STREAM_PLANS,
  LayoutSection,
} from './seedTimetable'

// ═══════════════════════════════════════════════════════════════
// The demo timetable must satisfy the invariants the module relies on.
// ═══════════════════════════════════════════════════════════════
//
// Run at the real size — 47 sections, 1,786 periods a week — because the
// bug this replaces only appears under pressure. The old seed picked
// whichever teacher happened to be free for each individual slot, which
// never double-booked anyone and therefore looked correct, while quietly
// giving Class 5A three different Maths teachers in a week. Nothing in
// the seed noticed. The workload page and the substitute ranking would
// have been the first to find out, in front of a school.

// The curriculum and day shapes are imported, not copied. An earlier
// draft mirrored them here and that is exactly how a test stops testing
// anything: change the school day in seed.ts, and a duplicated copy keeps
// asserting the old one is fine.

const DAYS = SCHOOL_DAYS
const PERIODS_PER_WEEK = WEEKLY_TEACHING_PERIODS

/** Nursery/LKG/UKG + Classes 1–10 with A/B/C, and 11–12 by stream. */
function demoSections(): LayoutSection[] {
  const out: LayoutSection[] = []
  const levels = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const level of levels) {
    for (const name of ['A', 'B', 'C']) {
      out.push({ id: `sec-${level}-${name}`, classId: `cls-${level}`, name, level })
    }
  }
  for (const level of [11, 12]) {
    for (const name of Object.keys(STREAM_PLANS)) {
      out.push({ id: `sec-${level}-${name}`, classId: `cls-${level}`, name, level })
    }
  }
  return out
}

function demoTeachers(sections: LayoutSection[]) {
  return benchFor(sections, subjectsFor, PERIODS_PER_WEEK)
    .map((m, i) => ({ id: `t-${i}`, subject: m.subject, minLevel: m.minLevel, maxLevel: m.maxLevel }))
}

describe('splitWeeklyPeriods', () => {
  it('adds up to exactly the week', () => {
    for (const count of [1, 2, 5, 6, 7]) {
      const total = Array.from({ length: count }, (_, i) => splitWeeklyPeriods(38, count, i))
        .reduce((a, b) => a + b, 0)
      expect(total, `${count} subjects`).toBe(38)
    }
  })

  it('hands the remainder to the earliest subjects', () => {
    expect([0, 1, 2, 3, 4, 5].map(i => splitWeeklyPeriods(38, 6, i))).toEqual([7, 7, 6, 6, 6, 6])
  })
})

describe('benchFor', () => {
  const sections = demoSections()
  const bench = benchFor(sections, subjectsFor, PERIODS_PER_WEEK)

  it('hires enough teachers to leave real free time', () => {
    const totalPeriods = sections.reduce((sum, s) => sum + PERIODS_PER_WEEK, 0)
    const utilisation = totalPeriods / (bench.length * PERIODS_PER_WEEK)
    // The old hand-tuned pool of 50 sat at 94%, which is both
    // unschedulable and leaves nobody free to cover an absence.
    expect(utilisation).toBeLessThan(0.75)
    expect(utilisation).toBeGreaterThan(0.5)
  })

  it('covers every subject the curriculum teaches', () => {
    const taught = new Set(sections.flatMap(s => subjectsFor(s.level, s.name)))
    const covered = new Set(bench.map(b => b.subject))
    for (const subject of taught) {
      expect(covered.has(subject), `no teacher for ${subject}`).toBe(true)
    }
  })

  it('sizes each bench against its own demand', () => {
    const count = (s: string) => bench.filter(b => b.subject === s).length
    // English is taught in all 47 sections; Biology in two.
    expect(count('English')).toBeGreaterThan(count('Biology'))
    expect(count('English')).toBeGreaterThan(count('Physics'))
  })
})

describe('buildTimetable at the demo school’s real size', () => {
  const sections = demoSections()
  const teachers = demoTeachers(sections)
  const result = buildTimetable({ sections, teachers, subjectsFor, shapeFor, days: DAYS })
  const d = result.diagnostics

  it('builds the school we expect', () => {
    expect(sections).toHaveLength(47)
    expect(teachers.length).toBeGreaterThan(60)
    expect(d.totalPeriods).toBe(47 * PERIODS_PER_WEEK)
  })

  // ── the invariants ────────────────────────────────────────

  it('never puts a teacher in two rooms at once', () => {
    expect(d.doubleBooked).toBe(0)
  })

  it('gives each section+subject exactly one teacher', () => {
    // The invariant the whole module rests on. The old seed broke it
    // silently, which is the bug this file exists to prevent recurring.
    expect(d.multiTeacherSectionSubjects).toBe(0)
  })

  it('leaves no period unstaffed', () => {
    expect(d.unfilled).toBe(0)
  })

  it('delivers every section its full weekly quota of every subject', () => {
    expect(d.quotaShortfalls).toBe(0)
  })

  it('numbers teaching periods 1..N with no gaps', () => {
    for (const day of DAYS) {
      const numbers = new Set(result.entries.filter(e => e.day === day).map(e => e.periodNumber))
      const expected = shapeFor(day).filter(s => s.kind === 'period').length
      expect(numbers.size, `day ${day}`).toBe(expected)
      for (let n = 1; n <= expected; n++) expect(numbers.has(n), `day ${day} period ${n}`).toBe(true)
    }
  })

  it('keeps breaks clear of the teaching numbers', () => {
    const teaching = new Set(result.entries.map(e => e.periodNumber))
    for (const b of result.breaks) expect(teaching.has(b.periodNumber)).toBe(false)
  })

  // ── quality, not just correctness ─────────────────────────

  it('spreads the load instead of exhausting a few', () => {
    expect(d.loads.min).toBeGreaterThan(0)
    // Nobody at 100%: cover is impossible if every teacher is always busy,
    // which would make the arrangements screen useless on a demo.
    expect(d.loads.max).toBeLessThan(PERIODS_PER_WEEK)
    expect(d.utilisation).toBeLessThan(0.8)
  })

  it('leaves somebody free in every single slot', () => {
    // If no teacher is free in some period, an absence in that period can
    // never be covered and the ranking ladder returns an empty list.
    const busy = new Map<string, Set<string>>()
    for (const e of result.entries) {
      const key = `${e.day}|${e.periodNumber}`
      const set = busy.get(key) ?? new Set<string>()
      set.add(e.teacherId)
      busy.set(key, set)
    }
    for (const [slot, set] of busy) {
      expect(teachers.length - set.size, `nobody free at ${slot}`).toBeGreaterThan(3)
    }
  })

  it('repeats a subject within a day only about as often as it must', () => {
    // Repeats are arithmetic, not a defect, and there are two independent
    // reasons for them:
    //
    //   * a subject with more weekly periods than there are days has to
    //     appear twice on some day — Mathematics at 8 periods over a
    //     6-day week cannot avoid it;
    //   * a section with fewer subjects than periods in a day has to
    //     repeat something to fill the day.
    //
    // The first dominates here. An earlier version of this test counted
    // only the second, put the floor at 204 against an unavoidable ~315,
    // and failed for a reason that had nothing to do with the layout.
    let floor = 0
    for (const section of sections) {
      const plan = planFor(section.level, section.name)
      for (const subject of plan) {
        floor += Math.max(0, subject.periods - DAYS.length)
      }
    }
    expect(floor).toBeGreaterThan(0)
    // Within 20% of unavoidable.
    expect(d.repeatedInDay).toBeLessThanOrEqual(Math.ceil(floor * 1.2))
  })

  it('gives every teacher something to teach', () => {
    const withWork = new Set(result.entries.map(e => e.teacherId))
    // A teacher with an empty timetable breaks "my week" and shows up as a
    // phantom on the workload report.
    expect(teachers.length - withWork.size).toBeLessThanOrEqual(2)
  })

  it('is deterministic', () => {
    const again = buildTimetable({ sections, teachers, subjectsFor, shapeFor, days: DAYS })
    expect(again.entries).toEqual(result.entries)
    expect(again.plan).toEqual(result.plan)
  })
})

describe('buildTimetable under pressure', () => {
  it('reports unfilled slots rather than double-booking when staff are short', () => {
    const sections = demoSections().slice(0, 10)
    // Deliberately far too few teachers to staff ten sections at once.
    const teachers = [{ id: 't1', subject: 'English' }, { id: 't2', subject: 'Hindi' }]
    const result = buildTimetable({ sections, teachers, subjectsFor, shapeFor, days: DAYS })

    expect(result.diagnostics.unfilled).toBeGreaterThan(0)
    // The failure mode must be an honest hole, never a teacher in two
    // places — the seed prints the count so it cannot pass unnoticed.
    expect(result.diagnostics.doubleBooked).toBe(0)
    expect(result.diagnostics.multiTeacherSectionSubjects).toBe(0)
  })

  it('handles a school with a single section', () => {
    const sections: LayoutSection[] = [{ id: 's', classId: 'c', name: 'A', level: 3 }]
    const teachers = demoTeachers(sections)
    const result = buildTimetable({ sections, teachers, subjectsFor, shapeFor, days: DAYS })
    expect(result.diagnostics.unfilled).toBe(0)
    expect(result.diagnostics.quotaShortfalls).toBe(0)
  })
})
