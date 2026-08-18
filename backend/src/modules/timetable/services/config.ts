import { supabase } from '../../../shared/db/client'
import { audit, badRequest, conflict, fetchAll, formatTime, getSettings, must } from '../lib/core'

// ═══════════════════════════════════════════════════════════════
// Setup: everything the generator and the ranking ladder read.
// ═══════════════════════════════════════════════════════════════
//
// This is the part schools skip, and skipping it is why timetable tools
// fail. A grid with no notion of who can teach what, how much anybody is
// allowed to teach, or what shape the day is, can be drawn but cannot be
// reasoned about — no generation, no meaningful conflict detection, and
// substitute suggestions no better than "whoever is free".
//
// The importer pre-fills all of it from the spreadsheet, so the school
// reviews rather than types. The one thing it cannot infer is secondary
// and tertiary subject capability, which is exactly the judgement that
// makes substitution good, so the UI asks for that specifically.

// ── day templates ───────────────────────────────────────────────

export interface PeriodSlotInput {
  slotIndex: number
  kind: 'period' | 'assembly' | 'break' | 'lunch'
  periodNumber: number | null
  startTime: string
  endTime: string
  label?: string | null
}

export async function listDayTemplates(schoolId: string) {
  const { data, error } = await supabase.from('day_templates')
    .select('*, period_slot_defs(*)')
    .eq('school_id', schoolId).order('name')
  if (error) throw badRequest('query_failed', error.message)

  const { data: usage } = await supabase.from('section_day_templates')
    .select('day_template_id, section_id').eq('school_id', schoolId)

  const sectionsPerTemplate = new Map<string, Set<string>>()
  for (const row of usage ?? []) {
    if (!sectionsPerTemplate.has(row.day_template_id)) sectionsPerTemplate.set(row.day_template_id, new Set())
    sectionsPerTemplate.get(row.day_template_id)!.add(row.section_id)
  }

  return (data ?? []).map(template => {
    const periods = ((template as any).period_slot_defs ?? [])
      .sort((a: any, b: any) => a.slot_index - b.slot_index)
      .map((p: any) => ({
        ...p,
        time_label: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
      }))
    return {
      ...template,
      period_slot_defs: periods,
      teaching_periods: periods.filter((p: any) => p.kind === 'period').length,
      sections_using: sectionsPerTemplate.get(template.id)?.size ?? 0,
    }
  })
}

/**
 * Validate a day's shape before it can be saved.
 *
 * Teaching periods have to be numbered 1..N with nothing missing,
 * because every other part of the module addresses a slot by that
 * number — an absence "from period 5", a booking on "period 3", the
 * engine's adjacency test for double periods. A gap in the numbering
 * turns all of those into silent no-ops rather than errors.
 */
export function validateDayTemplate(periods: PeriodSlotInput[]): string[] {
  const problems: string[] = []
  if (!periods.length) return ['Add at least one period.']

  const sorted = [...periods].sort((a, b) => a.slotIndex - b.slotIndex)

  for (const p of sorted) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(p.startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(p.endTime)) {
      problems.push(`Slot ${p.slotIndex}: times must look like 08:25.`)
      continue
    }
    if (p.endTime <= p.startTime) {
      problems.push(`Slot ${p.slotIndex} ends at or before it starts.`)
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) {
      problems.push(`Slot ${sorted[i].slotIndex} starts before slot ${sorted[i - 1].slotIndex} has finished.`)
    }
  }

  const teaching = sorted.filter(p => p.kind === 'period')
  if (!teaching.length) problems.push('A day needs at least one teaching period.')

  const numbers = teaching.map(p => p.periodNumber).filter((n): n is number => n != null)
  if (numbers.length !== teaching.length) {
    problems.push('Every teaching period needs a number.')
  } else {
    const seen = new Set(numbers)
    if (seen.size !== numbers.length) problems.push('Two teaching periods share a number.')
    for (let n = 1; n <= numbers.length; n++) {
      if (!seen.has(n)) { problems.push(`Period numbers must run 1 to ${numbers.length} with none missing — ${n} is absent.`); break }
    }
  }

  for (const p of sorted) {
    if (p.kind !== 'period' && p.periodNumber != null) {
      problems.push(`Slot ${p.slotIndex} is a ${p.kind} and must not have a period number.`)
    }
  }

  return problems
}

export async function saveDayTemplate(
  schoolId: string, actorId: string,
  input: { id?: string; name: string; templateType?: string; periods: PeriodSlotInput[] },
) {
  const problems = validateDayTemplate(input.periods)
  if (problems.length) throw badRequest('invalid_day_template', problems.join(' '), problems)

  let templateId = input.id ?? null
  if (templateId) {
    const { error } = await supabase.from('day_templates').update({
      name: input.name, template_type: input.templateType ?? 'regular',
      updated_at: new Date().toISOString(),
    }).eq('id', templateId).eq('school_id', schoolId)
    if (error) throw badRequest('save_failed', error.message)
  } else {
    const created = must(await supabase.from('day_templates').insert({
      school_id: schoolId, name: input.name, template_type: input.templateType ?? 'regular',
    }).select('id').single(), 'create day template')
    templateId = created.id
  }

  // Replace-all: editing a day is editing the whole day, and merging
  // slot-by-slot leaves orphans when a period is removed.
  await supabase.from('period_slot_defs').delete().eq('day_template_id', templateId)
  const { error: insertError } = await supabase.from('period_slot_defs').insert(
    input.periods.map(p => ({
      school_id: schoolId, day_template_id: templateId,
      slot_index: p.slotIndex, kind: p.kind,
      period_number: p.kind === 'period' ? p.periodNumber : null,
      start_time: p.startTime, end_time: p.endTime,
      label: p.kind === 'period' ? null : (p.label ?? null),
    })),
  )
  if (insertError) throw badRequest('save_failed', insertError.message)

  await audit(schoolId, actorId, input.id ? 'update' : 'create', 'day_template', templateId, {
    name: input.name, periods: input.periods.length,
  })
  return { id: templateId }
}

export async function deleteDayTemplate(schoolId: string, actorId: string, templateId: string) {
  const { count } = await supabase.from('section_day_templates')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId).eq('day_template_id', templateId)
  if (count && count > 0) {
    throw conflict('template_in_use',
      `${count} section-day${count === 1 ? '' : 's'} still follow this template. Point them at another one first.`)
  }
  const { error } = await supabase.from('day_templates').delete()
    .eq('id', templateId).eq('school_id', schoolId)
  if (error) throw badRequest('delete_failed', error.message)
  await audit(schoolId, actorId, 'delete', 'day_template', templateId, {})
  return { ok: true }
}

// ── teacher capability ──────────────────────────────────────────

export async function listTeacherSetup(schoolId: string) {
  const [staffResult, capabilitiesResult, constraintsResult, subjectsResult, loadResult] =
    await Promise.all([
      supabase.from('users').select('id, full_name, email, is_active')
        .eq('school_id', schoolId).not('role', 'in', '("parent","student")').order('full_name'),
      supabase.from('teacher_capabilities').select('*, subjects(name)').eq('school_id', schoolId),
      supabase.from('teacher_constraints').select('*').eq('school_id', schoolId),
      supabase.from('subjects').select('id, name, subject_type').eq('school_id', schoolId).order('name'),
      fetchAll((from, to) => supabase.from('timetable_periods').select('teacher_id')
        .eq('school_id', schoolId).eq('is_break', false).not('teacher_id', 'is', null)
        .range(from, to), 'timetable periods').then(data => ({ data })),
    ])

  const load = new Map<string, number>()
  for (const row of loadResult.data ?? []) {
    load.set(row.teacher_id, (load.get(row.teacher_id) ?? 0) + 1)
  }

  const capsByTeacher = new Map<string, any[]>()
  for (const c of capabilitiesResult.data ?? []) {
    const list = capsByTeacher.get(c.teacher_id) ?? []
    list.push({ ...c, subject_name: (c as any).subjects?.name ?? null })
    capsByTeacher.set(c.teacher_id, list)
  }

  const constraintByTeacher = new Map((constraintsResult.data ?? []).map(c => [c.teacher_id, c]))

  return {
    subjects: subjectsResult.data ?? [],
    teachers: (staffResult.data ?? []).filter(u => u.is_active !== false).map(user => ({
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      /** A placeholder address means they have no login yet. */
      needs_login: (user.email || '').endsWith('@no-login.invalid'),
      periods_per_week: load.get(user.id) ?? 0,
      capabilities: (capsByTeacher.get(user.id) ?? []).sort((a, b) => a.priority - b.priority),
      constraints: constraintByTeacher.get(user.id) ?? null,
    })),
  }
}

export async function saveCapabilities(
  schoolId: string, actorId: string, teacherId: string,
  capabilities: { subjectId: string; priority: number; minClassLevel?: number | null; maxClassLevel?: number | null }[],
) {
  for (const c of capabilities) {
    if (![1, 2, 3].includes(c.priority)) {
      throw badRequest('bad_priority', 'Priority must be 1 (teaches it), 2 (can teach it) or 3 (can supervise it).')
    }
    if (c.minClassLevel != null && c.maxClassLevel != null && c.minClassLevel > c.maxClassLevel) {
      throw badRequest('bad_class_range', 'The lowest class cannot be above the highest.')
    }
  }

  const seen = new Set<string>()
  for (const c of capabilities) {
    if (seen.has(c.subjectId)) throw badRequest('duplicate_subject', 'A subject is listed twice.')
    seen.add(c.subjectId)
  }

  await supabase.from('teacher_capabilities').delete()
    .eq('school_id', schoolId).eq('teacher_id', teacherId)

  if (capabilities.length) {
    const { error } = await supabase.from('teacher_capabilities').insert(
      capabilities.map(c => ({
        school_id: schoolId, teacher_id: teacherId, subject_id: c.subjectId,
        priority: c.priority,
        min_class_level: c.minClassLevel ?? null,
        max_class_level: c.maxClassLevel ?? null,
      })),
    )
    if (error) throw badRequest('save_failed', error.message)
  }

  await audit(schoolId, actorId, 'update', 'teacher_capabilities', teacherId, { count: capabilities.length })
  return { ok: true, count: capabilities.length }
}

export async function saveConstraints(
  schoolId: string, actorId: string, teacherId: string, input: Record<string, any>,
) {
  const row = {
    school_id: schoolId,
    teacher_id: teacherId,
    max_periods_per_day: Number(input.maxPeriodsPerDay ?? 8),
    max_periods_per_week: Number(input.maxPeriodsPerWeek ?? 45),
    min_periods_per_week: Number(input.minPeriodsPerWeek ?? 0),
    max_consecutive: Number(input.maxConsecutive ?? 4),
    arrangement_cap_per_day: Number(input.arrangementCapPerDay ?? 2),
    arrangement_cap_per_week: Number(input.arrangementCapPerWeek ?? 6),
    exempt_from_arrangements: !!input.exemptFromArrangements,
    availability: input.availability ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  }

  if (row.max_periods_per_day < 1 || row.max_periods_per_week < 1 || row.max_consecutive < 1) {
    throw badRequest('bad_limits', 'Limits must be at least 1.')
  }
  if (row.min_periods_per_week > row.max_periods_per_week) {
    throw badRequest('bad_limits', 'The minimum weekly load cannot exceed the maximum.')
  }

  const { error } = await supabase.from('teacher_constraints')
    .upsert(row, { onConflict: 'teacher_id' })
  if (error) throw badRequest('save_failed', error.message)

  await audit(schoolId, actorId, 'update', 'teacher_constraints', teacherId, row)
  return { ok: true }
}

// ── rooms ───────────────────────────────────────────────────────

export async function listRooms(schoolId: string) {
  const { data, error } = await supabase.from('classrooms')
    .select('*').eq('school_id', schoolId).order('name')
  if (error) throw badRequest('query_failed', error.message)
  return data ?? []
}

export async function saveRoom(schoolId: string, actorId: string, input: Record<string, any>) {
  const row: Record<string, any> = {
    school_id: schoolId,
    name: String(input.name ?? '').trim(),
    room_type: input.roomType ?? 'classroom',
    capacity: input.capacity ?? null,
    capacity_groups: Number(input.capacityGroups ?? 1),
    is_active: input.isActive !== false,
  }
  if (!row.name) throw badRequest('name_required', 'The room needs a name.')

  if (input.id) {
    const { error } = await supabase.from('classrooms').update(row)
      .eq('id', input.id).eq('school_id', schoolId)
    if (error) throw badRequest('save_failed', error.message)
    await audit(schoolId, actorId, 'update', 'classroom', input.id, row)
    return { id: input.id }
  }

  const created = must(await supabase.from('classrooms').insert(row).select('id').single(), 'create room')
  await audit(schoolId, actorId, 'create', 'classroom', created.id, row)
  return { id: created.id }
}

// ── subjects ────────────────────────────────────────────────────

export async function listSubjects(schoolId: string) {
  const [subjectsResult, usageResult] = await Promise.all([
    supabase.from('subjects').select('*').eq('school_id', schoolId).order('name'),
    fetchAll((from, to) => supabase.from('timetable_periods').select('subject_id')
      .eq('school_id', schoolId).eq('is_break', false).not('subject_id', 'is', null)
      .range(from, to), 'timetable periods').then(data => ({ data })),
  ])
  const usage = new Map<string, number>()
  for (const row of usageResult.data ?? []) {
    usage.set(row.subject_id, (usage.get(row.subject_id) ?? 0) + 1)
  }
  return (subjectsResult.data ?? []).map(s => ({ ...s, periods_scheduled: usage.get(s.id) ?? 0 }))
}

export async function saveSubjectScheduling(
  schoolId: string, actorId: string, subjectId: string,
  input: { roomType?: string | null; placement?: Record<string, boolean> | null; subjectType?: string },
) {
  const update: Record<string, any> = {}
  if ('roomType' in input) update.room_type = input.roomType || null
  if ('placement' in input) update.placement = input.placement ?? null
  if (input.subjectType) update.subject_type = input.subjectType

  const { error } = await supabase.from('subjects').update(update)
    .eq('id', subjectId).eq('school_id', schoolId)
  if (error) throw badRequest('save_failed', error.message)

  await audit(schoolId, actorId, 'update', 'subject_scheduling', subjectId, update)
  return { ok: true }
}

// ── the class-subject plan ──────────────────────────────────────

export async function getClassPlan(schoolId: string, classId: string) {
  const [planResult, sectionsResult, subjectsResult, templatesResult] = await Promise.all([
    supabase.from('class_subject_plan')
      .select('*, subjects(name), teacher:teacher_id(id, full_name)')
      .eq('school_id', schoolId).eq('class_id', classId),
    supabase.from('sections').select('id, name').eq('school_id', schoolId).eq('class_id', classId).order('name'),
    supabase.from('subjects').select('id, name, subject_type').eq('school_id', schoolId).order('name'),
    supabase.from('section_day_templates')
      .select('section_id, day_of_week, day_templates(id, name)')
      .eq('school_id', schoolId),
  ])

  const sections = sectionsResult.data ?? []
  const sectionIds = new Set(sections.map(s => s.id))

  // How many teaching periods a section actually has in a week, so the
  // page can say "42 of 54 allocated" rather than leaving the manager to
  // add it up and discover the shortfall after generation fails.
  const capacityBySection = new Map<string, number>()
  const templatePeriods = new Map<string, number>()
  const { data: defs } = await supabase.from('period_slot_defs')
    .select('day_template_id, kind').eq('school_id', schoolId).eq('kind', 'period')
  for (const d of defs ?? []) {
    templatePeriods.set(d.day_template_id, (templatePeriods.get(d.day_template_id) ?? 0) + 1)
  }
  for (const row of templatesResult.data ?? []) {
    if (!sectionIds.has(row.section_id)) continue
    const perDay = templatePeriods.get((row as any).day_templates?.id ?? row.day_template_id) ?? 0
    capacityBySection.set(row.section_id, (capacityBySection.get(row.section_id) ?? 0) + perDay)
  }

  const rows = (planResult.data ?? []).map(r => ({
    ...r,
    subject_name: (r as any).subjects?.name ?? null,
    teacher_name: (r as any).teacher?.full_name ?? null,
  }))

  const allocatedBySection = new Map<string, number>()
  for (const r of rows) {
    const key = r.section_id ?? '__class__'
    allocatedBySection.set(key, (allocatedBySection.get(key) ?? 0) + r.weekly_periods)
  }

  return {
    classId,
    sections: sections.map(s => ({
      ...s,
      weeklyCapacity: capacityBySection.get(s.id) ?? null,
      allocated: allocatedBySection.get(s.id) ?? 0,
      shortfall: capacityBySection.has(s.id)
        ? (capacityBySection.get(s.id) ?? 0) - (allocatedBySection.get(s.id) ?? 0)
        : null,
    })),
    subjects: subjectsResult.data ?? [],
    rows,
  }
}

export async function saveClassPlan(
  schoolId: string, actorId: string, classId: string,
  items: { sectionId: string | null; subjectId: string; weeklyPeriods: number; doublePeriods?: number; teacherId?: string | null }[],
) {
  // One teacher per subject per section is the invariant this whole
  // module leans on — the ranking ladder, the workload report and the
  // generator all assume it. Two rows for the same pair is not a
  // job-share the model can express; it is a data error that surfaces
  // later as a phantom double-booking.
  const seen = new Set<string>()
  for (const item of items) {
    const key = `${item.sectionId ?? 'class'}:${item.subjectId}`
    if (seen.has(key)) {
      throw badRequest('duplicate_plan_row', 'The same subject is listed twice for one section.')
    }
    seen.add(key)
    if (item.weeklyPeriods < 0) throw badRequest('bad_periods', 'Weekly periods cannot be negative.')
    if ((item.doublePeriods ?? 0) * 2 > item.weeklyPeriods) {
      throw badRequest('bad_doubles',
        'A double period uses two of the weekly periods, so there cannot be more doubles than the allocation allows.')
    }
  }

  await supabase.from('class_subject_plan').delete()
    .eq('school_id', schoolId).eq('class_id', classId)

  const rows = items.filter(i => i.weeklyPeriods > 0).map(i => ({
    school_id: schoolId, class_id: classId,
    section_id: i.sectionId, subject_id: i.subjectId,
    weekly_periods: i.weeklyPeriods, double_periods: i.doublePeriods ?? 0,
    teacher_id: i.teacherId ?? null,
  }))

  if (rows.length) {
    const { error } = await supabase.from('class_subject_plan').insert(rows)
    if (error) throw badRequest('save_failed', error.message)
  }

  await audit(schoolId, actorId, 'update', 'class_subject_plan', classId, { rows: rows.length })
  return { ok: true, rows: rows.length }
}

// ── settings ────────────────────────────────────────────────────

export async function saveSettings(schoolId: string, actorId: string, input: Record<string, any>) {
  const current = await getSettings(schoolId)
  const row: Record<string, any> = { school_id: schoolId, updated_at: new Date().toISOString() }

  const numbers: [string, string][] = [
    ['ackReminderMinutes', 'ack_reminder_minutes'],
    ['ackEscalateMinutes', 'ack_escalate_minutes'],
    ['bookingLeadHours', 'booking_lead_hours'],
    ['bookingWeeklyCap', 'booking_weekly_cap'],
    ['autoDetectAfterPeriod', 'auto_detect_after_period'],
    ['longAbsenceThresholdDays', 'long_absence_threshold_days'],
  ]
  for (const [from, to] of numbers) {
    if (input[from] != null) row[to] = Number(input[from])
  }
  if (input.workingDays) row.working_days = input.workingDays
  if (input.enforceMaxConsecutive != null) row.enforce_max_consecutive = !!input.enforceMaxConsecutive
  if (input.autoDetectAbsence != null) row.auto_detect_absence = !!input.autoDetectAbsence

  const reminder = row.ack_reminder_minutes ?? current.ack_reminder_minutes
  const escalate = row.ack_escalate_minutes ?? current.ack_escalate_minutes
  if (escalate <= reminder) {
    throw badRequest('bad_escalation',
      'Escalation has to come after the reminder, or the manager is told before the teacher has been chased.')
  }
  if (row.working_days && (!Array.isArray(row.working_days) || !row.working_days.length)) {
    throw badRequest('bad_working_days', 'A school needs at least one working day.')
  }

  const { error } = await supabase.from('timetable_settings')
    .upsert(row, { onConflict: 'school_id' })
  if (error) throw badRequest('save_failed', error.message)

  await audit(schoolId, actorId, 'update', 'timetable_settings', schoolId, row)
  return getSettings(schoolId)
}

/**
 * What still needs doing before the module works properly.
 *
 * Shown on the setup page as a checklist. Written as "what is missing"
 * rather than "what is done" because the failure mode this guards is a
 * school that imports a grid, sees it render, and assumes it is
 * finished — then discovers on the first sick day that nobody has
 * subject capability set and every substitute suggestion is a coin flip.
 */
export async function setupReadiness(schoolId: string) {
  const [templates, teachers, plan, subjects, periods] = await Promise.all([
    supabase.from('day_templates').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('users').select('id').eq('school_id', schoolId)
      .not('role', 'in', '("parent","student")'),
    supabase.from('class_subject_plan').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('subjects').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('timetable_periods').select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId).eq('is_break', false),
  ])

  // Only the people who actually teach.
  //
  // The candidate pool is deliberately wide — anyone who is not a parent
  // or a student can cover a class — but using that as the denominator
  // here means the accountant and the receptionist count as teachers
  // without subject capabilities, and the checklist can never reach 100%.
  // Someone with periods on the timetable is the honest measure.
  const timetabled = await fetchAll<{ teacher_id: string }>((from, to) =>
    supabase.from('timetable_periods')
      .select('teacher_id').eq('school_id', schoolId).eq('is_break', false)
      .not('teacher_id', 'is', null).range(from, to), 'timetable periods')
  const teaching = new Set((timetabled ?? []).map((r: any) => r.teacher_id))
  const teacherIds = (teachers.data ?? []).map(t => t.id).filter(id => teaching.has(id))
  const [capabilities, constraints] = await Promise.all([
    teacherIds.length
      ? supabase.from('teacher_capabilities').select('teacher_id, priority').eq('school_id', schoolId)
      : Promise.resolve({ data: [] as any[] }),
    teacherIds.length
      ? supabase.from('teacher_constraints').select('teacher_id').eq('school_id', schoolId)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const withCapability = new Set((capabilities.data ?? []).map((c: any) => c.teacher_id))
  const withSecondary = new Set(
    (capabilities.data ?? []).filter((c: any) => c.priority > 1).map((c: any) => c.teacher_id),
  )
  const withConstraints = new Set((constraints.data ?? []).map((c: any) => c.teacher_id))

  const items = [
    {
      key: 'day_templates',
      label: 'Define the shape of the school day',
      done: (templates.count ?? 0) > 0,
      detail: `${templates.count ?? 0} template(s)`,
      why: 'Period times and breaks come from here. Without one, nothing can be scheduled.',
      blocking: true,
    },
    {
      key: 'subjects',
      label: 'List the subjects',
      done: (subjects.count ?? 0) > 0,
      detail: `${subjects.count ?? 0} subject(s)`,
      why: 'Substitute matching is by subject, so an unnamed subject cannot be matched.',
      blocking: true,
    },
    {
      key: 'grid',
      label: 'Load the timetable',
      done: (periods.count ?? 0) > 0,
      detail: `${periods.count ?? 0} period(s) scheduled`,
      why: 'Import the spreadsheet, or build it by hand, or generate it.',
      blocking: true,
    },
    {
      key: 'capabilities',
      label: 'Record what each teacher can teach',
      done: teacherIds.length > 0 && teacherIds.every(id => withCapability.has(id)),
      detail: `${teacherIds.filter(id => withCapability.has(id)).length} of ${teacherIds.length} teaching staff`,
      why: 'Drives substitute ranking. Teachers without it are only ever offered as "anyone free".',
      blocking: false,
    },
    {
      key: 'secondary_subjects',
      label: 'Add second and third subjects teachers can cover',
      done: withSecondary.size > 0,
      detail: `${withSecondary.size} teacher(s) have a fallback subject`,
      why: 'The one thing a spreadsheet cannot tell us, and the thing that makes cover good rather than random.',
      blocking: false,
    },
    {
      key: 'constraints',
      label: 'Set teaching limits',
      done: teacherIds.length > 0 && teacherIds.every(id => withConstraints.has(id)),
      detail: `${teacherIds.filter(id => withConstraints.has(id)).length} of ${teacherIds.length} teaching staff`,
      why: 'Stops cover being piled onto whoever happens to be free.',
      blocking: false,
    },
    {
      key: 'plan',
      label: 'Record weekly periods per subject',
      done: (plan.count ?? 0) > 0,
      detail: `${plan.count ?? 0} row(s)`,
      why: 'Needed to generate a timetable, and to spot a class that is short on Maths.',
      blocking: false,
    },
  ]

  return {
    items,
    ready: items.filter(i => i.blocking).every(i => i.done),
    complete: items.every(i => i.done),
    percent: Math.round((items.filter(i => i.done).length / items.length) * 100),
  }
}
