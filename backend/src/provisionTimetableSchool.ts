import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { randomInt } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { supabase } from './shared/db/client'
import { seedDefaultRoles } from './modules/rbac/seed'
import { applyTimetableSchoolRoles, TIMETABLE_SCHOOL_MODULES } from './modules/rbac/timetableSchoolRoles'
import { readWorkbook } from './modules/timetable/import/xlsx'
import { parseTimetableWorkbook } from './modules/timetable/import/parseWorkbook'
import { resolveImport } from './modules/timetable/import/resolve'
import { commitImport } from './modules/timetable/import/commit'

// ═══════════════════════════════════════════════════════════════
// Stand up a school that has bought the timetable module only.
// ═══════════════════════════════════════════════════════════════
//
//   npx tsx src/provisionTimetableSchool.ts --file "New Time table (1).xlsx"
//
// This is a real-customer tool, not a demo seed, so it behaves like one:
//
//   * It refuses to run twice. A half-provisioned school is worse than
//     none, and "just run it again" would create a second copy of a real
//     school with a second set of real teachers.
//   * It is a dry run unless --commit is passed. The default prints
//     exactly what it would create, including every name it read out of
//     the spreadsheet, so somebody can check the parse before any of it
//     is written.
//   * Credentials are written to a file, not just echoed, and the file
//     says plainly that they are one-time.
//
// The school gets enabled_modules = ['timetable'], which is what keeps
// fees, admissions, payroll and the rest out of its sidebar — several of
// those entries are gated on no permission at all, so trimming roles
// alone would not hide them.

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket as any } },
)

// ── the customer ────────────────────────────────────────────────

const SCHOOL = {
  name: 'Rashtra Bharti Public Inter College',
  address: 'Vivekanand Puram, Kalyanpur',
  city: 'Lucknow',
  state: 'Uttar Pradesh',
  pincode: '226022',
  phone: '+91 94150 10638',
  email: 'rashtrabharti01@gmail.com',
  website: 'https://rashtrabhartipublicintercollege.com',
  affiliation_board: 'U.P. Board',
  established_year: 2001,
  // The whole point of this script.
  enabled_modules: TIMETABLE_SCHOOL_MODULES,
}

/** Login identifiers, not mailboxes — Supabase Auth just needs an address shape. */
const LOGIN_DOMAIN = 'rashtrabharti.school'

const STAFF = [
  {
    email: `principal@${LOGIN_DOMAIN}`,
    fullName: 'Mohd. Wajihul Islam',
    role: 'principal',
    rbacRole: 'Principal',
    designation: 'Principal',
    note: 'Publishes timetables and receives escalations',
  },
  {
    email: `admin@${LOGIN_DOMAIN}`,
    fullName: 'School Administrator',
    role: 'school_admin',
    rbacRole: 'School Admin',
    designation: 'Administrator',
    note: 'Full access; issues logins and rotates passwords',
  },
  {
    email: `timetable@${LOGIN_DOMAIN}`,
    fullName: 'Timetable Manager',
    role: 'teacher',
    rbacRole: 'Timetable Manager',
    designation: 'Timetable In-charge',
    note: 'Runs the daily arrangement queue. Cannot publish or override a reserved period.',
  },
]

// ── password generation ─────────────────────────────────────────
//
// Readable enough to be dictated over a phone and typed by somebody who
// has never used the system, unique per person, and stated everywhere as
// a one-time credential.
const WORDS = ['Lucknow', 'Kalyanpur', 'Vivek', 'Bharti', 'Rashtra', 'Ganga', 'Awadh', 'Chikan']
function initialPassword(): string {
  return `${WORDS[randomInt(WORDS.length)]}@${randomInt(1000, 9999)}`
}

// ── main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const commit = args.includes('--commit')
  const fileArg = args[args.indexOf('--file') + 1]
  const file = args.includes('--file') && fileArg ? fileArg : 'New Time table (1).xlsx'

  console.log(`\n${'━'.repeat(66)}`)
  console.log(`  ${SCHOOL.name}`)
  console.log(`  ${commit ? 'COMMIT — this writes to the database' : 'DRY RUN — nothing will be written (pass --commit to apply)'}`)
  console.log(`${'━'.repeat(66)}\n`)

  // ── 1. refuse to run twice ────────────────────────────────────
  const { data: existing } = await supabase.from('schools').select('id, name').ilike('name', SCHOOL.name)
  if (existing?.length) {
    console.error(`✖ "${SCHOOL.name}" already exists (${existing[0].id}).`)
    console.error('  Provisioning again would create a second copy of a real school.')
    console.error(`  To start over:  psql "$DATABASE_URL" -c "select school_force_delete('${existing[0].id}')"\n`)
    process.exit(1)
  }

  // ── 2. read the timetable ─────────────────────────────────────
  console.log('1. Reading the timetable')
  const parse = parseTimetableWorkbook(readWorkbook(readFileSync(file)))
  const blocking = parse.issues.filter(i => i.severity === 'block')
  if (blocking.length) {
    console.error('\n✖ The spreadsheet cannot be imported:')
    for (const i of blocking) console.error(`   ${i.message}`)
    process.exit(1)
  }

  console.log(`   ${parse.days.length} days · ${parse.sections.length} sections · ${parse.stats.filledSlots} periods`)
  console.log(`   ${parse.subjectGroups.length} subjects (from ${parse.stats.distinctSubjectStrings} spellings)`)
  console.log(`   ${parse.teacherGroups.length} teachers (from ${parse.stats.distinctTeacherStrings} spellings)`)
  for (const t of parse.dayTemplates) {
    console.log(`   ${t.name}: ${t.periods.filter(p => p.kind === 'period').length} periods · ${t.sectionLabels.join(', ')}`)
  }

  const needsReview = [
    ...parse.subjectGroups.filter(g => g.needsReview).map(g => `subject "${g.canonical}" — ${g.reason}`),
    ...parse.teacherGroups.filter(g => g.needsReview).map(g => `teacher "${g.canonical}" — ${g.reason}`),
  ]
  if (needsReview.length) {
    console.log(`\n   ${needsReview.length} thing(s) the importer had to interpret:`)
    for (const r of needsReview) console.log(`     · ${r}`)
  }
  const warnings = parse.issues.filter(i => i.severity === 'warn')
  if (warnings.length) {
    console.log(`\n   ${warnings.length} problem(s) already in the spreadsheet:`)
    for (const w of warnings) console.log(`     · ${w.message}`)
  }

  console.log('\n   Teachers read from the file:')
  const names = parse.teacherGroups.map(g => g.canonical).sort()
  for (let i = 0; i < names.length; i += 4) console.log(`     ${names.slice(i, i + 4).map(n => n.padEnd(16)).join('')}`)

  if (!commit) {
    console.log(`\n   Would create: 1 school, ${STAFF.length} staff logins, ${parse.teacherGroups.length} teacher logins,`)
    console.log(`   ${parse.sections.length} sections, ${parse.subjectGroups.length} subjects, ${parse.stats.filledSlots} timetable periods.`)
    console.log('\n   Re-run with --commit to apply.\n')
    return
  }

  // ── 3. the school ─────────────────────────────────────────────
  console.log('\n2. Creating the school')
  const { data: school, error: schoolErr } = await supabase.from('schools').insert(SCHOOL).select('id').single()
  if (schoolErr || !school) { console.error(`✖ ${schoolErr?.message}`); process.exit(1) }
  const schoolId = school.id
  console.log(`   ${schoolId}`)
  console.log(`   modules: ${SCHOOL.enabled_modules.join(', ')} — everything else stays out of the sidebar`)

  // ── 4. roles, pruned to what they bought ──────────────────────
  console.log('\n3. Roles')
  const roleIdByName = await seedDefaultRoles(schoolId)
  // seedDefaultRoles gives every role the full suite; this replaces each
  // one with exactly what a timetable-only school should hold. See
  // modules/rbac/timetableSchoolRoles.ts for the table and the reasoning.
  const applied = await applyTimetableSchoolRoles(schoolId)
  for (const r of applied.roles) console.log(`   ${r.name.padEnd(20)} ${r.granted} permission(s)`)
  if (applied.removedRoles.length) console.log(`   removed unused: ${applied.removedRoles.join(', ')}`)
  if (applied.unknownCodes.length) console.log(`   ⚠️  unknown codes: ${applied.unknownCodes.join(', ')}`)

  // ── 5. staff logins ───────────────────────────────────────────
  console.log('\n4. Staff logins')
  const credentials: { name: string; email: string; password: string; role: string; note: string }[] = []

  for (const person of STAFF) {
    const password = initialPassword()
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: person.email, password, email_confirm: true,
    })
    if (authErr || !authUser?.user) { console.error(`   ✖ ${person.email}: ${authErr?.message}`); continue }

    await supabase.from('users').insert({
      id: authUser.user.id, school_id: schoolId, full_name: person.fullName,
      email: person.email, role: person.role, is_active: true,
    })
    await supabase.from('staff_profiles').insert({
      school_id: schoolId, user_id: authUser.user.id,
      designation: person.designation, department: 'Administration',
      employment_type: 'full_time', employment_status: 'active',
      date_of_joining: new Date().toISOString().slice(0, 10),
    })
    const roleId = roleIdByName[person.rbacRole]
    if (roleId) {
      await supabase.from('user_roles').insert({ user_id: authUser.user.id, role_id: roleId, school_id: schoolId })
    }
    credentials.push({ name: person.fullName, email: person.email, password, role: person.rbacRole, note: person.note })
    console.log(`   ${person.rbacRole.padEnd(20)} ${person.email}`)
  }

  const actorId = credentials.length
    ? (await supabase.from('users').select('id').eq('email', `admin@${LOGIN_DOMAIN}`).single()).data!.id
    : null
  if (!actorId) { console.error('✖ no administrator was created; stopping before the import'); process.exit(1) }

  // ── 6. the timetable ──────────────────────────────────────────
  console.log('\n5. Importing the timetable')
  const resolved = await resolveImport(schoolId, parse)

  // A brand-new school has no staff list to match against, so every
  // teacher in the spreadsheet is created. The two merged cells are
  // pointed at the subject they were truncated from.
  const variantOverrides: Record<string, string> = {}
  const skipSubjects = new Set<string>()

  for (const group of parse.subjectGroups) {
    // A cell holding two collapsed values — "SST              Re" is an
    // overwritten "SST" and "Remedial-…". Point the period at the subject
    // the cell starts with, and skip the phantom group entirely so the
    // school does not end up with a subject called "SST Re" that nothing
    // is ever taught in.
    const mergedCells = group.variants.filter(v => /\s{4,}/.test(v.raw))
    if (!mergedCells.length) continue

    for (const variant of mergedCells) {
      const head = variant.raw.split(/\s{4,}/)[0].trim()
      const target = parse.subjectGroups.find(g =>
        g !== group && g.canonical.toLowerCase() === head.toLowerCase())
      if (!target) {
        console.log(`   ⚠️  merged cell "${variant.raw.replace(/\s+/g, ' ')}" — no subject called "${head}" to attach it to; left as its own subject`)
        continue
      }
      variantOverrides[variant.raw] = target.canonical
      console.log(`   merged cell "${variant.raw.replace(/\s+/g, ' ')}" -> ${target.canonical}`)
    }

    if (mergedCells.length === group.variants.length &&
        mergedCells.every(v => variantOverrides[v.raw])) {
      skipSubjects.add(group.canonical)
    }
  }

  const result = await commitImport(schoolId, actorId, parse, {
    subjects: resolved.subjects.map(s => ({
      canonical: s.canonical, subjectId: s.subjectId, skip: skipSubjects.has(s.canonical),
    })),
    teachers: resolved.teachers.map(t => ({ canonical: t.canonical, action: 'create' as const, fullName: t.canonical })),
    sections: resolved.sections.map(s => ({ raw: s.raw, action: 'link' as const, classId: s.classId, sectionId: s.sectionId })),
    variantOverrides,
    versionLabel: 'Imported from the school’s spreadsheet',
    applyPlan: true, applyCapabilities: true, applyConstraints: true, applyDayTemplates: true,
  })

  console.log(`   ${result.periodsWritten} periods · ${result.classesCreated} classes · ${result.sectionsCreated} sections`)
  console.log(`   ${result.subjectsCreated} subjects · ${result.teachersCreated} teachers`)
  console.log(`   ${result.planRows} plan rows · ${result.capabilityRows} capabilities · ${result.constraintRows} workload limits`)
  if (result.skipped.slots) console.log(`   ⚠️  ${result.skipped.slots} skipped: ${result.skipped.reasons.join('; ')}`)

  // ── 7. teacher logins ─────────────────────────────────────────
  //
  // commitImport creates the auth account so the id is real, with a
  // password nobody knows. A school whose teachers must acknowledge cover
  // needs them able to sign in, so each gets a one-time password here.
  console.log('\n6. Teacher logins')
  const { data: teachers } = await supabase.from('users')
    .select('id, full_name, email').eq('school_id', schoolId).eq('role', 'teacher')
    .order('full_name')

  const teacherRoleId = roleIdByName['Teacher']
  let issued = 0
  for (const t of teachers ?? []) {
    if (t.email === `timetable@${LOGIN_DOMAIN}`) continue
    const password = initialPassword()
    const { error } = await supabaseAdmin.auth.admin.updateUserById(t.id, { password })
    if (error) { console.error(`   ✖ ${t.full_name}: ${error.message}`); continue }
    if (teacherRoleId) {
      await supabase.from('user_roles')
        .upsert({ user_id: t.id, role_id: teacherRoleId, school_id: schoolId }, { onConflict: 'user_id,role_id' })
    }
    credentials.push({ name: t.full_name, email: t.email, password, role: 'Teacher', note: '' })
    issued++
  }
  console.log(`   ${issued} teacher login(s) issued`)

  // ── 8. handover ───────────────────────────────────────────────
  const out = [
    `${SCHOOL.name} — initial logins`,
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    'THESE ARE ONE-TIME PASSWORDS. Have everyone change theirs on first',
    'sign-in, and delete this file once they have been handed out.',
    '',
    'Sign in at: <your airtec URL>/auth/login',
    '',
    ...credentials.map(c =>
      `${c.role.padEnd(20)} ${c.name.padEnd(24)} ${c.email.padEnd(42)} ${c.password}` +
      (c.note ? `\n${' '.repeat(20)} ${c.note}` : '')),
    '',
  ].join('\n')

  const path = `credentials-${SCHOOL.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
  writeFileSync(path, out, { mode: 0o600 })

  console.log(`\n${'━'.repeat(66)}`)
  console.log(`  DONE — ${credentials.length} logins written to ${path}`)
  console.log(`  That file is chmod 600 and gitignored. Hand the credentials out,`)
  console.log(`  have everyone change their password, then delete it.`)
  console.log(`${'━'.repeat(66)}\n`)
}

main().catch(err => { console.error('\n✖', err?.message ?? err); process.exit(1) })
