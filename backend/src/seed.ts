import 'dotenv/config'
import { supabase } from './shared/db/client'
import { assignDefaultUserRole } from './modules/rbac/seed'
import { defaultSectionNamesForClass } from './shared/utils/helpers'

async function seed() {
  console.log('🌱 Starting AIRTEC demo seed...\n')

  // ── 1. Create school ─────────────────────────────────────
  console.log('1️⃣  Creating school...')
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .insert({
      name: 'Delhi Public School Lucknow',
      city: 'Lucknow', state: 'Uttar Pradesh',
      phone: '+91 9876543210',
      email: 'admin@dpslucknow.com',
      affiliation_board: 'CBSE',
      affiliation_no: '2730045',
      established_year: 1998,
    })
    .select().single()
  if (schoolErr) { console.error('School error:', schoolErr.message); process.exit(1) }
  console.log(`   ✅ School: ${school.name} (${school.id})\n`)

  // ── 2. Create auth user + profile ────────────────────────
  console.log('2️⃣  Creating admin user...')
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: 'admin@dpslucknow.com',
    password: 'Admin@1234',
    email_confirm: true,
  })
  if (authErr && !authErr.message.includes('already')) {
    console.error('Auth error:', authErr.message); process.exit(1)
  }
  const userId = authData?.user?.id
  if (userId) {
    await supabase.from('users').insert({
      id: userId, school_id: school.id,
      full_name: 'Abhigyan Tripathi',
      email: 'admin@dpslucknow.com',
      role: 'school_admin',
    })
    // Seed default RBAC roles for the school and assign the admin
    // theirs — without this, the sidebar shows almost nothing for them
    // (see rbac/seed.ts for why).
    await assignDefaultUserRole(userId, school.id, 'school_admin')
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
  const classRows = Array.from({ length: 12 }, (_, i) => ({
    school_id: school.id, name: `Class ${i + 1}`, numeric_level: i + 1,
  }))
  const { data: classes } = await supabase.from('classes').insert(classRows).select()
  console.log(`   ✅ Created ${classes!.length} classes\n`)

  // ── 5. Sections for each class (streams for 11 & 12) ────
  console.log('5️⃣  Creating sections...')
  const sectionRows = classes!.flatMap(c =>
    defaultSectionNamesForClass(c.numeric_level).map(name => ({
      school_id: school.id, class_id: c.id, name, max_strength: 40,
    }))
  )
  const { data: sections } = await supabase.from('sections').insert(sectionRows).select()
  console.log(`   ✅ Created ${sections!.length} sections\n`)

  // ── 6. Houses ────────────────────────────────────────────
  console.log('6️⃣  Creating houses...')
  const { data: houses } = await supabase.from('houses').insert([
    { school_id: school.id, name: 'Red House',    color: '#EF4444' },
    { school_id: school.id, name: 'Blue House',   color: '#3B82F6' },
    { school_id: school.id, name: 'Green House',  color: '#22C55E' },
    { school_id: school.id, name: 'Yellow House', color: '#EAB308' },
  ]).select()
  console.log(`   ✅ Created ${houses!.length} houses\n`)

  // ── 7. Fee heads ─────────────────────────────────────────
  console.log('7️⃣  Creating fee heads...')
  const { data: feeHeads } = await supabase.from('fee_heads').insert([
    { school_id: school.id, name: 'Tuition Fee',   description: 'Monthly tuition charges' },
    { school_id: school.id, name: 'Exam Fee',      description: 'Examination charges' },
    { school_id: school.id, name: 'Annual Fund',   description: 'Annual development charges' },
    { school_id: school.id, name: 'Computer Fee',  description: 'Computer lab charges' },
    { school_id: school.id, name: 'Transport Fee', description: 'School bus charges' },
  ]).select()
  console.log(`   ✅ Created ${feeHeads!.length} fee heads\n`)

  // ── 8. Fee structures for Class 1–12 ────────────────────
  console.log('8️⃣  Creating fee structures...')
  const tuitionHead = feeHeads!.find(f => f.name === 'Tuition Fee')!
  const examHead    = feeHeads!.find(f => f.name === 'Exam Fee')!
  const annualHead  = feeHeads!.find(f => f.name === 'Annual Fund')!

  const tuitionByClass: Record<number, number> = {
    1: 2500, 2: 2500, 3: 2800, 4: 2800, 5: 3000,
    6: 3200, 7: 3200, 8: 3500, 9: 3800, 10: 3800,
    11: 4500, 12: 4500,
  }

  const feeStructureRows: any[] = []
  for (const cls of classes!) {
    const level = cls.numeric_level!
    feeStructureRows.push(
      { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: tuitionHead.id, amount: tuitionByClass[level], frequency: 'monthly', due_day: 10, late_fine_per_day: 5 },
      { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: examHead.id,    amount: 500,                   frequency: 'quarterly' },
      { school_id: school.id, academic_year_id: ay!.id, class_id: cls.id, fee_head_id: annualHead.id,  amount: 5000,                  frequency: 'annually' },
    )
  }
  await supabase.from('fee_structures').insert(feeStructureRows)
  console.log(`   ✅ Created ${feeStructureRows.length} fee structures\n`)

  // ── 9. Inquiry sources ───────────────────────────────────
  console.log('9️⃣  Creating inquiry sources...')
  const { data: sources } = await supabase.from('inquiry_sources').insert([
    { school_id: school.id, name: 'Walk-in' },
    { school_id: school.id, name: 'Website' },
    { school_id: school.id, name: 'Facebook / Social Media' },
    { school_id: school.id, name: 'Referral' },
    { school_id: school.id, name: 'Event' },
  ]).select()
  console.log(`   ✅ Created ${sources!.length} inquiry sources\n`)

  // ── 10. Students ─────────────────────────────────────────
  console.log('🔟  Creating 25 demo students...')

  const firstNames = ['Aarav','Ananya','Rohan','Priya','Vikram','Sneha','Arjun','Kavya','Rahul','Divya','Aditya','Pooja','Karan','Riya','Ishaan','Meera','Siddharth','Nisha','Akash','Sunita','Dev','Tanya','Nikhil','Shreya','Manav']
  const lastNames  = ['Sharma','Gupta','Singh','Verma','Mishra','Agarwal','Tiwari','Pandey','Yadav','Joshi','Srivastava','Kumar','Chauhan','Saxena','Tripathi']

  const classForStudent = [
    1,1,2,2,3,3,4,5,5,6,6,7,7,8,8,9,9,10,10,10,11,11,11,12,12
  ]
  const houseIdx = [0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3,0]
  const genders  = ['male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male']

  const studentRows: any[] = []
  for (let i = 0; i < 25; i++) {
    const cls   = classes!.find(c => c.numeric_level === classForStudent[i])!
    const secs  = sections!.filter(s => s.class_id === cls.id)
    const sec   = secs[i % 2]
    const house = houses![houseIdx[i]]
    studentRows.push({
      school_id:        school.id,
      admission_number: `ADM2024${String(i + 1).padStart(3, '0')}`,
      first_name:       firstNames[i],
      last_name:        lastNames[i % lastNames.length],
      date_of_birth:    `${2010 - classForStudent[i]}-${String((i % 12) + 1).padStart(2,'0')}-${String((i % 28) + 1).padStart(2,'0')}`,
      gender:           genders[i],
      blood_group:      ['A+','B+','O+','AB+','A-','B-'][i % 6],
      academic_year_id: ay!.id,
      class_id:         cls.id,
      section_id:       sec.id,
      roll_number:      String(i % 40 + 1),
      house_id:         house.id,
      status:           'active',
      city:             'Lucknow',
      state:            'Uttar Pradesh',
    })
  }

  const { data: students, error: stuErr } = await supabase.from('students').insert(studentRows).select()
  if (stuErr) { console.error('Students error:', stuErr.message); process.exit(1) }
  console.log(`   ✅ Created ${students!.length} students\n`)

  // ── 11. Parents for each student ────────────────────────
  console.log('1️⃣1️⃣  Creating parent records...')
  const fatherNames = ['Rajesh','Suresh','Mahesh','Ramesh','Dinesh','Ganesh','Naresh','Umesh','Lokesh','Yogesh','Mukesh','Hitesh','Rakesh','Paresh','Jignesh','Alpesh','Bhavesh','Ritesh','Nilesh','Kamlesh','Harish','Manish','Girish','Satish','Jagdish']
  const parentRows = students!.map((s, i) => ({
    school_id:    school.id,
    student_id:   s.id,
    father_name:  `${fatherNames[i]} ${lastNames[i % lastNames.length]}`,
    father_phone: `+91 ${9800000000 + i}`,
    father_email: `parent${i + 1}@gmail.com`,
    mother_name:  `Sunita ${lastNames[i % lastNames.length]}`,
    mother_phone: `+91 ${9700000000 + i}`,
  }))
  await supabase.from('parents').insert(parentRows)
  console.log(`   ✅ Created ${parentRows.length} parent records\n`)

  // ── 12. Fee invoices + some payments ────────────────────
  console.log('1️⃣2️⃣  Creating fee invoices & payments...')
  const invoiceRows: any[] = []
  for (let i = 0; i < students!.length; i++) {
    const s = students![i]
    const cls = classes!.find(c => c.id === s.class_id)!
    const level = cls.numeric_level!
    const tuition = tuitionByClass[level]
    const total = tuition + 500 // tuition + exam

    invoiceRows.push({
      school_id:        school.id,
      student_id:       s.id,
      academic_year_id: ay!.id,
      invoice_number:   `INV2024${String(i + 1).padStart(4, '0')}`,
      invoice_date:     '2024-04-10',
      due_date:         '2024-04-20',
      line_items: [
        { fee_head_id: tuitionHead.id, name: 'Tuition Fee', amount: tuition, discount: 0, net_amount: tuition },
        { fee_head_id: examHead.id,    name: 'Exam Fee',    amount: 500,     discount: 0, net_amount: 500 },
      ],
      subtotal:       total,
      total_discount: 0,
      late_fine:      0,
      total_amount:   total,
      status:         i < 18 ? 'paid' : i < 22 ? 'partial' : 'unpaid',
    })
  }

  const { data: invoices } = await supabase.from('fee_invoices').insert(invoiceRows).select()
  console.log(`   ✅ Created ${invoices!.length} invoices`)

  // Payments for paid + partial invoices
  const paymentRows: any[] = []
  for (let i = 0; i < invoices!.length; i++) {
    const inv = invoices![i]
    if (inv.status === 'paid') {
      paymentRows.push({
        school_id:    school.id,
        invoice_id:   inv.id,
        student_id:   inv.student_id,
        receipt_number: `RCP2024${String(i + 1).padStart(4, '0')}`,
        amount_paid:  inv.total_amount,
        payment_mode: ['cash','upi','neft','card'][i % 4],
        transaction_reference: `TXN${Date.now()}${i}`,
      })
    } else if (inv.status === 'partial') {
      paymentRows.push({
        school_id:    school.id,
        invoice_id:   inv.id,
        student_id:   inv.student_id,
        receipt_number: `RCP2024${String(i + 100).padStart(4, '0')}`,
        amount_paid:  Math.floor(inv.total_amount / 2),
        payment_mode: 'cash',
      })
    }
  }
  await supabase.from('fee_payments').insert(paymentRows)
  console.log(`   ✅ Created ${paymentRows.length} payments\n`)

  // ── 13. Admission inquiries ──────────────────────────────
  console.log('1️⃣3️⃣  Creating admission inquiries...')
  const inquiryStatuses = ['new','new','follow_up','follow_up','interested','interested','documents_submitted','approved','fee_pending','admitted','admitted','admitted','rejected','lost']
  const inquiryNames    = ['Aryan Verma','Sanya Gupta','Rohit Mishra','Pooja Singh','Amit Sharma','Neha Agarwal','Shivam Kumar','Kritika Joshi','Varun Yadav','Anjali Tiwari','Pratik Srivastava','Simran Chauhan','Vivek Saxena','Tanvi Pandey']

  const inquiryRows = inquiryNames.map((name, i) => ({
    school_id:              school.id,
    inquiry_number:         `INQ2024${String(i + 1).padStart(3, '0')}`,
    student_name:           name,
    parent_name:            `Parent of ${name}`,
    parent_phone:           `+91 ${9600000000 + i}`,
    parent_email:           `inquiry${i + 1}@gmail.com`,
    applying_for_class_id:  classes!.find(c => c.numeric_level === (i % 5) + 6)?.id,
    academic_year_id:       ay!.id,
    source_id:              sources![i % sources!.length].id,
    status:                 inquiryStatuses[i],
    notes:                  ['Interested in science stream', 'Needs scholarship info', 'Referred by current parent', 'Wants hostel facility', null][i % 5] as string,
    previous_school:        ['St. Francis School', 'City Montessori', 'Kendriya Vidyalaya', 'Army Public School', 'La Martiniere'][i % 5],
    created_at:             new Date(Date.now() - (14 - i) * 24 * 60 * 60 * 1000).toISOString(),
  }))

  const { data: inquiries } = await supabase.from('admission_inquiries').insert(inquiryRows).select()
  console.log(`   ✅ Created ${inquiries!.length} inquiries\n`)

  // ── Done ─────────────────────────────────────────────────
  console.log('━'.repeat(50))
  console.log('🎉 SEED COMPLETE! Here\'s your demo data:\n')
  console.log(`   🏫  School:    Delhi Public School Lucknow`)
  console.log(`   🔑  Login:     admin@dpslucknow.com`)
  console.log(`   🔑  Password:  Admin@1234`)
  console.log(`   👨‍🎓  Students:  ${students!.length} (across Class 1–12)`)
  console.log(`   📋  Inquiries: ${inquiries!.length} (across all pipeline stages)`)
  console.log(`   💰  Invoices:  ${invoices!.length} (18 paid, 4 partial, 3 unpaid)`)
  console.log(`   💰  Payments:  ${paymentRows.length} recorded`)
  console.log('')
  console.log('   👉  Open http://localhost:3000 and login!')
  console.log('━'.repeat(50))
}

seed().catch(console.error)
