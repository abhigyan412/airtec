import 'dotenv/config'
import { supabase } from './shared/db/client'
import { selectAll } from './shared/db/paged'

// Grouping existing students into households.
//
// `families` is empty on every existing database, and nothing can derive a
// sibling from `parents` as it stands — it is one row of loose text per student.
// This script proposes groupings from the contact details already captured and,
// only when asked, writes them.
//
// It runs in DRY MODE by default and prints what it would do. That is not
// politeness: mis-grouping two unrelated children into one family gives one of
// them a sibling discount they are not entitled to and quietly reduces what the
// school bills. A wrong grouping is a financial error, so somebody looks first.
//
//   npx tsx src/backfillFamilies.ts            # report only
//   npx tsx src/backfillFamilies.ts --apply    # write families and link students
//
// Matching is by exact normalised father_phone, then mother_phone, then
// father_aadhaar — strongest signal first, and a student already grouped by an
// earlier pass is never regrouped by a weaker one. Names are deliberately NOT
// matched on: "Kumar" would merge half a school.

type Rule = 'father_phone' | 'mother_phone' | 'father_aadhaar'
const RULES: Rule[] = ['father_phone', 'mother_phone', 'father_aadhaar']

/** Digits only, last 10 — so +91-98765 43210 and 9876543210 are one household. */
function normalisePhone(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

function normaliseId(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s/g, '')
  return s.length >= 8 ? s : null
}

const normalise = (rule: Rule, value: unknown) =>
  rule === 'father_aadhaar' ? normaliseId(value) : normalisePhone(value)

async function main() {
  const apply = process.argv.includes('--apply')

  const { data: schools, error: schoolErr } = await supabase.from('schools').select('id, name')
  if (schoolErr) throw new Error(schoolErr.message)

  for (const school of schools ?? []) {
    // Paged, both of them. A plain select stops at PostgREST's 1,000-row
    // default without saying so, and this school has 1,880 parent rows against
    // 1,810 active students — so the matcher saw about half the school and
    // every child whose sibling happened to sit past row 1,000 was reported as
    // an only child. Under-grouping is the safe direction, but silently is not.
    const parents = await selectAll<any>('parents',
      'student_id, father_name, father_phone, mother_phone, father_aadhaar',
      q => q.eq('school_id', school.id))

    const students = await selectAll<any>('students',
      'id, first_name, last_name, family_id',
      q => q.eq('school_id', school.id).eq('status', 'active'))

    const active = new Set((students ?? []).map(s => s.id))
    const nameOf = new Map((students ?? []).map(s => [s.id, `${s.first_name} ${s.last_name}`]))
    const alreadyGrouped = new Set((students ?? []).filter(s => s.family_id).map(s => s.id))

    // student_id -> the group it landed in, and why.
    const claimed = new Map<string, { key: string; rule: Rule }>()
    const groups = new Map<string, { rule: Rule; students: string[]; label: string }>()

    for (const rule of RULES) {
      const buckets = new Map<string, string[]>()
      for (const p of parents ?? []) {
        if (!active.has(p.student_id)) continue
        // Strongest match wins; a weaker rule never re-homes a student.
        if (claimed.has(p.student_id)) continue
        const value = normalise(rule, (p as any)[rule])
        if (!value) continue
        buckets.set(value, [...(buckets.get(value) ?? []), p.student_id])
      }

      for (const [value, ids] of buckets) {
        // A bucket of one is not a family worth creating a row for — an only
        // child needs no household to be billed correctly, and sibling_order
        // treats a NULL family_id as an only child anyway.
        if (ids.length < 2) continue
        const key = `${rule}:${value}`
        const label = ((parents ?? []) as any[]).find(p => p.student_id === ids[0])?.father_name ?? null
        groups.set(key, {
          rule,
          students: ids,
          label: label ? `${label} household` : `Household ${value.slice(-4)}`,
        })
        for (const id of ids) claimed.set(id, { key, rule })
      }
    }

    const grouped = [...groups.values()]
    const studentsInGroups = grouped.reduce((n, g) => n + g.students.length, 0)

    console.log(`\n── ${school.name} ─────────────────────────────`)
    console.log(`   active students        ${active.size}`)
    console.log(`   already in a family    ${alreadyGrouped.size}`)
    console.log(`   households proposed    ${grouped.length}`)
    console.log(`   students they cover    ${studentsInGroups}`)
    console.log(`   left as only children  ${active.size - studentsInGroups}`)

    if (!grouped.length) {
      // Stated plainly rather than dressed up. On seeded data every student has
      // a unique phone, so there is genuinely nothing to group — real sibling
      // data has to be imported or entered before any of this does work.
      console.log('   → nothing to group. Every student has unique contact details.')
      continue
    }

    for (const g of grouped.slice(0, 15)) {
      console.log(`   • ${g.label} [${g.rule}] — ${g.students.map(id => nameOf.get(id)).join(', ')}`)
    }
    if (grouped.length > 15) console.log(`   … and ${grouped.length - 15} more`)

    if (!apply) {
      console.log('   (dry run — re-run with --apply to write these)')
      continue
    }

    let written = 0
    for (const g of grouped) {
      const { data: family, error: famErr } = await supabase.from('families')
        .insert({ school_id: school.id, name: g.label, matched_on: g.rule })
        .select('id').single()
      if (famErr) { console.error(`   ! ${g.label}: ${famErr.message}`); continue }

      const { error: linkErr } = await supabase.from('students')
        .update({ family_id: family.id }).in('id', g.students)
      if (linkErr) { console.error(`   ! linking ${g.label}: ${linkErr.message}`); continue }
      written += g.students.length
    }
    console.log(`   ✓ ${written} students linked into ${grouped.length} households`)
  }

  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
