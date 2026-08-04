import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination, NON_STAFF_ROLES, resolveOwnStudentId } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { getNonWorkingDaySets, isWorkingDate, toLocalDateStr } from '../../shared/utils/academicCalendar'
import { createNotifications, getRecipientUserIdsForStudent } from '../../shared/utils/notifications'
import { buildStudentSearchFilter } from '../../shared/utils/studentSearch'
import { getTeacherContext } from '../../shared/utils/teacherContext'

const router = Router()

router.use(authenticate)

const CreateStudentSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().optional(),
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

const UpdateStudentSchema = CreateStudentSchema.partial()

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
  const { page = '1', limit = '20', search, class_id, section_id, status, house_id } = req.query
  const { from, to, limit: lim, page: pg } = getPagination(Number(page), Number(limit))
  const school_id = req.user!.school_id

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
router.get('/attendance/class-summary', requireRole('school_admin', 'principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/timetable', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { periods } = req.body
    const school_id = req.user!.school_id
    if (!Array.isArray(periods) || !periods.length)
      return res.status(400).json({ success: false, error: 'periods array required' })
    const rows = periods.map((p: any) => ({ ...p, school_id }))
    const { data, error } = await supabase.from('timetable_periods').upsert(rows, { onConflict: 'class_id,section_id,day_of_week,period_number' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, data, count: data?.length })
  })
)

router.delete('/timetable/:period_id', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { period_id } = req.params
    const { error } = await supabase.from('timetable_periods').delete().eq('id', period_id).eq('school_id', req.user!.school_id)
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true })
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

router.post('/resources', requireRole('school_admin', 'principal', 'teacher'),
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

router.delete('/resources/:resource_id', requireRole('school_admin', 'principal', 'teacher'),
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

router.post('/attendance', requireRole('school_admin', 'principal', 'teacher'),
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
// "Working days" = distinct dates that have an attendance record for
// this class/section AND aren't a declared holiday AND aren't a
// weekly-off weekday (schools.weekly_off_days). A date attendance was
// (mistakenly) marked on a holiday/weekly-off day doesn't count either
// way — it's dropped from both the numerator and denominator. Days
// nobody marked attendance on are excluded from the denominator too,
// not assumed as absences, since there's no way to tell "closed" from
// "forgot to mark".
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

  const studentIds = (students ?? []).map(s => s.id)
  const { data: rawRecords, error: attErr } = studentIds.length
    ? await supabase.from('attendance').select('student_id, date, status')
        .eq('school_id', school_id).in('student_id', studentIds)
        .gte('date', fromDate).lte('date', toDate)
    : { data: [], error: null }
  if (attErr) return res.status(500).json({ success: false, error: attErr.message })

  const records = (rawRecords ?? []).filter(r => isWorkingDate(r.date, nonWorkingSets))
  const workingDays = new Set(records.map(r => r.date)).size

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

router.patch('/complaints/:complaint_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { complaint_id } = req.params
  const { status, assigned_to, resolution, priority } = req.body
  const school_id = req.user!.school_id
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
router.post('/bulk/promote', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = BulkPromoteSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data: students, error: fetchErr } = await supabase.from('students')
      .select('id, class_id, section_id, academic_year_id').in('id', body.student_ids).eq('school_id', school_id)
    if (fetchErr || !students?.length) return res.status(400).json({ success: false, error: 'No valid students found' })

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
      .in('id', body.student_ids).eq('school_id', school_id)
    if (updateErr) return res.status(400).json({ success: false, error: updateErr.message })

    res.json({ success: true, data: { promoted_count: students.length, message: `${students.length} students promoted successfully` } })
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
router.get('/timetable/teachers', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('school_id', req.user!.school_id)
    .in('role', ['teacher', 'school_admin', 'principal'])
    .order('full_name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
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
router.get('/timetable/free-faculty', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const day_of_week = Number(req.query.day_of_week)
    const period_number = req.query.period_number ? Number(req.query.period_number) : undefined

    if (!day_of_week || day_of_week < 1 || day_of_week > 6) {
      return res.status(400).json({ success: false, error: 'day_of_week (1-6) is required' })
    }

    const [{ data: teachers, error: teachersErr }, { data: dayPeriods, error: periodsErr }] = await Promise.all([
      supabase.from('users').select('id, full_name, role')
        .eq('school_id', school_id).in('role', ['teacher', 'school_admin', 'principal']).order('full_name'),
      supabase.from('timetable_periods')
        .select('teacher_id, period_number, start_time, end_time, subject_name, room, is_break, classes(name), sections(name)')
        .eq('school_id', school_id).eq('day_of_week', day_of_week),
    ])
    if (teachersErr) return res.status(500).json({ success: false, error: teachersErr.message })
    if (periodsErr) return res.status(500).json({ success: false, error: periodsErr.message })

    // Every distinct period slot offered that day, for the period picker —
    // deduped by period_number, keeping the first start/end seen for it.
    const periodMap = new Map<number, { period_number: number; start_time: string; end_time: string }>()
    for (const p of dayPeriods ?? []) {
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

    let free = teachers ?? []
    let busy: any[] = []

    if (period_number) {
      const busyThisPeriod = (dayPeriods ?? []).filter(p => p.teacher_id && p.period_number === period_number && !p.is_break)
      const busyTeacherIds = new Set(busyThisPeriod.map(p => p.teacher_id))
      free = (teachers ?? []).filter(t => !busyTeacherIds.has(t.id))
      busy = busyThisPeriod.map(p => {
        const t = (teachers ?? []).find(x => x.id === p.teacher_id)
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
router.get('/timetable/attention-required', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const now = new Date()
    const jsDay = now.getDay() // 0=Sun..6=Sat; timetable's day_of_week is 1=Mon..6=Sat, so Sunday has none
    const nowTime = now.toTimeString().slice(0, 8)
    const todayDate = toLocalDateStr(now)

    if (jsDay === 0) {
      return res.json({ success: true, data: { date: todayDate, day_of_week: null, flagged: [] } })
    }
    const day_of_week = jsDay

    const [{ data: periods, error: periodsErr }, { data: attendanceRows, error: attErr }] = await Promise.all([
      supabase.from('timetable_periods')
        .select('id, teacher_id, period_number, start_time, end_time, subject_name, room, classes(name), sections(name)')
        .eq('school_id', school_id).eq('day_of_week', day_of_week).eq('is_break', false)
        .lte('start_time', nowTime).gte('end_time', nowTime),
      supabase.from('staff_attendance').select('user_id, status, check_in').eq('school_id', school_id).eq('date', todayDate),
    ])
    if (periodsErr) return res.status(500).json({ success: false, error: periodsErr.message })
    if (attErr) return res.status(500).json({ success: false, error: attErr.message })

    const attendanceByUser = new Map((attendanceRows ?? []).map(a => [a.user_id, a]))

    const REASON_LABELS: Record<string, string> = {
      not_checked_in: 'Not checked in yet',
      absent: 'Marked absent today',
      on_leave: 'On approved leave',
      no_checkin_time: 'Present, but no check-in time recorded',
      checked_in_late: 'Checked in after this period started',
    }

    const flagged = (periods ?? [])
      .filter(p => p.teacher_id)
      .map(p => {
        const att = attendanceByUser.get(p.teacher_id as string)
        let reason: string | null = null
        if (!att) reason = 'not_checked_in'
        else if (att.status === 'absent') reason = 'absent'
        else if (att.status === 'on_leave') reason = 'on_leave'
        else if (!att.check_in) reason = 'no_checkin_time'
        else if (att.check_in > p.start_time) reason = 'checked_in_late'
        return reason ? { ...p, reason } : null
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)

    const teacherIds = [...new Set(flagged.map(f => f.teacher_id as string))]
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

    const teacherPeriodsInProgress = (periods ?? []).filter(p => p.teacher_id).length
    res.json({ success: true, data: { date: todayDate, day_of_week, periods_in_progress: teacherPeriodsInProgress, flagged: result } })
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
    .select(`*, classes(id, name, stream), sections(id, name), houses(id, name, color), academic_years(id, name), parents(*)`)
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
router.post('/', requireRole('school_admin', 'principal', 'counselor'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateStudentSchema.parse(req.body)
    const school_id = req.user!.school_id
    const admissionNumber = await nextDocumentNumber(school_id, 'ADM')
    const { father_name, father_phone, father_email, mother_name, mother_phone, mother_email, ...studentData } = body
    const cleanData = Object.fromEntries(Object.entries(studentData).map(([k, v]) => [k, v === '' ? null : v]))
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
router.patch('/:id', requireRole('school_admin', 'principal', 'teacher'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const body = UpdateStudentSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { data: existing } = await supabase.from('students').select().eq('id', id).eq('school_id', school_id).single()
    if (!existing) return res.status(404).json({ success: false, error: 'Student not found' })
    const { father_name, father_phone, father_email, mother_name, mother_phone, mother_email, ...studentData } = body as any
    const { data, error } = await supabase.from('students').update(studentData).eq('id', id).eq('school_id', school_id).select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    await supabase.from('audit_logs').insert({ school_id, user_id: req.user!.id, action: 'UPDATE', entity_type: 'student', entity_id: id, old_values: existing, new_values: studentData })
    res.json({ success: true, data })
  })
)

// ── POST /students/:id/tc ───────────────────────────────────
router.post('/:id/tc', requireRole('school_admin', 'principal', 'accountant'),
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
 

router.post('/:id/tc/:tcId/workflow-action', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id, tcId } = req.params
  const { status, notes } = req.body
  const school_id = req.user!.school_id
 
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
router.post('/:id/photo', asyncHandler(async (req: AuthRequest, res: Response) => {
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

// ── GET /students/:id/documents ──────────────────────────────
router.get('/:id/documents', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { data, error } = await supabase.from('student_documents').select('*, users:uploaded_by(full_name)').eq('student_id', id).eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── POST /students/:id/documents ─────────────────────────────
router.post('/:id/documents', asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.delete('/:id/documents/:doc_id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.get('/:id/performance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const { exam_id } = req.query
  const school_id = req.user!.school_id

  const { data: student } = await supabase.from('students').select('id').eq('id', id).eq('school_id', school_id).maybeSingle()
  if (!student) return res.status(404).json({ success: false, error: 'Student not found' })

  const { data: marks, error } = await supabase.from('student_marks')
    .select('marks_obtained, is_absent, exam_id, exam_subjects(subject_name, max_marks), exams(name, start_date)')
    .eq('school_id', school_id).eq('student_id', id)
  if (error) return res.status(500).json({ success: false, error: error.message })

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