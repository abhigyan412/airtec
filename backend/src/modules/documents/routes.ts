import { Router, Response, Request } from 'express'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { authenticateFlexible, AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2, getPermissionsForUser } from '../../shared/middleware/permissions-v2'
import { asyncHandler, NON_STAFF_ROLES, resolveOwnStudentId } from '../../shared/utils/helpers'
import { getTeacherContext } from '../../shared/utils/teacherContext'

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

// ── AUTH WALL — everything below requires a valid session, via either
// the Authorization header (normal API calls) or ?token= (plain links
// opened in a new tab, since those can't carry a custom header).
router.use(authenticateFlexible)

router.get('/certificate/:cert_number', requirePermissionV2('certificate.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { cert_number } = req.params
  const { data: cert } = await supabase
    .from('issued_certificates')
    .select('*, students(*, classes(name), schools(name, city, affiliation_board, phone, logo_url)), certificate_templates(name, content), users:issued_by(full_name)')
    .eq('certificate_number', cert_number)
    .eq('school_id', req.user!.school_id)
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

router.get('/admit-card/:exam_id/:student_id', requirePermissionV2('exam.admit_card_generate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exam_id, student_id } = req.params
  const { data: student } = await supabase
    .from('students')
    .select('*, classes(name), sections(name), schools(name, city, affiliation_board, phone), academic_years(name)')
    .eq('id', student_id)
    .eq('school_id', req.user!.school_id)
    .single()
  if (!student) return res.status(404).send('<h2>Student not found</h2>')
  const { data: exam } = await supabase.from('exams').select('*, academic_years(name)').eq('id', exam_id).eq('school_id', req.user!.school_id).single()
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

router.get('/admit-cards/bulk/:exam_id', requirePermissionV2('exam.admit_card_generate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exam_id } = req.params
  const { class_id } = req.query
  const { data: exam } = await supabase.from('exams').select('*, academic_years(name)').eq('id', exam_id).eq('school_id', req.user!.school_id).single()
  if (!exam) return res.status(404).send('<h2>Exam not found</h2>')
  let studentsQuery = supabase
    .from('students')
    .select('*, classes(name), sections(name), schools(name, city, affiliation_board, phone)')
    .eq('school_id', req.user!.school_id)
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

router.get('/id-card/:student_id', requirePermissionV2('student.generate_id'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/id-cards/bulk', requirePermissionV2('student.generate_id'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/tc/:student_id', requirePermissionV2('tc.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

// GET /relieving-letter/:exit_id — plain HTML, same rendering approach
// as TC/certificate above. No document-number sequencing: unlike TCs
// and certificates, a relieving letter has no uniqueness constraint
// anywhere else in the app that would need one.
router.get('/relieving-letter/:exit_id', requirePermissionV2('staff.exit_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exit_id } = req.params
  const school_id = req.user!.school_id

  const { data: exit } = await supabase
    .from('staff_exits')
    .select('*, users:user_id(full_name), schools:school_id(name, city, affiliation_board, phone)')
    .eq('id', exit_id)
    .eq('school_id', school_id)
    .single()
  if (!exit || exit.status !== 'settled') return res.status(404).send('<h2>Relieving letter not available — settlement must be complete first.</h2>')

  const { data: profile } = await supabase.from('staff_profiles').select('designation, department, date_of_joining').eq('user_id', exit.user_id).eq('school_id', school_id).maybeSingle()

  res.setHeader('Content-Type', 'text/html')
  res.send(generateRelievingLetter(exit, profile))
}))

// GET /offer-letter/:application_id — same rendering approach as the
// relieving letter above. Only generatable once the offer has actually
// been approved (status offer_sent or joined), same "gate on real
// state" reasoning as the relieving letter requiring 'settled'.
router.get('/offer-letter/:application_id', requirePermissionV2('staff.recruitment_manage'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { application_id } = req.params
  const school_id = req.user!.school_id

  const { data: application } = await supabase
    .from('job_applications')
    .select('*, job_postings(title, department, designation, salary_range), schools:school_id(name, city, affiliation_board, phone)')
    .eq('id', application_id)
    .eq('school_id', school_id)
    .single()

  if (!application || !['offer_sent', 'joined'].includes(application.status)) {
    return res.status(404).send('<h2>Offer letter not available — the offer must be approved and sent first.</h2>')
  }

  res.setHeader('Content-Type', 'text/html')
  res.send(generateOfferLetter(application, application.schools))
}))

// GET /admission-offer-letter/:application_id — distinct path from the HR
// offer letter above (same "offer letter" concept, different table —
// application_id here means admission_applications, not job_applications).
// Only renders once POST /api/admission/applications/:id/issue-offer-letter
// has actually stamped a number.
router.get('/admission-offer-letter/:application_id', requirePermissionV2('admission.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { application_id } = req.params
  const school_id = req.user!.school_id

  const { data: application } = await supabase
    .from('admission_applications')
    .select('*, classes:applying_for_class_id(name), schools:school_id(name, city, affiliation_board, phone)')
    .eq('id', application_id)
    .eq('school_id', school_id)
    .single()

  if (!application || !application.offer_letter_number) {
    return res.status(404).send('<h2>Offer letter not available — it must be issued first.</h2>')
  }

  res.setHeader('Content-Type', 'text/html')
  res.send(generateAdmissionOfferLetter(application, application.schools, application.classes))
}))

// GET /payslip/:id — printable payslip. Self-or-staff.payroll_view, same
// pattern as GET /hrms/payslips/:id itself (a staff member can always
// print their own; anyone else needs the payroll-view permission).
router.get('/payslip/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  const { data: payslip } = await supabase
    .from('payslips')
    .select('*, users:user_id(full_name), schools:school_id(name, city, affiliation_board, phone)')
    .eq('id', id).eq('school_id', school_id).single()
  if (!payslip) return res.status(404).send('<h2>Payslip not found</h2>')

  if (payslip.user_id !== req.user!.id) {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('staff.payroll_view')) {
      return res.status(403).send('<h2>Missing permission: staff.payroll_view</h2>')
    }
  }

  const { data: profile } = await supabase.from('staff_profiles').select('designation, department').eq('user_id', payslip.user_id).eq('school_id', school_id).maybeSingle()

  res.setHeader('Content-Type', 'text/html')
  res.send(generatePayslip(payslip, profile))
}))

// Staff callers need exam.view; parents/students keep the existing
// self-access branch below (own child, published results only) rather
// than being gated on a staff-oriented permission code.
router.get('/report-card/:exam_id/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exam_id } = req.params
  let { student_id } = req.params
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const { data: exam } = await supabase.from('exams').select('status').eq('id', exam_id).eq('school_id', school_id).single()
    if (!exam || exam.status !== 'result_published') {
      return res.status(404).send('<h2>Results have not been published yet</h2>')
    }
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId) return res.status(404).send('<h2>Report card not found</h2>')
    student_id = ownStudentId
  } else {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('exam.view')) {
      return res.status(403).send('<h2>Missing permission: exam.view</h2>')
    }
  }

  const { data: rc } = await supabase
    .from('report_cards')
    .select('*, students(*, classes(name), sections(name), houses(name), schools(name, affiliation_board, city, phone, logo_url)), exams(name, exam_type)')
    .eq('exam_id', exam_id)
    .eq('student_id', student_id)
    .eq('school_id', school_id)
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

// GET /student-profile/:student_id — a printable summary of everything
// already shown on the student's profile page (personal info, academic
// details, parent/guardian, fee summary), so a school can hand someone a
// single document instead of them screenshotting the screen. Same access
// rule as GET /students/:id itself (sis/routes.ts) — a parent/student can
// only export their own child, a subject-only Teacher only a student in a
// section they actually teach — deliberately duplicated here rather than
// gated on student.view alone, since that permission is also held by the
// Parent/Student RBAC roles and a flat permission check would let either
// export any student by id, the exact hole GET /students/:id itself was
// fixed for.
router.get('/student-profile/:student_id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { student_id } = req.params
  const school_id = req.user!.school_id

  if (NON_STAFF_ROLES.includes(req.user!.role)) {
    const ownStudentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
    if (!ownStudentId || ownStudentId !== student_id) {
      return res.status(403).send('<h2>You can only export your own student record</h2>')
    }
  } else {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, school_id)
    if (!isSuperRole && !permissionCodes.has('student.view')) {
      return res.status(403).send('<h2>Missing permission: student.view</h2>')
    }
  }

  const { data: student } = await supabase
    .from('students')
    .select('*, classes(name, stream), sections(name), houses(name, color), academic_years(name), schools(name, city, phone, logo_url), parents(*)')
    .eq('id', student_id).eq('school_id', school_id).single()
  if (!student) return res.status(404).send('<h2>Student not found</h2>')

  if (req.user!.role === 'teacher') {
    const ctx = await getTeacherContext(req.user!.id, school_id)
    if (!ctx.sectionIds.includes((student as any).section_id)) {
      return res.status(403).send('<h2>You can only export students in a section you teach</h2>')
    }
  }

  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase.from('fee_invoices').select('total_amount').eq('student_id', student_id),
    supabase.from('fee_payments').select('amount_paid').eq('student_id', student_id),
  ])
  const total_billed = invoices?.reduce((s, i) => s + Number(i.total_amount), 0) ?? 0
  const total_paid = payments?.reduce((s, p) => s + Number(p.amount_paid), 0) ?? 0
  const total_due = total_billed - total_paid

  res.setHeader('Content-Type', 'text/html')
  res.send(studentProfilePage(student, { total_billed, total_paid, total_due }))
}))

router.get('/certificate-templates', requirePermissionV2('certificate.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('certificate_templates')
    .select('*')
    .eq('school_id', req.user!.school_id)
    .eq('is_active', true)
    .order('created_at')
  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

router.post('/certificate-templates', requirePermissionV2('certificate.template_manage'),
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

router.get('/issued-certificates', requirePermissionV2('certificate.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/issue-certificate', requirePermissionV2('certificate.generate'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { student_id, template_id, extra_data } = req.body
    const school_id = req.user!.school_id
    const { data: student } = await supabase.from('students').select('*, classes(name), schools(name, city, affiliation_board, phone)').eq('id', student_id).single()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })
    const { data: template } = await supabase.from('certificate_templates').select('*').eq('id', template_id).single()
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' })
    const certNumber = await nextDocumentNumber(school_id, 'CERT')
    const { data: cert, error } = await supabase
      .from('issued_certificates')
      .insert({ school_id, student_id, template_id, certificate_type: template.certificate_type, certificate_number: certNumber, issued_data: { ...extra_data, student, template }, issued_by: req.user!.id, qr_code_data: `http://localhost:3000/verify/certificate/${certNumber}` })
      .select().single()
    if (error) return res.status(400).json({ success: false, error: error.message })
    res.status(201).json({ success: true, data: { ...cert, certificate_number: certNumber } })
  })
)

// ── HTML GENERATORS ───────────────────────────────────────────

function studentProfilePage(student: any, feeSummary: { total_billed: number; total_paid: number; total_due: number }): string {
  const school = student.schools ?? {}
  const parent = student.parents?.[0]
  const fmt = (d: string | null) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
  const money = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`
  const row = (label: string, value: string) =>
    `<tr><td style="color:#6b7280;padding:6px 12px 6px 0;font-size:13px;white-space:nowrap;">${label}</td><td style="color:#111;padding:6px 0;font-size:13px;font-weight:500;">${value || '—'}</td></tr>`
  const section = (title: string, rows: string) => `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#4F46E5;border-bottom:2px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px;">${title}</div>
      <table style="border-collapse:collapse;width:100%;">${rows}</table>
    </div>`

  const address = [student.permanent_address, student.city, student.state, student.pincode].filter(Boolean).join(', ') || '—'

  const guardianRows = parent
    ? [
        parent.father_name ? row('Father', `${parent.father_name}${parent.father_phone ? ` · ${parent.father_phone}` : ''}${parent.father_email ? ` · ${parent.father_email}` : ''}`) : '',
        parent.mother_name ? row('Mother', `${parent.mother_name}${parent.mother_phone ? ` · ${parent.mother_phone}` : ''}${parent.mother_email ? ` · ${parent.mother_email}` : ''}`) : '',
      ].join('')
    : ''

  return `<!DOCTYPE html><html><head><title>${student.first_name} ${student.last_name} — Profile</title>
  <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;color:#111;}
  .container{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:32px;}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #4F46E5;padding-bottom:16px;margin-bottom:24px;}
  </style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print / Save as PDF</button>
  <div class="container">
    <div class="header">
      <div>
        <div style="font-size:12px;color:#6b7280;">${school.name ?? 'School'}${school.city ? ` · ${school.city}` : ''}</div>
        <div style="font-size:22px;font-weight:bold;margin-top:2px;">${student.first_name} ${student.last_name}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px;">
          ${student.classes?.name ?? '—'}${student.sections?.name ? ` · ${student.sections.name}` : ''} · #${student.admission_number ?? '—'}
          · <span style="text-transform:capitalize;">${student.status}</span>
        </div>
      </div>
      ${student.houses ? `<div style="font-size:11px;font-weight:bold;color:#fff;background:${student.houses.color ?? '#4F46E5'};padding:4px 10px;border-radius:100px;">${student.houses.name}</div>` : ''}
    </div>

    ${section('Personal Information', [
      row('Date of Birth', fmt(student.date_of_birth)),
      row('Gender', student.gender ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1) : '—'),
      row('Blood Group', student.blood_group),
      row('Aadhaar', student.aadhaar_number),
      row('Email', student.email),
      row('Phone', student.phone),
      row('Address', address),
    ].join(''))}

    ${section('Academic Details', [
      row('Class', student.classes?.name),
      row('Section', student.sections?.name),
      row('Roll Number', student.roll_number),
      row('Stream', student.stream),
      row('Academic Year', student.academic_years?.name),
      row('Admission Date', fmt(student.admission_date)),
    ].join(''))}

    ${guardianRows ? section('Parent / Guardian', guardianRows) : ''}

    ${section('Fee Summary', [
      row('Total Billed', money(feeSummary.total_billed)),
      row('Collected', money(feeSummary.total_paid)),
      row('Due', money(feeSummary.total_due)),
    ].join(''))}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
      Exported ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} · AIRTEC School ERP
    </div>
  </div>
  </body></html>`
}

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

function generateRelievingLetter(exit: any, profile: any): string {
  const staffName = exit.users?.full_name ?? ''
  const school = exit.schools ?? {}
  const fmt = (d: string) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'
  return `<!DOCTYPE html><html><head><title>Relieving Letter</title>
  <style>@media print{.no-print{display:none}}body{font-family:'Times New Roman',serif;margin:0;background:#fff;color:#000}
  .container{max-width:750px;margin:0 auto;padding:40px;border:3px double #000;min-height:70vh}
  h1{text-align:center;font-size:26px;margin:0 0 4px;letter-spacing:2px}
  .subtitle{text-align:center;font-size:13px;margin-bottom:20px}
  .letter-title{text-align:center;font-size:18px;font-weight:bold;margin:20px 0;text-decoration:underline}
  p{font-size:14px;line-height:1.9;text-align:justify}
  .footer{margin-top:60px}
  .sig{border-top:1px solid #000;width:180px;text-align:center;padding-top:6px;font-size:12px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  <div class="container">
    <h1>${school.name ?? 'School'}</h1>
    <div class="subtitle">${school.city ?? ''} · ${school.affiliation_board ?? 'CBSE'}</div>
    <div class="letter-title">RELIEVING LETTER</div>
    <p>Date: ${fmt(exit.last_working_day)}</p>
    <p>This is to certify that <b>${staffName}</b>, who served as <b>${profile?.designation ?? 'a staff member'}</b>${profile?.department ? ` in the ${profile.department} department` : ''}${profile?.date_of_joining ? ` from ${fmt(profile.date_of_joining)}` : ''}, has been relieved of their duties effective <b>${fmt(exit.last_working_day)}</b>, following their resignation dated ${fmt(exit.resignation_date)}${exit.reason ? ` (${exit.reason})` : ''}.</p>
    <p>All dues have been settled and the exit clearance process has been completed. We wish them success in their future endeavors.</p>
    <div class="footer"><div class="sig">Principal</div></div>
  </div></body></html>`
}

function generateOfferLetter(application: any, school: any): string {
  const posting = application.job_postings ?? {}
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const designation = posting.designation || application.current_designation || 'the offered position'
  return `<!DOCTYPE html><html><head><title>Offer Letter</title>
  <style>@media print{.no-print{display:none}}body{font-family:'Times New Roman',serif;margin:0;background:#fff;color:#000}
  .container{max-width:750px;margin:0 auto;padding:40px;border:3px double #000;min-height:70vh}
  h1{text-align:center;font-size:26px;margin:0 0 4px;letter-spacing:2px}
  .subtitle{text-align:center;font-size:13px;margin-bottom:20px}
  .letter-title{text-align:center;font-size:18px;font-weight:bold;margin:20px 0;text-decoration:underline}
  p{font-size:14px;line-height:1.9;text-align:justify}
  .footer{margin-top:60px}
  .sig{border-top:1px solid #000;width:180px;text-align:center;padding-top:6px;font-size:12px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  <div class="container">
    <h1>${school?.name ?? 'School'}</h1>
    <div class="subtitle">${school?.city ?? ''} · ${school?.affiliation_board ?? 'CBSE'}</div>
    <div class="letter-title">OFFER OF EMPLOYMENT</div>
    <p>Date: ${fmt(application.updated_at)}</p>
    <p>Dear <b>${application.candidate_name}</b>,</p>
    <p>We are pleased to offer you the position of <b>${designation}</b>${posting.department ? ` in the ${posting.department} department` : ''} at ${school?.name ?? 'our school'}. This offer is extended on the basis of the interviews and assessments conducted as part of our selection process.</p>
    <p>${posting.salary_range || application.expected_salary
      ? `The compensation for this role is ${posting.salary_range || `₹${Number(application.expected_salary).toLocaleString('en-IN')}`}, subject to the terms of your employment contract.`
      : 'Compensation details will be shared separately as part of your employment contract.'}</p>
    <p>Please confirm your acceptance of this offer at the earliest so we can proceed with your onboarding${application.notice_period ? `, keeping in mind your notice period of ${application.notice_period}` : ''}.</p>
    <p>We look forward to welcoming you to our team.</p>
    <div class="footer"><div class="sig">Principal</div></div>
  </div></body></html>`
}

function generateAdmissionOfferLetter(application: any, school: any, cls: any): string {
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const studentName = `${application.student_first_name} ${application.student_last_name}`
  const guardianName = application.father_name || application.mother_name || 'Parent/Guardian'
  return `<!DOCTYPE html><html><head><title>Offer of Admission - ${application.offer_letter_number}</title>
  <style>@media print{.no-print{display:none}}body{font-family:'Times New Roman',serif;margin:0;background:#fff;color:#000}
  .container{max-width:750px;margin:0 auto;padding:40px;border:3px double #000;min-height:70vh;position:relative}
  h1{text-align:center;font-size:26px;margin:0 0 4px;letter-spacing:2px}
  .subtitle{text-align:center;font-size:13px;margin-bottom:20px}
  .letter-title{text-align:center;font-size:18px;font-weight:bold;margin:20px 0;text-decoration:underline}
  p{font-size:14px;line-height:1.9;text-align:justify}
  .footer{margin-top:60px}
  .sig{border-top:1px solid #000;width:180px;text-align:center;padding-top:6px;font-size:12px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  <div class="container">
    <div style="position:absolute;top:16px;right:20px;font-size:11px;color:#555">No: ${application.offer_letter_number}</div>
    <h1>${school?.name ?? 'School'}</h1>
    <div class="subtitle">${school?.city ?? ''} · ${school?.affiliation_board ?? 'CBSE'}</div>
    <div class="letter-title">OFFER OF ADMISSION</div>
    <p>Date: ${fmt(application.offer_letter_issued_at)}</p>
    <p>Dear <b>${guardianName}</b>,</p>
    <p>We are pleased to offer admission to <b>${studentName}</b> into <b>${cls?.name ?? 'the applied-for class'}</b> at ${school?.name ?? 'our school'}, on the basis of the application and admission process completed.</p>
    <p>${application.application_fee_paid
      ? 'The application fee has been received; further fee details for the academic session will be shared separately.'
      : 'Please complete any pending admission formalities, including fee payment, to confirm this seat.'}</p>
    <p>We warmly welcome ${studentName} to our school community and look forward to a rewarding academic journey together.</p>
    <div class="footer"><div class="sig">Principal</div></div>
  </div></body></html>`
}

const PAYSLIP_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function generatePayslip(p: any, profile: any): string {
  const staffName = p.users?.full_name ?? ''
  const school = p.schools ?? {}
  const fmt = (n: any) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`
  const earnings = [
    ['Basic Salary', p.basic_salary], ['HRA', p.hra], ['DA', p.da],
    ['Conveyance', p.conveyance_allowance], ['Medical Allowance', p.medical_allowance], ['Other Allowances', p.other_allowances],
  ].filter(([, v]) => Number(v) > 0)
  const deductions = [
    ['PF (Employee)', p.pf_deduction], ['Professional Tax', p.professional_tax], ['TDS', p.tds],
    ['Loss of Pay', p.lop_amount], ['Loan Recovery', p.loan_deduction], ['Other Deductions', p.other_deductions],
  ].filter(([, v]) => Number(v) > 0)
  const row = ([label, val]: [string, any]) => `<tr><td style="padding:6px 4px;">${label}</td><td style="padding:6px 4px;text-align:right;">${fmt(val)}</td></tr>`

  return `<!DOCTYPE html><html><head><title>Payslip - ${PAYSLIP_MONTHS[p.month - 1]} ${p.year}</title>
  <style>@media print{.no-print{display:none}}body{font-family:Arial,sans-serif;margin:0;background:#f9fafb}
  .card{max-width:640px;margin:20px auto;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden}
  .header{background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;padding:20px 28px}
  .body{padding:24px 28px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:6px 4px;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px}
  .net{background:#f9fafb;border-radius:10px;padding:16px;margin-top:20px;display:flex;justify-content:space-between;align-items:center}
  .lop-note{font-size:11px;color:#6b7280;margin-top:4px}</style></head><body>
  <button class="no-print" onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4F46E5;color:white;border:none;border-radius:8px;cursor:pointer;">Print</button>
  <div class="card">
    <div class="header">
      <div style="font-size:18px;font-weight:bold;">${school.name ?? 'School'}</div>
      <div style="font-size:12px;opacity:0.85;margin-top:2px;">${school.city ?? ''} · ${school.affiliation_board ?? 'CBSE'}</div>
      <div style="font-size:15px;font-weight:600;margin-top:10px;">Payslip — ${PAYSLIP_MONTHS[p.month - 1]} ${p.year}</div>
    </div>
    <div class="body">
      <p style="font-size:13px;color:#6b7280;margin:0 0 20px;"><b style="color:#111;">${staffName}</b>${profile?.designation ? ` · ${profile.designation}` : ''}${profile?.department ? ` · ${profile.department}` : ''}</p>
      <div class="cols">
        <table><thead><tr><th colspan="2">Earnings</th></tr></thead><tbody>${earnings.map(row).join('')}</tbody></table>
        <table><thead><tr><th colspan="2">Deductions</th></tr></thead><tbody>${deductions.map(row).join('')}</tbody></table>
      </div>
      ${Number(p.lop_days) > 0 ? `<p class="lop-note">Loss of Pay: ${p.lop_days} day(s)</p>` : ''}
      ${Number(p.pf_employer) > 0 ? `<p class="lop-note">Employer PF Contribution (informational, not deducted): ${fmt(p.pf_employer)}</p>` : ''}
      <div class="net">
        <div><div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Gross</div><div style="font-size:16px;font-weight:700;">${fmt(p.gross_salary)}</div></div>
        <div><div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Deductions</div><div style="font-size:16px;font-weight:700;color:#dc2626;">${fmt(p.total_deductions)}</div></div>
        <div><div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Net Pay</div><div style="font-size:20px;font-weight:800;color:#4F46E5;">${fmt(p.net_salary)}</div></div>
      </div>
    </div>
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