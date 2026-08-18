import { supabase } from '../../../shared/db/client'
import { toLocalDateStr } from '../../../shared/utils/academicCalendar'
import {
  badRequest, DAY_NAMES, dayOfWeekFor, fetchAll, formatTime, getSettings,
} from '../lib/core'
import { PURPOSE_LABELS } from './bookings'

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
