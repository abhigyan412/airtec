import { supabase } from '../db/client'

// ── Teacher role resolution ──────────────────────────────────────────
//
// A teacher's role is two independent, year-scoped facts, never a static
// flag on their profile:
//   - which section+subject combos they teach — derived LIVE from
//     timetable_periods, not a separately-managed assignment table. The
//     timetable is the single source of truth here: build it once (assign
//     a teacher+subject to each period) and the dashboard, My Students,
//     and every scoping check below follow it automatically, with no
//     second "assign this teacher to this subject" admin step to fall out
//     of sync with it.
//   - whether they're the homeroom ("class") teacher for one section this
//     academic year (class_teacher_assignments) — this genuinely is a
//     separate fact, since it isn't tied to any one period.
//
// Every teacher-facing dashboard widget and every scoping check on an
// existing route (attendance marking, fee dues, TC requests, the student
// list) goes through this one function rather than re-deriving the
// answer per call site — see design note on class_teacher_assignments in
// supabase/migrations/20260801000000_teacher_dashboard.sql for why that
// one isn't just a users.is_class_teacher column.

export interface TeachingAssignment {
  section_id: string
  section_name: string
  class_id: string
  class_name: string
  subject_id: string
  subject_name: string
}

export interface HomeroomSection {
  section_id: string
  section_name: string
  class_id: string
  class_name: string
}

export interface TeacherContext {
  academicYearId: string | null
  isClassTeacher: boolean
  homeroomSection: HomeroomSection | null
  teachingAssignments: TeachingAssignment[]
  /** Every section this teacher has any reason to see a student in — the
   *  union of subject-taught sections and the homeroom section, if any.
   *  This is what "My Students" and similar scoped list views filter by. */
  sectionIds: string[]
}

const EMPTY_CONTEXT = (academicYearId: string | null): TeacherContext => ({
  academicYearId,
  isClassTeacher: false,
  homeroomSection: null,
  teachingAssignments: [],
  sectionIds: [],
})

export async function getTeacherContext(teacherId: string, schoolId: string): Promise<TeacherContext> {
  const { data: ay } = await supabase
    .from('academic_years')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_current', true)
    .maybeSingle()

  if (!ay) return EMPTY_CONTEXT(null)

  const [{ data: periods, error: periodsErr }, { data: subjects, error: subjectsErr }, { data: homeroom, error: homeErr }] = await Promise.all([
    // academic_year_id is nullable on timetable_periods and in practice
    // often unset (the timetable builder has never required it) — a
    // currently-live weekly timetable can only sensibly belong to the
    // CURRENT year, so a null there is treated as "this year" rather than
    // excluded. See the same reasoning in the migration's old backfill.
    supabase
      .from('timetable_periods')
      .select('section_id, subject_name, academic_year_id, sections(name, class_id, classes(name))')
      .eq('school_id', schoolId)
      .eq('teacher_id', teacherId)
      .eq('is_break', false)
      .or(`academic_year_id.eq.${ay.id},academic_year_id.is.null`),
    supabase.from('subjects').select('id, name').eq('school_id', schoolId),
    supabase
      .from('class_teacher_assignments')
      .select('section_id, sections(name, class_id, classes(name))')
      .eq('teacher_id', teacherId)
      .eq('academic_year_id', ay.id)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  if (periodsErr) throw new Error(`Failed to load timetable periods: ${periodsErr.message}`)
  if (subjectsErr) throw new Error(`Failed to load subjects: ${subjectsErr.message}`)
  if (homeErr) throw new Error(`Failed to load class teacher assignment: ${homeErr.message}`)

  // subject_name on timetable_periods is free text; matched to
  // subjects.name case-insensitively, since the timetable and the
  // subjects list are maintained separately and don't reliably agree on
  // case. A period whose subject_name matches nothing in the subjects
  // list is dropped rather than surfaced with a blank subject_id.
  const subjectIdByName = new Map((subjects ?? []).map(s => [s.name.toLowerCase(), s.id]))

  const seen = new Set<string>()
  const teachingAssignments: TeachingAssignment[] = []
  for (const p of (periods ?? []) as any[]) {
    const subjectId = subjectIdByName.get((p.subject_name ?? '').toLowerCase())
    if (!subjectId) continue
    const key = `${p.section_id}::${subjectId}`
    if (seen.has(key)) continue
    seen.add(key)
    teachingAssignments.push({
      section_id: p.section_id,
      section_name: p.sections?.name ?? '',
      class_id: p.sections?.class_id ?? '',
      class_name: p.sections?.classes?.name ?? '',
      subject_id: subjectId,
      subject_name: p.subject_name,
    })
  }

  const homeroomSection: HomeroomSection | null = homeroom
    ? {
        section_id: (homeroom as any).section_id,
        section_name: (homeroom as any).sections?.name ?? '',
        class_id: (homeroom as any).sections?.class_id ?? '',
        class_name: (homeroom as any).sections?.classes?.name ?? '',
      }
    : null

  const sectionIds = Array.from(new Set([
    ...teachingAssignments.map(t => t.section_id),
    ...(homeroomSection ? [homeroomSection.section_id] : []),
  ]))

  return {
    academicYearId: ay.id,
    isClassTeacher: !!homeroomSection,
    homeroomSection,
    teachingAssignments,
    sectionIds,
  }
}
