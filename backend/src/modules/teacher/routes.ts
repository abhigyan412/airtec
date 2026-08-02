import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler } from '../../shared/utils/helpers'
import { toLocalDateStr } from '../../shared/utils/academicCalendar'
import { getTeacherContext } from '../../shared/utils/teacherContext'
import { invalidatePermissionsForUser } from '../../shared/middleware/permissions-v2'
import { fetchPaidByInvoice } from '../../shared/utils/feePayments'

const router = Router()
router.use(authenticate)

// ═══════════════════════════════════════════════════════════════
// GET /teacher/dashboard — everything the teacher dashboard needs in one
// round-trip. Every section below is scoped to req.user.id's own
// teaching/homeroom assignments via getTeacherContext(); nothing here
// ever queries school-wide data the way the admin dashboard does.
// ═══════════════════════════════════════════════════════════════
router.get('/dashboard', requireRole('teacher'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id
  const school_id = req.user!.school_id
  const ctx = await getTeacherContext(teacherId, school_id)

  const now = new Date()
  const jsDay = now.getDay() // 0=Sun..6=Sat; timetable's day_of_week is 1=Mon..6=Sat
  const nowTime = now.toTimeString().slice(0, 8)
  const todayDate = toLocalDateStr(now)
  const day_of_week = jsDay === 0 ? null : jsDay

  if (!ctx.academicYearId) {
    // No current academic year configured for the school — nothing below
    // has anywhere to scope to. Surface an explicitly empty dashboard
    // rather than 500ing on every downstream query.
    return res.json({
      success: true,
      data: {
        header: { full_name: req.user!.full_name, date: todayDate, day_of_week, is_class_teacher: false, homeroom_section: null, sections_today: [] },
        attendance_action: null, schedule_today: [], metrics: { homework_assigned: 0, upcoming_tests: 0 },
        metrics_trends: {
          attendance: { value: null, delta: null, sparkline: [null, null, null, null, null] },
          homework_completion: { value: null, delta: null, sparkline: [null, null, null, null, null] },
        },
        classes_performance: [], needs_attention: [],
        upcoming: { tests: [], homework_due: [], events: [] }, homeroom_followups: null,
      },
    })
  }

  const classIds = Array.from(new Set(ctx.teachingAssignments.map(t => t.class_id).filter(Boolean)))
  // subject_name lowercased for matching against exam_subjects.subject_name,
  // which — like timetable_periods — stores the subject as free text
  // rather than subject_id.
  const taughtClassSubjects = new Set(ctx.teachingAssignments.map(t => `${t.class_id}::${t.subject_name.toLowerCase()}`))

  const [
    { data: periods, error: periodsErr },
    { data: homeworkRows, error: hwErr },
    { data: examSubjectRows, error: esErr },
    { data: holidayRows, error: holErr },
  ] = await Promise.all([
    day_of_week
      ? supabase.from('timetable_periods')
          .select('id, period_number, start_time, end_time, room, section_id, class_id, sections(name), classes(name), subject_name')
          .eq('school_id', school_id).eq('teacher_id', teacherId).eq('day_of_week', day_of_week).eq('is_break', false)
          .order('period_number')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('homework')
      .select('id, title, due_date, class_id, section_id, subject_name, classes(name), sections(name), homework_students(student_id, status)')
      .eq('school_id', school_id).eq('created_by', teacherId),
    classIds.length
      ? supabase.from('exam_subjects')
          .select('id, exam_id, class_id, subject_name, exam_date, max_marks, exams(name, status)')
          .in('class_id', classIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('holidays').select('date, name').eq('school_id', school_id)
      .gte('date', todayDate).lte('date', toLocalDateStr(new Date(now.getTime() + 14 * 86400000)))
      .order('date'),
  ])
  if (periodsErr) return res.status(500).json({ success: false, error: periodsErr.message })
  if (hwErr) return res.status(500).json({ success: false, error: hwErr.message })
  if (esErr) return res.status(500).json({ success: false, error: esErr.message })
  if (holErr) return res.status(500).json({ success: false, error: holErr.message })

  // ── Today's schedule, with current/next period highlighted ─────────
  const scheduleToday = (periods ?? []).map((p: any) => ({
    period_id: p.id, period_number: p.period_number, start_time: p.start_time, end_time: p.end_time,
    room: p.room, section_id: p.section_id, section_name: p.sections?.name ?? '', class_name: p.classes?.name ?? '',
    subject_name: p.subject_name,
    is_current: p.start_time <= nowTime && nowTime <= p.end_time,
  }))
  const nextPeriod = scheduleToday.find(p => !p.is_current && p.start_time > nowTime)
  const schedule_today = scheduleToday.map(p => ({ ...p, is_next: nextPeriod?.period_id === p.period_id }))

  const sections_today = Array.from(
    new Map(schedule_today.map(p => [p.section_id, { section_id: p.section_id, section_name: p.section_name, class_name: p.class_name }])).values(),
  )

  // ── Task metrics ─────────────────────────────────────────────────
  // homework_students only exists where assignment_type = 'individual'
  // rows were fanned out to students — bulk 'class' homework has no
  // per-student rows to count, so these counts reflect individually
  // tracked submissions only.
  let homework_assigned = 0
  // Grouped by (title, due_date) rather than one entry per homework row —
  // the same assignment given separately to two of this teacher's
  // sections would otherwise show as two identical-looking upcoming
  // items (see "Upcoming" dedup below).
  const homeworkDueGroups = new Map<string, { id: string; title: string; due_date: string; sections: Set<string> }>()
  // Every (student, due_date, status) this teacher has ever assigned,
  // for the "3+ consecutive missed" needs-attention check and the
  // homework-completion trend/sparkline — both need history, not just
  // what's currently due.
  const homeworkByStudent = new Map<string, { due_date: string; status: string }[]>()
  for (const hw of (homeworkRows ?? []) as any[]) {
    const sectionLabel = `${hw.classes?.name ?? ''} ${hw.sections?.name ?? ''}`.trim()
    for (const hs of hw.homework_students ?? []) {
      if (hs.status === 'assigned' && hw.due_date && hw.due_date >= todayDate) homework_assigned++
      if (hw.due_date && hs.student_id) {
        homeworkByStudent.set(hs.student_id, [...(homeworkByStudent.get(hs.student_id) ?? []), { due_date: hw.due_date, status: hs.status }])
      }
    }
    if (hw.due_date && hw.due_date >= todayDate) {
      const key = `${hw.title}::${hw.due_date}`
      const g = homeworkDueGroups.get(key) ?? { id: hw.id, title: hw.title, due_date: hw.due_date, sections: new Set<string>() }
      if (sectionLabel) g.sections.add(sectionLabel)
      homeworkDueGroups.set(key, g)
    }
  }
  const homeworkDue = Array.from(homeworkDueGroups.values())
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5)
    .map(g => ({ id: g.id, title: g.title, due_date: g.due_date, sections: Array.from(g.sections) }))

  const myExamSubjects = (examSubjectRows ?? [])
    .filter((es: any) => taughtClassSubjects.has(`${es.class_id}::${(es.subject_name ?? '').toLowerCase()}`))
  // Same grouping as homework: an upcoming test on a class-level
  // exam_subjects row implicitly covers every section of that class the
  // teacher teaches, so it's tagged with all of them rather than
  // appearing to be scoped to just one.
  const sectionsForClassSubject = (classId: string, subjectName: string) =>
    ctx.teachingAssignments
      .filter(t => t.class_id === classId && t.subject_name.toLowerCase() === subjectName.toLowerCase())
      .map(t => `${t.class_name} ${t.section_name}`)
  const upcomingTests = myExamSubjects
    .filter((es: any) => es.exam_date && es.exam_date >= todayDate)
    .sort((a: any, b: any) => (a.exam_date ?? '').localeCompare(b.exam_date ?? ''))
    .slice(0, 5)
    .map((es: any) => ({
      id: es.id, subject_name: es.subject_name, exam_name: es.exams?.name, exam_date: es.exam_date,
      sections: sectionsForClassSubject(es.class_id, es.subject_name ?? ''),
    }))

  // ── Classes performance + homeroom attendance-action data ──────────
  // One row per (section, subject) this teacher actually teaches — not
  // just per section, since "subject performance" only means something
  // once a subject is attached (a teacher covering two subjects in the
  // same section gets two rows). Their homeroom section rides along too,
  // attendance-only, if it isn't already one of those.
  const performanceRows = ctx.teachingAssignments.concat(
    ctx.homeroomSection && !ctx.teachingAssignments.some(t => t.section_id === ctx.homeroomSection!.section_id)
      ? [{ section_id: ctx.homeroomSection.section_id, section_name: ctx.homeroomSection.section_name, class_id: ctx.homeroomSection.class_id, class_name: ctx.homeroomSection.class_name, subject_id: '', subject_name: '' }]
      : [],
  )

  // Every PAST exam (already happened) for each (class, subject) this
  // teacher teaches, resolved up front so all of it can be fetched in one
  // round-trip alongside attendance rather than a serial second pass.
  const pastExamsByClassSubject = new Map<string, { id: string; max_marks: number; exam_date: string }[]>()
  for (const es of myExamSubjects) {
    if (!es.exam_date || es.exam_date >= todayDate) continue
    const key = `${es.class_id}::${(es.subject_name ?? '').toLowerCase()}`
    pastExamsByClassSubject.set(key, [...(pastExamsByClassSubject.get(key) ?? []), { id: es.id, max_marks: Number(es.max_marks) || 100, exam_date: es.exam_date }])
  }
  const allPastExamSubjectIds = Array.from(new Set(
    Array.from(pastExamsByClassSubject.values()).flat().map(e => e.id),
  ))

  // 60 days of attendance in one query, not two separate 30-day ones —
  // it serves the existing 30-day classes_performance figure, the 7-day
  // needs-attention check, the 30-vs-previous-30 trend, and the 5-point
  // sparkline, all bucketed client-side from the same rows.
  const attendanceFrom = toLocalDateStr(new Date(now.getTime() - 30 * 86400000))
  const attendanceFrom60 = toLocalDateStr(new Date(now.getTime() - 60 * 86400000))
  const [{ data: allStudents }, { data: attendance60d }, { data: todayAttendance }, { data: pastMarks }] = await Promise.all([
    ctx.sectionIds.length
      ? supabase.from('students').select('id, section_id, first_name, last_name, admission_number').eq('school_id', school_id).eq('status', 'active').in('section_id', ctx.sectionIds)
      : Promise.resolve({ data: [] }),
    ctx.sectionIds.length
      ? supabase.from('attendance').select('student_id, section_id, status, date').eq('school_id', school_id).gte('date', attendanceFrom60).lte('date', todayDate).in('section_id', ctx.sectionIds)
      : Promise.resolve({ data: [] }),
    ctx.homeroomSection
      ? supabase.from('attendance').select('student_id, status').eq('school_id', school_id).eq('section_id', ctx.homeroomSection.section_id).eq('date', todayDate)
      : Promise.resolve({ data: [] }),
    allPastExamSubjectIds.length
      ? supabase.from('student_marks').select('exam_subject_id, student_id, marks_obtained').in('exam_subject_id', allPastExamSubjectIds)
      : Promise.resolve({ data: [] }),
  ])

  const studentsBySection = new Map<string, string[]>()
  const studentInfoById = new Map<string, { first_name: string; last_name: string; admission_number: string; section_id: string }>()
  for (const s of (allStudents ?? []) as any[]) {
    if (!s.section_id) continue
    studentsBySection.set(s.section_id, [...(studentsBySection.get(s.section_id) ?? []), s.id])
    studentInfoById.set(s.id, s)
  }

  const attendance30d = (attendance60d ?? []).filter((a: any) => a.date >= attendanceFrom)

  const classes_performance = performanceRows.map(row => {
    const sectionAttendance = attendance30d.filter((a: any) => a.section_id === row.section_id)
    const marked = sectionAttendance.length
    const present = sectionAttendance.filter((a: any) => a.status === 'present').length
    const attendance_pct = marked > 0 ? Math.round((present / marked) * 1000) / 10 : null
    const sectionStudentIds = studentsBySection.get(row.section_id) ?? []

    const pastExams = pastExamsByClassSubject.get(`${row.class_id}::${row.subject_name.toLowerCase()}`) ?? []
    const maxMarksByExam = new Map(pastExams.map(e => [e.id, e.max_marks]))
    const sectionStudentSet = new Set(sectionStudentIds)
    const relevantMarks = (pastMarks ?? []).filter((m: any) =>
      maxMarksByExam.has(m.exam_subject_id) && sectionStudentSet.has(m.student_id) && m.marks_obtained != null)
    const overall_avg_pct = relevantMarks.length
      ? Math.round((relevantMarks.reduce((s: number, m: any) => s + (Number(m.marks_obtained) / (maxMarksByExam.get(m.exam_subject_id) ?? 100)) * 100, 0) / relevantMarks.length) * 10) / 10
      : null

    return {
      section_id: row.section_id, section_name: row.section_name, class_name: row.class_name,
      subject_id: row.subject_id || null, subject_name: row.subject_name || null,
      attendance_pct, overall_avg_pct, exams_taken: pastExams.length,
      student_count: sectionStudentIds.length,
    }
  })

  // ── Needs attention (computed here, server-side, once per request —
  // never shipped as raw rows for the client to derive itself) ────────
  // Flags any student in this teacher's own sections meeting ANY of:
  //   - attendance < 75% over the last 7 days
  //   - 3+ consecutive missed homework submissions (due date already
  //     passed, submission never made)
  //   - most recent test score more than 15 percentage points below the
  //     one before it, for a subject this teacher teaches them
  const sectionLabelBySection = new Map(performanceRows.map(r => [r.section_id, { class_name: r.class_name, section_name: r.section_name }]))
  const reasonsByStudent = new Map<string, string[]>()
  const addReason = (studentId: string, reason: string) =>
    reasonsByStudent.set(studentId, [...(reasonsByStudent.get(studentId) ?? []), reason])

  const sevenDaysAgo = toLocalDateStr(new Date(now.getTime() - 7 * 86400000))
  const attendance7dByStudent = new Map<string, { marked: number; present: number }>()
  for (const a of (attendance60d ?? []) as any[]) {
    if (a.date < sevenDaysAgo) continue
    const e = attendance7dByStudent.get(a.student_id) ?? { marked: 0, present: 0 }
    e.marked++
    if (a.status === 'present') e.present++
    attendance7dByStudent.set(a.student_id, e)
  }
  for (const [studentId, e] of attendance7dByStudent) {
    if (e.marked > 0 && e.present / e.marked < 0.75) {
      addReason(studentId, `Attendance ${Math.round((e.present / e.marked) * 100)}% in the last 7 days`)
    }
  }

  for (const [studentId, entries] of homeworkByStudent) {
    const pastDue = entries.filter(e => e.due_date < todayDate).sort((a, b) => a.due_date.localeCompare(b.due_date))
    let streak = 0, maxStreak = 0
    for (const e of pastDue) {
      if (e.status === 'assigned') { streak++; maxStreak = Math.max(maxStreak, streak) }
      else streak = 0
    }
    if (maxStreak >= 3) addReason(studentId, `${maxStreak} consecutive missed homework submissions`)
  }

  const marksByExamStudent = new Map((pastMarks ?? []).map((m: any) => [`${m.exam_subject_id}::${m.student_id}`, m.marks_obtained]))
  for (const t of ctx.teachingAssignments) {
    const subjectExams = (pastExamsByClassSubject.get(`${t.class_id}::${t.subject_name.toLowerCase()}`) ?? [])
      .slice().sort((a, b) => b.exam_date.localeCompare(a.exam_date))
    if (subjectExams.length < 2) continue
    const [latest, prior] = subjectExams
    for (const studentId of studentsBySection.get(t.section_id) ?? []) {
      const latestMarks = marksByExamStudent.get(`${latest.id}::${studentId}`)
      const priorMarks = marksByExamStudent.get(`${prior.id}::${studentId}`)
      if (latestMarks == null || priorMarks == null) continue
      const latestPct = (Number(latestMarks) / latest.max_marks) * 100
      const priorPct = (Number(priorMarks) / prior.max_marks) * 100
      if (priorPct - latestPct > 15) {
        addReason(studentId, `${t.subject_name} score dropped ${Math.round(priorPct - latestPct)} points vs the previous test`)
      }
    }
  }

  const needs_attention = Array.from(reasonsByStudent.entries()).map(([studentId, reasons]) => {
    const info = studentInfoById.get(studentId)
    const label = info ? sectionLabelBySection.get(info.section_id) : undefined
    return {
      student_id: studentId, first_name: info?.first_name ?? '', last_name: info?.last_name ?? '',
      class_name: label?.class_name ?? '', section_name: label?.section_name ?? '', reasons,
    }
  })

  // ── Metric card trends: current-30d vs previous-30d, plus a 5-point
  // sparkline over the current period — attendance and homework
  // completion share the same bucketing helper below.
  const previousPeriodTo = toLocalDateStr(new Date(new Date(`${attendanceFrom}T00:00:00`).getTime() - 86400000))
  const periodRate = (events: { date: string; ok: boolean }[], from: string, to: string): number | null => {
    const relevant = events.filter(e => e.date >= from && e.date <= to)
    return relevant.length ? Math.round((relevant.filter(e => e.ok).length / relevant.length) * 1000) / 10 : null
  }
  const sparkline5 = (events: { date: string; ok: boolean }[], from: string, to: string): (number | null)[] => {
    const fromMs = new Date(`${from}T00:00:00`).getTime()
    const toMs = new Date(`${to}T00:00:00`).getTime()
    const bucketMs = (toMs - fromMs) / 5
    const buckets = Array.from({ length: 5 }, () => ({ ok: 0, total: 0 }))
    for (const e of events) {
      if (e.date < from || e.date > to) continue
      const idx = Math.min(4, Math.max(0, Math.floor((new Date(`${e.date}T00:00:00`).getTime() - fromMs) / bucketMs)))
      buckets[idx].total++
      if (e.ok) buckets[idx].ok++
    }
    return buckets.map(b => b.total > 0 ? Math.round((b.ok / b.total) * 1000) / 10 : null)
  }

  const attendanceEvents = (attendance60d ?? []).map((a: any) => ({ date: a.date, ok: a.status === 'present' }))
  const homeworkEvents = Array.from(homeworkByStudent.values()).flat()
    .filter(e => e.due_date < todayDate)
    .map(e => ({ date: e.due_date, ok: e.status === 'submitted' || e.status === 'graded' }))

  const metrics_trends = {
    attendance: {
      value: periodRate(attendanceEvents, attendanceFrom, todayDate),
      delta: (() => {
        const cur = periodRate(attendanceEvents, attendanceFrom, todayDate)
        const prev = periodRate(attendanceEvents, attendanceFrom60, previousPeriodTo)
        return cur != null && prev != null ? Math.round((cur - prev) * 10) / 10 : null
      })(),
      sparkline: sparkline5(attendanceEvents, attendanceFrom, todayDate),
    },
    homework_completion: {
      value: periodRate(homeworkEvents, attendanceFrom, todayDate),
      delta: (() => {
        const cur = periodRate(homeworkEvents, attendanceFrom, todayDate)
        const prev = periodRate(homeworkEvents, attendanceFrom60, previousPeriodTo)
        return cur != null && prev != null ? Math.round((cur - prev) * 10) / 10 : null
      })(),
      sparkline: sparkline5(homeworkEvents, attendanceFrom, todayDate),
    },
  }

  // ── Attendance action bar (class teacher only) ──────────────────────
  const attendance_action = ctx.homeroomSection ? {
    section_id: ctx.homeroomSection.section_id,
    section_name: ctx.homeroomSection.section_name,
    class_name: ctx.homeroomSection.class_name,
    marked: (todayAttendance ?? []).length > 0,
    present_count: (todayAttendance ?? []).filter((a: any) => a.status === 'present').length,
    total_count: (studentsBySection.get(ctx.homeroomSection.section_id) ?? []).length,
  } : null

  // ── Homeroom follow-ups (class teacher only) ────────────────────────
  let homeroom_followups: {
    fee_dues: { top: { student_id: string; first_name: string; last_name: string; amount_overdue: number; days_overdue: number }[]; remaining_count: number; remaining_total: number }
    tc_requests: any[]
  } | null = null
  if (ctx.homeroomSection) {
    const homeroomStudentIds = studentsBySection.get(ctx.homeroomSection.section_id) ?? []
    const [{ data: dueInvoices }, { data: tcRequests }] = await Promise.all([
      homeroomStudentIds.length
        ? supabase.from('fee_invoices').select('id, student_id, total_amount, due_date').eq('school_id', school_id).in('status', ['unpaid', 'partial']).in('student_id', homeroomStudentIds)
        : Promise.resolve({ data: [] }),
      supabase.from('transfer_certificates')
        .select('id, tc_number, reason, created_at, students!inner(id, first_name, last_name, admission_number, section_id)')
        .eq('school_id', school_id).eq('status', 'pending').eq('students.section_id', ctx.homeroomSection.section_id),
    ])

    // amount_due, not total_amount — total_amount is the original bill,
    // not what's still owed after partial payments (same distinction
    // fetchPaidByInvoice's own callers make everywhere else in the app).
    const invoices = dueInvoices ?? []
    const paidByInvoice = await fetchPaidByInvoice(invoices.map((i: any) => i.id))
    const byStudent = new Map<string, { amount_overdue: number; earliest_due_date: string | null }>()
    for (const inv of invoices as any[]) {
      const amountDue = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
      if (amountDue <= 0) continue
      const e = byStudent.get(inv.student_id) ?? { amount_overdue: 0, earliest_due_date: null }
      e.amount_overdue += amountDue
      if (inv.due_date && (!e.earliest_due_date || inv.due_date < e.earliest_due_date)) e.earliest_due_date = inv.due_date
      byStudent.set(inv.student_id, e)
    }
    const feeDueList = Array.from(byStudent.entries())
      .map(([studentId, e]) => {
        const info = studentInfoById.get(studentId)
        const days_overdue = e.earliest_due_date ? Math.max(0, Math.floor((now.getTime() - new Date(`${e.earliest_due_date}T00:00:00`).getTime()) / 86400000)) : 0
        return { student_id: studentId, first_name: info?.first_name ?? '', last_name: info?.last_name ?? '', amount_overdue: Math.round(e.amount_overdue), days_overdue }
      })
      .sort((a, b) => b.amount_overdue - a.amount_overdue)

    homeroom_followups = {
      fee_dues: {
        top: feeDueList.slice(0, 5),
        remaining_count: Math.max(0, feeDueList.length - 5),
        remaining_total: feeDueList.slice(5).reduce((s, f) => s + f.amount_overdue, 0),
      },
      tc_requests: tcRequests ?? [],
    }
  }

  res.json({
    success: true,
    data: {
      header: {
        full_name: req.user!.full_name, date: todayDate, day_of_week,
        is_class_teacher: ctx.isClassTeacher, homeroom_section: ctx.homeroomSection, sections_today,
      },
      attendance_action,
      schedule_today,
      metrics: { homework_assigned, upcoming_tests: upcomingTests.length },
      metrics_trends,
      classes_performance,
      needs_attention,
      upcoming: { tests: upcomingTests, homework_due: homeworkDue, events: holidayRows ?? [] },
      homeroom_followups,
    },
  })
}))

// ═══════════════════════════════════════════════════════════════
// GET /teacher/homework-overview — every homework/classwork item THIS
// teacher assigned, grouped by class and section, behind the "Homework
// Assigned" metric card. Scoped to created_by=req.user.id, same as the
// dashboard's own homework_assigned count — a subject-only teacher
// never sees another teacher's assignments here either.
//
// 'class'-type homework has no per-student rows (see the comment on
// homework_students throughout this file) — those items report
// student_count from the roster instead of a submission breakdown,
// which only exists for 'individual' assignments.
// ═══════════════════════════════════════════════════════════════
router.get('/homework-overview', requireRole('teacher'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id
  const school_id = req.user!.school_id

  const { data: homeworkRows, error: hwErr } = await supabase
    .from('homework')
    .select('id, title, description, subject_name, type, assignment_type, assigned_date, due_date, class_id, section_id, classes(name), sections(name), homework_students(status)')
    .eq('school_id', school_id).eq('created_by', teacherId)
    .order('due_date', { ascending: false })
  if (hwErr) return res.status(500).json({ success: false, error: hwErr.message })

  const sectionIds = Array.from(new Set((homeworkRows ?? []).map((h: any) => h.section_id).filter(Boolean)))
  const { data: students, error: stuErr } = sectionIds.length
    ? await supabase.from('students').select('id, section_id').eq('school_id', school_id).eq('status', 'active').in('section_id', sectionIds)
    : { data: [], error: null }
  if (stuErr) return res.status(500).json({ success: false, error: stuErr.message })
  const studentCountBySection = new Map<string, number>()
  for (const s of (students ?? []) as any[]) {
    studentCountBySection.set(s.section_id, (studentCountBySection.get(s.section_id) ?? 0) + 1)
  }

  const items = (homeworkRows ?? []).map((h: any) => {
    const statuses = (h.homework_students ?? []).map((hs: any) => hs.status)
    const tracked = h.assignment_type === 'individual'
    return {
      id: h.id, title: h.title, description: h.description, subject_name: h.subject_name,
      type: h.type, assignment_type: h.assignment_type, assigned_date: h.assigned_date, due_date: h.due_date,
      class_id: h.class_id, class_name: h.classes?.name ?? '', section_id: h.section_id, section_name: h.sections?.name ?? '',
      student_count: tracked ? statuses.length : (studentCountBySection.get(h.section_id) ?? 0),
      submitted_count: tracked ? statuses.filter((s: string) => s === 'submitted').length : null,
      graded_count: tracked ? statuses.filter((s: string) => s === 'graded').length : null,
      pending_count: tracked ? statuses.filter((s: string) => s === 'assigned').length : null,
    }
  })

  const groupMap = new Map<string, { class_id: string; class_name: string; section_id: string; section_name: string; items: typeof items }>()
  for (const item of items) {
    const key = item.section_id ?? `${item.class_id}::no-section`
    if (!groupMap.has(key)) {
      groupMap.set(key, { class_id: item.class_id, class_name: item.class_name, section_id: item.section_id, section_name: item.section_name, items: [] })
    }
    groupMap.get(key)!.items.push(item)
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || a.section_name.localeCompare(b.section_name))

  res.json({ success: true, data: { groups } })
}))

// ═══════════════════════════════════════════════════════════════
// GET /teacher/homeroom-fee-dues — the full list behind "+N more
// students" on the dashboard's Homeroom Follow-ups card, which only
// ever shows the top 5. Same computation as that card's fee_dues block,
// just without the cap. 403s for a subject-only teacher (no homeroom
// section to scope to) rather than returning school-wide data — this is
// deliberately NOT the admin /fees/arrears page, which needs fee.view
// (a class teacher doesn't hold it) and isn't scoped to one section.
// ═══════════════════════════════════════════════════════════════
router.get('/homeroom-fee-dues', requireRole('teacher'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id
  const school_id = req.user!.school_id
  const ctx = await getTeacherContext(teacherId, school_id)
  if (!ctx.homeroomSection) {
    return res.status(403).json({ success: false, error: 'Only a class teacher can view homeroom fee dues' })
  }

  const { data: homeroomStudents, error: stuErr } = await supabase
    .from('students').select('id, first_name, last_name, admission_number')
    .eq('school_id', school_id).eq('section_id', ctx.homeroomSection.section_id).eq('status', 'active')
  if (stuErr) return res.status(500).json({ success: false, error: stuErr.message })
  const studentIds = (homeroomStudents ?? []).map((s: any) => s.id)
  const studentInfoById = new Map((homeroomStudents ?? []).map((s: any) => [s.id, s]))

  const { data: dueInvoices, error: invErr } = studentIds.length
    ? await supabase.from('fee_invoices').select('id, student_id, total_amount, due_date').eq('school_id', school_id).in('status', ['unpaid', 'partial']).in('student_id', studentIds)
    : { data: [], error: null }
  if (invErr) return res.status(500).json({ success: false, error: invErr.message })

  const invoices = dueInvoices ?? []
  const paidByInvoice = await fetchPaidByInvoice(invoices.map((i: any) => i.id))
  const byStudent = new Map<string, { amount_overdue: number; earliest_due_date: string | null }>()
  const now = new Date()
  for (const inv of invoices as any[]) {
    const amountDue = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
    if (amountDue <= 0) continue
    const e = byStudent.get(inv.student_id) ?? { amount_overdue: 0, earliest_due_date: null }
    e.amount_overdue += amountDue
    if (inv.due_date && (!e.earliest_due_date || inv.due_date < e.earliest_due_date)) e.earliest_due_date = inv.due_date
    byStudent.set(inv.student_id, e)
  }
  const students = Array.from(byStudent.entries())
    .map(([studentId, e]) => {
      const info: any = studentInfoById.get(studentId)
      const days_overdue = e.earliest_due_date ? Math.max(0, Math.floor((now.getTime() - new Date(`${e.earliest_due_date}T00:00:00`).getTime()) / 86400000)) : 0
      return { student_id: studentId, first_name: info?.first_name ?? '', last_name: info?.last_name ?? '', admission_number: info?.admission_number ?? '', amount_overdue: Math.round(e.amount_overdue), days_overdue }
    })
    .sort((a, b) => b.amount_overdue - a.amount_overdue)

  res.json({
    success: true,
    data: {
      section_name: ctx.homeroomSection.section_name, class_name: ctx.homeroomSection.class_name,
      students, total_overdue: students.reduce((s, f) => s + f.amount_overdue, 0),
    },
  })
}))

// ═══════════════════════════════════════════════════════════════
// GET /teacher/subject-performance?section_id=&subject_id= — the drill-
// down behind clicking a row in "My Classes Performance": every past
// exam for that (section, subject), with each student's mark, so a
// teacher can pick a specific test and see who did what on it — not
// just a rolled-up average.
//
// Scoped by re-deriving the teacher's own teachingAssignments rather
// than trusting the section_id/subject_id query params: a subject-only
// teacher passing a section they don't teach must get nothing back, the
// same rule enforced everywhere else a teacher-scoped route reads
// caller-supplied ids.
// ═══════════════════════════════════════════════════════════════
router.get('/subject-performance', requireRole('teacher'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const teacherId = req.user!.id
  const school_id = req.user!.school_id
  const { section_id, subject_id } = req.query as { section_id?: string; subject_id?: string }
  if (!section_id || !subject_id) {
    return res.status(400).json({ success: false, error: 'section_id and subject_id are required' })
  }

  const ctx = await getTeacherContext(teacherId, school_id)
  const assignment = ctx.teachingAssignments.find(t => t.section_id === section_id && t.subject_id === subject_id)
  if (!assignment) {
    return res.status(403).json({ success: false, error: 'You do not teach this subject in this section' })
  }

  const todayDate = toLocalDateStr(new Date())
  const [{ data: examSubjects, error: esErr }, { data: students, error: stuErr }] = await Promise.all([
    supabase.from('exam_subjects')
      .select('id, exam_id, exam_date, max_marks, exams(name)')
      .eq('school_id', school_id).eq('class_id', assignment.class_id)
      .ilike('subject_name', assignment.subject_name)
      .lt('exam_date', todayDate)
      .order('exam_date', { ascending: false }),
    supabase.from('students').select('id, first_name, last_name, admission_number')
      .eq('school_id', school_id).eq('section_id', section_id).eq('status', 'active')
      .order('first_name'),
  ])
  if (esErr) return res.status(500).json({ success: false, error: esErr.message })
  if (stuErr) return res.status(500).json({ success: false, error: stuErr.message })

  const examSubjectIds = (examSubjects ?? []).map((e: any) => e.id)
  const { data: marks, error: marksErr } = examSubjectIds.length
    ? await supabase.from('student_marks').select('exam_subject_id, student_id, marks_obtained, is_absent, grade').in('exam_subject_id', examSubjectIds)
    : { data: [], error: null }
  if (marksErr) return res.status(500).json({ success: false, error: marksErr.message })

  const studentList = (students ?? []) as any[]
  const exams = (examSubjects ?? []).map((es: any) => {
    const marksByStudent = new Map((marks ?? []).filter((m: any) => m.exam_subject_id === es.id).map((m: any) => [m.student_id, m]))
    const rows = studentList.map(s => {
      const m = marksByStudent.get(s.id)
      const marks_obtained = m?.marks_obtained != null ? Number(m.marks_obtained) : null
      return {
        student_id: s.id, first_name: s.first_name, last_name: s.last_name, admission_number: s.admission_number,
        marks_obtained, max_marks: Number(es.max_marks) || 100,
        percentage: marks_obtained != null ? Math.round((marks_obtained / (Number(es.max_marks) || 100)) * 1000) / 10 : null,
        is_absent: m?.is_absent ?? false, grade: m?.grade ?? null,
      }
    })
    const withMarks = rows.filter(r => r.percentage != null)
    const class_average_pct = withMarks.length
      ? Math.round((withMarks.reduce((s, r) => s + (r.percentage as number), 0) / withMarks.length) * 10) / 10
      : null

    return {
      exam_subject_id: es.id, exam_name: es.exams?.name ?? '', exam_date: es.exam_date,
      max_marks: Number(es.max_marks) || 100, class_average_pct, students: rows,
    }
  })

  res.json({
    success: true,
    data: { section_name: assignment.section_name, class_name: assignment.class_name, subject_name: assignment.subject_name, exams },
  })
}))

// ═══════════════════════════════════════════════════════════════
// Admin management of homeroom assignments. There's no equivalent for
// subject-teaching — that's derived live from timetable_periods (see
// getTeacherContext), so building the timetable is the only step needed
// to put a teacher's own subjects/sections on their dashboard.
// ═══════════════════════════════════════════════════════════════

router.get('/class-teacher-assignments', requireRole('school_admin', 'principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { academic_year_id } = req.query
  let query = supabase.from('class_teacher_assignments')
    .select('id, teacher_id, section_id, academic_year_id, is_active, created_at, users(full_name), sections(name, classes(name))')
    .eq('school_id', school_id).eq('is_active', true).order('created_at', { ascending: false })
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id as string)
  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// POST /teacher/class-teacher-assignments — assign a teacher as homeroom
// for a section. Deactivates any other active assignment for that
// teacher AND for that section first (the two partial unique indexes on
// class_teacher_assignments would reject the insert otherwise), then
// grants the RBAC "Class Teacher" role so the elevated permissions it
// carries (student.edit, exam.result_publish, complaint.resolve) show up
// immediately rather than waiting on a manual second step.
router.post('/class-teacher-assignments', requireRole('school_admin', 'principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { teacher_id, section_id, academic_year_id } = req.body
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!teacher_id || !section_id || !academic_year_id) {
    return res.status(400).json({ success: false, error: 'teacher_id, section_id and academic_year_id are required' })
  }
  // teacher_id/section_id are interpolated into a raw .or() filter string
  // below — validate the shape first rather than trust the DB to reject a
  // malformed id, since a crafted value there could alter which rows the
  // filter matches rather than just erroring.
  if (!UUID_RE.test(teacher_id) || !UUID_RE.test(section_id)) {
    return res.status(400).json({ success: false, error: 'teacher_id and section_id must be valid UUIDs' })
  }

  const { data: teacher, error: teacherErr } = await supabase.from('users').select('id, role').eq('id', teacher_id).eq('school_id', school_id).maybeSingle()
  if (teacherErr) return res.status(500).json({ success: false, error: teacherErr.message })
  if (!teacher || teacher.role !== 'teacher') return res.status(400).json({ success: false, error: 'teacher_id must be an active teacher in this school' })

  await supabase.from('class_teacher_assignments').update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('academic_year_id', academic_year_id).eq('is_active', true)
    .or(`teacher_id.eq.${teacher_id},section_id.eq.${section_id}`)

  const { data: created, error } = await supabase.from('class_teacher_assignments')
    .insert({ school_id, teacher_id, section_id, academic_year_id, is_active: true })
    .select().single()
  if (error) return res.status(400).json({ success: false, error: error.message })

  const { data: role } = await supabase.from('roles').select('id').eq('school_id', school_id).eq('name', 'Class Teacher').maybeSingle()
  if (role) {
    await supabase.from('user_roles').insert({ user_id: teacher_id, role_id: role.id, school_id }).select().maybeSingle()
    invalidatePermissionsForUser(teacher_id, school_id)
  }

  res.status(201).json({ success: true, data: created })
}))

// DELETE /teacher/class-teacher-assignments/:id — end a homeroom
// assignment. Revokes the RBAC "Class Teacher" role too, but only if the
// teacher has no OTHER active homeroom assignment (the same person could
// in principle be reassigned to a different section without a gap).
router.delete('/class-teacher-assignments/:id', requireRole('school_admin', 'principal'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  const { id } = req.params

  const { data: assignment, error: findErr } = await supabase.from('class_teacher_assignments').select('teacher_id').eq('id', id).eq('school_id', school_id).maybeSingle()
  if (findErr) return res.status(500).json({ success: false, error: findErr.message })
  if (!assignment) return res.status(404).json({ success: false, error: 'Assignment not found' })

  const { error } = await supabase.from('class_teacher_assignments').update({ is_active: false, ended_at: new Date().toISOString() }).eq('id', id).eq('school_id', school_id)
  if (error) return res.status(400).json({ success: false, error: error.message })

  const { count } = await supabase.from('class_teacher_assignments').select('id', { count: 'exact', head: true }).eq('teacher_id', assignment.teacher_id).eq('is_active', true)
  if (!count) {
    const { data: role } = await supabase.from('roles').select('id').eq('school_id', school_id).eq('name', 'Class Teacher').maybeSingle()
    if (role) await supabase.from('user_roles').delete().eq('user_id', assignment.teacher_id).eq('role_id', role.id).eq('school_id', school_id)
    invalidatePermissionsForUser(assignment.teacher_id, school_id)
  }

  res.json({ success: true })
}))

export default router
