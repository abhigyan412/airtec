import { supabase } from '../../../shared/db/client'
import { arrangementManagers, audit, badRequest, conflict, DAY_NAMES, fetchAll, getSettings, must, notify } from '../lib/core'
import { monthBounds } from './arrangements'

// ═══════════════════════════════════════════════════════════════
// Who is carrying too much, and what to do about it.
// ═══════════════════════════════════════════════════════════════
//
// In the school this was built for, the weekly teaching load runs from
// 5 periods to 48 — a tenfold spread — and one teacher takes eight
// periods back to back, every day, with a single free period. That is
// not a rounding error to surface in a report nobody opens; it is the
// most useful thing this module can tell a head teacher.
//
// The design decision that makes it usable: limits are seeded per
// teacher from what the school ALREADY does (see the importer), so
// nothing is in breach on day one. The page shows the distribution and
// lets the manager tighten the numbers themselves. An alert that fires
// on twenty of twenty-seven staff gets switched off within the hour,
// and then it is worth nothing on the day it matters.

export interface TeacherWorkload {
  teacherId: string
  name: string
  perDay: number[]
  totalPerWeek: number
  maxPerDay: number
  maxConsecutive: number
  freePeriodsPerWeek: number
  daysWithNoFreePeriod: number
  arrangementsThisMonth: number
  subjectCount: number
  limits: {
    maxPerDay: number
    maxPerWeek: number
    minPerWeek: number
    maxConsecutive: number
    exempt: boolean
  }
  breaches: { code: string; severity: 'block' | 'warn'; message: string }[]
  /** 0..1 against their own weekly ceiling — drives the heatmap. */
  utilization: number
}

export async function workloadReport(schoolId: string, month?: string) {
  const settings = await getSettings(schoolId)
  const monthKey = month || new Date().toISOString().slice(0, 7)
  const [monthStart, monthEnd] = monthBounds(`${monthKey}-01`)

  const [staffResult, periodsResult, constraintsResult, defsResult, arrangementsResult, capabilitiesResult] =
    await Promise.all([
      // Same pool as the ranking ladder: role labels do not decide who
      // teaches. A vice principal with six periods a week belongs on the
      // workload report, and hiding them is how an overload goes unseen.
      supabase.from('users').select('id, full_name, is_active')
        .eq('school_id', schoolId).not('role', 'in', '("parent","student")'),
      // Paged: 2,867 periods against a 1,000-row cap means every load
      // figure on this page would otherwise be about a third of the truth.
      fetchAll((from, to) => supabase.from('timetable_periods')
        .select('teacher_id, day_of_week, period_number, subject_id, subject_name')
        .eq('school_id', schoolId).eq('is_break', false).not('teacher_id', 'is', null)
        .range(from, to), 'timetable periods').then(data => ({ data })),
      supabase.from('teacher_constraints').select('*').eq('school_id', schoolId),
      supabase.from('period_slot_defs')
        .select('period_number').eq('school_id', schoolId).eq('kind', 'period'),
      fetchAll((from, to) => supabase.from('arrangements')
        .select('substitute_teacher_id')
        .eq('school_id', schoolId)
        .gte('arrangement_date', monthStart).lte('arrangement_date', monthEnd)
        .in('status', ['assigned', 'acknowledged']).range(from, to), 'arrangements')
        .then(data => ({ data })),
      fetchAll((from, to) => supabase.from('teacher_capabilities')
        .select('teacher_id, subject_id').eq('school_id', schoolId).range(from, to), 'capabilities')
        .then(data => ({ data })),
    ])

  const staff = (staffResult.data ?? []).filter(u => u.is_active !== false)
  const workingDays = settings.working_days

  let periodsPerDay = 0
  for (const d of defsResult.data ?? []) {
    if ((d.period_number ?? 0) > periodsPerDay) periodsPerDay = d.period_number
  }
  const weeklyCapacity = periodsPerDay * workingDays.length

  const constraintByTeacher = new Map((constraintsResult.data ?? []).map(c => [c.teacher_id, c]))

  const arrangementCount = new Map<string, number>()
  for (const a of arrangementsResult.data ?? []) {
    if (!a.substitute_teacher_id) continue
    arrangementCount.set(a.substitute_teacher_id, (arrangementCount.get(a.substitute_teacher_id) ?? 0) + 1)
  }

  const subjectsByTeacher = new Map<string, Set<string>>()
  for (const c of capabilitiesResult.data ?? []) {
    if (!subjectsByTeacher.has(c.teacher_id)) subjectsByTeacher.set(c.teacher_id, new Set())
    subjectsByTeacher.get(c.teacher_id)!.add(c.subject_id)
  }

  const occupancy = new Map<string, Map<number, Set<number>>>()
  for (const row of periodsResult.data ?? []) {
    if (!occupancy.has(row.teacher_id)) occupancy.set(row.teacher_id, new Map())
    const byDay = occupancy.get(row.teacher_id)!
    if (!byDay.has(row.day_of_week)) byDay.set(row.day_of_week, new Set())
    byDay.get(row.day_of_week)!.add(row.period_number)
  }

  const teachers: TeacherWorkload[] = staff.map(user => {
    const byDay = occupancy.get(user.id) ?? new Map<number, Set<number>>()
    const constraint = constraintByTeacher.get(user.id)

    const limits = {
      maxPerDay: constraint?.max_periods_per_day ?? periodsPerDay,
      maxPerWeek: constraint?.max_periods_per_week ?? weeklyCapacity,
      minPerWeek: constraint?.min_periods_per_week ?? 0,
      maxConsecutive: constraint?.max_consecutive ?? periodsPerDay,
      exempt: constraint?.exempt_from_arrangements ?? false,
    }

    const perDay = workingDays.map(d => (byDay.get(d)?.size ?? 0))
    const totalPerWeek = perDay.reduce((a, b) => a + b, 0)
    const maxPerDay = perDay.length ? Math.max(...perDay) : 0

    let maxConsecutive = 0
    let daysWithNoFreePeriod = 0
    for (const day of workingDays) {
      const periods = byDay.get(day)
      if (!periods || !periods.size) continue
      if (periods.size >= periodsPerDay) daysWithNoFreePeriod++
      const sorted = [...periods].sort((a, b) => a - b)
      let run = 0
      for (let i = 0; i < sorted.length; i++) {
        run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
        if (run > maxConsecutive) maxConsecutive = run
      }
    }

    const breaches: TeacherWorkload['breaches'] = []
    if (totalPerWeek > limits.maxPerWeek) {
      breaches.push({
        code: 'OVER_WEEKLY_LIMIT', severity: 'block',
        message: `${totalPerWeek} periods a week, ${totalPerWeek - limits.maxPerWeek} over their limit of ${limits.maxPerWeek}`,
      })
    }
    if (maxPerDay > limits.maxPerDay) {
      breaches.push({
        code: 'OVER_DAILY_LIMIT', severity: 'block',
        message: `Up to ${maxPerDay} periods in a day against a limit of ${limits.maxPerDay}`,
      })
    }
    if (maxConsecutive > limits.maxConsecutive) {
      breaches.push({
        code: 'CONSECUTIVE_OVERRUN',
        severity: settings.enforce_max_consecutive ? 'block' : 'warn',
        message: `${maxConsecutive} periods back to back against a limit of ${limits.maxConsecutive}`,
      })
    }
    if (daysWithNoFreePeriod > 0) {
      breaches.push({
        code: 'NO_FREE_PERIOD', severity: 'warn',
        message: `No free period at all on ${daysWithNoFreePeriod} day${daysWithNoFreePeriod === 1 ? '' : 's'} a week`,
      })
    }
    if (totalPerWeek > 0 && totalPerWeek < limits.minPerWeek) {
      breaches.push({
        code: 'UNDER_MIN_LOAD', severity: 'warn',
        message: `${totalPerWeek} periods a week, under the ${limits.minPerWeek} expected`,
      })
    }

    return {
      teacherId: user.id,
      name: user.full_name,
      perDay,
      totalPerWeek,
      maxPerDay,
      maxConsecutive,
      freePeriodsPerWeek: Math.max(0, weeklyCapacity - totalPerWeek),
      daysWithNoFreePeriod,
      arrangementsThisMonth: arrangementCount.get(user.id) ?? 0,
      subjectCount: subjectsByTeacher.get(user.id)?.size ?? 0,
      limits,
      breaches,
      utilization: limits.maxPerWeek > 0 ? Math.min(1.5, totalPerWeek / limits.maxPerWeek) : 0,
    }
  }).sort((a, b) => b.totalPerWeek - a.totalPerWeek || a.name.localeCompare(b.name))

  const loads = teachers.filter(t => t.totalPerWeek > 0).map(t => t.totalPerWeek)
  const sorted = [...loads].sort((a, b) => a - b)

  return {
    month: monthKey,
    axis: {
      workingDays,
      dayNames: workingDays.map(d => DAY_NAMES[d]),
      periodsPerDay,
      weeklyCapacity,
    },
    teachers,
    distribution: {
      teaching: loads.length,
      idle: teachers.length - loads.length,
      min: sorted.length ? sorted[0] : 0,
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      mean: sorted.length ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10 : 0,
      // The number a head teacher actually reacts to.
      spread: sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0,
    },
    breachCounts: {
      blocking: teachers.filter(t => t.breaches.some(b => b.severity === 'block')).length,
      warning: teachers.filter(t => t.breaches.some(b => b.severity === 'warn')).length,
      clear: teachers.filter(t => !t.breaches.length && t.totalPerWeek > 0).length,
    },
  }
}

/**
 * For one overloaded teacher, who could take some of it.
 *
 * Answers the only question a manager has once the workload page has
 * told them somebody is at 48 periods: not "is this bad" but "who else
 * can teach Class VI Maths on a Tuesday, and have they got room". Every
 * suggestion is checked against the receiving teacher's own limits and
 * against the slot being genuinely free for them, so nothing is offered
 * that would simply move the breach.
 */
export async function redistributionOptions(schoolId: string, teacherId: string) {
  const [periodsResult, capabilitiesResult, staffResult, constraintsResult, allPeriodsResult] =
    await Promise.all([
      supabase.from('timetable_periods')
        .select('id, day_of_week, period_number, subject_id, subject_name, section_id, class_id, classes(name, numeric_level), sections(name)')
        .eq('school_id', schoolId).eq('teacher_id', teacherId).eq('is_break', false)
        .order('day_of_week').order('period_number'),
      supabase.from('teacher_capabilities').select('*').eq('school_id', schoolId),
      supabase.from('users').select('id, full_name, is_active')
        .eq('school_id', schoolId).not('role', 'in', '("parent","student")'),
      supabase.from('teacher_constraints').select('*').eq('school_id', schoolId),
      fetchAll((from, to) => supabase.from('timetable_periods')
        .select('teacher_id, day_of_week, period_number')
        .eq('school_id', schoolId).eq('is_break', false).not('teacher_id', 'is', null)
        .range(from, to), 'timetable periods').then(data => ({ data })),
    ])

  const staff = new Map((staffResult.data ?? []).filter(u => u.is_active !== false).map(u => [u.id, u.full_name]))
  const constraintOf = new Map((constraintsResult.data ?? []).map(c => [c.teacher_id, c]))

  const busy = new Set<string>()
  const loadPerDay = new Map<string, number>()
  const loadPerWeek = new Map<string, number>()
  for (const row of allPeriodsResult.data ?? []) {
    busy.add(`${row.teacher_id}:${row.day_of_week}:${row.period_number}`)
    const dayKey = `${row.teacher_id}:${row.day_of_week}`
    loadPerDay.set(dayKey, (loadPerDay.get(dayKey) ?? 0) + 1)
    loadPerWeek.set(row.teacher_id, (loadPerWeek.get(row.teacher_id) ?? 0) + 1)
  }

  const capableOf = new Map<string, { teacherId: string; priority: number; min: number | null; max: number | null }[]>()
  for (const c of capabilitiesResult.data ?? []) {
    if (c.teacher_id === teacherId) continue
    const list = capableOf.get(c.subject_id) ?? []
    list.push({ teacherId: c.teacher_id, priority: c.priority, min: c.min_class_level, max: c.max_class_level })
    capableOf.set(c.subject_id, list)
  }

  return (periodsResult.data ?? []).map(period => {
    const level = (period as any).classes?.numeric_level ?? null
    const candidates = (period.subject_id ? capableOf.get(period.subject_id) ?? [] : [])
      .filter(c => staff.has(c.teacherId))
      .filter(c => !busy.has(`${c.teacherId}:${period.day_of_week}:${period.period_number}`))
      .filter(c => level == null || ((c.min == null || level >= c.min) && (c.max == null || level <= c.max)))
      .map(c => {
        const constraint = constraintOf.get(c.teacherId)
        const week = loadPerWeek.get(c.teacherId) ?? 0
        const day = loadPerDay.get(`${c.teacherId}:${period.day_of_week}`) ?? 0
        const weekLimit = constraint?.max_periods_per_week ?? Infinity
        const dayLimit = constraint?.max_periods_per_day ?? Infinity
        return {
          teacherId: c.teacherId,
          name: staff.get(c.teacherId)!,
          priority: c.priority,
          periodsThisWeek: week,
          periodsThatDay: day,
          headroomThisWeek: Number.isFinite(weekLimit) ? weekLimit - week : null,
          // Moving a breach is not solving it.
          wouldBreach: week + 1 > weekLimit || day + 1 > dayLimit,
        }
      })
      .filter(c => !c.wouldBreach)
      .sort((a, b) => a.priority - b.priority || a.periodsThisWeek - b.periodsThisWeek)
      .slice(0, 5)

    return {
      periodId: period.id,
      dayOfWeek: period.day_of_week,
      dayName: DAY_NAMES[period.day_of_week],
      periodNumber: period.period_number,
      subjectId: period.subject_id,
      subjectName: period.subject_name,
      className: `${(period as any).classes?.name ?? ''}${(period as any).sections?.name ? `-${(period as any).sections.name}` : ''}`,
      candidates,
    }
  })
}

/**
 * Hand one period to somebody else.
 *
 * Re-validated at the point of the move rather than trusting the list
 * the manager is looking at, and refused outright if it would simply
 * relocate the overload.
 */
/**
 * Reassigning a period on the LIVE timetable is refused.
 *
 * This used to write straight to timetable_periods. The published grid
 * is what the whole school is reading from at that moment — a teacher
 * checking their phone between lessons, the cover queue, the printed
 * sheet on the office wall — and rewriting one of its cells in place
 * changed all of that under them, with no version behind it and nothing
 * to roll back to.
 *
 * The replacement is not "you cannot do this", it is "do it on a copy":
 * clone the live timetable, make the change with the conflicts and the
 * summary in front of you, publish it as the next version. Publishing
 * snapshots what it replaced, so the change is one click to undo.
 */
export async function reassignPeriod(
  schoolId: string, actorId: string, periodId: string, newTeacherId: string,
) {
  const period = must(await supabase.from('timetable_periods')
    .select('*, classes(name), sections(name)')
    .eq('id', periodId).eq('school_id', schoolId).maybeSingle(), 'timetable period')

  throw conflict('live_not_editable',
    'The live timetable cannot be edited in place. Make a copy of it, change the copy, ' +
    'and publish it — that way the change is reviewable and can be undone.',
    { periodId, teacherId: newTeacherId })

  // eslint-disable-next-line no-unreachable
  const previousTeacher = period.teacher_id
  if (previousTeacher === newTeacherId) return { ok: true, unchanged: true }

  const { data: clash } = await supabase.from('timetable_periods')
    .select('id, subject_name, classes(name), sections(name)')
    .eq('school_id', schoolId).eq('teacher_id', newTeacherId)
    .eq('day_of_week', period.day_of_week).eq('period_number', period.period_number)
    .eq('is_break', false).maybeSingle()
  if (clash) {
    const where = `${(clash as any).classes?.name ?? ''}-${(clash as any).sections?.name ?? ''}`
    throw badRequest('teacher_busy',
      `They already teach ${clash.subject_name} to ${where} in that period.`)
  }

  const { error } = await supabase.from('timetable_periods')
    .update({ teacher_id: newTeacherId, updated_at: new Date().toISOString() })
    .eq('id', periodId)
  if (error) throw badRequest('reassign_failed', error.message)

  const where = `${(period as any).classes?.name ?? ''}${(period as any).sections?.name ? `-${(period as any).sections.name}` : ''}`
  const what = `${period.subject_name} for ${where}, ${DAY_NAMES[period.day_of_week]} period ${period.period_number}`

  await notify({
    schoolId, userIds: [newTeacherId], type: 'timetable_changed',
    title: 'A class has been added to your timetable',
    message: `You now take ${what}.`,
    link: '/timetable/my-week', relatedEntityType: 'timetable_period', relatedEntityId: periodId,
  })
  if (previousTeacher) {
    await notify({
      schoolId, userIds: [previousTeacher], type: 'timetable_changed',
      title: 'A class has been taken off your timetable',
      message: `${what} has been reassigned.`,
      link: '/timetable/my-week', relatedEntityType: 'timetable_period', relatedEntityId: periodId,
    })
  }

  await audit(schoolId, actorId, 'reassign_period', 'timetable_period', periodId, {
    from: previousTeacher, to: newTeacherId,
    day: period.day_of_week, period: period.period_number, subject: period.subject_name,
  })

  return { ok: true, unchanged: false }
}

/**
 * The nightly nudge for loads that have drifted past their limit.
 *
 * Only blocking breaches are pushed. Warnings live on the page, where
 * somebody looks at them deliberately; pushing every "no free period on
 * Tuesday" would bury the one message that means a rota is genuinely
 * broken.
 */
export async function alertOnBreaches(schoolId: string) {
  const report = await workloadReport(schoolId)
  const blocking = report.teachers.filter(t => t.breaches.some(b => b.severity === 'block'))
  if (!blocking.length) return { alerted: 0 }

  const managers = await arrangementManagers(schoolId)
  if (!managers.length) return { alerted: 0 }

  const worst = blocking.slice(0, 3).map(t => `${t.name} (${t.totalPerWeek}/wk)`).join(', ')
  await notify({
    schoolId, userIds: managers, type: 'workload_breach',
    title: `${blocking.length} teacher${blocking.length === 1 ? ' is' : 's are'} over their teaching limit`,
    message: `${worst}${blocking.length > 3 ? ` and ${blocking.length - 3} more` : ''}. Open the workload page to redistribute.`,
    link: '/timetable/workload',
    relatedEntityType: 'workload', relatedEntityId: undefined,
  })

  return { alerted: blocking.length }
}
