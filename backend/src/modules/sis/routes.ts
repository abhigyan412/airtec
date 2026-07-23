import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, getPagination } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { getNonWorkingDaySets, isWorkingDate } from '../../shared/utils/academicCalendar'

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

  let query = supabase
    .from('students')
    .select(`*, classes(id, name, numeric_level, stream), sections(id, name), houses(id, name, color), academic_years(id, name)`, { count: 'exact' })
    .eq('school_id', school_id)
    .range(from, to)

  if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,admission_number.ilike.%${search}%`)
  if (class_id) query = query.eq('class_id', class_id)
  if (section_id) query = query.eq('section_id', section_id)
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

// ── GET /students/houses ────────────────────────────────────
router.get('/houses', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('houses').select('*').eq('school_id', req.user!.school_id).order('name')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ── TIMETABLE ────────────────────────────────────────────────
router.get('/timetable', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, section_id, teacher_id, academic_year_id } = req.query
  const school_id = req.user!.school_id

  let query = supabase
    .from('timetable_periods')
    .select('*, classes(name), sections(name), users:teacher_id(id, full_name)')
    .eq('school_id', school_id)
    .order('day_of_week')
    .order('period_number')

  if (class_id) query = query.eq('class_id', class_id as string)
  if (section_id) {
  query = query.or(`section_id.eq.${section_id},section_id.is.null`)
}
  if (teacher_id) query = query.eq('teacher_id', teacher_id as string)
  if (academic_year_id) query = query.eq('academic_year_id', academic_year_id as string)

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
    const rows = records.map((r: any) => ({ school_id, student_id: r.student_id, class_id: class_id || null, section_id: section_id || null, date, status: r.status, remarks: r.remarks || null, marked_by: req.user!.id }))
    const { data, error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' }).select()
    if (error) return res.status(400).json({ success: false, error: error.message })
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
  if (!class_id) return res.status(400).json({ success: false, error: 'class_id required' })

  const now = new Date()
  const y = year ? Number(year) : now.getFullYear()
  const m = month ? Number(month) : now.getMonth() + 1
  const mStr = String(m).padStart(2, '0')
  const fromDate = (from as string) || `${y}-${mStr}-01`
  const toDate = (to as string) || `${y}-${mStr}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

  let studentsQuery = supabase.from('students')
    .select('id, first_name, last_name, roll_number, admission_number, section_id, sections(name)')
    .eq('school_id', school_id).eq('class_id', class_id as string).eq('status', 'active').order('roll_number')
  if (section_id) studentsQuery = studentsQuery.eq('section_id', section_id as string)
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
  const { student_id, limit = '50' } = req.query
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

// ═══════════════════════════════════════════════════════════════
// /:id ROUTES LAST — after all named routes
// ═══════════════════════════════════════════════════════════════

// ── GET /students/:id ───────────────────────────────────────
// ── GET /students/:id ───────────────────────────────────────
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id
  const { data, error } = await supabase.from('students')
    .select(`*, classes(id, name, stream), sections(id, name), houses(id, name, color), academic_years(id, name), parents(*)`)
    .eq('id', id).eq('school_id', school_id).single()
  if (error || !data) return res.status(404).json({ success: false, error: 'Student not found' })

  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase.from('fee_invoices').select('status, total_amount').eq('student_id', id),
    supabase.from('fee_payments').select('amount_paid').eq('student_id', id),
  ])

  const totalBilled = invoices?.reduce((s, i) => s + Number(i.total_amount), 0) ?? 0
  const totalPaid = payments?.reduce((s, p) => s + Number(p.amount_paid), 0) ?? 0
  const totalDue = totalBilled - totalPaid

  const feeSummary = { total_billed: totalBilled, total_paid: totalPaid, total_due: totalDue }
  res.json({ success: true, data: { ...data, fee_summary: feeSummary } })
}))

// ── POST /students ──────────────────────────────────────────
router.post('/', requireRole('school_admin', 'principal', 'counselor'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = CreateStudentSchema.parse(req.body)
    const school_id = req.user!.school_id
    const { count } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const admissionNumber = `ADM${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`
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
    const { count } = await supabase.from('transfer_certificates').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const tcNumber = `TC${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`
 
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

export default router