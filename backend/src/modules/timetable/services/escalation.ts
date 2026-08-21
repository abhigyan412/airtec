import { supabase } from '../../../shared/db/client'
import { toLocalDateStr } from '../../../shared/utils/academicCalendar'
import { arrangementManagers, audit, DAY_NAMES, formatTime, getSettings, notify } from '../lib/core'
import { detectAbsences, syncApprovedLeave } from './absences'
import { alertOnBreaches } from './workload'

// ═══════════════════════════════════════════════════════════════
// The unattended sweeps.
// ═══════════════════════════════════════════════════════════════
//
// An arrangement that nobody acknowledges is indistinguishable, from the
// office, from one that is handled — right up until a class of thirty
// sits unsupervised. Chasing it is the whole point of the workflow, and
// chasing has to happen without anybody remembering to look.
//
// Same caveat as every other cron in this app (see index.ts): an
// in-process schedule only runs while the process is up, which on a host
// that sleeps when idle may mean never. Every sweep here therefore has a
// matching POST endpoint so an external scheduler — or a manager who
// suspects nothing is firing — can trigger it directly.

export interface SweepResult {
  schools: number
  reminded: number
  escalated: number
  unfilled: number
}

/**
 * Chase assigned-but-unacknowledged cover, then escalate.
 *
 * Two thresholds, both per school: a reminder to the substitute, and
 * then a message to whoever holds arrangement.manage plus the principal.
 * Escalating to the person who already failed to act would not be an
 * escalation, which is why the recipient list is resolved from the
 * permission rather than from "whoever assigned it".
 */
export async function runAcknowledgementSweep(schoolIdFilter?: string): Promise<SweepResult> {
  const result: SweepResult = { schools: 0, reminded: 0, escalated: 0, unfilled: 0 }

  let query = supabase.from('arrangements')
    .select(`
      id, school_id, arrangement_date, period_number, start_time, subject_name,
      substitute_teacher_id, assigned_at, reminder_sent_at, escalated_at, status,
      classes(name), sections(name),
      substitute:substitute_teacher_id(full_name)
    `)
    .eq('status', 'assigned')
    .not('assigned_at', 'is', null)
    .gte('arrangement_date', toLocalDateStr(new Date()))
  if (schoolIdFilter) query = query.eq('school_id', schoolIdFilter)

  const { data, error } = await query
  if (error) {
    console.error('[timetable-escalation] query failed:', error.message)
    return result
  }

  const bySchool = new Map<string, any[]>()
  for (const row of data ?? []) {
    if (!bySchool.has(row.school_id)) bySchool.set(row.school_id, [])
    bySchool.get(row.school_id)!.push(row)
  }

  const now = Date.now()

  for (const [schoolId, rows] of bySchool) {
    result.schools++
    const settings = await getSettings(schoolId)
    const managers = await arrangementManagers(schoolId)

    const toRemind: any[] = []
    const toEscalate: any[] = []

    for (const row of rows) {
      const assignedMinutesAgo = (now - new Date(row.assigned_at).getTime()) / 60000
      if (!row.escalated_at && assignedMinutesAgo >= settings.ack_escalate_minutes) {
        toEscalate.push(row)
      } else if (!row.reminder_sent_at && assignedMinutesAgo >= settings.ack_reminder_minutes) {
        toRemind.push(row)
      }
    }

    for (const row of toRemind) {
      await notify({
        schoolId, userIds: [row.substitute_teacher_id], type: 'arrangement_reminder',
        title: 'Please confirm the class you are covering',
        message: `${describe(row)} — you have not acknowledged this yet.`,
        link: '/timetable/my-week',
        relatedEntityType: 'arrangement', relatedEntityId: row.id,
      })
    }
    if (toRemind.length) {
      await supabase.from('arrangements')
        .update({ reminder_sent_at: new Date().toISOString() })
        .in('id', toRemind.map(r => r.id))
      result.reminded += toRemind.length
    }

    if (toEscalate.length && managers.length) {
      // One message listing everything outstanding, not one per period.
      // Five separate pushes about the same Monday morning is how a
      // school learns to ignore the app.
      const lines = toEscalate.slice(0, 5)
        .map(r => `• ${(r as any).substitute?.full_name ?? 'Substitute'} — ${describe(r)}`)
        .join('\n')
      await notify({
        schoolId, userIds: managers, type: 'arrangement_escalated',
        title: `${toEscalate.length} cover assignment${toEscalate.length === 1 ? '' : 's'} not acknowledged`,
        message: `${lines}${toEscalate.length > 5 ? `\n…and ${toEscalate.length - 5} more` : ''}`,
        link: `/timetable/arrangements?date=${toEscalate[0].arrangement_date}`,
        relatedEntityType: 'arrangement', relatedEntityId: toEscalate[0].id,
      })
    }
    if (toEscalate.length) {
      await supabase.from('arrangements')
        .update({ escalated_at: new Date().toISOString() })
        .in('id', toEscalate.map(r => r.id))
      result.escalated += toEscalate.length
      await audit(schoolId, null, 'escalate', 'arrangement', toEscalate[0].id, {
        count: toEscalate.length, ids: toEscalate.map(r => r.id),
      })
    }
  }

  return result
}

/**
 * Periods today that still have nobody in front of them.
 *
 * Deliberately anchored to periods that have not yet started: telling a
 * manager at 11am that period 2 was uncovered is a post-mortem, not an
 * alert.
 */
export async function runUnfilledSweep(schoolIdFilter?: string): Promise<{ schools: number; alerted: number }> {
  const today = toLocalDateStr(new Date())
  const nowTime = new Date().toTimeString().slice(0, 8)

  let query = supabase.from('arrangements')
    .select('id, school_id, period_number, start_time, subject_name, classes(name), sections(name)')
    .eq('arrangement_date', today)
    .eq('status', 'unassigned')
  if (schoolIdFilter) query = query.eq('school_id', schoolIdFilter)

  const { data } = await query
  const bySchool = new Map<string, any[]>()
  for (const row of data ?? []) {
    if (row.start_time && row.start_time <= nowTime) continue
    if (!bySchool.has(row.school_id)) bySchool.set(row.school_id, [])
    bySchool.get(row.school_id)!.push(row)
  }

  let alerted = 0
  for (const [schoolId, rows] of bySchool) {
    const managers = await arrangementManagers(schoolId)
    if (!managers.length) continue
    const next = rows.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))[0]
    await notify({
      schoolId, userIds: managers, type: 'arrangement_unfilled',
      title: `${rows.length} period${rows.length === 1 ? '' : 's'} still need cover today`,
      message: `The next one is ${describe(next)}.`,
      link: `/timetable/arrangements?date=${today}`,
      relatedEntityType: 'arrangement', relatedEntityId: next.id,
    })
    alerted += rows.length
  }

  return { schools: bySchool.size, alerted }
}

/**
 * The morning routine, for every school.
 *
 * Order matters: approved leave first (so a planned absence is already
 * in the queue before anybody looks), then detection (so it does not
 * propose an absence for somebody whose leave was just synced).
 */
/** How far ahead approved leave is pulled into the cover queue. */
const LEAVE_LOOKAHEAD_DAYS = 7

export async function runMorningSweep(): Promise<{
  schools: number; leaveSynced: number; detected: number
}> {
  const today = toLocalDateStr(new Date())
  const { data: schools } = await supabase.from('schools').select('id')

  // Today, and the week after it. Leave is approved in advance and the
  // whole point of knowing about it is to arrange cover before the day
  // arrives — syncing only today meant a manager opening tomorrow saw an
  // empty queue for a teacher whose leave was approved a fortnight ago,
  // and found out on the morning.
  const horizon: string[] = []
  for (let i = 0; i <= LEAVE_LOOKAHEAD_DAYS; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    horizon.push(toLocalDateStr(d))
  }

  let leaveSynced = 0
  let detected = 0

  for (const school of schools ?? []) {
    for (const date of horizon) {
      try {
        const leave = await syncApprovedLeave(school.id, null as any, date)
        leaveSynced += leave.created
      } catch (err: any) {
        console.error(`[timetable-morning] leave sync failed for ${school.id} on ${date}:`, err?.message)
      }
    }
    try {
      const detection = await detectAbsences(school.id, null, today)
      detected += detection.proposed
    } catch (err: any) {
      console.error(`[timetable-morning] absence detection failed for ${school.id}:`, err?.message)
    }
  }

  return { schools: (schools ?? []).length, leaveSynced, detected }
}

/**
 * Look for teachers who have not turned up, across every school.
 *
 * Split out from the morning sweep, which runs at 06:45 — before the
 * first bell, which is right for pulling approved leave into the queue
 * because leave is known in advance. It is exactly wrong for attendance
 * detection, which only flags a teacher whose period has ALREADY
 * started: at 06:45 no period has, so that half of the sweep proposed
 * nothing, every day, at both schools on this installation. The feature
 * worked only when somebody pressed the button by hand.
 *
 * So it runs on a cadence through the teaching day instead. That also
 * catches the case the single morning pass never could — somebody who
 * was in at nine and gone by noon.
 *
 * Safe to repeat: detectAbsences skips any teacher who already has a
 * non-cancelled absence for the date, so a teacher is proposed once and
 * managers are told once, however often this runs.
 */
export async function runAbsenceDetectionSweep(): Promise<{
  schools: number; detected: number
}> {
  const { data: schools } = await supabase.from('schools').select('id')

  // Today, and the same week ahead the leave sync covers.
  //
  // Today's pass is the attendance one — who has not turned up. The
  // forward passes cannot be about attendance, because there is none
  // yet; they exist to surface the problems that are already knowable,
  // chiefly a teacher who has left and still holds periods. Those
  // classes are unstaffed every day until somebody reassigns them, and
  // the only useful time to find that out is before the day starts.
  const horizon: string[] = []
  for (let i = 0; i <= LEAVE_LOOKAHEAD_DAYS; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    horizon.push(toLocalDateStr(d))
  }

  let detected = 0
  for (const school of schools ?? []) {
    for (const date of horizon) {
      try {
        const detection = await detectAbsences(school.id, null, date)
        detected += detection.proposed
      } catch (err: any) {
        console.error(`[timetable-detect] failed for ${school.id} on ${date}:`, err?.message)
      }
    }
  }

  return { schools: (schools ?? []).length, detected }
}

/** Weekly workload check across every school. */
export async function runWorkloadSweep(): Promise<{ schools: number; alerted: number }> {
  const { data: schools } = await supabase.from('schools').select('id')
  let alerted = 0
  for (const school of schools ?? []) {
    try {
      const result = await alertOnBreaches(school.id)
      alerted += result.alerted
    } catch (err: any) {
      console.error(`[timetable-workload] sweep failed for ${school.id}:`, err?.message)
    }
  }
  return { schools: (schools ?? []).length, alerted }
}

function describe(row: any): string {
  const where = `${row.classes?.name ?? ''}${row.sections?.name ? `-${row.sections.name}` : ''}`.trim()
  const what = row.subject_name ? ` ${row.subject_name}` : ''
  const when = row.start_time ? ` at ${formatTime(row.start_time)}` : ''
  return `${where}${what}, period ${row.period_number}${when}`
}
