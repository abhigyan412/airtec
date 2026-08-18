import { describe, it, expect } from 'vitest'
import { rankCandidates, DayState, TeacherState } from './arrangements'

// ═══════════════════════════════════════════════════════════════
// The substitute ranking ladder.
// ═══════════════════════════════════════════════════════════════
//
// rankCandidates is a pure function of a day snapshot, which is the
// whole reason it is shaped that way — this is the logic that decides
// who stands in front of a class at nine in the morning, and it should
// be provable without a database.
//
// The scenario throughout is the one from the real school these rules
// were derived from: a handful of heavily-loaded class teachers and a
// couple of lightly-loaded specialists. Left to "whoever is free", every
// absence in the school lands on the same two people, and one of them
// teaches Dance.

const MATHS = 'subject-maths'
const DANCE = 'subject-dance'
const SECTION = 'section-8a'

function teacher(overrides: Partial<TeacherState> & { id: string; fullName: string }): TeacherState {
  return {
    busyPeriods: new Set(),
    coveringPeriods: new Set(),
    totalToday: 0,
    freeToday: 8,
    arrangementsThisMonth: 0,
    didArrangementYesterday: false,
    arrangementsThisWeek: 0,
    constraint: {
      maxPerDay: 8, maxConsecutive: 4, arrangementCapDay: 2,
      arrangementCapWeek: 6, exempt: false, blocked: new Set<string>(),
    },
    capabilities: new Map(),
    teachesSections: new Set(),
    classTeacherOf: new Set(),
    ...overrides,
  }
}

function day(teachers: TeacherState[], overrides: Partial<DayState> = {}): DayState {
  return {
    state: new Map(teachers.map(t => [t.id, t])),
    absentToday: new Set<string>(),
    bookings: new Map<string, string>(),
    dow: 1,
    periodsPerDay: 8,
    // subject id -> normalised name, so a capability recorded against one
    // class's copy of "Mathematics" still matches another class's period.
    subjectNameOf: new Map<string, string>([[MATHS, 'maths'], [DANCE, 'dance']]),
    ...overrides,
  } as DayState
}

const REQUEST = {
  period_number: 3,
  section_id: SECTION,
  subject_id: MATHS,
  absent_teacher_id: 'absent-teacher',
}

describe('substitute ranking', () => {
  it('puts a subject specialist above someone who is merely free', () => {
    const specialist = teacher({
      id: 'maths', fullName: 'Krishna',
      capabilities: new Map([[MATHS, { priority: 1, min: null, max: null }]]),
    })
    const anyone = teacher({ id: 'dance', fullName: 'Ayushi' })

    const ranked = rankCandidates(day([specialist, anyone]), REQUEST, 8)

    expect(ranked.map(c => c.fullName)).toEqual(['Krishna', 'Ayushi'])
    expect(ranked[0].reasons).toContain('Teaches this subject')
  })

  it('ranks primary above secondary above tertiary capability', () => {
    const ranked = rankCandidates(day([
      teacher({ id: 'c', fullName: 'Tertiary', capabilities: new Map([[MATHS, { priority: 3, min: null, max: null }]]) }),
      teacher({ id: 'a', fullName: 'Primary', capabilities: new Map([[MATHS, { priority: 1, min: null, max: null }]]) }),
      teacher({ id: 'b', fullName: 'Secondary', capabilities: new Map([[MATHS, { priority: 2, min: null, max: null }]]) }),
    ]), REQUEST, 8)

    expect(ranked.map(c => c.fullName)).toEqual(['Primary', 'Secondary', 'Tertiary'])
  })

  it('warns when the subject is right but the class level is not', () => {
    // A primary-school Maths teacher is not the answer for Class VIII,
    // even though the subject matches.
    const primaryOnly = teacher({
      id: 'prt', fullName: 'Heena',
      capabilities: new Map([[MATHS, { priority: 1, min: 1, max: 5 }]]),
    })

    const ranked = rankCandidates(day([primaryOnly]), REQUEST, 8)

    expect(ranked[0].warnings).toContain('Outside the class levels they normally teach')
    expect(ranked[0].reasons).not.toContain('Teaches this class level')
  })

  it('prefers a teacher the class already knows', () => {
    const stranger = teacher({ id: 'x', fullName: 'Stranger' })
    const knownFace = teacher({ id: 'y', fullName: 'Known Face', teachesSections: new Set([SECTION]) })
    const classTeacher = teacher({ id: 'z', fullName: 'Class Teacher', classTeacherOf: new Set([SECTION]) })

    const ranked = rankCandidates(day([stranger, knownFace, classTeacher]), REQUEST, 8)

    expect(ranked.map(c => c.fullName)).toEqual(['Known Face', 'Class Teacher', 'Stranger'])
  })

  // ── fairness ──────────────────────────────────────────────────

  it('spreads cover rather than returning to the same person', () => {
    // Identical in every way except how much cover they have already
    // done this month. Without this the six teachers with slack absorb
    // every absence in the school.
    const overused = teacher({ id: 'a', fullName: 'Overused', arrangementsThisMonth: 8 })
    const fresh = teacher({ id: 'b', fullName: 'Fresh', arrangementsThisMonth: 0 })

    const ranked = rankCandidates(day([overused, fresh]), REQUEST, 8)

    expect(ranked[0].fullName).toBe('Fresh')
  })

  it('protects whoever is already having a heavy day', () => {
    const busy = teacher({ id: 'a', fullName: 'Busy', totalToday: 6, freeToday: 2, busyPeriods: new Set([1, 2, 4, 5, 6, 7]) })
    const light = teacher({ id: 'b', fullName: 'Light', totalToday: 2, freeToday: 6, busyPeriods: new Set([1, 7]) })

    const ranked = rankCandidates(day([busy, light]), REQUEST, 8)

    expect(ranked[0].fullName).toBe('Light')
  })

  it('rotates away from yesterday', () => {
    const yesterdaysVolunteer = teacher({ id: 'a', fullName: 'Yesterday', didArrangementYesterday: true })
    const rested = teacher({ id: 'b', fullName: 'Rested' })

    const ranked = rankCandidates(day([yesterdaysVolunteer, rested]), REQUEST, 8)

    expect(ranked[0].fullName).toBe('Rested')
  })

  it('flags taking a teacher’s only free period of the day', () => {
    // Modelled on a real teacher at the school this was built for:
    // 48 periods a week, eight a day, one free period. Her maxConsecutive
    // is 8 because that is what the importer seeded from her actual
    // timetable — with the generic default of 4 she would be filtered out
    // before the warning could ever be reached, which is exactly why the
    // limits are seeded per teacher rather than set from a textbook.
    const oneFreePeriod = teacher({
      id: 'a', fullName: 'Basundhara',
      busyPeriods: new Set([1, 2, 4, 5, 6, 7, 8]), totalToday: 7, freeToday: 1,
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, maxConsecutive: 8 },
    })

    const ranked = rankCandidates(day([oneFreePeriod]), REQUEST, 8)

    expect(ranked[0].warnings).toContain('This is their only free period today')
  })

  it('filters a teacher out entirely when the generic limits do apply', () => {
    // The same person under the default maxConsecutive of 4: taking
    // period 3 would join her whole day into one eight-period block, so
    // she is not offered at all rather than merely warned about.
    const sameTeacherDefaultLimits = teacher({
      id: 'a', fullName: 'Basundhara',
      busyPeriods: new Set([1, 2, 4, 5, 6, 7, 8]), totalToday: 7, freeToday: 1,
    })

    expect(rankCandidates(day([sameTeacherDefaultLimits]), REQUEST, 8)).toEqual([])
  })

  // ── hard filters ──────────────────────────────────────────────

  it('never offers someone who is teaching in that period', () => {
    const teaching = teacher({ id: 'a', fullName: 'Teaching', busyPeriods: new Set([3]) })
    const free = teacher({ id: 'b', fullName: 'Free' })

    const ranked = rankCandidates(day([teaching, free]), REQUEST, 8)

    expect(ranked.map(c => c.fullName)).toEqual(['Free'])
  })

  it('never offers someone already covering that period', () => {
    // The multi-absence case: five teachers out on one Monday must not
    // all be offered the same substitute for the same period.
    const alreadyCovering = teacher({ id: 'a', fullName: 'Covering', coveringPeriods: new Set([3]) })

    expect(rankCandidates(day([alreadyCovering]), REQUEST, 8)).toEqual([])
  })

  it('never offers someone who is absent', () => {
    const absent = teacher({ id: 'a', fullName: 'Absent' })
    const present = teacher({ id: 'b', fullName: 'Present' })

    const ranked = rankCandidates(
      day([absent, present], { absentToday: new Set(['a']) }), REQUEST, 8)

    expect(ranked.map(c => c.fullName)).toEqual(['Present'])
  })

  it('never offers the absent teacher their own class back', () => {
    const self = teacher({ id: 'absent-teacher', fullName: 'The Absentee' })
    expect(rankCandidates(day([self]), REQUEST, 8)).toEqual([])
  })

  it('respects a personal unavailability window', () => {
    const cannotDoMondayThird = teacher({
      id: 'a', fullName: 'Commuter',
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, blocked: new Set(['1:3']) },
    })

    expect(rankCandidates(day([cannotDoMondayThird]), REQUEST, 8)).toEqual([])
  })

  it('holds back someone at their daily teaching limit', () => {
    const atLimit = teacher({
      id: 'a', fullName: 'At Limit', totalToday: 6, freeToday: 2,
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, maxPerDay: 6 },
    })

    expect(rankCandidates(day([atLimit]), REQUEST, 8)).toEqual([])

    const [shown] = rankCandidates(day([atLimit]), REQUEST, 8, { includeIneligible: true })
    expect(shown.warnings).toContain('Already at their daily limit of 6 periods')
  })

  it('holds back someone at their weekly cover cap', () => {
    const capped = teacher({
      id: 'a', fullName: 'Capped', arrangementsThisWeek: 6,
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, arrangementCapWeek: 6 },
    })
    expect(rankCandidates(day([capped]), REQUEST, 8)).toEqual([])
  })

  it('refuses a placement that would make too long a run', () => {
    // Free in period 3, but taking it joins periods 1-2 and 4-5 into a
    // five-period block.
    const wouldOverrun = teacher({
      id: 'a', fullName: 'Marathon',
      busyPeriods: new Set([1, 2, 4, 5]), totalToday: 4, freeToday: 4,
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, maxConsecutive: 4 },
    })

    expect(rankCandidates(day([wouldOverrun]), REQUEST, 8)).toEqual([])

    const [shown] = rankCandidates(day([wouldOverrun]), REQUEST, 8, { includeIneligible: true })
    expect(shown.warnings).toContain('Would put them on 5 periods back to back')
  })

  it('honours an exemption', () => {
    const exempt = teacher({
      id: 'a', fullName: 'Exempt',
      constraint: { ...teacher({ id: 'x', fullName: 'x' }).constraint, exempt: true },
    })
    expect(rankCandidates(day([exempt]), REQUEST, 8)).toEqual([])
  })

  // ── booked free periods ───────────────────────────────────────

  it('hides a reserved free period from the ordinary manager', () => {
    const reserved = teacher({ id: 'a', fullName: 'Reserved' })
    const ranked = rankCandidates(
      day([reserved], { bookings: new Map([['a:3', 'copy_correction']]) }), REQUEST, 8)

    expect(ranked).toEqual([])
  })

  it('offers a reserved period to a principal, but only as a last resort', () => {
    const reserved = teacher({
      id: 'a', fullName: 'Reserved',
      capabilities: new Map([[MATHS, { priority: 1, min: null, max: null }]]),
    })
    const plain = teacher({ id: 'b', fullName: 'Plain' })

    const ranked = rankCandidates(
      day([reserved, plain], { bookings: new Map([['a:3', 'copy_correction']]) }),
      REQUEST, 8, { canOverrideBooking: true })

    // Subject specialist, and still ranked below someone with no
    // qualification at all — that is the −1000 doing its job.
    expect(ranked.map(c => c.fullName)).toEqual(['Plain', 'Reserved'])
    const reservedResult = ranked.find(c => c.fullName === 'Reserved')!
    expect(reservedResult.hasBooking).toBe(true)
    expect(reservedResult.warnings.some(w => w.includes('copy correction'))).toBe(true)
  })

  // ── the whole picture ─────────────────────────────────────────

  it('produces the ordering the school would produce by hand', () => {
    // Class VIII Maths needs cover in period 3.
    const candidates = [
      // The other Maths teacher for this year group. Obvious answer.
      teacher({
        id: 'krishna', fullName: 'Krishna',
        capabilities: new Map([[MATHS, { priority: 1, min: 6, max: 8 }]]),
        totalToday: 5, freeToday: 3, arrangementsThisMonth: 1,
      }),
      // Teaches this section, but Science. Knows the room.
      teacher({
        id: 'basundhara', fullName: 'Basundhara',
        teachesSections: new Set([SECTION]),
        totalToday: 7, freeToday: 1, arrangementsThisMonth: 0,
      }),
      // Dance specialist. Free all week, and has been covering everything.
      teacher({
        id: 'ayushi', fullName: 'Ayushi',
        capabilities: new Map([[DANCE, { priority: 1, min: null, max: null }]]),
        totalToday: 1, freeToday: 7, arrangementsThisMonth: 9,
      }),
    ]

    const ranked = rankCandidates(day(candidates), REQUEST, 8)

    expect(ranked[0].fullName).toBe('Krishna')
    expect(ranked[0].reasons).toContain('Teaches this subject')
    expect(ranked[0].reasons).toContain('Teaches this class level')

    // Ayushi is the freest person in the school and still not the pick,
    // because she has covered nine periods this month and cannot teach
    // Maths. That inversion is the entire point of the ladder.
    expect(ranked[ranked.length - 1].fullName).toBe('Ayushi')
  })

  it('gives every candidate a reason a human can read out', () => {
    const ranked = rankCandidates(day([
      teacher({
        id: 'a', fullName: 'Krishna',
        capabilities: new Map([[MATHS, { priority: 1, min: null, max: null }]]),
        totalToday: 3, arrangementsThisMonth: 2,
      }),
    ]), REQUEST, 8)

    expect(ranked[0].reasons).toEqual([
      'Teaches this subject',
      'Teaches this class level',
      '2 arrangements this month',
      '3 periods today',
    ])
  })
})
