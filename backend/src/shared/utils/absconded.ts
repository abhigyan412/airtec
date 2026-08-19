import { supabase } from '../db/client'
import { toLocalDateStr, getNonWorkingDaySets, isWorkingDate, dateRangeStrings } from './academicCalendar'
import { createNotifications } from './notifications'
import { getUserIdsWithPermission } from '../middleware/permissions-v2'

// ── Absconded sweep ──────────────────────────────────────────────
//
// Same shape as hrAlerts.ts: an unattended cross-school sweep plus a
// per-school manual trigger. A staff member who has stopped showing up
// with no approved leave and no pending regularization explaining the
// gap, for at least the school's configured threshold of consecutive
// WORKING days, gets flagged — either auto-set to 'absconded'
// (absconded_auto_flag=true) or surfaced as a notification for review
// (the default), never silently.
//
// Today is deliberately excluded from the streak — same reasoning as
// Stage 10.2b's coverage-check fix, its attendance is routinely marked
// end-of-day, not the moment the day starts, so counting it as a gap
// before the day is even over would false-positive the newest hires
// and every ordinary morning sweep run.
// Absconding is inferred entirely from the staff attendance register,
// so a school that does not keep one has no basis for the inference.
// Two guards, because the two failure modes are different:
//
//   * a school that never bought the attendance module (a timetable-only
//     school, say) — the sweep has no business running there at all, and
//     the review link it sends points into a module they cannot open;
//   * a school that has the module but has recorded nothing in the whole
//     window — a register nobody fills in is not evidence that the entire
//     staff has walked out.
//
// Observed in production: a timetable-only school with 29 teachers and no
// attendance register generated 29 "possible absconding" alerts on one
// sweep, burying every real notification in the administrator's list. Had
// absconded_auto_flag been on it would have marked all 29 teachers
// absconded outright.
const ATTENDANCE_MODULE = 'attendance'
const LOOKBACK_MULTIPLIER = 4
const MAX_LOOKBACK_DAYS = 120

const NOT_ELIGIBLE = ['resigned', 'terminated', 'absconded']

export async function runAbscondedSweep(schoolId?: string) {
  const today = toLocalDateStr(new Date())

  let schoolsQuery = supabase.from('schools').select('id, absconded_threshold_days, absconded_auto_flag, enabled_modules')
  if (schoolId) schoolsQuery = schoolsQuery.eq('id', schoolId)
  const { data: schools } = await schoolsQuery

  let flagged = 0
  let autoSet = 0
  const flaggedDetail: { school_id: string; user_id: string; full_name: string; streak_days: number; last_seen: string | null }[] = []

  const skipped: { school_id: string; why: string }[] = []

  for (const school of (schools ?? []) as any[]) {
    // NULL enabled_modules means "everything", which is the norm.
    if (Array.isArray(school.enabled_modules) && !school.enabled_modules.includes(ATTENDANCE_MODULE)) {
      skipped.push({ school_id: school.id, why: 'attendance module not enabled' })
      continue
    }

    const threshold = school.absconded_threshold_days ?? 15
    const lookbackDays = Math.min(MAX_LOOKBACK_DAYS, threshold * LOOKBACK_MULTIPLIER)
    const windowStart = toLocalDateStr(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000))
    // Yesterday — today is excluded entirely, see module comment.
    const windowEnd = toLocalDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000))
    if (windowEnd < windowStart) continue

    const { data: profiles } = await supabase.from('staff_profiles')
      .select('user_id, employment_status, users:user_id(full_name)')
      .eq('school_id', school.id).not('employment_status', 'in', `(${NOT_ELIGIBLE.join(',')})`)
    const targetUserIds = (profiles ?? []).map((p: any) => p.user_id)
    if (!targetUserIds.length) continue

    // Is the register in use at all? One row from anyone is enough to
    // show it is; none at all means there is nothing to reason from.
    const { count: attendanceRowsInWindow } = await supabase.from('staff_attendance')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school.id).gte('date', windowStart).lte('date', windowEnd)
    if (!attendanceRowsInWindow) {
      skipped.push({ school_id: school.id, why: 'no staff attendance recorded in the window' })
      continue
    }

    const nonWorkingSets = await getNonWorkingDaySets(school.id, windowStart, windowEnd)

    const [{ data: records }, { data: approvedLeaves }, { data: pendingRegs }] = await Promise.all([
      supabase.from('staff_attendance').select('user_id, date, status')
        .eq('school_id', school.id).in('user_id', targetUserIds).gte('date', windowStart).lte('date', windowEnd),
      supabase.from('leave_requests').select('user_id, from_date, to_date')
        .eq('school_id', school.id).eq('status', 'approved').in('user_id', targetUserIds)
        .lte('from_date', windowEnd).gte('to_date', windowStart),
      // Critical boundary: a PENDING regularization must exclude its date
      // from the streak too, not only an approved one — someone who
      // submitted a regularization covering the gap hasn't been ignored,
      // they're waiting on a decision.
      supabase.from('staff_attendance_regularizations').select('user_id, date')
        .eq('school_id', school.id).eq('status', 'pending').in('user_id', targetUserIds)
        .gte('date', windowStart).lte('date', windowEnd),
    ])

    const accountedByUser = new Map<string, Set<string>>()
    const addAccounted = (userId: string, date: string) => {
      if (!accountedByUser.has(userId)) accountedByUser.set(userId, new Set())
      accountedByUser.get(userId)!.add(date)
    }
    const lastSeenByUser = new Map<string, string>()
    for (const r of (records ?? []) as any[]) {
      if (['present', 'half_day', 'on_leave'].includes(r.status)) {
        addAccounted(r.user_id, r.date)
        if (r.status !== 'on_leave') {
          const existing = lastSeenByUser.get(r.user_id)
          if (!existing || r.date > existing) lastSeenByUser.set(r.user_id, r.date)
        }
      }
      // A marked 'absent' row still counts toward the gap (it's not
      // "accounted for" — someone recorded them as not there), so it's
      // deliberately NOT added here.
    }
    for (const lr of (approvedLeaves ?? []) as any[]) {
      const start = lr.from_date < windowStart ? windowStart : lr.from_date
      const end = lr.to_date > windowEnd ? windowEnd : lr.to_date
      for (const d of dateRangeStrings(start, end)) addAccounted(lr.user_id, d)
    }
    for (const reg of (pendingRegs ?? []) as any[]) addAccounted(reg.user_id, reg.date)

    for (const profile of (profiles ?? []) as any[]) {
      const userId = profile.user_id
      const accounted = accountedByUser.get(userId) ?? new Set<string>()
      const workingDates = dateRangeStrings(windowStart, windowEnd).filter(d => isWorkingDate(d, nonWorkingSets))

      // Walk backward from the most recent elapsed working day; the
      // streak is however many consecutive working days in a row (right
      // up to the end of the window) are neither accounted for nor
      // broken by a day where they actually showed up.
      let streak = 0
      for (let i = workingDates.length - 1; i >= 0; i--) {
        const d = workingDates[i]
        if (accounted.has(d)) break
        streak++
      }

      if (streak >= threshold) {
        flagged++
        flaggedDetail.push({
          school_id: school.id, user_id: userId, full_name: profile.users?.full_name ?? 'A staff member',
          streak_days: streak, last_seen: lastSeenByUser.get(userId) ?? null,
        })

        if (school.absconded_auto_flag) {
          await supabase.from('staff_profiles').update({ employment_status: 'absconded' }).eq('user_id', userId).eq('school_id', school.id)
          autoSet++
        } else {
          const recipients = await getUserIdsWithPermission(school.id, 'staff.edit')
          if (recipients.length) {
            await createNotifications(recipients, {
              schoolId: school.id, type: 'absconded_review_needed',
              title: 'Possible absconding — review required',
              message: `${profile.users?.full_name ?? 'A staff member'} has ${streak} consecutive unmarked/absent working day${streak === 1 ? '' : 's'} with no approved leave or pending regularization.${lastSeenByUser.get(userId) ? ` Last seen ${lastSeenByUser.get(userId)}.` : ''}`,
              link: `/hr/staff/${userId}`, relatedEntityType: 'staff_profile', relatedEntityId: userId,
            })
          }
        }
      }
    }
  }

  return { flagged, autoSet, detail: flaggedDetail, skipped }
}
