// Waits for the next quarter-hour cron tick and reports whether the
// attendance sweep re-creates absences for staff who have left.
import 'dotenv/config'
import { supabase } from './src/shared/db/client'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const today = new Date().toISOString().slice(0, 10)
  const { data: schools } = await supabase.from('schools').select('id, name')
  const watched = (schools ?? []).filter(s => !s.name.startsWith('__vitest'))

  const snapshot = async () => {
    const out: Record<string, number> = {}
    for (const s of watched) {
      const { count } = await supabase.from('teacher_absences')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', s.id).eq('absence_date', today).eq('status', 'proposed')
      out[s.name] = count ?? 0
    }
    return out
  }

  const before = await snapshot()
  console.log(`before the tick (${new Date().toTimeString().slice(0, 8)}): ${JSON.stringify(before)}`)

  // Next :00/:15/:30/:45, plus 40s of slack for the sweep to finish.
  const now = new Date()
  const mins = now.getMinutes()
  const nextQuarter = (Math.floor(mins / 15) + 1) * 15
  const waitMs = ((nextQuarter - mins) * 60 - now.getSeconds()) * 1000 + 40_000
  console.log(`waiting ${Math.round(waitMs / 1000)}s for the cron tick...`)
  await sleep(waitMs)

  const after = await snapshot()
  console.log(`after  the tick (${new Date().toTimeString().slice(0, 8)}): ${JSON.stringify(after)}`)

  let regressed = false
  for (const s of watched) {
    const created = (after[s.name] ?? 0) - (before[s.name] ?? 0)
    if (created <= 0) continue
    const { data: fresh } = await supabase.from('teacher_absences')
      .select('teacher_id, reason, users:teacher_id(full_name)')
      .eq('school_id', s.id).eq('absence_date', today).eq('status', 'proposed')
    for (const row of fresh ?? []) {
      const { data: profile } = await supabase.from('staff_profiles')
        .select('employment_status').eq('user_id', row.teacher_id).maybeSingle()
      const gone = ['resigned', 'terminated', 'absconded'].includes(profile?.employment_status ?? '')
      if (gone) regressed = true
      console.log(`   ${s.name}: ${(row as any).users?.full_name} [${profile?.employment_status}] ${gone ? '<-- SHOULD NOT BE HERE' : ''}`)
    }
  }

  console.log(regressed
    ? '\nFAIL — the sweep is still proposing absences for staff who have left.'
    : '\nPASS — no departed staff proposed by the live cron tick.')
})()
