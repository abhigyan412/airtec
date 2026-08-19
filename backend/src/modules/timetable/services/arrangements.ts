import { supabase } from '../../../shared/db/client'
import {
  arrangementManagers, audit, badRequest, conflict, DAY_NAMES, dayOfWeekFor,
  fetchAll, formatTime, must, notify, TimetableError,
} from '../lib/core'

// ═══════════════════════════════════════════════════════════════
// The daily arrangement queue and the substitute ranking ladder.
// ═══════════════════════════════════════════════════════════════
//
// This is the part of the module the school touches every single
// morning, and the part that decides whether the software is trusted.
//
// Why ranking matters more than it looks: in the school this was built
// for, roughly ten teachers are free in any given period, but the free
// time is concentrated in six people — the Dance, Robotics and Games
// specialists carry 5 to 16 periods a week while the class teachers
// carry 44 to 48. "Pick anyone who is free" therefore means the same six
// people cover every absence in the school, and two of them cannot teach
// Class VIII Maths. Subject capability, daily caps and a fairness
// penalty are what stop that.

export interface Candidate {
  teacherId: string
  fullName: string
  score: number
  reasons: string[]
  warnings: string[]
  periodsToday: number
  arrangementsThisMonth: number
  freePeriodsToday: number
  hasBooking: boolean
  bookingPurpose: string | null
}

export interface TeacherState {
  id: string
  fullName: string
  busyPeriods: Set<number>
  coveringPeriods: Set<number>
  totalToday: number
  freeToday: number
  arrangementsThisMonth: number
  didArrangementYesterday: boolean
  constraint: {
    maxPerDay: number
    maxConsecutive: number
    arrangementCapDay: number
    arrangementCapWeek: number
    exempt: boolean
    blocked: Set<string>
  }
  capabilities: Map<string, { priority: number; min: number | null; max: number | null }>
  teachesSections: Set<string>
  classTeacherOf: Set<string>
  arrangementsThisWeek: number
}

/** Case- and spacing-insensitive, so "Social Science" matches "social science". */
const normalizeSubject = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

const DEFAULT_CONSTRAINT = {
  maxPerDay: 8, maxConsecutive: 4, arrangementCapDay: 2,
  arrangementCapWeek: 6, exempt: false, blocked: new Set<string>(),
}

function monthBounds(dateStr: string): [string, string] {
  const [y, m] = dateStr.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${dateStr.slice(0, 7)}-01`, `${dateStr.slice(0, 7)}-${String(last).padStart(2, '0')}`]
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return dt.toISOString().slice(0, 10)
}

function weekBounds(dateStr: string): [string, string] {
  const dow = dayOfWeekFor(dateStr)
  return [addDays(dateStr, -(dow - 1)), addDays(dateStr, 6 - dow)]
}

/**
 * Everything needed to rank substitutes for one date, loaded once.
 *
 * Built as a whole-day snapshot rather than per-arrangement because a
 * heavy Monday means five absences and thirty periods to fill, and
 * ranking each one independently would re-read the same tables thirty
 * times — and, worse, would not see the assignments made seconds
 * earlier, so one substitute could be handed two classes in the same
 * period.
 */
async function loadDayState(schoolId: string, dateStr: string) {
  const dow = dayOfWeekFor(dateStr)
  const [monthStart, monthEnd] = monthBounds(dateStr)
  const [weekStart, weekEnd] = weekBounds(dateStr)
  const yesterday = addDays(dateStr, -1)

  const [
    staffResult, periodsResult, constraintsResult, capabilitiesResult,
    classTeacherResult, absencesResult, arrangementsMonthResult, bookingsResult,
    subjectsResult,
  ] = await Promise.all([
    // Everyone who could stand in front of a class — NOT just users whose
    // role string is 'teacher'. In a real school the vice principal takes
    // two periods of Maths and the librarian takes reading; excluding them
    // because of a role label would hide the very people with free time.
    // Parents and students are the only categories that can never cover.
    supabase.from('users').select('id, full_name, is_active, role')
      .eq('school_id', schoolId)
      .not('role', 'in', '("parent","student")'),
    fetchAll((from, to) => supabase.from('timetable_periods')
      .select('teacher_id, period_number, section_id')
      .eq('school_id', schoolId).eq('day_of_week', dow).eq('is_break', false)
      .range(from, to), 'timetable periods').then(data => ({ data })),
    supabase.from('teacher_constraints').select('*').eq('school_id', schoolId),
    supabase.from('teacher_capabilities').select('*').eq('school_id', schoolId),
    // Homeroom teachers live in class_teacher_assignments, per academic
    // year — sections.class_teacher_id was dropped in 20260801000000.
    // Reading the old column does not return null, it makes PostgREST
    // reject the whole query, which took this entire function down.
    supabase.from('class_teacher_assignments')
      .select('section_id, teacher_id').eq('school_id', schoolId).eq('is_active', true),
    supabase.from('teacher_absences')
      .select('teacher_id').eq('school_id', schoolId).eq('absence_date', dateStr).neq('status', 'cancelled'),
    supabase.from('arrangements')
      .select('substitute_teacher_id, arrangement_date, period_number, status')
      .eq('school_id', schoolId)
      .gte('arrangement_date', monthStart).lte('arrangement_date', monthEnd)
      .not('substitute_teacher_id', 'is', null)
      .in('status', ['assigned', 'acknowledged']),
    supabase.from('period_bookings')
      .select('teacher_id, period_number, purpose')
      .eq('school_id', schoolId).eq('booking_date', dateStr).eq('status', 'active'),
    // Subject names, because a capability cannot always be matched by id.
    supabase.from('subjects').select('id, name').eq('school_id', schoolId),
  ])

  // Who can actually be asked to take a class.
  //
  // Role names do not decide this — a vice principal who takes six
  // periods of Maths belongs in the pool. But neither does "everyone who
  // is not a parent", which is what this was: at a school whose office
  // accounts have never taught anything, the top three suggestions for a
  // Class III Art lesson were the principal, the administrator and the
  // timetable manager, purely because they had nothing on that day and so
  // carried no load penalty.
  //
  // Somebody who teaches at least one period, or has a recorded subject
  // capability, is a teacher. Somebody with neither is an office account.
  const teaches = new Set<string>()
  for (const row of capabilitiesResult.data ?? []) teaches.add(row.teacher_id)
  // The whole week, not just today: a teacher who happens to have nothing
  // on a Wednesday is still a teacher. Paged, because a school's grid
  // runs to thousands of rows and a plain select silently stops at 1,000.
  const weekSlots = await fetchAll<{ teacher_id: string }>((from, to) =>
    supabase.from('timetable_periods')
      .select('teacher_id').eq('school_id', schoolId).eq('is_break', false)
      .not('teacher_id', 'is', null).range(from, to), 'timetable periods')
  for (const row of weekSlots) teaches.add(row.teacher_id)

  const staff = (staffResult.data ?? [])
    .filter(u => u.is_active !== false)
    .filter(u => teaches.has(u.id))
  const state = new Map<string, TeacherState>()
  for (const user of staff) {
    state.set(user.id, {
      id: user.id, fullName: user.full_name,
      busyPeriods: new Set(), coveringPeriods: new Set(),
      totalToday: 0, freeToday: 0,
      arrangementsThisMonth: 0, didArrangementYesterday: false,
      constraint: { ...DEFAULT_CONSTRAINT, blocked: new Set<string>() },
      capabilities: new Map(), teachesSections: new Set(), classTeacherOf: new Set(),
      arrangementsThisWeek: 0,
    })
  }

  for (const row of periodsResult.data ?? []) {
    const teacher = row.teacher_id ? state.get(row.teacher_id) : null
    if (!teacher) continue
    teacher.busyPeriods.add(row.period_number)
    if (row.section_id) teacher.teachesSections.add(row.section_id)
  }

  for (const row of constraintsResult.data ?? []) {
    const teacher = state.get(row.teacher_id)
    if (!teacher) continue
    const blocked = new Set<string>()
    const list = (row.availability && row.availability.blocked) || []
    for (const b of list) blocked.add(`${b.day}:${b.period}`)
    teacher.constraint = {
      maxPerDay: row.max_periods_per_day,
      maxConsecutive: row.max_consecutive,
      arrangementCapDay: row.arrangement_cap_per_day,
      arrangementCapWeek: row.arrangement_cap_per_week,
      exempt: row.exempt_from_arrangements,
      blocked,
    }
  }

  // Capabilities are indexed by subject id AND by normalised subject name.
  //
  // `subjects` is per class in this schema, so "Mathematics" exists as a
  // separate row for every class that teaches it. A capability recorded
  // against Class 6's Mathematics therefore does not match a Class 2
  // Mathematics period by id, and every subject specialist silently
  // vanished from the ranking — the top suggestion for a Class 2 English
  // absence was somebody who merely happened to be free. Matching on name
  // as well costs nothing and fixes it for any school whose subjects are
  // per class.
  const subjectNameOf = new Map<string, string>()
  for (const row of subjectsResult.data ?? []) {
    subjectNameOf.set(row.id, normalizeSubject(row.name))
  }

  for (const row of capabilitiesResult.data ?? []) {
    const teacher = state.get(row.teacher_id)
    if (!teacher) continue
    const capability = {
      priority: row.priority, min: row.min_class_level, max: row.max_class_level,
    }
    teacher.capabilities.set(row.subject_id, capability)
    const name = subjectNameOf.get(row.subject_id)
    if (name) {
      // Keep the strongest claim if a teacher holds the same subject at
      // two class levels with different priorities.
      const existing = teacher.capabilities.get(`name:${name}`)
      if (!existing || capability.priority < existing.priority) {
        teacher.capabilities.set(`name:${name}`, capability)
      }
    }
  }

  for (const row of classTeacherResult.data ?? []) {
    const teacher = row.teacher_id ? state.get(row.teacher_id) : null
    if (teacher) teacher.classTeacherOf.add(row.section_id)
  }

  for (const row of arrangementsMonthResult.data ?? []) {
    const teacher = state.get(row.substitute_teacher_id)
    if (!teacher) continue
    teacher.arrangementsThisMonth++
    if (row.arrangement_date === yesterday) teacher.didArrangementYesterday = true
    if (row.arrangement_date >= weekStart && row.arrangement_date <= weekEnd) teacher.arrangementsThisWeek++
    // Cover already assigned for today occupies the slot as firmly as a
    // timetabled class does. Without this, five absences on one morning
    // would each be offered the same free teacher.
    if (row.arrangement_date === dateStr) teacher.coveringPeriods.add(row.period_number)
  }

  const bookings = new Map<string, string>()
  for (const row of bookingsResult.data ?? []) {
    bookings.set(`${row.teacher_id}:${row.period_number}`, row.purpose)
  }

  const absentToday = new Set((absencesResult.data ?? []).map(a => a.teacher_id))

  // How long the day is, so "their only free period" means something.
  const { data: slotDefs } = await supabase.from('period_slot_defs')
    .select('period_number').eq('school_id', schoolId).eq('kind', 'period')
  let periodsPerDay = 0
  for (const d of slotDefs ?? []) if ((d.period_number ?? 0) > periodsPerDay) periodsPerDay = d.period_number

  for (const teacher of state.values()) {
    teacher.totalToday = teacher.busyPeriods.size + teacher.coveringPeriods.size
    teacher.freeToday = Math.max(0, periodsPerDay - teacher.totalToday)
  }

  return { state, absentToday, bookings, dow, periodsPerDay, subjectNameOf }
}

export type DayState = Awaited<ReturnType<typeof loadDayState>>

/** Would putting this teacher in this period give them too long a run? */
function consecutiveRunWith(teacher: TeacherState, period: number): number {
  const occupied = new Set<number>([...teacher.busyPeriods, ...teacher.coveringPeriods, period])
  let best = 0
  let run = 0
  for (let p = 1; p <= 20; p++) {
    if (occupied.has(p)) { run++; if (run > best) best = run } else run = 0
  }
  return best
}

export interface RankOptions {
  /** Allow candidates who would otherwise be filtered out, flagged. */
  includeIneligible?: boolean
  /** Caller holds arrangement.override_booking. */
  canOverrideBooking?: boolean
}

export function rankCandidates(
  day: DayState,
  arrangement: {
    period_number: number
    section_id: string | null
    subject_id: string | null
    subject_name?: string | null
    absent_teacher_id: string
  },
  classLevel: number | null,
  options: RankOptions = {},
): Candidate[] {
  const out: Candidate[] = []

  for (const teacher of day.state.values()) {
    if (teacher.id === arrangement.absent_teacher_id) continue

    const reasons: string[] = []
    const warnings: string[] = []
    let eligible = true

    // ── hard filters ──────────────────────────────────────────
    if (day.absentToday.has(teacher.id)) continue
    if (teacher.busyPeriods.has(arrangement.period_number)) continue
    if (teacher.coveringPeriods.has(arrangement.period_number)) {
      // Already covering something else this period. Never offerable.
      continue
    }
    if (teacher.constraint.blocked.has(`${day.dow}:${arrangement.period_number}`)) continue

    if (teacher.constraint.exempt) {
      eligible = false
      warnings.push('Exempt from arrangements')
    }
    if (teacher.totalToday >= teacher.constraint.maxPerDay) {
      eligible = false
      warnings.push(`Already at their daily limit of ${teacher.constraint.maxPerDay} periods`)
    }
    if (teacher.arrangementsThisWeek >= teacher.constraint.arrangementCapWeek) {
      eligible = false
      warnings.push(`Already covered ${teacher.arrangementsThisWeek} periods this week`)
    }
    const coveringToday = teacher.coveringPeriods.size
    if (coveringToday >= teacher.constraint.arrangementCapDay) {
      eligible = false
      warnings.push(`Already covering ${coveringToday} period${coveringToday === 1 ? '' : 's'} today`)
    }
    const run = consecutiveRunWith(teacher, arrangement.period_number)
    if (run > teacher.constraint.maxConsecutive) {
      eligible = false
      warnings.push(`Would put them on ${run} periods back to back`)
    }

    if (!eligible && !options.includeIneligible) continue

    // ── scoring ───────────────────────────────────────────────
    let score = 0

    // By id first, then by subject name — see loadDayState.
    const subjectName = arrangement.subject_id
      ? day.subjectNameOf.get(arrangement.subject_id)
      : (arrangement.subject_name ? normalizeSubject(arrangement.subject_name) : undefined)
    const capability = (arrangement.subject_id ? teacher.capabilities.get(arrangement.subject_id) : undefined)
      ?? (subjectName ? teacher.capabilities.get(`name:${subjectName}`) : undefined)
    if (capability) {
      const inRange =
        classLevel == null ||
        ((capability.min == null || classLevel >= capability.min) &&
         (capability.max == null || classLevel <= capability.max))

      if (capability.priority === 1) {
        score += 100
        reasons.push('Teaches this subject')
      } else if (capability.priority === 2) {
        score += 80
        reasons.push('Can teach this subject')
      } else {
        score += 60
        reasons.push('Can supervise this subject')
      }
      if (inRange) {
        score += 10
        if (classLevel != null) reasons.push('Teaches this class level')
      } else {
        warnings.push('Outside the class levels they normally teach')
      }
    }

    if (arrangement.section_id && teacher.teachesSections.has(arrangement.section_id)) {
      score += 40
      reasons.push('Already teaches this section')
    }
    if (arrangement.section_id && teacher.classTeacherOf.has(arrangement.section_id)) {
      score += 30
      reasons.push('Class teacher of this section')
    }

    // ── fairness and protection ───────────────────────────────
    score -= 2 * teacher.arrangementsThisMonth
    if (teacher.arrangementsThisMonth > 0) {
      reasons.push(`${teacher.arrangementsThisMonth} arrangement${teacher.arrangementsThisMonth === 1 ? '' : 's'} this month`)
    }

    score -= 3 * teacher.totalToday
    reasons.push(`${teacher.totalToday} period${teacher.totalToday === 1 ? '' : 's'} today`)

    if (teacher.didArrangementYesterday) {
      score -= 10
      reasons.push('Covered a class yesterday')
    }

    if (teacher.freeToday <= 1) {
      score -= 15
      warnings.push('This is their only free period today')
    }

    // A teacher's own booked free period. Deliberately a very large
    // penalty rather than a hard filter: on a morning when half the
    // staff are out, "last resort" has to still be reachable, but it
    // must never be the default suggestion. Overriding it is a separate
    // permission the Timetable Manager does not hold.
    const bookingPurpose = day.bookings.get(`${teacher.id}:${arrangement.period_number}`) ?? null
    if (bookingPurpose) {
      score -= 1000
      warnings.push(`Reserved this period for ${bookingPurpose.replace(/_/g, ' ')}`)
      if (!options.canOverrideBooking) eligible = false
    }

    if (!eligible && !options.includeIneligible) continue

    out.push({
      teacherId: teacher.id,
      fullName: teacher.fullName,
      score: Math.round(score),
      reasons,
      warnings,
      periodsToday: teacher.totalToday,
      arrangementsThisMonth: teacher.arrangementsThisMonth,
      freePeriodsToday: teacher.freeToday,
      hasBooking: !!bookingPurpose,
      bookingPurpose,
    })
  }

  return out.sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName))
}

// ── queries ─────────────────────────────────────────────────────

export async function listArrangements(schoolId: string, dateStr: string) {
  const { data, error } = await supabase.from('arrangements')
    .select(`
      *,
      classes(name), sections(name),
      absent:absent_teacher_id(id, full_name),
      substitute:substitute_teacher_id(id, full_name)
    `)
    .eq('school_id', schoolId).eq('arrangement_date', dateStr)
    .order('period_number', { ascending: true })

  if (error) throw badRequest('query_failed', error.message)

  return (data ?? []).map(row => ({
    ...row,
    class_name: (row as any).classes?.name ?? null,
    section_name: (row as any).sections?.name ?? null,
    absent_teacher_name: (row as any).absent?.full_name ?? null,
    substitute_teacher_name: (row as any).substitute?.full_name ?? null,
    time_label: `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
  }))
}

export async function candidatesFor(schoolId: string, arrangementId: string, options: RankOptions = {}) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(numeric_level)')
    .eq('id', arrangementId).eq('school_id', schoolId).maybeSingle(),
    'arrangement')

  const day = await loadDayState(schoolId, arrangement.arrangement_date)
  const classLevel = (arrangement as any).classes?.numeric_level ?? null
  return rankCandidates(day, arrangement as any, classLevel, options)
}

// ── mutations ───────────────────────────────────────────────────

export async function assignSubstitute(
  schoolId: string,
  actorId: string,
  arrangementId: string,
  substituteId: string,
  options: { canOverrideBooking?: boolean; overrideReason?: string } = {},
) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(name, numeric_level), sections(name)')
    .eq('id', arrangementId).eq('school_id', schoolId).maybeSingle(),
    'arrangement')

  if (arrangement.status === 'cancelled') {
    throw conflict('already_cancelled', 'This arrangement has been cancelled.')
  }

  // Re-rank at assign time rather than trusting the list the manager is
  // looking at. On a busy morning that list may be a minute old, and in
  // that minute the same teacher may have been given another class.
  const day = await loadDayState(schoolId, arrangement.arrangement_date)
  const classLevel = (arrangement as any).classes?.numeric_level ?? null
  const ranked = rankCandidates(day, arrangement as any, classLevel, {
    includeIneligible: true,
    canOverrideBooking: options.canOverrideBooking,
  })
  const chosen = ranked.find(c => c.teacherId === substituteId)

  if (!chosen) {
    throw conflict('substitute_unavailable',
      'That teacher is no longer free for this period — they may have just been assigned elsewhere.')
  }
  if (chosen.hasBooking && !options.canOverrideBooking) {
    throw conflict('booking_protected',
      `${chosen.fullName} has reserved this period for ${(chosen.bookingPurpose || '').replace(/_/g, ' ')}. Overriding a reserved period needs a principal.`)
  }

  const blocking = chosen.warnings.filter(w => !w.startsWith('Reserved this period'))
  const reason = [...chosen.reasons].join(' · ')

  const { error } = await supabase.from('arrangements').update({
    substitute_teacher_id: substituteId,
    status: 'assigned',
    reason,
    rank_score: chosen.score,
    assigned_by: actorId,
    assigned_at: new Date().toISOString(),
    // Assigning afresh clears any previous decline so the reminder
    // clock restarts rather than firing instantly on a stale timestamp.
    declined_at: null,
    decline_reason: null,
    acknowledged_at: null,
    reminder_sent_at: null,
    escalated_at: null,
  }).eq('id', arrangementId)

  if (error) throw badRequest('assign_failed', error.message)

  if (chosen.hasBooking && options.canOverrideBooking) {
    await supabase.from('period_bookings').update({
      status: 'overridden',
      overridden_by: actorId,
      overridden_at: new Date().toISOString(),
      override_reason: options.overrideReason ?? 'Cover required',
    }).eq('teacher_id', substituteId)
      .eq('booking_date', arrangement.arrangement_date)
      .eq('period_number', arrangement.period_number)
      .eq('status', 'active')

    await notify({
      schoolId, userIds: [substituteId], type: 'booking_overridden',
      title: 'Your reserved period has been taken for cover',
      message: `${label(arrangement)} on ${DAY_NAMES[arrangement.day_of_week]} needed cover. Reason given: ${options.overrideReason ?? 'cover required'}.`,
      link: '/timetable/my-week', relatedEntityType: 'arrangement', relatedEntityId: arrangementId,
    })
  }

  await notify({
    schoolId, userIds: [substituteId], type: 'arrangement_assigned',
    title: `You are covering ${label(arrangement)}`,
    message: `Period ${arrangement.period_number} (${formatTime(arrangement.start_time)}) on ${prettyDate(arrangement.arrangement_date)}, standing in for a colleague. Please acknowledge.`,
    link: '/timetable/my-week', relatedEntityType: 'arrangement', relatedEntityId: arrangementId,
  })

  await audit(schoolId, actorId, 'assign', 'arrangement', arrangementId, {
    substitute: substituteId, score: chosen.score, reason,
    overrode_booking: chosen.hasBooking, warnings: blocking,
  })

  return { ...arrangement, substitute_teacher_id: substituteId, status: 'assigned', reason, warnings: blocking }
}

export async function unassign(schoolId: string, actorId: string, arrangementId: string) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(name), sections(name)')
    .eq('id', arrangementId).eq('school_id', schoolId).maybeSingle(), 'arrangement')

  const previous = arrangement.substitute_teacher_id

  const { error } = await supabase.from('arrangements').update({
    substitute_teacher_id: null, status: 'unassigned', reason: null, rank_score: null,
    assigned_by: null, assigned_at: null, acknowledged_at: null,
    reminder_sent_at: null, escalated_at: null,
  }).eq('id', arrangementId)
  if (error) throw badRequest('unassign_failed', error.message)

  if (previous) {
    await notify({
      schoolId, userIds: [previous], type: 'arrangement_cancelled',
      title: 'Cover cancelled',
      message: `You are no longer needed for ${label(arrangement)}, period ${arrangement.period_number} on ${prettyDate(arrangement.arrangement_date)}.`,
      link: '/timetable/my-week', relatedEntityType: 'arrangement', relatedEntityId: arrangementId,
    })
  }
  await audit(schoolId, actorId, 'unassign', 'arrangement', arrangementId, { previous_substitute: previous })
  return { ok: true }
}

/**
 * A substitute accepting the class.
 *
 * Own-record only: the arrangement is looked up by id AND by the
 * caller's own user id, so passing somebody else's arrangement id
 * returns a 404 rather than acknowledging on their behalf.
 */
export async function acknowledge(schoolId: string, actorId: string, arrangementId: string) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(name), sections(name)')
    .eq('id', arrangementId).eq('school_id', schoolId)
    .eq('substitute_teacher_id', actorId).maybeSingle(),
    'arrangement assigned to you')

  if (arrangement.status === 'acknowledged') return arrangement
  if (arrangement.status === 'cancelled') {
    throw conflict('already_cancelled', 'This cover has been cancelled.')
  }

  const { error } = await supabase.from('arrangements')
    .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
    .eq('id', arrangementId)
  if (error) throw badRequest('acknowledge_failed', error.message)

  await audit(schoolId, actorId, 'acknowledge', 'arrangement', arrangementId, {})
  return { ...arrangement, status: 'acknowledged' }
}

export async function decline(schoolId: string, actorId: string, arrangementId: string, reason: string) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(name), sections(name)')
    .eq('id', arrangementId).eq('school_id', schoolId)
    .eq('substitute_teacher_id', actorId).maybeSingle(),
    'arrangement assigned to you')

  const { error } = await supabase.from('arrangements').update({
    status: 'declined', declined_at: new Date().toISOString(), decline_reason: reason,
  }).eq('id', arrangementId)
  if (error) throw badRequest('decline_failed', error.message)

  // Straight to the people who can do something about it. A declined
  // period with nobody watching is an unsupervised class.
  const managers = await arrangementManagers(schoolId)
  await notify({
    schoolId, userIds: managers, type: 'arrangement_declined',
    title: 'Cover declined',
    message: `${label(arrangement)} period ${arrangement.period_number} on ${prettyDate(arrangement.arrangement_date)} was declined: ${reason}`,
    link: `/timetable/arrangements?date=${arrangement.arrangement_date}`,
    relatedEntityType: 'arrangement', relatedEntityId: arrangementId,
  })

  await audit(schoolId, actorId, 'decline', 'arrangement', arrangementId, { reason })
  return { ok: true }
}

/**
 * The absent teacher turns up after all.
 *
 * Blocked once the period has started: a substitute who has already
 * walked into the room should not find out mid-lesson that they were
 * stood down, and the register needs to record what actually happened
 * rather than what was planned.
 */
export async function cancelArrangement(
  schoolId: string, actorId: string, arrangementId: string, reason: string, isManager: boolean,
) {
  const arrangement = must(await supabase.from('arrangements')
    .select('*, classes(name), sections(name)')
    .eq('id', arrangementId).eq('school_id', schoolId).maybeSingle(), 'arrangement')

  const isAbsentTeacher = arrangement.absent_teacher_id === actorId
  if (!isManager && !isAbsentTeacher) {
    throw new TimetableError(403, 'forbidden',
      'Only the teacher who was away, or the timetable manager, can cancel cover.')
  }

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const nowTime = now.toTimeString().slice(0, 8)
  if (arrangement.arrangement_date < today ||
      (arrangement.arrangement_date === today && arrangement.start_time && arrangement.start_time <= nowTime)) {
    throw conflict('period_started',
      'This period has already started. It stays in the register as it was actually taught.')
  }

  if (arrangement.status === 'acknowledged' && !isManager) {
    throw conflict('needs_manager',
      'The substitute has already accepted this class. Ask the timetable manager to cancel it so they are told properly.')
  }

  const { error } = await supabase.from('arrangements').update({
    status: 'cancelled', cancelled_at: now.toISOString(), cancel_reason: reason,
  }).eq('id', arrangementId)
  if (error) throw badRequest('cancel_failed', error.message)

  const recipients = new Set<string>(await arrangementManagers(schoolId))
  if (arrangement.substitute_teacher_id) recipients.add(arrangement.substitute_teacher_id)
  recipients.delete(actorId)

  await notify({
    schoolId, userIds: [...recipients], type: 'arrangement_cancelled',
    title: 'Cover no longer needed',
    message: `${label(arrangement)} period ${arrangement.period_number} on ${prettyDate(arrangement.arrangement_date)} — the class teacher is back. ${reason}`,
    link: `/timetable/arrangements?date=${arrangement.arrangement_date}`,
    relatedEntityType: 'arrangement', relatedEntityId: arrangementId,
  })

  await audit(schoolId, actorId, 'cancel', 'arrangement', arrangementId, { reason, by_absent_teacher: isAbsentTeacher })
  return { ok: true }
}

// ── register and fairness ───────────────────────────────────────

export async function register(schoolId: string, from: string, to: string) {
  const { data, error } = await supabase.from('arrangements')
    .select(`
      arrangement_date, period_number, start_time, status, reason,
      subject_name, classes(name), sections(name),
      absent:absent_teacher_id(full_name), substitute:substitute_teacher_id(full_name)
    `)
    .eq('school_id', schoolId)
    .gte('arrangement_date', from).lte('arrangement_date', to)
    .order('arrangement_date', { ascending: false })
    .order('period_number', { ascending: true })

  if (error) throw badRequest('query_failed', error.message)

  return (data ?? []).map(row => ({
    date: row.arrangement_date,
    period: row.period_number,
    time: formatTime(row.start_time),
    class: `${(row as any).classes?.name ?? ''} ${(row as any).sections?.name ?? ''}`.trim(),
    subject: row.subject_name,
    absent: (row as any).absent?.full_name ?? '',
    substitute: (row as any).substitute?.full_name ?? '',
    status: row.status,
    reason: row.reason,
  }))
}

/**
 * Who is carrying the cover, and who is answering.
 *
 * The acknowledgement rate is the number that changes behaviour: once a
 * school can see that one person accepts every class within minutes and
 * another never responds at all, the escalation rules stop being the
 * only lever.
 */
export async function fairnessStats(schoolId: string, month: string) {
  const [from, to] = monthBounds(`${month}-01`)

  const [arrangementsResult, staffResult] = await Promise.all([
    supabase.from('arrangements')
      .select('substitute_teacher_id, absent_teacher_id, status, assigned_at, acknowledged_at, reason')
      .eq('school_id', schoolId).gte('arrangement_date', from).lte('arrangement_date', to),
    supabase.from('users').select('id, full_name').eq('school_id', schoolId)
      .not('role', 'in', '("parent","student")'),
  ])

  const nameOf = new Map((staffResult.data ?? []).map(u => [u.id, u.full_name]))
  const rows = arrangementsResult.data ?? []

  const byTeacher = new Map<string, {
    teacherId: string; name: string; covered: number; acknowledged: number;
    declined: number; subjectMatched: number; absences: number; ackMinutes: number[]
  }>()

  const get = (id: string) => {
    let entry = byTeacher.get(id)
    if (!entry) {
      entry = {
        teacherId: id, name: nameOf.get(id) ?? 'Unknown', covered: 0, acknowledged: 0,
        declined: 0, subjectMatched: 0, absences: 0, ackMinutes: [],
      }
      byTeacher.set(id, entry)
    }
    return entry
  }

  let unfilled = 0
  for (const row of rows) {
    if (row.absent_teacher_id) get(row.absent_teacher_id).absences++
    if (row.status === 'unassigned') unfilled++
    if (!row.substitute_teacher_id) continue

    const entry = get(row.substitute_teacher_id)
    if (row.status === 'declined') { entry.declined++; continue }
    if (row.status === 'cancelled') continue

    entry.covered++
    if (row.reason && /Teaches this subject|Can teach this subject/.test(row.reason)) entry.subjectMatched++
    if (row.status === 'acknowledged') {
      entry.acknowledged++
      if (row.assigned_at && row.acknowledged_at) {
        entry.ackMinutes.push(
          (new Date(row.acknowledged_at).getTime() - new Date(row.assigned_at).getTime()) / 60000,
        )
      }
    }
  }

  const teachers = [...byTeacher.values()]
    .map(t => ({
      teacherId: t.teacherId, name: t.name,
      covered: t.covered, acknowledged: t.acknowledged, declined: t.declined,
      absences: t.absences,
      subjectMatchRate: t.covered ? Math.round((t.subjectMatched / t.covered) * 100) : null,
      acknowledgeRate: t.covered ? Math.round((t.acknowledged / t.covered) * 100) : null,
      medianAckMinutes: median(t.ackMinutes),
    }))
    .sort((a, b) => b.covered - a.covered || a.name.localeCompare(b.name))

  return {
    month,
    totals: {
      arrangements: rows.length,
      unfilled,
      covered: rows.filter(r => r.substitute_teacher_id && r.status !== 'cancelled').length,
      declined: rows.filter(r => r.status === 'declined').length,
    },
    teachers,
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(value)
}

// ── labels ──────────────────────────────────────────────────────

function label(arrangement: any): string {
  const className = arrangement.classes?.name ?? ''
  const sectionName = arrangement.sections?.name ?? ''
  const where = `${className}${sectionName ? `-${sectionName}` : ''}`.trim()
  return arrangement.subject_name ? `${where} ${arrangement.subject_name}` : where || 'a class'
}

function prettyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAY_NAMES[dayOfWeekFor(dateStr)] ?? ''} ${d} ${months[date.getUTCMonth()]}`.trim()
}

export { loadDayState, monthBounds, addDays, weekBounds }
