// ═══════════════════════════════════════════════════════════════
// Building the demo school's week — the scheduling part, on its own.
// ═══════════════════════════════════════════════════════════════
//
// Extracted from seed.ts and kept free of Supabase for one reason: it is
// the only part of the seed that can silently produce *wrong* data rather
// than merely failing. An insert that breaks is obvious; a timetable that
// double-books eleven teachers and gives Class 5A three different Maths
// teachers looks completely fine until the workload page is opened.
//
// Being a pure function of its inputs, it has a test
// (seedTimetable.test.ts) that asserts the invariants the timetable
// module depends on, at the real size of the demo school: 47 sections,
// ~83 teachers, 1,786 periods a week.

// ── The school day ───────────────────────────────────────────
//
// Modelled on a CBSE day rather than invented: assembly before first
// period, eight 40-minute periods, a short break after the third and
// lunch after the sixth, and a half-day Saturday. That gives 44 teaching
// periods a week, which is the range Indian middle schools actually run.
//
// Teaching periods are numbered 1..N contiguously within each shape and
// breaks take no number in that run — every part of the timetable module
// addresses a slot by that number, so a gap turns "absent from period 5"
// into a silent no-op.

export interface LayoutSlot {
  kind: 'period' | 'break' | 'lunch' | 'assembly'
  /** 1..N within the day, contiguous. Null for everything else. */
  periodNumber: number | null
  start: string
  end: string
  label?: string
}

export const REGULAR_DAY: LayoutSlot[] = [
  { kind: 'assembly', periodNumber: null, start: '08:00', end: '08:20', label: 'Assembly' },
  { kind: 'period', periodNumber: 1, start: '08:20', end: '09:00' },
  { kind: 'period', periodNumber: 2, start: '09:00', end: '09:40' },
  { kind: 'period', periodNumber: 3, start: '09:40', end: '10:20' },
  { kind: 'break', periodNumber: null, start: '10:20', end: '10:40', label: 'Short break' },
  { kind: 'period', periodNumber: 4, start: '10:40', end: '11:20' },
  { kind: 'period', periodNumber: 5, start: '11:20', end: '12:00' },
  { kind: 'period', periodNumber: 6, start: '12:00', end: '12:40' },
  { kind: 'lunch', periodNumber: null, start: '12:40', end: '13:20', label: 'Lunch' },
  { kind: 'period', periodNumber: 7, start: '13:20', end: '14:00' },
  { kind: 'period', periodNumber: 8, start: '14:00', end: '14:40' },
]

export const SATURDAY_DAY: LayoutSlot[] = [
  { kind: 'assembly', periodNumber: null, start: '08:00', end: '08:15', label: 'Assembly' },
  { kind: 'period', periodNumber: 1, start: '08:15', end: '08:55' },
  { kind: 'period', periodNumber: 2, start: '08:55', end: '09:35' },
  { kind: 'break', periodNumber: null, start: '09:35', end: '09:50', label: 'Short break' },
  { kind: 'period', periodNumber: 3, start: '09:50', end: '10:30' },
  { kind: 'period', periodNumber: 4, start: '10:30', end: '11:10' },
]

export const SCHOOL_DAYS = [1, 2, 3, 4, 5, 6]
export const shapeFor = (day: number): LayoutSlot[] => (day === 6 ? SATURDAY_DAY : REGULAR_DAY)
export const teachingIn = (slots: LayoutSlot[]) => slots.filter(s => s.kind === 'period').length
export const REGULAR_TEACHING = teachingIn(REGULAR_DAY)
export const WEEKLY_TEACHING_PERIODS = SCHOOL_DAYS
  .reduce((sum, day) => sum + teachingIn(shapeFor(day)), 0)

// ── Curriculum ───────────────────────────────────────────────
//
// Weighted, not evenly split. An even split is the thing that gives away
// a demo instantly: Art & Craft does not get as many periods a week as
// Mathematics in any real school. These weights follow the CBSE-aligned
// ranges — core subjects 6–8 a week, languages 6–8, computing 2–3,
// art and PE 2–4 — and each stage's list sums to exactly the 44 periods
// the week contains.

export interface SubjectAllocation {
  name: string
  periods: number
  /** Drives subjects.subject_type, and how the UI colours and groups it. */
  type: 'core' | 'language' | 'co_curricular' | 'activity' | 'lab' | 'vocational'
  /** Where it has to happen. Null means the section's own room. */
  room?: 'computer_lab' | 'science_lab' | 'ground' | 'library' | 'art_room' | 'music_room'
  /** Soft scheduling preferences the generator weighs. */
  placement?: { preferMorning?: boolean; avoidPeriod1?: boolean; avoidPostLunch?: boolean; preferLast?: boolean }
}

const MORNING = { preferMorning: true }
const LATE = { preferLast: true, avoidPeriod1: true }

// Nursery–UKG. Short attention spans, so activity blocks dominate and
// nothing academic runs late in the day.
export const PRE_PRIMARY_PLAN: SubjectAllocation[] = [
  { name: 'English', periods: 9, type: 'language', placement: MORNING },
  { name: 'Hindi', periods: 8, type: 'language', placement: MORNING },
  { name: 'Numbers', periods: 8, type: 'core', placement: MORNING },
  { name: 'Rhymes & Story', periods: 7, type: 'activity' },
  // No dedicated art room for the little ones: pre-primary craft happens
  // at their own desks, which is both how it works and what keeps the two
  // art rooms inside their capacity.
  { name: 'Art & Craft', periods: 6, type: 'co_curricular', placement: LATE },
  { name: 'Games', periods: 6, type: 'co_curricular', room: 'ground', placement: LATE },
]

// Classes 1–5.
export const PRIMARY_PLAN: SubjectAllocation[] = [
  { name: 'English', periods: 8, type: 'language', placement: MORNING },
  { name: 'Mathematics', periods: 8, type: 'core', placement: MORNING },
  { name: 'Hindi', periods: 7, type: 'language', placement: MORNING },
  { name: 'EVS', periods: 6, type: 'core' },
  { name: 'General Knowledge', periods: 3, type: 'activity' },
  { name: 'Art & Craft', periods: 3, type: 'co_curricular', placement: LATE },
  { name: 'Computer Science', periods: 3, type: 'lab', room: 'computer_lab' },
  { name: 'Physical Education', periods: 4, type: 'co_curricular', room: 'ground', placement: LATE },
  { name: 'Library', periods: 2, type: 'activity', room: 'library', placement: LATE },
]

// Classes 6–10. The three-language formula is simplified to two here to
// keep the demo's subject list legible.
export const MIDDLE_PLAN: SubjectAllocation[] = [
  { name: 'Mathematics', periods: 8, type: 'core', placement: MORNING },
  { name: 'Science', periods: 8, type: 'core', placement: MORNING },
  { name: 'English', periods: 7, type: 'language', placement: MORNING },
  { name: 'Social Science', periods: 7, type: 'core' },
  { name: 'Hindi', periods: 6, type: 'language' },
  { name: 'Computer Science', periods: 3, type: 'lab', room: 'computer_lab' },
  { name: 'Physical Education', periods: 3, type: 'co_curricular', room: 'ground', placement: LATE },
  { name: 'Art & Craft', periods: 2, type: 'co_curricular', room: 'art_room', placement: LATE },
]

// Classes 11–12: five electives plus English, which is how a senior
// secondary week is actually built.
export const STREAM_PLANS: Record<string, SubjectAllocation[]> = {
  PCM: [
    { name: 'Physics', periods: 8, type: 'core', placement: MORNING },
    { name: 'Chemistry', periods: 8, type: 'core', placement: MORNING },
    { name: 'Mathematics', periods: 8, type: 'core', placement: MORNING },
    { name: 'Computer Science', periods: 8, type: 'lab', room: 'computer_lab' },
    { name: 'English', periods: 7, type: 'language' },
    { name: 'Physical Education', periods: 5, type: 'co_curricular', room: 'ground', placement: LATE },
  ],
  PCB: [
    { name: 'Physics', periods: 9, type: 'core', placement: MORNING },
    { name: 'Chemistry', periods: 9, type: 'core', placement: MORNING },
    { name: 'Biology', periods: 9, type: 'core', placement: MORNING },
    { name: 'English', periods: 7, type: 'language' },
    { name: 'Physical Education', periods: 6, type: 'co_curricular', room: 'ground', placement: LATE },
    { name: 'Library', periods: 4, type: 'activity', room: 'library', placement: LATE },
  ],
  Commerce: [
    { name: 'Accountancy', periods: 9, type: 'core', placement: MORNING },
    { name: 'Business Studies', periods: 9, type: 'core', placement: MORNING },
    { name: 'Economics', periods: 9, type: 'core' },
    { name: 'English', periods: 7, type: 'language' },
    { name: 'Mathematics', periods: 6, type: 'core' },
    { name: 'Physical Education', periods: 4, type: 'co_curricular', room: 'ground', placement: LATE },
  ],
  Humanities: [
    { name: 'History', periods: 9, type: 'core', placement: MORNING },
    { name: 'Political Science', periods: 9, type: 'core', placement: MORNING },
    { name: 'Geography', periods: 9, type: 'core' },
    { name: 'English', periods: 7, type: 'language' },
    { name: 'Economics', periods: 6, type: 'core' },
    { name: 'Physical Education', periods: 4, type: 'co_curricular', room: 'ground', placement: LATE },
  ],
}

/** The weighted plan for one section. */
export function planFor(level: number, sectionName: string): SubjectAllocation[] {
  if (level >= 11) return STREAM_PLANS[sectionName] ?? STREAM_PLANS.PCM
  if (level <= 0) return PRE_PRIMARY_PLAN
  return level <= 5 ? PRIMARY_PLAN : MIDDLE_PLAN
}

/** Subject names only — the shape the rest of the seed already expects. */
export function subjectsFor(level: number, sectionName: string): string[] {
  return planFor(level, sectionName).map(s => s.name)
}

/** Everything examinable at a class level — the union across streams. */
export function classSubjects(level: number): string[] {
  if (level >= 11) {
    return Array.from(new Set(Object.values(STREAM_PLANS).flat().map(s => s.name)))
  }
  return subjectsFor(level, 'A')
}

/** Every subject the school teaches anywhere, with its metadata. */
export function allSubjectAllocations(): Map<string, SubjectAllocation> {
  const out = new Map<string, SubjectAllocation>()
  const every = [
    ...PRE_PRIMARY_PLAN, ...PRIMARY_PLAN, ...MIDDLE_PLAN,
    ...Object.values(STREAM_PLANS).flat(),
  ]
  for (const s of every) if (!out.has(s.name)) out.set(s.name, s)
  return out
}

export interface LayoutSection {
  id: string
  classId: string
  /** Section label — for classes 11–12 this is the stream. */
  name: string
  level: number
}

export interface LayoutTeacher {
  id: string
  subject: string | null
  /**
   * The class levels this teacher covers, matching the Indian PRT / TGT /
   * PGT split. Omitted means any level.
   *
   * Load-bearing for realism: without it the layout will hand a nursery
   * Numbers specialist a Class 12 section, and the PRT/TGT/PGT label on
   * their profile becomes decoration.
   */
  minLevel?: number
  maxLevel?: number
}

export interface PlanEntry {
  sectionId: string
  classId: string
  subject: string
  periods: number
  teacherId: string
}

export interface LayoutEntry {
  sectionId: string
  classId: string
  day: number
  periodNumber: number
  start: string
  end: string
  subject: string
  teacherId: string
}

export interface BreakEntry {
  sectionId: string
  classId: string
  day: number
  periodNumber: number
  start: string
  end: string
  /** "Assembly", "Short break", "Lunch" — shown on the grid as written. */
  label: string
}

export interface LayoutDiagnostics {
  totalPeriods: number
  /** Slots left empty because no qualified teacher was free. */
  unfilled: number
  /** Times a section got the same subject twice in one day. */
  repeatedInDay: number
  /** A teacher in two rooms at once. Must be zero. */
  doubleBooked: number
  /** Section+subject pairs taught by more than one person. Must be zero. */
  multiTeacherSectionSubjects: number
  /** Sections whose weekly quota was not fully placed. Must be zero. */
  quotaShortfalls: number
  loads: { min: number; max: number; median: number; mean: number }
  utilisation: number
}

export interface LayoutInput {
  sections: LayoutSection[]
  teachers: LayoutTeacher[]
  /** Which subjects one section is actually taught. */
  subjectsFor: (level: number, sectionName: string) => string[]
  /** The shape of each weekday, 1 = Monday. */
  shapeFor: (day: number) => LayoutSlot[]
  days: number[]
}

export interface LayoutResult {
  plan: PlanEntry[]
  entries: LayoutEntry[]
  breaks: BreakEntry[]
  diagnostics: LayoutDiagnostics
}

/**
 * How many periods a week the i-th of `count` subjects gets.
 *
 * Even split with the remainder handed to the earliest subjects, so a
 * section's subjects sum to exactly the periods available. Sum to less
 * and the grid has holes; sum to more and the quota can never be met.
 */
export function splitWeeklyPeriods(totalPeriods: number, count: number, index: number): number {
  if (count <= 0) return 0
  return Math.floor(totalPeriods / count) + (index < totalPeriods % count ? 1 : 0)
}

export function buildTimetable(input: LayoutInput): LayoutResult {
  const { sections, teachers, subjectsFor, shapeFor, days } = input

  /**
   * How many periods a section gets of one subject.
   *
   * The weighted plan is authoritative where it applies; the even split
   * is the fallback for a caller that supplies its own curriculum (the
   * tests do). Either way a section's subjects must sum to exactly the
   * periods it has, or the grid ends up with holes or an unmeetable quota.
   */
  const periodsOf = (
    section: LayoutSection, subject: string, count: number, index: number, total: number,
  ): number => {
    const plan = planFor(section.level, section.name)
    const hit = plan.find(p => p.name === subject)
    const planTotal = plan.reduce((sum, p) => sum + p.periods, 0)
    if (hit && planTotal === total) return hit.periods
    return splitWeeklyPeriods(total, count, index)
  }

  const periodsPerWeek = days.reduce(
    (sum, day) => sum + shapeFor(day).filter(s => s.kind === 'period').length, 0)

  // ── one teacher per section+subject, decided before any slot is filled ──
  //
  // The binding is the whole point. Choosing a teacher per slot instead —
  // which is what the seed used to do — gives Class 5A a different Maths
  // teacher on Monday and Tuesday, and the substitute ranking, workload
  // report and generator all assume that cannot happen.
  const bySubject = new Map<string, LayoutTeacher[]>()
  for (const t of teachers) {
    if (!t.subject) continue
    const list = bySubject.get(t.subject) ?? []
    list.push(t)
    bySubject.set(t.subject, list)
  }

  const load = new Map<string, number>(teachers.map(t => [t.id, 0]))
  const plan: PlanEntry[] = []

  // Assign the scarcest subjects first: a subject with one specialist has
  // no choice to make, and making it early means the abundant subjects
  // fill in around it instead of the other way round.
  const demandOrder: { section: LayoutSection; subject: string; periods: number; bench: number }[] = []
  for (const section of sections) {
    const taught = subjectsFor(section.level, section.name)
    taught.forEach((subject, i) => {
      demandOrder.push({
        section, subject,
        periods: periodsOf(section, subject, taught.length, i, periodsPerWeek),
        bench: (bySubject.get(subject) ?? []).length || teachers.length,
      })
    })
  }
  demandOrder.sort((a, b) => a.bench - b.bench || b.periods - a.periods)

  const covers = (t: LayoutTeacher, level: number) =>
    (t.minLevel == null || level >= t.minLevel) && (t.maxLevel == null || level <= t.maxLevel)

  for (const demand of demandOrder) {
    const qualified = (bySubject.get(demand.subject) ?? []).filter(t => covers(t, demand.section.level))
    // Fall back through "right subject, wrong stage" before "anyone", so a
    // gap in the bench degrades gracefully instead of putting a Class 12
    // teacher in front of Nursery.
    const pool = qualified.length
      ? qualified
      : (bySubject.get(demand.subject) ?? []).length
        ? bySubject.get(demand.subject)!
        : teachers.filter(t => covers(t, demand.section.level))
    if (!pool.length) continue
    const chosen = pool.reduce((best, t) =>
      (load.get(t.id) ?? 0) < (load.get(best.id) ?? 0) ? t : best, pool[0])
    load.set(chosen.id, (load.get(chosen.id) ?? 0) + demand.periods)
    plan.push({
      sectionId: demand.section.id,
      classId: demand.section.classId,
      subject: demand.subject,
      periods: demand.periods,
      teacherId: chosen.id,
    })
  }

  // ── lay the week out ──────────────────────────────────────
  //
  // Slot-major, not section-major: every section competes for the same
  // instant, so filling one slot across all sections at once is the only
  // order in which "is this teacher already busy" is a local question.
  const remaining = new Map<string, Map<string, number>>()
  const teacherOf = new Map<string, string>()
  for (const entry of plan) {
    const left = remaining.get(entry.sectionId) ?? new Map<string, number>()
    left.set(entry.subject, entry.periods)
    remaining.set(entry.sectionId, left)
    teacherOf.set(`${entry.sectionId}|${entry.subject}`, entry.teacherId)
  }

  const entries: LayoutEntry[] = []
  const breaks: BreakEntry[] = []
  let unfilled = 0
  let repeatedInDay = 0

  for (const day of days) {
    const shape = shapeFor(day)
    const usedToday = new Map<string, Set<string>>()

    shape.forEach((slot, slotIndex) => {
      // Anything that is not a teaching period — assembly, short break,
      // lunch. Testing for 'break' alone was a bug the moment the day
      // grew an assembly: the other kinds fell through into the teaching
      // branch and were placed as lessons with a null period number.
      if (slot.kind !== 'period') {
        for (const section of sections) {
          breaks.push({
            sectionId: section.id, classId: section.classId, day,
            // Non-teaching slots are numbered above the teaching range so
            // nothing that addresses a slot by number can mistake one for
            // a lesson.
            periodNumber: 100 + slotIndex + 1,
            start: slot.start, end: slot.end,
            label: slot.label ?? (slot.kind === 'lunch' ? 'Lunch' : slot.kind === 'assembly' ? 'Assembly' : 'Break'),
          })
        }
        return
      }

      const busy = new Set<string>()

      // Most-constrained-first. A fixed rotation looks fair but is not:
      // late in the week a section can be down to one subject whose
      // teacher is busy in every slot left, and by the time the rotation
      // reaches it the choice is gone. Serving whoever has fewest options
      // left removes 23 unfilled periods from a 1,786-period week.
      const optionsFor = (section: LayoutSection) => {
        const left = remaining.get(section.id)
        if (!left) return []
        const out: { subject: string; owed: number; teacherId: string }[] = []
        for (const [subject, owed] of left) {
          if (owed <= 0) continue
          const teacherId = teacherOf.get(`${section.id}|${subject}`)
          if (!teacherId || busy.has(teacherId)) continue
          out.push({ subject, owed, teacherId })
        }
        return out
      }

      const owedTotal = (section: LayoutSection) => {
        let sum = 0
        for (const n of remaining.get(section.id)?.values() ?? []) sum += Math.max(0, n)
        return sum
      }

      // Recomputed each pick, because every placement takes a teacher out
      // of circulation and changes who is now the most constrained.
      const pending = sections.filter(s => owedTotal(s) > 0)

      while (pending.length) {
        let bestIndex = 0
        let bestScore = Infinity
        for (let i = 0; i < pending.length; i++) {
          const count = optionsFor(pending[i]).length
          // No options at all is the most urgent case to resolve, and
          // resolving it means recording the hole and moving on.
          const score = count === 0 ? -1 : count * 1000 - owedTotal(pending[i])
          if (score < bestScore) { bestScore = score; bestIndex = i }
        }
        const section = pending.splice(bestIndex, 1)[0]

        const left = remaining.get(section.id)
        if (!left) continue
        const already = usedToday.get(section.id) ?? new Set<string>()
        const options = optionsFor(section)

        // Prefer something this section has not had today; among those,
        // whatever it still owes most of — the scarcest thing to place is
        // the thing to place first.
        let chosen = options
          .filter(o => !already.has(o.subject))
          .sort((a, b) => b.owed - a.owed)[0]

        if (!chosen) {
          // A repeat is a soft-rule warning. An empty slot is thirty
          // children with nobody in the room, so take the warning.
          chosen = options.sort((a, b) => b.owed - a.owed)[0]
          if (chosen) repeatedInDay++
        }
        if (!chosen) { unfilled++; continue }

        busy.add(chosen.teacherId)
        already.add(chosen.subject)
        usedToday.set(section.id, already)
        left.set(chosen.subject, chosen.owed - 1)

        entries.push({
          sectionId: section.id, classId: section.classId, day,
          periodNumber: slot.periodNumber!, start: slot.start, end: slot.end,
          subject: chosen.subject, teacherId: chosen.teacherId,
        })
      }
    })
  }

  // ── repair pass ───────────────────────────────────────────
  //
  // Each section's subjects sum to exactly the slots it has, so there is
  // no slack: the last slot of the week must hold the one subject still
  // owed, and that subject's teacher has to be free at precisely that
  // moment. Greedy cannot guarantee it — 19 of 1,786 periods came out
  // empty, every one of them short by exactly one, with no teacher above
  // 74% load. That is a packing failure, not a shortage.
  //
  // The fix is a swap. For an empty slot needing teacher T, find another
  // slot in the same section holding teacher U where T is free, and where
  // U is free at the empty slot. Exchange them and both slots are filled.
  const repaired = repairHoles(entries, remaining, teacherOf, sections, shapeFor, days)
  unfilled -= repaired

  return { plan, entries, breaks, diagnostics: diagnose(entries, plan, teachers, periodsPerWeek, unfilled, repeatedInDay) }
}


/**
 * Fill leftover holes by swapping two lessons within the same section.
 *
 * Returns how many were resolved. Anything it cannot fix stays counted as
 * unfilled, so the seed still reports honestly rather than pretending.
 */
function repairHoles(
  entries: LayoutEntry[],
  remaining: Map<string, Map<string, number>>,
  teacherOf: Map<string, string>,
  sections: LayoutSection[],
  shapeFor: (day: number) => LayoutSlot[],
  days: number[],
): number {
  // Where every teacher already is, and what every section already has.
  const teacherBusy = new Set<string>()
  const sectionAt = new Map<string, LayoutEntry>()
  for (const e of entries) {
    teacherBusy.add(`${e.teacherId}|${e.day}|${e.periodNumber}`)
    sectionAt.set(`${e.sectionId}|${e.day}|${e.periodNumber}`, e)
  }

  const allSlots: { day: number; slot: LayoutSlot }[] = []
  for (const day of days) {
    for (const slot of shapeFor(day)) {
      if (slot.kind === 'period') allSlots.push({ day, slot })
    }
  }

  let fixed = 0

  for (const section of sections) {
    const owed = remaining.get(section.id)
    if (!owed) continue

    for (const [subject, count] of owed) {
      for (let n = 0; n < count; n++) {
        const teacherId = teacherOf.get(`${section.id}|${subject}`)
        if (!teacherId) continue

        // The section's empty slots.
        const holes = allSlots.filter(({ day, slot }) =>
          !sectionAt.has(`${section.id}|${day}|${slot.periodNumber}`))
        if (!holes.length) break

        let done = false
        for (const hole of holes) {
          // Easy case: the teacher happens to be free in the hole.
          if (!teacherBusy.has(`${teacherId}|${hole.day}|${hole.slot.periodNumber}`)) {
            place(section, hole, subject, teacherId)
            done = true
            break
          }

          // Otherwise swap with a lesson this section already has, in a
          // slot where our teacher IS free and whose teacher is free in
          // the hole.
          const candidate = allSlots.find(({ day, slot }) => {
            const held = sectionAt.get(`${section.id}|${day}|${slot.periodNumber}`)
            if (!held) return false
            if (teacherBusy.has(`${teacherId}|${day}|${slot.periodNumber}`)) return false
            return !teacherBusy.has(`${held.teacherId}|${hole.day}|${hole.slot.periodNumber}`)
          })
          if (!candidate) continue

          const held = sectionAt.get(`${section.id}|${candidate.day}|${candidate.slot.periodNumber}`)!
          // Move the existing lesson into the hole...
          teacherBusy.delete(`${held.teacherId}|${held.day}|${held.periodNumber}`)
          sectionAt.delete(`${section.id}|${held.day}|${held.periodNumber}`)
          held.day = hole.day
          held.periodNumber = hole.slot.periodNumber!
          held.start = hole.slot.start
          held.end = hole.slot.end
          teacherBusy.add(`${held.teacherId}|${held.day}|${held.periodNumber}`)
          sectionAt.set(`${section.id}|${held.day}|${held.periodNumber}`, held)
          // ...and take the slot it vacated.
          place(section, candidate, subject, teacherId)
          done = true
          break
        }

        if (!done) break
        owed.set(subject, (owed.get(subject) ?? 1) - 1)
        fixed++
      }
    }
  }

  function place(
    section: LayoutSection,
    at: { day: number; slot: LayoutSlot },
    subject: string,
    teacherId: string,
  ) {
    const entry: LayoutEntry = {
      sectionId: section.id, classId: section.classId,
      day: at.day, periodNumber: at.slot.periodNumber!,
      start: at.slot.start, end: at.slot.end,
      subject, teacherId,
    }
    entries.push(entry)
    teacherBusy.add(`${teacherId}|${entry.day}|${entry.periodNumber}`)
    sectionAt.set(`${section.id}|${entry.day}|${entry.periodNumber}`, entry)
  }

  return fixed
}

function diagnose(
  entries: LayoutEntry[], plan: PlanEntry[], teachers: LayoutTeacher[],
  periodsPerWeek: number, unfilled: number, repeatedInDay: number,
): LayoutDiagnostics {
  const perSlot = new Map<string, number>()
  const perSectionSubject = new Map<string, Set<string>>()
  const placed = new Map<string, number>()
  const perTeacher = new Map<string, number>()

  for (const e of entries) {
    const slotKey = `${e.day}|${e.periodNumber}|${e.teacherId}`
    perSlot.set(slotKey, (perSlot.get(slotKey) ?? 0) + 1)

    const ssKey = `${e.sectionId}|${e.subject}`
    const set = perSectionSubject.get(ssKey) ?? new Set<string>()
    set.add(e.teacherId)
    perSectionSubject.set(ssKey, set)

    placed.set(ssKey, (placed.get(ssKey) ?? 0) + 1)
    perTeacher.set(e.teacherId, (perTeacher.get(e.teacherId) ?? 0) + 1)
  }

  let quotaShortfalls = 0
  for (const entry of plan) {
    if ((placed.get(`${entry.sectionId}|${entry.subject}`) ?? 0) < entry.periods) quotaShortfalls++
  }

  const loads = teachers.map(t => perTeacher.get(t.id) ?? 0).sort((a, b) => a - b)
  const sum = loads.reduce((a, b) => a + b, 0)

  return {
    totalPeriods: entries.length,
    unfilled,
    repeatedInDay,
    doubleBooked: Array.from(perSlot.values()).filter(n => n > 1).length,
    multiTeacherSectionSubjects: Array.from(perSectionSubject.values()).filter(s => s.size > 1).length,
    quotaShortfalls,
    loads: {
      min: loads[0] ?? 0,
      max: loads[loads.length - 1] ?? 0,
      median: loads[Math.floor(loads.length / 2)] ?? 0,
      mean: loads.length ? Math.round((sum / loads.length) * 10) / 10 : 0,
    },
    utilisation: loads.length && periodsPerWeek
      ? Math.round((sum / (loads.length * periodsPerWeek)) * 100) / 100
      : 0,
  }
}

/**
 * How many specialists each subject needs to stay near a target
 * utilisation, given what the curriculum demands.
 *
 * Derived rather than hand-tuned because the old hand-tuned figure was
 * wrong in a way nothing caught: 50 teachers for 1,786 weekly periods is
 * 94% utilisation, which is unschedulable once a teacher is bound to a
 * section+subject, and leaves nobody free to cover an absence.
 */
export interface BenchMember {
  subject: string
  /** PRT covers pre-primary and primary, TGT the middle school, PGT 11–12. */
  designation: 'PRT' | 'TGT' | 'PGT'
  minLevel: number
  maxLevel: number
}

export const STAGES: { designation: 'PRT' | 'TGT' | 'PGT'; min: number; max: number }[] = [
  { designation: 'PRT', min: -2, max: 5 },
  { designation: 'TGT', min: 6, max: 10 },
  { designation: 'PGT', min: 11, max: 12 },
]

/**
 * How many specialists each subject needs at each stage.
 *
 * Sized per stage rather than per subject overall, because that is how a
 * school is actually staffed: a primary teacher and a senior-secondary
 * teacher of "English" are different appointments with different
 * qualifications, and pooling them produces a bench that looks adequate
 * while leaving Class 12 without anyone who can take it.
 *
 * Derived rather than hand-tuned. The old hand-tuned figure was 50
 * teachers for a 2,068-period week — 94% utilisation, unschedulable once
 * a teacher is bound to a section+subject, and with nobody free to cover
 * an absence.
 */
export function benchFor(
  sections: LayoutSection[],
  subjectsForFn: (level: number, sectionName: string) => string[],
  periodsPerWeek: number,
  targetUtilisation = 0.65,
): BenchMember[] {
  const demand = new Map<string, number>()   // "subject|designation" -> periods
  for (const section of sections) {
    const stage = STAGES.find(s => section.level >= s.min && section.level <= s.max) ?? STAGES[0]
    const taught = subjectsForFn(section.level, section.name)
    const plan = planFor(section.level, section.name)
    taught.forEach((subject, i) => {
      const hit = plan.find(x => x.name === subject)
      const periods = hit ? hit.periods : splitWeeklyPeriods(periodsPerWeek, taught.length, i)
      const key = `${subject}|${stage.designation}`
      demand.set(key, (demand.get(key) ?? 0) + periods)
    })
  }

  const capacity = periodsPerWeek * targetUtilisation
  const out: BenchMember[] = []
  for (const [key, periods] of Array.from(demand.entries()).sort((a, b) => b[1] - a[1])) {
    const [subject, designation] = key.split('|') as [string, 'PRT' | 'TGT' | 'PGT']
    const stage = STAGES.find(s => s.designation === designation)!
    const count = Math.max(1, Math.ceil(periods / capacity))
    for (let i = 0; i < count; i++) {
      out.push({ subject, designation, minLevel: stage.min, maxLevel: stage.max })
    }
  }
  return out
}
