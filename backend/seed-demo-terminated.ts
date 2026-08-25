// Makes the terminated staff at the demo school people who actually
// hold periods.
//
// Four were marked departed, but they had been chosen precisely because
// they teach nothing — so there was nothing to cover and only one name
// ever appeared. A departed teacher with no timetable is not a problem
// anybody needs to see; a departed teacher holding thirty periods is.
import 'dotenv/config'
import { supabase } from './src/shared/db/client'
import { fetchAll } from './src/modules/timetable/lib/core'

const API = 'http://localhost:4000/api'
const SCHOOL = 'Delhi Public School Lucknow'
const WANTED = 3
const DAYS_AHEAD = 3

;(async () => {
  const { data: school } = await supabase.from('schools').select('id').eq('name', SCHOOL).single()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await fetchAll<any>((f, t) => supabase.from('timetable_periods')
    .select('teacher_id').eq('school_id', school!.id).eq('is_break', false)
    .not('teacher_id', 'is', null).range(f, t), 'p')
  const weekly = new Map<string, number>()
  for (const r of rows) weekly.set(r.teacher_id, (weekly.get(r.teacher_id) ?? 0) + 1)

  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status, users:user_id(full_name)').eq('school_id', school!.id)

  const departed = (profiles ?? []).filter(p =>
    ['resigned', 'terminated', 'absconded'].includes(p.employment_status))
  console.log('currently departed:')
  for (const d of departed) {
    console.log(`   ${(d as any).users?.full_name} [${d.employment_status}] — ${weekly.get(d.user_id) ?? 0} periods/wk`)
  }

  const teaching = departed.filter(d => (weekly.get(d.user_id) ?? 0) > 0)
  const need = WANTED - teaching.length
  console.log(`\n${teaching.length} of them teach; want ${WANTED}`)

  if (need > 0) {
    // Don't take anybody already absent today — that would collide with
    // the absences the demo day already set up.
    const { data: busy } = await supabase.from('teacher_absences')
      .select('teacher_id').eq('school_id', school!.id).eq('absence_date', today).neq('status', 'cancelled')
    const taken = new Set((busy ?? []).map(b => b.teacher_id))
    const departedIds = new Set(departed.map(d => d.user_id))

    const pick = (profiles ?? [])
      .filter(p => !departedIds.has(p.user_id) && !taken.has(p.user_id) && (weekly.get(p.user_id) ?? 0) >= 10)
      .sort((a, b) => (weekly.get(b.user_id) ?? 0) - (weekly.get(a.user_id) ?? 0))
      .slice(0, need)

    for (let i = 0; i < pick.length; i++) {
      const status = i % 2 === 0 ? 'resigned' : 'terminated'
      await supabase.from('staff_profiles')
        .update({ employment_status: status }).eq('user_id', pick[i].user_id).eq('school_id', school!.id)
      console.log(`   ${(pick[i] as any).users?.full_name} -> ${status} (${weekly.get(pick[i].user_id)} periods/wk)`)
    }
  }

  // Surface them across today and the days ahead.
  const token = (await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dpslucknow.com', password: 'Admin@1234' }),
  })).json() as any).data.access_token
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  console.log('\nsurfacing them:')
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d = new Date(); d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    if (d.getDay() === 0) { console.log(`   ${date} Sunday — skipped`); continue }
    await fetch(`${API}/timetable/absences/sync-leave`, {
      method: 'POST', headers: H, body: JSON.stringify({ date }),
    })
    const det = await (await fetch(`${API}/timetable/absences/detect`, {
      method: 'POST', headers: H, body: JSON.stringify({ date }),
    })).json() as any
    const { data: abs } = await supabase.from('teacher_absences')
      .select('status, source, teacher:teacher_id(full_name)')
      .eq('school_id', school!.id).eq('absence_date', date).neq('status', 'cancelled')
    const { count: arr } = await supabase.from('arrangements')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school!.id).eq('arrangement_date', date).neq('status', 'cancelled')
    console.log(`   ${date}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}: ` +
      `+${det.data?.proposed ?? 0} proposed -> ${abs?.length ?? 0} away, ${arr} period(s) to cover`)
  }

  const b = await (await fetch(`${API}/timetable/views/block`, { headers: H })).json() as any
  console.log(`\nblock view: ${b.data.summary.departedTeachers} departed teacher(s), ${b.data.summary.departedPeriods} periods a week`)
  for (const c of b.data.conflicts.filter((x: any) => x.kind === 'teacher_departed')) {
    console.log(`   ${c.message.slice(0, 120)}`)
  }
})()
