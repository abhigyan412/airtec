import 'dotenv/config'
import { supabase } from './shared/db/client'
import { assignDefaultUserRole } from './modules/rbac/seed'
import { defaultSectionNamesForClass } from './shared/utils/helpers'

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

/** Insert rows, log (but don't crash) on error, return inserted rows. */
async function ins(table: string, rows: any[]): Promise<any[]> {
  if (!rows.length) return []
  const { data, error } = await supabase.from(table).insert(rows).select()
  if (error) { console.error(`   ⚠️  ${table}: ${error.message}`); return [] }
  return data ?? []
}

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length]
const rint = (min: number, max: number, seed: number) => min + (seed * 9301 + 49297) % (max - min + 1)

const today = new Date()
const dMinus = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d }
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Last `n` working days (skips Sundays), most-recent-first. */
function workingDays(n: number): string[] {
  const out: string[] = []
  let back = 0
  while (out.length < n && back < n * 3) {
    const d = dMinus(back); back++
    if (d.getDay() !== 0) out.push(iso(d))
  }
  return out
}

// ── Image generation (no deps): initials avatars + a school logo,
//    uploaded to Supabase Storage so photo_url points at a real file. ──
const AVATAR_BG = ['#6366F1', '#EC4899', '#14B8A6', '#F59E0B', '#8B5CF6', '#EF4444', '#10B981', '#3B82F6', '#F97316', '#06B6D4']
function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}
function avatarSvg(name: string, i: number): string {
  const bg = pick(AVATAR_BG, i)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" fill="${bg}"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="96" font-weight="600" fill="#ffffff">${initials(name)}</text>
</svg>`
}
function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="96" fill="#1E3A8A"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="#FACC15" stroke-width="4"/>
  <text x="50%" y="44%" dy=".35em" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-weight="700" fill="#FACC15">DPS</text>
  <text x="50%" y="70%" text-anchor="middle" font-family="Segoe UI, Arial" font-size="16" letter-spacing="2" fill="#ffffff">LUCKNOW</text>
</svg>`
}
async function uploadSvg(bucket: string, path: string, svg: string): Promise<string | null> {
  const { error } = await supabase.storage.from(bucket).upload(path, Buffer.from(svg), {
    contentType: 'image/svg+xml', upsert: true,
  })
  if (error) { console.error(`   ⚠️  upload ${bucket}/${path}: ${error.message}`); return null }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

async function ensureBuckets() {
  for (const id of ['resources', 'student-photos', 'student-documents']) {
    const { error } = await supabase.storage.createBucket(id, { public: true })
    if (error && !/already exists/i.test(error.message)) console.error(`   ⚠️  bucket ${id}: ${error.message}`)
  }
}

// ─────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Starting AIRTEC demo seed...\n')

  // ── 0. Storage buckets (also recreated on every reset) ───
  console.log('0️⃣  Ensuring storage buckets...')
  await ensureBuckets()
  console.log('   ✅ Buckets ready (resources, student-photos, student-documents)\n')

  // ── 1. Create school (+ logo) ────────────────────────────
  console.log('1️⃣  Creating school...')
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .insert({
      name: 'Delhi Public School Lucknow',
      address: 'Sector B, Vrindavan Yojna, Raebareli Road',
      city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226025',
      phone: '+91 9876543210',
      email: 'admin@dpslucknow.com',
      website: 'https://dpslucknow.example.com',
      affiliation_board: 'CBSE',
      affiliation_no: '2730045',
      established_year: 1998,
    })
    .select().single()
  if (schoolErr) { console.error('School error:', schoolErr.message); process.exit(1) }
  const logoUrl = await uploadSvg('resources', 'branding/logo.svg', logoSvg())
  if (logoUrl) await supabase.from('schools').update({ logo_url: logoUrl }).eq('id', school.id)
  console.log(`   ✅ School: ${school.name} (${school.id})\n`)

  // ── 2. Create admin auth user + profile ──────────────────
  console.log('2️⃣  Creating admin user...')
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: 'admin@dpslucknow.com', password: 'Admin@1234', email_confirm: true,
  })
  if (authErr && !authErr.message.includes('already')) { console.error('Auth error:', authErr.message); process.exit(1) }
  const adminId = authData?.user?.id!
  if (adminId) {
    await supabase.from('users').insert({
      id: adminId, school_id: school.id, full_name: 'Abhigyan Tripathi',
      email: 'admin@dpslucknow.com', role: 'school_admin',
    })
    await assignDefaultUserRole(adminId, school.id, 'school_admin')
  }
  console.log(`   ✅ Admin: admin@dpslucknow.com / Admin@1234\n`)

  // ── 3. Academic year ─────────────────────────────────────
  console.log('3️⃣  Creating academic year...')
  const { data: ay } = await supabase.from('academic_years')
    .insert({ school_id: school.id, name: '2024-25', start_date: '2024-04-01', end_date: '2025-03-31', is_current: true })
    .select().single()
  console.log(`   ✅ Academic Year: ${ay!.name}\n`)

  // ── 4. Classes 1–12 ──────────────────────────────────────
  console.log('4️⃣  Creating classes...')
  const classes = await ins('classes', Array.from({ length: 12 }, (_, i) => ({
    school_id: school.id, name: `Class ${i + 1}`, numeric_level: i + 1,
  })))
  console.log(`   ✅ Created ${classes.length} classes\n`)

  // ── 5. Sections (streams for 11 & 12) ────────────────────
  console.log('5️⃣  Creating sections...')
  const sections = await ins('sections', classes.flatMap(c =>
    defaultSectionNamesForClass(c.numeric_level).map(name => ({
      school_id: school.id, class_id: c.id, name, max_strength: 40,
    }))
  ))
  console.log(`   ✅ Created ${sections.length} sections\n`)

  // ── 6. Houses ────────────────────────────────────────────
  console.log('6️⃣  Creating houses...')
  const houses = await ins('houses', [
    { school_id: school.id, name: 'Red House', color: '#EF4444' },
    { school_id: school.id, name: 'Blue House', color: '#3B82F6' },
    { school_id: school.id, name: 'Green House', color: '#22C55E' },
    { school_id: school.id, name: 'Yellow House', color: '#EAB308' },
  ])
  console.log(`   ✅ Created ${houses.length} houses\n`)

  // ── 7. Fee heads ─────────────────────────────────────────
  console.log('7️⃣  Creating fee heads...')
  const feeHeads = await ins('fee_heads', [
    { school_id: school.id, name: 'Tuition Fee', description: 'Monthly tuition charges' },
    { school_id: school.id, name: 'Exam Fee', description: 'Examination charges' },
    { school_id: school.id, name: 'Annual Fund', description: 'Annual development charges' },
    { school_id: school.id, name: 'Computer Fee', description: 'Computer lab charges' },
    { school_id: school.id, name: 'Transport Fee', description: 'School bus charges' },
  ])
  const tuitionHead = feeHeads.find(f => f.name === 'Tuition Fee')!
  const examHead = feeHeads.find(f => f.name === 'Exam Fee')!
  const annualHead = feeHeads.find(f => f.name === 'Annual Fund')!
  console.log(`   ✅ Created ${feeHeads.length} fee heads\n`)

  // ── 8. Fee structures ────────────────────────────────────
  console.log('8️⃣  Creating fee structures...')
  const tuitionByClass: Record<number, number> = { 1: 2500, 2: 2500, 3: 2800, 4: 2800, 5: 3000, 6: 3200, 7: 3200, 8: 3500, 9: 3800, 10: 3800, 11: 4500, 12: 4500 }
  const feeStructureRows = classes.flatMap(cls => [
    { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: tuitionHead.id, amount: tuitionByClass[cls.numeric_level], frequency: 'monthly', due_day: 10, late_fine_per_day: 5 },
    { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: examHead.id, amount: 500, frequency: 'quarterly' },
    { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: annualHead.id, amount: 5000, frequency: 'annually' },
  ])
  await ins('fee_structures', feeStructureRows)
  console.log(`   ✅ Created ${feeStructureRows.length} fee structures\n`)

  // ── 9. Inquiry sources ───────────────────────────────────
  console.log('9️⃣  Creating inquiry sources...')
  const sources = await ins('inquiry_sources', [
    { school_id: school.id, name: 'Walk-in' }, { school_id: school.id, name: 'Website' },
    { school_id: school.id, name: 'Facebook / Social Media' }, { school_id: school.id, name: 'Referral' },
    { school_id: school.id, name: 'Event' },
  ])
  console.log(`   ✅ Created ${sources.length} inquiry sources\n`)

  // ── 10. Staff (auth users + profiles + RBAC roles) ───────
  console.log('🔟  Creating staff members...')
  // users.role is constrained to a fixed legacy set; the richer job
  // title lives in staff_profiles.designation.
  const staffDefs = [
    { name: 'Ramesh Chandra', role: 'principal',  designation: 'Principal',           dept: 'Administration', subject: null },
    { name: 'Sunita Rao',     role: 'principal',  designation: 'Vice Principal',       dept: 'Administration', subject: null },
    { name: 'Anil Kapoor',    role: 'teacher',    designation: 'PGT Mathematics',      dept: 'Mathematics',    subject: 'Mathematics' },
    { name: 'Deepa Nair',     role: 'teacher',    designation: 'PGT Physics',          dept: 'Science',        subject: 'Physics' },
    { name: 'Vivek Menon',    role: 'teacher',    designation: 'PGT Chemistry',        dept: 'Science',        subject: 'Chemistry' },
    { name: 'Rekha Iyer',     role: 'teacher',    designation: 'TGT English',          dept: 'Languages',      subject: 'English' },
    { name: 'Sanjay Dubey',   role: 'teacher',    designation: 'TGT Hindi',            dept: 'Languages',      subject: 'Hindi' },
    { name: 'Pallavi Joshi',  role: 'teacher',    designation: 'TGT Social Science',   dept: 'Humanities',     subject: 'Social Science' },
    { name: 'Rohit Khanna',   role: 'teacher',    designation: 'PGT Computer Science', dept: 'Computer',       subject: 'Computer Science' },
    { name: 'Neha Bansal',    role: 'teacher',    designation: 'Librarian',            dept: 'Library',        subject: null },
    { name: 'Manoj Agrawal',  role: 'accountant', designation: 'Accounts Officer',     dept: 'Accounts',       subject: null },
    { name: 'Priyanka Sethi', role: 'counselor',  designation: 'Admission Counselor',  dept: 'Admissions',     subject: null },
  ]
  const staff: { id: string; name: string; role: string; designation: string; dept: string; subject: string | null }[] = []
  const usersRows: any[] = []
  const staffProfileRows: any[] = []
  for (let i = 0; i < staffDefs.length; i++) {
    const s = staffDefs[i]
    const email = s.name.toLowerCase().replace(/\s+/g, '.') + '@dpslucknow.com'
    const { data: au, error: aerr } = await supabase.auth.admin.createUser({ email, password: 'Staff@1234', email_confirm: true })
    if (aerr && !aerr.message.includes('already')) { console.error(`   ⚠️  staff auth ${email}: ${aerr.message}`); continue }
    const uid = au?.user?.id!
    if (!uid) continue
    const photo = await uploadSvg('student-photos', `staff/${uid}.svg`, avatarSvg(s.name, i + 3))
    staff.push({ id: uid, name: s.name, role: s.role, designation: s.designation, dept: s.dept, subject: s.subject })
    usersRows.push({ id: uid, school_id: school.id, full_name: s.name, email, role: s.role, avatar_url: photo, phone: `+91 ${9500000000 + i}` })
    staffProfileRows.push({
      school_id: school.id, user_id: uid, employee_id: `EMP${String(i + 1).padStart(3, '0')}`,
      designation: s.designation, department: s.dept, date_of_joining: iso(dMinus(400 + i * 30)),
      date_of_birth: `19${75 + i}-0${(i % 8) + 1}-15`, gender: i % 3 === 0 ? 'female' : 'male',
      qualification: s.subject ? `M.Sc / B.Ed (${s.subject})` : 'M.A / B.Ed', experience_years: 4 + (i % 12),
      phone: `+91 ${9500000000 + i}`, personal_email: email, city: 'Lucknow', state: 'Uttar Pradesh',
      emergency_contact_name: 'Family Contact', emergency_contact_phone: `+91 ${9400000000 + i}`,
      bank_name: 'HDFC Bank', bank_account_number: `50100${String(100000 + i)}`, bank_ifsc: 'HDFC0001234',
      pan_number: `ABCDE${1000 + i}F`, photo_url: photo, employment_type: 'full_time', employment_status: 'active',
    })
  }
  await ins('users', usersRows)
  await ins('staff_profiles', staffProfileRows)
  for (const s of staff) await assignDefaultUserRole(s.id, school.id, s.role)
  const teachers = staff.filter(s => s.subject)
  const anyTeacher = () => teachers[0]?.id ?? adminId
  console.log(`   ✅ Created ${staff.length} staff (password: Staff@1234)\n`)

  // ── 11. Students (+ photos for some) ─────────────────────
  console.log('1️⃣1️⃣  Creating 25 demo students...')
  const firstNames = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Rahul', 'Divya', 'Aditya', 'Pooja', 'Karan', 'Riya', 'Ishaan', 'Meera', 'Siddharth', 'Nisha', 'Akash', 'Sunita', 'Dev', 'Tanya', 'Nikhil', 'Shreya', 'Manav']
  const lastNames = ['Sharma', 'Gupta', 'Singh', 'Verma', 'Mishra', 'Agarwal', 'Tiwari', 'Pandey', 'Yadav', 'Joshi', 'Srivastava', 'Kumar', 'Chauhan', 'Saxena', 'Tripathi']
  const classForStudent = [1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12]
  const houseIdx = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0]
  const genders = ['male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male']

  const studentRows = Array.from({ length: 25 }, (_, i) => {
    const cls = classes.find(c => c.numeric_level === classForStudent[i])!
    const secs = sections.filter(s => s.class_id === cls.id)
    return {
      school_id: school.id, admission_number: `ADM2024${String(i + 1).padStart(3, '0')}`,
      first_name: firstNames[i], last_name: pick(lastNames, i),
      date_of_birth: `${2010 - classForStudent[i]}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      gender: genders[i], blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'B-'], i),
      academic_year_id: ay!.id, class_id: cls.id, section_id: secs[i % secs.length].id,
      roll_number: String((i % 40) + 1), house_id: houses[houseIdx[i]].id, status: 'active',
      phone: `+91 ${9300000000 + i}`, city: 'Lucknow', state: 'Uttar Pradesh',
    }
  })
  const students = await ins('students', studentRows)
  // Upload avatar photos for the first 12 students
  let photoCount = 0
  for (let i = 0; i < Math.min(12, students.length); i++) {
    const url = await uploadSvg('student-photos', `students/${students[i].id}.svg`, avatarSvg(`${students[i].first_name} ${students[i].last_name}`, i))
    if (url) { await supabase.from('students').update({ photo_url: url }).eq('id', students[i].id); photoCount++ }
  }
  console.log(`   ✅ Created ${students.length} students (${photoCount} with photos)\n`)

  // ── 12. Parents ──────────────────────────────────────────
  console.log('1️⃣2️⃣  Creating parent records...')
  const fatherNames = ['Rajesh', 'Suresh', 'Mahesh', 'Ramesh', 'Dinesh', 'Ganesh', 'Naresh', 'Umesh', 'Lokesh', 'Yogesh', 'Mukesh', 'Hitesh', 'Rakesh', 'Paresh', 'Jignesh', 'Alpesh', 'Bhavesh', 'Ritesh', 'Nilesh', 'Kamlesh', 'Harish', 'Manish', 'Girish', 'Satish', 'Jagdish']
  await ins('parents', students.map((s, i) => ({
    school_id: school.id, student_id: s.id,
    father_name: `${fatherNames[i]} ${pick(lastNames, i)}`, father_phone: `+91 ${9800000000 + i}`, father_email: `parent${i + 1}@gmail.com`,
    mother_name: `Sunita ${pick(lastNames, i)}`, mother_phone: `+91 ${9700000000 + i}`,
  })))
  console.log(`   ✅ Created ${students.length} parent records\n`)

  // ── 13. Student documents ────────────────────────────────
  console.log('1️⃣3️⃣  Creating student documents...')
  const docTypes = ['aadhaar', 'birth_certificate', 'marksheet', 'address_proof', 'medical', 'photo_id']
  const docRows: any[] = []
  for (let i = 0; i < students.length; i++) {
    const n = i < 10 ? 2 : 1 // ensure >10 rows overall
    for (let j = 0; j < n; j++) {
      const dt = pick(docTypes, i + j)
      docRows.push({
        school_id: school.id, student_id: students[i].id, document_type: dt,
        document_name: `${dt.replace(/_/g, ' ')} - ${students[i].first_name}`,
        file_url: logoUrl ?? 'https://example.com/doc.pdf', mime_type: 'application/pdf',
        file_size: `${100 + i}KB`, uploaded_by: adminId,
      })
    }
  }
  const docs = await ins('student_documents', docRows)
  console.log(`   ✅ Created ${docs.length} student documents\n`)

  // ── 14. Fee invoices + payments ──────────────────────────
  console.log('1️⃣4️⃣  Creating fee invoices & payments...')
  const invoiceRows = students.map((s, i) => {
    const cls = classes.find(c => c.id === s.class_id)!
    const tuition = tuitionByClass[cls.numeric_level]
    const total = tuition + 500
    return {
      school_id: school.id, student_id: s.id, academic_year_id: ay!.id,
      invoice_number: `INV2024${String(i + 1).padStart(4, '0')}`, invoice_date: '2024-04-10', due_date: '2024-04-20',
      line_items: [
        { fee_head_id: tuitionHead.id, name: 'Tuition Fee', amount: tuition, discount: 0, net_amount: tuition },
        { fee_head_id: examHead.id, name: 'Exam Fee', amount: 500, discount: 0, net_amount: 500 },
      ],
      subtotal: total, total_discount: 0, late_fine: 0, total_amount: total,
      status: i < 18 ? 'paid' : i < 22 ? 'partial' : 'unpaid',
    }
  })
  const invoices = await ins('fee_invoices', invoiceRows)
  const paymentRows: any[] = []
  invoices.forEach((inv, i) => {
    if (inv.status === 'paid') paymentRows.push({ school_id: school.id, invoice_id: inv.id, student_id: inv.student_id, receipt_number: `RCP2024${String(i + 1).padStart(4, '0')}`, amount_paid: inv.total_amount, payment_mode: pick(['cash', 'upi', 'neft', 'card'], i), transaction_reference: `TXN2024${String(i + 1).padStart(5, '0')}` })
    else if (inv.status === 'partial') paymentRows.push({ school_id: school.id, invoice_id: inv.id, student_id: inv.student_id, receipt_number: `RCP2024${String(i + 100).padStart(4, '0')}`, amount_paid: Math.floor(inv.total_amount / 2), payment_mode: 'cash' })
  })
  await ins('fee_payments', paymentRows)
  console.log(`   ✅ Created ${invoices.length} invoices, ${paymentRows.length} payments\n`)

  // ── 15. Fee discounts + ad-hoc fees ──────────────────────
  console.log('1️⃣5️⃣  Creating fee discounts & ad-hoc fees...')
  const discountReasons = ['Sibling discount', 'Staff ward concession', 'Merit scholarship', 'Financial hardship', 'Sports quota', 'Early payment discount']
  await ins('fee_discounts', students.slice(0, 12).map((s, i) => ({
    school_id: school.id, student_id: s.id, fee_head_id: tuitionHead.id,
    discount_type: i % 2 === 0 ? 'percentage' : 'fixed', discount_value: i % 2 === 0 ? 10 + (i % 3) * 5 : 500 + i * 100,
    reason: pick(discountReasons, i), approval_status: i < 8 ? 'approved' : 'pending',
    approved_by: i < 8 ? adminId : null, approved_at: i < 8 ? new Date().toISOString() : null,
    requested_by: adminId, is_active: true, valid_from: '2024-04-01', valid_until: '2025-03-31',
  })))
  const adhocTitles = ['Annual Day Costume', 'Educational Trip - Agra', 'Science Exhibition Kit', 'Sports Day T-shirt', 'Art & Craft Materials', 'Library Late Fine', 'Lab Breakage Charge', 'Winter Carnival', 'Bus Route Change', 'Yoga Workshop', 'Robotics Club', 'Music Class']
  await ins('adhoc_fees', adhocTitles.map((t, i) => ({
    school_id: school.id, student_id: students[i % students.length].id, class_id: null,
    title: t, description: `${t} charge for 2024-25`, amount: 200 + i * 150,
    due_date: iso(dMinus(-15 - i)), status: i % 3 === 0 ? 'paid' : 'unpaid', created_by: adminId,
  })))
  console.log(`   ✅ Created 12 discounts, ${adhocTitles.length} ad-hoc fees\n`)

  // ── 16. Admission inquiries + follow-ups + applications ──
  console.log('1️⃣6️⃣  Creating admission pipeline...')
  const inquiryStatuses = ['new', 'new', 'follow_up', 'follow_up', 'interested', 'interested', 'documents_submitted', 'approved', 'fee_pending', 'admitted', 'admitted', 'admitted', 'rejected', 'lost']
  const inquiryNames = ['Aryan Verma', 'Sanya Gupta', 'Rohit Mishra', 'Pooja Singh', 'Amit Sharma', 'Neha Agarwal', 'Shivam Kumar', 'Kritika Joshi', 'Varun Yadav', 'Anjali Tiwari', 'Pratik Srivastava', 'Simran Chauhan', 'Vivek Saxena', 'Tanvi Pandey']
  const inquiries = await ins('admission_inquiries', inquiryNames.map((name, i) => ({
    school_id: school.id, inquiry_number: `INQ2024${String(i + 1).padStart(3, '0')}`, student_name: name,
    parent_name: `Parent of ${name}`, parent_phone: `+91 ${9600000000 + i}`, parent_email: `inquiry${i + 1}@gmail.com`,
    applying_for_class_id: classes.find(c => c.numeric_level === (i % 5) + 6)?.id, academic_year_id: ay!.id,
    source_id: pick(sources, i).id, status: inquiryStatuses[i],
    notes: pick(['Interested in science stream', 'Needs scholarship info', 'Referred by current parent', 'Wants hostel facility', 'Enquired about transport'], i),
    previous_school: pick(['St. Francis School', 'City Montessori', 'Kendriya Vidyalaya', 'Army Public School', 'La Martiniere'], i),
    created_at: new Date(Date.now() - (14 - i) * 864e5).toISOString(),
  })))
  const counselorId = staff.find(s => s.role === 'counselor')?.id ?? adminId
  await ins('inquiry_follow_ups', inquiries.slice(0, 12).map((inq, i) => ({
    inquiry_id: inq.id, counselor_id: counselorId, follow_up_date: new Date(Date.now() - (10 - i) * 864e5).toISOString(),
    channel: pick(['call', 'whatsapp', 'email', 'visit', 'sms'], i),
    notes: pick(['Discussed fee structure', 'Shared prospectus', 'Scheduled campus visit', 'Answered curriculum queries', 'Sent admission form'], i),
    outcome: pick(['Interested', 'Will decide soon', 'Wants to visit', 'Comparing options', 'Positive'], i),
    next_follow_up_date: new Date(Date.now() + (i + 2) * 864e5).toISOString(),
  })))
  const appStatuses = ['pending', 'counselor_approved', 'documents_verified', 'fee_paid', 'principal_approved', 'admitted', 'rejected', 'pending', 'counselor_approved', 'admitted']
  await ins('admission_applications', appStatuses.map((st, i) => ({
    school_id: school.id, application_number: `APP2024${String(i + 1).padStart(3, '0')}`,
    student_first_name: pick(firstNames, i + 5), student_last_name: pick(lastNames, i),
    date_of_birth: `${2012 - (i % 4)}-0${(i % 8) + 1}-12`, gender: i % 2 === 0 ? 'male' : 'female',
    father_name: `${pick(fatherNames, i)} ${pick(lastNames, i)}`, father_phone: `+91 ${9200000000 + i}`,
    mother_name: `Anita ${pick(lastNames, i)}`, mother_phone: `+91 ${9100000000 + i}`,
    applying_for_class_id: classes.find(c => c.numeric_level === (i % 6) + 1)?.id, academic_year_id: ay!.id,
    previous_school: pick(['St. Francis School', 'City Montessori', 'Kendriya Vidyalaya'], i), status: st,
    application_fee_paid: i % 2 === 0, application_fee_amount: 1000,
  })))
  console.log(`   ✅ Created ${inquiries.length} inquiries, 12 follow-ups, ${appStatuses.length} applications\n`)

  // ── 17. Subjects (master list) ───────────────────────────
  console.log('1️⃣7️⃣  Creating subjects...')
  const subjectDefs = [['English', 'ENG'], ['Hindi', 'HIN'], ['Mathematics', 'MAT'], ['Science', 'SCI'], ['Social Science', 'SST'], ['Computer Science', 'CS'], ['Physics', 'PHY'], ['Chemistry', 'CHE'], ['Biology', 'BIO'], ['Physical Education', 'PE'], ['Art & Craft', 'ART'], ['General Knowledge', 'GK']]
  await ins('subjects', subjectDefs.map(([name, code], i) => ({ school_id: school.id, name, code, is_elective: i >= 9 })))
  console.log(`   ✅ Created ${subjectDefs.length} subjects\n`)

  // ── 18. Exams + subjects + marks + report cards ──────────
  console.log('1️⃣8️⃣  Creating exams, marks & report cards...')
  const examDefs = [
    { name: 'Unit Test 1', type: 'unit_test', status: 'result_declared', off: 120 },
    { name: 'Half Yearly Examination', type: 'half_yearly', status: 'result_declared', off: 90 },
    { name: 'Unit Test 2', type: 'unit_test', status: 'completed', off: 45 },
    { name: 'Pre-Board 1', type: 'pre_board', status: 'ongoing', off: 10 },
    { name: 'Monthly Test - July', type: 'monthly', status: 'published', off: -5 },
    { name: 'Practical Examination', type: 'practical', status: 'published', off: -12 },
    { name: 'Annual Examination', type: 'annual', status: 'draft', off: -60 },
    { name: 'Unit Test 3', type: 'unit_test', status: 'draft', off: -30 },
    { name: 'Pre-Board 2', type: 'pre_board', status: 'draft', off: -45 },
    { name: 'Surprise Test', type: 'other', status: 'draft', off: -3 },
  ]
  const exams = await ins('exams', examDefs.map(e => ({
    school_id: school.id, academic_year_id: ay!.id, name: e.name, exam_type: e.type,
    start_date: iso(dMinus(e.off)), end_date: iso(dMinus(e.off - 5)), status: e.status,
    grading_system: 'marks', created_by: adminId,
  })))
  // Full marks + report cards for the first result-declared exam.
  const gradedExam = exams[0]
  const coreSubjects = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science']
  const examSubjectRows = classes.flatMap(cls =>
    coreSubjects.map((sub, si) => ({
      school_id: school.id, exam_id: gradedExam.id, class_id: cls.id, subject_name: sub,
      exam_date: iso(dMinus(120 - si)), start_time: '09:00', end_time: '12:00', max_marks: 100, pass_marks: 33,
    }))
  )
  const examSubjects = await ins('exam_subjects', examSubjectRows)
  const markRows: any[] = []
  const reportRows: any[] = []
  for (const stu of students) {
    const subs = examSubjects.filter(es => es.class_id === stu.class_id)
    if (!subs.length) continue
    let total = 0, obtained = 0
    subs.forEach((es, k) => {
      const m = rint(35, 98, stu.roll_number.length + k * 7 + stu.first_name.length)
      total += Number(es.max_marks); obtained += m
      markRows.push({ school_id: school.id, exam_id: gradedExam.id, exam_subject_id: es.id, student_id: stu.id, marks_obtained: m, grade: m >= 90 ? 'A1' : m >= 75 ? 'A2' : m >= 60 ? 'B1' : m >= 45 ? 'B2' : 'C', entered_by: anyTeacher() })
    })
    const pct = Math.round((obtained / total) * 1000) / 10
    reportRows.push({ school_id: school.id, exam_id: gradedExam.id, student_id: stu.id, total_marks: total, obtained_marks: obtained, percentage: pct, grade: pct >= 90 ? 'A1' : pct >= 75 ? 'A2' : pct >= 60 ? 'B1' : 'B2', is_pass: pct >= 33, published_at: new Date().toISOString() })
  }
  await ins('student_marks', markRows)
  // rank within class
  const byClass: Record<string, any[]> = {}
  reportRows.forEach(r => { const c = students.find(s => s.id === r.student_id)!.class_id; (byClass[c] = byClass[c] || []).push(r) })
  Object.values(byClass).forEach(rs => rs.sort((a, b) => b.obtained_marks - a.obtained_marks).forEach((r, i) => r.rank = i + 1))
  await ins('report_cards', reportRows)
  console.log(`   ✅ Created ${exams.length} exams, ${examSubjects.length} exam-subjects, ${markRows.length} marks, ${reportRows.length} report cards\n`)

  // ── 19. Student attendance ───────────────────────────────
  console.log('1️⃣9️⃣  Creating student attendance...')
  const attDates = workingDays(12)
  const attRows: any[] = []
  students.forEach((s, si) => attDates.forEach((d, di) => {
    const r = (si * 7 + di * 3) % 20
    attRows.push({ school_id: school.id, student_id: s.id, class_id: s.class_id, section_id: s.section_id, date: d, status: r === 0 ? 'absent' : r === 1 ? 'late' : r === 2 ? 'leave' : 'present', marked_by: anyTeacher() })
  }))
  const att = await ins('attendance', attRows)
  console.log(`   ✅ Created ${att.length} attendance records (${attDates.length} days)\n`)

  // ── 20. Timetable ────────────────────────────────────────
  console.log('2️⃣0️⃣  Creating timetable...')
  const periods = [['09:00', '09:45'], ['09:45', '10:30'], ['10:30', '11:15'], ['11:30', '12:15'], ['12:15', '13:00'], ['13:45', '14:30']]
  const ttSubjects = ['Mathematics', 'English', 'Science', 'Social Science', 'Hindi', 'Computer Science']
  const ttSections = sections.slice(0, 2)
  const ttRows: any[] = []
  ttSections.forEach(sec => {
    for (let day = 1; day <= 6; day++) {
      periods.forEach(([st, en], p) => {
        ttRows.push({ school_id: school.id, class_id: sec.class_id, section_id: sec.id, academic_year_id: ay!.id, day_of_week: day, period_number: p + 1, start_time: st, end_time: en, subject_name: pick(ttSubjects, day + p), teacher_id: pick(teachers, day + p).id, room: `Room ${101 + (p % 6)}` })
      })
    }
  })
  const tt = await ins('timetable_periods', ttRows)
  console.log(`   ✅ Created ${tt.length} timetable periods\n`)

  // ── 21. Homework + syllabus + progress notes ─────────────
  console.log('2️⃣1️⃣  Creating homework & syllabus...')
  const hwTitles = ['Algebra worksheet Ch-3', 'Read chapter "The Solar System"', 'Essay: My Favourite Season', 'Hindi Vyakaran exercise', 'Map work: Indian Rivers', 'HTML basics practice', 'Physics numericals set A', 'Balance chemical equations', 'Leaf collection project', 'Grammar: Tenses', 'History timeline chart', 'Science diagram - Cell']
  await ins('homework', hwTitles.map((t, i) => ({
    school_id: school.id, class_id: pick(classes, i + 5).id, section_id: null,
    subject_name: pick(ttSubjects, i), type: i % 4 === 0 ? 'classwork' : 'homework', assignment_type: 'class',
    title: t, description: `${t}. Submit by due date.`, attachment_url: i % 5 === 0 ? logoUrl : null,
    assigned_date: iso(dMinus(i)), due_date: iso(dMinus(i - 3)), created_by: pick(teachers, i).id,
  })))
  const chapNames = ['Real Numbers', 'Polynomials', 'Light - Reflection', 'The French Revolution', 'Acids & Bases', 'Life Processes', 'Nationalism in India', 'Trigonometry', 'Electricity', 'Carbon Compounds', 'Democracy', 'Statistics']
  const chapters = await ins('syllabus_chapters', chapNames.map((c, i) => ({
    school_id: school.id, class_id: pick(classes, i + 8).id, subject_name: pick(coreSubjects, i), academic_year_id: ay!.id,
    chapter_number: (i % 6) + 1, chapter_name: c, planned_date: iso(dMinus(30 - i * 3)),
    actual_completion_date: i < 6 ? iso(dMinus(28 - i * 3)) : null, status: i < 6 ? 'completed' : i < 9 ? 'in_progress' : 'pending', created_by: adminId,
  })))
  await ins('daily_progress_notes', chapters.slice(0, 12).map((ch, i) => ({
    school_id: school.id, class_id: ch.class_id, section_id: null, subject_name: ch.subject_name, teacher_id: pick(teachers, i).id,
    note_date: iso(dMinus(i)), note: `Covered "${ch.chapter_name}" — ${pick(['completed exercises', 'explained concepts', 'revised previous topic', 'started new section'], i)}.`,
    chapter_id: ch.id, progress_status: i < 6 ? 'completed' : i < 9 ? 'in_progress' : 'started',
  })))
  console.log(`   ✅ Created ${hwTitles.length} homework, ${chapters.length} chapters, 12 progress notes\n`)

  // ── 22. Resources ────────────────────────────────────────
  console.log('2️⃣2️⃣  Creating resources...')
  const resTypes = ['notes', 'assignment', 'syllabus', 'question_paper', 'video_link', 'reference']
  const resTitles = ['Class 10 Maths Formula Sheet', 'Science NCERT Solutions', 'Annual Syllabus 2024-25', 'Sample Paper - English', 'Khan Academy: Trigonometry', 'Periodic Table Reference', 'History Notes - Freedom Struggle', 'Grammar Assignment', 'Physics Question Bank', 'Biology Diagrams PDF', 'Computer Science Handbook', 'Hindi Poetry Collection']
  await ins('resources', resTitles.map((t, i) => {
    const type = pick(resTypes, i)
    return { school_id: school.id, class_id: pick(classes, i + 6).id, subject_name: pick(coreSubjects, i), title: t, description: `${t} for students.`, resource_type: type, file_url: type === 'video_link' ? null : logoUrl, external_url: type === 'video_link' ? 'https://youtube.com/watch?v=demo' : null, mime_type: type === 'video_link' ? null : 'application/pdf', is_published: true, uploaded_by: pick(teachers, i).id }
  }))
  console.log(`   ✅ Created ${resTitles.length} resources\n`)

  // ── 23. Complaints + comments ────────────────────────────
  console.log('2️⃣3️⃣  Creating complaints...')
  const compCats = ['academic', 'behavioral', 'facility', 'transport', 'fee', 'bullying', 'staff', 'other']
  const compSubjects = ['Late school bus', 'Classroom fan not working', 'Homework overload', 'Canteen food quality', 'Fee receipt not received', 'Peer conflict in Class 8', 'Library book shortage', 'Playground maintenance', 'Extra class timing clash', 'Water cooler issue', 'Uniform supplier delay', 'Exam date clarification']
  const compStatuses = ['open', 'in_progress', 'resolved', 'closed']
  const complaints = await ins('complaints', compSubjects.map((sub, i) => ({
    school_id: school.id, student_id: students[i % students.length].id, raised_by: adminId,
    category: pick(compCats, i), subject: sub, description: `${sub}. Please look into this at the earliest.`,
    priority: pick(['low', 'medium', 'high', 'urgent'], i), status: pick(compStatuses, i),
    assigned_to: pick(staff, i).id, resolution: i % 4 >= 2 ? 'Issue addressed and resolved.' : null,
    resolved_at: i % 4 >= 2 ? new Date().toISOString() : null,
  })))
  await ins('complaint_comments', complaints.slice(0, 12).map((c, i) => ({
    complaint_id: c.id, user_id: pick(staff, i).id, comment: pick(['Looking into this.', 'Forwarded to concerned dept.', 'Will resolve by tomorrow.', 'Thanks for reporting.', 'Update: work in progress.'], i),
  })))
  console.log(`   ✅ Created ${complaints.length} complaints + comments\n`)

  // ── 24. Certificates (templates + issued) ────────────────
  console.log('2️⃣4️⃣  Creating certificates...')
  const certTypes: [string, string][] = [['Character Certificate', 'character'], ['Bonafide Certificate', 'bonafide'], ['Migration Certificate', 'migration'], ['Achievement Award', 'achievement'], ['Participation Certificate', 'participation'], ['Sports Certificate', 'sports'], ['Custom Certificate', 'custom'], ['Merit Certificate', 'achievement'], ['Perfect Attendance', 'participation'], ['Sports Championship', 'sports']]
  const templates = await ins('certificate_templates', certTypes.map(([name, type]) => ({
    school_id: school.id, name, certificate_type: type,
    content: `This is to certify that {{student_name}} of class {{class}} is awarded the ${name}.`, is_active: true, created_by: adminId,
  })))
  await ins('issued_certificates', students.slice(0, 12).map((s, i) => {
    const tpl = pick(templates, i)
    return { school_id: school.id, student_id: s.id, template_id: tpl.id, certificate_type: tpl.certificate_type, certificate_number: `CERT2024${String(i + 1).padStart(4, '0')}`, issued_data: { student_name: `${s.first_name} ${s.last_name}`, class: s.class_id }, issued_by: adminId, qr_code_data: `https://dpslucknow.example.com/verify/CERT2024${String(i + 1).padStart(4, '0')}` }
  }))
  console.log(`   ✅ Created ${templates.length} templates, 12 issued certificates\n`)

  // ── 25. Transfer certificates ────────────────────────────
  console.log('2️⃣5️⃣  Creating transfer certificates...')
  await ins('transfer_certificates', students.slice(15, 25).map((s, i) => ({
    school_id: school.id, student_id: s.id, tc_number: `TC2024${String(i + 1).padStart(3, '0')}`,
    issue_date: iso(dMinus(i * 5)), reason: pick(['Relocation', 'Parent transfer', 'Higher studies elsewhere', 'Personal reasons'], i),
    last_attendance_date: iso(dMinus(i * 5 + 2)), conduct: 'Good', dues_cleared: true, issued_by: adminId,
    qr_code_data: `https://dpslucknow.example.com/tc/TC2024${String(i + 1).padStart(3, '0')}`, status: pick(['pending', 'approved', 'approved'], i),
  })))
  console.log(`   ✅ Created 10 transfer certificates\n`)

  // ── 26. HR: leave types, balances, requests ──────────────
  console.log('2️⃣6️⃣  Creating HR leave data...')
  const leaveTypes = await ins('leave_types', [
    { school_id: school.id, name: 'Casual Leave', code: 'CL', default_days_per_year: 12, is_paid: true, carry_forward: false },
    { school_id: school.id, name: 'Sick Leave', code: 'SL', default_days_per_year: 10, is_paid: true, carry_forward: false },
    { school_id: school.id, name: 'Earned Leave', code: 'EL', default_days_per_year: 15, is_paid: true, carry_forward: true },
    { school_id: school.id, name: 'Maternity Leave', code: 'ML', default_days_per_year: 180, is_paid: true, carry_forward: false },
    { school_id: school.id, name: 'Leave Without Pay', code: 'LWP', default_days_per_year: 0, is_paid: false, carry_forward: false },
  ])
  const year = today.getFullYear()
  const balRows: any[] = []
  const allStaff = [{ id: adminId }, ...staff]
  allStaff.forEach(s => leaveTypes.forEach((lt, k) => balRows.push({ school_id: school.id, user_id: s.id, leave_type_id: lt.id, year, total_days: lt.default_days_per_year, used_days: k < 2 ? 2 : 0 })))
  await ins('leave_balances', balRows)
  const leaveStatuses = ['pending', 'approved', 'approved', 'rejected', 'approved', 'pending', 'approved', 'cancelled', 'approved', 'pending', 'approved', 'rejected']
  await ins('leave_requests', leaveStatuses.map((st, i) => {
    const applicant = pick(allStaff, i)
    const from = dMinus(20 - i)
    const to = dMinus(20 - i - (i % 3))
    return { school_id: school.id, user_id: applicant.id, leave_type_id: pick(leaveTypes, i).id, from_date: iso(from), to_date: iso(to), total_days: (i % 3) + 1, reason: pick(['Family function', 'Fever', 'Personal work', 'Medical checkup', 'Out of station', 'Child care'], i), status: st, approved_by: st === 'approved' || st === 'rejected' ? adminId : null, approved_at: st === 'approved' || st === 'rejected' ? new Date().toISOString() : null, rejection_reason: st === 'rejected' ? 'Insufficient leave balance' : null }
  }))
  console.log(`   ✅ Created ${leaveTypes.length} leave types, ${balRows.length} balances, ${leaveStatuses.length} requests\n`)

  // ── 27. HR: salary + payslips + staff attendance ─────────
  console.log('2️⃣7️⃣  Creating payroll & staff attendance...')
  await ins('salary_structures', staff.map((s, i) => {
    const basic = 25000 + i * 2500
    return { school_id: school.id, user_id: s.id, basic_salary: basic, hra: Math.round(basic * 0.4), da: Math.round(basic * 0.1), conveyance_allowance: 1600, medical_allowance: 1250, other_allowances: 1000, pf_deduction: Math.round(basic * 0.12), professional_tax: 200, other_deductions: 0, effective_from: '2024-04-01', is_active: true, created_by: adminId }
  }))
  const payMonths = [{ m: 5, y: 2024 }, { m: 6, y: 2024 }]
  const payRows: any[] = []
  staff.forEach((s, i) => payMonths.forEach(pm => {
    const basic = 25000 + i * 2500, hra = Math.round(basic * 0.4), da = Math.round(basic * 0.1)
    const gross = basic + hra + da + 1600 + 1250 + 1000
    const ded = Math.round(basic * 0.12) + 200
    payRows.push({ school_id: school.id, user_id: s.id, month: pm.m, year: pm.y, basic_salary: basic, hra, da, conveyance_allowance: 1600, medical_allowance: 1250, other_allowances: 1000, gross_salary: gross, pf_deduction: Math.round(basic * 0.12), professional_tax: 200, other_deductions: 0, lop_days: 0, lop_amount: 0, total_deductions: ded, net_salary: gross - ded, payment_status: 'paid', payment_date: `${pm.y}-0${pm.m}-28`, payment_mode: 'neft', generated_by: adminId })
  }))
  await ins('payslips', payRows)
  const saDates = workingDays(10)
  const saRows: any[] = []
  allStaff.forEach((s, si) => saDates.forEach((d, di) => {
    const r = (si * 5 + di * 2) % 15
    saRows.push({ school_id: school.id, user_id: s.id, date: d, status: r === 0 ? 'absent' : r === 1 ? 'on_leave' : r === 2 ? 'half_day' : 'present', check_in: r >= 3 ? '08:30' : null, check_out: r >= 3 ? '15:30' : null, marked_by: adminId })
  }))
  await ins('staff_attendance', saRows)
  console.log(`   ✅ Created ${staff.length} salaries, ${payRows.length} payslips, ${saRows.length} staff attendance\n`)

  // ── 28. Recruitment: job postings + applications ─────────
  console.log('2️⃣8️⃣  Creating recruitment data...')
  const jobs = await ins('job_postings', [
    ['PGT Mathematics', 'Mathematics', 'PGT'], ['TGT Science', 'Science', 'TGT'], ['PRT (Primary Teacher)', 'Primary', 'PRT'], ['Physical Education Teacher', 'Sports', 'PET'], ['Music Teacher', 'Arts', 'Teacher'], ['Lab Assistant', 'Science', 'Assistant'], ['Front Office Executive', 'Administration', 'Executive'], ['Accountant', 'Accounts', 'Accountant'], ['Librarian', 'Library', 'Librarian'], ['Computer Instructor', 'Computer', 'Instructor'],
  ].map(([title, dept, desig], i) => ({
    school_id: school.id, title, department: dept, designation: desig, employment_type: 'full_time',
    description: `We are hiring a ${title} for the 2024-25 session.`, requirements: 'Relevant qualification + B.Ed preferred.',
    experience_required: `${(i % 5) + 1}+ years`, salary_range: `₹${25 + i} - ${35 + i}k/month`, vacancies: (i % 3) + 1,
    status: i < 7 ? 'open' : i < 9 ? 'on_hold' : 'closed', posted_by: adminId,
  })))
  const candNames = [' Arun Mehta', 'Kavita Reddy', 'Sameer Khan', 'Pooja Nair', 'Rahul Desai', 'Sneha Patil', 'Vikas Rana', 'Anita Gill', 'Farhan Ali', 'Divya Menon', 'Rohit Sharma', 'Meena Kumari']
  const appStatuses2 = ['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined', 'rejected', 'applied', 'shortlisted', 'interviewed', 'selected']
  await ins('job_applications', candNames.map((name, i) => ({
    school_id: school.id, job_posting_id: pick(jobs, i).id, candidate_name: name.trim(), email: `candidate${i + 1}@gmail.com`,
    phone: `+91 ${9000000000 + i}`, experience_years: (i % 8) + 1, current_designation: pick(['TGT', 'PGT', 'PRT', 'Coordinator'], i),
    expected_salary: 30000 + i * 2000, notice_period: pick(['Immediate', '1 month', '2 months'], i), source: pick(['Naukri', 'Referral', 'Walk-in', 'LinkedIn'], i),
    status: appStatuses2[i], application_number: `JA2024${String(i + 1).padStart(3, '0')}`, rating: (i % 5) + 1,
    interview_date: i % 3 === 0 ? new Date(Date.now() + i * 864e5).toISOString() : null,
  })))
  console.log(`   ✅ Created ${jobs.length} job postings, ${candNames.length} applications\n`)

  // ── 29. Holidays / academic calendar ─────────────────────
  console.log('2️⃣9️⃣  Creating holidays...')
  await ins('holidays', [
    ['2024-08-15', 'Independence Day'], ['2024-09-05', "Teachers' Day"], ['2024-10-02', 'Gandhi Jayanti'], ['2024-10-31', 'Diwali'], ['2024-11-01', 'Diwali Holiday'], ['2024-11-15', 'Guru Nanak Jayanti'], ['2024-12-25', 'Christmas'], ['2025-01-26', 'Republic Day'], ['2025-03-14', 'Holi'], ['2025-03-31', 'Eid ul-Fitr'], ['2024-08-19', 'Raksha Bandhan'], ['2024-08-26', 'Janmashtami'],
  ].map(([date, name]) => ({ school_id: school.id, date, name })))
  console.log(`   ✅ Created 12 holidays\n`)

  // ── Done ─────────────────────────────────────────────────
  console.log('━'.repeat(52))
  console.log('🎉 SEED COMPLETE! Demo data summary:\n')
  console.log(`   🏫  School:      Delhi Public School Lucknow`)
  console.log(`   🔑  Admin:       admin@dpslucknow.com / Admin@1234`)
  console.log(`   🔑  Staff:       <name>@dpslucknow.com / Staff@1234`)
  console.log(`   👨‍🏫  Staff:       ${staff.length}   👨‍🎓 Students: ${students.length} (12 with photos)`)
  console.log(`   📋  Inquiries:   ${inquiries.length}   📝 Applications: 10`)
  console.log(`   💰  Invoices:    ${invoices.length}   🧾 Payslips: ${payRows.length}`)
  console.log(`   📊  Exams:       ${exams.length}   🎓 Certificates: 12 issued`)
  console.log(`   🗓️  Attendance:  ${att.length} student + ${saRows.length} staff records`)
  console.log(`   📚  Homework/Resources/Complaints/Jobs all populated (10+ each)`)
  console.log('')
  console.log('   👉  Open the frontend and login!')
  console.log('━'.repeat(52))
}

seed().catch(console.error)
