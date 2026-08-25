import { supabase } from '../../../shared/db/client'

/**
 * Employment statuses that mean a teacher will not be taking their
 * classes, and how to say each one.
 *
 * Not only the people who have left. A suspended teacher is employed and
 * not teaching; somebody on extended leave is employed and not teaching.
 * From the timetable's point of view those classes are just as unstaffed
 * as a resigned teacher's, and treating only departures as a problem
 * left the rest silently uncovered.
 *
 * The two kinds want different answers, so they are told apart:
 * somebody who has gone needs their periods permanently reassigned,
 * somebody who is temporarily out needs cover until they are back.
 */
export const NOT_TEACHING_STATUSES: Record<string, { phrase: string; permanent: boolean }> = {
  resigned:   { phrase: 'has resigned',                   permanent: true },
  terminated: { phrase: 'has been terminated',            permanent: true },
  absconded:  { phrase: 'has been recorded as absconded', permanent: true },
  suspended:  { phrase: 'is suspended',                   permanent: false },
}

// Deliberately NOT here: employment_status 'on_leave'.
//
// Leave is evidenced by an approved leave request, and that path already
// works — syncApprovedLeave pulls it into the queue with source 'leave',
// naming the type and the dates. The status field on its own is not
// evidence of anything: at the school this was found on, five teachers
// carried 'on_leave' with no leave record anywhere behind it, and the
// timetable was announcing "is on extended leave — their periods need
// cover until they are back" about people HR had no leave for. Saying a
// thing no record supports is how a screen stops being believed.
//
// Somebody genuinely on long leave has a leave request, and that reaches
// the queue by the honest route.

/** Kept for callers that only care whether somebody is unavailable. */
export const DEPARTED_STATUSES = Object.keys(NOT_TEACHING_STATUSES)
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
      const created = await materialize(existing.id, input.date)
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

  const created = await materialize(absence.id, input.date)

  await audit(schoolId, actorId, 'create_absence', 'teacher_absence', absence.id, {
    teacher: input.teacherId, date: input.date, scope: input.scope, arrangements: created,
  })

  return { id: absence.id, arrangementsCreated: created, upgraded: false }
}

/**
 * Fan an absence out into the cover queue.
 *
 * For today, periods that have already started are left out: nobody can
 * cover a lesson that finished an hour ago, and queueing them produced
 * "8 periods · 8 still uncovered" at two in the afternoon for a day that
 * was nearly over. The cutoff is computed here rather than in the
 * database because period times are local wall-clock and the database
 * runs in UTC.
 */
async function materialize(absenceId: string, dateStr?: string): Promise<number> {
  const today = toLocalDateStr(new Date())
  const notBefore = dateStr === today ? new Date().toTimeString().slice(0, 8) : null

  const { data, error } = await supabase.rpc('timetable_materialize_arrangements', {
    p_absence_id: absenceId,
    p_not_before: notBefore,
  } as any)
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

  // Two different problems get listed on the same screen and they want
  // different answers. "Mrs Sharma is off sick" is today's problem and
  // is settled by finding cover. "Mr Nair resigned in June and still
  // holds thirty periods" is a defect in the timetable: cover patches it
  // for one day and it is back tomorrow, and every day after, until
  // somebody reassigns the periods. Offering "They're here" against
  // somebody who has left is nonsense — they are not coming back.
  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status').eq('school_id', schoolId)
  const statusOf = new Map((profiles ?? []).map(p => [p.user_id, p.employment_status]))

  return (data ?? []).map(row => {
    const employmentStatus = statusOf.get(row.teacher_id) ?? null
    const staffing = employmentStatus ? NOT_TEACHING_STATUSES[employmentStatus] : undefined
    return {
      ...row,
      teacher_name: (row as any).teacher?.full_name ?? null,
      periods_affected: counts.get(row.id)?.total ?? 0,
      periods_covered: counts.get(row.id)?.filled ?? 0,
      employment_status: employmentStatus,
      /** The timetable itself is wrong; cover is only a stopgap. */
      needs_timetable_fix: !!staffing,
      /** Whether they are ever coming back to these classes. */
      permanently_gone: staffing?.permanent ?? false,
    }
  })
}

/**
 * The absent teacher is back. Stand down whatever has not started.
 *
 * Periods already under way stay exactly as they are: the substitute is
 * in the room, and the register has to say who actually taught.
 */
/**
 * What "they're back" is about to do, before it does it.
 *
 * Standing an absence down is not one decision, it is one per period. A
 * teacher who walks in at eleven can take their own afternoon back, but
 * period 3 was taught by somebody else an hour ago and no amount of
 * cancelling changes that; and of the periods still to come, the manager
 * may want to leave one covered because the teacher is going straight
 * into a meeting. Deciding all of that on the teacher's behalf and then
 * reporting a number was how "5 periods, 5 still uncovered" happened.
 *
 * So the caller is shown every period, told which have already gone and
 * which substitute is expected where, and picks.
 */
export async function cancelPreview(schoolId: string, absenceId: string) {
  const absence = must(await supabase.from('teacher_absences')
    .select('*, teacher:teacher_id(full_name)')
    .eq('id', absenceId).eq('school_id', schoolId).maybeSingle(), 'absence')

  const now = new Date()
  const today = toLocalDateStr(now)
  const nowTime = now.toTimeString().slice(0, 8)

  const { data: arrangements } = await supabase.from('arrangements')
    .select(`
      id, period_number, start_time, end_time, status, subject_name,
      substitute_teacher_id, acknowledged_at,
      substitute:substitute_teacher_id(full_name),
      classes(name), sections(name)
    `)
    .eq('absence_id', absenceId).neq('status', 'cancelled')
    .order('period_number')

  const periods = (arrangements ?? []).map((a: any) => {
    const past = absence.absence_date < today ||
      (absence.absence_date === today && !!a.start_time && a.start_time <= nowTime)
    const hasSubstitute = !!a.substitute_teacher_id &&
      a.status !== 'declined' && a.status !== 'unassigned'

    return {
      arrangementId: a.id,
      periodNumber: a.period_number,
      startTime: a.start_time,
      endTime: a.end_time,
      subjectName: a.subject_name,
      className: [a.classes?.name, a.sections?.name].filter(Boolean).join(' ') || null,
      status: a.status,
      substituteName: a.substitute?.full_name ?? null,
      acknowledged: !!a.acknowledged_at,
      past,
      hasSubstitute,
      // A period already taught cannot be un-taught: the register has to
      // say who stood in front of that class. Everything else is the
      // manager's call, and the sensible default is to stand it down.
      canCancel: !past || !hasSubstitute,
      defaultCancel: !past || !hasSubstitute,
      why: past && hasSubstitute
        ? `${a.substitute?.full_name ?? 'A substitute'} already taught this — it stays on the register`
        : past
          ? 'Already gone, and nobody was covering it'
          : hasSubstitute
            ? `${a.substitute?.full_name ?? 'A substitute'} is booked for this`
            : 'Still waiting for a substitute',
    }
  })

  return {
    absenceId,
    teacherName: (absence as any).teacher?.full_name ?? 'This teacher',
    date: absence.absence_date,
    scope: absence.scope,
    periods,
    cancellable: periods.filter(p => p.canCancel).length,
    lockedToRegister: periods.filter(p => !p.canCancel).length,
  }
}

/**
 * Stand an absence down.
 *
 * `keepArrangementIds` names the covers the manager chose to leave in
 * place. Omitted entirely, the old all-or-nothing behaviour applies, so
 * the auto-detection sweep and any other non-interactive caller keeps
 * working unchanged.
 */
export async function cancelAbsence(
  schoolId: string, actorId: string, absenceId: string, reason: string,
  keepArrangementIds?: string[],
) {
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

  const keep = new Set(keepArrangementIds ?? [])
  const upcoming = (arrangements ?? []).filter(a =>
    !keep.has(a.id) &&
    (a.status === 'unassigned' || a.status === 'declined' || !started(a)))

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

  // Somebody whose cover was deliberately kept must not be left guessing
  // whether it still stands, having just heard the teacher is back.
  const keptWithSubstitute = (arrangements ?? [])
    .filter(a => keep.has(a.id) && a.substitute_teacher_id)
  const keptSubstitutes = [...new Set(keptWithSubstitute.map(a => a.substitute_teacher_id))] as string[]
  if (keptSubstitutes.length) {
    await notify({
      schoolId, userIds: keptSubstitutes, type: 'arrangement_assigned',
      title: 'Your cover still stands',
      message: `${teacherName} is back, but you are still covering ${
        keptWithSubstitute.length === 1
          ? `period ${keptWithSubstitute[0].period_number}`
          : `${keptWithSubstitute.length} periods`
      } on ${absence.absence_date}.`,
      link: '/timetable/my-week',
      relatedEntityType: 'teacher_absence', relatedEntityId: absenceId,
    })
  }

  const managers = (await arrangementManagers(schoolId)).filter(id => id !== actorId)
  if (managers.length) {
    await notify({
      schoolId, userIds: managers, type: 'arrangement_cancelled',
      title: `${teacherName} is back`,
      message: `${upcoming.length} arrangement${upcoming.length === 1 ? '' : 's'} for ${absence.absence_date} stood down${
        keptWithSubstitute.length ? `, ${keptWithSubstitute.length} kept in place` : ''
      }. ${reason || ''}`.trim(),
      link: `/timetable/arrangements?date=${absence.absence_date}`,
      relatedEntityType: 'teacher_absence', relatedEntityId: absenceId,
    })
  }

  await audit(schoolId, actorId, 'cancel_absence', 'teacher_absence', absenceId, {
    cancelled_arrangements: upcoming.length,
    kept_in_register: (arrangements ?? []).length - upcoming.length,
    kept_by_choice: keptWithSubstitute.length,
    reason,
  })

  return {
    cancelledArrangements: upcoming.length,
    keptInRegister: (arrangements ?? []).length - upcoming.length,
    keptByChoice: keptWithSubstitute.length,
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

  // "Has this period already happened" depends on which day is being
  // asked about, and the clock alone cannot answer it. Looking at
  // tomorrow at half past one used to treat tomorrow morning as already
  // gone, because the comparison was against today's time whatever date
  // was passed. A future day has not started at all; a past one is
  // entirely over.
  const todayStr = toLocalDateStr(new Date())
  const cutoff = dateStr > todayStr ? '00:00:00'
    : dateStr < todayStr ? '23:59:59'
    : new Date().toTimeString().slice(0, 8)
  const isFuture = dateStr > todayStr

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

  // Has the register been taken today, and taken far enough to reason
  // from?
  //
  // A missing attendance row means "not marked", and what that is
  // evidence OF depends entirely on how much of the register is filled
  // in. Once the office has worked through the staff, a teacher with no
  // row stands out. Before they start, EVERY teacher has no row, and
  // reading that as "nobody came to school" is how this sweep proposed
  // 69 absences at a school where two people were away — it ran at 07:00
  // and the register was filled in at 08:00.
  //
  // "Any row at all" is not enough either: it just moves the same
  // catastrophe to the moment the first teacher is marked, when the
  // other eighty-six are still unmarked and would all be proposed. So
  // omission only counts once most of the staff have been dealt with.
  // Below that the register is mid-entry, and the only evidence worth
  // acting on is somebody explicitly marked absent or on leave.
  const attendanceRows = attendanceResult.data ?? []

  // Who can be marked at all.
  //
  // Somebody who has resigned or been terminated is off the staff
  // register, so they have no attendance row and never will. Counting
  // them as unmarked staff proposes them absent every day for the rest
  // of time — and drags the denominator down so the register never looks
  // complete. They are not absent; they have left. That the timetable
  // still has them teaching is a separate and much worse problem, and
  // the block view reports it as one.
  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status').eq('school_id', schoolId)
  const departed = new Map((profiles ?? [])
    .filter(p => !!NOT_TEACHING_STATUSES[p.employment_status])
    .map(p => [p.user_id, p.employment_status as string]))

  const { count: onRegister } = await supabase.from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId).eq('is_active', true)
    .not('role', 'in', '("parent","student")')
  const markable = Math.max(0, (onRegister ?? 0) - departed.size)

  const REGISTER_COMPLETE_ENOUGH = 0.8
  const registerTaken = attendanceRows.length > 0
  const registerUsable = markable > 0 &&
    attendanceRows.length >= markable * REGISTER_COMPLETE_ENOUGH

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
  /** Everyone who teaches at all that day, started or not. */
  const teachesToday = new Set<string>()
  for (const row of periodsResult.data ?? []) {
    if (!row.start_time) continue
    teachesToday.add(row.teacher_id)
    if (row.start_time > cutoff) {
      remainingByTeacher.set(row.teacher_id, (remainingByTeacher.get(row.teacher_id) ?? 0) + 1)
      continue
    }
    const list = startedByTeacher.get(row.teacher_id) ?? []
    list.push(row.period_number)
    startedByTeacher.set(row.teacher_id, list)
  }

  // An auto-raised absence that no longer has any basis is withdrawn.
  //
  // Reassign a departed teacher's periods and the alert must go: it was
  // raised because the timetable pointed at somebody who would not
  // teach, and it stops being true the moment that is fixed. Leaving it
  // there would mean the only way to clear the warning was to dismiss
  // it by hand, which trains people to dismiss warnings.
  const { data: standing } = await supabase.from('teacher_absences')
    .select('id, teacher_id, source').eq('school_id', schoolId)
    .eq('absence_date', dateStr).eq('status', 'proposed')
  let withdrawn = 0
  for (const row of standing ?? []) {
    if (row.source !== 'attendance') continue
    const stillTeaching = teachesToday.has(row.teacher_id)
    const stillUnavailable = departed.has(row.teacher_id) ||
      ['absent', 'on_leave'].includes(attendance.get(row.teacher_id)?.status ?? '')
    if (stillTeaching && stillUnavailable) continue
    // Only ever withdraws rows nobody has acted on.
    const { data: arr } = await supabase.from('arrangements')
      .select('id, substitute_teacher_id, acknowledged_at').eq('absence_id', row.id)
    if ((arr ?? []).some(a => a.substitute_teacher_id || a.acknowledged_at)) continue
    await supabase.from('arrangements').delete().eq('absence_id', row.id)
    await supabase.from('teacher_absences').delete().eq('id', row.id)
    withdrawn++
  }

  let proposed = 0
  // Marked absent, but every one of their periods has already been and
  // gone. No cover can be arranged for a lesson that finished an hour
  // ago — but the check must SAY so. Reporting "nothing found" to
  // somebody who has just marked two people absent reads as the feature
  // being broken, which is exactly how it was reported.
  const absentButDayOver: string[] = []

  // Iterating everyone who teaches that day, not only those whose
  // lessons have already begun. On a future date nothing has begun, so
  // the old loop was empty and a teacher who has left never appeared
  // when planning tomorrow — the one moment there is still time to move
  // their classes to somebody else.
  for (const teacherId of teachesToday) {
    const periods = startedByTeacher.get(teacherId) ?? []
    if (alreadyHandled.has(teacherId)) continue
    // Somebody who has left needs no evidence from a register and no
    // lesson to have elapsed: their classes are unstaffed on every day
    // they appear on the timetable, today and every day after, until
    // somebody reassigns the periods. Requiring an elapsed lesson meant
    // they never showed up when planning tomorrow — which is precisely
    // when there is still time to do something about it.
    if (!departed.has(teacherId) && periods.length < settings.auto_detect_after_period) continue
    // Nothing left of their day, so nothing to arrange.
    if (!(remainingByTeacher.get(teacherId) ?? 0)) {
      const rec = attendance.get(teacherId)
      if (rec && (rec.status === 'absent' || rec.status === 'on_leave')) {
        absentButDayOver.push(teacherId)
      }
      continue
    }

    // Attendance is a record of a day that has happened. On a future
    // date there is none, and its absence says nothing.
    const record = isFuture ? undefined : attendance.get(teacherId)

    // Somebody who has left is not absent, but their classes still need
    // a teacher every day until the timetable is fixed, so they are
    // raised rather than hidden — with a reason that says what is
    // actually wrong. Hiding them meant nobody covered those lessons and
    // nothing said why. They have no attendance row and never will, so
    // they are their own category of evidence rather than being judged
    // against the register.
    const hasLeft = departed.has(teacherId)

    // Only three things justify proposing an absence, and a missing
    // check-in TIME is not one of them. Plenty of schools record a
    // status and never a clock time; treating that as absence proposed
    // cover for every teacher in the building. Whether somebody has
    // clocked in is still surfaced, on the attention panel, where it
    // reads as the observation it is rather than as a full-day absence.
    const explicitlyOut = !!record && (record.status === 'absent' || record.status === 'on_leave')
    const unmarkedButRegisterTaken = !isFuture && !record && registerUsable && !hasLeft
    if (!hasLeft && !explicitlyOut && !unmarkedButRegisterTaken) continue

    // The wording is the row's whole value: "marked absent" is somebody
    // stating a fact, "no check-in" is an inference, and a manager
    // deciding whether to confirm needs to know which one they are
    // looking at.
    const status = hasLeft ? NOT_TEACHING_STATUSES[departed.get(teacherId) as string] : null
    // "Has been terminated — no longer on the staff…" rather than
    // "No longer on the staff — been terminated…", which is not English.
    const sentence = status ? status.phrase.charAt(0).toUpperCase() + status.phrase.slice(1) : ''
    const reason = status
      ? status.permanent
        ? `${sentence} — no longer on the staff, so these periods need a permanent teacher, and cover until then`
        : `${sentence} — their periods need cover until they are back`
      : !record
        ? 'Everyone else has been marked today, but they have not been — and their first period has already started'
        : record.status === 'absent' ? 'Marked absent in staff attendance'
        : 'On approved leave'

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
    checked: teachesToday.size,
    /** So the caller can say "the register hasn't been taken yet". */
    registerTaken,
    /** Far enough through the register to read anything into omissions. */
    registerUsable,
    /** Still on the timetable despite having left. */
    departedStillTeaching: [...startedByTeacher.keys()].filter(id => departed.has(id)).length,
    /** Marked absent, but all their lessons had already finished. */
    absentButDayOver: absentButDayOver.length,
    /** Auto-raised alerts withdrawn because they no longer hold. */
    withdrawn,
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
