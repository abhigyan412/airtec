import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { supabase } from '../../../shared/db/client'
import { assignDefaultUserRole } from '../../rbac/seed'
import { audit, badRequest, must } from '../lib/core'
import { WorkbookParse } from './parseWorkbook'
import { randomUUID } from 'crypto'
import { normalizeKey, tidy } from './canonicalize'

// ═══════════════════════════════════════════════════════════════
// Write a confirmed import into the school.
// ═══════════════════════════════════════════════════════════════
//
// Ordering is not arbitrary. Reference data (classes, sections,
// subjects, staff) is created first with idempotent upserts: a failure
// part-way leaves extra rows, which is untidy and self-healing on a
// re-run. Only then is the grid replaced, and that goes through
// timetable_replace_periods so the delete and the insert are one
// transaction — the one step where a half-failure would leave a school
// with no timetable at all.

export interface SubjectDecision {
  canonical: string
  /** Link to an existing subject, or leave null to create one. */
  subjectId?: string | null
  /** Rename before creating, for the merged-cell cases a human fixed up. */
  renameTo?: string
  skip?: boolean
}

export interface TeacherDecision {
  canonical: string
  action: 'link' | 'create' | 'skip'
  userId?: string | null
  fullName?: string
  email?: string
}

export interface SectionDecision {
  raw: string
  action: 'link' | 'skip'
  classId?: string | null
  sectionId?: string | null
}

export interface CommitPlan {
  subjects: SubjectDecision[]
  teachers: TeacherDecision[]
  sections: SectionDecision[]
  /**
   * Raw spreadsheet spelling -> canonical, for variants the reviewer
   * re-pointed by hand ("SST              Re" -> "SST").
   */
  variantOverrides?: Record<string, string>
  versionLabel?: string
  effectiveFrom?: string | null
  academicYearId?: string | null
  applyPlan?: boolean
  applyCapabilities?: boolean
  applyConstraints?: boolean
  applyDayTemplates?: boolean
}

export interface CommitResult {
  versionId: string
  classesCreated: number
  sectionsCreated: number
  subjectsCreated: number
  teachersCreated: number
  dayTemplatesCreated: number
  roomsCreated: number
  periodsWritten: number
  planRows: number
  capabilityRows: number
  constraintRows: number
  skipped: { slots: number; reasons: string[] }
  createdLogins: { fullName: string; email: string }[]
}

// Creating a staff member means creating their Supabase Auth account, for
// one specific reason: users.id has no default and is the target of 109
// foreign keys, none of them ON UPDATE CASCADE. A row created with an
// invented id therefore cannot ever be relinked to a real auth account —
// POST /team/:id/reset-login tries exactly that and would fail the moment
// the teacher has a single timetable period against them. Letting Supabase
// mint the id up front means that path only ever has to set a password.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket as any } },
)

/**
 * A password nobody is told.
 *
 * The account has to exist so it owns the id, but importing a timetable
 * must not hand out 27 working logins as a side effect. The school issues
 * real credentials deliberately, per person, through the existing
 * POST /team/:id/reset-login flow — which, because the auth account
 * already exists, is now a simple password set.
 */
function unusablePassword(): string {
  return `Imported!${randomUUID()}`
}

/**
 * A placeholder address for a teacher who exists on the timetable but
 * has no login yet.
 *
 * .invalid is reserved by RFC 2606 precisely so it can never resolve,
 * which means a stray "email the staff" job can't accidentally post a
 * school's internal notes to a real stranger's inbox. The school gives
 * these people real credentials later through the existing
 * POST /team/:id/reset-login flow, which is already how the seeded staff
 * without accounts are handled.
 */
function placeholderEmail(fullName: string, taken: Set<string>): string {
  const slug = normalizeKey(fullName).slice(0, 24) || 'teacher'
  let candidate = `${slug}@no-login.invalid`
  let n = 2
  while (taken.has(candidate)) candidate = `${slug}${n++}@no-login.invalid`
  taken.add(candidate)
  return candidate
}

export async function commitImport(
  schoolId: string,
  actorId: string,
  parse: WorkbookParse,
  plan: CommitPlan,
): Promise<CommitResult> {
  const result: CommitResult = {
    versionId: '', classesCreated: 0, sectionsCreated: 0, subjectsCreated: 0,
    teachersCreated: 0, dayTemplatesCreated: 0, roomsCreated: 0, periodsWritten: 0,
    planRows: 0, capabilityRows: 0, constraintRows: 0,
    skipped: { slots: 0, reasons: [] }, createdLogins: [],
  }

  // ── 1. classes and sections ───────────────────────────────────
  const sectionDecisions = new Map(plan.sections.map(s => [s.raw, s]))
  const classIdByLevel = new Map<number, string>()
  const sectionIdByLabel = new Map<string, string>()
  const classIdByLabel = new Map<string, string>()

  const { data: existingClasses } = await supabase
    .from('classes').select('id, name, numeric_level').eq('school_id', schoolId)
  for (const c of existingClasses ?? []) {
    if (c.numeric_level != null) classIdByLevel.set(c.numeric_level, c.id)
  }

  for (const section of parse.sections) {
    const decision = sectionDecisions.get(section.raw)
    if (decision?.action === 'skip') continue

    let classId = decision?.classId ?? classIdByLevel.get(section.numericLevel) ?? null
    if (!classId) {
      const created = must(await supabase.from('classes').insert({
        school_id: schoolId, name: section.className, numeric_level: section.numericLevel,
      }).select('id').single(), `create class ${section.className}`)
      classId = created.id
      classIdByLevel.set(section.numericLevel, classId)
      result.classesCreated++
    }
    classIdByLabel.set(section.raw, classId)

    let sectionId = decision?.sectionId ?? null
    if (!sectionId) {
      const { data: found } = await supabase.from('sections')
        .select('id').eq('school_id', schoolId).eq('class_id', classId)
        .ilike('name', section.sectionName).maybeSingle()
      sectionId = found?.id ?? null
    }
    if (!sectionId) {
      const created = must(await supabase.from('sections').insert({
        school_id: schoolId, class_id: classId, name: section.sectionName,
      }).select('id').single(), `create section ${section.raw}`)
      sectionId = created.id
      result.sectionsCreated++
    }
    sectionIdByLabel.set(section.raw, sectionId)
  }

  // ── 2. subjects ───────────────────────────────────────────────
  const subjectDecisions = new Map(plan.subjects.map(s => [s.canonical, s]))
  const subjectIdByName = new Map<string, string>()

  const { data: existingSubjects } = await supabase
    .from('subjects').select('id, name').eq('school_id', schoolId)
  const existingByKey = new Map((existingSubjects ?? []).map(s => [normalizeKey(s.name), s.id]))

  for (const group of parse.subjectGroups) {
    const decision = subjectDecisions.get(group.canonical)
    if (decision?.skip) continue

    const name = tidy(decision?.renameTo || group.canonical)
    if (!name) continue

    // A reviewer who re-points "SST  Re" at "SST" produces two groups
    // resolving to one subject; the second must reuse the first's row.
    let subjectId = decision?.subjectId ?? existingByKey.get(normalizeKey(name)) ?? subjectIdByName.get(normalizeKey(name)) ?? null
    if (!subjectId) {
      const created = must(await supabase.from('subjects').insert({
        school_id: schoolId, name, subject_type: guessSubjectType(name),
        room_type: guessRoomType(name),
      }).select('id').single(), `create subject ${name}`)
      subjectId = created.id
      result.subjectsCreated++
    }
    subjectIdByName.set(normalizeKey(group.canonical), subjectId)
    subjectIdByName.set(normalizeKey(name), subjectId)
  }

  // ── 3. teachers ───────────────────────────────────────────────
  const teacherDecisions = new Map(plan.teachers.map(t => [t.canonical, t]))
  const teacherIdByName = new Map<string, string>()

  const { data: allUsers } = await supabase.from('users').select('email').eq('school_id', schoolId)
  const takenEmails = new Set((allUsers ?? []).map(u => (u.email || '').toLowerCase()))

  for (const group of parse.teacherGroups) {
    const decision = teacherDecisions.get(group.canonical)
    if (decision?.action === 'skip') continue

    if (decision?.action === 'link' && decision.userId) {
      teacherIdByName.set(normalizeKey(group.canonical), decision.userId)
      continue
    }

    const fullName = tidy(decision?.fullName || group.canonical)
    const email = (decision?.email || placeholderEmail(fullName, takenEmails)).toLowerCase()

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email, password: unusablePassword(), email_confirm: true,
    })
    if (authError || !authUser?.user) {
      throw badRequest('teacher_create_failed',
        `Could not create a staff record for ${fullName}: ${authError?.message ?? 'auth account rejected'}`)
    }

    const { data: created, error: userError } = await supabase.from('users').insert({
      id: authUser.user.id,
      school_id: schoolId, full_name: fullName, email,
      role: 'teacher', is_active: true,
    }).select('id').single()

    if (userError || !created) {
      // Leave no orphan auth account behind if the row insert fails.
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      throw badRequest('teacher_create_failed',
        `Could not create a staff record for ${fullName}: ${userError?.message ?? 'unknown error'}`)
    }

    await supabase.from('staff_profiles').insert({
      school_id: schoolId, user_id: created.id,
      designation: 'Teacher', employment_type: 'full_time', employment_status: 'active',
    })

    // Without a role assignment they hold zero permissions and, once
    // given a login, would see an empty app.
    try { await assignDefaultUserRole(created.id, schoolId, 'teacher') } catch (err) {
      console.error('[timetable-import] role assignment failed for', fullName, err)
    }

    teacherIdByName.set(normalizeKey(group.canonical), created.id)
    result.teachersCreated++
    result.createdLogins.push({ fullName, email })
  }

  // ── 3b. the rooms those subjects imply ────────────────────────
  //
  // A school that timetables a subject literally called "Computer Lab"
  // has a computer lab. guessRoomType reads that off the name and records
  // it against the subject — but a spreadsheet carries no room data, so
  // nothing was ever created to satisfy it, and feasibility then reported
  // "subjects need a computer_lab but no room of that type exists" on a
  // school whose timetable was perfectly fine. Inferring the room from
  // the subject that names it keeps the configuration self-consistent;
  // the school can correct the count on the setup page.
  const neededRoomTypes = new Set<string>()
  for (const id of new Set(subjectIdByName.values())) {
    const { data: subject } = await supabase.from('subjects')
      .select('room_type').eq('id', id).maybeSingle()
    if (subject?.room_type) neededRoomTypes.add(subject.room_type)
  }
  if (neededRoomTypes.size) {
    const { data: haveRooms } = await supabase.from('classrooms')
      .select('room_type').eq('school_id', schoolId)
    const have = new Set((haveRooms ?? []).map(r => r.room_type))
    const ROOM_NAMES: Record<string, string> = {
      computer_lab: 'Computer Lab', science_lab: 'Science Lab', ground: 'Playground',
      library: 'Library', music_room: 'Music Room', art_room: 'Art Room',
      av_room: 'AV Room', auditorium: 'Auditorium',
    }
    const toCreate = [...neededRoomTypes].filter(t => !have.has(t)).map(t => ({
      school_id: schoolId, name: ROOM_NAMES[t] ?? t, room_type: t,
      capacity: t === 'ground' ? 200 : 40,
      capacity_groups: t === 'ground' ? 2 : 1,
    }))
    if (toCreate.length) {
      const { error } = await supabase.from('classrooms').insert(toCreate)
      if (error) console.error('[timetable-import] rooms:', error.message)
      else result.roomsCreated = toCreate.length
    }
  }

  // ── 4. day templates ──────────────────────────────────────────
  const templateIdByShape = new Map<number, string>()

  if (plan.applyDayTemplates !== false) {
    for (const draft of parse.dayTemplates) {
      const teaching = draft.periods.filter(p => p.kind === 'period').length

      const { data: existing } = await supabase.from('day_templates')
        .select('id').eq('school_id', schoolId).ilike('name', draft.name).maybeSingle()

      let templateId = existing?.id ?? null
      if (!templateId) {
        const created = must(await supabase.from('day_templates').insert({
          school_id: schoolId, name: draft.name, template_type: 'regular', status: 'active',
          notes: `Imported from spreadsheet — ${draft.sectionLabels.join(', ')}`,
        }).select('id').single(), `create day template ${draft.name}`)
        templateId = created.id
        result.dayTemplatesCreated++
      }

      // Replace-all, so a re-import corrects times rather than doubling them.
      await supabase.from('period_slot_defs').delete().eq('day_template_id', templateId)
      await supabase.from('period_slot_defs').insert(draft.periods.map(p => ({
        school_id: schoolId, day_template_id: templateId,
        slot_index: p.slotIndex, kind: p.kind === 'break' ? 'break' : p.kind,
        period_number: p.kind === 'period' ? p.periodNumber : null,
        start_time: p.startTime, end_time: p.endTime,
        label: p.kind === 'period' ? null : p.label,
      })))

      templateIdByShape.set(teaching, templateId)

      // Which sections follow which shape, on which days.
      const rows: any[] = []
      for (const label of draft.sectionLabels) {
        const sectionId = sectionIdByLabel.get(label)
        if (!sectionId) continue
        for (const day of draft.days) {
          rows.push({ school_id: schoolId, section_id: sectionId, day_of_week: day, day_template_id: templateId })
        }
      }
      if (rows.length) {
        await supabase.from('section_day_templates')
          .upsert(rows, { onConflict: 'section_id,day_of_week' })
      }
    }
  }

  // ── 5. the grid ───────────────────────────────────────────────
  const variantOverrides = plan.variantOverrides ?? {}
  const canonicalSubjectFor = (raw: string): string | null => {
    const override = variantOverrides[raw]
    if (override) return override
    for (const group of parse.subjectGroups) {
      if (group.variants.some(v => v.raw === raw)) return group.canonical
    }
    return null
  }
  const canonicalTeacherFor = (raw: string): string | null => {
    if (!raw) return null
    const primary = raw.includes('/') ? tidy(raw.split('/')[0]) : tidy(raw)
    const override = variantOverrides[raw]
    if (override) return override
    for (const group of parse.teacherGroups) {
      if (group.variants.some(v => v.raw === primary)) return group.canonical
    }
    return primary
  }

  const sectionIdsTouched: string[] = []
  for (const label of sectionIdByLabel.values()) sectionIdsTouched.push(label)

  const gridRows: any[] = []
  const skipReasons = new Set<string>()

  for (const slot of parse.slots) {
    if (!slot.subject) continue
    const sectionId = sectionIdByLabel.get(slot.sectionLabel)
    const classId = classIdByLabel.get(slot.sectionLabel)
    if (!sectionId || !classId) {
      result.skipped.slots++
      skipReasons.add(`Section "${slot.sectionLabel}" was skipped`)
      continue
    }

    const subjectName = canonicalSubjectFor(slot.subject)
    const subjectId = subjectName ? subjectIdByName.get(normalizeKey(subjectName)) ?? null : null
    if (!subjectName) {
      result.skipped.slots++
      skipReasons.add(`Subject "${slot.subject}" was skipped`)
      continue
    }

    const teacherName = canonicalTeacherFor(slot.teacher)
    const teacherId = teacherName ? teacherIdByName.get(normalizeKey(teacherName)) ?? null : null

    const def = findPeriodDef(parse, slot.sectionLabel, slot.periodNumber)
    if (!def) {
      result.skipped.slots++
      skipReasons.add(`No time defined for period ${slot.periodNumber}`)
      continue
    }

    gridRows.push({
      class_id: classId,
      section_id: sectionId,
      academic_year_id: plan.academicYearId ?? null,
      day_of_week: slot.day,
      period_number: slot.periodNumber,
      start_time: def.startTime,
      end_time: def.endTime,
      subject_id: subjectId,
      subject_name: subjectName,
      teacher_id: teacherId,
      is_break: false,
    })
  }
  result.skipped.reasons = [...skipReasons]

  // Breaks are rows too — the existing timetable page renders them from
  // timetable_periods with is_break, and a grid without them shows an
  // unexplained gap between period 4 and period 5.
  for (const draft of parse.dayTemplates) {
    for (const p of draft.periods) {
      if (p.kind === 'period') continue
      for (const label of draft.sectionLabels) {
        const sectionId = sectionIdByLabel.get(label)
        const classId = classIdByLabel.get(label)
        if (!sectionId || !classId) continue
        for (const day of draft.days) {
          gridRows.push({
            class_id: classId, section_id: sectionId,
            academic_year_id: plan.academicYearId ?? null,
            day_of_week: day,
            // Break rows need a period_number for the table's unique key.
            // Numbering them above the teaching range keeps them out of
            // the way of every "period N" lookup in the module.
            period_number: 100 + p.slotIndex,
            start_time: p.startTime, end_time: p.endTime,
            subject_id: null, subject_name: p.label || 'Break',
            teacher_id: null, is_break: true,
          })
        }
      }
    }
  }

  // ── 6. the version row, then the atomic swap ──────────────────
  const version = must(await supabase.from('timetable_versions').insert({
    school_id: schoolId,
    academic_year_id: plan.academicYearId ?? null,
    label: plan.versionLabel || `Imported ${new Date().toISOString().slice(0, 10)}`,
    status: 'active',
    effective_from: plan.effectiveFrom ?? null,
    source: 'imported',
    created_by: actorId,
    published_by: actorId,
    published_at: new Date().toISOString(),
    notes: `${parse.stats.filledSlots} slots from ${parse.stats.sheets} sheets`,
  }).select('id').single(), 'create timetable version')
  result.versionId = version.id

  await supabase.from('timetable_versions')
    .update({ status: 'archived' })
    .eq('school_id', schoolId).eq('status', 'active').neq('id', version.id)

  const { data: written, error: swapError } = await supabase.rpc('timetable_replace_periods', {
    p_school_id: schoolId,
    p_section_ids: sectionIdsTouched,
    p_rows: gridRows,
    p_version_id: version.id,
  })
  if (swapError) {
    await supabase.from('timetable_versions').delete().eq('id', version.id)
    throw badRequest('import_failed', `Could not write the timetable: ${swapError.message}`)
  }
  result.periodsWritten = Number(written ?? 0)

  // ── 7. the plan, capabilities and limits ──────────────────────
  if (plan.applyPlan !== false) {
    const rows: any[] = []
    for (const row of parse.plan) {
      const sectionId = sectionIdByLabel.get(row.sectionLabel)
      const classId = classIdByLabel.get(row.sectionLabel)
      const subjectId = subjectIdByName.get(normalizeKey(row.subject))
      if (!sectionId || !classId || !subjectId) continue
      const teacherId = row.teachers.length
        ? teacherIdByName.get(normalizeKey(row.teachers[0])) ?? null
        : null
      rows.push({
        school_id: schoolId, class_id: classId, section_id: sectionId, subject_id: subjectId,
        weekly_periods: row.weeklyPeriods, double_periods: 0, teacher_id: teacherId,
      })
    }
    if (rows.length) {
      // Replace, do not upsert.
      //
      // class_subject_plan's unique indexes are partial — one for rows
      // with a section, one for class-wide rows — because Postgres treats
      // NULLs as distinct and a plain index would let two class-wide rows
      // through. PostgREST can only emit `ON CONFLICT (cols)`, which
      // cannot match a partial index, so the upsert failed outright with
      // "no unique or exclusion constraint matching the ON CONFLICT
      // specification" and the plan silently came out empty — taking
      // generation with it. An import replaces the plan anyway, so
      // delete-then-insert is both correct and simpler.
      const classIds = [...new Set(rows.map(r => r.class_id))]
      const { error: clearError } = await supabase.from('class_subject_plan')
        .delete().eq('school_id', schoolId).in('class_id', classIds)
      if (clearError) console.error('[timetable-import] plan clear:', clearError.message)

      const { error } = await supabase.from('class_subject_plan').insert(rows)
      if (error) console.error('[timetable-import] plan insert:', error.message)
      else result.planRows = rows.length
    }
  }

  if (plan.applyCapabilities !== false) {
    const rows: any[] = []
    for (const cap of parse.capabilities) {
      const teacherId = teacherIdByName.get(normalizeKey(cap.teacher))
      const subjectId = subjectIdByName.get(normalizeKey(cap.subject))
      if (!teacherId || !subjectId) continue
      rows.push({
        school_id: schoolId, teacher_id: teacherId, subject_id: subjectId,
        // Everything a teacher is timetabled for is a primary subject.
        // Secondary and tertiary capability is exactly the judgement the
        // spreadsheet does not contain, so it is left for the setup page
        // rather than guessed — and it is the single most valuable thing
        // the school can add, because it drives substitute ranking.
        priority: 1,
        min_class_level: cap.minClassLevel,
        max_class_level: cap.maxClassLevel,
      })
    }
    if (rows.length) {
      const { error } = await supabase.from('teacher_capabilities')
        .upsert(rows, { onConflict: 'teacher_id,subject_id' })
      if (error) console.error('[timetable-import] capabilities upsert:', error.message)
      else result.capabilityRows = rows.length
    }
  }

  if (plan.applyConstraints !== false) {
    const rows: any[] = []
    for (const c of parse.constraints) {
      const teacherId = teacherIdByName.get(normalizeKey(c.teacher))
      if (!teacherId) continue
      rows.push({
        school_id: schoolId, teacher_id: teacherId,
        max_periods_per_day: c.maxPeriodsPerDay,
        max_periods_per_week: c.maxPeriodsPerWeek,
        min_periods_per_week: 0,
        max_consecutive: c.maxConsecutive,
        notes: `Seeded from the imported timetable: ${c.observedPerWeek} periods a week, up to ${c.observedMaxPerDay} a day, ${c.observedMaxConsecutive} back to back.`,
      })
    }
    if (rows.length) {
      const { error } = await supabase.from('teacher_constraints')
        .upsert(rows, { onConflict: 'teacher_id' })
      if (error) console.error('[timetable-import] constraints upsert:', error.message)
      else result.constraintRows = rows.length
    }
  }

  await audit(schoolId, actorId, 'import', 'timetable_version', version.id, {
    periods: result.periodsWritten,
    sections: sectionIdsTouched.length,
    teachers_created: result.teachersCreated,
    subjects_created: result.subjectsCreated,
    skipped: result.skipped.slots,
  })

  return result
}

// ── helpers ─────────────────────────────────────────────────────

function findPeriodDef(parse: WorkbookParse, sectionLabel: string, periodNumber: number) {
  for (const draft of parse.dayTemplates) {
    if (!draft.sectionLabels.includes(sectionLabel)) continue
    const hit = draft.periods.find(p => p.kind === 'period' && p.periodNumber === periodNumber)
    if (hit) return hit
  }
  // Fall back to any template that defines the period — a section whose
  // template could not be worked out still gets the right clock times.
  for (const draft of parse.dayTemplates) {
    const hit = draft.periods.find(p => p.kind === 'period' && p.periodNumber === periodNumber)
    if (hit) return hit
  }
  return null
}

/** A first guess the setup page lets the school correct. */
function guessSubjectType(name: string): string {
  const n = name.toLowerCase()
  if (/remedial/.test(n)) return 'remedial'
  if (/\blab\b|practical/.test(n)) return 'lab'
  if (/games|sports|\bpe\b|physical|dance|music|art|craft|drawing/.test(n)) return 'co_curricular'
  if (/library|club|activity|assembly|reading|value|moral|\bgk\b|presentation|communication/.test(n)) return 'activity'
  if (/english|hindi|sanskrit|urdu|punjabi|marathi|tamil|telugu|kannada|bengali|gujarati|french|german/.test(n)) return 'language'
  if (/vocational|skill|robotic/.test(n)) return 'vocational'
  return 'core'
}

function guessRoomType(name: string): string | null {
  const n = name.toLowerCase()
  if (/computer\s*lab|\bit\s*lab/.test(n)) return 'computer_lab'
  if (/science\s*lab|physics\s*lab|chemistry\s*lab|biology\s*lab/.test(n)) return 'science_lab'
  if (/games|sports|\bpe\b|physical\s*ed/.test(n)) return 'ground'
  if (/library/.test(n)) return 'library'
  if (/music/.test(n)) return 'music_room'
  return null
}
