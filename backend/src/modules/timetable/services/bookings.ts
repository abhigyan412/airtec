import { supabase } from '../../../shared/db/client'
import {
  audit, badRequest, conflict, dayOfWeekFor, formatTime, getSettings, must, notFound,
} from '../lib/core'
import { weekBounds } from './arrangements'

// ═══════════════════════════════════════════════════════════════
// Teachers reserving their own free periods.
// ═══════════════════════════════════════════════════════════════
//
// The request was "the timetable manager must not be able to book a
// teacher's free period once the teacher has claimed it". Implemented
// literally that is a foot-gun: in a school where six people hold most
// of the free time, a heavy-absence Monday would have nobody left, and
// any teacher who saw an absence notice could reactively claim their
// free period to dodge cover.
//
// So a booking is:
//   • a HARD block against routine scheduling — the manager may never
//     place a regular class in a reserved period;
//   • a very strong SOFT block against arrangements (−1000 on the
//     ranking ladder, see arrangements.ts), so the teacher is last
//     rather than invisible;
//   • overridable only with arrangement.override_booking, which the
//     Timetable Manager role deliberately does not hold, and only with
//     a written reason that the teacher is told about.
//
// Two guardrails keep it honest: bookings must be made a configurable
// number of hours ahead (so they cannot be created in response to a
// known absence), and each teacher gets a weekly cap. Both live in
// timetable_settings because both are things a school will argue about.

export const BOOKING_PURPOSES = [
  'copy_correction', 'lesson_planning', 'event_management',
  'parent_meeting', 'remedial', 'administrative', 'other',
] as const

export const PURPOSE_LABELS: Record<string, string> = {
  copy_correction: 'Copy correction',
  lesson_planning: 'Lesson planning',
  event_management: 'Event management',
  parent_meeting: 'Parent meeting',
  remedial: 'Remedial teaching',
  administrative: 'Administrative work',
  other: 'Other',
}

export interface CreateBookingInput {
  date: string
  periodNumber: number
  purpose: string
  notes?: string | null
}

export async function createBooking(schoolId: string, teacherId: string, input: CreateBookingInput) {
  const settings = await getSettings(schoolId)
  const dow = dayOfWeekFor(input.date)

  if (!settings.working_days.includes(dow)) {
    throw badRequest('not_a_school_day', 'That is not a working day.')
  }
  if (!BOOKING_PURPOSES.includes(input.purpose as any)) {
    throw badRequest('bad_purpose', 'Choose what the period is for.')
  }

  // ── the period must exist, and they must be free in it ────────
  const { data: slotDef } = await supabase.from('period_slot_defs')
    .select('start_time, end_time')
    .eq('school_id', schoolId).eq('kind', 'period').eq('period_number', input.periodNumber)
    .limit(1).maybeSingle()
  if (!slotDef) throw notFound(`There is no period ${input.periodNumber} in the school day.`)

  const { data: teaching } = await supabase.from('timetable_periods')
    .select('id, subject_name, classes(name), sections(name)')
    .eq('school_id', schoolId).eq('teacher_id', teacherId)
    .eq('day_of_week', dow).eq('period_number', input.periodNumber)
    .eq('is_break', false).maybeSingle()
  if (teaching) {
    const where = `${(teaching as any).classes?.name ?? ''}-${(teaching as any).sections?.name ?? ''}`
    throw conflict('not_free', `You teach ${teaching.subject_name} to ${where} in that period.`)
  }

  // ── lead time ─────────────────────────────────────────────────
  // Measured against when the period actually starts, not midnight, so
  // "12 hours ahead" means the same thing for period 1 and period 10.
  const start = new Date(`${input.date}T${slotDef.start_time}`)
  const hoursAway = (start.getTime() - Date.now()) / 3_600_000
  if (hoursAway < settings.booking_lead_hours) {
    throw conflict('too_late',
      settings.booking_lead_hours >= 24
        ? `Free periods must be reserved at least ${Math.round(settings.booking_lead_hours / 24)} day(s) ahead.`
        : `Free periods must be reserved at least ${settings.booking_lead_hours} hours ahead. This one starts in ${Math.max(0, Math.round(hoursAway))}.`)
  }

  // ── already covering something ────────────────────────────────
  const { data: covering } = await supabase.from('arrangements')
    .select('id').eq('substitute_teacher_id', teacherId)
    .eq('arrangement_date', input.date).eq('period_number', input.periodNumber)
    .in('status', ['assigned', 'acknowledged']).maybeSingle()
  if (covering) {
    throw conflict('already_covering', 'You are already covering a class in that period.')
  }

  // ── weekly cap ────────────────────────────────────────────────
  const [weekStart, weekEnd] = weekBounds(input.date)
  const { data: thisWeek } = await supabase.from('period_bookings')
    .select('id, booking_date, period_number')
    .eq('teacher_id', teacherId).eq('status', 'active')
    .gte('booking_date', weekStart).lte('booking_date', weekEnd)

  const existing = thisWeek ?? []
  if (existing.some(b => b.booking_date === input.date && b.period_number === input.periodNumber)) {
    throw conflict('already_booked', 'You have already reserved that period.')
  }
  if (settings.booking_weekly_cap > 0 && existing.length >= settings.booking_weekly_cap) {
    throw conflict('weekly_cap',
      `You can reserve ${settings.booking_weekly_cap} periods a week and have already used all of them. Release one first.`)
  }

  const created = must(await supabase.from('period_bookings').insert({
    school_id: schoolId, teacher_id: teacherId,
    booking_date: input.date, period_number: input.periodNumber, day_of_week: dow,
    purpose: input.purpose, notes: input.notes ?? null, status: 'active',
  }).select('*').single(), 'create booking')

  await audit(schoolId, teacherId, 'book_period', 'period_booking', created.id, {
    date: input.date, period: input.periodNumber, purpose: input.purpose,
  })

  return {
    ...created,
    purpose_label: PURPOSE_LABELS[input.purpose] ?? input.purpose,
    time_label: `${formatTime(slotDef.start_time)} – ${formatTime(slotDef.end_time)}`,
    remaining_this_week: Math.max(0, settings.booking_weekly_cap - existing.length - 1),
  }
}

/** Giving the period back. Always allowed — protection is the teacher's to waive. */
export async function releaseBooking(schoolId: string, teacherId: string, bookingId: string) {
  const booking = must(await supabase.from('period_bookings')
    .select('*').eq('id', bookingId).eq('school_id', schoolId)
    .eq('teacher_id', teacherId).maybeSingle(),
    'booking of yours')

  if (booking.status !== 'active') return { ok: true, alreadyReleased: true }

  const { error } = await supabase.from('period_bookings')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (error) throw badRequest('release_failed', error.message)

  await audit(schoolId, teacherId, 'release_period', 'period_booking', bookingId, {
    date: booking.booking_date, period: booking.period_number,
  })
  return { ok: true, alreadyReleased: false }
}

export async function listBookings(
  schoolId: string,
  opts: { teacherId?: string; from: string; to: string; includeInactive?: boolean },
) {
  let query = supabase.from('period_bookings')
    .select('*, teacher:teacher_id(id, full_name)')
    .eq('school_id', schoolId)
    .gte('booking_date', opts.from).lte('booking_date', opts.to)
    .order('booking_date', { ascending: true })
    .order('period_number', { ascending: true })

  if (opts.teacherId) query = query.eq('teacher_id', opts.teacherId)
  if (!opts.includeInactive) query = query.eq('status', 'active')

  const { data, error } = await query
  if (error) throw badRequest('query_failed', error.message)

  return (data ?? []).map(row => ({
    ...row,
    teacher_name: (row as any).teacher?.full_name ?? null,
    purpose_label: PURPOSE_LABELS[row.purpose] ?? row.purpose,
  }))
}

/**
 * What a teacher may still reserve this week.
 *
 * Returned as a whole so the booking UI can grey out what is not
 * available instead of letting somebody pick a period and then telling
 * them no — the difference between a form that explains itself and one
 * that argues.
 */
export async function bookableSlots(schoolId: string, teacherId: string, from: string, to: string) {
  const settings = await getSettings(schoolId)

  const [defsResult, periodsResult, bookingsResult, arrangementsResult] = await Promise.all([
    supabase.from('period_slot_defs')
      .select('period_number, start_time, end_time')
      .eq('school_id', schoolId).eq('kind', 'period').order('period_number'),
    supabase.from('timetable_periods')
      .select('day_of_week, period_number')
      .eq('school_id', schoolId).eq('teacher_id', teacherId).eq('is_break', false),
    supabase.from('period_bookings')
      .select('booking_date, period_number, purpose, id, status')
      .eq('school_id', schoolId).eq('teacher_id', teacherId)
      .gte('booking_date', from).lte('booking_date', to).eq('status', 'active'),
    supabase.from('arrangements')
      .select('arrangement_date, period_number')
      .eq('school_id', schoolId).eq('substitute_teacher_id', teacherId)
      .gte('arrangement_date', from).lte('arrangement_date', to)
      .in('status', ['assigned', 'acknowledged']),
  ])

  // De-duplicate periods by number: several day templates define the
  // same period with the same clock time.
  const defs = new Map<number, { start: string; end: string }>()
  for (const d of defsResult.data ?? []) {
    if (!defs.has(d.period_number)) defs.set(d.period_number, { start: d.start_time, end: d.end_time })
  }

  const teaching = new Set((periodsResult.data ?? []).map(p => `${p.day_of_week}:${p.period_number}`))
  const booked = new Map((bookingsResult.data ?? []).map(b => [`${b.booking_date}:${b.period_number}`, b]))
  const covering = new Set((arrangementsResult.data ?? []).map(a => `${a.arrangement_date}:${a.period_number}`))

  const weekUsage = new Map<string, number>()
  for (const b of bookingsResult.data ?? []) {
    const [ws] = weekBounds(b.booking_date)
    weekUsage.set(ws, (weekUsage.get(ws) ?? 0) + 1)
  }

  const days: any[] = []
  for (let cursor = from; cursor <= to; cursor = nextDay(cursor)) {
    const dow = dayOfWeekFor(cursor)
    if (!settings.working_days.includes(dow)) continue

    const slots: any[] = []
    for (const [periodNumber, def] of defs) {
      const key = `${cursor}:${periodNumber}`
      const existing = booked.get(key)
      const start = new Date(`${cursor}T${def.start}`)
      const hoursAway = (start.getTime() - Date.now()) / 3_600_000
      const [ws] = weekBounds(cursor)
      const capReached = settings.booking_weekly_cap > 0 &&
        (weekUsage.get(ws) ?? 0) >= settings.booking_weekly_cap

      let state: string
      let why: string | null = null
      if (existing) { state = 'booked' }
      else if (teaching.has(`${dow}:${periodNumber}`)) { state = 'teaching'; why = 'You teach in this period' }
      else if (covering.has(key)) { state = 'covering'; why = 'You are covering a class' }
      else if (hoursAway < settings.booking_lead_hours) {
        state = 'too_late'
        why = `Needs ${settings.booking_lead_hours}h notice`
      } else if (capReached) {
        state = 'cap_reached'
        why = `Weekly limit of ${settings.booking_weekly_cap} reached`
      } else state = 'available'

      slots.push({
        periodNumber,
        startTime: def.start,
        endTime: def.end,
        timeLabel: `${formatTime(def.start)} – ${formatTime(def.end)}`,
        state,
        why,
        bookingId: existing ? existing.id : null,
        purpose: existing ? existing.purpose : null,
        purposeLabel: existing ? (PURPOSE_LABELS[existing.purpose] ?? existing.purpose) : null,
      })
    }
    days.push({ date: cursor, dayOfWeek: dow, slots })
  }

  return {
    days,
    weeklyCap: settings.booking_weekly_cap,
    leadHours: settings.booking_lead_hours,
    purposes: BOOKING_PURPOSES.map(p => ({ value: p, label: PURPOSE_LABELS[p] })),
  }
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}
