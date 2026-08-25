import { supabase } from '../../../shared/db/client'
import { toLocalDateStr } from '../../../shared/utils/academicCalendar'
import {
  badRequest, DAY_NAMES, dayOfWeekFor, fetchAll, formatTime, getSettings,
} from '../lib/core'
import { PURPOSE_LABELS } from './bookings'
import { NOT_TEACHING_STATUSES } from './absences'

// ═══════════════════════════════════════════════════════════════
// Reading the timetable, in the shapes a school actually asks for.
// ═══════════════════════════════════════════════════════════════
//
// Five views, because a school genuinely uses five:
//   • the class grid, which goes on the classroom wall;
//   • the teacher grid, which goes in the teacher's diary;
//   • the master grid, which lives on the office wall;
//   • the free-teacher matrix, which is the sheet arrangements are
//     actually done from by hand today;
//   • "my week", which is what a teacher opens on their phone.
//
// Arrangements are an OVERLAY, never an edit. The master grid stays
// exactly as published and the day's substitutions are layered on top,
// so the printed timetable and the screen never disagree about what the
// timetable IS — only about who is standing in today.

export interface Cell {
  id: string
  dayOfWeek: number
  periodNumber: number
  startTime: string
  endTime: string
  timeLabel: string
  subjectId: string | null
  subjectName: string
  teacherId: string | null
  teacherName: string | null
  roomName: string | null
  isBreak: boolean
  isLocked: boolean
  /** Set when today's cover differs from the published grid. */
  covering?: {
    arrangementId: string
    substituteId: string | null
    substituteName: string | null
    absentName: string | null
    status: string
  } | null
}

interface OverlayOptions {
  /** Layer this date's arrangements over the grid. */
  date?: string | null
}

async function loadOverlay(schoolId: string, dateStr: string) {
  const { data } = await supabase.from('arrangements')
    .select(`
      id, timetable_period_id, status, substitute_teacher_id,
      substitute:substitute_teacher_id(full_name), absent:absent_teacher_id(full_name)
    `)
    .eq('school_id', schoolId).eq('arrangement_date', dateStr)
    .neq('status', 'cancelled')

  const byPeriod = new Map<string, Cell['covering']>()
  for (const row of data ?? []) {
    if (!row.timetable_period_id) continue
    byPeriod.set(row.timetable_period_id, {
      arrangementId: row.id,
      substituteId: row.substitute_teacher_id,
      substituteName: (row as any).substitute?.full_name ?? null,
      absentName: (row as any).absent?.full_name ?? null,
      status: row.status,
    })
  }
  return byPeriod
}

function toCell(row: any, overlay?: Map<string, Cell['covering']>): Cell {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    periodNumber: row.period_number,
    startTime: row.start_time,
    endTime: row.end_time,
    timeLabel: `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
    subjectId: row.subject_id ?? null,
    subjectName: row.subject_name,
    teacherId: row.teacher_id ?? null,
    teacherName: row.teacher?.full_name ?? null,
    roomName: row.room?.name ?? null,
    isBreak: !!row.is_break,
    isLocked: !!row.is_locked,
    covering: overlay ? overlay.get(row.id) ?? null : undefined,
  }
}

const SELECT = `
  id, day_of_week, period_number, start_time, end_time,
  subject_id, subject_name, teacher_id, room_id, is_break, is_locked, is_double_part,
  class_id, section_id,
  teacher:teacher_id(id, full_name), room:room_id(name),
  classes(name), sections(name)
`

// ── class / section ─────────────────────────────────────────────

export async function sectionView(schoolId: string, sectionId: string, options: OverlayOptions = {}) {
  const { data, error } = await supabase.from('timetable_periods')
    .select(SELECT)
    .eq('school_id', schoolId).eq('section_id', sectionId)
    .order('day_of_week').order('period_number')
  if (error) throw badRequest('query_failed', error.message)

  const overlay = options.date ? await loadOverlay(schoolId, options.date) : undefined
  const rows = data ?? []

  return {
    sectionId,
    className: (rows[0] as any)?.classes?.name ?? null,
    sectionName: (rows[0] as any)?.sections?.name ?? null,
    periods: periodAxis(rows),
    cells: rows.map(r => toCell(r, overlay)),
  }
}

// ── teacher ─────────────────────────────────────────────────────

export async function teacherView(schoolId: string, teacherId: string, options: OverlayOptions = {}) {
  const { data, error } = await supabase.from('timetable_periods')
    .select(SELECT)
    .eq('school_id', schoolId).eq('teacher_id', teacherId).eq('is_break', false)
    .order('day_of_week').order('period_number')
  if (error) throw badRequest('query_failed', error.message)

  const rows = data ?? []
  const overlay = options.date ? await loadOverlay(schoolId, options.date) : undefined

  return {
    teacherId,
    periods: periodAxis(rows),
    cells: rows.map(r => ({
      ...toCell(r, overlay),
      className: (r as any).classes?.name ?? null,
      sectionName: (r as any).sections?.name ?? null,
    })),
    load: weeklyLoad(rows),
  }
}

/**
 * What a teacher sees on their own phone: this week, plus anything that
 * needs a response from them.
 *
 * Cover they have been given is deliberately first-class here rather
 * than a badge on the grid — an unacknowledged arrangement is the one
 * thing in this module that is actually urgent for them.
 */
export async function myWeek(schoolId: string, teacherId: string) {
  const today = toLocalDateStr(new Date())
  const settings = await getSettings(schoolId)

  const [grid, arrangementsResult, bookingsResult, absenceResult] = await Promise.all([
    teacherView(schoolId, teacherId, { date: today }),
    supabase.from('arrangements')
      .select(`
        id, arrangement_date, period_number, start_time, end_time, status,
        subject_name, reason, acknowledged_at,
        classes(name), sections(name), absent:absent_teacher_id(full_name)
      `)
      .eq('school_id', schoolId).eq('substitute_teacher_id', teacherId)
      .gte('arrangement_date', today)
      .in('status', ['assigned', 'acknowledged'])
      .order('arrangement_date').order('period_number'),
    supabase.from('period_bookings')
      .select('*').eq('school_id', schoolId).eq('teacher_id', teacherId)
      .gte('booking_date', today).eq('status', 'active')
      .order('booking_date').order('period_number'),
    supabase.from('teacher_absences')
      .select('id, absence_date, scope, from_period, reason')
      .eq('school_id', schoolId).eq('teacher_id', teacherId)
      .gte('absence_date', today).neq('status', 'cancelled'),
  ])

  const cover = (arrangementsResult.data ?? []).map(row => ({
    id: row.id,
    date: row.arrangement_date,
    dayName: DAY_NAMES[dayOfWeekFor(row.arrangement_date)],
    periodNumber: row.period_number,
    timeLabel: `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
    className: `${(row as any).classes?.name ?? ''}${(row as any).sections?.name ? `-${(row as any).sections.name}` : ''}`,
    subjectName: row.subject_name,
    coveringFor: (row as any).absent?.full_name ?? null,
    status: row.status,
    needsAcknowledgement: row.status === 'assigned',
    whyYou: row.reason,
  }))

  return {
    today,
    grid,
    cover,
    pendingAcknowledgements: cover.filter(c => c.needsAcknowledgement).length,
    bookings: (bookingsResult.data ?? []).map(b => ({
      ...b,
      purpose_label: PURPOSE_LABELS[b.purpose] ?? b.purpose,
      dayName: DAY_NAMES[dayOfWeekFor(b.booking_date)],
    })),
    absences: absenceResult.data ?? [],
    settings: {
      bookingWeeklyCap: settings.booking_weekly_cap,
      bookingLeadHours: settings.booking_lead_hours,
    },
  }
}

// ── master grid ─────────────────────────────────────────────────

/**
 * Every section against every period for one day.
 *
 * One day at a time, because sixteen sections by ten periods by six days
 * is a thousand cells and nobody reads that. The day switcher is the
 * whole interface.
 */
export async function masterGrid(schoolId: string, dayOfWeek: number, options: OverlayOptions = {}) {
  const [gridResult, sectionsResult] = await Promise.all([
    fetchAll((from, to) => supabase.from('timetable_periods').select(SELECT)
      .eq('school_id', schoolId).eq('day_of_week', dayOfWeek)
      .order('period_number').range(from, to), 'timetable periods').then(data => ({ data, error: null })),
    supabase.from('sections')
      .select('id, name, class_id, classes(name, numeric_level)')
      .eq('school_id', schoolId),
  ])
  if (gridResult.error) throw badRequest('query_failed', gridResult.error.message)

  const overlay = options.date ? await loadOverlay(schoolId, options.date) : undefined
  const rows = gridResult.data ?? []

  const sections = (sectionsResult.data ?? [])
    .map(s => ({
      sectionId: s.id,
      label: `${(s as any).classes?.name ?? ''}-${s.name}`,
      numericLevel: (s as any).classes?.numeric_level ?? 0,
      sectionName: s.name,
    }))
    .sort((a, b) => a.numericLevel - b.numericLevel || a.sectionName.localeCompare(b.sectionName))

  const byKey: Record<string, Cell> = {}
  for (const row of rows) {
    byKey[`${row.section_id}:${row.period_number}`] = toCell(row, overlay)
  }

  return {
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    sections,
    periods: periodAxis(rows),
    cells: byKey,
  }
}

// ── free-teacher matrix ─────────────────────────────────────────

/**
 * Who is free, when.
 *
 * This is the sheet the school currently makes by hand every morning to
 * do arrangements from, so it is the one view that most directly
 * replaces existing paper. Bookings and absences are folded in, because
 * a free-teacher list that includes people who are off sick is worse
 * than no list.
 */
export async function freeTeacherMatrix(schoolId: string, dayOfWeek: number, dateStr?: string | null) {
  const [staffResult, periodsResult, defsResult, absencesResult, bookingsResult, arrangementsResult] =
    await Promise.all([
      // Same pool as the ranking ladder (services/arrangements.ts): anyone
      // who is not a parent or a student can, in principle, cover a class.
      supabase.from('users').select('id, full_name, is_active')
        .eq('school_id', schoolId).not('role', 'in', '("parent","student")'),
      supabase.from('timetable_periods')
        .select('teacher_id, period_number')
        .eq('school_id', schoolId).eq('day_of_week', dayOfWeek).eq('is_break', false),
      supabase.from('period_slot_defs')
        .select('period_number, start_time, end_time')
        .eq('school_id', schoolId).eq('kind', 'period').order('period_number'),
      dateStr
        ? supabase.from('teacher_absences').select('teacher_id')
            .eq('school_id', schoolId).eq('absence_date', dateStr).neq('status', 'cancelled')
        : Promise.resolve({ data: [] as any[] }),
      dateStr
        ? supabase.from('period_bookings').select('teacher_id, period_number, purpose')
            .eq('school_id', schoolId).eq('booking_date', dateStr).eq('status', 'active')
        : Promise.resolve({ data: [] as any[] }),
      dateStr
        ? supabase.from('arrangements').select('substitute_teacher_id, period_number')
            .eq('school_id', schoolId).eq('arrangement_date', dateStr)
            .in('status', ['assigned', 'acknowledged'])
        : Promise.resolve({ data: [] as any[] }),
    ])

  const staff = (staffResult.data ?? []).filter(u => u.is_active !== false)
  const absent = new Set((absencesResult.data ?? []).map((a: any) => a.teacher_id))

  const busy = new Set<string>()
  for (const row of periodsResult.data ?? []) {
    if (row.teacher_id) busy.add(`${row.teacher_id}:${row.period_number}`)
  }
  for (const row of arrangementsResult.data ?? []) {
    if (row.substitute_teacher_id) busy.add(`${row.substitute_teacher_id}:${row.period_number}`)
  }

  const bookings = new Map<string, string>()
  for (const row of bookingsResult.data ?? []) {
    bookings.set(`${row.teacher_id}:${row.period_number}`, row.purpose)
  }

  const periods = new Map<number, { start: string; end: string }>()
  for (const d of defsResult.data ?? []) {
    if (!periods.has(d.period_number)) periods.set(d.period_number, { start: d.start_time, end: d.end_time })
  }

  const columns = [...periods.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([periodNumber, def]) => {
      const free = staff
        .filter(u => !absent.has(u.id) && !busy.has(`${u.id}:${periodNumber}`))
        .map(u => {
          const purpose = bookings.get(`${u.id}:${periodNumber}`)
          return {
            teacherId: u.id,
            fullName: u.full_name,
            reserved: !!purpose,
            reservedFor: purpose ? (PURPOSE_LABELS[purpose] ?? purpose) : null,
          }
        })
        .sort((a, b) => Number(a.reserved) - Number(b.reserved) || a.fullName.localeCompare(b.fullName))

      return {
        periodNumber,
        timeLabel: `${formatTime(def.start)} – ${formatTime(def.end)}`,
        free,
        freeCount: free.filter(f => !f.reserved).length,
        reservedCount: free.filter(f => f.reserved).length,
      }
    })

  return {
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    date: dateStr ?? null,
    totalTeachers: staff.length,
    absentToday: absent.size,
    columns,
  }
}

// ── helpers ─────────────────────────────────────────────────────

/**
 * The period columns present in a set of rows.
 *
 * Derived from the data rather than from a day template, because a
 * junior section that finishes after period 9 and a senior one that runs
 * to period 10 both render through here and neither should be given a
 * trailing empty column that its pupils never sit in.
 */
function periodAxis(rows: any[]) {
  const seen = new Map<number, { start: string; end: string; isBreak: boolean }>()
  for (const row of rows) {
    if (!seen.has(row.period_number)) {
      seen.set(row.period_number, {
        start: row.start_time, end: row.end_time, isBreak: !!row.is_break,
      })
    }
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].start.localeCompare(b[1].start))
    .map(([periodNumber, def]) => ({
      periodNumber,
      startTime: def.start,
      endTime: def.end,
      timeLabel: `${formatTime(def.start)} – ${formatTime(def.end)}`,
      isBreak: def.isBreak,
    }))
}

function weeklyLoad(rows: any[]) {
  const byDay = new Map<number, number>()
  for (const row of rows) byDay.set(row.day_of_week, (byDay.get(row.day_of_week) ?? 0) + 1)
  const perDay = [1, 2, 3, 4, 5, 6].map(d => ({ dayOfWeek: d, dayName: DAY_NAMES[d], periods: byDay.get(d) ?? 0 }))
  return {
    perDay,
    totalPerWeek: rows.length,
    busiestDay: perDay.reduce((a, b) => (b.periods > a.periods ? b : a), perDay[0]),
  }
}

// ── the block view ──────────────────────────────────────────────
//
// Every section's whole week in one object, from either the live
// timetable or an unpublished draft. This is the sheet a school actually
// works from when checking a timetable over: the wall grid answers "what
// is 6B doing on Tuesday", but "is this timetable any good" is a question
// about all of it at once, and it is asked of a draft at least as often
// as of the live one.
//
// It carries its own summary and conflict list rather than leaving the
// client to derive them, because both have to be computed across the
// whole grid — a teacher standing in two rooms at once is invisible from
// inside either room, and the client would otherwise be paginating a
// thousand rows to work it out.

export interface BlockConflict {
  kind: 'teacher_clash' | 'room_over_capacity' | 'unstaffed' | 'gap' | 'teacher_departed'
  severity: 'block' | 'warn'
  day: number
  periodNumber: number
  message: string
  /** Sections the conflict touches, so the grid can highlight them. */
  sectionIds: string[]
  /** Existing cells at fault — the grid marks these. */
  cellIds: string[]
  /**
   * `sectionId:day:period` for faults that are an ABSENCE of a cell.
   * A gap has no row to point at, so without this the grid could list
   * the problem but not show you where it is, which is the one thing
   * you opened the grid to find out.
   */
  slotKeys: string[]
}

export async function blockGrid(
  schoolId: string,
  options: { versionId?: string | null } = {},
) {
  const draft = !!options.versionId && options.versionId !== 'active'

  let version: { id: string; label: string; status: string; source: string } | null = null
  if (draft) {
    const { data } = await supabase.from('timetable_versions')
      .select('id, label, status, source')
      .eq('id', options.versionId!).eq('school_id', schoolId).maybeSingle()
    if (!data) throw badRequest('version_not_found', 'That timetable version does not exist.')
    version = data as any
  } else {
    const { data } = await supabase.from('timetable_versions')
      .select('id, label, status, source')
      .eq('school_id', schoolId).eq('status', 'active').maybeSingle()
    version = (data as any) ?? null
  }

  // Paged in both cases: a 16-section week is past the 1000 rows
  // PostgREST hands back by default, and a block view that quietly stops
  // two-thirds of the way through is worse than none.
  const rows = draft
    ? await fetchAll<any>((from, to) => supabase.from('timetable_draft_periods')
        .select(`
          id, day_of_week, period_number, start_time, end_time,
          subject_id, subject_name, teacher_id, room_id, is_break, is_locked,
          class_id, section_id,
          teacher:teacher_id(id, full_name), room:room_id(name),
          classes(name), sections(name)
        `)
        .eq('school_id', schoolId).eq('version_id', options.versionId!)
        .order('day_of_week').order('period_number').range(from, to), 'draft periods')
    : await fetchAll<any>((from, to) => supabase.from('timetable_periods').select(SELECT)
        .eq('school_id', schoolId)
        .order('day_of_week').order('period_number').range(from, to), 'timetable periods')

  const [{ data: sectionRows }, { data: roomRows }] = await Promise.all([
    supabase.from('sections')
      .select('id, name, class_id, classes(name, numeric_level)').eq('school_id', schoolId),
    supabase.from('classrooms').select('id, name, capacity_groups').eq('school_id', schoolId),
  ])

  // Staff who have left but are still on the timetable. Found at DPS
  // Lucknow: three resigned teachers and one terminated, between them
  // holding 118 periods a week. Nobody is going to teach those lessons,
  // and nothing anywhere said so — HR drops them from the attendance
  // register, so they do not even show up as absent.
  const { data: staffProfiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status').eq('school_id', schoolId)
  const departedStatus = new Map<string, string>()
  for (const profile of staffProfiles ?? []) {
    if (NOT_TEACHING_STATUSES[profile.employment_status]) {
      departedStatus.set(profile.user_id, profile.employment_status)
    }
  }

  const roomById = new Map((roomRows ?? []).map(r => [r.id, r]))

  // Only sections this timetable actually contains — a draft may not
  // cover every section, and showing empty columns for the rest reads as
  // "the generator forgot them".
  const present = new Set(rows.map(r => r.section_id).filter(Boolean))
  const sections = (sectionRows ?? [])
    .filter(s => present.has(s.id))
    .map(s => ({
      sectionId: s.id,
      // The day editor checks what is scheduled against the weekly plan,
      // and the plan is held per class, not per section.
      classId: s.class_id,
      label: `${(s as any).classes?.name ?? ''}-${s.name}`,
      numericLevel: (s as any).classes?.numeric_level ?? 0,
      sectionName: s.name,
      className: (s as any).classes?.name ?? '',
    }))
    .sort((a, b) => a.numericLevel - b.numericLevel || a.sectionName.localeCompare(b.sectionName))

  const days = [...new Set(rows.map(r => r.day_of_week))].sort((a, b) => a - b)
  const slots = periodAxis(rows)

  // sectionId travels on the cell as well as in the key: the teacher
  // view pivots the same payload by teacher instead of by class, and
  // re-deriving the class by string-splitting the key would break the
  // moment the key format changed.
  const cells: Record<string, Cell & { sectionId: string; sectionLabel: string }> = {}
  const labelOfSection = new Map(sections.map(s => [s.sectionId, s.label]))
  for (const row of rows) {
    cells[`${row.section_id}:${row.day_of_week}:${row.period_number}`] = {
      ...toCell(row),
      sectionId: row.section_id,
      sectionLabel: labelOfSection.get(row.section_id) ?? '',
    }
  }

  // ── conflicts, computed across the whole grid ─────────────────
  const teachingRows = rows.filter(r => !r.is_break)
  const conflicts: BlockConflict[] = []
  const labelOf = new Map(sections.map(s => [s.sectionId, s.label]))

  const byTeacherSlot = new Map<string, any[]>()
  const byRoomSlot = new Map<string, any[]>()
  for (const row of rows) {
    if (row.is_break) continue
    if (row.teacher_id) {
      const key = `${row.teacher_id}:${row.day_of_week}:${row.period_number}`
      byTeacherSlot.set(key, [...(byTeacherSlot.get(key) ?? []), row])
    } else {
      conflicts.push({
        kind: 'unstaffed', severity: 'warn',
        day: row.day_of_week, periodNumber: row.period_number,
        message: `${labelOf.get(row.section_id) ?? 'A class'} has ${row.subject_name || 'a period'} with nobody assigned to teach it — ${DAY_NAMES[row.day_of_week]}, period ${row.period_number}.`,
        sectionIds: [row.section_id], cellIds: [row.id], slotKeys: [],
      })
    }
    if (row.room_id) {
      const key = `${row.room_id}:${row.day_of_week}:${row.period_number}`
      byRoomSlot.set(key, [...(byRoomSlot.get(key) ?? []), row])
    }
  }

  // One entry per departed teacher rather than per period: four people
  // holding 118 lessons would otherwise bury every other finding.
  const departedTeaching = new Map<string, any[]>()
  for (const row of teachingRows) {
    if (!row.teacher_id || !departedStatus.has(row.teacher_id)) continue
    departedTeaching.set(row.teacher_id, [...(departedTeaching.get(row.teacher_id) ?? []), row])
  }
  for (const [teacherId, held] of Array.from(departedTeaching.entries())) {
    // "has resigned" but "has been terminated" but "is suspended" — the
    // status words are not grammatically interchangeable, and a message
    // about somebody's employment should at least be written properly.
    const info = NOT_TEACHING_STATUSES[departedStatus.get(teacherId) as string]
    const classes = [...new Set(held.map(r => labelOf.get(r.section_id)).filter(Boolean))]
    conflicts.push({
      kind: 'teacher_departed', severity: 'block',
      day: held[0].day_of_week, periodNumber: held[0].period_number,
      message: `${held[0].teacher?.full_name ?? 'A teacher'} ${info?.phrase ?? 'is not teaching'} but still holds ${held.length} period${held.length === 1 ? '' : 's'} a week across ${classes.length} class${classes.length === 1 ? '' : 'es'} (${classes.slice(0, 4).join(', ')}${classes.length > 4 ? '…' : ''}). ${
        info?.permanent ? 'Those periods need reassigning.' : 'Those periods need cover until they are back.'
      }`,
      sectionIds: held.map(r => r.section_id),
      cellIds: held.map(r => r.id),
      slotKeys: [],
    })
  }

  for (const group of Array.from(byTeacherSlot.values())) {
    if (group.length < 2) continue
    const first = group[0]
    conflicts.push({
      kind: 'teacher_clash', severity: 'block',
      day: first.day_of_week, periodNumber: first.period_number,
      message: `${first.teacher?.full_name ?? 'A teacher'} is timetabled in ${
        group.map(r => labelOf.get(r.section_id) ?? 'a class').join(' and ')
      } at the same time — ${DAY_NAMES[first.day_of_week]}, period ${first.period_number}.`,
      sectionIds: group.map(r => r.section_id),
      cellIds: group.map(r => r.id),
      slotKeys: [],
    })
  }

  for (const group of Array.from(byRoomSlot.values())) {
    const room = roomById.get(group[0].room_id)
    // A playground or hall may legitimately take more than one class.
    const capacity = room?.capacity_groups ?? 1
    if (group.length <= capacity) continue
    conflicts.push({
      kind: 'room_over_capacity', severity: 'block',
      day: group[0].day_of_week, periodNumber: group[0].period_number,
      message: `${room?.name ?? 'A room'} holds ${capacity} class${capacity === 1 ? '' : 'es'} at once but ${group.length} are booked into it — ${DAY_NAMES[group[0].day_of_week]}, period ${group[0].period_number}.`,
      sectionIds: group.map(r => r.section_id),
      cellIds: group.map(r => r.id),
      slotKeys: [],
    })
  }

  // Gaps, measured inside each section's own day rather than against the
  // longest day in the school: a section that finishes after period 9 has
  // not "lost" period 10, and flagging that would bury the real holes.
  //
  // Teaching periods only. Breaks are numbered outside the teaching
  // sequence (this school's lunch is period 105), so counting them made
  // every section look like it had ninety-five empty periods a day.
  let gapCount = 0
  for (const section of sections) {
    for (const day of days) {
      const inDay = teachingRows.filter(r => r.section_id === section.sectionId && r.day_of_week === day)
      if (!inDay.length) continue
      const last = Math.max(...inDay.map(r => r.period_number))
      // A break sitting in the middle of the numbering owns its slot.
      // Where lunch is period 5 and teaching runs 1-4 then 6-10, period
      // 5 is not a hole in the day — it is lunch. Counting it as one
      // produced a warning for every section on every day, 96 of them,
      // all of them saying the school stops for lunch.
      const held = new Set([
        ...inDay.map(r => r.period_number),
        ...rows.filter(r => r.is_break
          && r.section_id === section.sectionId
          && r.day_of_week === day).map(r => r.period_number),
      ])
      const missing: number[] = []
      for (let n = 1; n <= last; n++) if (!held.has(n)) missing.push(n)
      if (!missing.length) continue
      gapCount += missing.length
      conflicts.push({
        kind: 'gap', severity: 'warn',
        day, periodNumber: missing[0],
        message: `${section.label} has nothing scheduled in period${missing.length === 1 ? '' : 's'} ${missing.join(', ')} on ${DAY_NAMES[day]}, but the day continues afterwards.`,
        sectionIds: [section.sectionId], cellIds: [],
        slotKeys: missing.map(n => `${section.sectionId}:${day}:${n}`),
      })
    }
  }

  conflicts.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1) ||
    a.day - b.day || a.periodNumber - b.periodNumber)

  const teaching = rows.filter(r => !r.is_break)
  const summary = {
    sections: sections.length,
    days: days.length,
    periodsPlaced: teaching.length,
    breaks: rows.length - teaching.length,
    teachers: new Set(teaching.map(r => r.teacher_id).filter(Boolean)).size,
    subjects: new Set(teaching.map(r => r.subject_name).filter(Boolean)).size,
    rooms: new Set(teaching.map(r => r.room_id).filter(Boolean)).size,
    unstaffed: conflicts.filter(c => c.kind === 'unstaffed').length,
    departedTeachers: departedTeaching.size,
    departedPeriods: Array.from(departedTeaching.values()).reduce((n, v) => n + v.length, 0),
    teacherClashes: conflicts.filter(c => c.kind === 'teacher_clash').length,
    roomClashes: conflicts.filter(c => c.kind === 'room_over_capacity').length,
    gaps: gapCount,
    blocking: conflicts.filter(c => c.severity === 'block').length,
    warnings: conflicts.filter(c => c.severity === 'warn').length,
  }

  return {
    source: draft ? 'draft' : 'active',
    version: version
      ? { id: version.id, label: version.label, status: version.status, origin: version.source }
      : null,
    sections, days, slots, cells, conflicts, summary,
    dayNames: Object.fromEntries(days.map(d => [d, DAY_NAMES[d]])),
  }
}
