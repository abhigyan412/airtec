import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, fetchAllRows } from '../../shared/utils/helpers'
import { toLocalDateStr, getNonWorkingDaySets, isWorkingDate } from '../../shared/utils/academicCalendar'
import { effectiveDueDate } from '../academics/routes'

const router = Router()
router.use(authenticate)

// ═══════════════════════════════════════════════════════════════
// GET /principal/dashboard — an oversight/escalation view, deliberately
// NOT the admin dashboard: every figure here is a school-wide aggregate
// or a short flagged-insight list. Nothing in this response ever
// includes an invoice, an admission-pipeline stage, or a student's name
// — that operational detail stays admin-only (see each section's own
// note on what it deliberately omits).
//
// Gated to the legacy 'principal' role specifically (requireRole below)
// — this is additive to whatever Principal already holds via RBAC
// (fee-discount approval, TC approval, exam publish, etc. all keep
// working as before); it does not change or replace any existing
// permission.
// ═══════════════════════════════════════════════════════════════
router.get('/dashboard', requireRole('principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const now = new Date()
  const todayDate = toLocalDateStr(now)
  const sevenDaysAgo = toLocalDateStr(new Date(now.getTime() - 7 * 86400000))
  const fourteenDaysAgo = toLocalDateStr(new Date(now.getTime() - 14 * 86400000))
  const threeDaysAgo = toLocalDateStr(new Date(now.getTime() - 3 * 86400000))
  const sixMonthsAgo = toLocalDateStr(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()))
  const twelveWeeksAgo = toLocalDateStr(new Date(now.getTime() - 84 * 86400000))

  const { data: ay } = await supabase.from('academic_years').select('id').eq('school_id', school_id).eq('is_current', true).maybeSingle()

  const [
    { data: classesRows },
    { data: todayAttendance },
    invoices,
    payments,
    { data: complaintsRecent },
    { data: complaintsPrior },
    { data: unresolvedComplaints },
    { data: todayStaffAttendance },
    { data: teacherUsers },
  ] = await Promise.all([
    supabase.from('classes').select('id, name, numeric_level').eq('school_id', school_id).order('numeric_level'),
    supabase.from('attendance').select('status').eq('school_id', school_id).eq('date', todayDate),
    // A full year of invoices/payments school-wide clears the 1000-row
    // cap (thousands of rows for ~1100 students) — paginate rather than
    // silently understate both sides of the fee-collection percentage.
    ay ? fetchAllRows((from, to) => supabase.from('fee_invoices').select('id, total_amount', { count: 'exact' }).eq('school_id', school_id).eq('academic_year_id', ay.id).order('id').range(from, to)) : Promise.resolve([]),
    // fee_payments has no academic_year_id of its own (only reachable via
    // its invoice) — fetch all-time and filter down to this year's
    // invoice ids in JS below, rather than an .in() with 5000+ ids that
    // would blow past any sane URL length.
    fetchAllRows((from, to) => supabase.from('fee_payments').select('invoice_id, amount_paid', { count: 'exact' }).eq('school_id', school_id).order('id').range(from, to)),
    supabase.from('complaints').select('id').eq('school_id', school_id).gte('created_at', sevenDaysAgo),
    supabase.from('complaints').select('id').eq('school_id', school_id).gte('created_at', fourteenDaysAgo).lt('created_at', sevenDaysAgo),
    supabase.from('complaints')
      .select('id, category, subject, priority, status, created_at, students(class_id, section_id, classes(name), sections(name))')
      .eq('school_id', school_id).in('status', ['open', 'in_progress']),
    supabase.from('staff_attendance').select('status').eq('school_id', school_id).eq('date', todayDate),
    supabase.from('users').select('id, full_name').eq('school_id', school_id).eq('role', 'teacher'),
  ])

  // ── 1. School health summary ────────────────────────────────────────
  const attendanceMarked = todayAttendance ?? []
  const attendance_today_pct = attendanceMarked.length
    ? Math.round((attendanceMarked.filter((a: any) => a.status === 'present').length / attendanceMarked.length) * 1000) / 10
    : null

  const totalInvoiced = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0)
  const thisYearInvoiceIds = new Set(invoices.map((i: any) => i.id))
  const totalCollected = payments
    .filter((p: any) => thisYearInvoiceIds.has(p.invoice_id))
    .reduce((s: number, p: any) => s + Number(p.amount_paid), 0)
  const fee_collection_pct = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 1000) / 10 : null

  const unresolved_complaints_count = (unresolvedComplaints ?? []).length
  // "Trend" here is new-complaint volume this week vs the week before —
  // not unresolved-count history, which isn't reconstructable without a
  // status-change log. Framed to the frontend as "new complaints" so it
  // isn't misread as the unresolved count's own trend.
  const complaints_new_this_week = (complaintsRecent ?? []).length
  const complaints_new_prior_week = (complaintsPrior ?? []).length

  // This card is ALL staff attendance today (matches "Staff attendance %
  // today" in the spec); the staff-oversight section below narrows to
  // teachers specifically for the term trend.
  const staff_attendance_today_pct = (todayStaffAttendance ?? []).length
    ? Math.round(((todayStaffAttendance ?? []).filter((a: any) => a.status === 'present').length / (todayStaffAttendance ?? []).length) * 1000) / 10
    : null

  // ── 2. Academic performance ─────────────────────────────────────────
  const classIds = (classesRows ?? []).map((c: any) => c.id)
  // Every one of these is independent of the others — fired together
  // rather than one after another. Several alone can mean tens of
  // thousands of rows (marks, both 12-week attendance fetches, a term of
  // fee activity), and running them sequentially was the difference
  // between this endpoint taking ~29s and a couple of seconds.
  const [
    { data: examSubjects },
    { data: syllabusChapters },
    allSchoolMarks,
    twelveWeeksAttendance,
    allPeriods,
    twelveWeeksStudentAttendance,
    sixMonthInvoices,
    sixMonthPayments,
  ] = await Promise.all([
    classIds.length
      ? supabase.from('exam_subjects').select('id, exam_id, class_id, subject_name, exam_date, max_marks, exams(name, start_date, status)').in('class_id', classIds)
      : Promise.resolve({ data: [] }),
    classIds.length
      ? supabase.from('syllabus_chapters').select('class_id, subject_name, status, planned_date, classes(name), exams(start_date)').eq('school_id', school_id)
      : Promise.resolve({ data: [] }),
    // A school-wide exam's marks (one row per student per subject) runs to
    // tens of thousands of rows across a couple hundred exam-subjects.
    // Two problems in one fix here: (1) an unranged select silently caps
    // at 1000 rows, and (2) filtering with .in('exam_subject_id', ids)
    // across 300+ ids builds a query string long enough that PostgREST
    // silently drops the filter entirely and returns the WHOLE table
    // instead of erroring — confirmed live (count came back as every
    // student_marks row in the school, not the ~300-exam-subject subset).
    // Filtering by school_id only, then narrowing to past exam-subjects in
    // JS via a Set (below), sidesteps both.
    fetchAllRows((from, to) =>
      supabase.from('student_marks').select('exam_subject_id, marks_obtained', { count: 'exact' })
        .eq('school_id', school_id).not('marks_obtained', 'is', null).order('id').range(from, to)),
    // staff_attendance has two FKs to users (user_id, marked_by) — the
    // hint disambiguates which one to embed/filter on, since a bare
    // users!inner(...) is ambiguous and PostgREST rejects it.
    fetchAllRows((from, to) =>
      supabase.from('staff_attendance')
        .select('date, status, users!user_id!inner(role)', { count: 'exact' }).eq('school_id', school_id).eq('users.role', 'teacher')
        .gte('date', twelveWeeksAgo).lte('date', todayDate).order('id').range(from, to)),
    // A full weekly timetable across every class/section school-wide runs
    // to 1000+ periods — paginate or the teacher-attribution map silently
    // loses coverage for whichever classes fall past row 1000.
    fetchAllRows((from, to) =>
      supabase.from('timetable_periods')
        .select('class_id, section_id, subject_name, teacher_id, sections(name)', { count: 'exact' }).eq('school_id', school_id).eq('is_break', false).not('teacher_id', 'is', null)
        .order('id').range(from, to)),
    // 1000+ students × 12 weeks of workdays is tens of thousands of rows.
    fetchAllRows((from, to) =>
      supabase.from('attendance').select('date, status', { count: 'exact' }).eq('school_id', school_id)
        .gte('date', twelveWeeksAgo).lte('date', todayDate).order('id').range(from, to)),
    // A term's worth of invoices/payments school-wide also clears 1000.
    fetchAllRows((from, to) =>
      supabase.from('fee_invoices').select('total_amount, created_at', { count: 'exact' }).eq('school_id', school_id).gte('created_at', sixMonthsAgo).order('id').range(from, to)),
    fetchAllRows((from, to) =>
      supabase.from('fee_payments').select('amount_paid, payment_date', { count: 'exact' }).eq('school_id', school_id).gte('payment_date', sixMonthsAgo).order('id').range(from, to)),
  ])

  const pastExamSubjects = (examSubjects ?? []).filter((es: any) => es.exam_date && es.exam_date < todayDate)
  const pastExamSubjectIds = new Set(pastExamSubjects.map((es: any) => es.id))
  const allMarks = allSchoolMarks.filter((m: any) => pastExamSubjectIds.has(m.exam_subject_id))

  const marksByExamSubject = new Map<string, number[]>()
  for (const m of allMarks as any[]) {
    marksByExamSubject.set(m.exam_subject_id, [...(marksByExamSubject.get(m.exam_subject_id) ?? []), Number(m.marks_obtained)])
  }
  const pctByExamSubject = new Map<string, number>()
  for (const es of pastExamSubjects as any[]) {
    const marks = marksByExamSubject.get(es.id) ?? []
    if (!marks.length) continue
    const avgPct = (marks.reduce((s, v) => s + v, 0) / marks.length / (Number(es.max_marks) || 100)) * 100
    pctByExamSubject.set(es.id, Math.round(avgPct * 10) / 10)
  }

  // 2a. Overall score trend, last 6 months — one point per exam, school-
  // wide average across every (class, subject) that sat it.
  const examAverages = new Map<string, { name: string; date: string; total: number; count: number }>()
  for (const es of pastExamSubjects as any[]) {
    if (es.exam_date < sixMonthsAgo) continue
    const pct = pctByExamSubject.get(es.id)
    if (pct == null) continue
    const key = es.exam_id
    const e = examAverages.get(key) ?? { name: es.exams?.name ?? 'Exam', date: es.exams?.start_date ?? es.exam_date, total: 0, count: 0 }
    e.total += pct
    e.count++
    examAverages.set(key, e)
  }
  const score_trend = Array.from(examAverages.values())
    .map(e => ({ exam_name: e.name, date: e.date, avg_pct: Math.round((e.total / e.count) * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // 2b. Grade-wise comparison on each grade's own most recent test,
  // sorted weakest first.
  const numericLevelByClass = new Map((classesRows ?? []).map((c: any) => [c.id, { name: c.name, level: c.numeric_level }]))
  // Only consider exam-subjects that actually have marks entered — picking
  // the chronologically latest exam regardless of whether it's been marked
  // yet would silently drop a class that has real scores on an earlier
  // test but nothing recorded on its most recent one.
  const latestExamSubjectByClass = new Map<string, any>()
  for (const es of pastExamSubjects as any[]) {
    if (!pctByExamSubject.has(es.id)) continue
    const existing = latestExamSubjectByClass.get(es.class_id)
    if (!existing || es.exam_date > existing.exam_date) latestExamSubjectByClass.set(es.class_id, es)
  }
  const grade_comparison = Array.from(latestExamSubjectByClass.entries())
    .map(([classId, es]) => {
      const info = numericLevelByClass.get(classId)
      return { class_id: classId, class_name: info?.name ?? '', avg_pct: pctByExamSubject.get(es.id)!, exam_name: es.exams?.name ?? '' }
    })
    .sort((a, b) => a.avg_pct - b.avg_pct)

  // Every syllabus_chapters row in this school is a whole-class plan
  // (section_id is null for all of them — confirmed against the live
  // data, chapters are planned per class, not per section), so there's
  // no real per-section completion split to report. What section-level
  // context DOES exist is who's actually teaching each class+subject in
  // each of its sections, from the timetable — built once here and
  // reused by both the syllabus rollup below and the declining-class
  // attribution further down.
  const teacherNameById = new Map((teacherUsers ?? []).map((u: any) => [u.id, u.full_name]))
  const sectionsByClassSubject = new Map<string, { section_id: string; section_name: string; teacher_name: string | null }[]>()
  for (const p of allPeriods as any[]) {
    const key = `${p.class_id}::${(p.subject_name ?? '').toLowerCase()}`
    const list = sectionsByClassSubject.get(key) ?? []
    if (!list.some(s => s.section_id === p.section_id)) {
      list.push({ section_id: p.section_id, section_name: p.sections?.name ?? '', teacher_name: teacherNameById.get(p.teacher_id) ?? null })
    }
    sectionsByClassSubject.set(key, list)
  }

  // 2c. Syllabus completion, rolled up school-wide — same effectiveDueDate
  // logic as GET /academics/syllabus/stats. Aggregated by class+subject
  // (the actual grain the chapter plan is stored at — see note above),
  // enriched with which sections/teachers deliver it and sorted by gap
  // so the most-behind subjects surface first.
  const syllabusGroups = new Map<string, { class_id: string; class_name: string; subject_name: string; total: number; completed: number; expected_by_now: number }>()
  for (const c of (syllabusChapters ?? []) as any[]) {
    const key = `${c.class_id}::${c.subject_name}`
    const g = syllabusGroups.get(key) ?? { class_id: c.class_id, class_name: c.classes?.name ?? '', subject_name: c.subject_name, total: 0, completed: 0, expected_by_now: 0 }
    g.total++
    if (c.status === 'completed') g.completed++
    const due = effectiveDueDate(c)
    if (due && due <= todayDate) g.expected_by_now++
    syllabusGroups.set(key, g)
  }
  const syllabus_completion = Array.from(syllabusGroups.values())
    .map(g => {
      const percent_complete = g.total ? Math.round((g.completed / g.total) * 100) : 0
      const percent_expected = g.total ? Math.round((g.expected_by_now / g.total) * 100) : 0
      const sections = sectionsByClassSubject.get(`${g.class_id}::${g.subject_name.toLowerCase()}`) ?? []
      return {
        class_id: g.class_id, class_name: g.class_name, subject_name: g.subject_name,
        percent_complete, percent_expected, gap: percent_complete - percent_expected, sections,
      }
    })
    .sort((a, b) => a.gap - b.gap)

  // ── 3. Staff oversight ───────────────────────────────────────────────
  const teacher_attendance_trend = bucketWeekly(twelveWeeksAttendance.map((a: any) => ({ date: a.date, ok: a.status === 'present' })), twelveWeeksAgo, todayDate)

  const complaintsByClass = new Map<string, { class_name: string; section_name: string; count: number }>()
  for (const c of (unresolvedComplaints ?? []) as any[]) {
    const cls = c.students?.classes?.name
    if (!cls) continue
    const key = `${cls}::${c.students?.sections?.name ?? ''}`
    const g = complaintsByClass.get(key) ?? { class_name: cls, section_name: c.students?.sections?.name ?? '', count: 0 }
    g.count++
    complaintsByClass.set(key, g)
  }
  const complaints_by_class = Array.from(complaintsByClass.values()).sort((a, b) => b.count - a.count)

  // Declining-class insight: for each (class, subject) with 2+ past
  // tests, compare the two most recent. Only attributed to a teacher
  // when exactly ONE teacher is timetabled for that whole class+subject
  // — a class split across sections with different teachers is left
  // unattributed rather than guessed at.
  const teachersByClassSubject = new Map<string, Set<string>>()
  for (const p of allPeriods as any[]) {
    const key = `${p.class_id}::${(p.subject_name ?? '').toLowerCase()}`
    teachersByClassSubject.set(key, (teachersByClassSubject.get(key) ?? new Set()).add(p.teacher_id))
  }

  const examSubjectsByClassSubject = new Map<string, any[]>()
  for (const es of pastExamSubjects as any[]) {
    const key = `${es.class_id}::${(es.subject_name ?? '').toLowerCase()}`
    examSubjectsByClassSubject.set(key, [...(examSubjectsByClassSubject.get(key) ?? []), es])
  }

  const performance_concerns: { class_name: string; subject_name: string; teacher_name: string | null; prior_pct: number; latest_pct: number; drop: number }[] = []
  for (const [key, list] of examSubjectsByClassSubject) {
    const sorted = list.filter(es => pctByExamSubject.has(es.id)).sort((a, b) => b.exam_date.localeCompare(a.exam_date))
    if (sorted.length < 2) continue
    const [latest, prior] = sorted
    const latestPct = pctByExamSubject.get(latest.id)!
    const priorPct = pctByExamSubject.get(prior.id)!
    const drop = priorPct - latestPct
    if (drop <= 10) continue
    const teacherSet = teachersByClassSubject.get(key)
    const teacherId = teacherSet && teacherSet.size === 1 ? Array.from(teacherSet)[0] : null
    const classInfo = numericLevelByClass.get(latest.class_id)
    performance_concerns.push({
      class_name: classInfo?.name ?? '', subject_name: latest.subject_name,
      teacher_name: teacherId ? teacherNameById.get(teacherId) ?? null : null,
      prior_pct: priorPct, latest_pct: latestPct, drop: Math.round(drop * 10) / 10,
    })
  }
  performance_concerns.sort((a, b) => b.drop - a.drop)

  // ── 4. Escalations — SLA-breach complaints and disciplinary flags.
  // Class/section context only, never the complaining student's name —
  // enough to decide whether to intervene without duplicating the full
  // operational complaints page.
  const sla_escalations = (unresolvedComplaints ?? [])
    .filter((c: any) => c.created_at.slice(0, 10) <= threeDaysAgo)
    .map((c: any) => ({
      id: c.id, category: c.category, subject: c.subject, priority: c.priority,
      days_open: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / 86400000),
      class_name: c.students?.classes?.name ?? null, section_name: c.students?.sections?.name ?? null,
    }))
    .sort((a: any, b: any) => b.days_open - a.days_open)

  const disciplinary_flagged = (unresolvedComplaints ?? [])
    .filter((c: any) => ['behavioral', 'bullying'].includes(c.category) || ['high', 'urgent'].includes(c.priority))
    .map((c: any) => ({
      id: c.id, category: c.category, subject: c.subject, priority: c.priority,
      days_open: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / 86400000),
      class_name: c.students?.classes?.name ?? null, section_name: c.students?.sections?.name ?? null,
    }))
    .sort((a: any, b: any) => b.days_open - a.days_open)

  // ── 5. School-wide attendance trend (12 weeks) ──────────────────────
  const attendance_trend = bucketWeekly(twelveWeeksStudentAttendance.map((a: any) => ({ date: a.date, ok: a.status === 'present' })), twelveWeeksAgo, todayDate)

  // ── 6. Fee collection — one chart's worth of data: collected vs
  // invoiced, last 6 months. No invoice-level or student-level rows.
  const fee_collection_trend = bucketMonthly(
    sixMonthInvoices.map((i: any) => ({ date: toLocalDateStr(new Date(i.created_at)), amount: Number(i.total_amount) })),
    sixMonthPayments.map((p: any) => ({ date: toLocalDateStr(new Date(p.payment_date)), amount: Number(p.amount_paid) })),
    now,
  )

  res.json({
    success: true,
    data: {
      header: { full_name: req.user!.full_name, date: todayDate },
      health: {
        attendance_today_pct,
        fee_collection_pct,
        unresolved_complaints_count,
        complaints_new_this_week, complaints_new_prior_week,
        staff_attendance_today_pct,
      },
      academic_performance: { score_trend, grade_comparison, syllabus_completion },
      staff_oversight: { teacher_attendance_trend, complaints_by_class, performance_concerns },
      escalations: { sla_escalations, disciplinary_flagged, sla_days: 3 },
      attendance_trend,
      fee_collection_trend,
    },
  })
}))

// ═══════════════════════════════════════════════════════════════
// GET /principal/staff-attendance — list-based, not a percentage: who's
// actually absent, on leave, or never got marked in today, by name.
// Deliberately separate from the school-wide "Staff Attendance %" figure
// that used to live on the health summary — a principal acting on this
// needs names, not a ratio.
// ═══════════════════════════════════════════════════════════════
const TEACHING_ROLES = ['teacher']
const NON_TEACHING_ROLES = ['school_admin', 'accountant', 'counselor', 'principal']
const STATUS_LABEL: Record<string, string> = { absent: 'Absent', on_leave: 'On leave', not_marked: 'Not marked in' }

router.get('/staff-attendance', requireRole('principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const type = req.query.type === 'non_teaching' ? 'non_teaching' : 'teaching'
  const roles = type === 'teaching' ? TEACHING_ROLES : NON_TEACHING_ROLES
  const today = toLocalDateStr(new Date())

  const { data: ay } = await supabase.from('academic_years').select('id').eq('school_id', school_id).eq('is_current', true).maybeSingle()

  const [{ data: staffUsers }, { data: attendanceRows }] = await Promise.all([
    supabase.from('users').select('id, full_name, role').eq('school_id', school_id).eq('is_active', true).in('role', roles),
    supabase.from('staff_attendance').select('user_id, status').eq('school_id', school_id).eq('date', today),
  ])
  const statusByUser = new Map((attendanceRows ?? []).map((a: any) => [a.user_id, a.status]))

  const staffIds = (staffUsers ?? []).map((u: any) => u.id)
  let contextByUser = new Map<string, string | null>()
  if (type === 'teaching' && ay && staffIds.length) {
    const { data: homerooms } = await supabase.from('class_teacher_assignments')
      .select('teacher_id, sections(name, classes(name))')
      .eq('school_id', school_id).eq('academic_year_id', ay.id).eq('is_active', true).in('teacher_id', staffIds)
    contextByUser = new Map((homerooms ?? []).map((h: any) => [h.teacher_id, h.sections ? `${h.sections.classes?.name ?? ''} ${h.sections.name ?? ''}`.trim() : null]))
  } else if (type === 'non_teaching' && staffIds.length) {
    const { data: profiles } = await supabase.from('staff_profiles').select('user_id, department').eq('school_id', school_id).in('user_id', staffIds)
    contextByUser = new Map((profiles ?? []).map((p: any) => [p.user_id, p.department ?? null]))
  }

  const present_count = (staffUsers ?? []).filter((u: any) => statusByUser.get(u.id) === 'present').length
  const absent_count = (staffUsers ?? []).filter((u: any) => statusByUser.get(u.id) === 'absent').length

  const SEVERITY: Record<string, number> = { absent: 0, on_leave: 1, not_marked: 2 }
  const staff = (staffUsers ?? [])
    .map((u: any) => ({ status: statusByUser.get(u.id) ?? 'not_marked', full_name: u.full_name, context: contextByUser.get(u.id) ?? null }))
    .filter(u => u.status in STATUS_LABEL)
    .map(u => ({ full_name: u.full_name, context: u.context, status: u.status, status_label: STATUS_LABEL[u.status] }))
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.full_name.localeCompare(b.full_name))

  res.json({ success: true, data: { type, present_count, absent_count, total_count: (staffUsers ?? []).length, staff } })
}))

// ═══════════════════════════════════════════════════════════════
// GET /principal/low-attendance-students — students below the school's
// configurable cumulative-attendance threshold for the current academic
// year (not a daily/monthly snapshot). Default response is counts only,
// grouped by class+section, to avoid dumping a long name list onto the
// dashboard; pass both class_id and section_id to drill into one group's
// actual names — the "View full list" action.
// ═══════════════════════════════════════════════════════════════
router.get('/low-attendance-students', requireRole('principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, section_id } = req.query

  const [{ data: ay }, { data: school }] = await Promise.all([
    supabase.from('academic_years').select('id, start_date').eq('school_id', school_id).eq('is_current', true).maybeSingle(),
    supabase.from('schools').select('low_attendance_threshold_pct').eq('id', school_id).single(),
  ])
  const threshold_pct = school?.low_attendance_threshold_pct ?? 60
  if (!ay) return res.json({ success: true, data: { threshold_pct, groups: [] } })

  const today = toLocalDateStr(new Date())
  const nonWorkingSets = await getNonWorkingDaySets(school_id, ay.start_date, today)

  // A school-wide student roster (1000+ active students) clears the
  // same 1000-row cap as attendance/marks — and unlike a paginated
  // .range() scan, an unranged select has no ORDER BY, so Postgres
  // doesn't guarantee which ~1000 of 1069 rows come back. That's what
  // was actually causing the non-determinism here (confirmed live: the
  // same request returned a different set of "low attendance" groups,
  // including sometimes none, on back-to-back calls with unchanged
  // data) — not the attendance pagination, which was already correct.
  const students = await fetchAllRows((from, to) => {
    let q = supabase.from('students')
      .select('id, first_name, last_name, class_id, section_id, classes(name), sections(name)', { count: 'exact' })
      .eq('school_id', school_id).eq('status', 'active')
    if (class_id) q = q.eq('class_id', class_id as string)
    if (section_id) q = q.eq('section_id', section_id as string)
    return q.order('id').range(from, to)
  })

  // A whole academic year of school-wide attendance is tens of thousands
  // of rows — PostgREST silently caps an unranged select at 1000, which
  // would leave almost every student with zero rows attributed and drop
  // them from the results entirely. fetchAllRows pages through with
  // .range() until a page comes back short. Scoped to school_id + date
  // only (no .in(student_id, ...) filter) so a 1000+ student roster
  // never has to go into a single query's URL.
  const records = await fetchAllRows((from, to) =>
    supabase.from('attendance').select('student_id, date, status', { count: 'exact' }).eq('school_id', school_id)
      .gte('date', ay.start_date).lte('date', today).order('id').range(from, to))

  // Per-student denominator (days that student was actually marked, not
  // a shared school-wide day count) so a mid-year admission or a gap in
  // one section's register doesn't skew another student's percentage.
  const byStudent = new Map<string, { present: number; marked: number }>()
  for (const r of records as any[]) {
    if (!isWorkingDate(r.date, nonWorkingSets)) continue
    const c = byStudent.get(r.student_id) ?? { present: 0, marked: 0 }
    c.marked++
    if (r.status === 'present') c.present++
    byStudent.set(r.student_id, c)
  }

  const lowStudents = (students ?? [])
    .map((s: any) => {
      const c = byStudent.get(s.id) ?? { present: 0, marked: 0 }
      const pct = c.marked > 0 ? Math.round((c.present / c.marked) * 1000) / 10 : null
      return { ...s, attendance_pct: pct }
    })
    .filter((s: any) => s.attendance_pct != null && s.attendance_pct < threshold_pct)

  if (class_id && section_id) {
    const list = lowStudents
      .map((s: any) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, attendance_pct: s.attendance_pct }))
      .sort((a: any, b: any) => a.attendance_pct - b.attendance_pct)
    return res.json({ success: true, data: { threshold_pct, students: list } })
  }

  const groups = new Map<string, { class_id: string; class_name: string; section_id: string | null; section_name: string; count: number }>()
  for (const s of lowStudents as any[]) {
    const key = `${s.class_id}::${s.section_id ?? 'none'}`
    const g = groups.get(key) ?? { class_id: s.class_id, class_name: s.classes?.name ?? '—', section_id: s.section_id, section_name: s.sections?.name ?? '', count: 0 }
    g.count++
    groups.set(key, g)
  }
  const groupList = Array.from(groups.values()).sort((a, b) => b.count - a.count)
  res.json({ success: true, data: { threshold_pct, groups: groupList } })
}))

// ═══════════════════════════════════════════════════════════════
// GET /principal/syllabus-chapters?class_id=&subject_name= — the
// chapter-by-chapter drill-down behind clicking a row on the Syllabus
// Completion widget: every chapter's own status, not just the rolled-up
// percentage. Same effectiveDueDate logic as the summary, so a chapter's
// "due" reads consistently between the two views.
// ═══════════════════════════════════════════════════════════════
router.get('/syllabus-chapters', requireRole('principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { class_id, subject_name } = req.query
  if (!class_id || !subject_name) return res.status(400).json({ success: false, error: 'class_id and subject_name are required' })

  const { data: chapters, error } = await supabase.from('syllabus_chapters')
    .select('chapter_number, chapter_name, status, planned_date, actual_completion_date, exams(start_date)')
    .eq('school_id', school_id).eq('class_id', class_id as string).eq('subject_name', subject_name as string)
    .order('chapter_number')
  if (error) return res.status(500).json({ success: false, error: error.message })

  const todayDate = toLocalDateStr(new Date())
  const data = (chapters ?? []).map((c: any) => ({
    chapter_number: c.chapter_number, chapter_name: c.chapter_name, status: c.status,
    completed: c.status === 'completed', actual_completion_date: c.actual_completion_date,
    due_date: effectiveDueDate(c), overdue: c.status !== 'completed' && !!effectiveDueDate(c) && effectiveDueDate(c)! <= todayDate,
  }))
  res.json({ success: true, data })
}))

// Buckets dated present/absent-style events into ISO-week buckets across
// [from, to] — shared by the student and teacher attendance trends.
function bucketWeekly(events: { date: string; ok: boolean }[], from: string, to: string): { week_label: string; pct: number | null }[] {
  const fromMs = new Date(`${from}T00:00:00`).getTime()
  const toMs = new Date(`${to}T00:00:00`).getTime()
  const weekMs = 7 * 86400000
  const weeks = Math.max(1, Math.ceil((toMs - fromMs) / weekMs))
  const buckets = Array.from({ length: weeks }, () => ({ ok: 0, total: 0 }))
  for (const e of events) {
    const idx = Math.min(weeks - 1, Math.max(0, Math.floor((new Date(`${e.date}T00:00:00`).getTime() - fromMs) / weekMs)))
    buckets[idx].total++
    if (e.ok) buckets[idx].ok++
  }
  return buckets.map((b, i) => ({
    week_label: toLocalDateStr(new Date(fromMs + i * weekMs)),
    pct: b.total > 0 ? Math.round((b.ok / b.total) * 1000) / 10 : null,
  }))
}

// Buckets invoiced/collected amounts into the trailing 6 calendar months.
function bucketMonthly(invoiced: { date: string; amount: number }[], collected: { date: string; amount: number }[], now: Date) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) }
  })
  const invoicedByMonth = new Map<string, number>()
  for (const i of invoiced) {
    const key = i.date.slice(0, 7)
    invoicedByMonth.set(key, (invoicedByMonth.get(key) ?? 0) + i.amount)
  }
  const collectedByMonth = new Map<string, number>()
  for (const p of collected) {
    const key = p.date.slice(0, 7)
    collectedByMonth.set(key, (collectedByMonth.get(key) ?? 0) + p.amount)
  }
  return months.map(m => ({ month: m.key, label: m.label, invoiced: invoicedByMonth.get(m.key) ?? 0, collected: collectedByMonth.get(m.key) ?? 0 }))
}

export default router
