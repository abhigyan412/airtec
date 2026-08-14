import 'dotenv/config'
import { supabase } from './shared/db/client'

// ═══════════════════════════════════════════════════════════════
// The configuration a running school has already done.
//
// The main seed builds the things a school accumulates by operating —
// students, attendance, marks, invoices. It never built the things a school
// sets up once and then uses: exam time slots, shift patterns, PT slabs, RTE
// rates, concession rules. Those tables were empty on a freshly seeded
// database, so the screens that read them opened on an empty state and the
// features they drive could not be shown at all.
//
// Separate from seed.ts because it is additive and idempotent: it can be run
// against a school that already exists without touching anything else, which
// is what makes it usable the evening before a demo.
//
//   npx tsx src/seedExtras.ts              # the one real school
//   npx tsx src/seedExtras.ts --school <id>
// ═══════════════════════════════════════════════════════════════

const pick = <T,>(a: T[], i: number): T => a[i % a.length]

async function insert(table: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0
  const { data, error } = await supabase.from(table).insert(rows).select('id')
  if (error) { console.log(`   ! ${table}: ${error.message}`); return 0 }
  return (data ?? []).length
}

/** Skips a table that already has rows, so a second run is a no-op. */
async function isEmpty(table: string, schoolId: string): Promise<boolean> {
  const { count } = await supabase.from(table)
    .select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
  return (count ?? 0) === 0
}

export async function seedExtras(schoolId: string) {
  const [{ data: years }, { data: classes }, { data: staff }, { data: heads }] = await Promise.all([
    supabase.from('academic_years').select('id, name, is_current, start_date').eq('school_id', schoolId),
    supabase.from('classes').select('id, name, numeric_level').eq('school_id', schoolId).order('numeric_level'),
    supabase.from('users').select('id, full_name, role').eq('school_id', schoolId).neq('role', 'parent').neq('role', 'student'),
    supabase.from('fee_heads').select('id, name, code').eq('school_id', schoolId),
  ])
  const year = (years ?? []).find((y: any) => y.is_current) ?? (years ?? [])[0]
  if (!year) throw new Error('No academic year — run the main seed first')
  const teachers = (staff ?? []).filter((s: any) => s.role === 'teacher')
  const admin = (staff ?? []).find((s: any) => s.role === 'school_admin') ?? (staff ?? [])[0]

  // ── Exam settings: slots, then templates that reference them ──
  let slotIds: string[] = []
  if (await isEmpty('exam_time_slots', schoolId)) {
    const { data } = await supabase.from('exam_time_slots').insert([
      { school_id: schoolId, name: 'Morning (9:00–12:00)',   start_time: '09:00', end_time: '12:00' },
      { school_id: schoolId, name: 'Mid-morning (10:00–12:00)', start_time: '10:00', end_time: '12:00' },
      { school_id: schoolId, name: 'Afternoon (1:00–4:00)',  start_time: '13:00', end_time: '16:00' },
      { school_id: schoolId, name: 'Practical (9:00–11:00)', start_time: '09:00', end_time: '11:00' },
    ]).select('id')
    slotIds = (data ?? []).map((s: any) => s.id)
    console.log(`   ✓ ${slotIds.length} exam time slots`)
  } else {
    const { data } = await supabase.from('exam_time_slots').select('id').eq('school_id', schoolId)
    slotIds = (data ?? []).map((s: any) => s.id)
  }

  if (await isEmpty('exam_templates', schoolId)) {
    const defs: [string, string][] = [
      ['Unit Test — Term 1', 'unit_test'], ['Half Yearly Examination', 'half_yearly'],
      ['Annual Examination', 'annual'], ['Pre-Board', 'pre_board'],
    ]
    const { data: templates } = await supabase.from('exam_templates').insert(
      defs.map(([name, exam_type]) => ({
        school_id: schoolId, name, exam_type,
        grading_system: exam_type === 'pre_board' ? 'grades' : 'marks',
        created_by: admin?.id ?? null,
      }))).select('id, name, exam_type')
    console.log(`   ✓ ${(templates ?? []).length} exam templates`)

    // A template is only useful once it says which subject sits in which slot.
    // Senior classes only for Pre-Board, which is what a pre-board is.
    const { data: subjects } = await supabase.from('subjects')
      .select('class_id, name').eq('school_id', schoolId)
    const byClass = new Map<string, string[]>()
    for (const s of subjects ?? []) {
      byClass.set(s.class_id, [...(byClass.get(s.class_id) ?? []), s.name])
    }
    const rows: any[] = []
    for (const [ti, t] of (templates ?? []).entries()) {
      const forClasses = (classes ?? []).filter((c: any) =>
        t.exam_type === 'pre_board' ? c.numeric_level >= 10 : c.numeric_level >= 1)
      for (const c of forClasses) {
        for (const [si, name] of (byClass.get(c.id) ?? []).entries()) {
          rows.push({
            template_id: t.id, class_id: c.id, subject_name: name,
            time_slot_id: slotIds.length ? pick(slotIds, ti + si) : null,
            max_marks: t.exam_type === 'unit_test' ? 25 : 100,
            pass_marks: t.exam_type === 'unit_test' ? 9 : 33,
          })
        }
      }
    }
    console.log(`   ✓ ${await insert('exam_template_subjects', rows)} template subject rows`)
  }

  // ── HR configuration ──
  if (await isEmpty('staff_shifts', schoolId)) {
    console.log(`   ✓ ${await insert('staff_shifts', [
      { school_id: schoolId, name: 'General (8:00–15:30)', start_time: '08:00', end_time: '15:30', off_days: [0] },
      { school_id: schoolId, name: 'Early (7:30–14:00)',   start_time: '07:30', end_time: '14:00', off_days: [0] },
      { school_id: schoolId, name: 'Administrative (9:30–17:30)', start_time: '09:30', end_time: '17:30', off_days: [0] },
    ])} staff shifts`)
  }

  if (await isEmpty('professional_tax_slabs', schoolId)) {
    // The Uttar Pradesh-style ladder: nothing under 15k, rising in bands.
    console.log(`   ✓ ${await insert('professional_tax_slabs', [
      { school_id: schoolId, min_gross: 0,     max_gross: 15000, amount: 0 },
      { school_id: schoolId, min_gross: 15001, max_gross: 20000, amount: 150 },
      { school_id: schoolId, min_gross: 20001, max_gross: 30000, amount: 175 },
      { school_id: schoolId, min_gross: 30001, max_gross: null,  amount: 200 },
    ])} professional tax slabs`)
  }

  if (await isEmpty('staff_documents', schoolId)) {
    const DOCS: [string, string][] = [
      ['contract', 'Appointment letter'], ['id_proof', 'Aadhaar card'],
      ['certification', 'B.Ed certificate'], ['police_verification', 'Police verification'],
      ['policy', 'Code of conduct — signed'],
    ]
    const rows = (staff ?? []).flatMap((s: any, i: number) =>
      DOCS.slice(0, 2 + (i % 4)).map(([document_type, document_name], k) => ({
        school_id: schoolId, user_id: s.id, document_type, document_name,
        file_url: `https://example.invalid/staff/${s.id}/${document_type}.pdf`,
        file_size: `${120 + k * 40} KB`, mime_type: 'application/pdf',
        // A policy everyone must sign is the case the acknowledgment flag exists for.
        requires_acknowledgment: document_type === 'policy',
        acknowledged_at: document_type === 'policy' && i % 3 !== 0 ? new Date().toISOString() : null,
        expiry_date: document_type === 'police_verification' ? '2027-03-31' : null,
      })))
    console.log(`   ✓ ${await insert('staff_documents', rows)} staff documents`)
  }

  if (await isEmpty('staff_loans', schoolId)) {
    const rows = teachers.filter((_, i) => i % 7 === 0).map((t: any, i: number) => ({
      school_id: schoolId, user_id: t.id,
      principal_amount: 30000 + (i % 5) * 15000,
      reason: pick(['Medical emergency', 'Home renovation', 'Child admission fee', 'Vehicle purchase'], i),
      installment_amount: 2500 + (i % 3) * 500,
      installments_total: 12, installments_paid: i % 9,
      status: i % 6 === 0 ? 'settled' : 'active',
      issued_by: admin?.id ?? null,
    }))
    console.log(`   ✓ ${await insert('staff_loans', rows)} staff loans`)
  }

  if (await isEmpty('staff_bonuses', schoolId)) {
    const now = new Date()
    // One row per user per month — the table's unique index says so.
    const rows = (staff ?? []).filter((_, i) => i % 4 === 0).map((s: any, i: number) => ({
      school_id: schoolId, user_id: s.id,
      month: now.getMonth() + 1, year: now.getFullYear(),
      amount: 3000 + (i % 6) * 1500,
      reason: pick(['Festival bonus — Diwali', 'Performance incentive', 'Board results incentive', 'Long service award'], i),
      created_by: admin?.id ?? null,
    }))
    console.log(`   ✓ ${await insert('staff_bonuses', rows)} staff bonuses`)
  }

  // ── Who reports to whom ──
  //
  // staff_profiles.reporting_to has existed since the baseline schema and
  // nothing has ever written to it — there is no UI for it, and the seed left
  // it null for every member of staff. GET /hrms/staff/org-chart assembles a
  // tree from that column, so the Org Chart page rendered 57 people as 57
  // roots: a list, not a structure, and the one screen whose entire purpose is
  // showing the hierarchy was the one screen that could not.
  //
  // Derived from the designations already seeded rather than invented: PGT is
  // the senior grade in an Indian school, so the PGT of a subject heads it,
  // TGT and PRT report to them, subject heads report to the Vice Principal,
  // and the Vice Principal to the Principal.
  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, designation, department, reporting_to').eq('school_id', schoolId)
  const unset = (profiles ?? []).filter((p: any) => !p.reporting_to)
  if (profiles?.length && unset.length === profiles.length) {
    const by = (d: string) => (profiles ?? []).find((p: any) => p.designation === d)
    const principal = by('Principal'), vp = by('Vice Principal')
    const accounts = by('Accounts Officer')
    const top = vp?.user_id ?? principal?.user_id ?? null

    // subject -> its most senior teacher
    const GRADE = ['PGT', 'TGT', 'PRT']
    const teachers = (profiles ?? []).filter((p: any) => GRADE.some(g => p.designation?.startsWith(g + ' ')))
    const bySubject = new Map<string, any[]>()
    for (const t of teachers) {
      const subject = t.designation.slice(4)
      bySubject.set(subject, [...(bySubject.get(subject) ?? []), t])
    }

    const updates: { user_id: string; reporting_to: string | null }[] = []
    for (const [, group] of bySubject) {
      const ranked = [...group].sort((a, b) =>
        GRADE.indexOf(a.designation.slice(0, 3)) - GRADE.indexOf(b.designation.slice(0, 3)))
      const head = ranked[0]
      updates.push({ user_id: head.user_id, reporting_to: top })
      for (const t of ranked.slice(1)) updates.push({ user_id: t.user_id, reporting_to: head.user_id })
    }

    // Non-teaching. The Fee Clerk reports to the Accounts Officer, not to the
    // Principal — the one place the chart shows real depth outside teaching.
    const nonTeaching: [string, string | null | undefined][] = [
      ['Vice Principal', principal?.user_id],
      ['Accounts Officer', principal?.user_id],
      ['Fee Clerk', accounts?.user_id ?? principal?.user_id],
      ['Admission Counselor', top], ['Student Counselor', top], ['Librarian', top],
    ]
    for (const [designation, manager] of nonTeaching) {
      const p = by(designation)
      if (p && manager) updates.push({ user_id: p.user_id, reporting_to: manager })
    }

    let done = 0
    for (const u of updates) {
      // Nobody reports to themselves, and the Principal reports to no one.
      if (!u.reporting_to || u.reporting_to === u.user_id) continue
      const { error } = await supabase.from('staff_profiles')
        .update({ reporting_to: u.reporting_to }).eq('user_id', u.user_id).eq('school_id', schoolId)
      if (!error) done++
    }
    console.log(`   ✓ ${done} reporting lines (org chart)`)
  }

  // ── Fees: the policy tables ──
  if (await isEmpty('rte_rates', schoolId)) {
    // Banded by numeric_level, and the lowest band must start at -2: pre-primary
    // is Nursery -2, LKG -1, UKG 0. A band starting at 0 covers UKG and leaves
    // Nursery and LKG with no rate, which the claim run reports as "no state
    // rate set for Nursery" — 29 children skipped on this school.
    console.log(`   ✓ ${await insert('rte_rates', [
      { school_id: schoolId, academic_year_id: year.id, class_from: -2, class_to: 0, monthly_amount: 400, annual_allowance: 2500, note: 'Pre-primary (Nursery, LKG, UKG)' },
      { school_id: schoolId, academic_year_id: year.id, class_from: 1, class_to: 5,  monthly_amount: 450, annual_allowance: 3000, note: 'Primary' },
      { school_id: schoolId, academic_year_id: year.id, class_from: 6, class_to: 8,  monthly_amount: 600, annual_allowance: 3500, note: 'Upper primary' },
      { school_id: schoolId, academic_year_id: year.id, class_from: 9, class_to: 12, monthly_amount: 750, annual_allowance: 4000, note: 'Secondary and senior secondary' },
    ])} RTE rates`)
  }

  // ── Households ──
  //
  // The seed gives every child a unique parent phone, so backfillFamilies had
  // nothing to match on and `families` stayed empty however many students
  // existed — which meant the sibling concession, the one rule every Indian
  // school actually runs, could not be shown working. Real schools are full of
  // siblings, so the demo school gets some: pairs and the occasional trio,
  // deliberately across different classes, sharing one father's phone.
  if (await isEmpty('families', schoolId)) {
    const { data: kids } = await supabase.from('students')
      .select('id, first_name, last_name, class_id')
      .eq('school_id', schoolId).eq('status', 'active').limit(600)
    // Group by surname, then take children who are in DIFFERENT classes — two
    // siblings in one section is possible but unusual, and pairing across
    // classes is what makes the sibling-order logic visible.
    const bySurname = new Map<string, any[]>()
    for (const k of kids ?? []) bySurname.set(k.last_name, [...(bySurname.get(k.last_name) ?? []), k])

    const households: any[][] = []
    for (const [, group] of bySurname) {
      const seen = new Set<string>()
      const distinct = group.filter(g => !seen.has(g.class_id) && seen.add(g.class_id))
      for (let i = 0; i + 1 < distinct.length && households.length < 140; i += 3) {
        households.push(distinct.slice(i, i + (i % 7 === 0 ? 3 : 2)).filter(Boolean))
      }
    }

    let linked = 0
    for (const [i, hh] of households.entries()) {
      if (hh.length < 2) continue
      const surname = hh[0].last_name
      const phone = `+91 ${9700000000 + i}`
      const fatherName = `${pick(['Rajesh', 'Sunil', 'Anil', 'Vikas', 'Manoj', 'Deepak'], i)} ${surname}`

      const { data: fam, error: famErr } = await supabase.from('families')
        .insert({ school_id: schoolId, name: `${fatherName} household`, matched_on: 'father_phone' })
        .select('id').single()
      if (famErr) { console.log(`   ! families: ${famErr.message}`); break }

      await supabase.from('students').update({ family_id: fam.id }).in('id', hh.map(h => h.id))
      // The contact details have to agree with the grouping, or backfillFamilies
      // would later propose splitting the household it is looking at.
      await supabase.from('parents')
        .update({ father_name: fatherName, father_phone: phone })
        .in('student_id', hh.map(h => h.id))
      linked += hh.length
    }
    console.log(`   ✓ ${households.filter(h => h.length >= 2).length} households covering ${linked} students`)
  }

  if (await isEmpty('fee_concession_rules', schoolId)) {
    const tuition = (heads ?? []).find((h: any) => h.code === 'TUITION' || h.name === 'Tuition Fee')
    // Sibling concessions key on min_sibling_order, NOT on fee_category. The
    // order-based rules derive who the second child is from the family and
    // maintain themselves as children join and leave; the 'sibling' CATEGORY is
    // the legacy hand-applied tag the UI itself labels "prefer the rows above".
    // Seeding the category left both "Second child" and "Third child and
    // beyond" reading "Nothing — reporting only" on the Concession Rules screen.
    console.log(`   ✓ ${await insert('fee_concession_rules', [
      { school_id: schoolId, academic_year_id: year.id, fee_category: 'rte',         min_sibling_order: null, discount_type: 'percentage', discount_value: 100, fee_head_id: null, note: 'Reimbursed by the state, never billed to the family' },
      { school_id: schoolId, academic_year_id: year.id, fee_category: 'staff_ward',  min_sibling_order: null, discount_type: 'percentage', discount_value: 50, fee_head_id: tuition?.id ?? null, note: 'Children of serving staff' },
      { school_id: schoolId, academic_year_id: year.id, fee_category: 'scholarship', min_sibling_order: null, discount_type: 'fixed',      discount_value: 5000, fee_head_id: tuition?.id ?? null, note: 'Merit scholarship, reviewed annually' },
      { school_id: schoolId, academic_year_id: year.id, fee_category: null,          min_sibling_order: 2,    discount_type: 'percentage', discount_value: 10, fee_head_id: tuition?.id ?? null, note: 'Second child — derived from the family, senior child first' },
      { school_id: schoolId, academic_year_id: year.id, fee_category: null,          min_sibling_order: 3,    discount_type: 'percentage', discount_value: 20, fee_head_id: tuition?.id ?? null, note: 'Third child and beyond' },
    ])} concession rules`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const explicit = args.includes('--school') ? args[args.indexOf('--school') + 1] : null
  const { data: schools } = await supabase.from('schools').select('id, name').order('created_at')
  const real = (schools ?? []).filter(s => !s.name.startsWith('__vitest'))
  const school = explicit ? (schools ?? []).find(s => s.id === explicit) : real.length === 1 ? real[0] : null
  if (!school) {
    console.error(explicit ? `No school ${explicit}` : `Found ${real.length} schools — pass --school <id>`)
    process.exit(1)
  }
  console.log(`\n── Setup data for ${school.name} ──\n`)
  await seedExtras(school.id)
  console.log('\nDone.\n')
}

if (require.main === module) {
  main().catch(e => { console.error(`\n✖ ${e.message}\n`); process.exit(1) })
}
