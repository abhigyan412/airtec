import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler, getPagination, NON_STAFF_ROLES, resolveOwnStudentId, fetchAllRows } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { getNonWorkingDaySets, isWorkingDate, toLocalDateStr, countWorkingDays } from '../../shared/utils/academicCalendar'
import { createNotification, createNotifications, getRecipientUserIdsForStudent } from '../../shared/utils/notifications'
import { buildStudentSearchFilter } from '../../shared/utils/studentSearch'
import { getTeacherContext } from '../../shared/utils/teacherContext'
import { ensureTransferCertificateWorkflowDefinition, assignDefaultUserRole } from '../rbac/seed'

const router = Router()

router.use(authenticate)

const CreateStudentSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().optional(),
  admission_date: z.string().optional(),
  gender: z.string().optional(),
  blood_group: z.string().optional(),
  aadhaar_number: z.string().optional(),
  permanent_address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  academic_year_id: z.string().optional(),
  class_id: z.string().optional(),
  section_id: z.string().optional(),
  roll_number: z.string().optional(),
  stream: z.string().optional(),
  house_id: z.string().optional(),
  photo_url: z.string().optional(),
  father_name: z.string().optional(),
  father_phone: z.string().optional(),
  father_email: z.string().optional(),
  mother_name: z.string().optional(),
  mother_phone: z.string().optional(),
  mother_email: z.string().optional(),
})

// status was never part of CreateStudentSchema (a new student is always
// active), so UpdateStudentSchema.partial() alone silently dropped it —
// same "accepted and silently dropped" bug this file's PATCH /:id
// comment already documents for the parent fields. Bulk Edit's own
// "Status" field (students/bulk-edit/page.tsx) sends exactly this and
// has been a no-op ever since it shipped.
const UpdateStudentSchema = CreateStudentSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'transferred', 'passed_out', 'suspended']).optional(),
})

const BulkPromoteSchema = z.object({
  student_ids: z.array(z.string().uuid()),
  to_class_id: z.string().uuid(),
  to_section_id: z.string().uuid().optional(),
  to_academic_year_id: z.string().uuid(),
  promotion_type: z.enum(['promoted', 'detained', 'transferred', 'withdrawn']),
  notes: z.string().optional(),
})

// ═══════════════════════════════════════════════════════════════
// ALL NAMED ROUTES FIRST — before any /:id routes
// ═══════════════════════════════════════════════════════════════

// ── GET /students (list) ────────────────────────────────────
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', search, class_id, section_id, status, house_id, tc_status } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

  // Powers the dashboard's "Pending TC Requests" tile — it used to just
  // link to the unfiltered roster, leaving the admin to hunt for which
  // 3 of however-many students actually had a pending request. One
  // query for the matching student ids, then .in() on the main query
  // below — same idiom as everywhere else in this codebase that needs
  // to filter students by something outside the students table itself,
  // and avoids the row-duplication risk of an inner-join filter if a
  // student ever has more than one transfer_certificates row.
  let tcStudentIds: string[] | null = null
  if (tc_status) {
    const { data: tcRows, error: tcErr } = await supabase
      .from('transfer_certificates').select('student_id')
      .eq('school_id', school_id).eq('status', tc_status as string)
    if (tcErr) return res.status(500).json({ success: false, error: tcErr.message })
    tcStudentIds = [...new Set((tcRows ?? []).map(r => r.student_id))]
    if (!tcStudentIds.length) return res.json({ success: true, data: [], meta: { total: 0, page: pg, limit: lim } })
  }

  // Same gap as everywhere else in this sweep: no ownership check, so
  // a parent/student — who does hold student.view — could browse the
  // entire school's roster, not just their own child.
  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId) return res.json({ success: true, data: [], meta: { total: 0, page: pg, limit: lim } })
    const { data, error } = await supabase.from('students')
      .select(`*, classes(id, name, numeric_level, stream), sections(id, name), houses(id, name, color), academic_years(id, name)`)
      .eq('id', ownStudentId).eq('school_id', school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.json({ success: true, data, meta: { total: data?.length ?? 0, page: 1, limit: lim } })
  }

  // "My Students" — a teacher only ever sees students in sections they
  // teach a subject in, or their own homeroom section. Forced regardless
  // of class_id/section_id query params, same as the parent/student case
  // above: a subject-only teacher passing another section's id must not
  // be able to widen this past their own assignments.
  let teacherSectionIds: string[] | null = null
  if (req.user!.role === 'teacher') {
    const ctx = await getTeacherContext(req.user!.id, school_id)
    if (!ctx.sectionIds.length) return res.json({ success: true, data: [], meta: { total: 0, page: pg, limit: lim } })
    teacherSectionIds = ctx.sectionIds
  }

  let query = supabase
    .from('students')
    .select(`*, classes(id, name, numeric_level, stream), sections(id, name), houses(id, name, color), academic_years(id, name)`, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)

  if (search) query = query.or(buildStudentSearchFilter(String(search)))
  if (tcStudentIds) query = query.in('id', tcStudentIds)
  if (teacherSectionIds) query = query.in('section_id', teacherSectionIds)
  if (class_id) query = query.eq('class_id', class_id)
  if (section_id && (!teacherSectionIds || teacherSectionIds.includes(section_id as string))) query = query.eq('section_id', section_id)
  if (status) query = query.eq('status', status)
  if (house_id) query = query.eq('house_id', house_id)
  query = query.order('first_name')

  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data, meta: { total: count ?? 0, page: pg, limit: lim } })
}))

// ── GET /students/stats/dashboard ──────────────────────────
router.get('/stats/dashboard', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const [{ count: total }, { count: active }, { count: newThisMonth }, classBreakdown] = await Promise.all([
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school_id),
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'active'),
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school_id).gte('created_at', new Date(new Date().setDate(1)).toISOString()),
    supabase.from('students').select('class_id, classes(name, numeric_level)', { count: 'exact' }).eq('school_id', school_id).eq('status', 'active'),
  ])
  res.json({ success: true, data: { total_students: total ?? 0, active_students: active ?? 0, new_this_month: newThisMonth ?? 0, class_breakdown: classBreakdown.data ?? [] } })
}))

// ── GET /students/attendance/today — school-wide today's status for the
// "Needs Attention Today" dashboard widget. Deliberately separate from
// GET /attendance/report (which requires class_id and returns per-student
// rows) — this is a single school-wide snapshot, not a class report.
// is_working_day lets the frontend show "No school today" instead of a
// misleading 0% on a holiday/weekly-off day with nothing marked.
//
// percentage is present ÷ ALL active students, not ÷ however many happen
// to be marked so far — marking 2 of 26 students present and calling
// that "100%" is exactly the kind of number that hides the real problem
// (24 students not marked at all) instead of surfacing it. Section
// membership for "who hasn't marked" is derived from the students table
// itself, not from attendance.section_id — a teacher marking a whole
// class at once (no section filter) leaves that column null, which would
// undercount if trusted directly.
router.get('/attendance/today', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const today = toLocalDateStr(new Date())

  // The holiday/weekly-off lookup does not depend on the roster or the
  // register, so it joins the same batch instead of running before it.
  const [nonWorkingSets, { data: students, error: studentsErr }, { data: records, error: attErr }] =
    await Promise.all([
      getNonWorkingDaySets(school_id, today, today),
      supabase.from('students')
        .select('id, class_id, section_id, classes(name), sections(name)')
        .eq('school_id', school_id).eq('status', 'active'),
      supabase.from('attendance').select('student_id, status').eq('school_id', school_id).eq('date', today),
    ])
  const is_working_day = isWorkingDate(today, nonWorkingSets)
  if (studentsErr) return res.status(500).json({ success: false, error: studentsErr.message })
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })

  const statusByStudent = new Map((records ?? []).map(r => [r.student_id, r.status]))
  const present = (records ?? []).filter(r => r.status === 'present').length
  const total_marked = (records ?? []).length
  const total_active_students = (students ?? []).length
  const percentage = total_active_students > 0 ? Math.round((present / total_active_students) * 100) : 0

  const sectionGroups = new Map<string, { class_id: string; class_name: string; section_id: string | null; section_name: string | null; total: number; marked: number; present: number }>()
  for (const s of students ?? []) {
    const key = `${s.class_id}::${s.section_id ?? 'none'}`
    if (!sectionGroups.has(key)) {
      sectionGroups.set(key, {
        class_id: s.class_id, class_name: (s as any).classes?.name ?? '—',
        section_id: s.section_id, section_name: (s as any).sections?.name ?? null,
        total: 0, marked: 0, present: 0,
      })
    }
    const group = sectionGroups.get(key)!
    group.total++
    const status = statusByStudent.get(s.id)
    if (status) group.marked++
    if (status === 'present') group.present++
  }

  const allSections = [...sectionGroups.values()]
  const unmarked_sections = allSections.filter(g => g.marked === 0)
    .map(g => ({ class_id: g.class_id, class_name: g.class_name, section_id: g.section_id, section_name: g.section_name, student_count: g.total }))

  // Full per-section breakdown (marked and unmarked alike), not-marked
  // sorted first — the Principal dashboard's "Class attendance status"
  // widget reuses this same query rather than duplicating it; the Admin
  // "Needs Attention Today" widget keeps reading unmarked_sections above
  // unchanged.
  const sections = allSections
    .map(g => ({
      class_id: g.class_id, class_name: g.class_name, section_id: g.section_id, section_name: g.section_name,
      enrolled: g.total, is_marked: g.marked > 0, present: g.present,
    }))
    .sort((a, b) => Number(a.is_marked) - Number(b.is_marked) || a.class_name.localeCompare(b.class_name, undefined, { numeric: true }))

  res.json({
    success: true,
    data: {
      date: today, is_working_day, present, total_marked, total_active_students, percentage,
      sections_total: allSections.length, sections_marked: allSections.length - unmarked_sections.length,
      unmarked_sections, sections,
    },
  })
}))

// ── GET /students/attendance/class-summary — per-class present vs
// absent breakdown for one date, for the Attendance page's daily chart.
// Separate from /attendance/today (which is always "today" and groups
// by section for the dashboard's "unmarked sections" list) — this
// accepts any date and rolls sections up to class level, since the
// chart's job is "how is each class doing today," not per-section detail.
router.get('/attendance/class-summary', requirePermissionV2('attendance.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const date = (req.query.date as string) || toLocalDateStr(new Date())

  const nonWorkingSets = await getNonWorkingDaySets(school_id, date, date)
  const is_working_day = isWorkingDate(date, nonWorkingSets)

  const [{ data: students, error: studentsErr }, { data: records, error: attErr }] = await Promise.all([
    supabase.from('students')
      .select('id, class_id, classes(name)')
      .eq('school_id', school_id).eq('status', 'active'),
    supabase.from('attendance').select('student_id, status').eq('school_id', school_id).eq('date', date),
  ])
  if (studentsErr) return res.status(500).json({ success: false, error: studentsErr.message })
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })

  const statusByStudent = new Map((records ?? []).map(r => [r.student_id, r.status]))

  const classGroups = new Map<string, { class_id: string; class_name: string; present: number; absent: number; late: number; leave: number; unmarked: number; total: number }>()
  for (const s of students ?? []) {
    if (!s.class_id) continue // student not yet assigned to a class — not part of any class's attendance picture
    if (!classGroups.has(s.class_id)) {
      classGroups.set(s.class_id, {
        class_id: s.class_id, class_name: (s as any).classes?.name ?? '—',
        present: 0, absent: 0, late: 0, leave: 0, unmarked: 0, total: 0,
      })
    }
    const group = classGroups.get(s.class_id)!
    group.total++
    const status = statusByStudent.get(s.id)
    if (status === 'present') group.present++
    else if (status === 'absent') group.absent++
    else if (status === 'late') group.late++
    else if (status === 'leave') group.leave++
    else group.unmarked++
  }

  const classes = [...classGroups.values()].sort((a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true }))

  res.json({ success: true, data: { date, is_working_day, classes } })
}))

// ── GET /students/houses ────────────────────────────────────
router.get('/houses', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('houses').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── TIMETABLE ────────────────────────────────────────────────
// class_id/section_id/teacher_id are all OPTIONAL — omitting every one
// used to return the entire school's timetable to whoever asked. Fine
// for staff (that's the "browse everything" Timetable page), but a
// parent/student passing no params — or, worse, someone else's
// class_id — would get it too, since none of this was ever ownership-
// checked. NON_STAFF_ROLES now hard-overrides every param with their
// own resolved class/section, same pattern as GET /homework.
// Whether this flat editor may write, so the page can present itself
// read-only instead of offering edits that will 409 on save.
router.get('/timetable/lock-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: { locked: await liveTimetableLocked(req.user!.school_id) } })
}))

router.get('/timetable', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  let { class_id, section_id, teacher_id, academic_year_id } = req.query as Record<string, string | undefined>

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!studentId) return res.json({ success: true, data: [] })
    const { data: student } = await supabase.from('students').select('class_id, section_id').eq('id', studentId).single()
    if (!student) return res.json({ success: true, data: [] })
    class_id = student.class_id
    section_id = student.section_id ?? undefined
    teacher_id = undefined
    academic_year_id = undefined
  }

  // A teacher gets exactly two legitimate views here, not the free-form
  // class/teacher browser the admin timetable page otherwise allows:
  //   - their own teaching periods (default, or an explicit teacher_id —
  //     which is always forced back to themselves, not trusted from the
  //     query string)
  //   - the FULL timetable of their own homeroom section, if they're a
  //     class teacher — every period in that section, not just the ones
  //     they personally teach
  // Anything else (someone else's schedule, another section) returns
  // empty rather than the school-wide data this endpoint otherwise hands
  // any staff member with timetable.view.
  if (req.user!.role === 'teacher') {
    const ctx = await getTeacherContext(req.user!.id, school_id)
    const wantsHomeroom = !!section_id && !!ctx.homeroomSection && section_id === ctx.homeroomSection.section_id
    if (wantsHomeroom) {
      class_id = ctx.homeroomSection!.class_id
      teacher_id = undefined
    } else if (section_id) {
      // A section was requested but it isn't this teacher's homeroom —
      // not a legitimate request, not just "show my own schedule instead".
      return res.json({ success: true, data: [] })
    } else {
      teacher_id = req.user!.id
      class_id = undefined
    }
    academic_year_id = undefined
  }

  let query = supabase
    .from('timetable_periods')
    .select('*, classes(name), sections(name), users:teacher_id(id, full_name)')
    .eq('school_id', school_id)
    .order('day_of_week')
    .order('period_number')

  if (class_id) query = query.eq('class_id', class_id)
  if (section_id) {
  query = query.or(`section_id.eq.${section_id},section_id.is.null`)
}
  if (teacher_id) query = query.eq('teacher_id', teacher_id)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

const TIMETABLE_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const timetableTargetKey = (p: any) => `${p.class_id}|${p.section_id ?? ''}|${p.day_of_week}|${p.period_number}`

// ── Live timetable is read-only once versioning is in use ────────────
//
// This flat editor writes straight into timetable_periods. The moment a
// school manages its timetable through the versioned module (an 'active'
// timetable_versions row exists), those rows are the PUBLISHED output —
// what the whole school reads, what the cover queue and printed sheet use.
// Editing them here bypasses the version, so there is nothing to review or
// roll back. The block view already refuses this in its UI ("read-only —
// make a copy"); this is the same rule enforced on the server, so the
// front door being locked doesn't leave the back door open.
//
// Schools that never adopted versioning (no active version) have no other
// editor, so they keep this one untouched.
async function liveTimetableLocked(schoolId: string): Promise<boolean> {
  const { data } = await supabase.from('timetable_versions')
    .select('id').eq('school_id', schoolId).eq('status', 'active').maybeSingle()
  return !!data
}

function refuseLiveEdit(res: Response) {
  return res.status(409).json({
    success: false,
    code: 'live_not_editable',
    error: 'The live timetable is read-only. Open the block view, make a copy, change the copy, and publish it.',
  })
}

router.post('/timetable', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { periods } = req.body
    const school_id = req.user!.school_id
    if (!Array.isArray(periods) || !periods.length)
      return res.status(400).json({ success: false, error: 'periods array required' })
    if (await liveTimetableLocked(school_id)) return refuseLiveEdit(res)

    // Teacher double-booking guard (room guard follows below, same shape).
    // Nothing else in this app stops the same teacher being assigned to
    // two different classes at the same day/period — the frontend's own
    // conflict check only ever sees the one class/section currently being
    // viewed, so it's structurally blind to a clash in a different class.
    // Checks both against what's already saved elsewhere (excluding the
    // exact class/section/day/period slot(s) this save is itself replacing
    // — that's an edit, not a new booking) and against the incoming batch,
    // since a single bulk save building out a whole week can introduce a
    // conflict entirely within itself.
    const teacherIds = [...new Set(periods.filter((p: any) => p.teacher_id && !p.is_break).map((p: any) => p.teacher_id as string))]
    if (teacherIds.length) {
      const slotKey = (p: any) => `${p.teacher_id}|${p.day_of_week}|${p.period_number}`
      const targetKey = timetableTargetKey

      const [{ data: existing, error: existingErr }, { data: teacherRows }] = await Promise.all([
        supabase.from('timetable_periods')
          .select('teacher_id, class_id, section_id, day_of_week, period_number, classes(name), sections(name)')
          .eq('school_id', school_id).in('teacher_id', teacherIds).eq('is_break', false),
        supabase.from('users').select('id, full_name').in('id', teacherIds),
      ])
      if (existingErr) return res.status(500).json({ success: false, error: existingErr.message })
      const nameById = new Map((teacherRows ?? []).map(t => [t.id, t.full_name]))

      const incomingTargets = new Set(periods.map((p: any) => targetKey(p)))
      const bySlot = new Map<string, any>()

      for (const p of periods) {
        if (!p.teacher_id || p.is_break) continue
        const key = slotKey(p)
        const dayName = TIMETABLE_DAY_NAMES[p.day_of_week - 1] ?? `day ${p.day_of_week}`

        const dbClash = (existing ?? []).find(e =>
          e.teacher_id === p.teacher_id && e.day_of_week === p.day_of_week && e.period_number === p.period_number &&
          !incomingTargets.has(`${e.class_id}|${e.section_id ?? ''}|${e.day_of_week}|${e.period_number}`),
        )
        if (dbClash) {
          return res.status(409).json({
            success: false,
            error: `${nameById.get(p.teacher_id) ?? 'This teacher'} already teaches ${(dbClash as any).classes?.name}${(dbClash as any).sections?.name ? ` - ${(dbClash as any).sections.name}` : ''} at P${p.period_number} on ${dayName}.`,
          })
        }

        const inBatch = bySlot.get(key)
        if (inBatch && targetKey(inBatch) !== targetKey(p)) {
          return res.status(409).json({
            success: false,
            error: `${nameById.get(p.teacher_id) ?? 'This teacher'} is assigned to two different classes at P${p.period_number} on ${dayName} in this save.`,
          })
        }
        bySlot.set(key, p)
      }
    }

    // Room double-booking guard — same shape as the teacher check above,
    // keyed on room instead. Only rooms actually set on an incoming period
    // are checked; a blank room was never claiming anything to begin with.
    const rooms = [...new Set(periods.filter((p: any) => p.room && !p.is_break).map((p: any) => p.room as string))]
    if (rooms.length) {
      const roomSlotKey = (p: any) => `${p.room}|${p.day_of_week}|${p.period_number}`
      const targetKey = timetableTargetKey

      const { data: existingByRoom, error: roomErr } = await supabase.from('timetable_periods')
        .select('room, class_id, section_id, day_of_week, period_number, classes(name), sections(name)')
        .eq('school_id', school_id).in('room', rooms).eq('is_break', false)
      if (roomErr) return res.status(500).json({ success: false, error: roomErr.message })

      const incomingTargets = new Set(periods.map((p: any) => targetKey(p)))
      const roomBySlot = new Map<string, any>()

      for (const p of periods) {
        if (!p.room || p.is_break) continue
        const key = roomSlotKey(p)
        const dayName = TIMETABLE_DAY_NAMES[p.day_of_week - 1] ?? `day ${p.day_of_week}`

        const dbClash = (existingByRoom ?? []).find(e =>
          e.room === p.room && e.day_of_week === p.day_of_week && e.period_number === p.period_number &&
          !incomingTargets.has(`${e.class_id}|${e.section_id ?? ''}|${e.day_of_week}|${e.period_number}`),
        )
        if (dbClash) {
          return res.status(409).json({
            success: false,
            error: `Room ${p.room} is already booked for ${(dbClash as any).classes?.name}${(dbClash as any).sections?.name ? ` - ${(dbClash as any).sections.name}` : ''} at P${p.period_number} on ${dayName}.`,
          })
        }

        const inBatch = roomBySlot.get(key)
        if (inBatch && targetKey(inBatch) !== targetKey(p)) {
          return res.status(409).json({
            success: false,
            error: `Room ${p.room} is assigned to two different classes at P${p.period_number} on ${dayName} in this save.`,
          })
        }
        roomBySlot.set(key, p)
      }
    }

    // Capture who taught each target slot BEFORE the upsert, so a
    // genuinely new assignment can be told apart from an edit that left
    // the teacher unchanged (room/subject tweak) — only the former should
    // notify anyone.
    const classIds = [...new Set(periods.map((p: any) => p.class_id as string))]
    const { data: previousRows } = await supabase.from('timetable_periods')
      .select('class_id, section_id, day_of_week, period_number, teacher_id')
      .eq('school_id', school_id).in('class_id', classIds)
    const previousTeacherByTarget = new Map((previousRows ?? []).map(p => [timetableTargetKey(p), p.teacher_id]))

    const rows = periods.map((p: any) => ({ ...p, school_id }))
    const { data, error } = await supabase.from('timetable_periods')
      .upsert(rows, { onConflict: 'class_id,section_id,day_of_week,period_number' })
      .select('*, classes(name), sections(name)')
    if (error) return res.status(400).json({ success: false, error: error.message })

    // Best-effort: notify each teacher newly put on a period (new slot, or
    // an edit that changed who teaches it) — never held responsible for
    // the save itself, which has already succeeded by this point.
    try {
      const newlyAssigned = (data ?? []).filter((p: any) =>
        p.teacher_id && !p.is_break && p.teacher_id !== previousTeacherByTarget.get(timetableTargetKey(p)),
      )
      for (const p of newlyAssigned) {
        const dayName = TIMETABLE_DAY_NAMES[p.day_of_week - 1] ?? `day ${p.day_of_week}`
        const classLabel = `${p.classes?.name ?? 'a class'}${p.sections?.name ? ` - ${p.sections.name}` : ''}`
        await createNotification({
          schoolId: school_id, userId: p.teacher_id, type: 'timetable_assigned',
          title: 'New class assigned',
          message: `You've been assigned ${p.subject_name} for ${classLabel} on ${dayName}, P${p.period_number} (${p.start_time?.slice(0, 5)}–${p.end_time?.slice(0, 5)}).`,
          link: '/timetable', relatedEntityType: 'timetable_period', relatedEntityId: p.id,
        })
      }
    } catch (notifyErr) {
      console.error('Failed to create timetable assignment notifications:', notifyErr)
    }

    res.json({ success: true, data, count: data?.length })
  })
)

router.delete('/timetable/:period_id', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { period_id } = req.params
    if (await liveTimetableLocked(req.user!.school_id)) return refuseLiveEdit(res)
    const { error } = await supabase.from('timetable_periods').delete().eq('id', period_id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

const BulkLunchSchema = z.object({
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  subject_name: z.string().min(1).default('Lunch'),
  days: z.array(z.number().int().min(1).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
  class_ids: z.array(z.string().uuid()).optional(),
})

// ── POST /timetable/bulk-lunch — add a break period (Lunch by default)
// across every class/section, on every selected day, in one action.
// period_number is a plain sequential integer with no natural "insert
// between 4 and 5" operation, so this computes where the break actually
// falls chronologically for EACH class/section/day independently (not
// assumed uniform school-wide, even though it usually is) and shifts
// every period at or after that point up by one to make room, before
// inserting the break itself at the freed slot. All done in one
// transaction-equivalent batch: the shifts are grouped and applied largest
// -period-number-first so a mid-shift row never collides with a row that
// hasn't moved yet (the naive one-statement-per-row-in-arbitrary-order
// version of this hits the unique (class,section,day,period) constraint).
router.post('/timetable/bulk-lunch', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = BulkLunchSchema.parse(req.body)
    const school_id = req.user!.school_id
    if (await liveTimetableLocked(school_id)) return refuseLiveEdit(res)

    let classIds = body.class_ids
    if (!classIds?.length) {
      const { data: allClasses } = await supabase.from('classes').select('id').eq('school_id', school_id)
      classIds = (allClasses ?? []).map(c => c.id)
    }
    if (!classIds.length) return res.status(400).json({ success: false, error: 'No classes found for this school' })

    const { data: sectionRows } = await supabase.from('sections').select('id, class_id').in('class_id', classIds)
    const combos: { class_id: string; section_id: string }[] = (sectionRows ?? []).map(s => ({ class_id: s.class_id, section_id: s.id }))
    if (!combos.length) return res.status(400).json({ success: false, error: 'No sections found for the selected classes' })

    const existing = await fetchAllRows<{ class_id: string; section_id: string | null; day_of_week: number; period_number: number; start_time: string; subject_name: string; is_break: boolean }>(
      (from, to) => supabase.from('timetable_periods')
        .select('class_id, section_id, day_of_week, period_number, start_time, subject_name, is_break', { count: 'exact' })
        .eq('school_id', school_id).in('class_id', classIds!).order('id').range(from, to),
    )

    // Guard against re-running this on a day that already has a break with
    // this exact name — upsert would otherwise silently overwrite whatever
    // already occupies that slot instead of erroring.
    const alreadyHasLunch = existing.some(p =>
      p.is_break && p.subject_name === body.subject_name && body.days.includes(p.day_of_week) &&
      combos.some(c => c.class_id === p.class_id && c.section_id === (p.section_id ?? '')),
    )
    if (alreadyHasLunch) {
      return res.status(409).json({ success: false, error: `A "${body.subject_name}" break already exists on at least one selected day — remove it first if you're trying to move it.` })
    }

    // shiftsByOldNumber[oldPeriodNumber] = list of (class,section,day) combos
    // whose period at that number needs to become oldPeriodNumber+1.
    const shiftsByOldNumber = new Map<number, { class_id: string; section_id: string; day_of_week: number }[]>()
    const inserts: any[] = []

    for (const day of body.days) {
      for (const { class_id, section_id } of combos) {
        const dayPeriods = existing
          .filter(p => p.class_id === class_id && (p.section_id ?? '') === section_id && p.day_of_week === day)
          .sort((a, b) => a.period_number - b.period_number)

        const insertionPoint = dayPeriods.find(p => p.start_time >= body.start_time)?.period_number
          ?? (dayPeriods.length ? dayPeriods[dayPeriods.length - 1].period_number + 1 : 1)

        for (const p of dayPeriods) {
          if (p.period_number >= insertionPoint) {
            if (!shiftsByOldNumber.has(p.period_number)) shiftsByOldNumber.set(p.period_number, [])
            shiftsByOldNumber.get(p.period_number)!.push({ class_id, section_id, day_of_week: day })
          }
        }

        inserts.push({
          school_id, class_id, section_id, day_of_week: day, period_number: insertionPoint,
          start_time: body.start_time, end_time: body.end_time, subject_name: body.subject_name,
          teacher_id: null, room: null, is_break: true,
        })
      }
    }

    // Largest old period_number first, so a row moving into N+1 never
    // collides with a not-yet-moved row still sitting at N+1. Chunked at
    // 15 combos per request — a big school (many classes x 6 days) can
    // produce enough targets for one combined .or() filter to risk
    // hitting a URL length limit.
    const CHUNK = 15
    const descendingOldNumbers = [...shiftsByOldNumber.keys()].sort((a, b) => b - a)
    for (const oldNumber of descendingOldNumbers) {
      const targets = shiftsByOldNumber.get(oldNumber)!
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = targets.slice(i, i + CHUNK)
        const orFilter = batch.map(t => `and(class_id.eq.${t.class_id},section_id.eq.${t.section_id},day_of_week.eq.${t.day_of_week})`).join(',')
        const { error: shiftErr } = await supabase.from('timetable_periods')
          .update({ period_number: oldNumber + 1 })
          .eq('school_id', school_id).eq('period_number', oldNumber).or(orFilter)
        if (shiftErr) return res.status(500).json({ success: false, error: `Failed shifting period ${oldNumber}: ${shiftErr.message}` })
      }
    }

    const { data: inserted, error: insertErr } = await supabase.from('timetable_periods').insert(inserts).select()
    if (insertErr) return res.status(500).json({ success: false, error: insertErr.message })

    res.json({ success: true, data: { periods_shifted: descendingOldNumbers.reduce((n, k) => n + shiftsByOldNumber.get(k)!.length, 0), lunch_periods_created: inserted?.length ?? 0 } })
  })
)

// ── RESOURCE CENTRE ──────────────────────────────────────────
router.get('/resources', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, subject_name, resource_type } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('resources')
    .select('*, classes(name), users:uploaded_by(full_name)')
    .eq('school_id', school_id)
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  if (class_id) query = query.eq('class_id', class_id as string)
  if (subject_name) query = query.eq('subject_name', subject_name as string)
  if (resource_type) query = query.eq('resource_type', resource_type as string)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/resources', requirePermissionV2('resource.upload'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { title, description, resource_type, class_id, subject_name, file_base64, file_name, mime_type, external_url } = req.body
    const school_id = req.user!.school_id
    if (!title || !resource_type) return res.status(400).json({ success: false, error: 'title and resource_type required' })

    let file_url = external_url || null
    let file_size = null

    if (file_base64 && file_name) {
      const base64Data = file_base64.replace(/^data:[\w/]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const filePath = `${school_id}/${Date.now()}_${file_name}`
      const { error: uploadErr } = await supabase.storage.from('resources').upload(filePath, buffer, { contentType: mime_type ?? 'application/octet-stream', upsert: false })
      if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
      const { data: urlData } = supabase.storage.from('resources').getPublicUrl(filePath)
      file_url = urlData.publicUrl
      file_size = buffer.length > 1024 * 1024 ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB` : `${(buffer.length / 1024).toFixed(0)} KB`
    }

    const { data, error } = await supabase.from('resources')
      .insert({ school_id, title, description, resource_type, class_id: class_id || null, subject_name: subject_name || null, file_url, file_size, mime_type, uploaded_by: req.user!.id })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.delete('/resources/:resource_id', requirePermissionV2('resource.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { resource_id } = req.params
    const { error } = await supabase.from('resources').delete().eq('id', resource_id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ── ATTENDANCE (class) ───────────────────────────────────────
router.get('/attendance/class', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, section_id, date } = req.query
  const school_id = req.user!.school_id
  if (!class_id || !date) return res.status(400).json({ success: false, error: 'class_id and date required' })

  let studentsQuery = supabase.from('students')
    .select('id, first_name, last_name, roll_number, admission_number, photo_url, sections(name)')
    .eq('school_id', school_id).eq('class_id', class_id as string).eq('status', 'active').order('roll_number')
  if (section_id) studentsQuery = studentsQuery.eq('section_id', section_id as string)
  const { data: students } = await studentsQuery

  const { data: existing } = await supabase.from('attendance').select('*')
    .eq('school_id', school_id).eq('date', date as string)
    .in('student_id', (students ?? []).map(s => s.id))

  res.json({ success: true, data: { students, attendance: existing ?? [] } })
}))

router.post('/attendance', requirePermissionV2('attendance.mark'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { class_id, section_id, date, records } = req.body
    const school_id = req.user!.school_id
    if (!date || !records?.length) return res.status(400).json({ success: false, error: 'date and records required' })

    // Every teacher holds attendance.mark (they need it for their own
    // homeroom), but a subject-only teacher — no active class teacher
    // assignment — must never be able to mark ANY section's attendance,
    // and a class teacher may only mark their own homeroom section. This
    // is stricter than the RBAC permission and applies regardless of it;
    // school_admin/principal are unaffected.
    if (req.user!.role === 'teacher') {
      const ctx = await getTeacherContext(req.user!.id, school_id)
      if (!ctx.isClassTeacher || ctx.homeroomSection?.section_id !== section_id) {
        return res.status(403).json({ success: false, error: 'Only the class teacher for this section can mark its attendance' })
      }
    }

    const rows = records.map((r: any) => ({ school_id, student_id: r.student_id, class_id: class_id || null, section_id: section_id || null, date, status: r.status, remarks: r.remarks || null, marked_by: req.user!.id }))
    const { data, error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })

    // Same-day absence alert to parents. Best-effort: a notification
    // failure shouldn't turn an already-saved attendance mark into a
    // 500 for the teacher who just submitted it.
    const absentStudentIds = rows.filter((r: any) => r.status === 'absent').map((r: any) => r.student_id)
    if (absentStudentIds.length) {
      try {
        const attendanceIdByStudent = new Map((data ?? []).map((a: any) => [a.student_id, a.id]))
        const { data: absentStudents } = await supabase.from('students')
          .select('id, first_name, last_name').in('id', absentStudentIds)
        for (const s of absentStudents ?? []) {
          const recipients = await getRecipientUserIdsForStudent(s.id)
          await createNotifications(recipients, {
            schoolId: school_id, type: 'attendance_absent',
            title: 'Marked absent today',
            message: `${s.first_name} ${s.last_name} was marked absent on ${date}.`,
            link: '/attendance',
            relatedEntityType: 'attendance', relatedEntityId: attendanceIdByStudent.get(s.id),
          })
        }
      } catch (notifyErr) {
        console.error('Failed to create absence notifications:', notifyErr)
      }
    }

    res.json({ success: true, data, count: rows.length })
  })
)

// ── ATTENDANCE (report — class-wise / section-wise, month or a
// custom range e.g. academic-year-to-date) ──
// Per-student rollup. section_id is optional, same nullable-scope
// convention as everywhere else: omit it for the whole class, pass it
// to narrow to one section. Pass explicit `from`/`to` (YYYY-MM-DD) to
// roll up an arbitrary range — e.g. the current academic year's
// start_date through today — instead of a single calendar month.
//
// "Working days" = the true calendar count for the range (total days
// minus declared holidays minus weekly-off weekdays), capped at today
// so a mid-month report doesn't count days that haven't happened yet.
// A day nobody marked attendance for still counts against the
// denominator and shows up in `unmarked` below — that's the whole
// point of surfacing it, rather than silently dropping it from both
// sides the way this used to work (which made "haven't marked
// anything yet this month" indistinguishable from "great attendance,
// nothing to report"). A date attendance was (mistakenly) marked on a
// holiday/weekly-off day is still dropped from the numerator (filtered
// out via isWorkingDate below) since it was never a real working day.
router.get('/attendance/report', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, section_id, month, year, from, to } = req.query
  const school_id = req.user!.school_id

  // A parent/student passing (or omitting) class_id could otherwise
  // pull back every classmate's attendance rollup, not just their own
  // — this endpoint had no ownership check at all before. Force it to
  // their own single student regardless of what was requested.
  let ownStudentId: string | null = null
  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId) return res.json({ success: true, data: { students: [], working_days: 0, holidays_in_month: 0 } })
  } else if (!class_id) {
    return res.status(400).json({ success: false, error: 'class_id required' })
  }

  const now = new Date()
  const y = year ? Number(year) : now.getFullYear()
  const m = month ? Number(month) : now.getMonth() + 1
  const mStr = String(m).padStart(2, '0')
  const fromDate = (from as string) || `${y}-${mStr}-01`
  const toDate = (to as string) || `${y}-${mStr}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

  let studentsQuery = supabase.from('students')
    .select('id, first_name, last_name, roll_number, admission_number, section_id, sections(name)')
    .eq('school_id', school_id).eq('status', 'active').order('roll_number')
  if (ownStudentId) {
    studentsQuery = studentsQuery.eq('id', ownStudentId)
  } else {
    studentsQuery = studentsQuery.eq('class_id', class_id as string)
    if (section_id) studentsQuery = studentsQuery.eq('section_id', section_id as string)
  }
  const { data: students, error: studentsErr } = await studentsQuery
  if (studentsErr) return res.status(500).json({ success: false, error: studentsErr.message })

  const nonWorkingSets = await getNonWorkingDaySets(school_id, fromDate, toDate)

  // Working days is the TRUE calendar count (total days in range minus
  // holidays/weekly-off), capped at today so a mid-month report doesn't
  // count days that haven't happened yet as "unmarked". This used to be
  // derived from whichever dates happened to have at least one marked
  // record — which meant a class nobody had marked attendance for yet
  // this month reported "1 working day" (today) instead of the real
  // number, and there was no way to see how many days were missing data
  // versus how many days simply hadn't occurred yet.
  const today = toLocalDateStr(new Date())
  const effectiveToDate = toDate > today ? today : toDate
  const workingDays = countWorkingDays(fromDate, effectiveToDate, nonWorkingSets)

  const studentIds = (students ?? []).map(s => s.id)
  const { data: rawRecords, error: attErr } = studentIds.length
    ? await supabase.from('attendance').select('student_id, date, status')
        .eq('school_id', school_id).in('student_id', studentIds)
        .gte('date', fromDate).lte('date', toDate)
    : { data: [], error: null }
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })

  const records = (rawRecords ?? []).filter(r => isWorkingDate(r.date, nonWorkingSets))

  const byStudent = new Map<string, { present: number; absent: number; late: number; leave: number }>()
  for (const r of records) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, { present: 0, absent: 0, late: 0, leave: 0 })
    const counts = byStudent.get(r.student_id)!
    if (r.status === 'present') counts.present++
    else if (r.status === 'absent') counts.absent++
    else if (r.status === 'late') counts.late++
    else if (r.status === 'leave') counts.leave++
  }

  const data = (students ?? []).map(s => {
    const counts = byStudent.get(s.id) ?? { present: 0, absent: 0, late: 0, leave: 0 }
    const unmarked = Math.max(0, workingDays - (counts.present + counts.absent + counts.late + counts.leave))
    const percentage = workingDays > 0 ? Math.round((counts.present / workingDays) * 100) : 0
    return {
      student_id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      roll_number: s.roll_number,
      admission_number: s.admission_number,
      section_id: s.section_id,
      section_name: (s as any).sections?.name ?? null,
      ...counts,
      unmarked,
      percentage,
    }
  })

  res.json({
    success: true,
    data: {
      students: data, working_days: workingDays, holidays_in_month: nonWorkingSets.holidays.size,
      month: m, year: y, from: fromDate, to: toDate,
    },
  })
}))

// ── COMPLAINTS ───────────────────────────────────────────────
router.get('/complaints/all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, category, priority, page = '1', limit = '20' } = req.query
  const { from, to } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id
  let query = supabase.from('complaints')
    .select(`*, students(id, first_name, last_name, admission_number, classes(name)), raised_by_user:raised_by(full_name), assigned_user:assigned_to(full_name)`, { count: 'exact' })
    .eq('school_id', school_id).range(from, to).order('created_at', { ascending: false })
  if (status) query = query.eq('status', status as string)
  if (category) query = query.eq('category', category as string)
  if (priority) query = query.eq('priority', priority as string)
  const { data, error, count } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data, meta: { total: count ?? 0 } })
}))

router.get('/complaints/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const [open, in_progress, resolved, urgent] = await Promise.all([
    supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'open'),
    supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'in_progress'),
    supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('status', 'resolved'),
    supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('school_id', school_id).eq('priority', 'urgent').eq('status', 'open'),
  ])
  res.json({ success: true, data: { open: open.count ?? 0, in_progress: in_progress.count ?? 0, resolved: resolved.count ?? 0, urgent: urgent.count ?? 0 } })
}))

router.post('/complaints', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id, category, subject, description, priority } = req.body
  const school_id = req.user!.school_id
  const { data, error } = await supabase.from('complaints')
    .insert({ school_id, student_id: student_id || null, category, subject, description, priority: priority ?? 'medium', raised_by: req.user!.id })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// Field-level split, same pattern as academics/routes.ts PATCH /syllabus/:id:
// reassigning a complaint needs complaint.assign; changing its status/
// resolution/priority needs complaint.resolve. A request touching only
// one must not require the other. Previously had no gate at all — any
// authenticated user could resolve/reassign/reprioritize any complaint.
router.patch('/complaints/:complaint_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { complaint_id } = req.params
  const { status, assigned_to, resolution, priority } = req.body
  const school_id = req.user!.school_id

  const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
  const hasAssign = isSuperRole || permissionCodes.has('complaint.assign')
  const hasResolve = isSuperRole || permissionCodes.has('complaint.resolve')

  if (assigned_to !== undefined && !hasAssign) {
    return res.status(403).json({ success: false, error: 'Missing permission: complaint.assign' })
  }
  if ((status !== undefined || resolution !== undefined || priority !== undefined) && !hasResolve) {
    return res.status(403).json({ success: false, error: 'Missing permission: complaint.resolve' })
  }

  const update: any = {}
  if (status) update.status = status
  if (assigned_to) update.assigned_to = assigned_to
  if (resolution) update.resolution = resolution
  if (priority) update.priority = priority
  if (status === 'resolved') update.resolved_at = new Date().toISOString()
  const { data, error } = await supabase.from('complaints').update(update).eq('id', complaint_id).eq('school_id', school_id).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.get('/complaints/:complaint_id/comments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { complaint_id } = req.params
  const { data, error } = await supabase.from('complaint_comments').select('*, users:user_id(full_name, role)').eq('complaint_id', complaint_id).order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/complaints/:complaint_id/comments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { complaint_id } = req.params
  const { comment } = req.body
  const { data, error } = await supabase.from('complaint_comments').insert({ complaint_id, user_id: req.user!.id, comment }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// ── BULK PROMOTE ─────────────────────────────────────────────
router.post('/bulk/promote', requirePermissionV2('student.promote'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = BulkPromoteSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data: fetched, error: fetchErr } = await supabase.from('students')
      .select('id, class_id, section_id, academic_year_id, status').in('id', body.student_ids).eq('school_id', school_id)
    if (fetchErr || !fetched?.length) return res.status(400).json({ success: false, error: 'No valid students found' })

    // A suspended student is frozen the same as any other edit to their
    // record — skipped here rather than failing the whole request, so one
    // suspended student inside an otherwise-valid whole-class promotion
    // doesn't block the rest of the class.
    const suspendedCount = fetched.filter(s => s.status === 'suspended').length
    const students = fetched.filter(s => s.status !== 'suspended')
    if (!students.length) {
      return res.status(400).json({ success: false, error: 'All selected students are suspended — reactivate them before transferring.' })
    }

    const promotionRecords = students.map(s => ({
      school_id, student_id: s.id, from_academic_year_id: s.academic_year_id,
      to_academic_year_id: body.to_academic_year_id, from_class_id: s.class_id,
      from_section_id: s.section_id, to_class_id: body.to_class_id,
      to_section_id: body.to_section_id, promotion_type: body.promotion_type,
      promoted_by: req.user!.id, notes: body.notes,
    }))
    // Write the audit record BEFORE moving the students, and check its
    // error — this insert previously ran unchecked and silently failed
    // (RLS was enabled on student_promotions with zero policies), so
    // every promotion's audit trail was lost while the actual class
    // change went through unnoticed. Failing loudly here beats an
    // invisible gap in a compliance-relevant history table.
    const { error: promoErr } = await supabase.from('student_promotions').insert(promotionRecords)
    if (promoErr) return res.status(500).json({ success: false, error: `Failed to record promotion history: ${promoErr.message}` })

    const { error: updateErr } = await supabase.from('students')
      .update({ class_id: body.to_class_id, section_id: body.to_section_id ?? null, academic_year_id: body.to_academic_year_id })
      .in('id', students.map(s => s.id)).eq('school_id', school_id)
    if (updateErr) return res.status(400).json({ success: false, error: updateErr.message })

    const message = suspendedCount
      ? `${students.length} student${students.length > 1 ? 's' : ''} promoted successfully — ${suspendedCount} suspended student${suspendedCount > 1 ? 's were' : ' was'} skipped.`
      : `${students.length} students promoted successfully`
    res.json({ success: true, data: { promoted_count: students.length, skipped_suspended: suspendedCount, message } })
  })
)

// GET /students/promotions — audit trail for the endpoint above. Was
// write-only until now (nothing could ever see a promotion/transfer
// after the fact). Optional student_id narrows to one student's history
// (used on their profile); omit it for a school-wide recent-activity feed.
router.get('/promotions', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id, promotion_type, class_id, limit = '50' } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('student_promotions')
    .select(`
      *,
      students(first_name, last_name, admission_number),
      from_class:from_class_id(name), to_class:to_class_id(name),
      from_section:from_section_id(name), to_section:to_section_id(name),
      from_year:from_academic_year_id(name), to_year:to_academic_year_id(name),
      promoter:promoted_by(full_name)
    `)
    .eq('school_id', school_id)
    .order('created_at', { ascending: false })
    .limit(Number(limit))

  if (student_id) query = query.eq('student_id', student_id as string)
  // 'promoted' = migrated to a new academic year; 'transferred' = moved
  // class/section within the same year; 'detained'/'withdrawn' are the
  // other two recorded outcomes — all four share this one history table.
  if (promotion_type) query = query.eq('promotion_type', promotion_type as string)
  if (class_id) query = query.or(`from_class_id.eq.${class_id},to_class_id.eq.${class_id}`)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))
// teacher only, active only — feeds both the Teacher View selector (browse
// a teacher's weekly timetable) and AddPeriodModal's teacher-assignment
// dropdown. Neither is a place administrators belong: live timetable data
// confirms school_admin/principal are never actually assigned a period,
// so including them here only added noise (an admin nobody assigns
// anything to, cluttering a picker meant for actual teaching staff) —
// same reasoning as free-faculty/substitutes above. Resigned/terminated
// staff are excluded too, for the same reason "Mark Attendance" already does.
//
// Also returns each teacher's subjects, same subjectsFor() precedence as
// /timetable/substitutes (explicit staff_profiles.subjects first, falling
// back to whatever's derived from their weekly timetable) — so
// AddPeriodModal can filter the dropdown to only qualified teachers once
// a subject is picked, without inventing a second definition of
// "qualified" that could drift from what substitute-matching already uses.
router.get('/timetable/teachers', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const [{ data, error }, weekPeriods] = await Promise.all([
    supabase.from('users')
      .select('id, full_name, role, staff_profiles!staff_profiles_user_id_fkey(employment_status, subjects)')
      .eq('school_id', school_id).eq('role', 'teacher').order('full_name'),
    fetchAllRows<{ teacher_id: string | null; subject_name: string; is_break: boolean }>(
      (from, to) => supabase.from('timetable_periods')
        .select('teacher_id, subject_name, is_break', { count: 'exact' })
        .eq('school_id', school_id).order('id').range(from, to),
    ),
  ])
  if (error) return res.status(500).json({ success: false, error: error.message })

  const derivedSubjectsByTeacher = new Map<string, Set<string>>()
  for (const p of weekPeriods ?? []) {
    if (!p.teacher_id || p.is_break) continue
    if (!derivedSubjectsByTeacher.has(p.teacher_id)) derivedSubjectsByTeacher.set(p.teacher_id, new Set())
    derivedSubjectsByTeacher.get(p.teacher_id)!.add(p.subject_name)
  }

  const NON_ACTIVE = new Set(['resigned', 'suspended', 'terminated'])
  const active = (data ?? [])
    .filter(t => !NON_ACTIVE.has((t as any).staff_profiles?.employment_status))
    .map(t => {
      const explicit: string[] = (t as any).staff_profiles?.subjects ?? []
      const subjects = explicit.length ? [...explicit].sort() : [...(derivedSubjectsByTeacher.get(t.id) ?? [])].sort()
      return { id: t.id, full_name: t.full_name, role: t.role, subjects }
    })
  res.json({ success: true, data: active })
}))

// ── GET /students/timetable/free-faculty — who's free at a given
// day_of_week + period, for finding a substitute. Principal/Admin only.
//
// There's no separate "subjects a teacher is qualified for" table in
// this schema, so a teacher's subjects/classes are derived from their
// own weekly timetable (every distinct subject_name / class+section
// they're already scheduled to teach) — the same single source of
// truth the rest of the timetable page already uses, not a new list
// that could drift out of sync with reality.
// timetable.manage rather than timetable.view — the latter is held by
// Teacher/Parent/Student too (basic browsing), and this is a specialized
// staff-scheduling report (which teachers are free/busy right now) that
// shouldn't be that widely visible. timetable.manage matches the old
// requireRole('school_admin','principal') scope exactly.
router.get('/timetable/free-faculty', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const day_of_week = Number(req.query.day_of_week)
    const period_number = req.query.period_number ? Number(req.query.period_number) : undefined
    // Only sent by the frontend when the day being browsed IS today —
    // staff_attendance is a real calendar date, so there's nothing
    // meaningful to check it against for a hypothetical "what does a
    // typical Wednesday look like" query on some other day of the week.
    const date = req.query.date as string | undefined

    if (!day_of_week || day_of_week < 1 || day_of_week > 6) {
      return res.status(400).json({ success: false, error: 'day_of_week (1-6) is required' })
    }

    const [{ data: teacherRows, error: teachersErr }, { data: dayPeriods, error: periodsErr }, { data: attendanceRows, error: attErr }] = await Promise.all([
      // teacher only — school_admin/principal are never actually assigned
      // a period in this schema (confirmed against live timetable_periods
      // data), so including them here just means an administrator with
      // zero periods shows up as permanently "free," which isn't a real
      // substitute candidate. staff_profiles is joined to drop anyone no
      // longer employed for the same reason "Mark Attendance" already does.
      supabase.from('users').select('id, full_name, role, staff_profiles!staff_profiles_user_id_fkey(employment_status)')
        .eq('school_id', school_id).eq('role', 'teacher').order('full_name'),
      supabase.from('timetable_periods')
        .select('teacher_id, period_number, start_time, end_time, subject_name, room, is_break, classes(name), sections(name)')
        .eq('school_id', school_id).eq('day_of_week', day_of_week),
      date
        ? supabase.from('staff_attendance').select('user_id, status').eq('school_id', school_id).eq('date', date)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (teachersErr) return res.status(500).json({ success: false, error: teachersErr.message })
    if (periodsErr) return res.status(500).json({ success: false, error: periodsErr.message })
    const NON_ACTIVE = new Set(['resigned', 'suspended', 'terminated'])
    const teachers = (teacherRows ?? []).filter(t => !NON_ACTIVE.has((t as any).staff_profiles?.employment_status))
    if (attErr) return res.status(500).json({ success: false, error: (attErr as any).message })

    // A teacher out today (absent or on approved leave) isn't actually
    // available to cover a class, and isn't actually the one standing in
    // front of their own class either — drop them from both lists rather
    // than have the timetable (which has no concept of "today") vouch
    // for someone who isn't in the building.
    const absentToday = new Set(
      (attendanceRows ?? []).filter(a => a.status === 'absent' || a.status === 'on_leave').map(a => a.user_id),
    )
    const teachersPresent = (teachers ?? []).filter(t => !absentToday.has(t.id))
    const dayPeriodsPresent = (dayPeriods ?? []).filter(p => !p.teacher_id || !absentToday.has(p.teacher_id))

    // Every distinct TAUGHT period slot offered that day, for the period
    // picker — deduped by period_number, keeping the first start/end seen
    // for it. Breaks (Lunch, etc.) are excluded: "who's free at Lunch" is
    // not a real substitute-finding question, and every teacher would
    // trivially show as free anyway.
    const periodMap = new Map<number, { period_number: number; start_time: string; end_time: string }>()
    for (const p of dayPeriods ?? []) {
      if (p.is_break) continue
      if (!periodMap.has(p.period_number)) {
        periodMap.set(p.period_number, { period_number: p.period_number, start_time: p.start_time, end_time: p.end_time })
      }
    }
    const available_periods = [...periodMap.values()].sort((a, b) => a.period_number - b.period_number)

    // A teacher's subjects/classes across the WHOLE day (for context —
    // "who else could plausibly cover this"), independent of the one
    // period being checked.
    const subjectsByTeacher = new Map<string, Set<string>>()
    const classesByTeacher = new Map<string, Set<string>>()
    for (const p of dayPeriods ?? []) {
      if (!p.teacher_id || p.is_break) continue
      if (!subjectsByTeacher.has(p.teacher_id)) subjectsByTeacher.set(p.teacher_id, new Set())
      subjectsByTeacher.get(p.teacher_id)!.add(p.subject_name)
      const className = (p as any).classes?.name
      if (className) {
        const label = (p as any).sections?.name ? `${className} - ${(p as any).sections.name}` : className
        if (!classesByTeacher.has(p.teacher_id)) classesByTeacher.set(p.teacher_id, new Set())
        classesByTeacher.get(p.teacher_id)!.add(label)
      }
    }

    let free = teachersPresent
    let busy: any[] = []

    if (period_number) {
      const busyThisPeriod = dayPeriodsPresent.filter(p => p.teacher_id && p.period_number === period_number && !p.is_break)
      const busyTeacherIds = new Set(busyThisPeriod.map(p => p.teacher_id))
      free = teachersPresent.filter(t => !busyTeacherIds.has(t.id))
      busy = busyThisPeriod.map(p => {
        const t = teachersPresent.find(x => x.id === p.teacher_id)
        return {
          teacher_id: p.teacher_id, full_name: t?.full_name ?? 'Unknown', subject_name: p.subject_name,
          class_name: (p as any).classes?.name, section_name: (p as any).sections?.name, room: p.room,
        }
      })
    }

    const decorate = (t: any) => ({
      id: t.id, full_name: t.full_name, role: t.role,
      subjects_today: [...(subjectsByTeacher.get(t.id) ?? [])].sort(),
      classes_today: [...(classesByTeacher.get(t.id) ?? [])].sort(),
    })

    res.json({
      success: true,
      data: {
        day_of_week, period_number: period_number ?? null,
        available_periods,
        free: free.map(decorate),
        busy,
      },
    })
  })
)

// ── GET /students/timetable/attention-required — periods happening
// RIGHT NOW where the assigned teacher's check-in doesn't line up with
// showing up: no attendance recorded yet, marked absent/on leave, or
// checked in after the period had already started. This is the piece
// that didn't exist before — the weekly timetable (who's SUPPOSED to
// teach when) and staff_attendance (who's ACTUALLY checked in, and
// when) never talked to each other; this cross-references them live.
// Same reasoning as free-faculty above — this surfaces staff attendance
// status, not something to expose via the broadly-held timetable.view.
//
// Also returns morning_no_checkin: unlike `flagged` above (which only
// ever shows what's wrong with the CURRENT period — a teacher who never
// showed up for Period 1 stops being flagged the moment Period 4 starts,
// even if Period 4 is unstaffed for an entirely different reason), this
// is a cumulative, once-per-teacher check anchored to the school's own
// Lunch break (the first is_break period today whose subject_name is
// "Lunch", case-insensitive — see POST /timetable/bulk-lunch): once
// lunch has started, any teacher who had a period earlier that morning
// and still has no valid check-in today gets listed once, with every
// morning period they missed, rather than disappearing after their own
// period ends. Empty until lunch has actually started — asking "has
// this teacher shown up yet" is meaningless before their day has really
// begun.
//
// Both blocks are cross-referenced against today's absences and cover.
// Without that they report a problem that somebody has already dealt
// with: a teacher confirmed absent with a substitute in every one of
// their periods was still listed, in amber, indefinitely — and the
// current-period block offered a Find Substitute button for a class
// that already had one, which is how a period ends up double-covered.
// An absence that is handled is not an alert; an absence that is
// confirmed but still has uncovered periods very much is, so the two
// are reported differently rather than both being hidden.
router.get('/timetable/attention-required', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const now = new Date()
    const jsDay = now.getDay() // 0=Sun..6=Sat; timetable's day_of_week is 1=Mon..6=Sat, so Sunday has none
    const nowTime = now.toTimeString().slice(0, 8)
    const todayDate = toLocalDateStr(now)

    if (jsDay === 0) {
      return res.json({ success: true, data: { date: todayDate, day_of_week: null, flagged: [], morning_no_checkin: [] } })
    }
    const day_of_week = jsDay

    const [{ data: todayPeriods, error: periodsErr }, { data: attendanceRows, error: attErr }] = await Promise.all([
      supabase.from('timetable_periods')
        .select('id, teacher_id, period_number, start_time, end_time, subject_name, room, is_break, classes(name), sections(name)')
        .eq('school_id', school_id).eq('day_of_week', day_of_week),
      supabase.from('staff_attendance').select('user_id, status, check_in').eq('school_id', school_id).eq('date', todayDate),
    ])
    if (periodsErr) return res.status(500).json({ success: false, error: periodsErr.message })
    if (attErr) return res.status(500).json({ success: false, error: attErr.message })

    // Kept out of the Promise.all above: the generated Supabase types
    // stop inferring once the tuple grows, and every field on every
    // result silently degrades to an error type.
    const [absenceRes, arrangementRes] = await Promise.all([
      supabase.from('teacher_absences')
        .select('teacher_id, status').eq('school_id', school_id)
        .eq('absence_date', todayDate).neq('status', 'cancelled'),
      supabase.from('arrangements')
        .select('timetable_period_id, status, substitute_teacher_id')
        .eq('school_id', school_id).eq('arrangement_date', todayDate).neq('status', 'cancelled'),
    ])
    const absenceRows = (absenceRes.data ?? []) as { teacher_id: string; status: string }[]
    const arrangementRows = (arrangementRes.data ?? []) as
      { timetable_period_id: string | null; status: string; substitute_teacher_id: string | null }[]

    const { data: profileRows } = await supabase.from('staff_profiles')
      .select('user_id, employment_status').eq('school_id', school_id)
    const departedStaff = new Set((profileRows ?? [])
      // Matches NOT_TEACHING_STATUSES: employment_status 'on_leave' is
      // excluded on purpose, because leave is evidenced by a leave
      // request and reaches this screen through today's attendance row
      // instead.
      .filter((p: any) => ['resigned', 'terminated', 'absconded', 'suspended'].includes(p.employment_status))
      .map((p: any) => p.user_id))

    const absenceByTeacher = new Map(absenceRows.map(a => [a.teacher_id, a.status]))
    // A period counts as covered once somebody is named against it.
    // 'declined' and 'unassigned' deliberately do not count: those are
    // the rows that still need a person.
    const coverByPeriod = new Map<string, { substituteId: string | null; status: string }>()
    for (const a of arrangementRows) {
      if (!a.timetable_period_id) continue
      coverByPeriod.set(a.timetable_period_id, {
        substituteId: a.substitute_teacher_id ?? null, status: a.status,
      })
    }
    const isCovered = (periodId: string) => {
      const c = coverByPeriod.get(periodId)
      return !!c && !!c.substituteId && c.status !== 'declined' && c.status !== 'unassigned'
    }

    const attendanceByUser = new Map((attendanceRows ?? []).map(a => [a.user_id, a]))
    const periods = (todayPeriods ?? []).filter(p => !p.is_break && p.start_time <= nowTime && p.end_time >= nowTime)

    const REASON_LABELS: Record<string, string> = {
      not_checked_in: 'Not checked in yet',
      absent: 'Marked absent today',
      on_leave: 'On approved leave',
      no_checkin_time: 'Present, but no check-in time recorded',
      checked_in_late: 'Checked in after this period started',
      departed: 'Not teaching at present — this period has no teacher',
    }

    const flagged = periods
      .filter(p => p.teacher_id)
      .map(p => {
        const att = attendanceByUser.get(p.teacher_id as string)
        let reason: string | null = null
        // Somebody who has resigned is not "not checked in yet" — they
        // are never going to check in, and the period is unstaffed for
        // good rather than for this morning. Saying the first thing
        // sends a manager looking for a person who does not work here.
        if (departedStaff.has(p.teacher_id as string)) reason = 'departed'
        else if (!att) reason = 'not_checked_in'
        else if (att.status === 'absent') reason = 'absent'
        else if (att.status === 'on_leave') reason = 'on_leave'
        else if (!att.check_in) reason = 'no_checkin_time'
        else if (att.check_in > p.start_time) reason = 'checked_in_late'
        return reason ? { ...p, reason } : null
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Somebody is already standing in front of that class.
      .filter(p => !isCovered(p.id))

    // Morning no-checkin, anchored to lunch
    const lunchPeriod = (todayPeriods ?? []).find(p => p.is_break && /lunch/i.test(p.subject_name))
    const morningPeriods = lunchPeriod && nowTime >= lunchPeriod.start_time
      ? (todayPeriods ?? []).filter(p => p.teacher_id && !p.is_break && p.start_time < lunchPeriod.start_time)
      : []
    const missingByTeacher = new Map<string, typeof morningPeriods>()
    for (const p of morningPeriods) {
      // Departed staff belong in the block view's "still timetabled"
      // report, not in a list of people who might turn up later.
      if (departedStaff.has(p.teacher_id as string)) continue
      const att = attendanceByUser.get(p.teacher_id as string)
      const checkedIn = !!att && att.status !== 'absent' && att.status !== 'on_leave' && !!att.check_in
      if (checkedIn) continue
      if (!missingByTeacher.has(p.teacher_id as string)) missingByTeacher.set(p.teacher_id as string, [])
      missingByTeacher.get(p.teacher_id as string)!.push(p)
    }

    const teacherIds = [...new Set([
      ...flagged.map(f => f.teacher_id as string),
      ...missingByTeacher.keys(),
      ...arrangementRows.map(a => a.substitute_teacher_id).filter(Boolean) as string[],
    ])]
    const { data: teacherRows } = teacherIds.length
      ? await supabase.from('users').select('id, full_name').in('id', teacherIds)
      : { data: [] }
    const nameById = new Map((teacherRows ?? []).map(t => [t.id, t.full_name]))

    const result = flagged.map(f => ({
      period_id: f.id, period_number: f.period_number,
      start_time: f.start_time, end_time: f.end_time,
      subject_name: f.subject_name, room: f.room,
      class_name: (f as any).classes?.name, section_name: (f as any).sections?.name,
      teacher_id: f.teacher_id, teacher_name: nameById.get(f.teacher_id as string) ?? 'Unknown',
      reason: f.reason, reason_label: REASON_LABELS[f.reason as string],
    }))

    const morningNoCheckin = [...missingByTeacher.entries()]
      .map(([teacher_id, missed]) => {
        const uncovered = missed.filter(p => !isCovered(p.id))
        return {
          teacher_id, teacher_name: nameById.get(teacher_id) ?? 'Unknown',
          absence_status: absenceByTeacher.get(teacher_id) ?? null,
          uncovered_count: uncovered.length,
          periods_missed: missed
            // Chronological: the list read "P4 ... , P3 ..." because it
            // came back in whatever order the rows arrived.
            .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
            .map(p => ({
              period_number: p.period_number, subject_name: p.subject_name,
              class_name: (p as any).classes?.name, section_name: (p as any).sections?.name,
              start_time: p.start_time,
              covered: isCovered(p.id),
              covered_by: coverByPeriod.get(p.id)?.substituteId
                ? nameById.get(coverByPeriod.get(p.id)!.substituteId!) ?? null
                : null,
            })),
        }
      })
      // Confirmed absent and every period covered: the question has been
      // asked and answered, and repeating it trains people to ignore the
      // panel. Still listed while anything is uncovered.
      .filter(m => !(m.absence_status === 'confirmed' && m.uncovered_count === 0))
      .sort((a, b) => b.uncovered_count - a.uncovered_count)

    const teacherPeriodsInProgress = periods.filter(p => p.teacher_id).length
    res.json({
      success: true,
      data: { date: todayDate, day_of_week, periods_in_progress: teacherPeriodsInProgress, flagged: result, morning_no_checkin: morningNoCheckin },
    })
  })
)

// ── GET /students/timetable/substitutes — the actual "who should cover
// this" answer behind the Find Substitute button. A real suggestion, not
// just re-showing the free-faculty list: candidates must (a) not be
// confirmed absent — same rule as free-faculty, see absentToday below —
// (b) have no class of their own in this exact period, and (c) teach this
// subject per staff_profiles.subjects (the real, admin-settable source of
// truth) or, for teachers nobody has set it for yet, somewhere on their
// WEEKLY timetable (not just today's — a teacher who covers this subject
// only on other days is still qualified to substitute it today). Falls
// back to a same-period-free-but-different-subject pool when no subject
// match exists, so the principal isn't left with an empty screen.
router.get('/timetable/substitutes', requirePermissionV2('timetable.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const day_of_week = Number(req.query.day_of_week)
    const period_number = Number(req.query.period_number)
    const subject_name = req.query.subject_name as string | undefined
    const exclude_teacher_id = req.query.exclude_teacher_id as string | undefined
    const todayDate = toLocalDateStr(new Date())

    if (!day_of_week || day_of_week < 1 || day_of_week > 6 || !period_number) {
      return res.status(400).json({ success: false, error: 'day_of_week (1-6) and period_number are required' })
    }

    const [{ data: teacherRows, error: teachersErr }, weekPeriods, { data: attendanceRows, error: attErr }] = await Promise.all([
      // teacher only, active only — same reasoning as free-faculty above:
      // a substitute has to be an actual teacher who's actually employed,
      // not an administrator or someone who's left.
      supabase.from('users').select('id, full_name, role, staff_profiles!staff_profiles_user_id_fkey(employment_status, subjects)')
        .eq('school_id', school_id).eq('role', 'teacher').order('full_name'),
      // The WHOLE week, not just this day — subject qualification and
      // "busy this exact period" both need to be derived from it, and
      // fetching once avoids a second near-identical query. A real
      // school's week easily clears the 1000-row PostgREST cap (47
      // sections x ~8 periods/day x 6 days ~= 2250 rows) — an unranged
      // select here silently dropped some teachers' busy periods,
      // which is why they wrongly showed up as "free" in the substitute
      // list even though the same-day free-faculty query (well under
      // 1000 rows) correctly excluded them. Paginate with fetchAllRows,
      // same fix already applied to the principal dashboard's
      // attendance/fee queries.
      fetchAllRows<{ teacher_id: string | null; day_of_week: number; period_number: number; subject_name: string; is_break: boolean }>(
        (from, to) => supabase.from('timetable_periods')
          .select('teacher_id, day_of_week, period_number, subject_name, is_break', { count: 'exact' })
          .eq('school_id', school_id).order('id').range(from, to),
      ),
      supabase.from('staff_attendance').select('user_id, status').eq('school_id', school_id).eq('date', todayDate),
    ])
    if (teachersErr) return res.status(500).json({ success: false, error: teachersErr.message })
    if (attErr) return res.status(500).json({ success: false, error: attErr.message })
    const NON_ACTIVE = new Set(['resigned', 'suspended', 'terminated'])
    const teachers = (teacherRows ?? []).filter(t => !NON_ACTIVE.has((t as any).staff_profiles?.employment_status))

    // Excludes only confirmed-absent, same as free-faculty — not "requires
    // an explicit present row". Requiring explicit presence used to mean a
    // teacher with no attendance row yet (common mid-day, before everyone's
    // checked in) was excluded here while still showing up as free on the
    // free-faculty panel right next to it, which could empty out this list
    // entirely even when free-faculty had a full page of qualified
    // candidates. Matching free-faculty's rule keeps the two panels in
    // sync — confirmed live via a school where "12 free, 2 teaching Art &
    // Craft" on free-faculty produced "No one is available" here.
    const absentToday = new Set(
      (attendanceRows ?? []).filter(a => a.status === 'absent' || a.status === 'on_leave').map(a => a.user_id),
    )
    const busyThisPeriod = new Set(
      (weekPeriods ?? [])
        .filter(p => p.teacher_id && !p.is_break && p.day_of_week === day_of_week && p.period_number === period_number)
        .map(p => p.teacher_id as string),
    )
    // Fallback only — see subjectsFor() below, which prefers the explicit
    // staff_profiles.subjects list (the real source of truth) and only
    // falls back to this derived-from-the-timetable set for teachers
    // nobody has set it for yet.
    const derivedSubjectsByTeacher = new Map<string, Set<string>>()
    for (const p of weekPeriods ?? []) {
      if (!p.teacher_id || p.is_break) continue
      if (!derivedSubjectsByTeacher.has(p.teacher_id)) derivedSubjectsByTeacher.set(p.teacher_id, new Set())
      derivedSubjectsByTeacher.get(p.teacher_id)!.add(p.subject_name)
    }
    const subjectsFor = (t: any): string[] => {
      const explicit: string[] = (t as any).staff_profiles?.subjects ?? []
      return explicit.length ? [...explicit].sort() : [...(derivedSubjectsByTeacher.get(t.id) ?? [])].sort()
    }

    const eligible = (teachers ?? []).filter(t =>
      t.id !== exclude_teacher_id && !absentToday.has(t.id) && !busyThisPeriod.has(t.id),
    )

    const decorate = (t: any) => ({ id: t.id, full_name: t.full_name, role: t.role, subjects: subjectsFor(t) })

    const qualified = subject_name
      ? eligible.filter(t => subjectsFor(t).includes(subject_name)).map(decorate)
      : eligible.map(decorate)
    const otherFree = subject_name
      ? eligible.filter(t => !subjectsFor(t).includes(subject_name)).map(decorate)
      : []

    res.json({ success: true, data: { date: todayDate, day_of_week, period_number, subject_name: subject_name ?? null, suggestions: qualified, other_free: otherFree } })
  })
)

// ── GET /students/tc-requests/pending — school-wide pending Transfer
// Certificate requests, for the "Needs Attention Today" dashboard widget.
// Every other TC route is nested under /:id (one student's own TCs) —
// nothing school-wide existed before this.
router.get('/tc-requests/pending', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id

  // A teacher only ever sees TC requests for their own homeroom section
  // (via the dashboard's homeroom-followups widget) — a subject-only
  // teacher (no active class teacher assignment) sees none at all, not
  // just a hidden widget. school_admin/principal see everything, as
  // before.
  let homeroomSectionId: string | null = null
  if (req.user!.role === 'teacher') {
    const ctx = await getTeacherContext(req.user!.id, school_id)
    if (!ctx.homeroomSection) return res.json({ success: true, data: [] })
    homeroomSectionId = ctx.homeroomSection.section_id
  }

  let query = supabase
    .from('transfer_certificates')
    .select('id, tc_number, issue_date, reason, created_at, students!inner(id, first_name, last_name, admission_number, section_id, classes(name))')
    .eq('school_id', school_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (homeroomSectionId) query = query.eq('students.section_id', homeroomSectionId)

  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

async function fetchStudentWithFeeSummary(id: string, school_id: string) {
  const { data, error } = await supabase.from('students')
    .select(`*, classes(id, name, stream), sections(id, name), houses(id, name, color), academic_years(id, name), parents(*, portal_user:user_id(is_active)), portal_user:user_id(is_active)`)
    .eq('id', id).eq('school_id', school_id).single()
  if (error || !data) return null

  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase.from('fee_invoices').select('status, total_amount').eq('student_id', id),
    supabase.from('fee_payments').select('amount_paid').eq('student_id', id),
  ])

  const totalBilled = invoices?.reduce((s, i) => s + Number(i.total_amount), 0) ?? 0
  const totalPaid = payments?.reduce((s, p) => s + Number(p.amount_paid), 0) ?? 0
  const totalDue = totalBilled - totalPaid

  return { ...data, fee_summary: { total_billed: totalBilled, total_paid: totalPaid, total_due: totalDue } }
}

// A suspended student's portal access freezes with them — their own
// login and their parent/guardian's, if either exists. Reversed the same
// way on reactivation (see PATCH /:id below). Silent no-op for a student
// with no portal login at all, which is the common case.
async function setStudentPortalLoginsActive(studentId: string, school_id: string, active: boolean) {
  const { data: student } = await supabase.from('students')
    .select('user_id, parents(user_id)').eq('id', studentId).eq('school_id', school_id).maybeSingle()
  if (!student) return
  const userIds = [
    (student as any).user_id,
    ...((student as any).parents ?? []).map((p: any) => p.user_id),
  ].filter(Boolean) as string[]
  if (!userIds.length) return
  await supabase.from('users').update({ is_active: active }).in('id', userIds).eq('school_id', school_id)
}

// ═══════════════════════════════════════════════════════════════
// /:id ROUTES LAST — after all named routes
// ═══════════════════════════════════════════════════════════════

// ── GET /students/me — the logged-in parent/student's own profile.
// Exists so the parent/student portal has something to call on first
// load without already knowing a student_id (which they have no other
// way to discover — there's no "browse students" access for them).
// Reuses the exact same shape as GET /students/:id below.
router.get('/me', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  if (!NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'This endpoint is for parent/student accounts' })
  }
  const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
  if (!studentId) return res.status(404).json({ success: false, error: 'No student record is linked to this account yet' })
  const data = await fetchStudentWithFeeSummary(studentId, school_id)
  if (!data) return res.status(404).json({ success: false, error: 'Student not found' })
  res.json({ success: true, data })
}))

// ── GET /students/:id ───────────────────────────────────────
// Previously had NO ownership check at all beyond school_id — any
// authenticated user (including a parent/student) could view ANY
// other student's full profile and fee summary just by knowing/
// guessing their id. Forced to the caller's own student for
// NON_STAFF_ROLES, matching every other fix in this sweep.
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId || ownStudentId !== id) {
      return res.status(403).json({ success: false, error: 'You can only view your own student record' })
    }
  }

  const data = await fetchStudentWithFeeSummary(id, school_id)
  if (!data) return res.status(404).json({ success: false, error: 'Student not found' })

  if (req.user!.role === 'teacher') {
    const ctx = await getTeacherContext(req.user!.id, school_id)
    if (!ctx.sectionIds.includes((data as any).section_id)) {
      return res.status(403).json({ success: false, error: 'You can only view students in a section you teach' })
    }
  }

  res.json({ success: true, data })
}))

// ── POST /students ──────────────────────────────────────────
router.post('/', requirePermissionV2('student.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateStudentSchema.parse(req.body)
    const school_id = req.user!.school_id
    const admissionNumber = await nextDocumentNumber(school_id, 'ADM')
    const { father_name, father_phone, father_email, mother_name, mother_phone, mother_email, ...studentData } = body
    const cleanData = Object.fromEntries(Object.entries(studentData).map(([k, v]) => [k, v === '' ? null : v]))
    // Defaults to today rather than staying blank — a student added here
    // is, by default, being added because they're joining now; anyone
    // backdating (bulk-importing existing students) can still set it.
    if (!cleanData.admission_date) cleanData.admission_date = new Date().toISOString().slice(0, 10)
    const { data: student, error } = await supabase.from('students').insert({ ...cleanData, school_id, admission_number: admissionNumber }).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    if (father_name || mother_name) {
      await supabase.from('parents').insert({ school_id, student_id: student.id, father_name, father_phone, father_email, mother_name, mother_phone, mother_email })
    }
    await supabase.from('audit_logs').insert({ school_id, user_id: req.user!.id, action: 'CREATE', entity_type: 'student', entity_id: student.id, new_values: studentData })
    res.status(201).json({ success: true, data: student })
  })
)

// ── PATCH /students/:id ─────────────────────────────────────
// Narrowed from requireRole('school_admin','principal','teacher') to
// student.edit — DEFAULT_ROLE_PERMISSIONS only grants that to Class
// Teacher among teaching roles (not every plain Teacher), matching this
// codebase's own existing homework/syllabus precedent of Class Teacher
// getting broader student-facing rights than a subject-only Teacher.
router.patch('/:id', requirePermissionV2('student.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const body = UpdateStudentSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data: existing } = await supabase.from('students').select().eq('id', id).eq('school_id', school_id).single()
    if (!existing) return res.status(404).json({ success: false, error: 'Student not found' })
    const { father_name, father_phone, father_email, mother_name, mother_phone, mother_email, ...studentData } = body as any

    // A suspended student is frozen — nothing about their record (or
    // their parent's) can be edited except lifting the suspension itself,
    // by moving `status` off 'suspended' in this same request. Without
    // that exception no one could ever reactivate anyone through this
    // same endpoint again.
    const leavingSuspension = studentData.status !== undefined && studentData.status !== 'suspended'
    if (existing.status === 'suspended' && !leavingSuspension) {
      return res.status(403).json({ success: false, error: 'This student is suspended — reactivate them first before editing their profile.' })
    }

    // An edit touching ONLY parent fields (e.g. just updating a phone
    // number from the Parent Info tab) leaves studentData empty —
    // .update({}) against PostgREST doesn't reliably return the row via
    // .single(), so skip the students-table write entirely rather than
    // send a no-op PATCH with nothing in it.
    let data = existing
    if (Object.keys(studentData).length) {
      const { data: updated, error } = await supabase.from('students').update(studentData).eq('id', id).eq('school_id', school_id).select().single()
      if (error) return res.status(400).json({ success: false, error: error.message })
      data = updated
    }

    // These used to be accepted and silently dropped — parsed by the
    // schema, destructured out above, never written anywhere. CREATE's
    // own parents insert (a few routes up) was the only place this data
    // ever actually landed. parents has no unique constraint on
    // student_id (can't onConflict-upsert), so: update the existing row
    // if one exists, otherwise insert one — but only touch the columns
    // actually present in this request, not blank out the rest.
    const parentFields: Record<string, any> = {}
    if (father_name !== undefined) parentFields.father_name = father_name
    if (father_phone !== undefined) parentFields.father_phone = father_phone
    if (father_email !== undefined) parentFields.father_email = father_email
    if (mother_name !== undefined) parentFields.mother_name = mother_name
    if (mother_phone !== undefined) parentFields.mother_phone = mother_phone
    if (mother_email !== undefined) parentFields.mother_email = mother_email

    if (Object.keys(parentFields).length) {
      const { data: existingParent } = await supabase.from('parents').select('id').eq('student_id', id).eq('school_id', school_id).maybeSingle()
      if (existingParent) {
        await supabase.from('parents').update(parentFields).eq('id', existingParent.id)
      } else {
        await supabase.from('parents').insert({ school_id, student_id: id, ...parentFields })
      }
    }

    await supabase.from('audit_logs').insert({ school_id, user_id: req.user!.id, action: 'UPDATE', entity_type: 'student', entity_id: id, old_values: existing, new_values: { ...studentData, ...parentFields } })

    // Suspending or reactivating freezes/restores the linked portal
    // logins in step — see setStudentPortalLoginsActive above.
    if (studentData.status !== undefined && studentData.status !== existing.status) {
      if (studentData.status === 'suspended') await setStudentPortalLoginsActive(id, school_id, false)
      else if (existing.status === 'suspended') await setStudentPortalLoginsActive(id, school_id, true)
    }

    res.json({ success: true, data })
  })
)

// ── POST /students/:id/tc ───────────────────────────────────
router.post('/:id/tc', requirePermissionV2('tc.generate'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { data: student } = await supabase.from('students').select().eq('id', id).eq('school_id', school_id).single()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })
 
    const { reason, last_attendance_date, conduct = 'Good' } = req.body
    const tcNumber = await nextDocumentNumber(school_id, 'TC')
 
    const { data: tc, error } = await supabase.from('transfer_certificates')
      .insert({
        school_id, student_id: id, tc_number: tcNumber, reason, last_attendance_date, conduct,
        dues_cleared: false, // determined by Accountant during workflow step 1, not at creation
        status: 'pending',
        issued_by: req.user!.id,
        qr_code_data: `http://localhost:3000/verify/tc/${tcNumber}`,
      })
      .select().single()
 
    if (error) return res.status(400).json({ success: false, error: error.message })
 
    // Start the Transfer Certificate Workflow:
    //   step 1: Accountant / dues_clearance
    //   step 2: Principal / approve
    await ensureTransferCertificateWorkflowDefinition(school_id)
    const wfResult = await startWorkflow({
      schoolId: school_id,
      workflowName: 'Transfer Certificate Workflow',
      entityType: 'transfer_certificate',
      entityId: tc.id,
      initiatedBy: req.user!.id,
    })
 
    if (!wfResult.success) {
      console.error(`Failed to start TC workflow for ${tc.id}:`, wfResult.error)
    }
 
    // Note: student.status stays as-is (NOT 'transferred') until the
    // workflow completes with final Principal approval — see
    // /workflow-action below.
 
    res.status(201).json({
      success: true,
      data: tc,
      workflow: wfResult.success ? { instance: wfResult.instance } : null,
    })
  })
)
 

// No gate at all before — any authenticated user could act on this.
// Excludes non-staff only, same reasoning as admission.ts's approve/
// workflow-action routes: actOnWorkflow() below already does the real
// per-step check (Accountant/dues_clearance then Principal/approve),
// and Accountant isn't granted tc.generate/tc.view broadly enough to
// safely gate on a specific code here without risk of blocking their
// actual dues-clearance step.
router.post('/:id/tc/:tcId/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id, tcId } = req.params
  const { status, notes } = req.body
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'Not authorized to act on transfer certificate requests' })
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status. Must be approved or rejected.' })
  }
 
  const { data: instance, error: instErr } = await supabase
    .from('workflow_instances')
    .select('id, status')
    .eq('entity_type', 'transfer_certificate')
    .eq('entity_id', tcId)
    .eq('school_id', school_id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
 
  if (instErr || !instance) {
    return res.status(404).json({ success: false, error: 'No workflow instance found for this TC request.' })
  }
 
  if (instance.status !== 'in_progress') {
    return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })
  }
 

  const beforeStatus = await getWorkflowStatus('transfer_certificate', tcId, school_id)
  const currentStepActionName = beforeStatus?.current_step?.action_name

  // Same gate the frontend already shows (disabled button + fee-due
  // banner) — enforced here too so it can't be bypassed by calling this
  // route directly. Reuses the exact fee_invoices/fee_payments math the
  // Fee Summary card on the student page already shows, not a separate
  // number that could drift from it.
  if (status === 'approved' && currentStepActionName === 'dues_clearance') {
    const studentWithFees = await fetchStudentWithFeeSummary(id, school_id)
    const feeDue = studentWithFees?.fee_summary?.total_due ?? 0
    if (feeDue > 0) {
      return res.status(400).json({ success: false, error: `Cannot confirm dues cleared — ₹${feeDue} still due for this student` })
    }
  }

  const result = await actOnWorkflow({
    instanceId: instance.id,
    userId: req.user!.id,
    schoolId: school_id,
    status,
    notes,
  })
 
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error })
  }
 
  if (status === 'approved' && currentStepActionName === 'dues_clearance') {
    // Step 1 approved — record that dues are cleared
    await supabase.from('transfer_certificates').update({ dues_cleared: true }).eq('id', tcId).eq('school_id', school_id)
  }
 
  if (result.completed) {
    const newTcStatus = result.instance.status === 'approved' ? 'approved' : 'rejected'
    await supabase.from('transfer_certificates').update({ status: newTcStatus }).eq('id', tcId).eq('school_id', school_id)

    if (newTcStatus === 'approved') {
      // Final Principal approval — student is now officially transferred
      await supabase.from('students').update({ status: 'transferred' }).eq('id', id).eq('school_id', school_id)
    }

    try {
      const recipients = await getRecipientUserIdsForStudent(id)
      await createNotifications(recipients, {
        schoolId: school_id, type: newTcStatus === 'approved' ? 'tc_approved' : 'tc_rejected',
        title: newTcStatus === 'approved' ? 'Transfer Certificate approved' : 'Transfer Certificate request rejected',
        message: newTcStatus === 'approved'
          ? 'Your Transfer Certificate request has been approved and is ready.'
          : 'Your Transfer Certificate request was rejected.',
        link: '/',
        relatedEntityType: 'transfer_certificate', relatedEntityId: tcId,
      })
    } catch (notifyErr) {
      console.error('Failed to create TC notification:', notifyErr)
    }
  }
 
  res.json({
    success: true,
    data: { instance: result.instance, completed: result.completed, next_step: result.nextStep ?? null },
  })
}))
 
// ── GET /:id/tc/:tcId/workflow-status ─────────────────────────
router.get('/:id/tc/:tcId/workflow-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tcId } = req.params
  const school_id = req.user!.school_id
 
  const status = await getWorkflowStatus('transfer_certificate', tcId, school_id)
 
  if (!status) {
    return res.json({ success: true, data: null, message: 'No workflow started for this TC request' })
  }
 
  res.json({ success: true, data: status })
}))
 

router.get('/:id/tc', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
 
  const { data, error } = await supabase
    .from('transfer_certificates')
    .select('*')
    .eq('student_id', id)
    .eq('school_id', school_id)
    .order('created_at', { ascending: false })
 
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── POST /students/:id/photo ────────────────────────────────
router.post('/:id/photo', requirePermissionV2('student.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
  const { photo_base64, file_name, mime_type } = req.body
  if (!photo_base64) return res.status(400).json({ success: false, error: 'No photo provided' })
  const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${school_id}/${id}/${file_name ?? 'photo.jpg'}`
  const { error: uploadErr } = await supabase.storage.from('student-photos').upload(filePath, buffer, { contentType: mime_type ?? 'image/jpeg', upsert: true })
  if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
  const { data: urlData } = supabase.storage.from('student-photos').getPublicUrl(filePath)
  await supabase.from('students').update({ photo_url: urlData.publicUrl }).eq('id', id).eq('school_id', school_id)
  res.json({ success: true, data: { photo_url: urlData.publicUrl } })
}))

// ── POST /students/:id/portal-login ──────────────────────────
// Homework module plan.md Phase 0 (2026-08-27): the parent/student portal
// and every homework/syllabus endpoint scoped to NON_STAFF_ROLES has been
// unreachable for a real (non-seeded) school — resolveOwnStudentId() only
// ever finds a match if students.user_id/parents.user_id is already set,
// and nothing outside backend/src/seed.ts's demo data ever set it. This is
// that missing provisioning step, staff-facing. Mirrors team/routes.ts's
// POST /team/invite exactly — admin picks the password (not server-
// generated), same supabase.auth.admin.createUser + users-row + RBAC-role
// pattern seed.ts already uses for demo student/parent accounts (seed.ts
// lines ~744-764) — this just makes that a real, auditable, staff-triggered
// action instead of something only ever done for fake data.
const PortalLoginSchema = z.object({
  target: z.enum(['student', 'parent']),
  email: z.string().email(),
  password: z.string().min(6),
})

router.post('/:id/portal-login', requirePermissionV2('student.edit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { target, email, password } = PortalLoginSchema.parse(req.body)

    const { data: student } = await supabase.from('students')
      .select('id, first_name, last_name, phone, user_id, parents(id, father_name, mother_name, guardian_name, father_phone, mother_phone, user_id)')
      .eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })

    const parent = (student as any).parents?.[0]

    if (target === 'student' && (student as any).user_id) {
      return res.status(400).json({ success: false, error: 'This student already has a portal login' })
    }
    if (target === 'parent') {
      if (!parent) return res.status(400).json({ success: false, error: 'Add a parent/guardian record for this student before creating a parent login' })
      if (parent.user_id) return res.status(400).json({ success: false, error: "This student's parent/guardian already has a portal login" })
    }

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).eq('school_id', school_id).maybeSingle()
    if (existing) return res.status(400).json({ success: false, error: 'A user with this email already exists in your school' })

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
    if (authError || !authUser?.user) {
      return res.status(400).json({ success: false, error: authError?.message ?? 'Failed to create auth account' })
    }

    const studentName = `${(student as any).first_name} ${(student as any).last_name}`
    const fullName = target === 'student'
      ? studentName
      : (parent.father_name ?? parent.mother_name ?? parent.guardian_name ?? `Parent of ${studentName}`)
    const phone = target === 'student' ? (student as any).phone : (parent.father_phone ?? parent.mother_phone ?? null)

    const { data: newUser, error: userError } = await supabase.from('users')
      .insert({ id: authUser.user.id, school_id, full_name: fullName, email, phone, role: target, is_active: true })
      .select().single()

    if (userError) {
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return res.status(400).json({ success: false, error: userError.message })
    }

    const linkTable = target === 'student' ? 'students' : 'parents'
    const linkId = target === 'student' ? id : parent.id
    const { error: linkError } = await supabase.from(linkTable).update({ user_id: newUser.id }).eq('id', linkId)

    if (linkError) {
      await supabase.auth.admin.deleteUser(authUser.user.id)
      await supabase.from('users').delete().eq('id', newUser.id)
      return res.status(400).json({ success: false, error: linkError.message })
    }

    await assignDefaultUserRole(newUser.id, school_id, target)

    res.status(201).json({
      success: true,
      data: { ...newUser, has_login: true },
      message: `Account created. Share these credentials: ${email} / ${password}`,
    })
  })
)

// ── GET /students/:id/documents ──────────────────────────────
router.get('/:id/documents', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { data, error } = await supabase.from('student_documents').select('*, users:uploaded_by(full_name)').eq('student_id', id).eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── POST /students/:id/documents ─────────────────────────────
router.post('/:id/documents', requirePermissionV2('student.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
  const { file_base64, file_name, mime_type, document_type, document_name, notes } = req.body
  if (!file_base64) return res.status(400).json({ success: false, error: 'No file provided' })
  const base64Data = file_base64.replace(/^data:[\w/]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${school_id}/${id}/${Date.now()}_${file_name}`
  const { error: uploadErr } = await supabase.storage.from('student-documents').upload(filePath, buffer, { contentType: mime_type ?? 'application/pdf', upsert: false })
  if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
  const { data: urlData } = supabase.storage.from('student-documents').getPublicUrl(filePath)
  const { data, error } = await supabase.from('student_documents').insert({
    school_id, student_id: id, document_type: document_type ?? 'other', document_name: document_name ?? file_name,
    file_url: urlData.publicUrl,
    file_size: buffer.length > 1024 * 1024 ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB` : `${(buffer.length / 1024).toFixed(0)} KB`,
    mime_type, notes, uploaded_by: req.user!.id,
  }).select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.status(201).json({ success: true, data })
}))

// ── DELETE /students/:id/documents/:doc_id ────────────────────
router.delete('/:id/documents/:doc_id', requirePermissionV2('student.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id, doc_id } = req.params
  const { error } = await supabase.from('student_documents').delete().eq('id', doc_id).eq('student_id', id).eq('school_id', req.user!.school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })
  res.json({ success: true })
}))

// ── GET /students/:id/attendance ──────────────────────────────
router.get('/:id/attendance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { month, year } = req.query
  const school_id = req.user!.school_id
  const yNum = year ? Number(year) : new Date().getFullYear()
  const mNum = month ? Number(month) : new Date().getMonth() + 1
  const m = String(mNum).padStart(2, '0')
  const lastDay = new Date(yNum, mNum, 0).getDate()
  const { data, error } = await supabase.from('attendance').select('*')
    .eq('student_id', id).eq('school_id', school_id).gte('date', `${yNum}-${m}-01`).lte('date', `${yNum}-${m}-${String(lastDay).padStart(2, '0')}`).order('date')
  if (error) return res.status(500).json({ success: false, error: error.message })
  const present = data?.filter(a => a.status === 'present').length ?? 0
  const absent = data?.filter(a => a.status === 'absent').length ?? 0
  const late = data?.filter(a => a.status === 'late').length ?? 0
  const total = present + absent + late
  res.json({ success: true, data: { records: data ?? [], summary: { present, absent, late, total, percentage: total > 0 ? Math.round((present / total) * 100) : 0 } } })
}))

// ── GET /students/:id/performance — subject-wise marks for the drill-down
// pie chart, aggregated across every exam recorded so far (mode
// 'average') or scoped to one exam via ?exam_id= (mode 'single'). Also
// returns the list of exams the student actually has marks for, to
// drive the exam-selector — no point offering an exam with nothing
// recorded yet.
//
// Previously had neither check below: any authenticated user (including
// a parent/student) could pull ANY student's marks by knowing/guessing
// their id — same class of bug already fixed on GET /:id and /me, missed
// in that sweep — and could see them the moment a teacher saved a mark,
// long before Generate Results/Freeze/Verify/Publish. Every other
// student/parent-facing results screen gates on exams.status ===
// 'result_published' (see the comment above GET /:id/results in
// exam/routes.ts); this now matches that rule, plus the same
// Term-member/result_frozen exception isExamResultVisibleToNonStaff
// documents (shared/utils/helpers.ts) — batched below rather than calling
// that helper once per exam.
router.get('/:id/performance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { exam_id } = req.query
  const school_id = req.user!.school_id
  const isNonStaff = NON_STAFF_ROLES.includes(req.user!.role)

  if (isNonStaff) {
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId || ownStudentId !== id) {
      return res.status(403).json({ success: false, error: 'You can only view your own performance' })
    }
  }

  const { data: student } = await supabase.from('students').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
  if (!student) return res.status(404).json({ success: false, error: 'Student not found' })

  const { data: rawMarks, error } = await supabase.from('student_marks')
    .select('marks_obtained, is_absent, exam_id, exam_subjects(subject_name, max_marks), exams(name, start_date, status)')
    .eq('school_id', school_id).eq('student_id', id)
  if (error) return res.status(500).json({ success: false, error: error.message })

  // Same rule as isExamResultVisibleToNonStaff (shared/utils/helpers.ts),
  // batched across every exam this student has marks in rather than one
  // async lookup per row: result_published always qualifies; a
  // result_frozen exam also qualifies if it's a Term member, since a
  // component exam inside a composite cycle almost never runs its own
  // full publish chain — only the Term does.
  let marks = rawMarks ?? []
  if (isNonStaff) {
    const frozenExamIds = [...new Set(marks.filter((m: any) => m.exams?.status === 'result_frozen').map((m: any) => m.exam_id))]
    const termMemberExamIds = frozenExamIds.length
      ? new Set(((await supabase.from('result_group_exams').select('exam_id').in('exam_id', frozenExamIds)).data ?? []).map((r: any) => r.exam_id))
      : new Set<string>()
    marks = marks.filter((m: any) =>
      m.exams?.status === 'result_published' || (m.exams?.status === 'result_frozen' && termMemberExamIds.has(m.exam_id)))
  }

  const examsSeen = new Map<string, { id: string; name: string; date: string | null }>()
  for (const m of (marks ?? []) as any[]) {
    if (!examsSeen.has(m.exam_id)) examsSeen.set(m.exam_id, { id: m.exam_id, name: m.exams?.name ?? 'Exam', date: m.exams?.start_date ?? null })
  }
  const exams = Array.from(examsSeen.values()).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  const relevant = exam_id ? (marks ?? []).filter((m: any) => m.exam_id === exam_id) : (marks ?? [])

  const bySubject = new Map<string, { total: number; max: number; count: number }>()
  for (const m of relevant as any[]) {
    if (m.is_absent || m.marks_obtained == null) continue
    const subject_name = m.exam_subjects?.subject_name ?? 'Unknown'
    const g = bySubject.get(subject_name) ?? { total: 0, max: 0, count: 0 }
    g.total += Number(m.marks_obtained)
    g.max += Number(m.exam_subjects?.max_marks ?? 100)
    g.count++
    bySubject.set(subject_name, g)
  }
  const subjects = Array.from(bySubject.entries())
    .map(([subject_name, g]) => ({ subject_name, avg_pct: g.max > 0 ? Math.round((g.total / g.max) * 1000) / 10 : 0, exams_counted: g.count }))
    .sort((a, b) => b.avg_pct - a.avg_pct)

  res.json({ success: true, data: { exams, subjects, mode: exam_id ? 'single' : 'average' } })
}))

export default router