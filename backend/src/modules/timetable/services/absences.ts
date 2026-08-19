import { supabase } from '../../../shared/db/client'
import { toLocalDateStr } from '../../../shared/utils/academicCalendar'
import {
  arrangementManagers, audit, badRequest, conflict, dayOfWeekFor, formatTime,
  getSettings, must, notify,
} from '../lib/core'

// ═══════════════════════════════════════════════════════════════
// Absence intake — three doors into one queue.
// ═══════════════════════════════════════════════════════════════
//
//   1. Planned    — an approved HRMS leave, synced forward so cover can
//                   be arranged the evening before rather than at 07:45.
//   2. Manual     — the manager marking someone absent in the morning.
//   3. Detected   — a teacher with a period running who has never checked
//                   in. Always a PROPOSAL: the system does not get to
//                   declare a colleague absent on the strength of a
//                   missed biometric punch.
//
// All three end at the same place: teacher_absences, then
// timetable_materialize_arrangements, which fans the absence out into
// one queue row per affected period in a single transaction.

export type AbsenceScope =
  | 'full_day' | 'first_half' | 'second_half' | 'periods' | 'early_leave' | 'late_arrival'

export interface CreateAbsenceInput {
  teacherId: string
  date: string
  scope: AbsenceScope
  periods?: number[]
  fromPeriod?: number | null
  reason?: string | null
  source?: 'manual' | 'leave' | 'attendance' | 'self_report'
  status?: 'proposed' | 'confirmed'
  leaveRequestId?: string | null
}

export async function createAbsence(schoolId: string, actorId: string | null, input: CreateAbsenceInput) {
  const settings = await getSettings(schoolId)
  const dow = dayOfWeekFor(input.date)

  if (!settings.working_days.includes(dow)) {
    throw badRequest('not_a_school_day',
      `${input.date} is not a working day for this school, so there is nothing to cover.`)
  }
  if (input.scope === 'periods' && !(input.periods && input.periods.length)) {
    throw badRequest('periods_required', 'Choose at least one period.')
  }
  if ((input.scope === 'early_leave' || input.scope === 'late_arrival') && !input.fromPeriod) {
    throw badRequest('from_period_required',
      input.scope === 'early_leave'
        ? 'Say which period they are leaving from.'
        : 'Say which period they will be back for.')
  }

  const { data: existing } = await supabase.from('teacher_absences')
    .select('id, scope, status')
    .eq('teacher_id', input.teacherId).eq('absence_date', input.date)
    .neq('status', 'cancelled').maybeSingle()

  if (existing) {
    // A detected proposal must not stand in the way of the manager
    // recording the real thing — it gets upgraded rather than rejected.
    if (existing.status === 'proposed' && input.status !== 'proposed') {
      await supabase.from('teacher_absences').update({
        scope: input.scope, periods: input.periods ?? [], from_period: input.fromPeriod ?? null,
        source: input.source ?? 'manual', status: 'confirmed',
        reason: input.reason ?? null, created_by: actorId,
      }).eq('id', existing.id)
      await supabase.from('arrangements').delete()
        .eq('absence_id', existing.id).eq('status', 'unassigned')
      const created = await materialize(existing.id)
      await audit(schoolId, actorId, 'confirm_absence', 'teacher_absence', existing.id, { created })
      return { id: existing.id, arrangementsCreated: created, upgraded: true }
    }
    throw conflict('already_absent',
      'This teacher is already marked absent for that date. Cancel the existing entry first if it needs changing.')
  }

  const absence = must(await supabase.from('teacher_absences').insert({
    school_id: schoolId,
    teacher_id: input.teacherId,
    absence_date: input.date,
    scope: input.scope,
    periods: input.periods ?? [],
    from_period: input.fromPeriod ?? null,
    source: input.source ?? 'manual',
    status: input.status ?? 'confirmed',
    leave_request_id: input.leaveRequestId ?? null,
    reason: input.reason ?? null,
    created_by: actorId,
  }).select('id').single(), 'create absence')

  const created = await materialize(absence.id)

  await audit(schoolId, actorId, 'create_absence', 'teacher_absence', absence.id, {
    teacher: input.teacherId, date: input.date, scope: input.scope, arrangements: created,
  })

  return { id: absence.id, arrangementsCreated: created, upgraded: false }
}

async function materialize(absenceId: string): Promise<number> {
  const { data, error } = await supabase.rpc('timetable_materialize_arrangements', {
    p_absence_id: absenceId,
  })
  if (error) throw badRequest('materialize_failed', error.message)
  return Number(data ?? 0)
}

export async function listAbsences(schoolId: string, dateStr: string) {
  const { data, error } = await supabase.from('teacher_absences')
    .select('*, teacher:teacher_id(id, full_name)')
    .eq('school_id', schoolId).eq('absence_date', dateStr)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true })
  if (error) throw badRequest('query_failed', error.message)

  const ids = (data ?? []).map(a => a.id)
  const counts = new Map<string, { total: number; filled: number }>()
  if (ids.length) {
    const { data: arrangements } = await supabase.from('arrangements')
      .select('absence_id, status').in('absence_id', ids)
    for (const a of arrangements ?? []) {
      const entry = counts.get(a.absence_id) ?? { total: 0, filled: 0 }
      if (a.status === 'cancelled') continue
      entry.total++
      if (a.status === 'assigned' || a.status === 'acknowledged') entry.filled++
      counts.set(a.absence_id, entry)
    }
  }

  return (data ?? []).map(row => ({
    ...row,
    teacher_name: (row as any).teacher?.full_name ?? null,
    periods_affected: counts.get(row.id)?.total ?? 0,
    periods_covered: counts.get(row.id)?.filled ?? 0,
  }))
}

/**
 * The absent teacher is back. Stand down whatever has not started.
 *
 * Periods already under way stay exactly as they are: the substitute is
 * in the room, and the register has to say who actually taught.
 */
export async function cancelAbsence(schoolId: string, actorId: string, absenceId: string, reason: string) {
  const absence = must(await supabase.from('teacher_absences')
    .select('*, teacher:teacher_id(full_name)')
    .eq('id', absenceId).eq('school_id', schoolId).maybeSingle(), 'absence')

  const now = new Date()
  const today = toLocalDateStr(now)
  const nowTime = now.toTimeString().slice(0, 8)

  const { data: arrangements } = await supabase.from('arrangements')
    .select('id, substitute_teacher_id, period_number, start_time, status')
    .eq('absence_id', absenceId).neq('status', 'cancelled')

  // What "they're back" should stand down.
  //
  // Anything still unassigned goes, whatever the clock says: there is no
  // substitute to protect and the teacher was not, in the end, away, so
  // leaving it is pure noise. Marking somebody absent at 2pm and
  // immediately undoing it left five uncovered periods on the queue
  // forever, because every period had already "started".
  //
  // An assigned period that has already begun stays: somebody walked into
  // that room, and the register has to say so.
  const started = (a: any) =>
    absence.absence_date < today ||
    (absence.absence_date === today && !!a.start_time && a.start_time <= nowTime)

  const upcoming = (arrangements ?? []).filter(a =>
    a.status === 'unassigned' || a.status === 'declined' || !started(a))

  if (upcoming.length) {
    await supabase.from('arrangements').update({
      status: 'cancelled', cancelled_at: now.toISOString(),
      cancel_reason: reason || 'Teacher returned',
    }).in('id', upcoming.map(a => a.id))
  }

  await supabase.from('teacher_absences').update({
    status: 'cancelled', cancelled_at: now.toISOString(), cancelled_by: actorId,
  }).eq('id', absenceId)

  const substitutes = [...new Set(upcoming.map(a => a.substitute_teacher_id).filter(Boolean))] as string[]
  const teacherName = (absence as any).teacher?.full_name ?? 'The class teacher'

  if (substitutes.length) {
    await notify({
      schoolId, userIds: substitutes, type: 'arrangement_cancelled',
      title: 'Cover cancelled',
      message: `${teacherName} is back — the cover you were given for ${absence.absence_date} is no longer needed.`,
      link: '/timetable/my-week',
      relatedEntityType: 'teacher_absence', relatedEntityId: absenceId,
    })
  }

  const managers = (await arrangementManagers(schoolId)).filter(id => id !== actorId)
  if (managers.length) {
    await notify({
      schoolId, userIds: managers, type: 'arrangement_cancelled',
      title: `${teacherName} is back`,
      message: `${upcoming.length} arrangement${upcoming.length === 1 ? '' : 's'} for ${absence.absence_date} stood down. ${reason || ''}`.trim(),
      link: `/timetable/arrangements?date=${absence.absence_date}`,
      relatedEntityType: 'teacher_absence', relatedEntityId: absenceId,
    })
  }

  await audit(schoolId, actorId, 'cancel_absence', 'teacher_absence', absenceId, {
    cancelled_arrangements: upcoming.length,
    kept_in_register: (arrangements ?? []).length - upcoming.length,
    reason,
  })

  return {
    cancelledArrangements: upcoming.length,
    keptInRegister: (arrangements ?? []).length - upcoming.length,
  }
}

/**
 * Pull approved leave into the absence queue.
 *
 * Idempotent by design — it runs nightly AND on a button, and a manager
 * who presses it twice must not end up with two absences and a doubled
 * queue.
 */
export async function syncApprovedLeave(schoolId: string, actorId: string | null, dateStr: string) {
  const settings = await getSettings(schoolId)
  if (!settings.working_days.includes(dayOfWeekFor(dateStr))) {
    return { created: 0, skipped: 0, note: 'Not a working day' }
  }

  const { data: leaves, error } = await supabase.from('leave_requests')
    .select('id, user_id, from_date, to_date, leave_types(name)')
    .eq('school_id', schoolId).eq('status', 'approved')
    .lte('from_date', dateStr).gte('to_date', dateStr)
  if (error) throw badRequest('query_failed', error.message)

  const { data: existing } = await supabase.from('teacher_absences')
    .select('teacher_id').eq('school_id', schoolId).eq('absence_date', dateStr).neq('status', 'cancelled')
  const alreadyAbsent = new Set((existing ?? []).map(a => a.teacher_id))

  let created = 0
  let skipped = 0

  for (const leave of leaves ?? []) {
    if (alreadyAbsent.has(leave.user_id)) { skipped++; continue }
    try {
      const result = await createAbsence(schoolId, actorId, {
        teacherId: leave.user_id,
        date: dateStr,
        scope: 'full_day',
        source: 'leave',
        leaveRequestId: leave.id,
        reason: (leave as any).leave_types?.name ?? 'Approved leave',
      })
      if (result.arrangementsCreated >= 0) created++
      alreadyAbsent.add(leave.user_id)
    } catch (err) {
      // One teacher who is somehow already marked must not abort the
      // sweep for the rest of the staff.
      skipped++
    }
  }

  return { created, skipped, note: null as string | null }
}

/**
 * Notice a teacher who never arrived.
 *
 * Cross-references today's timetable against staff_attendance, exactly
 * as GET /students/timetable/attention-required already does for the
 * dashboard — the difference is that this turns the observation into a
 * proposed absence with the periods already worked out, so the manager
 * confirms with one click instead of retyping what the screen just told
 * them.
 *
 * It never confirms by itself. A teacher stuck in traffic who forgot to
 * punch in has not abandoned their class, and auto-reassigning their
 * whole day would be worse than doing nothing.
 */
export async function detectAbsences(schoolId: string, actorId: string | null, dateStr: string) {
  const settings = await getSettings(schoolId)
  if (!settings.auto_detect_absence) return { proposed: 0, checked: 0, disabled: true }
  if (!settings.working_days.includes(dayOfWeekFor(dateStr))) {
    return { proposed: 0, checked: 0, disabled: false }
  }

  const dow = dayOfWeekFor(dateStr)
  const nowTime = new Date().toTimeString().slice(0, 8)

  const [periodsResult, attendanceResult, absencesResult] = await Promise.all([
    supabase.from('timetable_periods')
      .select('teacher_id, period_number, start_time')
      .eq('school_id', schoolId).eq('day_of_week', dow).eq('is_break', false)
      .not('teacher_id', 'is', null),
    supabase.from('staff_attendance')
      .select('user_id, status, check_in').eq('school_id', schoolId).eq('date', dateStr),
    supabase.from('teacher_absences')
      .select('teacher_id').eq('school_id', schoolId).eq('absence_date', dateStr).neq('status', 'cancelled'),
  ])

  const attendance = new Map((attendanceResult.data ?? []).map(a => [a.user_id, a]))
  const alreadyHandled = new Set((absencesResult.data ?? []).map(a => a.teacher_id))

  // Two separate questions, and both have to be yes.
  //
  // Evidence: has a period they should already have taught started? A
  // teacher whose first class is after lunch is not missing at nine.
  //
  // Point: is there a period still to come? Cover is the only thing this
  // proposal leads to, and at ten past three there is nothing left to
  // cover. Without this the sweep spent every afternoon proposing
  // absences for a day that had finished — thirteen periods queued for
  // classes that had already been taught.
  const startedByTeacher = new Map<string, number[]>()
  const remainingByTeacher = new Map<string, number>()
  for (const row of periodsResult.data ?? []) {
    if (!row.start_time) continue
    if (row.start_time > nowTime) {
      remainingByTeacher.set(row.teacher_id, (remainingByTeacher.get(row.teacher_id) ?? 0) + 1)
      continue
    }
    const list = startedByTeacher.get(row.teacher_id) ?? []
    list.push(row.period_number)
    startedByTeacher.set(row.teacher_id, list)
  }

  let proposed = 0
  for (const [teacherId, periods] of startedByTeacher) {
    if (alreadyHandled.has(teacherId)) continue
    if (periods.length < settings.auto_detect_after_period) continue
    // Nothing left of their day, so nothing to arrange.
    if (!(remainingByTeacher.get(teacherId) ?? 0)) continue

    const record = attendance.get(teacherId)
    const present = record && record.status !== 'absent' && record.status !== 'on_leave' && !!record.check_in
    if (present) continue

    // The wording is the row's whole value: "marked absent" is somebody
    // stating a fact, "no check-in" is an inference, and a manager
    // deciding whether to confirm needs to know which one they are
    // looking at.
    const reason = !record
      ? 'No attendance recorded today, and their first period has already started'
      : record.status === 'absent' ? 'Marked absent in staff attendance'
      : record.status === 'on_leave' ? 'On approved leave'
      : 'Marked present in staff attendance, but with no check-in time recorded'

    try {
      // created_by stays null when the sweep runs unattended. Crediting
      // the absence to the teacher it is about would read, in the audit
      // log, as though they had reported themselves absent.
      await createAbsence(schoolId, actorId as any, {
        teacherId, date: dateStr, scope: 'full_day',
        source: 'attendance', status: 'proposed', reason,
      })
      proposed++
    } catch {
      // Raced with a manual entry — the manual one wins, which is right.
    }
  }

  if (proposed) {
    const managers = await arrangementManagers(schoolId)
    await notify({
      schoolId, userIds: managers, type: 'absence_detected',
      title: `${proposed} teacher${proposed === 1 ? '' : 's'} may need cover today`,
      message: `Attendance says ${proposed === 1 ? 'a teacher is' : `${proposed} teachers are`} not in, ` +
        `but their periods are still on the timetable. Confirm or dismiss on the arrangements screen.`,
      link: `/timetable/arrangements?date=${dateStr}`,
      relatedEntityType: 'absence_detection', relatedEntityId: undefined,
    })
  }

  return {
    proposed,
    checked: startedByTeacher.size,
    // So the caller can say "everyone has checked in" rather than
    // "nothing found", which reads as a failure.
    withPeriodsLeft: [...remainingByTeacher.keys()].filter(id => startedByTeacher.has(id)).length,
    disabled: false,
  }
}

/** A teacher telling the school they are leaving early, from their own device. */
export async function reportEarlyLeave(
  schoolId: string, teacherId: string, fromPeriod: number, reason: string,
) {
  const today = toLocalDateStr(new Date())
  const result = await createAbsence(schoolId, teacherId, {
    teacherId, date: today, scope: 'early_leave', fromPeriod,
    source: 'self_report', reason: reason || 'Leaving early',
  })

  const { data: teacher } = await supabase.from('users')
    .select('full_name').eq('id', teacherId).maybeSingle()

  const managers = await arrangementManagers(schoolId)
  await notify({
    schoolId, userIds: managers, type: 'absence_detected',
    title: `${teacher?.full_name ?? 'A teacher'} is leaving early today`,
    message: `From period ${fromPeriod} onward — ${result.arrangementsCreated} period${result.arrangementsCreated === 1 ? '' : 's'} need cover. ${reason || ''}`.trim(),
    link: `/timetable/arrangements?date=${today}`,
    relatedEntityType: 'teacher_absence', relatedEntityId: result.id,
  })

  return result
}

/**
 * Absences long enough that arranging cover day by day stops making
 * sense, and the teacher's classes should be redistributed instead.
 */
export async function longAbsences(schoolId: string, fromDate: string) {
  const settings = await getSettings(schoolId)
  const { data } = await supabase.from('teacher_absences')
    .select('teacher_id, absence_date, teacher:teacher_id(full_name)')
    .eq('school_id', schoolId).neq('status', 'cancelled')
    .gte('absence_date', fromDate)
    .order('absence_date', { ascending: true })

  const byTeacher = new Map<string, { name: string; dates: string[] }>()
  for (const row of data ?? []) {
    const entry = byTeacher.get(row.teacher_id) ?? { name: (row as any).teacher?.full_name ?? '', dates: [] }
    entry.dates.push(row.absence_date)
    byTeacher.set(row.teacher_id, entry)
  }

  return [...byTeacher.entries()]
    .filter(([, v]) => v.dates.length >= settings.long_absence_threshold_days)
    .map(([teacherId, v]) => ({
      teacherId, name: v.name, days: v.dates.length,
      from: v.dates[0], to: v.dates[v.dates.length - 1],
      thresholdDays: settings.long_absence_threshold_days,
    }))
}
