import 'dotenv/config'
import { supabase } from './shared/db/client'
import { seedDefaultRoles, LEGACY_ROLE_TO_RBAC_ROLE } from './modules/rbac/seed'
import { defaultSectionNamesForClass, DEFAULT_CLASSES } from './shared/utils/helpers'
import { seedFees } from './seedFees'
import { seedExtras } from './seedExtras'
import { avatarSvg } from './shared/utils/avatar'
import type { NotificationType } from './shared/utils/notifications'

// ═══════════════════════════════════════════════════════════════
// AIRTEC demo seed — a whole school, not a sample of one.
//
// Sized and shaped for live demos: the guiding rule is that EVERY
// filter combination the UI can produce must land on data. Any class,
// any section, any teacher, any day, any month of the running academic
// year, any status value in any dropdown — there is something behind
// it. That's why the fact tables (attendance, marks, invoices) are
// generated exhaustively per student rather than sampled, and why the
// status/enum spreads below walk the CHECK constraints rather than
// picking two or three convenient values.
//
// Assumes a fresh database: it always INSERTs a new school and never
// upserts, so running it twice would give you two schools — it now refuses
// unless --force. To rebuild fee data on an EXISTING school, use seedFees.ts
// (`npm run seed:fees`), which works in place.
// ═══════════════════════════════════════════════════════════════

// ── Tunables ─────────────────────────────────────────────────
// 47 sections = 13 classes (Nursery→Class 10) × A/B/C + 2 senior classes × 4
// streams. At 40 a section that is 1,880 students, and every per-student
// artefact below scales with it — 45 days of attendance alone is ~85k rows.
const STUDENTS_PER_SECTION = 40   // × 47 sections = 1880 students
const ATTENDANCE_DAYS = 45        // working days of student attendance
const STAFF_ATTENDANCE_DAYS = 45
const PORTAL_FAMILIES = 8         // parent + student logins for the family app
const UPLOAD_CONCURRENCY = 24

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

/** Insert in chunks, log (but don't crash) on error, return inserted rows. */
async function ins(table: string, rows: any[], chunk = 500): Promise<any[]> {
  if (!rows.length) return []
  const out: any[] = []
  for (let i = 0; i < rows.length; i += chunk) {
    const { data, error } = await supabase.from(table).insert(rows.slice(i, i + chunk)).select()
    if (error) { console.error(`   ⚠️  ${table}[${i}]: ${error.message}`); continue }
    out.push(...(data ?? []))
  }
  return out
}

/**
 * Insert without returning the rows. The fact tables here run to tens of
 * thousands of rows and nothing downstream needs their ids back —
 * skipping the RETURNING payload keeps the seed a few minutes shorter.
 */
async function insQuiet(table: string, rows: any[], chunk = 1000): Promise<number> {
  if (!rows.length) return 0
  let n = 0
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const { error } = await supabase.from(table).insert(slice)
    if (error) { console.error(`   ⚠️  ${table}[${i}]: ${error.message}`); continue }
    n += slice.length
  }
  return n
}

/** Bounded-concurrency map — the seed uploads ~900 avatars. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

const pick = <T,>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length]
const rint = (min: number, max: number, seed: number) => min + (seed * 9301 + 49297) % (max - min + 1)
/** Deterministic 0..1 — no Math.random, so re-runs produce the same school. */
const rnd = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x) }
const chance = (seed: number, pct: number) => rnd(seed) * 100 < pct

const today = new Date()
const dMinus = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const isoT = (d: Date) => d.toISOString()
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

// ── Academic calendar: anchored to *today*, so a demo run in any year
//    lands inside a live session rather than a stale hard-coded one. ──
const ayStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
const AY_NAME = `${ayStartYear}-${String((ayStartYear + 1) % 100).padStart(2, '0')}`
const AY_START = `${ayStartYear}-04-01`
const AY_END = `${ayStartYear + 1}-03-31`
const PREV_AY_NAME = `${ayStartYear - 1}-${String(ayStartYear % 100).padStart(2, '0')}`
const PREV_AY_START = `${ayStartYear - 1}-04-01`
const PREV_AY_END = `${ayStartYear}-03-31`
/** Every month of the academic year that has already started. */
const feeMonths: { m: number; y: number }[] = []
for (let k = 0; k < 12; k++) {
  const d = new Date(ayStartYear, 3 + k, 1)
  if (d > today) break
  feeMonths.push({ m: d.getMonth() + 1, y: d.getFullYear() })
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ── Name pools (large enough that 840 students don't all rhyme) ──
const MALE_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advik', 'Rudra', 'Kabir', 'Ayaan', 'Dhruv', 'Rohan', 'Vihaan', 'Yuvraj', 'Karan', 'Nikhil', 'Rahul', 'Siddharth', 'Manav', 'Akash', 'Dev', 'Harsh', 'Kunal', 'Lakshya', 'Naman', 'Om', 'Parth', 'Raghav', 'Sarthak', 'Tanmay', 'Utkarsh', 'Varun', 'Yash', 'Ansh', 'Chirag', 'Gaurav', 'Hrithik']
const FEMALE_NAMES = ['Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Navya', 'Riya', 'Ishita', 'Priya', 'Kavya', 'Divya', 'Pooja', 'Meera', 'Nisha', 'Shreya', 'Tanya', 'Sneha', 'Aditi', 'Bhavya', 'Charvi', 'Esha', 'Gauri', 'Harshita', 'Ira', 'Jhanvi', 'Khushi', 'Lavanya', 'Mahika', 'Nandini', 'Oorja', 'Palak', 'Rhea', 'Sanjana', 'Trisha', 'Vaishnavi', 'Yashvi', 'Zoya', 'Simran']
const LAST_NAMES = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Mishra', 'Agarwal', 'Tiwari', 'Pandey', 'Yadav', 'Joshi', 'Srivastava', 'Kumar', 'Chauhan', 'Saxena', 'Tripathi', 'Dubey', 'Shukla', 'Rastogi', 'Bansal', 'Khanna', 'Kapoor', 'Malhotra', 'Nair', 'Iyer', 'Menon', 'Reddy', 'Rao', 'Bhatt', 'Sethi', 'Chopra']
const FATHER_NAMES = ['Rajesh', 'Suresh', 'Mahesh', 'Ramesh', 'Dinesh', 'Ganesh', 'Naresh', 'Umesh', 'Lokesh', 'Yogesh', 'Mukesh', 'Hitesh', 'Rakesh', 'Paresh', 'Jignesh', 'Alpesh', 'Bhavesh', 'Ritesh', 'Nilesh', 'Kamlesh', 'Harish', 'Manish', 'Girish', 'Satish', 'Jagdish', 'Ashok', 'Vinod', 'Pramod', 'Sanjay', 'Anil']
const MOTHER_NAMES = ['Sunita', 'Anita', 'Kavita', 'Savita', 'Rekha', 'Meena', 'Geeta', 'Seema', 'Neeta', 'Rita', 'Poonam', 'Shobha', 'Usha', 'Lata', 'Asha', 'Nirmala', 'Pushpa', 'Sarita', 'Vandana', 'Archana']

// ── Curriculum ───────────────────────────────────────────────
// Nursery/LKG/UKG sit at numeric_level 0 and below. Without their own list they
// would inherit the primary timetable and be taught EVS and General Knowledge.
const PRE_PRIMARY_SUBJECTS = ['English', 'Hindi', 'Numbers', 'Rhymes & Story', 'Art & Craft']
const PRIMARY_SUBJECTS = ['English', 'Hindi', 'Mathematics', 'EVS', 'General Knowledge', 'Art & Craft']
const MIDDLE_SUBJECTS = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Computer Science']
const STREAM_SUBJECTS: Record<string, string[]> = {
  PCM: ['English', 'Physics', 'Chemistry', 'Mathematics', 'Computer Science'],
  PCB: ['English', 'Physics', 'Chemistry', 'Biology', 'Physical Education'],
  Commerce: ['English', 'Accountancy', 'Business Studies', 'Economics', 'Mathematics'],
  Humanities: ['English', 'History', 'Political Science', 'Geography', 'Economics'],
}
/** Subjects actually taught to one section (stream-aware for 11–12). */
/**
 * What one section is actually taught. Must stay a subset of classSubjects()
 * for the same level — the timetable, exams and homework built from this all
 * store subject_name, and a name outside the class's own subject catalogue is
 * a period nobody can trace back to a subject.
 */
function subjectsFor(level: number, sectionName: string): string[] {
  if (level >= 11) return STREAM_SUBJECTS[sectionName] ?? STREAM_SUBJECTS.PCM
  if (level <= 0) return PRE_PRIMARY_SUBJECTS
  return level <= 5 ? PRIMARY_SUBJECTS : MIDDLE_SUBJECTS
}
/** Everything examinable at a class level — the union across streams. */
function classSubjects(level: number): string[] {
  if (level >= 11) return Array.from(new Set(Object.values(STREAM_SUBJECTS).flat()))
  if (level <= 0) return PRE_PRIMARY_SUBJECTS
  return level <= 5 ? PRIMARY_SUBJECTS : MIDDLE_SUBJECTS
}

// ── Image generation (no deps): initials avatars + a school logo,
//    uploaded to Supabase Storage so photo_url points at a real file. ──
function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="96" fill="#1E3A8A"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="#FACC15" stroke-width="4"/>
  <text x="50%" y="44%" dy=".35em" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-weight="700" fill="#FACC15">DPS</text>
  <text x="50%" y="70%" text-anchor="middle" font-family="Segoe UI, Arial" font-size="16" letter-spacing="2" fill="#ffffff">LUCKNOW</text>
</svg>`
}
/** A stand-in "scanned document" page, one per document type. */
function docSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842">
  <rect width="595" height="842" fill="#ffffff"/>
  <rect x="24" y="24" width="547" height="794" fill="none" stroke="#CBD5E1" stroke-width="2"/>
  <rect x="24" y="24" width="547" height="90" fill="#1E3A8A"/>
  <text x="297" y="70" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#FACC15">Delhi Public School Lucknow</text>
  <text x="297" y="96" text-anchor="middle" font-family="Segoe UI, Arial" font-size="13" fill="#ffffff">Sector B, Vrindavan Yojna, Raebareli Road</text>
  <text x="297" y="190" text-anchor="middle" font-family="Segoe UI, Arial" font-size="22" font-weight="600" fill="#0F172A">${label}</text>
  ${Array.from({ length: 14 }, (_, i) => `<rect x="70" y="${240 + i * 34}" width="${455 - (i % 4) * 60}" height="10" rx="5" fill="#E2E8F0"/>`).join('\n  ')}
  <text x="297" y="770" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12" fill="#64748B">Specimen document — demo data</text>
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
  const startedAt = Date.now()
  console.log(`🌱 Seeding AIRTEC demo school — academic year ${AY_NAME}\n`)

  // ── 0. Storage buckets ───────────────────────────────────
  console.log('0️⃣  Ensuring storage buckets...')
  await ensureBuckets()
  console.log('   ✅ Buckets ready (resources, student-photos, student-documents)\n')

  // ── 1. School (+ logo) ───────────────────────────────────
  //
  // Guard, because this script's whole failure mode is silent duplication: it
  // INSERTs a school unconditionally, so a second run leaves you with two Delhi
  // Public Schools, 2,240 students and every fee figure doubled — with nothing on
  // screen saying which school you are looking at.
  //
  // For regenerating fee data on a school that already exists, use
  // `npm run seed:fees`, which works in place.
  const { data: existing } = await supabase.from('schools').select('id, name')
  const realSchools = (existing ?? []).filter(x => !x.name.startsWith('__vitest'))

  if (realSchools.length && !process.argv.includes('--force')) {
    console.error('\n✖ This database already has a school:\n')
    realSchools.forEach(x => console.error(`   ${x.id}  ${x.name}`))
    console.error(`
  Seeding again would ADD another one, not replace it — every student, invoice
  and payment would be duplicated under a second school.

  What you probably want:
     npm run seed:fees          regenerate fee data on the existing school
     npm run seed -- --force    really do add a second school
`)
    process.exit(1)
  }

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
  const schoolId = (school as any).id
  const logoUrl = await uploadSvg('resources', 'branding/logo.svg', logoSvg())
  if (logoUrl) await supabase.from('schools').update({ logo_url: logoUrl }).eq('id', schoolId)
  console.log(`   ✅ ${(school as any).name} (${schoolId})\n`)

  // ── 2. RBAC roles up front (bulk user_roles later) ───────
  console.log('2️⃣  Seeding RBAC roles & permissions...')
  const roleIdByName = await seedDefaultRoles(schoolId)
  const userRoleRows: any[] = []
  const grantRole = (userId: string, legacyRole: string) => {
    const roleId = roleIdByName[LEGACY_ROLE_TO_RBAC_ROLE[legacyRole] ?? '']
    if (roleId) userRoleRows.push({ user_id: userId, role_id: roleId, school_id: schoolId })
  }
  console.log(`   ✅ ${Object.keys(roleIdByName).length} roles ready\n`)

  // ── 3. Admin auth user + profile ─────────────────────────
  console.log('3️⃣  Creating admin user...')
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: 'admin@dpslucknow.com', password: 'Admin@1234', email_confirm: true,
  })
  if (authErr && !authErr.message.includes('already')) { console.error('Auth error:', authErr.message); process.exit(1) }
  const adminId = authData?.user?.id!
  const adminPhoto = await uploadSvg('student-photos', `staff/admin.svg`, avatarSvg('Abhigyan Tripathi', 2, 'male'))
  if (adminId) {
    await supabase.from('users').insert({
      id: adminId, school_id: schoolId, full_name: 'Abhigyan Tripathi',
      email: 'admin@dpslucknow.com', role: 'school_admin', avatar_url: adminPhoto, phone: '+91 9876543210',
    })
    grantRole(adminId, 'school_admin')
  }
  console.log(`   ✅ admin@dpslucknow.com / Admin@1234\n`)

  // ── 4. Academic years (previous + current) ───────────────
  console.log('4️⃣  Creating academic years...')
  const ayRows = await ins('academic_years', [
    { school_id: schoolId, name: PREV_AY_NAME, start_date: PREV_AY_START, end_date: PREV_AY_END, is_current: false },
    { school_id: schoolId, name: AY_NAME, start_date: AY_START, end_date: AY_END, is_current: true },
  ])
  const prevAy = ayRows.find(a => a.name === PREV_AY_NAME)!
  const ay = ayRows.find(a => a.name === AY_NAME)!
  console.log(`   ✅ ${PREV_AY_NAME} (past) + ${AY_NAME} (current)\n`)

  // ── 5. Classes: Nursery → Class 12 ───────────────────────
  console.log('5️⃣  Creating classes...')
  const classes = await ins('classes', DEFAULT_CLASSES.map(c => ({ school_id: schoolId, ...c })))
  classes.sort((a, b) => a.numeric_level - b.numeric_level)
  console.log(`   ✅ ${classes.length} classes\n`)

  // ── 6. Sections (streams for 11 & 12) ────────────────────
  console.log('6️⃣  Creating sections...')
  const sections = await ins('sections', classes.flatMap(c =>
    defaultSectionNamesForClass(c.numeric_level).map(name => ({
      school_id: schoolId, class_id: c.id, name, max_strength: 40,
    }))
  ))
  const classById: Record<string, any> = Object.fromEntries(classes.map(c => [c.id, c]))
  const levelOf = (sec: any) => classById[sec.class_id].numeric_level
  sections.sort((a, b) => levelOf(a) - levelOf(b) || a.name.localeCompare(b.name))
  console.log(`   ✅ ${sections.length} sections across ${classes.length} classes\n`)

  // ── 7. Houses ────────────────────────────────────────────
  console.log('7️⃣  Creating houses...')
  const houses = await ins('houses', [
    { school_id: schoolId, name: 'Red House', color: '#EF4444' },
    { school_id: schoolId, name: 'Blue House', color: '#3B82F6' },
    { school_id: schoolId, name: 'Green House', color: '#22C55E' },
    { school_id: schoolId, name: 'Yellow House', color: '#EAB308' },
  ])
  console.log(`   ✅ ${houses.length} houses\n`)

  // ── 8. Fees: see the seedFees run at the end ─────────────
  //
  // Everything fee-shaped used to be built here, against the pre-rewrite
  // schema: fee_heads with no code, and one fee_structures row per
  // class × head carrying its own amount and frequency. The 20260809 rewrite
  // moved all of that — heads gained a NOT NULL code, and a structure became a
  // named, versioned plan whose amounts live in fee_structure_lines and whose
  // classes live in fee_structure_classes. This block had not been updated, so
  // a full reseed died on the first insert with "null value in column code".
  //
  // Rather than maintain a second, drifting implementation of the fee model,
  // fee data is now built by seedFees() at the very end of this script — the
  // same code `npm run seed:fees` runs, which is written against the current
  // schema and is what the earlier guidance already pointed people at.

  // ── 9. Inquiry sources ───────────────────────────────────
  console.log('9️⃣  Creating inquiry sources...')
  const sources = await ins('inquiry_sources', [
    { school_id: schoolId, name: 'Walk-in' }, { school_id: schoolId, name: 'Website' },
    { school_id: schoolId, name: 'Facebook / Social Media' }, { school_id: schoolId, name: 'Referral' },
    { school_id: schoolId, name: 'Event' }, { school_id: schoolId, name: 'Newspaper Ad' },
    { school_id: schoolId, name: 'Hoarding' },
  ])
  console.log(`   ✅ ${sources.length} inquiry sources\n`)

  // ── 10. Subjects, per class ──────────────────────────────
  //
  // subjects.class_id decides which class a subject belongs to, and
  // GET /admission/subjects treats a NULL class_id as "every class" — so the
  // old flat insert, which set no class_id at all, put the entire catalogue
  // under every class. Settings showed Class 1 offering Accountancy, Physics
  // and Political Science, and Timetable/Homework/Syllabus offered the same
  // list to pick from.
  //
  // Each class now gets exactly the subjects it is taught: the pre-primary
  // list for Nursery–UKG, primary for 1–5, middle for 6–10, and the union of
  // the four streams for 11–12 (a section there is a stream, so PCM and
  // Commerce draw from one class-level list).
  console.log('🔟  Creating subjects...')
  const SUBJECT_CODES: Record<string, string> = {
    English: 'ENG', Hindi: 'HIN', Mathematics: 'MAT', Science: 'SCI',
    'Social Science': 'SST', EVS: 'EVS', 'Computer Science': 'CS', Physics: 'PHY',
    Chemistry: 'CHE', Biology: 'BIO', Accountancy: 'ACC', 'Business Studies': 'BST',
    Economics: 'ECO', History: 'HIS', 'Political Science': 'POL', Geography: 'GEO',
    'Physical Education': 'PE', 'Art & Craft': 'ART', 'General Knowledge': 'GK',
    Music: 'MUS', Numbers: 'NUM', 'Rhymes & Story': 'RHY',
  }
  const ELECTIVES = new Set(['Physical Education', 'Art & Craft', 'General Knowledge', 'Music'])
  const subjectRows = classes.flatMap(cls =>
    classSubjects(cls.numeric_level).map(name => ({
      school_id: schoolId, class_id: cls.id, name,
      code: SUBJECT_CODES[name] ?? name.slice(0, 3).toUpperCase(),
      is_elective: ELECTIVES.has(name),
    })))
  await ins('subjects', subjectRows)
  console.log(`   ✅ ${subjectRows.length} subjects across ${classes.length} classes\n`)

  // ── 11. Staff (auth users + profiles + photos) ───────────
  console.log('1️⃣1️⃣  Creating staff (this makes one auth user per person)...')
  // Enough teachers that the timetable can fill 47 sections × every
  // period without double-booking anyone — see the conflict map below.
  //
  // The count also has to clear the section count outright, because class
  // teachers are handed out one per section below: with fewer teachers than
  // sections the assignment wraps and somebody becomes homeroom teacher of two
  // classes at once, which is not a thing.
  const teacherSpecialities = [
    'Mathematics', 'Mathematics', 'Mathematics', 'Mathematics', 'English', 'English', 'English', 'English',
    'Hindi', 'Hindi', 'Hindi', 'Science', 'Science', 'Science', 'Social Science', 'Social Science', 'Social Science',
    'Computer Science', 'Computer Science', 'Physics', 'Physics', 'Chemistry', 'Chemistry', 'Biology',
    'Accountancy', 'Business Studies', 'Economics', 'History', 'Political Science', 'Geography',
    'EVS', 'EVS', 'General Knowledge', 'Art & Craft', 'Physical Education', 'Music', 'English', 'Mathematics',
    // The pre-primary wing and the third section added across Nursery–Class 10.
    'English', 'English', 'Hindi', 'Hindi', 'Mathematics', 'Mathematics',
    'EVS', 'General Knowledge', 'Art & Craft', 'Music', 'Science', 'Social Science',
  ]
  const staffDefs: { name: string; role: string; designation: string; dept: string; subject: string | null }[] = [
    { name: 'Ramesh Chandra', role: 'principal', designation: 'Principal', dept: 'Administration', subject: null },
    { name: 'Sunita Rao', role: 'principal', designation: 'Vice Principal', dept: 'Administration', subject: null },
    { name: 'Manoj Agrawal', role: 'accountant', designation: 'Accounts Officer', dept: 'Accounts', subject: null },
    { name: 'Shalini Bose', role: 'accountant', designation: 'Fee Clerk', dept: 'Accounts', subject: null },
    { name: 'Priyanka Sethi', role: 'counselor', designation: 'Admission Counselor', dept: 'Admissions', subject: null },
    { name: 'Farhan Qureshi', role: 'counselor', designation: 'Student Counselor', dept: 'Admissions', subject: null },
    { name: 'Neha Bansal', role: 'teacher', designation: 'Librarian', dept: 'Library', subject: null },
  ]
  const teacherFirst = [...MALE_NAMES.slice(10), ...FEMALE_NAMES.slice(10)]
  teacherSpecialities.forEach((subject, i) => {
    const name = `${pick(teacherFirst, i * 3 + 1)} ${pick(LAST_NAMES, i * 5 + 2)}`
    const senior = i % 3 === 0
    staffDefs.push({
      name, role: 'teacher',
      designation: `${senior ? 'PGT' : i % 3 === 1 ? 'TGT' : 'PRT'} ${subject}`,
      dept: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Science', 'EVS'].includes(subject) ? 'Science & Maths'
        : ['English', 'Hindi'].includes(subject) ? 'Languages'
          : ['History', 'Political Science', 'Geography', 'Economics', 'Social Science'].includes(subject) ? 'Humanities'
            : ['Accountancy', 'Business Studies'].includes(subject) ? 'Commerce'
              : ['Computer Science'].includes(subject) ? 'Computer' : 'Co-curricular',
      subject,
    })
  })

  const staff: { id: string; name: string; role: string; designation: string; dept: string; subject: string | null; photo: string | null }[] = []
  const usedEmails = new Set<string>(['admin@dpslucknow.com'])
  const staffPhotos = await mapLimit(staffDefs, UPLOAD_CONCURRENCY, (s, i) =>
    // Same gender rule the staff_profiles rows use below, so the face
    // matches the record.
    uploadSvg('student-photos', `staff/${i + 1}-${s.name.toLowerCase().replace(/\s+/g, '-')}.svg`,
      avatarSvg(s.name, i + 3, i % 5 === 0 || i % 5 === 2 ? 'female' : 'male')))

  const staffUserRows: any[] = []
  const staffProfileRows: any[] = []
  for (let i = 0; i < staffDefs.length; i++) {
    const s = staffDefs[i]
    let email = s.name.toLowerCase().replace(/\s+/g, '.') + '@dpslucknow.com'
    if (usedEmails.has(email)) email = email.replace('@', `${i}@`)
    usedEmails.add(email)
    const { data: au, error: aerr } = await supabase.auth.admin.createUser({ email, password: 'Staff@1234', email_confirm: true })
    if (aerr && !aerr.message.includes('already')) { console.error(`   ⚠️  staff auth ${email}: ${aerr.message}`); continue }
    const uid = au?.user?.id
    if (!uid) continue
    const photo = staffPhotos[i]
    staff.push({ id: uid, name: s.name, role: s.role, designation: s.designation, dept: s.dept, subject: s.subject, photo })
    staffUserRows.push({ id: uid, school_id: schoolId, full_name: s.name, email, role: s.role, avatar_url: photo, phone: `+91 ${9500000000 + i}` })
    staffProfileRows.push({
      school_id: schoolId, user_id: uid, employee_id: `EMP${String(i + 1).padStart(3, '0')}`,
      designation: s.designation, department: s.dept, date_of_joining: iso(dMinus(300 + i * 21)),
      date_of_birth: `19${70 + (i % 25)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      gender: i % 5 === 0 || i % 5 === 2 ? 'female' : 'male',
      qualification: s.subject ? `M.Sc / B.Ed (${s.subject})` : 'M.A / B.Ed', experience_years: 2 + (i % 18),
      phone: `+91 ${9500000000 + i}`, personal_email: email, city: 'Lucknow', state: 'Uttar Pradesh',
      emergency_contact_name: `${pick(FATHER_NAMES, i)} ${pick(LAST_NAMES, i)}`, emergency_contact_phone: `+91 ${9400000000 + i}`,
      bank_name: pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank'], i), bank_account_number: `50100${String(100000 + i)}`, bank_ifsc: 'HDFC0001234',
      pan_number: `ABCDE${1000 + i}F`, photo_url: photo,
      // Every employment_type and employment_status value the HR filters
      // offer needs at least one person behind it.
      employment_type: i % 17 === 5 ? 'part_time' : i % 17 === 9 ? 'contract' : i % 17 === 13 ? 'probation' : 'full_time',
      employment_status: i % 19 === 7 ? 'on_leave' : i % 29 === 11 ? 'resigned' : i % 31 === 13 ? 'suspended' : i === 41 ? 'terminated' : 'active',
    })
  }
  await ins('users', staffUserRows)
  await ins('staff_profiles', staffProfileRows)
  staff.forEach(s => grantRole(s.id, s.role))
  const teachers = staff.filter(s => s.role === 'teacher')
  const subjectTeachers = (sub: string) => teachers.filter(t => t.subject === sub)
  const anyTeacher = () => teachers[0]?.id ?? adminId
  const accountantId = staff.find(s => s.role === 'accountant')?.id ?? adminId
  const counselorId = staff.find(s => s.role === 'counselor')?.id ?? adminId
  const principalId = staff.find(s => s.designation === 'Principal')?.id ?? adminId
  console.log(`   ✅ ${staff.length} staff (${teachers.length} teachers), password: Staff@1234\n`)

  // Class teachers — one per section, for the CURRENT academic year.
  // Per-year now (class_teacher_assignments), not a static column on
  // sections — sections.class_teacher_id no longer exists (see
  // supabase/migrations/20260801000000_teacher_dashboard.sql), so this
  // is also seeded data's only record of "who's the homeroom teacher".
  const sectionClassTeacher = new Map<string, string>()
  const classTeacherRoleId = roleIdByName['Class Teacher']
  const classTeacherAssignmentRows: any[] = []
  for (let i = 0; i < sections.length; i++) {
    const t = teachers[i % teachers.length]
    sectionClassTeacher.set(sections[i].id, t.id)
    classTeacherAssignmentRows.push({
      school_id: schoolId, teacher_id: t.id, section_id: sections[i].id, academic_year_id: ay.id, is_active: true,
    })
    if (classTeacherRoleId) userRoleRows.push({ user_id: t.id, role_id: classTeacherRoleId, school_id: schoolId })
  }
  await ins('class_teacher_assignments', classTeacherAssignmentRows)

  // ── 12. Students (every section filled) ──────────────────
  console.log(`1️⃣2️⃣  Creating ~${sections.length * STUDENTS_PER_SECTION} students...`)
  const studentRows: any[] = []
  let admissionSeq = 0
  sections.forEach((sec, secIdx) => {
    const lvl = levelOf(sec)
    for (let r = 0; r < STUDENTS_PER_SECTION; r++) {
      const seed = secIdx * 100 + r
      const isMale = seed % 2 === 0
      const first = isMale ? pick(MALE_NAMES, seed * 3 + secIdx) : pick(FEMALE_NAMES, seed * 5 + secIdx)
      const last = pick(LAST_NAMES, seed * 7 + secIdx * 3)
      admissionSeq++
      // Status spread: the students page filter offers all five values.
      const status = seed % 97 === 3 ? 'inactive'
        : seed % 89 === 5 ? 'transferred'
          : seed % 101 === 7 ? 'suspended'
            : lvl === 12 && seed % 53 === 11 ? 'passed_out' : 'active'
      studentRows.push({
        school_id: schoolId, admission_number: `ADM${ayStartYear}${String(admissionSeq).padStart(4, '0')}`,
        first_name: first, last_name: last,
        date_of_birth: `${ayStartYear - 5 - lvl}-${String((seed % 12) + 1).padStart(2, '0')}-${String((seed % 28) + 1).padStart(2, '0')}`,
        gender: isMale ? 'male' : 'female',
        blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-', 'AB-'], seed),
        aadhaar_number: `${2000 + (seed % 8000)} ${1000 + (seed % 9000)} ${1000 + (secIdx * 7 + r) % 9000}`,
        religion: pick(['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist'], seed),
        caste_category: pick(['General', 'OBC', 'SC', 'ST', 'EWS'], seed * 3),
        permanent_address: `${100 + (seed % 800)}, ${pick(['Gomti Nagar', 'Indira Nagar', 'Aliganj', 'Hazratganj', 'Vrindavan Yojna', 'Jankipuram', 'Rajajipuram'], seed)}`,
        city: 'Lucknow', state: 'Uttar Pradesh', pincode: pick(['226010', '226016', '226024', '226025', '226021'], seed),
        phone: `+91 ${9300000000 + admissionSeq}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${admissionSeq}@student.example.com`,
        academic_year_id: ay.id, class_id: sec.class_id, section_id: sec.id,
        roll_number: String(r + 1), stream: lvl >= 11 ? sec.name : null,
        house_id: houses[(secIdx + r) % houses.length].id,
        is_house_captain: r === 0 && secIdx % 7 === 0,
        is_house_vice_captain: r === 1 && secIdx % 7 === 0,
        is_school_captain: secIdx === sections.length - 1 && r === 0,
        is_school_vice_captain: secIdx === sections.length - 1 && r === 1,
        status,
      })
    }
  })
  const students = await ins('students', studentRows, 400)
  console.log(`   ✅ ${students.length} students created`)

  // Photos for every student.
  console.log('      uploading student photos...')
  const studentPhotos = await mapLimit(students, UPLOAD_CONCURRENCY, (s, i) =>
    uploadSvg('student-photos', `students/${s.id}.svg`, avatarSvg(`${s.first_name} ${s.last_name}`, i, s.gender)))
  let photoCount = 0
  for (let i = 0; i < students.length; i += 200) {
    const slice = students.slice(i, i + 200)
    await Promise.all(slice.map((s, k) => {
      const url = studentPhotos[i + k]
      if (!url) return Promise.resolve()
      photoCount++
      return supabase.from('students').update({ photo_url: url }).eq('id', s.id)
    }))
  }
  students.forEach((s, i) => { s.photo_url = studentPhotos[i] })
  console.log(`   ✅ ${photoCount} student photos uploaded & linked\n`)

  const studentsBySection: Record<string, any[]> = {}
  students.forEach(s => { (studentsBySection[s.section_id] = studentsBySection[s.section_id] || []).push(s) })

  // ── 13. Parents ──────────────────────────────────────────
  console.log('1️⃣3️⃣  Creating parent records...')
  const parents = await ins('parents', students.map((s, i) => ({
    school_id: schoolId, student_id: s.id,
    father_name: `${pick(FATHER_NAMES, i * 3)} ${s.last_name}`, father_phone: `+91 ${9800000000 + i}`,
    father_email: `father${i + 1}@example.com`, father_occupation: pick(['Business', 'Government Service', 'Private Service', 'Doctor', 'Engineer', 'Advocate', 'Farmer', 'Teacher'], i),
    father_aadhaar: `${3000 + (i % 6000)} ${2000 + (i % 7000)} ${1000 + (i % 8000)}`,
    mother_name: `${pick(MOTHER_NAMES, i * 5)} ${s.last_name}`, mother_phone: `+91 ${9700000000 + i}`,
    mother_email: `mother${i + 1}@example.com`, mother_occupation: pick(['Homemaker', 'Teacher', 'Doctor', 'Private Service', 'Business', 'Government Service'], i),
    mother_aadhaar: `${4000 + (i % 5000)} ${3000 + (i % 6000)} ${2000 + (i % 7000)}`,
    guardian_name: i % 11 === 0 ? `${pick(FATHER_NAMES, i + 7)} ${s.last_name}` : null,
    guardian_phone: i % 11 === 0 ? `+91 ${9600000000 + i}` : null,
    guardian_relation: i % 11 === 0 ? pick(['Uncle', 'Grandfather', 'Elder Brother'], i) : null,
    annual_income: 300000 + (i % 20) * 75000,
  })), 400)
  console.log(`   ✅ ${parents.length} parent records\n`)

  // ── 14. Student documents ────────────────────────────────
  console.log('1️⃣4️⃣  Creating student documents...')
  const docTypes = ['aadhaar', 'birth_certificate', 'marksheet', 'address_proof', 'medical', 'photo_id', 'transfer_certificate', 'other']
  const docFileUrls: Record<string, string | null> = {}
  for (const dt of docTypes) {
    docFileUrls[dt] = await uploadSvg('student-documents', `specimens/${dt}.svg`, docSvg(dt.replace(/_/g, ' ').toUpperCase()))
  }
  const docRows: any[] = []
  students.forEach((s, i) => {
    // 4 documents each, rotated so every document_type is represented.
    for (let j = 0; j < 4; j++) {
      const dt = pick(docTypes, i + j)
      docRows.push({
        school_id: schoolId, student_id: s.id, document_type: dt,
        document_name: `${dt.replace(/_/g, ' ')} — ${s.first_name} ${s.last_name}`,
        file_url: docFileUrls[dt] ?? logoUrl ?? 'https://example.com/doc.pdf',
        mime_type: 'image/svg+xml', file_size: `${80 + ((i + j) % 400)}KB`,
        notes: j === 0 ? 'Verified at admission' : null, uploaded_by: adminId,
      })
    }
  })
  const docCount = await insQuiet('student_documents', docRows)
  console.log(`   ✅ ${docCount} student documents (${docTypes.length} specimen files)\n`)

  // ── 15. Family portal logins (parent + student) ──────────
  console.log('1️⃣5️⃣  Creating family portal accounts...')
  // A working family-app login needs two things, not one: a users row
  // with a NON_STAFF_ROLES role, AND the students.user_id /
  // parents.user_id link that resolveOwnStudentId() walks to answer
  // "which student is this?". Spread across classes so the demo can
  // show a primary-school parent and a Class 12 student.
  const portalStudents = Array.from({ length: PORTAL_FAMILIES }, (_, k) =>
    students[Math.floor((k * students.length) / PORTAL_FAMILIES)]).filter(Boolean)
  const portalUserRows: any[] = []
  // students.user_id / parents.user_id are FKs to users(id), so the links
  // can only be written after the users rows land — collected here and
  // applied below the batch insert, not inline in the loop.
  const portalLinks: { table: string; id: string; patch: any; label: string }[] = []
  const portalCreds: string[] = []
  for (const st of portalStudents) {
    const studentName = `${st.first_name} ${st.last_name}`
    const slug = (n: string) => n.trim().toLowerCase().replace(/\s+/g, '.')
    const cls = classById[st.class_id]

    const sEmail = `${slug(studentName)}${st.roll_number}@student.dpslucknow.com`
    const { data: sAu, error: sErr } = await supabase.auth.admin.createUser({ email: sEmail, password: 'Student@1234', email_confirm: true })
    if (sErr && !sErr.message.includes('already')) console.error(`   ⚠️  student auth ${sEmail}: ${sErr.message}`)
    const sUid = sAu?.user?.id
    if (sUid) {
      portalUserRows.push({ id: sUid, school_id: schoolId, full_name: studentName, email: sEmail, role: 'student', phone: st.phone, avatar_url: st.photo_url ?? null })
      portalLinks.push({ table: 'students', id: st.id, patch: { user_id: sUid }, label: sEmail })
      portalCreds.push(`student  ${sEmail} / Student@1234  (${cls.name}-${sections.find(x => x.id === st.section_id)?.name})`)
    }

    const parent = parents.find(p => p.student_id === st.id)
    if (!parent) { console.error(`   ⚠️  no parents row for ${studentName}`); continue }
    const parentName = parent.father_name ?? `Parent of ${studentName}`
    const pEmail = `${slug(parentName)}${st.roll_number}@parent.dpslucknow.com`
    const { data: pAu, error: pErr } = await supabase.auth.admin.createUser({ email: pEmail, password: 'Parent@1234', email_confirm: true })
    if (pErr && !pErr.message.includes('already')) console.error(`   ⚠️  parent auth ${pEmail}: ${pErr.message}`)
    const pUid = pAu?.user?.id
    if (pUid) {
      portalUserRows.push({ id: pUid, school_id: schoolId, full_name: parentName, email: pEmail, role: 'parent', phone: parent.father_phone })
      portalLinks.push({ table: 'parents', id: parent.id, patch: { user_id: pUid, father_email: pEmail }, label: pEmail })
      portalCreds.push(`parent   ${pEmail} / Parent@1234   (parent of ${studentName})`)
    }
  }
  await ins('users', portalUserRows)
  for (const l of portalLinks) {
    const { error } = await supabase.from(l.table).update(l.patch).eq('id', l.id)
    if (error) console.error(`   ⚠️  link ${l.table} ${l.label}: ${error.message}`)
  }
  portalUserRows.forEach(u => grantRole(u.id, u.role))
  console.log(`   ✅ ${portalUserRows.length} portal accounts across ${portalStudents.length} families\n`)

  // All RBAC assignments in one insert.
  await ins('user_roles', userRoleRows, 500)

  // ── 16-17. Fees: built by seedFees() at the end ──────────
  //
  // Invoices, payments, installments, arrears, discounts and ad-hoc charges
  // were all written here against the pre-rewrite fee schema — fee_invoices
  // with total_discount/late_fine, a fee_installments table, discounts keyed
  // straight to a fee_head. None of those shapes survive the 20260809 rewrite.
  //
  // seedFees() at the end of this script builds the whole fee stack against
  // the current model: heads with codes, versioned structures with lines and
  // class links, assignments, then invoices, payments and allocations with
  // their ledger postings — which this block never wrote at all, so a seeded
  // school had invoices the reconciliation report could not explain.

  // ── 18. Admission pipeline (+ documents, history, workflow) ──
  console.log('1️⃣8️⃣  Creating admission pipeline...')
  const inquiryStatuses = ['new', 'follow_up', 'interested', 'documents_submitted', 'entrance_exam', 'approved', 'fee_pending', 'admitted', 'rejected', 'lost']
  const inquiries = await ins('admission_inquiries', Array.from({ length: 45 }, (_, i) => {
    const name = `${i % 2 === 0 ? pick(MALE_NAMES, i * 3) : pick(FEMALE_NAMES, i * 3)} ${pick(LAST_NAMES, i * 5)}`
    return {
      school_id: schoolId, inquiry_number: `INQ${ayStartYear}${String(i + 1).padStart(3, '0')}`, student_name: name,
      parent_name: `${pick(FATHER_NAMES, i)} ${pick(LAST_NAMES, i * 5)}`, parent_phone: `+91 ${9600000000 + i}`,
      parent_email: `inquiry${i + 1}@example.com`,
      applying_for_class_id: pick(classes, i).id, academic_year_id: ay.id,
      source_id: pick(sources, i).id, status: pick(inquiryStatuses, i),
      notes: pick(['Interested in science stream', 'Needs scholarship info', 'Referred by current parent', 'Wants hostel facility', 'Enquired about transport', 'Asked about CBSE results'], i),
      previous_school: pick(['St. Francis School', 'City Montessori', 'Kendriya Vidyalaya', 'Army Public School', 'La Martiniere', 'Seth M.R. Jaipuria'], i),
      created_at: isoT(dMinus(45 - i)),
    }
  }))
  await ins('inquiry_follow_ups', inquiries.flatMap((inq, i) => Array.from({ length: (i % 3) + 1 }, (_, k) => ({
    inquiry_id: inq.id, counselor_id: counselorId, follow_up_date: isoT(dMinus(30 - i + k)),
    channel: pick(['call', 'whatsapp', 'email', 'visit', 'sms'], i + k),
    notes: pick(['Discussed fee structure', 'Shared prospectus', 'Scheduled campus visit', 'Answered curriculum queries', 'Sent admission form'], i + k),
    outcome: pick(['Interested', 'Will decide soon', 'Wants to visit', 'Comparing options', 'Positive'], i + k),
    next_follow_up_date: isoT(dMinus(-(i % 7) - 2)),
  }))))
  const appStatuses = ['pending', 'counselor_approved', 'documents_verified', 'fee_paid', 'principal_approved', 'admitted', 'rejected']
  const applications = await ins('admission_applications', Array.from({ length: 35 }, (_, i) => ({
    school_id: schoolId, application_number: `APP${ayStartYear}${String(i + 1).padStart(3, '0')}`,
    student_first_name: i % 2 === 0 ? pick(MALE_NAMES, i * 7) : pick(FEMALE_NAMES, i * 7),
    student_last_name: pick(LAST_NAMES, i * 3),
    date_of_birth: `${ayStartYear - 6 - (i % 10)}-${String((i % 12) + 1).padStart(2, '0')}-12`,
    gender: i % 2 === 0 ? 'male' : 'female',
    father_name: `${pick(FATHER_NAMES, i)} ${pick(LAST_NAMES, i * 3)}`, father_phone: `+91 ${9200000000 + i}`,
    mother_name: `${pick(MOTHER_NAMES, i)} ${pick(LAST_NAMES, i * 3)}`, mother_phone: `+91 ${9100000000 + i}`,
    applying_for_class_id: pick(classes, i).id, academic_year_id: ay.id,
    previous_school: pick(['St. Francis School', 'City Montessori', 'Kendriya Vidyalaya'], i),
    status: pick(appStatuses, i), application_fee_paid: i % 3 !== 0, application_fee_amount: 1000,
  })))
  await insQuiet('application_documents', applications.flatMap((app, i) =>
    ['birth_certificate', 'aadhaar', 'marksheet', 'address_proof'].map((dt, k) => ({
      application_id: app.id, document_type: dt,
      document_name: `${dt.replace(/_/g, ' ')} — ${app.student_first_name} ${app.student_last_name}`,
      file_url: docFileUrls[dt] ?? logoUrl ?? 'https://example.com/doc.pdf',
      is_verified: appStatuses.indexOf(app.status) >= 2 || k < 2,
      verified_by: appStatuses.indexOf(app.status) >= 2 ? counselorId : null,
      verified_at: appStatuses.indexOf(app.status) >= 2 ? isoT(dMinus(20 - (i % 15))) : null,
    }))))
  // Approval workflow behind admissions.
  const wfDef = (await ins('workflow_definitions', [{
    school_id: schoolId, name: 'Admission Approval', module: 'admission', entity_type: 'admission_application',
    description: 'Counselor → Principal → Admin sign-off for new admissions', is_active: true,
  }]))[0]
  const wfSteps = wfDef ? await ins('workflow_steps', [
    { workflow_id: wfDef.id, step_order: 1, role_id: roleIdByName['Counselor'], action_name: 'Counselor Review', is_required: true },
    { workflow_id: wfDef.id, step_order: 2, role_id: roleIdByName['Principal'], action_name: 'Principal Approval', is_required: true },
    { workflow_id: wfDef.id, step_order: 3, role_id: roleIdByName['School Admin'], action_name: 'Admission Confirmation', is_required: true },
  ].filter(s => s.role_id)) : []
  if (wfDef && wfSteps.length) {
    const instances = await ins('workflow_instances', applications.slice(0, 18).map((app, i) => ({
      school_id: schoolId, workflow_id: wfDef.id, entity_type: 'admission_application', entity_id: app.id,
      status: i % 6 === 0 ? 'approved' : i % 7 === 0 ? 'rejected' : i % 11 === 0 ? 'cancelled' : 'in_progress',
      current_step_id: wfSteps[i % wfSteps.length].id, initiated_by: counselorId,
      completed_at: i % 6 === 0 ? isoT(dMinus(10 - (i % 8))) : null,
    })))
    await insQuiet('workflow_approvals', instances.flatMap((inst, i) =>
      wfSteps.slice(0, (i % wfSteps.length) + 1).map((step, k) => ({
        workflow_instance_id: inst.id, workflow_step_id: step.id,
        approved_by: k === 0 ? counselorId : k === 1 ? principalId : adminId,
        status: inst.status === 'rejected' && k === (i % wfSteps.length) ? 'rejected' : k === 2 && i % 5 === 0 ? 'escalated' : i % 9 === 0 ? 'commented' : 'approved',
        notes: pick(['Verified documents', 'Meets admission criteria', 'Seat available', 'Escalating to management', 'Awaiting fee confirmation'], i + k),
      }))))
  }
  console.log(`   ✅ ${inquiries.length} inquiries, ${applications.length} applications + docs/history/workflow\n`)

  // ── 19. Exams, exam schedule, marks & report cards ───────
  console.log('1️⃣9️⃣  Creating exams, marks & report cards...')
  const examDefs = [
    { name: `Unit Test 1 (${AY_NAME})`, type: 'unit_test', status: 'result_declared', off: 100, graded: true },
    { name: 'Half Yearly Examination', type: 'half_yearly', status: 'result_declared', off: 70, graded: true },
    { name: 'Unit Test 2', type: 'unit_test', status: 'completed', off: 30, graded: true },
    { name: 'Monthly Test', type: 'monthly', status: 'ongoing', off: 3, graded: false },
    { name: 'Practical Examination', type: 'practical', status: 'published', off: -12, graded: false },
    { name: 'Pre-Board 1', type: 'pre_board', status: 'published', off: -25, graded: false },
    { name: 'Pre-Board 2', type: 'pre_board', status: 'draft', off: -50, graded: false },
    { name: 'Annual Examination', type: 'annual', status: 'draft', off: -80, graded: false },
    { name: 'Surprise Test', type: 'other', status: 'draft', off: -5, graded: false },
  ]
  const exams = await ins('exams', examDefs.map(e => ({
    school_id: schoolId, academic_year_id: ay.id, name: e.name, exam_type: e.type,
    start_date: iso(dMinus(e.off)), end_date: iso(dMinus(e.off - 6)), status: e.status,
    grading_system: pick(['marks', 'marks', 'grades', 'cgpa'], examDefs.indexOf(e)), created_by: adminId,
  })))
  // A datesheet for EVERY exam × EVERY class, so the exam schedule screen
  // is never empty whichever exam/class the presenter picks.
  const examSubjectRows: any[] = []
  exams.forEach((ex, ei) => {
    classes.forEach(cls => {
      classSubjects(cls.numeric_level).forEach((sub, si) => {
        const d = new Date(ex.start_date); d.setDate(d.getDate() + si)
        examSubjectRows.push({
          school_id: schoolId, exam_id: ex.id, class_id: cls.id, subject_name: sub,
          exam_date: iso(d), start_time: si % 2 === 0 ? '09:00' : '13:00', end_time: si % 2 === 0 ? '12:00' : '16:00',
          max_marks: 100, pass_marks: 33,
        })
      })
    })
  })
  const examSubjects = await ins('exam_subjects', examSubjectRows, 500)
  const esByExamClass: Record<string, any[]> = {}
  examSubjects.forEach(es => { (esByExamClass[`${es.exam_id}:${es.class_id}`] = esByExamClass[`${es.exam_id}:${es.class_id}`] || []).push(es) })

  const markRows: any[] = []
  const reportRows: any[] = []
  const gradedExams = exams.filter((_, i) => examDefs[i].graded)
  for (const ex of gradedExams) {
    for (const sec of sections) {
      const lvl = levelOf(sec)
      const taught = subjectsFor(lvl, sec.name)
      const secStudents = studentsBySection[sec.id] ?? []
      const cardsForSection: any[] = []
      for (const stu of secStudents) {
        const subs = (esByExamClass[`${ex.id}:${stu.class_id}`] ?? []).filter(es => taught.includes(es.subject_name))
        if (!subs.length) continue
        let total = 0, obtained = 0
        subs.forEach((es, k) => {
          const m = rint(28, 99, Number(stu.roll_number) * 3 + k * 7 + stu.first_name.length + ex.name.length)
          total += Number(es.max_marks); obtained += m
          markRows.push({
            school_id: schoolId, exam_id: ex.id, exam_subject_id: es.id, student_id: stu.id,
            marks_obtained: m, grade: m >= 90 ? 'A1' : m >= 75 ? 'A2' : m >= 60 ? 'B1' : m >= 45 ? 'B2' : m >= 33 ? 'C' : 'D',
            remarks: m >= 90 ? 'Outstanding' : m < 33 ? 'Needs improvement' : null,
            entered_by: sectionClassTeacher.get(sec.id) ?? anyTeacher(),
          })
        })
        const pct = Math.round((obtained / total) * 1000) / 10
        cardsForSection.push({
          school_id: schoolId, exam_id: ex.id, student_id: stu.id, total_marks: total, obtained_marks: obtained,
          percentage: pct, grade: pct >= 90 ? 'A1' : pct >= 75 ? 'A2' : pct >= 60 ? 'B1' : pct >= 45 ? 'B2' : 'C',
          is_pass: pct >= 33, published_at: ex.status === 'result_declared' ? isoT(dMinus(5)) : null,
        })
      }
      // Rank within the section.
      cardsForSection.sort((a, b) => b.obtained_marks - a.obtained_marks).forEach((r, i) => { r.rank = i + 1 })
      reportRows.push(...cardsForSection)
    }
  }
  const markCount = await insQuiet('student_marks', markRows, 1000)
  const cardCount = await insQuiet('report_cards', reportRows, 1000)
  console.log(`   ✅ ${exams.length} exams, ${examSubjects.length} datesheet rows, ${markCount} marks, ${cardCount} report cards\n`)

  // ── 20. Attendance (every student, every working day) ────
  console.log('2️⃣0️⃣  Creating student attendance...')
  const attDates = workingDays(ATTENDANCE_DAYS)
  const attRows: any[] = []
  students.forEach((s, si) => attDates.forEach((d, di) => {
    const r = (si * 7 + di * 3) % 22
    attRows.push({
      school_id: schoolId, student_id: s.id, class_id: s.class_id, section_id: s.section_id, date: d,
      status: r === 0 ? 'absent' : r === 1 ? 'late' : r === 2 ? 'leave' : r === 3 && di % 11 === 0 ? 'holiday' : 'present',
      remarks: r === 2 ? 'Prior leave application' : null,
      marked_by: sectionClassTeacher.get(s.section_id) ?? anyTeacher(),
    })
  }))
  const attCount = await insQuiet('attendance', attRows, 1000)
  console.log(`   ✅ ${attCount} attendance records over ${attDates.length} working days\n`)

  // ── 21. Timetable (all sections, conflict-free) ──────────
  console.log('2️⃣1️⃣  Creating timetable...')
  const periods: [string, string, boolean][] = [
    ['09:00', '09:40', false], ['09:40', '10:20', false], ['10:20', '11:00', false],
    ['11:00', '11:20', true],  // short break
    ['11:20', '12:00', false], ['12:00', '12:40', false], ['12:40', '13:20', false], ['13:20', '14:00', false],
  ]
  const busy = new Map<string, Set<string>>()   // `${day}-${period}` → teacher ids
  // Periods already assigned per teacher. Picking the *least loaded*
  // free candidate rather than the first one both spreads the workload
  // realistically and guarantees nobody ends up with an empty timetable
  // — the "my periods" and substitute-finder screens need every teacher
  // to resolve to something.
  const load = new Map<string, number>(teachers.map(t => [t.id, 0]))
  const leastLoaded = (pool: typeof teachers, taken: Set<string>) =>
    pool.filter(t => !taken.has(t.id)).sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0]
  const ttRows: any[] = []
  sections.forEach((sec, secIdx) => {
    const lvl = levelOf(sec)
    const taught = subjectsFor(lvl, sec.name)
    const room = `Room ${101 + secIdx}`
    for (let day = 1; day <= 6; day++) {
      const dayPeriods = day === 6 ? periods.slice(0, 4) : periods   // Saturday is a half day
      dayPeriods.forEach(([st, en, isBreak], p) => {
        if (isBreak) {
          ttRows.push({ school_id: schoolId, class_id: sec.class_id, section_id: sec.id, academic_year_id: ay.id, day_of_week: day, period_number: p + 1, start_time: st, end_time: en, subject_name: 'Break', teacher_id: null, room, is_break: true })
          return
        }
        const subject = pick(taught, secIdx + day * 2 + p * 3)
        const key = `${day}-${p}`
        const taken = busy.get(key) ?? new Set<string>()
        const chosen = leastLoaded(subjectTeachers(subject), taken) ?? leastLoaded(teachers, taken)
        if (chosen) { taken.add(chosen.id); load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1) }
        busy.set(key, taken)
        ttRows.push({
          school_id: schoolId, class_id: sec.class_id, section_id: sec.id, academic_year_id: ay.id,
          day_of_week: day, period_number: p + 1, start_time: st, end_time: en,
          subject_name: subject, teacher_id: chosen?.id ?? null, room, is_break: false,
        })
      })
    }
  })
  const tt = await insQuiet('timetable_periods', ttRows)
  const teachersWithPeriods = new Set(ttRows.map(r => r.teacher_id).filter(Boolean)).size
  console.log(`   ✅ ${tt} periods across ${sections.length} sections; ${teachersWithPeriods}/${teachers.length} teachers timetabled\n`)

  // ── 22. Homework, syllabus & progress notes ──────────────
  console.log('2️⃣2️⃣  Creating homework & syllabus...')
  const hwBank: Record<string, string[]> = {
    Mathematics: ['Algebra worksheet Ch-3', 'Trigonometry practice set', 'Mensuration problems 1–20', 'Statistics: mean & median'],
    English: ['Essay: My Favourite Season', 'Grammar: Tenses exercise', 'Reading comprehension set B', 'Letter to the editor'],
    Hindi: ['हिंदी व्याकरण अभ्यास', 'निबंध: मेरा विद्यालय', 'पत्र लेखन अभ्यास', 'कविता कंठस्थ करें'],
    Science: ['Read "The Solar System"', 'Draw & label a plant cell', 'Numericals on motion', 'Balance chemical equations'],
    'Social Science': ['Map work: Indian Rivers', 'History timeline chart', 'Civics: Fundamental Rights notes', 'Economics: sectors worksheet'],
    'Computer Science': ['HTML basics practice', 'Python loops assignment', 'Flowchart exercises', 'MS Excel formulas'],
    Physics: ['Numericals set A — Kinematics', 'Ray diagrams practice', 'Derive lens formula'],
    Chemistry: ['Mole concept problems', 'Periodic table trends', 'Organic nomenclature'],
    Biology: ['Leaf collection project', 'Human digestive system diagram', 'Genetics problems'],
    EVS: ['Draw your neighbourhood', 'Collect 5 leaves', 'Water conservation poster'],
    Accountancy: ['Journal entries set 1', 'Trial balance practice'],
    'Business Studies': ['Case study: Marketing mix', 'Principles of management notes'],
    Economics: ['Demand curve exercises', 'Indian economy data sheet'],
    History: ['French Revolution timeline', 'Sources of Mughal history'],
    'Political Science': ['Constitution preamble analysis', 'Federalism notes'],
    Geography: ['Contour map exercise', 'Climate zones chart'],
    'General Knowledge': ['Current affairs quiz', 'Capitals & currencies'],
    'Art & Craft': ['Still-life sketch', 'Origami project'],
    'Physical Education': ['Fitness log — 1 week', 'Rules of basketball'],
    Music: ['Practice Raag Yaman', 'Rhythm exercise'],
  }
  const hwRows: any[] = []
  sections.forEach((sec, secIdx) => {
    const taught = subjectsFor(levelOf(sec), sec.name)
    // 5 per section, dated across the last fortnight so date filters hit.
    for (let k = 0; k < 5; k++) {
      const subject = pick(taught, k + secIdx)
      const title = pick(hwBank[subject] ?? ['Revision worksheet'], k + secIdx)
      hwRows.push({
        school_id: schoolId, class_id: sec.class_id, section_id: sec.id, subject_name: subject,
        type: k % 4 === 0 ? 'classwork' : 'homework', assignment_type: k % 5 === 0 ? 'individual' : 'class',
        title, description: `${title}. Submit by the due date.`,
        attachment_url: k % 4 === 0 ? (docFileUrls['other'] ?? logoUrl) : null,
        assigned_date: iso(dMinus(k * 3 + (secIdx % 3))), due_date: iso(dMinus(k * 3 + (secIdx % 3) - 3)),
        created_by: sectionClassTeacher.get(sec.id) ?? anyTeacher(),
      })
    }
  })
  const hwCount = await insQuiet('homework', hwRows)

  // Per-subject chapter banks (real-feeling curriculum topic names, not
  // a single generic list cycled across every subject) — 8-13 chapters
  // per class+subject, spread across the year from AY_START to a
  // syllabus-end cutoff a few weeks before AY_END (leaving revision
  // time), with a per-(class,subject) pacing multiplier so completion %
  // genuinely varies instead of every subject landing on the same
  // fraction. Deterministic (seeded off class+subject, not Math.random)
  // so re-running the seed against the same today() lands on the same
  // shape, not a different random draw each time.
  const CHAPTER_BANKS: Record<string, string[]> = {
    Mathematics: ['Number Systems', 'Polynomials', 'Linear Equations', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry', 'Trigonometry', 'Circles', 'Surface Areas and Volumes', 'Statistics', 'Probability', 'Sets and Relations'],
    Science: ['Food and Nutrition', 'Materials Around Us', 'The Living World', 'Motion and Force', 'Light and Shadows', 'Electricity and Circuits', 'Magnetism', 'Chemical Reactions', 'Sound', 'Reproduction in Organisms', 'Natural Resources', 'Pollution and Environment'],
    'Social Science': ['The French Revolution', 'Nationalism in India', 'The Making of a Global World', 'Resources and Development', 'Agriculture', 'Democracy and Diversity', 'Power Sharing', 'Federalism', 'Money and Credit', 'Globalisation'],
    English: ['Prose: A Letter to God', 'Prose: Nelson Mandela', 'Poetry: Dust of Snow', 'Poetry: Fire and Ice', 'Grammar: Tenses', 'Grammar: Modals', 'Writing: Letter Writing', 'Writing: Essay Writing', 'Literature: The Hundred Dresses', 'Literature: Mijbil the Otter', 'Reading Comprehension'],
    Hindi: ['गद्य: साखी', 'गद्य: पद', 'पद्य: दोहे', 'व्याकरण: संधि', 'व्याकरण: समास', 'लेखन: पत्र लेखन', 'लेखन: निबंध लेखन', 'गद्य: बड़े भाई साहब', 'पद्य: कर चले हम फ़िदा', 'व्याकरण: मुहावरे'],
    EVS: ['Family and Friends', 'Food We Eat', 'Our Environment', 'Water', 'Shelter', 'Travel and Transport', 'Plants Around Us', 'Animals Around Us', 'Air'],
    'General Knowledge': ['World Capitals', 'National Symbols', 'Famous Scientists', 'Important Inventions', 'Indian History Basics', 'Sports General Knowledge', 'Current Affairs', 'World Geography Basics'],
    'Art & Craft': ['Paper Craft', 'Clay Modelling', 'Drawing and Sketching', 'Water Colours', 'Collage Making', 'Origami', 'Nature Craft', 'Festival Decorations'],
    'Computer Science': ['Introduction to Computers', 'Operating Systems Basics', 'MS Word Essentials', 'MS Excel Essentials', 'Introduction to the Internet', 'Introduction to Programming', 'Python Basics', 'Data Types and Variables', 'Loops and Conditionals', 'Introduction to Databases', 'HTML Basics', 'Cyber Safety'],
    Physics: ['Physical World and Measurement', 'Kinematics', 'Laws of Motion', 'Work Energy and Power', 'Gravitation', 'Thermodynamics', 'Oscillations and Waves', 'Electrostatics', 'Current Electricity', 'Magnetic Effects of Current', 'Electromagnetic Induction', 'Ray Optics'],
    Chemistry: ['Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements', 'Chemical Bonding', 'States of Matter', 'Chemical Thermodynamics', 'Equilibrium', 'Redox Reactions', 'p-Block Elements', 'Organic Chemistry Basics', 'Hydrocarbons', 'Environmental Chemistry'],
    Biology: ['Diversity in Living Organisms', 'Cell Structure and Function', 'Tissues', 'Life Processes', 'Control and Coordination', 'Reproduction in Organisms', 'Heredity and Evolution', 'Human Physiology', 'Biomolecules', 'Ecology and Environment', 'Genetics Basics'],
    'Physical Education': ['Physical Fitness Basics', 'Yoga and Wellness', 'Athletics Fundamentals', 'Team Sports: Basketball', 'Team Sports: Football', 'Health and Nutrition', 'Sports Injuries and First Aid', 'Olympic Movement'],
    Accountancy: ['Introduction to Accounting', 'Accounting Equation', 'Journal Entries', 'Ledger Posting', 'Trial Balance', 'Financial Statements', 'Depreciation', 'Bank Reconciliation', 'Partnership Accounts', 'Company Accounts Basics'],
    'Business Studies': ['Nature of Business', 'Forms of Business Organisation', 'Private and Public Sector', 'Business Services', 'Emerging Modes of Business', 'Social Responsibility of Business', 'Principles of Management', 'Business Environment', 'Marketing Management Basics', 'Consumer Protection'],
    Economics: ['Introduction to Economics', 'Consumer Behaviour', 'Demand and Supply', 'Production and Costs', 'Market Structures', 'National Income', 'Money and Banking', 'Government Budget', 'Balance of Payments', 'Indian Economic Development'],
    History: ['The Rise of Nationalism in Europe', 'Nationalism in India', 'The Making of a Global World', 'The Age of Industrialisation', 'Print Culture and the Modern World', 'Colonialism and the Countryside', 'The Story of Development', 'Novels Society and History'],
    'Political Science': ['Power Sharing', 'Federalism', 'Democracy and Diversity', 'Gender Religion and Caste', 'Popular Struggles and Movements', 'Political Parties', 'Outcomes of Democracy', 'Challenges to Democracy'],
    Geography: ['Resources and Development', 'Forest and Wildlife Resources', 'Water Resources', 'Agriculture', 'Minerals and Energy Resources', 'Manufacturing Industries', 'Lifelines of National Economy', 'Population'],
  }
  // Simple deterministic string hash → [0,1), so pacing is reproducible
  // per (class, subject) rather than drawn fresh (and inconsistent) on
  // every seed run.
  const seededFraction = (s: string) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return (h % 10000) / 10000
  }
  const ayStart = new Date(`${AY_START}T00:00:00`)
  const syllabusEnd = dMinus(-((new Date(`${AY_END}T00:00:00`).getTime() - today.getTime()) / 86400000) + 45) // ~6 weeks of revision buffer before year-end
  const spanDays = Math.max(30, (syllabusEnd.getTime() - ayStart.getTime()) / 86400000)
  // teacher actually timetabled for a given class+subject (any section —
  // the chapter plan itself is class-wide, not per-section), so the
  // progress-note author matches who the principal dashboard already
  // shows as teaching it.
  const teacherByClassSubject = new Map<string, string>()
  for (const p of ttRows) {
    if (!p.teacher_id) continue
    const key = `${p.class_id}::${(p.subject_name ?? '').toLowerCase()}`
    if (!teacherByClassSubject.has(key)) teacherByClassSubject.set(key, p.teacher_id)
  }

  const chapterRows: any[] = []
  classes.forEach(cls => {
    classSubjects(cls.numeric_level).forEach(sub => {
      const bank = CHAPTER_BANKS[sub] ?? CHAPTER_BANKS.English
      const baseKey = `${cls.id}::${sub}`
      const chapterCount = 8 + Math.floor(seededFraction(`${baseKey}:count`) * 6) // 8-13
      const pacing = 0.4 + seededFraction(`${baseKey}:pace`) * 0.9 // 0.4 (behind) .. 1.3 (ahead)
      const plannedDates = Array.from({ length: chapterCount }, (_, i) =>
        new Date(ayStart.getTime() + Math.round((spanDays / chapterCount) * (i + 1)) * 86400000))
      const expectedByNow = plannedDates.filter(d => d <= today).length
      const completedCount = Math.max(0, Math.min(chapterCount, Math.round(expectedByNow * pacing)))

      for (let i = 0; i < chapterCount; i++) {
        const planned = plannedDates[i]
        let status: 'completed' | 'in_progress' | 'pending' = 'pending'
        let actualCompletion: string | null = null
        if (i < completedCount) {
          status = 'completed'
          const jitter = Math.floor(seededFraction(`${baseKey}:jit${i}`) * 6) - 2
          const completedOn = new Date(planned.getTime() + jitter * 86400000)
          actualCompletion = iso(completedOn > today ? today : completedOn)
        } else if (i === completedCount && planned <= today) {
          status = 'in_progress'
        }
        chapterRows.push({
          school_id: schoolId, class_id: cls.id, subject_name: sub, academic_year_id: ay.id,
          chapter_number: i + 1, chapter_name: pick(bank, i),
          planned_date: iso(planned), actual_completion_date: actualCompletion, status,
          created_by: adminId,
        })
      }
    })
  })
  const chapters = await ins('syllabus_chapters', chapterRows, 400)
  const progressNoteBank = ['completed exercises', 'explained concepts', 'revised previous topic', 'started new section', 'class test conducted', 'group discussion held', 'NCERT questions solved', 'practical demonstration given']
  const progressNoteRows = chapters
    .filter(ch => ch.status !== 'pending')
    .map((ch, i) => {
      const teacherId = teacherByClassSubject.get(`${ch.class_id}::${ch.subject_name.toLowerCase()}`) ?? anyTeacher()
      const noteDate = ch.status === 'completed' ? ch.actual_completion_date : iso(dMinus(Math.floor(seededFraction(`${ch.id}:notedate`) * 10)))
      return {
        school_id: schoolId, class_id: ch.class_id, section_id: null, subject_name: ch.subject_name,
        teacher_id: teacherId, note_date: noteDate,
        note: `Covered "${ch.chapter_name}" — ${pick(progressNoteBank, i)}.`,
        chapter_id: ch.id, progress_status: ch.status === 'completed' ? 'completed' : 'in_progress',
      }
    })
  await insQuiet('daily_progress_notes', progressNoteRows)
  console.log(`   ✅ ${hwCount} homework items, ${chapters.length} syllabus chapters + progress notes\n`)

  // ── 23. Resources ────────────────────────────────────────
  console.log('2️⃣3️⃣  Creating resources...')
  const resTypes = ['notes', 'assignment', 'syllabus', 'question_paper', 'video_link', 'reference', 'other']
  const resRows: any[] = []
  classes.forEach((cls, ci) => {
    classSubjects(cls.numeric_level).forEach((sub, si) => {
      const type = pick(resTypes, ci + si)
      resRows.push({
        school_id: schoolId, class_id: cls.id, subject_name: sub,
        title: `${cls.name} ${sub} — ${type.replace(/_/g, ' ')}`,
        description: `${sub} ${type.replace(/_/g, ' ')} for ${cls.name}, session ${AY_NAME}.`,
        resource_type: type,
        file_url: type === 'video_link' ? null : (docFileUrls['other'] ?? logoUrl),
        external_url: type === 'video_link' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : null,
        mime_type: type === 'video_link' ? null : 'image/svg+xml',
        is_published: (ci + si) % 9 !== 0,
        uploaded_by: pick(teachers, ci + si).id,
      })
    })
  })
  const resCount = await insQuiet('resources', resRows)
  console.log(`   ✅ ${resCount} resources across every class & subject\n`)

  // ── 24. Complaints ───────────────────────────────────────
  console.log('2️⃣4️⃣  Creating complaints...')
  const compCats = ['academic', 'behavioral', 'facility', 'transport', 'fee', 'bullying', 'staff', 'other']
  const compStatuses = ['open', 'in_progress', 'resolved', 'closed']
  const compPriorities = ['low', 'medium', 'high', 'urgent']
  const compSubjects = ['Late school bus', 'Classroom fan not working', 'Homework overload', 'Canteen food quality', 'Fee receipt not received', 'Peer conflict in class', 'Library book shortage', 'Playground maintenance', 'Extra class timing clash', 'Water cooler issue', 'Uniform supplier delay', 'Exam date clarification', 'Bus driver rash driving', 'Projector not working', 'Teacher absent frequently', 'Washroom cleanliness']
  // Walk the full category × status × priority space — every filter combo hits.
  const complaintRows: any[] = []
  let ci = 0
  compCats.forEach(cat => compStatuses.forEach(st => compPriorities.forEach(pr => {
    const resolved = st === 'resolved' || st === 'closed'
    complaintRows.push({
      school_id: schoolId, student_id: students[(ci * 37) % students.length].id, raised_by: adminId,
      category: cat, subject: pick(compSubjects, ci), description: `${pick(compSubjects, ci)}. Please look into this at the earliest.`,
      priority: pr, status: st, assigned_to: pick(staff, ci).id,
      resolution: resolved ? 'Issue addressed and resolved with the concerned department.' : null,
      resolved_at: resolved ? isoT(dMinus(ci % 20)) : null,
      created_at: isoT(dMinus(40 - (ci % 38))),
    })
    ci++
  })))
  const complaints = await ins('complaints', complaintRows, 300)
  await insQuiet('complaint_comments', complaints.flatMap((c, i) => Array.from({ length: (i % 3) + 1 }, (_, k) => ({
    complaint_id: c.id, user_id: pick(staff, i + k).id,
    comment: pick(['Looking into this.', 'Forwarded to the concerned department.', 'Will resolve by tomorrow.', 'Thanks for reporting.', 'Update: work in progress.', 'Spoke to the parent, issue clarified.'], i + k),
  }))))
  console.log(`   ✅ ${complaints.length} complaints (every category × status × priority) + comments\n`)

  // ── 25. Certificates & transfer certificates ─────────────
  console.log('2️⃣5️⃣  Creating certificates...')
  const certTypes: [string, string][] = [
    ['Character Certificate', 'character'], ['Bonafide Certificate', 'bonafide'], ['Migration Certificate', 'migration'],
    ['Achievement Award', 'achievement'], ['Participation Certificate', 'participation'], ['Sports Certificate', 'sports'],
    ['Custom Certificate', 'custom'], ['Merit Certificate', 'achievement'], ['Perfect Attendance', 'participation'],
    ['Sports Championship', 'sports'], ['Science Olympiad Winner', 'achievement'], ['Cultural Fest Participation', 'participation'],
  ]
  const templates = await ins('certificate_templates', certTypes.map(([name, type]) => ({
    school_id: schoolId, name, certificate_type: type,
    content: `This is to certify that {{student_name}} of class {{class}} is awarded the ${name} for the session ${AY_NAME}.`,
    is_active: true, created_by: adminId,
  })))
  await insQuiet('issued_certificates', students.filter((_, i) => i % 9 === 0).map((s, i) => {
    const tpl = pick(templates, i)
    const cls = classById[s.class_id]
    return {
      school_id: schoolId, student_id: s.id, template_id: tpl.id, certificate_type: tpl.certificate_type,
      certificate_number: `CERT${ayStartYear}${String(i + 1).padStart(4, '0')}`,
      issued_data: { student_name: `${s.first_name} ${s.last_name}`, class: cls.name, session: AY_NAME },
      issued_by: adminId,
      qr_code_data: `https://dpslucknow.example.com/verify/CERT${ayStartYear}${String(i + 1).padStart(4, '0')}`,
    }
  }))
  await ins('transfer_certificates', students.filter(s => s.status === 'transferred').slice(0, 20).map((s, i) => ({
    school_id: schoolId, student_id: s.id, tc_number: `TC${ayStartYear}${String(i + 1).padStart(3, '0')}`,
    issue_date: iso(dMinus(i * 4)), reason: pick(['Relocation', 'Parent transfer', 'Higher studies elsewhere', 'Personal reasons'], i),
    last_attendance_date: iso(dMinus(i * 4 + 3)), conduct: pick(['Excellent', 'Good', 'Satisfactory'], i),
    dues_cleared: i % 4 !== 0, issued_by: adminId,
    qr_code_data: `https://dpslucknow.example.com/tc/TC${ayStartYear}${String(i + 1).padStart(3, '0')}`,
    status: pick(['pending', 'approved', 'approved', 'rejected'], i),
  })))
  console.log(`   ✅ ${templates.length} templates + issued certificates + TCs\n`)

  // ── 26. HR: leave, payroll, staff attendance ─────────────
  console.log('2️⃣6️⃣  Creating HR data...')
  const leaveTypes = await ins('leave_types', [
    { school_id: schoolId, name: 'Casual Leave', code: 'CL', default_days_per_year: 12, is_paid: true, carry_forward: false },
    { school_id: schoolId, name: 'Sick Leave', code: 'SL', default_days_per_year: 10, is_paid: true, carry_forward: false },
    { school_id: schoolId, name: 'Earned Leave', code: 'EL', default_days_per_year: 15, is_paid: true, carry_forward: true },
    { school_id: schoolId, name: 'Maternity Leave', code: 'ML', default_days_per_year: 180, is_paid: true, carry_forward: false },
    { school_id: schoolId, name: 'Leave Without Pay', code: 'LWP', default_days_per_year: 0, is_paid: false, carry_forward: false },
  ])
  const allStaff = [{ id: adminId, name: 'Abhigyan Tripathi' }, ...staff]
  const year = today.getFullYear()
  const balRows: any[] = []
  allStaff.forEach((s, si) => leaveTypes.forEach((lt, k) => balRows.push({
    school_id: schoolId, user_id: s.id, leave_type_id: lt.id, year,
    total_days: lt.default_days_per_year, used_days: Math.min(lt.default_days_per_year, (si + k) % 5),
  })))
  await insQuiet('leave_balances', balRows)
  const leaveStatuses = ['pending', 'approved', 'rejected', 'cancelled']
  await insQuiet('leave_requests', allStaff.flatMap((s, si) => Array.from({ length: (si % 3) + 1 }, (_, k) => {
    const st = pick(leaveStatuses, si + k)
    const from = dMinus(35 - ((si + k) % 30))
    const to = new Date(from); to.setDate(to.getDate() + ((si + k) % 3))
    return {
      school_id: schoolId, user_id: s.id, leave_type_id: pick(leaveTypes, si + k).id,
      from_date: iso(from), to_date: iso(to), total_days: ((si + k) % 3) + 1,
      reason: pick(['Family function', 'Fever', 'Personal work', 'Medical checkup', 'Out of station', 'Child care', 'Wedding in family'], si + k),
      status: st, approved_by: st === 'approved' || st === 'rejected' ? principalId : null,
      approved_at: st === 'approved' || st === 'rejected' ? isoT(dMinus(20)) : null,
      rejection_reason: st === 'rejected' ? 'Insufficient leave balance / exam duty' : null,
    }
  })))
  await insQuiet('salary_structures', staff.map((s, i) => {
    const basic = 22000 + (i % 20) * 2200
    return {
      school_id: schoolId, user_id: s.id, basic_salary: basic, hra: Math.round(basic * 0.4), da: Math.round(basic * 0.1),
      conveyance_allowance: 1600, medical_allowance: 1250, other_allowances: 1000,
      pf_deduction: Math.round(basic * 0.12), professional_tax: 200, other_deductions: 0,
      effective_from: AY_START, is_active: true, created_by: adminId,
    }
  }))
  // Payslips for every elapsed month of the session.
  const payRows: any[] = []
  staff.forEach((s, i) => feeMonths.forEach((fm, mi) => {
    const basic = 22000 + (i % 20) * 2200, hra = Math.round(basic * 0.4), da = Math.round(basic * 0.1)
    const gross = basic + hra + da + 1600 + 1250 + 1000
    const lopDays = (i + mi) % 23 === 0 ? 1 : 0
    const lopAmount = lopDays ? Math.round(gross / 30) : 0
    const ded = Math.round(basic * 0.12) + 200 + lopAmount
    const isCurrent = mi === feeMonths.length - 1
    payRows.push({
      school_id: schoolId, user_id: s.id, month: fm.m, year: fm.y,
      basic_salary: basic, hra, da, conveyance_allowance: 1600, medical_allowance: 1250, other_allowances: 1000,
      gross_salary: gross, pf_deduction: Math.round(basic * 0.12), professional_tax: 200, other_deductions: 0,
      lop_days: lopDays, lop_amount: lopAmount, total_deductions: ded, net_salary: gross - ded,
      payment_status: isCurrent ? (i % 3 === 0 ? 'pending' : i % 7 === 0 ? 'approved' : 'paid') : (i % 29 === 0 ? 'failed' : 'paid'),
      payment_date: isCurrent && i % 3 === 0 ? null : `${fm.y}-${String(fm.m).padStart(2, '0')}-28`,
      payment_mode: 'neft', generated_by: accountantId,
    })
  }))
  const payCount2 = await insQuiet('payslips', payRows)
  const saDates = workingDays(STAFF_ATTENDANCE_DAYS)
  const saRows: any[] = []
  allStaff.forEach((s, si) => saDates.forEach((d, di) => {
    const r = (si * 5 + di * 2) % 16
    saRows.push({
      school_id: schoolId, user_id: s.id, date: d,
      status: r === 0 ? 'absent' : r === 1 ? 'on_leave' : r === 2 ? 'half_day' : r === 3 && di % 13 === 0 ? 'holiday' : 'present',
      check_in: r >= 3 ? '08:30' : null, check_out: r >= 3 ? '15:30' : null, marked_by: adminId,
    })
  }))
  const saCount = await insQuiet('staff_attendance', saRows)
  console.log(`   ✅ ${balRows.length} leave balances, ${payCount2} payslips, ${saCount} staff attendance rows\n`)

  // ── 27. Recruitment ──────────────────────────────────────
  console.log('2️⃣7️⃣  Creating recruitment data...')
  const jobs = await ins('job_postings', [
    ['PGT Mathematics', 'Science & Maths', 'PGT'], ['TGT Science', 'Science & Maths', 'TGT'], ['PRT (Primary Teacher)', 'Primary', 'PRT'],
    ['Physical Education Teacher', 'Co-curricular', 'PET'], ['Music Teacher', 'Co-curricular', 'Teacher'], ['Lab Assistant', 'Science & Maths', 'Assistant'],
    ['Front Office Executive', 'Administration', 'Executive'], ['Accountant', 'Accounts', 'Accountant'], ['Librarian', 'Library', 'Librarian'],
    ['Computer Instructor', 'Computer', 'Instructor'], ['PGT Economics', 'Commerce', 'PGT'], ['Special Educator', 'Administration', 'Educator'],
    ['Transport Coordinator', 'Administration', 'Coordinator'], ['Art Teacher', 'Co-curricular', 'Teacher'],
  ].map(([title, dept, desig], i) => ({
    school_id: schoolId, title, department: dept, designation: desig,
    employment_type: i % 9 === 4 ? 'part_time' : i % 11 === 5 ? 'contract' : 'full_time',
    description: `We are hiring a ${title} for the ${AY_NAME} session.`,
    requirements: 'Relevant post-graduate qualification with B.Ed preferred. CBSE experience is a plus.',
    experience_required: `${(i % 5) + 1}+ years`, salary_range: `₹${25 + i} - ${38 + i}k/month`, vacancies: (i % 3) + 1,
    status: i < 8 ? 'open' : i < 11 ? 'on_hold' : 'closed', posted_by: adminId,
  })))
  const jobAppStatuses = ['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined', 'rejected', 'withdrawn']
  const jobApplications = await ins('job_applications', Array.from({ length: 54 }, (_, i) => {
    const name = `${i % 2 === 0 ? pick(MALE_NAMES, i * 5) : pick(FEMALE_NAMES, i * 5)} ${pick(LAST_NAMES, i * 3)}`
    const d = new Date(today); d.setDate(d.getDate() + (i % 14) - 4)
    return {
      school_id: schoolId, job_posting_id: pick(jobs, i).id, candidate_name: name,
      email: `candidate${i + 1}@example.com`, phone: `+91 ${9000000000 + i}`,
      experience_years: (i % 12) + 1, current_designation: pick(['TGT', 'PGT', 'PRT', 'Coordinator', 'Lecturer'], i),
      expected_salary: 28000 + (i % 10) * 2500, notice_period: pick(['Immediate', '1 month', '2 months', '3 months'], i),
      source: pick(['Naukri', 'Referral', 'Walk-in', 'LinkedIn', 'Indeed'], i),
      status: pick(jobAppStatuses, i), application_number: `JA${ayStartYear}${String(i + 1).padStart(3, '0')}`,
      rating: (i % 5) + 1,
      interview_date: ['interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined'].includes(pick(jobAppStatuses, i)) ? isoT(d) : null,
    }
  }))
  // application_status_history hangs off job_applications (recruitment),
  // NOT off admission_applications — the column name reads ambiguously
  // but the FK points at job_applications.
  const hiringTrail = ['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'offer_sent', 'joined']
  const histCount = await insQuiet('application_status_history', jobApplications.flatMap((app, i) => {
    const terminal = app.status === 'rejected' || app.status === 'withdrawn'
    const upto = terminal ? (i % 4) + 1 : hiringTrail.indexOf(app.status) + 1
    const trail = hiringTrail.slice(0, Math.max(1, upto))
    const rows = trail.map((st, k) => ({
      application_id: app.id, status: st,
      notes: pick(['Application received', 'Profile shortlisted', 'Interview slot shared', 'Panel interview done', 'Selected by panel', 'Offer letter sent', 'Candidate joined'], k),
      changed_by: k >= 4 ? principalId : adminId,
      created_at: isoT(dMinus(40 - i - k)),
    }))
    if (terminal) rows.push({
      application_id: app.id, status: app.status,
      notes: app.status === 'rejected' ? 'Did not meet the subject expertise bar' : 'Candidate withdrew — accepted another offer',
      changed_by: adminId, created_at: isoT(dMinus(38 - i)),
    })
    return rows
  }))
  console.log(`   ✅ ${jobs.length} job postings, ${jobApplications.length} applications (every status), ${histCount} status-history rows\n`)

  // ── 28. Promotions (last session → this one) ─────────────
  console.log('2️⃣8️⃣  Creating promotion history...')
  const promotionRows = students.map((s, i) => {
    const lvl = classById[s.class_id].numeric_level
    // The class one rung down the actual ladder, not lvl-1: the pre-primary
    // years sit at 0/-1/-2, so clamping at 1 would have promoted every Nursery
    // and LKG child "from Class 1". The lowest class has nowhere to come from
    // and stays put.
    const fromClass = classes.find(c => c.numeric_level === lvl - 1) ?? classes[0]
    const fromSection = sections.find(sec => sec.class_id === fromClass.id)
    return {
      school_id: schoolId, student_id: s.id,
      from_academic_year_id: prevAy.id, to_academic_year_id: ay.id,
      from_class_id: fromClass.id, from_section_id: fromSection?.id ?? null,
      to_class_id: s.class_id, to_section_id: s.section_id,
      promotion_type: i % 89 === 3 ? 'detained' : i % 97 === 5 ? 'transferred' : i % 101 === 7 ? 'withdrawn' : 'promoted',
      promoted_by: adminId,
      notes: i % 89 === 3 ? 'Retained on academic grounds' : null,
      created_at: isoT(new Date(`${ayStartYear}-04-01T04:00:00Z`)),
    }
  })
  const promCount = await insQuiet('student_promotions', promotionRows)
  console.log(`   ✅ ${promCount} promotion records\n`)

  // ── 29. Holidays / academic calendar ─────────────────────
  console.log('2️⃣9️⃣  Creating holidays...')
  const holidayDefs: [string, string][] = [
    [`${ayStartYear}-08-15`, 'Independence Day'], [`${ayStartYear}-08-19`, 'Raksha Bandhan'], [`${ayStartYear}-08-26`, 'Janmashtami'],
    [`${ayStartYear}-09-05`, "Teachers' Day"], [`${ayStartYear}-10-02`, 'Gandhi Jayanti'], [`${ayStartYear}-10-12`, 'Dussehra'],
    [`${ayStartYear}-10-31`, 'Diwali'], [`${ayStartYear}-11-01`, 'Diwali Holiday'], [`${ayStartYear}-11-15`, 'Guru Nanak Jayanti'],
    [`${ayStartYear}-12-25`, 'Christmas'], [`${ayStartYear + 1}-01-01`, 'New Year'], [`${ayStartYear + 1}-01-14`, 'Makar Sankranti'],
    [`${ayStartYear + 1}-01-26`, 'Republic Day'], [`${ayStartYear + 1}-03-04`, 'Holi'], [`${ayStartYear + 1}-03-25`, 'Eid ul-Fitr'],
  ]
  await insQuiet('holidays', holidayDefs.map(([date, name]) => ({ school_id: schoolId, date, name })))
  console.log(`   ✅ ${holidayDefs.length} holidays\n`)

  // ── 30. Notifications ────────────────────────────────────
  // Table ships in a later migration than the baseline — if it hasn't
  // been applied yet this logs a warning and the rest of the seed is
  // unaffected.
  console.log('3️⃣0️⃣  Creating notifications...')
  // Types come from the NotificationType union the app actually produces —
  // importing it means tsc rejects an invented value here, which is how
  // the previous list ('fee_due', 'exam_scheduled', 'announcement', ...)
  // drifted: the column is plain text with no CHECK, so anything inserts.
  //
  // Each template keeps its type, title, message, link and entity together.
  // They used to be picked from parallel arrays by index, which produced
  // rows like a 'fee_due' typed notification titled "Attendance alert"
  // linking to /hr/my-leave.
  //
  // Links are relative and resolve against whichever app renders the bell,
  // so family rows use the portal's routes — note (portal) is a Next route
  // GROUP and contributes no URL segment, so it is /fees, not /portal/fees.
  type NotifTemplate = { type: NotificationType; title: string; message: string; link: string; entity: string }

  const FAMILY_NOTIFS: NotifTemplate[] = [
    { type: 'fee_due_soon', title: 'Fee payment due soon', message: `Invoice for ${MONTH_NAMES[today.getMonth()]} is due on the 10th.`, link: '/fees', entity: 'fee_invoice' },
    { type: 'fee_overdue', title: 'Fee payment overdue', message: 'An invoice is past its due date and is still unpaid.', link: '/fees', entity: 'fee_invoice' },
    { type: 'attendance_absent', title: 'Marked absent today', message: 'Your ward was marked absent yesterday.', link: '/attendance', entity: 'attendance' },
    { type: 'homework_assigned', title: 'New homework: Mathematics', message: '"Algebra worksheet Ch-3" — due in three days.', link: '/homework', entity: 'homework' },
    { type: 'exam_result_published', title: 'Exam results published', message: 'Results for "Unit Test 1" are now available.', link: '/exams', entity: 'exam' },
    { type: 'discount_approved', title: 'Fee discount approved', message: 'A fee discount request for your child has been approved and applied.', link: '/fees', entity: 'fee_discount' },
    { type: 'discount_rejected', title: 'Fee discount request rejected', message: 'A fee discount request for your child was rejected.', link: '/fees', entity: 'fee_discount' },
    { type: 'tc_approved', title: 'Transfer Certificate approved', message: 'Your Transfer Certificate request has been approved and is ready.', link: '/', entity: 'transfer_certificate' },
  ]

  // Staff only ever receive their own leave outcomes today, and those link
  // into the staff app.
  const STAFF_NOTIFS: NotifTemplate[] = [
    { type: 'leave_approved', title: 'Leave request approved', message: 'Your leave request was approved.', link: '/hr/my-leave', entity: 'leave_request' },
    { type: 'leave_rejected', title: 'Leave request rejected', message: 'Your leave request was rejected. Reason: insufficient balance.', link: '/hr/my-leave', entity: 'leave_request' },
  ]

  const notifRows: any[] = []
  const portalUserIds = new Set(portalUserRows.map(u => u.id))
  // Everyone who can log in gets a populated bell — including the admin
  // account, which is the one a demo actually signs in as.
  const notifTargets = [{ id: adminId }, ...staffUserRows, ...portalUserRows]
  notifTargets.forEach((u, i) => {
    const templates = portalUserIds.has(u.id) ? FAMILY_NOTIFS : STAFF_NOTIFS
    for (let k = 0; k < 4; k++) {
      const t = pick(templates, i + k)
      const d = dMinus((i + k) % 21)
      notifRows.push({
        school_id: schoolId, user_id: u.id, type: t.type,
        title: t.title, message: t.message, link: t.link,
        is_read: (i + k) % 3 === 0,
        related_entity_type: t.entity, related_entity_id: null,
        created_at: isoT(d), notification_date: iso(d),
      })
    }
  })
  const notifCount = await insQuiet('notifications', notifRows)
  console.log(`   ✅ ${notifCount} notifications\n`)

  // ── 31. Audit trail ──────────────────────────────────────
  console.log('3️⃣1️⃣  Creating audit log entries...')
  const auditActions: [string, string][] = [['create', 'student'], ['update', 'student'], ['delete', 'student'], ['create', 'fee_payment'], ['update', 'fee_invoice'], ['create', 'exam'], ['update', 'report_card'], ['create', 'complaint'], ['update', 'staff_profile'], ['create', 'certificate'], ['login', 'user'], ['update', 'timetable_period']]
  await insQuiet('audit_logs', Array.from({ length: 120 }, (_, i) => {
    const [action, entity] = pick(auditActions, i)
    return {
      school_id: schoolId, user_id: pick(allStaff, i).id, action, entity_type: entity,
      entity_id: null,
      old_values: action === 'update' ? { status: 'draft' } : null,
      new_values: action === 'delete' ? null : { status: 'active', by: pick(allStaff, i).name },
      ip_address: `10.0.${i % 250}.${(i * 7) % 250}`,
      created_at: isoT(dMinus(i % 40)),
    }
  }))
  console.log(`   ✅ 120 audit entries\n`)

  // ── 32. Document number counters ─────────────────────────
  // The app generates invoice/receipt/admission/TC/... numbers from
  // document_counters. This seed writes its own numbers directly (it is a
  // bulk load, not nine thousand RPC round trips), so the counters have to
  // be advanced past what was just inserted — otherwise the first payment
  // recorded through the UI is handed RCP<year>00001, which already exists,
  // and dies on the unique constraint.
  console.log('3️⃣2️⃣  Advancing document number counters...')
  const counterRows = [
    // INV and RCP are advanced by seedFees(), which is what issues those
    // numbers now.
    { prefix: 'ADM', last_number: students.length },
    { prefix: 'CERT', last_number: Math.ceil(students.length / 9) },
    { prefix: 'INQ', last_number: inquiries.length },
    { prefix: 'APP', last_number: applications.length },
    { prefix: 'JA', last_number: jobApplications.length },
    { prefix: 'TC', last_number: 20 },
  ].map(c => ({ school_id: schoolId, year: ayStartYear, ...c }))
  const { error: counterErr } = await supabase.from('document_counters')
    .upsert(counterRows, { onConflict: 'school_id,year,prefix' })
  if (counterErr) console.error(`   ⚠️  document_counters: ${counterErr.message}`)
  else console.log(`   ✅ ${counterRows.length} counters advanced past seeded numbers\n`)

  // ── 33. Fees, via the fee model's own seeder ─────────────
  //
  // Last, because it reads the students, classes and staff created above. This
  // is the same code `npm run seed:fees` runs; keeping one implementation is
  // what stops it drifting out of step with the schema again.
  console.log('3️⃣3️⃣  Building fee data...')
  await seedFees(schoolId)

  // ── 34. The setup a running school has already done ──────
  //
  // Exam slots and templates, shift patterns, PT slabs, RTE rates, concession
  // rules, staff documents and households. The seed built everything a school
  // accumulates by operating but nothing it configures once, so these tables
  // were empty on a fresh database and the screens reading them opened on an
  // empty state.
  console.log('3️⃣4️⃣  Adding school setup data...')
  await seedExtras(schoolId)

  // ── Done ─────────────────────────────────────────────────
  const mins = Math.round((Date.now() - startedAt) / 600) / 100
  console.log('━'.repeat(64))
  console.log('🎉 SEED COMPLETE\n')
  console.log(`   🏫  School:      Delhi Public School Lucknow — session ${AY_NAME}`)
  console.log(`   🔑  Admin:       admin@dpslucknow.com / Admin@1234`)
  console.log(`   🔑  Staff:       <first>.<last>@dpslucknow.com / Staff@1234`)
  console.log(`   🔑  Student:     <name><roll>@student.dpslucknow.com / Student@1234   (family app)`)
  console.log(`   🔑  Parent:      <name><roll>@parent.dpslucknow.com / Parent@1234    (family app)`)
  console.log('')
  console.log(`   👨‍🏫  Staff:       ${staff.length} (${teachers.length} teachers)`)
  console.log(`   👨‍🎓  Students:    ${students.length} across ${classes.length} classes / ${sections.length} sections — all with photos`)
  console.log(`   📄  Documents:   ${docCount}    🗓️  Attendance: ${attCount}`)
  console.log(`   🧾  Payslips:    ${payCount2}   (fee figures are printed by the fee reseed below)`)
  console.log(`   📊  Exams:       ${exams.length}   ✍️  Marks: ${markCount}   📋 Report cards: ${cardCount}`)
  console.log(`   ⏰  Timetable:   ${tt} periods (all ${sections.length} sections, Mon–Sat)`)
  console.log('')
  console.log('   Family portal logins:')
  portalCreds.slice(0, 4).forEach(c => console.log(`     ${c}`))
  console.log(`     …and ${Math.max(0, portalCreds.length - 4)} more`)
  console.log('')
  console.log(`   ⏱️  Finished in ${mins} min`)
  console.log('━'.repeat(64))
}

seed().catch(console.error)
