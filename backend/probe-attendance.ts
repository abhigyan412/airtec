import 'dotenv/config'
import { readFileSync } from 'fs'
import { supabase } from './src/shared/db/client'

const API = 'http://localhost:4000/api'
const creds = readFileSync('credentials-rashtra-bharti-public-inter-college.txt', 'utf8')
const pw = creds.split('\n').find(l => l.includes('admin@rashtrabharti.school'))!.trim().split(/\s+/).pop()!

;(async () => {
  const { data: school } = await supabase.from('schools').select('id')
    .eq('name', 'Rashtra Bharti Public Inter College').single()
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const nowUtc = now.toTimeString().slice(0, 8)

  console.log(`today=${today}  server clock=${nowUtc} (UTC)  weekday=${now.getDay()} (0=Sun)`)

  // ── the settings the sweep obeys ──
  const { data: settings } = await supabase.from('timetable_settings')
    .select('auto_detect_absence, auto_detect_after_period, working_days')
    .eq('school_id', school!.id).maybeSingle()
  console.log(`\nsettings: auto_detect=${settings?.auto_detect_absence} after_period=${settings?.auto_detect_after_period} working_days=${JSON.stringify(settings?.working_days)}`)

  // ── is anyone actually marking staff attendance? ──
  const { count: everRows } = await supabase.from('staff_attendance')
    .select('id', { count: 'exact', head: true }).eq('school_id', school!.id)
  const { data: todayRows } = await supabase.from('staff_attendance')
    .select('user_id, status, check_in, users:user_id(full_name)')
    .eq('school_id', school!.id).eq('date', today)
  console.log(`\nstaff_attendance: ${everRows} rows ever, ${todayRows?.length ?? 0} for today`)
  for (const r of todayRows ?? []) {
    console.log(`   ${(r as any).users?.full_name}: status=${r.status} check_in=${r.check_in ?? 'none'}`)
  }

  const { count: staffCount } = await supabase.from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', school!.id).eq('is_active', true).not('role', 'in', '("parent","student")')
  console.log(`   active staff: ${staffCount} — so ${(staffCount ?? 0) - (todayRows?.length ?? 0)} have no attendance row today`)

  // ── what the day looks like right now ──
  const dow = now.getDay()
  const { data: periods } = await supabase.from('timetable_periods')
    .select('teacher_id, period_number, start_time, end_time')
    .eq('school_id', school!.id).eq('day_of_week', dow).eq('is_break', false)
  const started = (periods ?? []).filter(p => p.start_time <= nowUtc)
  const remaining = (periods ?? []).filter(p => p.start_time > nowUtc)
  console.log(`\ntoday's grid (day ${dow}): ${periods?.length ?? 0} periods — ${started.length} started, ${remaining.length} still to come`)
  if (periods?.length) {
    const times = (periods ?? []).map(p => p.start_time).sort()
    console.log(`   first starts ${times[0]}, last starts ${times[times.length - 1]} (UTC)`)
  }

  // ── run the button ──
  const token = (await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rashtrabharti.school', password: pw }),
  })).json() as any).data.access_token
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const r = await fetch(`${API}/timetable/absences/detect`, {
    method: 'POST', headers: H, body: JSON.stringify({ date: today }),
  })
  const body = await r.text()
  console.log(`\n"Check attendance" -> ${r.status}`)
  console.log(`   ${body.slice(0, 300)}`)

  const absences = await (await fetch(`${API}/timetable/absences?date=${today}`, { headers: H })).json() as any
  const byStatus: Record<string, number> = {}
  for (const a of absences.data ?? []) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
  console.log(`   absences on the page afterwards: ${JSON.stringify(byStatus)}`)
})()
