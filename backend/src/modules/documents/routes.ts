import { Router, Response, Request } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler } from '../../shared/utils/helpers'

const router = Router()

// ── PUBLIC ROUTES (no auth required) ─────────────────────────

router.get('/verify/tc/:tc_number', asyncHandler(async (req: Request, res: Response) => {
  const { tc_number } = req.params
  const { data: tc } = await supabase
    .from('transfer_certificates')
    .select('*, students(first_name, last_name, date_of_birth, admission_number, classes(name)), schools(name, affiliation_board, city)')
    .eq('tc_number', tc_number)
    .single()
  res.send(verifyPageHTML(!!tc, tc_number, tc))
}))

router.get('/verify/certificate/:cert_number', asyncHandler(async (req: Request, res: Response) => {
  const { cert_number } = req.params
  const { data: cert } = await supabase
    .from('issued_certificates')
    .select('*, students(first_name, last_name, admission_number, classes(name)), schools(name, city), certificate_templates(name)')
    .eq('certificate_number', cert_number)
    .single()
  const valid = !!cert
  const issueDate = cert ? new Date(cert.created_at).toLocaleDateString('en-IN') : ''
  res.send(`<!DOCTYPE html><html><head><title>Certificate Verification</title>
  <style>body{font-family:Arial,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:white;border-radius:16px;padding:40px;max-width:480px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px}
  .row:last-child{border:none}.label{color:#6b7280}.value{font-weight:600}</style>
  </head><body><div class="box">
    <div style="font-size:56px;margin-bottom:16px">${valid ? '✅' : '❌'}</div>
    <h2 style="margin:0 0 8px;color:${valid ? '#16a34a' : '#dc2626'}">${valid ? 'Valid Certificate' : 'Invalid Certificate'}</h2>
    <p style="color:#6b7280;margin:0 0 20px">Certificate No: <strong>${cert_number}</strong></p>
    ${valid ? `<div style="background:#f9fafb;border-radius:10px;padding:16px;text-align:left">
      <div class="row"><span class="label">Student</span><span class="value">${cert.students?.first_name} ${cert.students?.last_name}</span></div>
      <div class="row"><span class="label">Type</span><span class="value capitalize">${cert.certificate_type}</span></div>
      <div class="row"><span class="label">Issued On</span><span class="value">${issueDate}</span></div>
      <div class="row"><span class="label">School</span><span class="value">${cert.schools?.name}</span></div>
    </div>` : '<p style="color:#6b7280">This certificate does not exist in our records.</p>'}
    <p style="font-size:11px;color:#9ca3af;margin-top:24px">Powered by AIRTEC School ERP</p>
  </div></body></html>`)
}))

router.get('/certificate/:cert_number', asyncHandler(async (req: Request, res: Response) => {
  const { cert_number } = req.params
  const { token } = req.query
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token as string)
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  } else {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).send('<h2>Unauthorized</h2>')
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  }
  const { data: cert } = await supabase
    .from('issued_certificates')
    .select('*, students(*, classes(name), schools(name, city, affiliation_board, phone, logo_url)), certificate_templates(name, content), users:issued_by(full_name)')
    .eq('certificate_number', cert_number)
    .single()
  if (!cert) return res.status(404).send('<h2>Certificate not found</h2>')
  const student = cert.students as any
  const school  = student?.schools as any
  const issueDate = new Date(cert.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  let content = cert.certificate_templates?.content ?? ''
  const vars: Record<string, string> = {
    '{{student_name}}':   `${student?.first_name ?? ''} ${student?.last_name ?? ''}`,
    '{{class}}':          student?.classes?.name ?? '-',
    '{{admission_no}}':   student?.admission_number ?? '-',
    '{{school_name}}':    school?.name ?? '-',
    '{{city}}':           school?.city ?? '-',
    '{{date}}':           issueDate,
    '{{cert_number}}':    cert.certificate_number,
    '{{roll_number}}':    student?.roll_number ?? '-',
    '{{gender_pronoun}}': student?.gender === 'female' ? 'She' : 'He',
    '{{gender_his_her}}': student?.gender === 'female' ? 'her' : 'his',
    '{{father_name}}':    (cert.issued_data as any)?.father_name ?? '-',
    '{{extra_note}}':     (cert.issued_data as any)?.extra_note ?? '',
  }
  for (const [key, val] of Object.entries(vars)) content = content.replaceAll(key, val)
  const html = `<!DOCTYPE html><html><head><title>Certificate - ${cert.certificate_number}</title>
  <style>@media print{.no-print{display:none}}body{font-family:'Times New Roman',serif;margin:0;background:#fff}
  .page{max-width:800px;margin:0 auto;padding:60px;border:8px double #4F46E5;min-height:90vh;position:relative;display:flex;flex-direction:column;align-items:center}
  .school-name{font-size:26px;font-weight:bold;color:#4F46E5;text-align:center;letter-spacing:2px}
  .cert-title{font-size:22px;font-weight:bold;text-align:center;margin:28px 0 8px;text-decoration:underline;letter-spacing:3px;color:#111}
  .content{font-size:16px;line-height:2;text-align:justify;color:#222;width:100%}
  .footer{display:flex;justify-content:space-between;width:100%;margin-top:60px}
  .sig-line{border-top:1px solid #000;width:160px;padding-top:8px;font-size:13px;text-align:center}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Print</button>
  <div class="page">
    <div style="position:absolute;top:20px;right:24px;font-size:11px;color:#9ca3af">No: ${cert.certificate_number}</div>
    <div class="school-name">${school?.name ?? 'School'}</div>
    <div style="font-size:13px;color:#6b7280;text-align:center;margin-top:4px">${school?.city ?? ''} · ${school?.affiliation_board ?? 'CBSE'}</div>
    <div class="cert-title">CERTIFICATE</div>
    <div style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:28px;letter-spacing:2px;text-transform:uppercase">${cert.certificate_type?.replace('_',' ')} Certificate</div>
    <div class="content">${content}</div>
    <div class="footer">
      <div><div class="sig-line">Class Teacher</div></div>
      <div><div class="sig-line">Principal</div></div>
    </div>
  </div></body></html>`
  res.setHeader('Content-Type', 'text/html')
  res.send(html)
}))

router.get('/admit-card/:exam_id/:student_id', asyncHandler(async (req: Request, res: Response) => {
  const { exam_id, student_id } = req.params
  const { token } = req.query
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token as string)
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  } else {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).send('<h2>Unauthorized</h2>')
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  }
  const { data: student } = await supabase
    .from('students')
    .select('*, classes(name), sections(name), schools(name, city, affiliation_board, phone), academic_years(name)')
    .eq('id', student_id)
    .single()
  if (!student) return res.status(404).send('<h2>Student not found</h2>')
  const { data: exam } = await supabase.from('exams').select('*, academic_years(name)').eq('id', exam_id).single()
  if (!exam) return res.status(404).send('<h2>Exam not found</h2>')
  const { data: subjects } = await supabase.from('exam_subjects').select('*').eq('exam_id', exam_id).eq('class_id', student.class_id).order('exam_date')
  const school = student.schools as any
  const subjectRows = (subjects ?? []).map((s: any) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:500;">${s.subject_name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.exam_date ? new Date(s.exam_date).toLocaleDateString('en-IN') : '-'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.start_time ?? '-'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.max_marks}</td>
    </tr>`).join('')
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html><html><head><title>Admit Card</title>
  <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;margin:0;background:#f9fafb}
  .card{max-width:720px;margin:20px auto;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden;border:2px solid #4F46E5}
  .header{background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;padding:20px 28px}
  .body{padding:24px 28px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
  .field{background:#f9fafb;padding:10px 14px;border-radius:8px}
  .fl{font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:600}
  .fv{font-size:14px;font-weight:700;color:#111;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f3f4f6;padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase}
  .inst{background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px;font-size:12px;color:#92400e}
  .footer{display:flex;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid #e5e7eb}
  .sig{border-top:1px solid #000;width:160px;text-align:center;padding-top:6px;font-size:12px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Print</button>
  <div class="card">
    <div class="header">
      <div style="font-size:20px;font-weight:bold;">${school?.name ?? 'School'}</div>
      <div style="font-size:12px;opacity:0.85;margin-top:2px;">${school?.city ?? ''} · ${school?.affiliation_board ?? 'CBSE'}</div>
      <div style="font-size:16px;font-weight:700;margin-top:10px;letter-spacing:1px;">ADMIT CARD</div>
      <div style="font-size:13px;opacity:0.9;">${exam?.name} · ${(exam?.academic_years as any)?.name ?? ''}</div>
    </div>
    <div class="body">
      <div class="grid">
        <div class="field"><div class="fl">Student Name</div><div class="fv">${student.first_name} ${student.last_name}</div></div>
        <div class="field"><div class="fl">Admission No.</div><div class="fv">${student.admission_number ?? '-'}</div></div>
        <div class="field"><div class="fl">Class</div><div class="fv">${(student.classes as any)?.name ?? '-'}</div></div>
        <div class="field"><div class="fl">Roll Number</div><div class="fv">${student.roll_number ?? '-'}</div></div>
      </div>
      ${(subjects ?? []).length === 0
        ? '<p style="color:#6b7280;font-size:13px;padding:16px 0;">No subjects scheduled for this class.</p>'
        : `<table><thead><tr><th>Subject</th><th style="text-align:center;">Date</th><th style="text-align:center;">Time</th><th style="text-align:center;">Max Marks</th></tr></thead><tbody>${subjectRows}</tbody></table>`
      }
      <div class="inst">
        <strong style="display:block;margin-bottom:6px;">Instructions:</strong>
        <ul style="margin:0;padding-left:16px;">
          <li>Bring this admit card to every examination.</li>
          <li>Report 15 minutes before exam start time.</li>
          <li>Mobile phones are not allowed in the exam hall.</li>
        </ul>
      </div>
      <div class="footer">
        <div><div class="sig">Student Signature</div></div>
        <div><div class="sig">Principal</div></div>
      </div>
    </div>
  </div></body></html>`)
}))

router.get('/admit-cards/bulk/:exam_id', asyncHandler(async (req: Request, res: Response) => {
  const { exam_id } = req.params
  const { token, class_id } = req.query
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token as string)
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  } else {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).send('<h2>Unauthorized</h2>')
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    if (!user) return res.status(401).send('<h2>Unauthorized</h2>')
  }
  const { data: exam } = await supabase.from('exams').select('*, academic_years(name)').eq('id', exam_id).single()
  if (!exam) return res.status(404).send('<h2>Exam not found</h2>')
  let studentsQuery = supabase
    .from('students')
    .select('*, classes(name), sections(name), schools(name, city, affiliation_board, phone)')
    .eq('status', 'active')
  if (class_id) studentsQuery = studentsQuery.eq('class_id', class_id as string)
  const { data: students } = await studentsQuery.order('roll_number')
  if (!students?.length) return res.status(404).send('<h2>No students found</h2>')
  const { data: subjects } = await supabase.from('exam_subjects').select('*').eq('exam_id', exam_id).order('exam_date')
  const school = (students[0].schools as any) ?? {}
  const cards = students.map((student: any) => {
    const classSubjects = (subjects ?? []).filter((s: any) => s.class_id === student.class_id)
    const rows = classSubjects.map((s: any) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${s.subject_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;">${s.exam_date ? new Date(s.exam_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '-'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;">${s.start_time ?? '-'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;">${s.max_marks}</td>
      </tr>`).join('')
    return `<div style="max-width:680px;margin:20px auto;background:white;border:2px solid #4F46E5;border-radius:10px;overflow:hidden;font-family:Arial,sans-serif;">
      <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-size:15px;font-weight:bold;">${school?.name ?? 'School'}</div>
        <div style="font-size:11px;opacity:0.85;">${exam?.name} · ${(exam?.academic_years as any)?.name ?? ''}</div></div>
        <div style="font-size:13px;font-weight:700;letter-spacing:1px;">ADMIT CARD</div>
      </div>
      <div style="padding:16px 20px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
          <div style="background:#f9fafb;padding:8px;border-radius:6px;"><div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Name</div><div style="font-size:13px;font-weight:700;">${student.first_name} ${student.last_name}</div></div>
          <div style="background:#f9fafb;padding:8px;border-radius:6px;"><div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Class</div><div style="font-size:13px;font-weight:700;">${(student.classes as any)?.name ?? '-'}</div></div>
          <div style="background:#f9fafb;padding:8px;border-radius:6px;"><div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Roll No.</div><div style="font-size:13px;font-weight:700;">${student.roll_number ?? '-'}</div></div>
          <div style="background:#f9fafb;padding:8px;border-radius:6px;"><div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Adm. No.</div><div style="font-size:13px;font-weight:700;">${student.admission_number ?? '-'}</div></div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f3f4f6;">
            <th style="padding:6px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;">Subject</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;color:#6b7280;text-transform:uppercase;">Date</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;color:#6b7280;text-transform:uppercase;">Time</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;color:#6b7280;text-transform:uppercase;">Max Marks</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="padding:10px;text-align:center;color:#9ca3af;font-size:12px;">No subjects scheduled</td></tr>'}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;">
          <div style="text-align:center;"><div style="border-top:1px solid #000;width:120px;padding-top:4px;font-size:11px;">Student Signature</div></div>
          <div style="text-align:center;"><div style="border-top:1px solid #000;width:120px;padding-top:4px;font-size:11px;">Principal</div></div>
        </div>
      </div>
    </div>`
  }).join('<div style="page-break-after:always"></div>')
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html><html><head><title>Admit Cards - ${exam?.name}</title>
  <style>@media print{.no-print{display:none}}body{background:#f9fafb;margin:0}</style>
  </head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:12px 24px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:bold;z-index:999;">
    Print All ${students.length} Admit Cards
  </button>
  ${cards}</body></html>`)
}))

// ── AUTH WALL ─────────────────────────────────────────────────
router.use(authenticate)

// ── AUTHENTICATED ROUTES ──────────────────────────────────────

router.get('/id-card/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id } = req.params
  const { data: student } = await supabase
    .from('students')
    .select('*, classes(name), sections(name), houses(name, color), schools(name, city, phone, logo_url), academic_years(name)')
    .eq('id', student_id)
    .eq('school_id', req.user!.school_id)
    .single()
  if (!student) return res.status(404).json({ success: false, error: 'Student not found' })
  const { data: parent } = await supabase.from('parents').select('father_name, father_phone').eq('student_id', student_id).single()
  res.setHeader('Content-Type', 'text/html')
  res.send(idCardPage(student, parent))
}))

router.get('/id-cards/bulk', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { class_id, section_id } = req.query
  let query = supabase
    .from('students')
    .select('*, classes(name), sections(name), houses(name, color), schools(name, city, phone), academic_years(name)')
    .eq('school_id', req.user!.school_id)
    .eq('status', 'active')
  if (class_id) query = query.eq('class_id', class_id as string)
  if (section_id) query = query.eq('section_id', section_id as string)
  const { data: students } = await query.order('roll_number')
  if (!students?.length) return res.status(404).json({ success: false, error: 'No students found' })
  const cards = students.map(s => generateIDCard(s, null)).join('<div style="page-break-after:always"></div>')
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html><html><head><title>ID Cards</title>
    <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;margin:0;background:#f5f5f5}</style>
    </head><body>
    <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:12px 24px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;font-weight:bold;">
      Print All ${students.length} Cards
    </button>
    ${cards}</body></html>`)
}))

router.get('/tc/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id } = req.params
  const { data: tc } = await supabase
    .from('transfer_certificates')
    .select('*, students(*, classes(name), schools(name, city, affiliation_board, affiliation_no, phone))')
    .eq('student_id', student_id)
    .eq('school_id', req.user!.school_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (!tc) return res.status(404).json({ success: false, error: 'No TC found' })
  res.setHeader('Content-Type', 'text/html')
  res.send(generateTC(tc))
}))

router.get('/report-card/:exam_id/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exam_id, student_id } = req.params
  const { data: rc } = await supabase
    .from('report_cards')
    .select('*, students(*, classes(name), sections(name), houses(name), schools(name, affiliation_board, city, phone, logo_url)), exams(name, exam_type)')
    .eq('exam_id', exam_id)
    .eq('student_id', student_id)
    .single()
  if (!rc) return res.status(404).json({ success: false, error: 'Report card not found' })
  const { data: marks } = await supabase
    .from('student_marks')
    .select('*, exam_subjects(subject_name, max_marks, pass_marks, exam_date)')
    .eq('exam_id', exam_id)
    .eq('student_id', student_id)
  res.setHeader('Content-Type', 'text/html')
  res.send(generateReportCard(rc, marks ?? []))
}))

router.get('/certificate-templates', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('certificate_templates')
    .select('*')
    .eq('school_id', req.user!.school_id)
    .eq('is_active', true)
    .order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/certificate-templates', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name, certificate_type, content } = req.body
    if (!name || !certificate_type || !content)
      return res.status(400).json({ success: false, error: 'name, certificate_type and content required' })
    const { data, error } = await supabase
      .from('certificate_templates')
      .insert({ name, certificate_type, content, school_id: req.user!.school_id, created_by: req.user!.id })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data })
  })
)

router.get('/issued-certificates', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id } = req.query
  let query = supabase
    .from('issued_certificates')
    .select('*, students(first_name, last_name, admission_number, classes(name)), certificate_templates(name), users:issued_by(full_name)')
    .eq('school_id', req.user!.school_id)
    .order('created_at', { ascending: false })
  if (student_id) query = query.eq('student_id', student_id as string)
  const { data, error } = await query
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/issue-certificate', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { student_id, template_id, extra_data } = req.body
    const school_id = req.user!.school_id
    const { data: student } = await supabase.from('students').select('*, classes(name), schools(name, city, affiliation_board, phone)').eq('id', student_id).single()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })
    const { data: template } = await supabase.from('certificate_templates').select('*').eq('id', template_id).single()
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' })
    const { count } = await supabase.from('issued_certificates').select('*', { count: 'exact', head: true }).eq('school_id', school_id)
    const certNumber = `CERT${new Date().getFullYear()}${String((count ?? 0) + 1).padStart(4, '0')}`
    const { data: cert, error } = await supabase
      .from('issued_certificates')
      .insert({ school_id, student_id, template_id, certificate_type: template.certificate_type, certificate_number: certNumber, issued_data: { ...extra_data, student, template }, issued_by: req.user!.id, qr_code_data: `http://localhost:3000/verify/certificate/${certNumber}` })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data: { ...cert, certificate_number: certNumber } })
  })
)

// ── HTML GENERATORS ───────────────────────────────────────────

function idCardPage(student: any, parent: any): string {
  return `<!DOCTYPE html><html><head><title>ID Card</title>
  <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}</style>
  </head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  ${generateIDCard(student, parent)}</body></html>`
}

function generateIDCard(student: any, parent: any): string {
  const school = student.schools ?? {}
  const houseColor = student.houses?.color ?? '#4F46E5'
  return `<div style="width:340px;min-height:200px;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.15);margin:20px;display:inline-block;font-family:Arial,sans-serif;border:2px solid ${houseColor};background:white;vertical-align:top;">
    <div style="background:${houseColor};color:white;padding:12px 16px;text-align:center;">
      <div style="font-size:14px;font-weight:bold;">${school.name ?? 'School'}</div>
      <div style="font-size:10px;opacity:0.9;">${school.city ?? ''}</div>
    </div>
    <div style="padding:12px 16px;display:flex;gap:12px;align-items:flex-start;">
      <div style="width:64px;height:80px;background:#e5e7eb;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;color:#6b7280;">
        ${student.first_name?.[0] ?? ''}${student.last_name?.[0] ?? ''}
      </div>
      <div style="flex:1;font-size:12px;">
        <div style="font-size:15px;font-weight:bold;color:#111;margin-bottom:6px;">${student.first_name} ${student.last_name}</div>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="color:#6b7280;padding:1px 0;">Class:</td><td style="color:#111;padding:1px 0 1px 6px;font-weight:500;">${student.classes?.name ?? '-'}${student.sections?.name ? ' - ' + student.sections.name : ''}</td></tr>
          <tr><td style="color:#6b7280;padding:1px 0;">Adm. No:</td><td style="color:#111;padding:1px 0 1px 6px;font-weight:500;">${student.admission_number ?? '-'}</td></tr>
          <tr><td style="color:#6b7280;padding:1px 0;">Roll No:</td><td style="color:#111;padding:1px 0 1px 6px;font-weight:500;">${student.roll_number ?? '-'}</td></tr>
          <tr><td style="color:#6b7280;padding:1px 0;">House:</td><td style="color:#111;padding:1px 0 1px 6px;font-weight:500;">${student.houses?.name ?? '-'}</td></tr>
          ${parent?.father_phone ? `<tr><td style="color:#6b7280;padding:1px 0;">Contact:</td><td style="color:#111;padding:1px 0 1px 6px;font-weight:500;">${parent.father_phone}</td></tr>` : ''}
        </table>
      </div>
    </div>
    <div style="background:#f9fafb;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e5e7eb;">
      <div style="font-size:9px;color:#6b7280;">AIRTEC School ERP</div>
      <div style="font-size:10px;font-weight:bold;color:${houseColor};">${student.academic_years?.name ?? '2024-25'}</div>
    </div>
  </div>`
}

function generateTC(tc: any): string {
  const student = tc.students ?? {}
  const school = student.schools ?? {}
  const issueDate = new Date(tc.issue_date).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
  return `<!DOCTYPE html><html><head><title>Transfer Certificate</title>
  <style>@media print{.no-print{display:none}}body{font-family:'Times New Roman',serif;margin:0;background:#fff;color:#000}
  .container{max-width:750px;margin:0 auto;padding:40px;border:3px double #000;min-height:90vh}
  h1{text-align:center;font-size:28px;margin:0 0 4px;letter-spacing:2px}
  .subtitle{text-align:center;font-size:13px;margin-bottom:20px}
  .tc-title{text-align:center;font-size:20px;font-weight:bold;margin:20px 0;text-decoration:underline}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  td{padding:6px 4px;font-size:14px;vertical-align:top}
  td:first-child{width:200px;font-weight:bold}
  .dotted{border-bottom:1px dotted #000;min-width:200px;display:inline-block}
  .footer{margin-top:60px;display:flex;justify-content:space-between}
  .sig{border-top:1px solid #000;width:180px;text-align:center;padding-top:6px;font-size:12px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print TC</button>
  <div class="container">
    <h1>${school.name ?? 'School'}</h1>
    <div class="subtitle">${school.city ?? ''} · ${school.affiliation_board ?? 'CBSE'} · No. ${school.affiliation_no ?? '-'}</div>
    <div class="tc-title">TRANSFER CERTIFICATE</div>
    <table>
      <tr><td>TC Number</td><td>: <span class="dotted">${tc.tc_number}</span></td></tr>
      <tr><td>Date of Issue</td><td>: <span class="dotted">${issueDate}</span></td></tr>
      <tr><td>Student Name</td><td>: <span class="dotted">${student.first_name ?? ''} ${student.last_name ?? ''}</span></td></tr>
      <tr><td>Admission No.</td><td>: <span class="dotted">${student.admission_number ?? '-'}</span></td></tr>
      <tr><td>Class Last Studied</td><td>: <span class="dotted">${student.classes?.name ?? '-'}</span></td></tr>
      <tr><td>Conduct</td><td>: <span class="dotted">${tc.conduct ?? 'Good'}</span></td></tr>
      <tr><td>Dues Cleared</td><td>: <span class="dotted">${tc.dues_cleared ? 'Yes' : 'No'}</span></td></tr>
    </table>
    <div class="footer"><div class="sig">Class Teacher</div><div class="sig">Principal</div></div>
  </div></body></html>`
}

function generateReportCard(rc: any, marks: any[]): string {
  const student = rc.students ?? {}
  const school = student.schools ?? {}
  const exam = rc.exams ?? {}
  const gradeColor = (g: string) => ['A+','A'].includes(g) ? '#16a34a' : ['B+','B'].includes(g) ? '#2563eb' : g === 'C' ? '#d97706' : '#dc2626'
  const marksRows = marks.map(m => {
    const sub = m.exam_subjects ?? {}
    const pct = sub.max_marks ? Math.round((m.marks_obtained / sub.max_marks) * 100) : 0
    return `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 12px;">${sub.subject_name ?? '-'}</td>
      <td style="padding:8px 12px;text-align:center;">${sub.max_marks ?? '-'}</td>
      <td style="padding:8px 12px;text-align:center;color:${m.is_absent ? '#dc2626' : '#111'};">${m.is_absent ? 'ABSENT' : (m.marks_obtained ?? '-')}</td>
      <td style="padding:8px 12px;text-align:center;">${m.is_absent ? '-' : pct + '%'}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:bold;color:${gradeColor(m.grade ?? 'F')};">${m.grade ?? 'F'}</td>
    </tr>`
  }).join('')
  return `<!DOCTYPE html><html><head><title>Report Card</title>
  <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;margin:0;background:#f9fafb}
  .card{max-width:720px;margin:20px auto;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden}
  .header{background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;padding:24px 32px}
  .body{padding:24px 32px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
  .info-item{background:#f9fafb;padding:10px 14px;border-radius:8px}
  .info-label{font-size:11px;color:#6b7280;text-transform:uppercase}
  .info-value{font-size:14px;font-weight:600;color:#111;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{background:#f3f4f6;padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#f9fafb;padding:20px;border-radius:10px;margin-bottom:24px;text-align:center}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  <div class="card">
    <div class="header">
      <div style="font-size:20px;font-weight:bold;">${school.name ?? 'School'}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:2px;">${school.city ?? ''} · ${school.affiliation_board ?? 'CBSE'}</div>
      <div style="font-size:16px;font-weight:600;margin-top:12px;">REPORT CARD - ${exam.name ?? 'Examination'}</div>
    </div>
    <div class="body">
      <div class="info-grid">
        <div class="info-item"><div class="info-label">Student Name</div><div class="info-value">${student.first_name} ${student.last_name}</div></div>
        <div class="info-item"><div class="info-label">Admission No.</div><div class="info-value">${student.admission_number ?? '-'}</div></div>
        <div class="info-item"><div class="info-label">Class</div><div class="info-value">${student.classes?.name ?? '-'}</div></div>
        <div class="info-item"><div class="info-label">Roll Number</div><div class="info-value">${student.roll_number ?? '-'}</div></div>
      </div>
      <div class="summary">
        <div><div style="font-size:22px;font-weight:bold;color:#4F46E5;">${rc.obtained_marks ?? 0}/${rc.total_marks ?? 0}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Marks</div></div>
        <div><div style="font-size:22px;font-weight:bold;color:#7C3AED;">${rc.percentage ?? 0}%</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Percentage</div></div>
        <div><div style="font-size:22px;font-weight:bold;color:${gradeColor(rc.grade ?? 'F')};">${rc.grade ?? '-'}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Grade</div></div>
        <div><div style="font-size:22px;font-weight:bold;color:${rc.is_pass ? '#16a34a' : '#dc2626'};">${rc.is_pass ? 'Pass' : 'Fail'}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Result</div></div>
      </div>
      <table>
        <thead><tr><th>Subject</th><th style="text-align:center;">Max</th><th style="text-align:center;">Obtained</th><th style="text-align:center;">%</th><th style="text-align:center;">Grade</th></tr></thead>
        <tbody>${marksRows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:40px;">
        <div style="text-align:center;"><div style="border-top:1px solid #000;width:160px;padding-top:6px;font-size:12px;">Class Teacher</div></div>
        <div style="text-align:center;"><div style="border-top:1px solid #000;width:160px;padding-top:6px;font-size:12px;">Principal</div></div>
      </div>
    </div>
  </div></body></html>`
}

function verifyPageHTML(valid: boolean, tcNumber: string, tc: any): string {
  return `<!DOCTYPE html><html><head><title>TC Verification</title>
  <style>body{font-family:Arial,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:white;border-radius:16px;padding:40px;max-width:480px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px}.row:last-child{border:none}</style>
  </head><body><div class="box">
    <div style="font-size:64px;margin-bottom:16px;">${valid ? '✅' : '❌'}</div>
    <h2 style="margin:0 0 8px;color:${valid ? '#16a34a' : '#dc2626'}">${valid ? 'Valid Transfer Certificate' : 'Invalid TC Number'}</h2>
    <p style="color:#6b7280;margin:0;">TC Number: <strong>${tcNumber}</strong></p>
    ${valid && tc ? `<div style="background:#f9fafb;border-radius:10px;padding:16px;margin-top:24px;text-align:left;">
      <div class="row"><span style="color:#6b7280;">Student</span><span style="font-weight:600;">${tc.students?.first_name} ${tc.students?.last_name}</span></div>
      <div class="row"><span style="color:#6b7280;">School</span><span style="font-weight:600;">${tc.schools?.name ?? '-'}</span></div>
      <div class="row"><span style="color:#6b7280;">Status</span><span style="font-weight:600;color:${tc.is_revoked ? '#dc2626' : '#16a34a'}">${tc.is_revoked ? 'REVOKED' : 'VALID'}</span></div>
    </div>` : '<p style="color:#6b7280;margin-top:16px;">This TC does not exist in our records.</p>'}
    <p style="font-size:11px;color:#9ca3af;margin-top:24px;">Powered by AIRTEC School ERP</p>
  </div></body></html>`
}

export default router