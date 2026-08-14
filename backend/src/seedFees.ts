import { randomUUID } from 'crypto'
import 'dotenv/config'
import { supabase } from './shared/db/client'
import { selectAll } from './shared/db/paged'
import { periodsForFrequency } from './shared/utils/billingPeriod'
import { lineBillsInPeriod } from './modules/fee/lib/resolve'

// ═══════════════════════════════════════════════════════════════
// Fee-only reseed, against the rewritten model.
//
// `npm run seed` cannot be used for this — it always INSERTs a new school, so a
// second run leaves you with two of everything. This works IN PLACE: it clears
// the fee tables on an existing school and rebuilds them, leaving students,
// staff, attendance and exams untouched.
//
//   npm run seed:fees
//   npm run seed:fees -- --school <id>
//   npm run seed:fees -- --dry-run
//
// Runs on the service-role key, so no database password is involved.
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const explicitSchool = args.includes('--school') ? args[args.indexOf('--school') + 1] : null

const money = (n: number) => Math.round(n * 100) / 100
const pick = <T,>(a: T[], i: number): T => a[i % a.length]

/** Deterministic — a reseed should be reproducible. */
const rnd = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x) }

/** YYYY-MM-DD plus N days, in UTC so a local timezone cannot shift the date. */
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const isMissing = (m: string) => /could not find the table|relation .* does not exist/i.test(m)
/** Network, not data: the request never landed, so re-sending it is safe. */
const isTransport = (m: string) =>
  /fetch failed|network|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|terminated/i.test(m)
const missingColumn = (m: string) => m.match(/could not find the '([^']+)' column/i)?.[1] ?? null

// Parents only, children first.
//
// fee_payment_allocations, fee_structure_lines, fee_structure_classes and
// fee_assignment_optionals are deliberately absent: they carry no school_id (they
// belong to their parent, not to a school) and every one of them is ON DELETE
// CASCADE, so clearing the parent takes them with it. Listing them here both
// failed on the missing column and was redundant.
const TABLES = [
  'fee_ledger_entries', 'fee_action_requests', 'fee_arrears',
  // Orders BEFORE payments: an order points at the payment it produced with
  // ON DELETE SET NULL, so clearing payments first would leave 'paid' orders
  // with a null payment_id — which the paid-implies-payment constraint forbids.
  'fee_payment_orders',
  'fee_payments', 'fee_adhoc_charges', 'fee_invoices',
  'fee_assignments', 'fee_scholarships', 'fee_discounts',
  'fee_discount_limits', 'fee_structures', 'fee_heads',
]

async function count(table: string, schoolId: string): Promise<number | null> {
  const { count: c, error } = await supabase
    .from(table).select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
  if (error) return isMissing(error.message) ? null : 0
  // A head-only count on a table PostgREST cannot see returns 204 with a NULL
  // count and NO error — treating that as 0 is how a missing table stays hidden.
  return c === null ? null : c
}

async function wipe(table: string, schoolId: string, scoped = true): Promise<number> {
  // fee_ledger_entries refuses DELETE by trigger — it is append-only, and a
  // reseed is the one job that legitimately needs past it. fee_ledger_force_delete
  // is the single sanctioned route (20260827000000); without it this script
  // could not run at all against a school that already had postings, which is
  // every school it is meant to regenerate.
  if (table === 'fee_ledger_entries') {
    const { data, error } = await supabase.rpc('fee_ledger_force_delete', { p_school_id: schoolId })
    if (error) {
      if (isMissing(error.message) || /could not find the function/i.test(error.message)) {
        console.log('   ! fee_ledger_force_delete not in this database — apply migration 20260827000000')
        return 0
      }
      throw new Error(`fee_ledger_entries clear: ${error.message}`)
    }
    return Number(data ?? 0)
  }

  let removed = 0
  for (;;) {
    let q = supabase.from(table).select('id').limit(500)
    if (scoped) q = q.eq('school_id', schoolId)
    const { data, error } = await q
    if (error) {
      if (isMissing(error.message)) return 0
      throw new Error(`${table}: ${error.message}`)
    }
    if (!data?.length) break
    const { error: delErr } = await supabase.from(table).delete().in('id', data.map(r => r.id))
    if (delErr) throw new Error(`${table} delete: ${delErr.message}`)
    removed += data.length
  }
  return removed
}

async function insert<T = any>(table: string, rows: any[], chunk = 400): Promise<T[]> {
  if (!rows.length) return []
  const out: T[] = []
  let payload = rows
  for (let i = 0; i < payload.length; i += chunk) {
    let slice = payload.slice(i, i + chunk)
    let { data, error } = await supabase.from(table).insert(slice).select()
    // Drop columns this database has not migrated in yet and retry — loudly,
    // because a seed that quietly writes fewer fields than it thinks is worse
    // than one that fails.
    while (error && missingColumn(error.message)) {
      const col = missingColumn(error.message)!
      console.log(`   ! ${table}.${col} not in this database — inserting without it`)
      payload = payload.map(r => { const { [col]: _d, ...rest } = r; return rest })
      slice = payload.slice(i, i + chunk)
      ;({ data, error } = await supabase.from(table).insert(slice).select())
    }
    // A transport failure is not a data problem — the request never got an
    // answer, so nothing was written and re-sending the same slice is safe.
    // These only started appearing once the seed grew to ~1,800 students and
    // the bulk loads got long enough to catch a blip, and losing a 20-minute
    // run to one dropped connection is not a reasonable failure mode.
    //
    // Deliberately narrow: only 'fetch failed' and its kin retry. A constraint
    // violation or a bad column still fails on the first attempt, because
    // re-sending those would just fail slower.
    for (let attempt = 1; error && isTransport(error.message) && attempt <= 4; attempt++) {
      const waitMs = 1000 * 2 ** (attempt - 1)
      console.log(`   … ${table}: ${error.message} — retry ${attempt}/4 in ${waitMs / 1000}s`)
      await new Promise(r => setTimeout(r, waitMs))
      ;({ data, error } = await supabase.from(table).insert(slice).select())
    }

    if (error) throw new Error(`${table} insert: ${error.message}`)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

/**
 * Exported so seed.ts can build fee data as its last step instead of carrying
 * a second implementation of the fee model — the one it used to carry drifted
 * against the 20260809 rewrite and broke every full reseed.
 *
 * Safe to call straight after a fresh seed: it wipes the school's fee tables
 * before rebuilding, so running it twice is the same as running it once.
 */
export async function seedFees(schoolId?: string) {
  return main(schoolId)
}

async function main(schoolIdOverride?: string) {
  console.log('\n── Fee reseed ──────────────────────────────────────\n')

  const { data: schools } = await supabase.from('schools').select('id, name').order('created_at')
  const real = (schools ?? []).filter(s => !s.name.startsWith('__vitest'))
  // The caller's school wins over guessing. seed.ts knows exactly which school
  // it just built and says so — without that this fell back to "there must be
  // precisely one real school", which is false the moment `seed -- --force`
  // adds a second, and the fallback's response is process.exit(1): the seed
  // would run to completion and then kill itself on its own last step.
  const wanted = schoolIdOverride ?? explicitSchool
  const school = wanted
    ? (schools ?? []).find(s => s.id === wanted)
    : real.length === 1 ? real[0] : null

  if (!school) {
    const why = wanted
      ? `No school ${wanted}`
      : `Found ${real.length} schools — pass --school <id>:\n` + real.map(s => `   ${s.id}  ${s.name}`).join('\n')
    // Thrown rather than exited, because this runs inside seed.ts too: a bare
    // process.exit there would end the whole seed with no error and no clue.
    if (schoolIdOverride) throw new Error(why)
    console.error(why)
    process.exit(1)
  }
  console.log(`School: ${school.name}\n        ${school.id}\n`)
  const schoolId = school.id

  console.log('Current:')
  for (const t of TABLES) {
    const c = await count(t, schoolId)
    if (c !== 0) console.log(`   ${t.padEnd(26)} ${c === null ? '— not created' : c}`)
  }
  if (DRY) { console.log('\n--dry-run: nothing changed.\n'); return }

  console.log('\nClearing…')
  for (const t of TABLES) {
    const n = await wipe(t, schoolId)
    if (n) console.log(`   – ${t}: ${n}`)
  }

  // Students are paged. A plain select stops at PostgREST's 1,000-row default
  // with no error and no truncation warning, so on this school it returned
  // 1,000 of 1,810 and quietly left 810 children with no fee assignment, no
  // invoice and no bill — a school whose fee module simply did not know about
  // 45% of its students. Nothing else read here can approach that limit: one
  // row per class, one per academic year, three staff.
  const [{ data: classes }, students, { data: years }, { data: staff }, { data: roles }] =
    await Promise.all([
      supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
      selectAll<any>('students', 'id, class_id',
        q => q.eq('school_id', schoolId).eq('status', 'active')),
      supabase.from('academic_years').select('id, name, is_current, start_date, end_date').eq('school_id', schoolId),
      supabase.from('users').select('id').eq('school_id', schoolId).limit(3),
      supabase.from('roles').select('id, name').eq('school_id', schoolId),
    ])

  const year = (years ?? []).find(y => y.is_current) ?? (years ?? [])[0]
  if (!year) throw new Error('No academic year')
  if (!classes?.length) throw new Error('No classes')
  if (!students?.length) throw new Error('No active students')
  const by = (staff ?? [])[0]?.id ?? null

  console.log(`\nBuilding: ${students.length} students · ${classes.length} classes · ${year.name}`)

  // ── Catalogue ──
  const HEADS = [
    ['Tuition Fee', 'TUITION', 2500, false],
    ['Exam Fee', 'EXAM', 500, false],
    ['Library Fee', 'LIBRARY', 800, false],
    ['Sports Fee', 'SPORTS', 1200, false],
    ['Annual Fund', 'ANNUAL_FUND', 5000, false],
    ['Computer Fee', 'COMPUTER', 600, false],
    ['Transport Fee', 'TRANSPORT', 1500, false],   // optional
    ['Hostel Fee', 'HOSTEL', 8000, false],         // optional
    ['Caution Money', 'CAUTION', 2000, true],
  ] as const

  const heads = await insert('fee_heads', HEADS.map(([name, code, amt, refundable]) => ({
    school_id: schoolId, name, code, default_amount: amt, is_refundable: refundable,
  })))
  const headBy = Object.fromEntries(heads.map((h: any) => [h.code, h]))
  console.log(`   ✓ ${heads.length} fee heads`)

  // ── One structure per class: a named, versioned plan ──
  const structures = await insert('fee_structures', classes.map((c, i) => ({
    school_id: schoolId, academic_year_id: year.id,
    name: `${c.name} — Standard ${year.name}`,
    code: `STD_${c.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    frequency: 'quarterly',
    // A spread of late-fee rules so every mode has data behind it.
    late_fee_mode: i % 3 === 0 ? 'per_day' : i % 3 === 1 ? 'fixed' : 'percent_monthly',
    late_fee_value: i % 3 === 0 ? 10 : i % 3 === 1 ? 250 : 2,
    late_fee_grace_days: i % 2 === 0 ? 5 : 0,
    starts_on: year.start_date,
    status: 'active', created_by: by,
  })))

  const structureByClass = new Map(structures.map((s: any, i) => [classes[i].id, s]))

  // Senior classes get Computer; a slice get Hostel. Optional lines are the
  // point of the model: priced for the class, billed only to who takes them.
  // The fourth column is period_tokens: null recurs every installment, ['Q1']
  // charges once when the year opens. Annual Fund and Caution Money exist for
  // exactly that — before lines could name their periods, putting them on a
  // quarterly plan billed them four times, so they sat in the head catalogue
  // unused and had to be raised as ad-hoc charges by hand.
  const lines: any[] = []
  const links: any[] = []
  structures.forEach((s: any, i) => {
    const cls = classes[i]
    const senior = /1[0-2]|9/.test(cls.name)
    const set = [
      [headBy.TUITION, 2500 + (i % 6) * 400, false, null],
      [headBy.EXAM, 500, false, null],
      [headBy.LIBRARY, 800, false, null],
      [headBy.SPORTS, 1200, false, null],
      ...(senior ? [[headBy.COMPUTER, 600, false, null] as const] : []),
      [headBy.ANNUAL_FUND, 5000, false, ['Q1']],
      [headBy.CAUTION, 2000, false, ['Q1']],
      [headBy.TRANSPORT, 1500, true, null],
      ...(senior ? [[headBy.HOSTEL, 8000, true, null] as const] : []),
    ]
    set.forEach(([head, amount, optional, periods]: any, k) => lines.push({
      structure_id: s.id, fee_head_id: head.id, amount, is_optional: optional,
      period_tokens: periods, sort_order: k,
    }))
    links.push({ structure_id: s.id, class_id: cls.id })
  })

  await insert('fee_structure_lines', lines)
  await insert('fee_structure_classes', links)

  // ── The schedule: when each installment is raised and when it is due ──
  //
  // Due FIFTEEN DAYS AFTER the quarter opens, not on the last day of it. That is
  // what a school actually does — fees are collected at the start of a term, and
  // a due date on the closing day means the money arrives a quarter late by
  // design. The old code had no schedule at all and defaulted to the period end,
  // which is why this is worth stating in the seed rather than inheriting.
  const periods = periodsForFrequency('quarterly', year.start_date, year.end_date)
  const schedules = structures.flatMap((s: any) =>
    periods.map((p, k) => ({
      structure_id: s.id,
      period_token: p.token,
      label: p.label,
      bills_on: p.start,
      due_date: addDays(p.start, 14),
      sort_order: k,
    })))
  await insert('fee_structure_schedules', schedules)
  console.log(`   ✓ ${structures.length} structures · ${lines.length} lines · ${schedules.length} scheduled installments`)

  // ── Assign every student to their class's plan ──
  const CATEGORIES = ['general', 'general', 'general', 'general', 'sibling', 'staff_ward', 'rte']
  const assignments = await insert('fee_assignments', students
    .filter(s => s.class_id && structureByClass.has(s.class_id))
    .map((s, i) => ({
      school_id: schoolId, student_id: s.id,
      structure_id: (structureByClass.get(s.class_id!) as any).id,
      academic_year_id: year.id,
      fee_category: pick(CATEGORIES, i),
      start_date: year.name.slice(0, 4) + '-04-01',
      assigned_by: by,
    })))
  console.log(`   ✓ ${assignments.length} assignments`)

  // ── Optional opt-ins: ~35% take transport, ~15% hostel ──
  const { data: optionalLines } = await supabase
    .from('fee_structure_lines').select('id, structure_id, fee_head_id').eq('is_optional', true)
  const optByStructure = new Map<string, any[]>()
  for (const l of optionalLines ?? []) {
    const list = optByStructure.get(l.structure_id) ?? []
    list.push(l); optByStructure.set(l.structure_id, list)
  }

  const optIns: any[] = []
  assignments.forEach((a: any, i) => {
    for (const line of optByStructure.get(a.structure_id) ?? []) {
      const isHostel = line.fee_head_id === headBy.HOSTEL?.id
      if (rnd(i * 7 + (isHostel ? 3 : 1)) > (isHostel ? 0.15 : 0.35)) continue
      optIns.push({ assignment_id: a.id, structure_line_id: line.id, note: 'Seeded', opted_in_by: by })
    }
  })
  await insert('fee_assignment_optionals', optIns)
  console.log(`   ✓ ${optIns.length} optional opt-ins`)

  // ── Invoices: two quarters, so aging has a settled period and a live one ──
  const { data: fullLines } = await supabase
    .from('fee_structure_lines')
    .select('id, structure_id, fee_head_id, amount, is_optional, period_tokens, fee_heads(name)')
  const linesByStructure = new Map<string, any[]>()
  for (const l of fullLines ?? []) {
    const list = linesByStructure.get(l.structure_id) ?? []
    list.push(l); linesByStructure.set(l.structure_id, list)
  }
  const takenSet = new Set(optIns.map(o => `${o.assignment_id}::${o.structure_line_id}`))

  const yearStart = Number(year.name.slice(0, 4))
  // Read off the schedule written above rather than restated here — two places
  // holding the same due date is how they drift.
  const PERIODS = periods.slice(0, 2).map(p => ({
    token: p.token,
    key: `quarterly:${p.token}`,
    due: addDays(p.start, 14),
  }))

  const invoiceRows: any[] = []
  let seq = 0
  for (const period of PERIODS) {
    for (const a of assignments as any[]) {
      const billable = (linesByStructure.get(a.structure_id) ?? [])
        .filter(l => !l.is_optional || takenSet.has(`${a.id}::${l.id}`))
        // Same rule the billing run applies, so seeded invoices and generated
        // ones agree: Annual Fund and Caution Money land on Q1 and nowhere else.
        .filter(l => lineBillsInPeriod(l.period_tokens, period.token))
      if (!billable.length) continue
      seq += 1

      const items = billable.map(l => ({
        fee_head_id: l.fee_head_id, name: (l.fee_heads as any)?.name ?? 'Fee',
        amount: money(Number(l.amount)), discount: 0, net_amount: money(Number(l.amount)),
      }))
      const subtotal = money(items.reduce((s, l) => s + l.amount, 0))

      invoiceRows.push({
        school_id: schoolId, student_id: a.student_id, academic_year_id: year.id,
        assignment_id: a.id,
        invoice_number: `INV${yearStart}${String(seq).padStart(5, '0')}`,
        period_key: period.key, due_date: period.due,
        line_items: items, subtotal, discount_total: 0, late_fee: 0,
        total_amount: subtotal, status: 'unpaid', created_by: by,
      })
    }
  }
  const invoices = await insert('fee_invoices', invoiceRows, 300)
  console.log(`   ✓ ${invoices.length} invoices`)

  // Raising an invoice is what recognises the income and creates the debt —
  // the accrual. Nothing here posted it before, so the ledger knew only about
  // money that had arrived: receivable sat at zero however much was owed, and
  // fee_reconciliation's receivable_vs_invoices invariant failed on every
  // seeded database by the full outstanding balance. Mirrors postInvoice() in
  // modules/fee/lib/ledger.ts.
  const accrual: any[] = []
  for (const inv of invoices as any[]) {
    const net = money(Number(inv.total_amount))
    if (net <= 0) continue
    accrual.push(
      { school_id: schoolId, source_type: 'invoice', source_id: inv.id, student_id: inv.student_id,
        account_code: 'receivable', debit: net, credit: 0 },
      { school_id: schoolId, source_type: 'invoice', source_id: inv.id, student_id: inv.student_id,
        account_code: 'fee_income', debit: 0, credit: net },
    )
  }
  await insert('fee_ledger_entries', accrual, 400)
  console.log(`   ✓ ${accrual.length} accrual entries`)

  // ── Payments: ONE transaction per student, allocated across their invoices ──
  //
  // The whole point of the new model. A third pay in full, a third partially,
  // a third not at all — so every status filter lands on something.
  const byStudent = new Map<string, any[]>()
  for (const inv of invoices as any[]) {
    const list = byStudent.get(inv.student_id) ?? []
    list.push(inv); byStudent.set(inv.student_id, list)
  }

  const payments: any[] = []
  const allocations: any[] = []
  const ledger: any[] = []
  let rcpt = 0

  Array.from(byStudent.entries()).forEach(([studentId, invs], i) => {
    const roll = rnd(i)
    if (roll < 0.33) return

    const total = money(invs.reduce((s, v) => s + Number(v.total_amount), 0))
    const amount = roll < 0.66 ? total : money(Math.max(100, Math.floor(total * (0.25 + rnd(i + 9) * 0.5))))
    const paymentId = randomUUID()
    rcpt += 1

    let left = amount
    for (const inv of invs) {
      if (left <= 0.01) break
      const take = money(Math.min(Number(inv.total_amount), left))
      allocations.push({ payment_id: paymentId, invoice_id: inv.id, amount: take })
      left = money(left - take)
    }

    const method = pick(['cash', 'upi', 'cheque', 'neft', 'card', 'online'], i)
    payments.push({
      id: paymentId, school_id: schoolId, student_id: studentId,
      receipt_number: `RCP${yearStart}${String(rcpt).padStart(5, '0')}`,
      amount, method, collected_by: by,
      payment_date: new Date(Date.now() - Math.floor(rnd(i + 3) * 120) * 86_400_000).toISOString(),
    })

    // Asset debited, RECEIVABLE relieved — not income. Income was already
    // recognised when the invoice was raised (see the accrual posting above);
    // crediting it again here would count every rupee twice and, because
    // receivable was never touched, leave the ledger claiming the school is
    // owed nothing while its invoices say otherwise. That is exactly what
    // fee_reconciliation's receivable_vs_invoices check caught on seeded data.
    // Mirrors postPayment() in modules/fee/lib/ledger.ts.
    ledger.push(
      { school_id: schoolId, source_type: 'payment', source_id: paymentId, student_id: studentId,
        account_code: method === 'cash' ? 'cash' : 'bank', debit: amount, credit: 0 },
      { school_id: schoolId, source_type: 'payment', source_id: paymentId, student_id: studentId,
        account_code: 'receivable', debit: 0, credit: amount },
    )
  })

  await insert('fee_payments', payments, 300)
  await insert('fee_payment_allocations', allocations, 300)
  await insert('fee_ledger_entries', ledger, 400)
  console.log(`   ✓ ${payments.length} payments · ${allocations.length} allocations · ${ledger.length} ledger entries`)

  // ── One-off charges, each raised as a real invoice ──
  const CHARGES = [
    ['Delhi educational trip', 2500], ['Replacement textbook', 450],
    ['Re-examination fee', 300], ['Annual day costume', 600], ['Science exhibition kit', 750],
  ] as const

  const chargeStudents = (assignments as any[]).filter((_, i) => i % 16 === 0)
  const charges = await insert('fee_adhoc_charges', chargeStudents.map((a, i) => {
    const [title, amount] = pick(CHARGES as any, i) as [string, number]
    return {
      school_id: schoolId, student_id: a.student_id, title, amount,
      description: 'Seeded one-off charge',
      due_date: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10),
      created_by: by,
    }
  }))

  const chargeInvoices = await insert('fee_invoices', charges.map((c: any, i) => {
    const amt = money(Number(c.amount))
    return {
      school_id: schoolId, student_id: c.student_id, academic_year_id: year.id,
      invoice_number: `INV${yearStart}9${String(i + 1).padStart(4, '0')}`,
      due_date: c.due_date,
      line_items: [{ fee_head_id: null, name: c.title, amount: amt, discount: 0, net_amount: amt, adhoc_charge_id: c.id }],
      subtotal: amt, discount_total: 0, late_fee: 0, total_amount: amt, status: 'unpaid', created_by: by,
    }
  }), 200)

  for (const [i, inv] of (chargeInvoices as any[]).entries()) {
    const c = (charges as any[])[i]
    if (c) await supabase.from('fee_adhoc_charges').update({ invoice_id: inv.id, status: 'billed' }).eq('id', c.id)
  }
  // A one-off charge raised as an invoice is owed exactly like any other, so it
  // accrues the same way — otherwise these would be the one slice of the
  // outstanding balance the ledger could not account for.
  await insert('fee_ledger_entries', (chargeInvoices as any[]).flatMap(inv => {
    const amt = money(Number(inv.total_amount))
    return amt <= 0 ? [] : [
      { school_id: schoolId, source_type: 'invoice', source_id: inv.id, student_id: inv.student_id,
        account_code: 'receivable', debit: amt, credit: 0 },
      { school_id: schoolId, source_type: 'invoice', source_id: inv.id, student_id: inv.student_id,
        account_code: 'fee_income', debit: 0, credit: amt },
    ]
  }), 400)
  console.log(`   ✓ ${charges.length} one-off charges (all billed, accrued)`)

  // ── Concessions, ceilings, scholarships ──
  const roleBy = Object.fromEntries((roles ?? []).map(r => [r.name, r.id]))
  await insert('fee_discount_limits', [
    ['School Admin', 25000, null], ['Principal', 15000, 100000], ['Accountant', 5000, 40000],
  ].filter(([n]) => roleBy[n as string]).map(([n, single, monthly]) => ({
    school_id: schoolId, role_id: roleBy[n as string],
    max_single_discount: single, max_monthly_total: monthly,
  })))

  const REASONS = ['Sibling concession', 'Staff ward', 'Financial hardship', 'Merit award']
  const discounts = await insert('fee_discounts', (assignments as any[])
    .filter((_, i) => i % 25 === 0).map((a, i) => ({
      school_id: schoolId, student_id: a.student_id,
      discount_type: i % 3 === 0 ? 'percentage' : 'fixed',
      discount_value: i % 3 === 0 ? 10 : 1500,
      reason: pick(REASONS, i),
      // A spread across all three states so the approvals queue is not empty.
      approval_status: i % 4 === 0 ? 'pending' : i % 4 === 1 ? 'rejected' : 'approved',
      requested_by: by,
    })))

  const scholarships = await insert('fee_scholarships', (assignments as any[])
    .filter((_, i) => i % 60 === 0).map((a, i) => ({
      school_id: schoolId, student_id: a.student_id, academic_year_id: year.id,
      name: pick(['State Merit Scholarship', 'Alumni Trust Grant', 'Principal\'s Award'], i),
      funding_source: pick(['government', 'trust', 'school'], i),
      amount: pick([5000, 12000, 8000], i), created_by: by,
    })))
  console.log(`   ✓ ${discounts.length} concessions · ${scholarships.length} scholarships`)

  // ── Requests awaiting a decision, pointed at real payments ──
  const requests = await insert('fee_action_requests', (payments as any[]).slice(0, 6).map((p, i) => ({
    school_id: schoolId,
    kind: i % 3 === 0 ? 'payment_cancel' : i % 3 === 1 ? 'refund' : 'late_fee_waiver',
    target_id: i % 3 === 2 ? (invoices as any[])[i]?.id ?? p.id : p.id,
    student_id: p.student_id,
    amount: i % 3 === 1 ? money(Number(p.amount) / 2) : Number(p.amount),
    reason: pick(['Recorded against the wrong student', 'Parent overpaid at the counter', 'Cheque bounced'], i),
    requested_by: by,
  })))
  console.log(`   ✓ ${requests.length} pending requests`)

  // ── Advance the number counters past what was just written ──
  //
  // Invoice and receipt numbers are composed here directly — this is a bulk
  // load, not thousands of next_document_number() round trips — so the
  // counters still sit at zero afterwards. The first payment taken through the
  // UI would then be issued RCP<year>00001, which already exists, and die on
  // the unique constraint. Nothing advanced these before, in this script or in
  // seed.ts, so a freshly seeded school could not take its first payment.
  //
  // The ad-hoc invoices use a 9xxxx block, which outranks the main sequence —
  // the counter has to clear the highest number actually issued, not the
  // longest run.
  const highestInvoiceSeq = Math.max(seq, 90_000 + (chargeInvoices as any[]).length)
  const counterRows = [
    { prefix: 'INV', last_number: highestInvoiceSeq },
    { prefix: 'RCP', last_number: (payments as any[]).length },
  ].map(c => ({ school_id: schoolId, year: yearStart, ...c }))
  const { error: counterErr } = await supabase.from('document_counters')
    .upsert(counterRows, { onConflict: 'school_id,year,prefix' })
  if (counterErr) console.log(`   ⚠️  document_counters: ${counterErr.message}`)
  else console.log(`   ✓ counters advanced (INV→${highestInvoiceSeq}, RCP→${(payments as any[]).length})`)

  // ── Result ──
  console.log('\nAfter:')
  for (const t of TABLES) {
    const c = await count(t, schoolId)
    if (c) console.log(`   ${t.padEnd(26)} ${c}`)
  }

  const spread: Record<string, number> = {}
  for (const st of ['unpaid', 'partial', 'paid', 'carried_forward', 'cancelled']) {
    const { count: c } = await supabase.from('fee_invoices')
      .select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', st)
    if (c) spread[st] = c
  }
  console.log(`\nInvoice status: ${JSON.stringify(spread)}`)
  console.log('(derived by the database from the allocations above)\n')
}

// Only when run as `npm run seed:fees`. Without the guard, seed.ts importing
// seedFees would fire this at module load — before the school it needs exists.
if (require.main === module) {
  main().catch(e => { console.error(`\n✖ ${e.message}\n`); process.exit(1) })
}
