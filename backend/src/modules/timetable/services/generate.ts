import { supabase } from '../../../shared/db/client'
import {
  checkFeasibility, detectConflicts, generateTimetable, suggestSwaps,
  EngineConflict, EngineDemand, EngineEntry, EngineInput, EngineSection, EngineTeacher, FeasibilityReport,
} from '../engine'
import { audit, badRequest, conflict, DAY_NAMES, fetchAll, getSettings, must, notify } from '../lib/core'

// ═══════════════════════════════════════════════════════════════
// Turning the database into an EngineInput, and back again.
// ═══════════════════════════════════════════════════════════════
//
// The engine is a pure function and knows nothing about Supabase. Every
// bit of the awkwardness lives here, which is the point: the ~2,200
// lines of scheduling logic stay portable and testable, and this file
// is the only thing that has to change when the schema does.
//
// One structural decision worth stating. The engine takes a single
// periodsPerDay, but a real school does not have one: junior classes go
// home after period 9 and seniors after period 10. So generation runs
// once per day-shape, and each run is handed every OTHER group's
// timetable as `external` occupancy — immovable teacher and room
// bookings it must schedule around. Without that, the two runs would
// each independently decide that Mrs Sharma is free on Tuesday at 11.
//
// Crucially that occupancy is the LIVE grid only for shapes this run has
// not reached yet. For a shape already generated in the same run it is
// what this run just placed, because the live rows for those sections
// are precisely what is being replaced. Scheduling group two around
// group one's OLD positions is how a draft ends up with a teacher in two
// rooms at once — the run is consistent with a timetable that is about
// to stop existing.

export interface GenerationGroup {
  periodsPerDay: number
  /** The weekdays that share this shape. */
  days: number[]
  sectionIds: string[]
  templateName: string
  /** Teaching slots one section gets from this group across the week. */
  slotsPerSection: number
}

interface Context {
  input: EngineInput
  group: GenerationGroup
  sectionMeta: Map<string, { classId: string; label: string }>
  subjectNames: Map<string, string>
  teacherNames: Map<string, string>
  periodTimes: Map<number, { start: string; end: string }>
}

/**
 * Work out how many distinct day-shapes the school runs, and which
 * sections follow each.
 */
export async function generationGroups(schoolId: string): Promise<GenerationGroup[]> {
  const [assignmentResult, defsResult, templateResult] = await Promise.all([
    supabase.from('section_day_templates')
      .select('section_id, day_of_week, day_template_id')
      .eq('school_id', schoolId),
    supabase.from('period_slot_defs')
      .select('day_template_id, kind, period_number')
      .eq('school_id', schoolId),
    supabase.from('day_templates').select('id, name').eq('school_id', schoolId),
  ])

  const teachingPerTemplate = new Map<string, number>()
  for (const d of defsResult.data ?? []) {
    if (d.kind !== 'period') continue
    teachingPerTemplate.set(d.day_template_id, (teachingPerTemplate.get(d.day_template_id) ?? 0) + 1)
  }
  const nameOf = new Map((templateResult.data ?? []).map(t => [t.id, t.name]))

  // A group is a day SHAPE, not a set of sections.
  //
  // Grouping by template and treating each group as a whole week was
  // wrong in a way that only shows up on a school with a half-day
  // Saturday — which is most of them. Every section follows the regular
  // template Monday to Friday AND the Saturday template on Saturday, so
  // it appeared in both groups, and each group then believed the section
  // owed it a full 44-period week. Feasibility duly reported that
  // Nursery-A needed 44 periods in 24 Saturday slots.
  interface Bucket { periodsPerDay: number; days: Set<number>; sections: Set<string>; templateIds: Set<string> }
  const buckets = new Map<number, Bucket>()

  for (const row of assignmentResult.data ?? []) {
    const periodsPerDay = teachingPerTemplate.get(row.day_template_id) ?? 0
    if (!periodsPerDay) continue
    let bucket = buckets.get(periodsPerDay)
    if (!bucket) {
      bucket = { periodsPerDay, days: new Set(), sections: new Set(), templateIds: new Set() }
      buckets.set(periodsPerDay, bucket)
    }
    bucket.days.add(row.day_of_week)
    bucket.sections.add(row.section_id)
    bucket.templateIds.add(row.day_template_id)
  }

  return [...buckets.values()]
    .sort((a, b) => b.days.size - a.days.size || b.periodsPerDay - a.periodsPerDay)
    .map(bucket => {
      const templateNames = [...bucket.templateIds].map(id => nameOf.get(id)).filter(Boolean)
      return {
        periodsPerDay: bucket.periodsPerDay,
        days: [...bucket.days].sort((a, b) => a - b),
        sectionIds: [...bucket.sections],
        templateName: templateNames[0] ?? `${bucket.periodsPerDay}-period day`,
        slotsPerSection: bucket.periodsPerDay * bucket.days.size,
      }
    })
}

/**
 * Split every section's weekly quota across the day shapes it follows.
 *
 * A section with 44 periods a week across 40 weekday slots and 4 Saturday
 * slots owes each shape only its share, and the shares have to add up in
 * three directions at once:
 *
 *   • per subject, to that subject's weekly total;
 *   • per section, to the slots that shape actually gives it;
 *   • per teacher, to the periods they can physically teach in that shape
 *     — a teacher has four Saturday slots no matter how many sections
 *     want them, and allocating a fifth is what made feasibility report
 *     "mapped to 5 periods/week but can teach at most 4".
 *
 * Done globally rather than per section for the third reason: a section
 * on its own cannot know that its Maths teacher has already used their
 * Saturday elsewhere.
 */
export function splitDemandsAcrossGroups(
  weeklyBySection: Map<string, EngineDemand[]>,
  groups: GenerationGroup[],
  groupIndex: number,
): Map<string, EngineDemand[]> {
  if (groups.length <= 1) return weeklyBySection

  // Split only across the shapes a section actually follows.
  //
  // Two different things produce more than one group, and they need
  // opposite treatment. A school with a half-day Saturday has every
  // section in both shapes, and each owes its share. A school where the
  // juniors run nine periods and the seniors ten has the sections
  // *partitioned* between the shapes, and each section owes its whole
  // week to the one group it is in. Dividing there is what turned a
  // correct import into 202 phantom "quota is 1" conflicts.
  const groupsFor = (sectionId: string) => {
    const mine = groups.filter(g => g.sectionIds.includes(sectionId))
    return mine.length ? mine : groups
  }

  const totalSlots = groups.reduce((sum, g) => sum + g.slotsPerSection, 0)
  const remaining = new Map<string, Map<string, number>>()
  for (const [sectionId, demands] of weeklyBySection) {
    remaining.set(sectionId, new Map(demands.map(d => [d.subjectId, d.periodsPerWeek])))
  }

  let answer = new Map<string, EngineDemand[]>()

  // Smallest shape first, and the largest takes whatever is left.
  //
  // Order matters more than it looks. A half-day Saturday gives each
  // teacher four slots; the weekday shape gives them forty. Allocating
  // the weekdays first leaves a remainder that Saturday simply cannot
  // absorb — four teachers ended up "mapped to 5 periods but can teach at
  // most 4". Filling the scarce shape first, under its capacity ceiling,
  // and letting the roomy one mop up is the whole fix.
  const order = groups
    .map((g, index) => ({ g, index }))
    .sort((a, b) => a.g.slotsPerSection - b.g.slotsPerSection)

  for (let position = 0; position < order.length; position++) {
    const { g: group, index: g } = order[position]
    const teacherCapacity = new Map<string, number>()
    const perGroup = new Map<string, EngineDemand[]>()

    for (const [sectionId, demands] of weeklyBySection) {
      const mine = groupsFor(sectionId)
      if (!mine.includes(group)) continue

      const left = remaining.get(sectionId)!
      const slots = group.slotsPerSection
      // Denominator is this section's own shapes, not every shape in the
      // school.
      const sectionSlots = mine.reduce((sum, g) => sum + g.slotsPerSection, 0)
      // The remainder goes to the section's ROOMIEST shape, because that
      // is the one processed last — groups are walked smallest-first so
      // the scarce shape is filled under its capacity ceiling before the
      // spacious one mops up. Taking "last in the groups array" instead
      // handed Saturday the entire weekly quota before the weekdays had
      // been offered any of it.
      const lastForSection = mine.reduce(
        (best, g) => (g.slotsPerSection > best.slotsPerSection ? g : best), mine[0]) === group

      const share = demands.map(d => {
        const owed = left.get(d.subjectId) ?? 0
        const exact = (d.periodsPerWeek * slots) / sectionSlots
        return {
          d,
          take: lastForSection ? owed : Math.min(owed, Math.floor(exact)),
          fraction: exact - Math.floor(exact),
          owed,
        }
      })

      if (!lastForSection) {
        // Top the section up to exactly its slots, favouring whoever was
        // rounded down hardest — but never past a teacher's own ceiling
        // for this shape.
        let allocated = share.reduce((sum, x) => sum + x.take, 0)
        const byFraction = [...share].sort((a, b) => b.fraction - a.fraction)
        for (let pass = 0; pass < 3 && allocated < slots; pass++) {
          for (const candidate of byFraction) {
            if (allocated >= slots) break
            if (candidate.take >= candidate.owed) continue
            // A teacher's ceiling in this shape is its slots — four on a
            // half-day Saturday, however many sections want them.
            const used = teacherCapacity.get(candidate.d.teacherUserId) ?? 0
            if (used + 1 > group.slotsPerSection) continue
            candidate.take++
            allocated++
          }
        }
      }

      for (const x of share) {
        if (x.take <= 0) continue
        teacherCapacity.set(x.d.teacherUserId, (teacherCapacity.get(x.d.teacherUserId) ?? 0) + x.take)
        left.set(x.d.subjectId, (left.get(x.d.subjectId) ?? 0) - x.take)
      }

      perGroup.set(sectionId, share.filter(x => x.take > 0).map(x => ({
        ...x.d,
        periodsPerWeek: x.take,
        // A double period cannot straddle two runs; keep them in the
        // shape with the most slots, which is the weekday one.
        doublePeriods: g === 0 ? x.d.doublePeriods : 0,
      })))
    }

    if (g === groupIndex) answer = perGroup
  }

  return answer
}

/**
 * Assemble everything the engine needs for one day-shape.
 */
export async function buildEngineInput(
  schoolId: string,
  group: GenerationGroup,
  options: {
    keepLocked?: boolean
    allGroups?: GenerationGroup[]
    groupIndex?: number
    /** Entries placed by earlier day-shapes in this same run. */
    placedSoFar?: EngineEntry[]
    /** `sectionId|day` pairs this run has already re-placed. */
    regenerated?: Set<string>
  } = {},
): Promise<Context> {
  const settings = await getSettings(schoolId)

  const [
    sectionsResult, planResult, teachersResult, constraintsResult,
    roomsResult, subjectsResult, defsResult, classTeacherResult, liveResult,
  ] = await Promise.all([
    supabase.from('sections')
      .select('id, name, class_id, classes(name, numeric_level)')
      .eq('school_id', schoolId).in('id', group.sectionIds),
    fetchAll((from, to) => supabase.from('class_subject_plan')
      .select('*, subjects(name, room_type, placement)')
      .eq('school_id', schoolId).range(from, to), 'class subject plan').then(data => ({ data })),
    supabase.from('users').select('id, full_name, is_active')
      .eq('school_id', schoolId).not('role', 'in', '("parent","student")'),
    supabase.from('teacher_constraints').select('*').eq('school_id', schoolId),
    supabase.from('classrooms').select('*').eq('school_id', schoolId).eq('is_active', true),
    supabase.from('subjects').select('id, name, room_type, placement').eq('school_id', schoolId),
    supabase.from('period_slot_defs').select('*').eq('school_id', schoolId).order('slot_index'),
    // Per-year homeroom assignments; sections.class_teacher_id was dropped
    // in 20260801000000 and selecting it fails the whole query.
    supabase.from('class_teacher_assignments')
      .select('section_id, teacher_id').eq('school_id', schoolId).eq('is_active', true),
    // Paged: this is the whole live grid and it is what stops the run
    // double-booking a teacher who is busy in another day-shape.
    fetchAll((from, to) => supabase.from('timetable_periods')
      .select('section_id, day_of_week, period_number, subject_id, teacher_id, room_id, is_locked')
      .eq('school_id', schoolId).eq('is_break', false).range(from, to), 'timetable periods')
      .then(data => ({ data })),
  ])

  const sections = sectionsResult.data ?? []
  const targetIds = new Set(group.sectionIds)

  // ── the day's shape ───────────────────────────────────────────
  // Break positions come from whichever template has this many teaching
  // periods; a double period may not straddle one.
  const defs = (defsResult.data ?? [])
    .filter(d => d.period_number == null || d.period_number <= group.periodsPerDay)
    .sort((a, b) => a.slot_index - b.slot_index)

  const periodTimes = new Map<number, { start: string; end: string }>()
  for (const d of defs) {
    if (d.kind === 'period' && d.period_number != null && !periodTimes.has(d.period_number)) {
      periodTimes.set(d.period_number, { start: d.start_time, end: d.end_time })
    }
  }

  const breakAfter: number[] = []
  let postLunchPeriod: number | null = null
  {
    let lastTeaching = 0
    let sawBreak = false
    for (const d of defs) {
      if (d.kind === 'period') {
        if (sawBreak && postLunchPeriod == null) postLunchPeriod = d.period_number
        lastTeaching = d.period_number ?? lastTeaching
      } else if (lastTeaching > 0) {
        if (!breakAfter.includes(lastTeaching)) breakAfter.push(lastTeaching)
        sawBreak = true
      }
    }
  }

  // ── demands ───────────────────────────────────────────────────
  const subjectMeta = new Map((subjectsResult.data ?? []).map(s => [s.id, s]))
  const subjectNames = new Map((subjectsResult.data ?? []).map(s => [s.id, s.name]))

  const classTeacherOf = new Map<string, string>(
    (classTeacherResult.data ?? []).map((r: any) => [r.section_id, r.teacher_id]))

  const engineSections: EngineSection[] = []
  const sectionMeta = new Map<string, { classId: string; label: string }>()
  const weeklyBySection = new Map<string, EngineDemand[]>()

  for (const section of sections) {
    const label = `${(section as any).classes?.name ?? ''}-${section.name}`
    sectionMeta.set(section.id, { classId: section.class_id, label })

    // A section-level plan row beats a class-level one for the same
    // subject: the class-wide row is the default, the section row is the
    // deliberate exception.
    const bySubject = new Map<string, any>()
    for (const row of planResult.data ?? []) {
      if (row.class_id !== section.class_id) continue
      if (row.section_id && row.section_id !== section.id) continue
      const existing = bySubject.get(row.subject_id)
      if (!existing || (row.section_id && !existing.section_id)) bySubject.set(row.subject_id, row)
    }

    const weekly = [...bySubject.values()]
      .filter(row => row.weekly_periods > 0 && row.teacher_id)
      .map(row => {
        const subject = subjectMeta.get(row.subject_id)
        return {
          subjectId: row.subject_id,
          teacherUserId: row.teacher_id,
          periodsPerWeek: row.weekly_periods,
          doublePeriods: row.double_periods ?? 0,
          roomType: subject?.room_type ?? null,
          placement: subject?.placement ?? null,
        }
      })

    weeklyBySection.set(section.id, weekly)
  }

  // A section following a full weekday AND a half-day Saturday owes each
  // shape only its share of the week. Split globally, because a teacher's
  // Saturday capacity is shared across every section they take.
  const split = options.allGroups && options.allGroups.length > 1
    ? splitDemandsAcrossGroups(weeklyBySection, options.allGroups, options.groupIndex ?? 0)
    : weeklyBySection

  for (const section of sections) {
    engineSections.push({
      sectionId: section.id,
      classId: section.class_id,
      classOrder: (section as any).classes?.numeric_level ?? 0,
      homeRoomId: null,
      classTeacherUserId: classTeacherOf.get(section.id) ?? null,
      demands: split.get(section.id) ?? [],
    })
  }

  // ── teachers ──────────────────────────────────────────────────
  const constraintOf = new Map((constraintsResult.data ?? []).map(c => [c.teacher_id, c]))
  const teacherNames = new Map<string, string>()
  const engineTeachers: EngineTeacher[] = []

  for (const user of (teachersResult.data ?? []).filter(u => u.is_active !== false)) {
    teacherNames.set(user.id, user.full_name)
    const constraint = constraintOf.get(user.id)
    const blocked: { day: number; periodNumber: number }[] = []
    for (const b of (constraint?.availability?.blocked ?? [])) {
      blocked.push({ day: b.day, periodNumber: b.period })
    }
    engineTeachers.push({
      teacherUserId: user.id,
      maxPerDay: constraint?.max_periods_per_day ?? group.periodsPerDay,
      maxPerWeek: constraint?.max_periods_per_week ?? group.periodsPerDay * settings.working_days.length,
      maxConsecutive: constraint?.max_consecutive ?? group.periodsPerDay,
      minPerWeek: constraint?.min_periods_per_week ?? 0,
      blocked,
    })
  }

  // ── locked cells and other sections' occupancy ────────────────
  const locked: EngineEntry[] = []
  const external: EngineEntry[] = []

  for (const row of liveResult.data ?? []) {
    if (!row.subject_id || !row.teacher_id) continue
    const entry: EngineEntry = {
      sectionId: row.section_id,
      day: row.day_of_week,
      periodNumber: row.period_number,
      subjectId: row.subject_id,
      teacherUserId: row.teacher_id,
      roomId: row.room_id ?? null,
    }
    if (targetIds.has(row.section_id)) {
      if (options.keepLocked && row.is_locked) locked.push({ ...entry, isLocked: true })
    } else {
      // Superseded: this run has already re-placed that section on that
      // day, so the live row is stale and the fresh entry is added below.
      if (options.regenerated?.has(`${row.section_id}|${row.day_of_week}`)) continue
      // Another day-shape's live timetable. Immovable as far as this run
      // is concerned, and the only thing stopping the two groups from
      // both claiming the same teacher.
      external.push(entry)
    }
  }

  // What earlier shapes in this run actually decided. Entries for a
  // section-and-day this run is scheduling right now are dropped — the
  // engine is placing those itself and must not see them as occupied.
  const ownDays = new Set(group.days.length ? group.days : settings.working_days)
  for (const entry of options.placedSoFar ?? []) {
    if (targetIds.has(entry.sectionId) && ownDays.has(entry.day)) continue
    external.push(entry)
  }

  const input: EngineInput = {
    // The group's own days, not the school's whole week: this run only
    // covers the days that share this shape.
    days: group.days.length ? group.days : settings.working_days,
    periodsPerDay: group.periodsPerDay,
    breakAfter,
    postLunchPeriod,
    sections: engineSections,
    teachers: engineTeachers,
    rooms: (roomsResult.data ?? []).map(r => ({
      roomId: r.id, roomType: r.room_type, capacityGroups: r.capacity_groups ?? 1,
    })),
    locked,
    external,
  }

  return { input, group, sectionMeta, subjectNames, teacherNames, periodTimes }
}

// ── feasibility ─────────────────────────────────────────────────

export interface FeasibilitySummary {
  feasible: boolean
  groups: {
    templateName: string
    periodsPerDay: number
    sections: number
    report: FeasibilityReport
    readable: string[]
  }[]
}

/**
 * Refuse early, and say exactly what is wrong.
 *
 * Nothing wastes a timetable manager's afternoon like a generator that
 * runs for two minutes and then says "could not find a solution". If
 * Maths needs 96 periods a week and the Maths teachers can supply 80,
 * that is arithmetic, and it can be said before anything starts.
 */
export async function runFeasibility(schoolId: string): Promise<FeasibilitySummary> {
  const groups = await generationGroups(schoolId)
  if (!groups.length) {
    throw badRequest('no_day_templates',
      'No sections have a day template yet. Set the shape of the school day first.')
  }

  const out: FeasibilitySummary['groups'] = []
  for (const [index, group] of groups.entries()) {
    const context = await buildEngineInput(schoolId, group, { allGroups: groups, groupIndex: index })
    const report = checkFeasibility(context.input)
    out.push({
      templateName: group.templateName,
      periodsPerDay: group.periodsPerDay,
      sections: group.sectionIds.length,
      report,
      readable: report.issues.map(issue => humanizeIssue(issue, context)),
    })
  }

  return { feasible: out.every(g => g.report.feasible), groups: out }
}

function humanizeIssue(issue: { code: string; message: string; detail?: any }, context: Context): string {
  let text = issue.message
  // Engine messages carry raw uuids. A manager cannot act on a uuid.
  for (const [id, name] of context.subjectNames) text = text.split(id).join(name)
  for (const [id, name] of context.teacherNames) text = text.split(id).join(name)
  for (const [id, meta] of context.sectionMeta) text = text.split(id).join(meta.label)
  return text
}

// ── generation ──────────────────────────────────────────────────

export interface GenerateOptions {
  seed?: number
  iterations?: number
  keepLocked?: boolean
  label?: string
  effectiveFrom?: string | null
}

export async function generateDraft(schoolId: string, actorId: string, options: GenerateOptions = {}) {
  const groups = await generationGroups(schoolId)
  if (!groups.length) {
    throw badRequest('no_day_templates',
      'No sections have a day template yet. Set the shape of the school day first.')
  }

  const version = must(await supabase.from('timetable_versions').insert({
    school_id: schoolId,
    label: options.label || `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    status: 'draft',
    effective_from: options.effectiveFrom ?? null,
    source: 'generated',
    created_by: actorId,
    generated_at: new Date().toISOString(),
  }).select('id').single(), 'create draft version')

  const perGroup: any[] = []
  const rows: any[] = []
  const placedSoFar: EngineEntry[] = []
  const regenerated = new Set<string>()
  let totalScore = 0
  const allConflicts: { group: string; conflicts: EngineConflict[] }[] = []
  const log: string[] = []

  try {
    for (const [index, group] of groups.entries()) {
      const context = await buildEngineInput(schoolId, group, {
        keepLocked: options.keepLocked, allGroups: groups, groupIndex: index,
        placedSoFar, regenerated,
      })

      const feasibility = checkFeasibility(context.input)
      if (!feasibility.feasible) {
        throw badRequest('infeasible',
          `${group.templateName}: ${feasibility.issues.map(i => humanizeIssue(i, context)).join(' ')}`,
          feasibility.issues)
      }

      const started = Date.now()
      const result = generateTimetable(context.input, {
        seed: options.seed ?? 1,
        iterations: options.iterations ?? 2000,
      })
      const elapsed = Date.now() - started

      totalScore += result.score
      log.push(`${group.templateName}: ${result.entries.length} periods placed in ${elapsed}ms, score ${result.score}`)
      log.push(...result.log.slice(0, 20))

      const readable = result.conflicts.map(c => ({ ...c, message: humanizeIssue(c, context) }))
      allConflicts.push({ group: group.templateName, conflicts: readable })

      perGroup.push({
        templateName: group.templateName,
        sections: group.sectionIds.length,
        placed: result.entries.length,
        score: result.score,
        elapsedMs: elapsed,
        blocking: readable.filter(c => c.severity === 'block').length,
        warnings: readable.filter(c => c.severity === 'warn').length,
      })

      placedSoFar.push(...result.entries)
      for (const sectionId of group.sectionIds) {
        for (const day of (group.days.length ? group.days : [])) regenerated.add(`${sectionId}|${day}`)
      }

      for (const entry of result.entries) {
        const meta = context.sectionMeta.get(entry.sectionId)
        const times = context.periodTimes.get(entry.periodNumber)
        if (!meta || !times) continue
        rows.push({
          school_id: schoolId,
          version_id: version.id,
          class_id: meta.classId,
          section_id: entry.sectionId,
          day_of_week: entry.day,
          period_number: entry.periodNumber,
          start_time: times.start,
          end_time: times.end,
          subject_id: entry.subjectId,
          subject_name: context.subjectNames.get(entry.subjectId) ?? 'Unknown',
          teacher_id: entry.teacherUserId,
          room_id: entry.roomId ?? null,
          is_break: false,
          is_locked: !!entry.isLocked,
          is_double_part: !!entry.isDoublePart,
        })
      }
    }

    // Breaks are part of the shape of the day, not something the engine
    // places — it only ever emits teaching periods. But publishing a
    // draft DELETES every row for the sections it covers and inserts the
    // draft in their place, so a draft that carries no break rows
    // publishes a school with no lunch. Nothing would have complained:
    // the grid simply loses a row, and the morning-absence panel, which
    // anchors itself to the first break named "Lunch", quietly stops
    // finding one. So the live breaks are carried across unchanged.
    const generatedSections = new Set(rows.map(r => r.section_id))
    if (generatedSections.size) {
      const liveBreaks = await fetchAll<any>((from, to) => supabase.from('timetable_periods')
        .select(`
          class_id, section_id, day_of_week, period_number, start_time, end_time,
          subject_id, subject_name, teacher_id, room_id, is_break, is_locked, is_double_part
        `)
        .eq('school_id', schoolId).eq('is_break', true).range(from, to), 'timetable breaks')

      for (const row of liveBreaks) {
        if (!generatedSections.has(row.section_id)) continue
        rows.push({ ...row, school_id: schoolId, version_id: version.id })
      }
    }

    if (rows.length) {
      // Chunked because a 16-section week is ~1,000 rows and PostgREST
      // will refuse the payload in one go.
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('timetable_draft_periods').insert(rows.slice(i, i + 500))
        if (error) throw badRequest('draft_write_failed', error.message)
      }
    }

    await supabase.from('timetable_versions')
      .update({ score: totalScore }).eq('id', version.id)

    await audit(schoolId, actorId, 'generate', 'timetable_version', version.id, {
      groups: perGroup, score: totalScore, rows: rows.length,
    })

    return {
      versionId: version.id,
      score: totalScore,
      groups: perGroup,
      conflicts: allConflicts,
      log,
      rowsWritten: rows.length,
    }
  } catch (err) {
    // A failed generation must not leave a half-written draft behind for
    // somebody to publish by accident.
    await supabase.from('timetable_draft_periods').delete().eq('version_id', version.id)
    await supabase.from('timetable_versions').delete().eq('id', version.id)
    throw err
  }
}

// ── draft inspection and publishing ─────────────────────────────

export async function listVersions(schoolId: string) {
  const { data, error } = await supabase.from('timetable_versions')
    .select('*, creator:created_by(full_name), publisher:published_by(full_name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false }).limit(30)
  if (error) throw badRequest('query_failed', error.message)

  const ids = (data ?? []).filter(v => v.status === 'draft').map(v => v.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: drafts } = await supabase.from('timetable_draft_periods')
      .select('version_id').in('version_id', ids)
    for (const d of drafts ?? []) counts.set(d.version_id, (counts.get(d.version_id) ?? 0) + 1)
  }

  return (data ?? []).map(v => ({
    ...v,
    created_by_name: (v as any).creator?.full_name ?? null,
    published_by_name: (v as any).publisher?.full_name ?? null,
    draft_periods: counts.get(v.id) ?? null,
    can_rollback: !!v.replaced_snapshot && Array.isArray(v.replaced_snapshot) && v.replaced_snapshot.length > 0,
  }))
}

export async function draftGrid(schoolId: string, versionId: string, sectionId?: string) {
  // Paginated: a full week for a 30-section school is well past the 1000
  // rows PostgREST returns by default, and a preview that quietly stops
  // two-thirds of the way through is worse than no preview at all.
  const rows = await fetchAll<any>((from, to) => {
    let query = supabase.from('timetable_draft_periods')
      .select(`
        *, teacher:teacher_id(full_name), classes(name), sections(name), room:room_id(name)
      `)
      .eq('school_id', schoolId).eq('version_id', versionId)
      .order('day_of_week').order('period_number').range(from, to)
    if (sectionId) query = query.eq('section_id', sectionId)
    return query
  }, 'draft periods')

  const periods = rows.map(row => ({
    ...row,
    teacher_name: row.teacher?.full_name ?? null,
    class_name: row.classes?.name ?? null,
    section_name: row.sections?.name ?? null,
    room_name: row.room?.name ?? null,
  }))

  // The section list and the period axis are derived from the draft
  // itself rather than from the current setup, so the preview shows what
  // this version actually contains — including a section the plan has
  // since dropped.
  const sections = new Map<string, { id: string; label: string; periods: number }>()
  const slots = new Map<number, { periodNumber: number; startTime: string | null; endTime: string | null }>()
  for (const row of periods) {
    if (row.section_id) {
      const existing = sections.get(row.section_id)
      if (existing) existing.periods++
      else sections.set(row.section_id, {
        id: row.section_id,
        label: [row.class_name, row.section_name].filter(Boolean).join(' ') || 'Unnamed',
        periods: 1,
      })
    }
    if (row.period_number != null && !slots.has(row.period_number)) {
      slots.set(row.period_number, {
        periodNumber: row.period_number,
        startTime: row.start_time ?? null,
        endTime: row.end_time ?? null,
      })
    }
  }

  return {
    periods,
    sections: [...sections.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    slots: [...slots.values()].sort((a, b) => a.periodNumber - b.periodNumber),
    days: [...new Set(periods.map(r => r.day_of_week))].sort((a, b) => a - b),
  }
}

export async function publishVersion(schoolId: string, actorId: string, versionId: string) {
  const version = must(await supabase.from('timetable_versions')
    .select('*').eq('id', versionId).eq('school_id', schoolId).maybeSingle(), 'timetable version')

  if (version.status !== 'draft') {
    throw conflict('not_a_draft', `This version is ${version.status}. Only a draft can be published.`)
  }

  // Who is about to have their week changed, captured before the swap.
  const { data: before } = await supabase.from('timetable_periods')
    .select('teacher_id').eq('school_id', schoolId).not('teacher_id', 'is', null)
  const { data: after } = await supabase.from('timetable_draft_periods')
    .select('teacher_id').eq('version_id', versionId).not('teacher_id', 'is', null)

  const { data: written, error } = await supabase.rpc('timetable_publish_draft', {
    p_version_id: versionId, p_actor: actorId,
  })
  if (error) throw badRequest('publish_failed', error.message)

  const affected = new Set<string>([
    ...(before ?? []).map(r => r.teacher_id),
    ...(after ?? []).map(r => r.teacher_id),
  ].filter(Boolean) as string[])

  if (affected.size) {
    await notify({
      schoolId, userIds: [...affected], type: 'timetable_published',
      title: 'The timetable has changed',
      message: `A new timetable ("${version.label}") is now in effect. Check your week.`,
      link: '/timetable/my-week',
      relatedEntityType: 'timetable_version', relatedEntityId: versionId,
    })
  }

  await audit(schoolId, actorId, 'publish', 'timetable_version', versionId, {
    rows: Number(written ?? 0), teachers_notified: affected.size,
  })

  return { published: Number(written ?? 0), teachersNotified: affected.size }
}

export async function rollbackVersion(schoolId: string, actorId: string, versionId: string) {
  const { data, error } = await supabase.rpc('timetable_rollback_version', {
    p_version_id: versionId, p_actor: actorId,
  })
  if (error) throw badRequest('rollback_failed', error.message)
  return { restored: Number(data ?? 0) }
}

export async function discardDraft(schoolId: string, actorId: string, versionId: string) {
  const version = must(await supabase.from('timetable_versions')
    .select('status').eq('id', versionId).eq('school_id', schoolId).maybeSingle(), 'timetable version')
  if (version.status !== 'draft') {
    throw conflict('not_a_draft', 'Only a draft can be discarded.')
  }
  await supabase.from('timetable_draft_periods').delete().eq('version_id', versionId)
  await supabase.from('timetable_versions').delete().eq('id', versionId)
  await audit(schoolId, actorId, 'discard', 'timetable_version', versionId, {})
  return { ok: true }
}

// ── live editing ────────────────────────────────────────────────

/**
 * Check one proposed cell change, and offer a way out.
 *
 * "Conflict!" on its own is what makes people stop using a validated
 * grid and go back to Excel. suggestSwaps turns it into "swap this with
 * Thursday period 5 and everything fits".
 */
export async function validateMove(
  schoolId: string,
  input: { sectionId: string; day: number; periodNumber: number; subjectId?: string | null; teacherId?: string | null },
) {
  const groups = await generationGroups(schoolId)
  const groupIndex = groups.findIndex(g => g.sectionIds.includes(input.sectionId) && g.days.includes(input.day))
  const group = groups[groupIndex]
  if (!group) {
    throw badRequest('unknown_section', 'That section has no day template, so its slots cannot be checked.')
  }

  const context = await buildEngineInput(schoolId, group, { allGroups: groups, groupIndex })

  const { data: live } = await supabase.from('timetable_periods')
    .select('section_id, day_of_week, period_number, subject_id, teacher_id, room_id, is_locked')
    .eq('school_id', schoolId).eq('is_break', false)
    .in('section_id', group.sectionIds).in('day_of_week', group.days)

  const entries: EngineEntry[] = (live ?? [])
    .filter(r => r.subject_id && r.teacher_id)
    .map(r => ({
      sectionId: r.section_id, day: r.day_of_week, periodNumber: r.period_number,
      subjectId: r.subject_id, teacherUserId: r.teacher_id, roomId: r.room_id ?? null,
      isLocked: !!r.is_locked,
    }))

  const index = entries.findIndex(
    e => e.sectionId === input.sectionId && e.day === input.day && e.periodNumber === input.periodNumber,
  )
  if (input.subjectId && input.teacherId) {
    const replacement: EngineEntry = {
      sectionId: input.sectionId, day: input.day, periodNumber: input.periodNumber,
      subjectId: input.subjectId, teacherUserId: input.teacherId, roomId: null,
    }
    if (index >= 0) entries[index] = replacement
    else entries.push(replacement)
  } else if (index >= 0) {
    entries.splice(index, 1)
  }

  const conflicts = detectConflicts(entries, context.input)
    .filter(c => c.cells.some(cell => cell.sectionId === input.sectionId) || !c.cells.length)
    .map(c => ({ ...c, message: humanizeIssue(c, context) }))

  const suggestions = conflicts.some(c => c.severity === 'block')
    ? suggestSwaps(entries, context.input, {
        sectionId: input.sectionId, day: input.day, periodNumber: input.periodNumber,
      }).map(s => ({
        ...s,
        description: `${s.description} (${DAY_NAMES[s.swapWith.day]} period ${s.swapWith.periodNumber})`,
      }))
    : []

  return {
    ok: !conflicts.some(c => c.severity === 'block'),
    conflicts,
    suggestions,
  }
}

/**
 * Conflicts in the live timetable, for the pre-publish checklist.
 *
 * Two different questions, deliberately answered separately.
 *
 * The engine answers the slot-level ones — a teacher in two rooms at
 * once, a room over capacity, too long a run, a blocked slot — and for
 * those each day-shape is checked on its own days. Its demands are taken
 * from what is actually on the grid rather than from a split of the
 * plan, because splitting is a *generation* decision about what to place;
 * applying it to a grid that already exists just measures the grid
 * against a hypothesis it was never built to satisfy. That produced 358
 * phantom "quota is 7, placed 8" conflicts on a school whose timetable
 * was in fact correct.
 *
 * The quota question — is this section actually getting its five Maths
 * periods a week — is asked once, across the whole week, against
 * class_subject_plan. That is the level it means something at.
 */
export async function liveConflicts(schoolId: string) {
  const groups = await generationGroups(schoolId)
  const out: { group: string; conflicts: EngineConflict[] }[] = []

  for (const [index, group] of groups.entries()) {
    const context = await buildEngineInput(schoolId, group, { allGroups: groups, groupIndex: index })

    const live = await fetchAll<any>((from, to) => supabase.from('timetable_periods')
      .select('section_id, day_of_week, period_number, subject_id, teacher_id, room_id, is_locked')
      .eq('school_id', schoolId).eq('is_break', false)
      .in('section_id', group.sectionIds).in('day_of_week', group.days)
      .range(from, to), 'timetable periods')

    const entries: EngineEntry[] = live
      .filter(r => r.subject_id && r.teacher_id)
      .map(r => ({
        sectionId: r.section_id, day: r.day_of_week, periodNumber: r.period_number,
        subjectId: r.subject_id, teacherUserId: r.teacher_id, roomId: r.room_id ?? null,
      }))

    // Demands = what is actually placed, so the quota codes stay quiet and
    // only the slot-level findings survive.
    const placed = new Map<string, Map<string, { count: number; teacherUserId: string }>>()
    for (const e of entries) {
      const bySubject = placed.get(e.sectionId) ?? new Map()
      const hit = bySubject.get(e.subjectId)
      if (hit) hit.count++
      else bySubject.set(e.subjectId, { count: 1, teacherUserId: e.teacherUserId })
      placed.set(e.sectionId, bySubject)
    }
    const actualInput: EngineInput = {
      ...context.input,
      sections: context.input.sections.map(section => ({
        ...section,
        demands: [...(placed.get(section.sectionId) ?? new Map()).entries()].map(([subjectId, v]) => {
          const original = section.demands.find(d => d.subjectId === subjectId)
          return {
            subjectId,
            teacherUserId: v.teacherUserId,
            periodsPerWeek: v.count,
            doublePeriods: 0,
            roomType: original?.roomType ?? null,
            placement: original?.placement ?? null,
          }
        }),
      })),
    }

    out.push({
      group: group.templateName,
      conflicts: detectConflicts(entries, actualInput)
        .map(c => ({ ...c, message: humanizeIssue(c, context) })),
    })
  }

  // ── the weekly quota, asked once ──────────────────────────────
  const [planRows, gridRows, sectionRows, subjectRows] = await Promise.all([
    fetchAll<any>((f, t) => supabase.from('class_subject_plan')
      .select('section_id, class_id, subject_id, weekly_periods')
      .eq('school_id', schoolId).range(f, t), 'plan'),
    fetchAll<any>((f, t) => supabase.from('timetable_periods')
      .select('section_id, subject_id').eq('school_id', schoolId).eq('is_break', false)
      .not('subject_id', 'is', null).range(f, t), 'grid'),
    fetchAll<any>((f, t) => supabase.from('sections')
      .select('id, name, class_id, classes(name)').eq('school_id', schoolId).range(f, t), 'sections'),
    fetchAll<any>((f, t) => supabase.from('subjects')
      .select('id, name').eq('school_id', schoolId).range(f, t), 'subjects'),
  ])

  const labelOf = new Map(sectionRows.map(s =>
    [s.id, `${(s as any).classes?.name ?? ''}-${s.name}`.replace(/^-/, '')]))
  const subjectOf = new Map(subjectRows.map(s => [s.id, s.name]))

  const actual = new Map<string, number>()
  for (const r of gridRows) {
    const key = `${r.section_id}|${r.subject_id}`
    actual.set(key, (actual.get(key) ?? 0) + 1)
  }

  const quota: EngineConflict[] = []
  for (const row of planRows) {
    if (!row.section_id) continue
    const key = `${row.section_id}|${row.subject_id}`
    const placed = actual.get(key) ?? 0
    if (placed === row.weekly_periods) continue
    quota.push({
      code: placed < row.weekly_periods ? 'QUOTA_UNMET' : 'QUOTA_EXCEEDED',
      severity: 'block',
      message: `${labelOf.get(row.section_id) ?? 'A section'} is scheduled ${placed} period(s) of ` +
        `${subjectOf.get(row.subject_id) ?? 'a subject'} a week, against a plan of ${row.weekly_periods}`,
      cells: [],
    } as EngineConflict)
  }
  if (quota.length) out.push({ group: 'Weekly quotas', conflicts: quota })

  const all = out.flatMap(g => g.conflicts)
  return {
    groups: out,
    totals: {
      blocking: all.filter(c => c.severity === 'block').length,
      warnings: all.filter(c => c.severity === 'warn').length,
      info: all.filter(c => c.severity === 'info').length,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// Editing a timetable, without editing the live one
// ═══════════════════════════════════════════════════════════════
//
// The published timetable is what the whole school is working from this
// minute: a teacher looking at their phone between periods, the cover
// queue, the arrangement register. Editing it in place means every one
// of those changes under somebody mid-glance, with no version to roll
// back to and nothing to review before it happens — and it happened,
// through the workload screen's reassign button, which rewrote a live
// period with no record beyond an audit line.
//
// So the live grid is read-only, and changing it is: clone it to a
// draft, edit the draft with the conflicts and the summary in front of
// you, publish when it is right. Publishing already snapshots what it
// replaced, so the whole thing is one click to undo.

/** Next free "v<n>" for this school, so versions read in order. */
async function nextVersionLabel(schoolId: string): Promise<string> {
  const { data } = await supabase.from('timetable_versions')
    .select('label').eq('school_id', schoolId)
  let highest = 1
  for (const row of data ?? []) {
    const match = /^v(\d+)\b/i.exec(String(row.label ?? '').trim())
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `v${highest + 1}`
}

export async function cloneActiveToDraft(
  schoolId: string, actorId: string, options: { label?: string } = {},
) {
  const { data: openDraft } = await supabase.from('timetable_versions')
    .select('id, label').eq('school_id', schoolId).eq('status', 'draft').limit(1).maybeSingle()
  if (openDraft) {
    throw conflict('draft_exists',
      `There is already an unpublished draft ("${openDraft.label}"). Publish or discard it before starting another.`,
      { versionId: openDraft.id })
  }

  const live = await fetchAll<any>((from, to) => supabase.from('timetable_periods')
    .select(`
      class_id, section_id, day_of_week, period_number, start_time, end_time,
      subject_id, subject_name, teacher_id, room_id, is_break, is_locked, is_double_part
    `)
    .eq('school_id', schoolId).range(from, to), 'timetable periods')

  if (!live.length) {
    throw badRequest('nothing_to_clone',
      'There is no live timetable to copy. Import or generate one first.')
  }

  const label = options.label?.trim() || await nextVersionLabel(schoolId)

  const version = must(await supabase.from('timetable_versions').insert({
    school_id: schoolId,
    label,
    status: 'draft',
    // 'manual' is the existing vocabulary for a timetable somebody made
    // by hand, which is what a clone exists to become.
    source: 'manual',
    created_by: actorId,
  }).select('id, label').single(), 'create draft version')

  const rows = live.map(row => ({ ...row, school_id: schoolId, version_id: version.id }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('timetable_draft_periods').insert(rows.slice(i, i + 500))
    if (error) {
      // Never leave half a draft behind for somebody to publish.
      await supabase.from('timetable_draft_periods').delete().eq('version_id', version.id)
      await supabase.from('timetable_versions').delete().eq('id', version.id)
      throw badRequest('clone_failed', error.message)
    }
  }

  await audit(schoolId, actorId, 'clone_active', 'timetable_version', version.id, {
    label: version.label, rows: rows.length,
  })

  return { versionId: version.id, label: version.label, rowsCopied: rows.length }
}

/** The draft this edit is aimed at, or a refusal explaining why not. */
async function editableDraft(schoolId: string, versionId: string) {
  const { data } = await supabase.from('timetable_versions')
    .select('id, label, status').eq('id', versionId).eq('school_id', schoolId).maybeSingle()
  if (!data) throw badRequest('version_not_found', 'That timetable version does not exist.')
  if (data.status !== 'draft') {
    throw conflict('not_a_draft',
      `"${data.label}" is ${data.status}, and a timetable that is live cannot be edited in place. Make a copy to work on instead.`,
      { versionId })
  }
  return data
}

/**
 * Change who teaches one cell of a draft, or clear it.
 *
 * The clash check is against the draft, not the live timetable: the
 * whole point of the copy is that it is diverging from what is live.
 */
export async function updateDraftCell(
  schoolId: string, actorId: string, versionId: string, cellId: string,
  patch: { teacherId?: string | null; roomId?: string | null; subjectId?: string | null },
) {
  await editableDraft(schoolId, versionId)

  const cell = must(await supabase.from('timetable_draft_periods')
    .select('*, classes(name), sections(name)')
    .eq('id', cellId).eq('version_id', versionId).eq('school_id', schoolId).maybeSingle(),
    'draft period')

  if (cell.is_break) {
    throw badRequest('break_not_editable', 'A break has nobody teaching it.')
  }

  const update: Record<string, any> = {}

  if (patch.teacherId !== undefined) {
    if (patch.teacherId) {
      const { data: clash } = await supabase.from('timetable_draft_periods')
        .select('id, subject_name, classes(name), sections(name)')
        .eq('version_id', versionId).eq('teacher_id', patch.teacherId)
        .eq('day_of_week', cell.day_of_week).eq('period_number', cell.period_number)
        .eq('is_break', false).neq('id', cellId).maybeSingle()
      if (clash) {
        const where = [(clash as any).classes?.name, (clash as any).sections?.name].filter(Boolean).join('-')
        throw conflict('teacher_busy',
          `In this draft they already teach ${clash.subject_name} to ${where} in that period.`)
      }
    }
    update.teacher_id = patch.teacherId || null
  }

  if (patch.roomId !== undefined) update.room_id = patch.roomId || null

  // Changing what is taught in a period.
  //
  // subject_name is stored alongside subject_id on purpose — it is what
  // the printed grid and the cover queue read, and it has to survive a
  // subject being renamed or retired later. So both move together;
  // writing the id and leaving the name behind would give a grid that
  // says one thing and a cover sheet that says another.
  const warnings: string[] = []
  if (patch.subjectId !== undefined) {
    if (patch.subjectId) {
      const subject = must(await supabase.from('subjects')
        .select('id, name').eq('id', patch.subjectId).eq('school_id', schoolId).maybeSingle(),
        'subject')
      update.subject_id = subject.id
      update.subject_name = subject.name

      // Whether whoever is standing there can actually teach it is a
      // judgement, not a rule: schools cover Art with whoever is free,
      // and a hard refusal here would just be worked around by clearing
      // the teacher first. So it is said, not enforced.
      const teacherId = update.teacher_id !== undefined ? update.teacher_id : cell.teacher_id
      if (teacherId) {
        const { data: capable } = await supabase.from('teacher_capabilities')
          .select('teacher_id').eq('teacher_id', teacherId)
          .eq('subject_id', patch.subjectId).maybeSingle()
        if (!capable) {
          const { data: who } = await supabase.from('users')
            .select('full_name').eq('id', teacherId).maybeSingle()
          warnings.push(
            `${who?.full_name ?? 'That teacher'} is not listed as teaching ${subject.name}.`)
        }
      }
    } else {
      update.subject_id = null
      update.subject_name = ''
    }
  }

  if (!Object.keys(update).length) return { ok: true, unchanged: true }

  const { error } = await supabase.from('timetable_draft_periods').update(update).eq('id', cellId)
  if (error) throw badRequest('update_failed', error.message)

  await audit(schoolId, actorId, 'edit_draft_cell', 'timetable_version', versionId, {
    cellId, ...update,
  })

  return { ok: true, warnings }
}

/**
 * Move a period to another slot in the same section, swapping with
 * whatever is already there.
 *
 * Confined to one section on purpose: moving a lesson between classes is
 * not a move, it is two separate changes to two different timetables,
 * and doing it in one gesture makes it impossible to describe in the
 * audit log or undo by hand.
 */
export async function moveDraftCell(
  schoolId: string, actorId: string, versionId: string, cellId: string,
  target: { day: number; periodNumber: number },
) {
  await editableDraft(schoolId, versionId)

  const cell = must(await supabase.from('timetable_draft_periods')
    .select('*').eq('id', cellId).eq('version_id', versionId).eq('school_id', schoolId).maybeSingle(),
    'draft period')

  if (cell.is_break) throw badRequest('break_not_movable', 'Breaks are part of the shape of the day.')
  if (cell.day_of_week === target.day && cell.period_number === target.periodNumber) {
    return { ok: true, unchanged: true }
  }

  const { data: occupant } = await supabase.from('timetable_draft_periods')
    .select('*').eq('version_id', versionId).eq('section_id', cell.section_id)
    .eq('day_of_week', target.day).eq('period_number', target.periodNumber).maybeSingle()

  if (occupant?.is_break) {
    throw badRequest('target_is_break', 'That slot is a break for this class.')
  }

  // The times belong to the slot, not to the lesson.
  const slotTimes = occupant
    ? { start_time: occupant.start_time, end_time: occupant.end_time }
    : must(await supabase.from('timetable_draft_periods')
        .select('start_time, end_time').eq('version_id', versionId)
        .eq('day_of_week', target.day).eq('period_number', target.periodNumber)
        .limit(1).maybeSingle(), 'target slot times')

  // Would either teacher end up in two rooms at once? Checked before
  // anything is written, because there is no transaction here.
  const busy = async (teacherId: string | null, day: number, periodNumber: number, ignore: string[]) => {
    if (!teacherId) return null
    const { data } = await supabase.from('timetable_draft_periods')
      .select('id, subject_name, classes(name), sections(name)')
      .eq('version_id', versionId).eq('teacher_id', teacherId)
      .eq('day_of_week', day).eq('period_number', periodNumber)
      .eq('is_break', false).maybeSingle()
    if (!data || ignore.includes(data.id)) return null
    return data
  }

  const ignore = [cellId, occupant?.id].filter(Boolean) as string[]
  const movingClash = await busy(cell.teacher_id, target.day, target.periodNumber, ignore)
  if (movingClash) {
    const where = [(movingClash as any).classes?.name, (movingClash as any).sections?.name].filter(Boolean).join('-')
    throw conflict('teacher_busy',
      `Moving it there would put that teacher in ${where} at the same time.`)
  }
  if (occupant) {
    const swapClash = await busy(occupant.teacher_id, cell.day_of_week, cell.period_number, ignore)
    if (swapClash) {
      const where = [(swapClash as any).classes?.name, (swapClash as any).sections?.name].filter(Boolean).join('-')
      throw conflict('teacher_busy',
        `Swapping would put ${occupant.subject_name}'s teacher in ${where} at the same time.`)
    }
  }

  await supabase.from('timetable_draft_periods').update({
    day_of_week: target.day, period_number: target.periodNumber,
    start_time: slotTimes.start_time, end_time: slotTimes.end_time,
  }).eq('id', cellId)

  if (occupant) {
    await supabase.from('timetable_draft_periods').update({
      day_of_week: cell.day_of_week, period_number: cell.period_number,
      start_time: cell.start_time, end_time: cell.end_time,
    }).eq('id', occupant.id)
  }

  await audit(schoolId, actorId, 'move_draft_cell', 'timetable_version', versionId, {
    cellId, from: { day: cell.day_of_week, period: cell.period_number },
    to: target, swappedWith: occupant?.id ?? null,
  })

  return { ok: true, swapped: !!occupant }
}
