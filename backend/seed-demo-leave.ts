// Real leave, not a row inserted behind the app's back.
//
// The teacher applies through POST /hrms/leave-requests as themselves,
// and an approver approves it through PATCH /hrms/leave-requests/:id —
// the same two calls the UI makes. So it carries a real approval trail,
// runs the workflow engine, moves the leave balance, and shows up on
// /hr/leave exactly as a genuine request does. An inserted row looks
// right on the timetable and wrong everywhere else.
//
// Then it is pulled into the cover queue for every working day it spans,
// which is what a manager looking at tomorrow needs to see.
import 'dotenv/config'
import { supabase } from './src/shared/db/client'
import { fetchAll } from './src/modules/timetable/lib/core'

const API = 'http://localhost:4000/api'
const SCHOOL = 'Delhi Public School Lucknow'
const STAFF_PASSWORD = 'Staff@1234'
const ADMIN = { email: 'admin@dpslucknow.com', password: 'Admin@1234' }
const SPAN_DAYS = 3

const login = async (email: string, password: string) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json() as any
  return j?.data?.access_token as string | undefined
}

;(async () => {
  const { data: school } = await supabase.from('schools').select('id').eq('name', SCHOOL).single()
  const today = new Date().toISOString().slice(0, 10)
  const end = new Date(); end.setDate(end.getDate() + SPAN_DAYS)
  const endStr = end.toISOString().slice(0, 10)

  const adminToken = await login(ADMIN.email, ADMIN.password)
  const AH = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }

  // Remove the synthetic leave a previous run inserted directly.
  const { data: fake } = await supabase.from('leave_requests')
    .select('id').eq('school_id', school!.id).like('reason', 'Demo day%')
  if (fake?.length) {
    const { data: linked } = await supabase.from('teacher_absences')
      .select('id').in('leave_request_id', fake.map(f => f.id))
    for (const a of linked ?? []) {
      await supabase.from('arrangements').delete().eq('absence_id', a.id)
      await supabase.from('teacher_absences').delete().eq('id', a.id)
    }
    await supabase.from('leave_requests').delete().in('id', fake.map(f => f.id))
    console.log(`removed ${fake.length} directly-inserted leave row(s)`)
  }

  // A teacher who actually teaches across the week and can log in.
  const dow = new Date().getDay()
  const rows = await fetchAll<any>((f, t) => supabase.from('timetable_periods')
    .select('teacher_id').eq('school_id', school!.id).eq('is_break', false)
    .not('teacher_id', 'is', null).range(f, t), 'p')
  const load = new Map<string, number>()
  for (const r of rows) load.set(r.teacher_id, (load.get(r.teacher_id) ?? 0) + 1)

  const { data: staff } = await supabase.from('users')
    .select('id, full_name, email').eq('school_id', school!.id).eq('role', 'teacher')
  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status').eq('school_id', school!.id)
  const gone = new Set((profiles ?? [])
    .filter(p => ['resigned', 'terminated', 'absconded'].includes(p.employment_status))
    .map(p => p.user_id))

  const { data: busyToday } = await supabase.from('teacher_absences')
    .select('teacher_id').eq('school_id', school!.id).eq('absence_date', today).neq('status', 'cancelled')
  const taken = new Set((busyToday ?? []).map(a => a.teacher_id))

  const candidates = (staff ?? [])
    .filter(u => !gone.has(u.id) && !taken.has(u.id) && (load.get(u.id) ?? 0) >= 15)
    .sort((a, b) => (load.get(b.id) ?? 0) - (load.get(a.id) ?? 0))

  const { data: leaveTypes } = await supabase.from('leave_types').select('id, name').limit(3)
  if (!leaveTypes?.length) { console.log('no leave types configured'); return }

  let applied = 0
  for (const teacher of candidates.slice(0, 2)) {
    const token = await login(teacher.email, STAFF_PASSWORD)
    if (!token) { console.log(`   ${teacher.full_name}: cannot sign in, skipped`); continue }
    const type = leaveTypes[applied % leaveTypes.length]

    const apply = await fetch(`${API}/hrms/leave-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        leave_type_id: type.id,
        from_date: applied === 0 ? today : endStr,
        to_date: applied === 0 ? endStr : endStr,
        reason: applied === 0 ? 'Family wedding out of station' : 'Medical appointment',
      }),
    })
    const applyBody = await apply.json() as any
    if (!apply.ok) { console.log(`   ${teacher.full_name}: apply failed — ${applyBody?.error}`); continue }
    const requestId = applyBody.data?.id

    const approve = await fetch(`${API}/hrms/leave-requests/${requestId}`, {
      method: 'PATCH', headers: AH, body: JSON.stringify({ status: 'approved' }),
    })
    const approveBody = await approve.json() as any
    console.log(`   ${teacher.full_name}: applied for ${type.name} ` +
      `${applyBody.data?.from_date} to ${applyBody.data?.to_date} ` +
      `(${applyBody.data?.total_days} working days) -> approve ${approve.status}` +
      (approve.ok ? '' : ` — ${approveBody?.error}`))
    applied++
  }

  // Pull it into the cover queue for every day it covers.
  console.log('\npulling approved leave into the cover queue:')
  for (let i = 0; i <= SPAN_DAYS; i++) {
    const d = new Date(); d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    if (d.getDay() === 0) { console.log(`   ${date} Sunday — skipped`); continue }
    const sync = await (await fetch(`${API}/timetable/absences/sync-leave`, {
      method: 'POST', headers: AH, body: JSON.stringify({ date }),
    })).json() as any
    const det = await (await fetch(`${API}/timetable/absences/detect`, {
      method: 'POST', headers: AH, body: JSON.stringify({ date }),
    })).json() as any
    const { data: abs } = await supabase.from('teacher_absences')
      .select('status, source, teacher:teacher_id(full_name)')
      .eq('school_id', school!.id).eq('absence_date', date).neq('status', 'cancelled')
    const { count: arr } = await supabase.from('arrangements')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school!.id).eq('arrangement_date', date).neq('status', 'cancelled')
    console.log(`   ${date}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}: ` +
      `leave +${sync.data?.created ?? 0}, detected +${det.data?.proposed ?? 0} -> ` +
      `${abs?.length ?? 0} absence(s), ${arr} period(s) to cover`)
    for (const a of abs ?? []) console.log(`        ${(a as any).teacher?.full_name} [${a.status}/${a.source}]`)
  }
})()
