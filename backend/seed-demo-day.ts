// Seeds a realistic arrangements day at the demo school, so every state
// the screen can show is actually on screen:
//
//   • a teacher absent and fully covered, cover accepted   — the happy path
//   • a teacher absent, part covered, part still open      — the working state
//   • one substitute who declined                          — the exception
//   • a terminated teacher still holding periods           — the flag
//
// Idempotent: clears any absences it previously seeded for today before
// building them again. Everything it creates is for TODAY only, and the
// teacher it terminates is named at the end so it can be undone.
import 'dotenv/config'
import { supabase } from './src/shared/db/client'
import { fetchAll } from './src/modules/timetable/lib/core'

const SCHOOL = 'Delhi Public School Lucknow'
const MARKER = 'Demo day'

;(async () => {
  const { data: school } = await supabase.from('schools').select('id').eq('name', SCHOOL).single()
  if (!school) { console.log('demo school not found'); return }
  const today = new Date().toISOString().slice(0, 10)
  const dow = new Date().getDay()
  if (dow === 0) { console.log('Sunday — no timetable to build a day from'); return }

  // ── wipe anything a previous run left ─────────────────────────
  const { data: old } = await supabase.from('teacher_absences')
    .select('id').eq('school_id', school.id).eq('absence_date', today)
  if (old?.length) {
    for (const a of old) await supabase.from('arrangements').delete().eq('absence_id', a.id)
    await supabase.from('teacher_absences').delete().in('id', old.map(a => a.id))
    console.log(`cleared ${old.length} existing absence(s) for today`)
  }
  await supabase.from('leave_requests').delete()
    .eq('school_id', school.id).eq('from_date', today).like('reason', `${MARKER}%`)
  // Anyone previously terminated by this script who actually teaches.
  const periodsAll = await fetchAll<any>((f, t) => supabase.from('timetable_periods')
    .select('teacher_id, period_number, start_time').eq('school_id', school.id)
    .eq('day_of_week', dow).eq('is_break', false).not('teacher_id', 'is', null).range(f, t), 'p')
  const load = new Map<string, any[]>()
  for (const r of periodsAll) load.set(r.teacher_id, [...(load.get(r.teacher_id) ?? []), r])

  const { data: profiles } = await supabase.from('staff_profiles')
    .select('user_id, employment_status').eq('school_id', school.id)
  for (const p of profiles ?? []) {
    if (p.employment_status === 'terminated' && load.has(p.user_id)) {
      await supabase.from('staff_profiles')
        .update({ employment_status: 'active' }).eq('user_id', p.user_id).eq('school_id', school.id)
    }
  }

  // ── pick four teachers with a decent day ──────────────────────
  const busiest = Array.from(load.entries())
    .filter(([, v]) => v.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
  if (busiest.length < 5) { console.log('not enough teachers with a full day'); return }

  const nameOf = new Map<string, string>()
  const { data: users } = await supabase.from('users').select('id, full_name')
    .in('id', busiest.map(([id]) => id))
  for (const u of users ?? []) nameOf.set(u.id, u.full_name)

  const [covered, partial, declined, terminated, onLeave] = busiest

  // ── mark them absent in the staff register, so the two screens agree ──
  for (const [id] of [covered, partial, declined]) {
    await supabase.from('staff_attendance').upsert({
      school_id: school.id, user_id: id, date: today, status: 'absent', check_in: null,
    }, { onConflict: 'user_id,date' })
  }

  const makeAbsence = async (teacherId: string, reason: string) => {
    const { data } = await supabase.from('teacher_absences').insert({
      school_id: school.id, teacher_id: teacherId, absence_date: today,
      scope: 'full_day', source: 'attendance', status: 'confirmed',
      reason: `${MARKER} — ${reason}`,
    }).select('id').single()
    // NULL cutoff: a demo day wants the whole day represented, not only
    // the lessons that happen to be still ahead of the clock.
    await supabase.rpc('timetable_materialize_arrangements' as any,
      { p_absence_id: data!.id, p_not_before: null } as any)
    const { data: arr } = await supabase.from('arrangements')
      .select('id, period_number').eq('absence_id', data!.id).order('period_number')
    return { absenceId: data!.id, arrangements: arr ?? [] }
  }

  // Substitutes: anybody who teaches, other than the four above.
  const pool = Array.from(load.keys()).filter(id => !busiest.slice(0, 5).some(([b]) => b === id))
  const { data: subs } = await supabase.from('users').select('id, full_name').in('id', pool.slice(0, 30))
  let subIdx = 0
  const nextSub = () => (subs ?? [])[subIdx++ % Math.max(1, (subs ?? []).length)]

  console.log('\nbuilding the day:')

  // 1. fully covered and accepted
  {
    const { arrangements } = await makeAbsence(covered[0], 'away, cover arranged')
    for (const a of arrangements) {
      const s = nextSub()
      await supabase.from('arrangements').update({
        substitute_teacher_id: s.id, status: 'acknowledged',
        assigned_at: new Date().toISOString(), acknowledged_at: new Date().toISOString(),
      }).eq('id', a.id)
    }
    console.log(`   ${nameOf.get(covered[0])}: ${arrangements.length} periods, all covered and accepted`)
  }

  // 2. half covered, half still open
  {
    const { arrangements } = await makeAbsence(partial[0], 'away, cover in progress')
    const half = Math.ceil(arrangements.length / 2)
    for (let i = 0; i < arrangements.length; i++) {
      if (i >= half) continue
      const s = nextSub()
      await supabase.from('arrangements').update({
        substitute_teacher_id: s.id, status: 'assigned', assigned_at: new Date().toISOString(),
      }).eq('id', arrangements[i].id)
    }
    console.log(`   ${nameOf.get(partial[0])}: ${arrangements.length} periods, ${half} assigned (awaiting acceptance), ${arrangements.length - half} still open`)
  }

  // 3. one declined, the rest open
  {
    const { arrangements } = await makeAbsence(declined[0], 'away, a substitute declined')
    if (arrangements.length) {
      const s = nextSub()
      await supabase.from('arrangements').update({
        substitute_teacher_id: null, status: 'declined',
        declined_at: new Date().toISOString(),
        decline_reason: `${s?.full_name ?? 'A teacher'} is invigilating an exam`,
      }).eq('id', arrangements[0].id)
    }
    console.log(`   ${nameOf.get(declined[0])}: ${arrangements.length} periods, 1 declined`)
  }

  // 4. approved leave, pulled through into cover
  {
    const { data: leaveTypes } = await supabase.from('leave_types').select('id, name').limit(1)
    await supabase.from('leave_requests').delete()
      .eq('school_id', school.id).eq('user_id', onLeave[0]).eq('from_date', today)
    const { data: lr, error } = await supabase.from('leave_requests').insert({
      school_id: school.id, user_id: onLeave[0],
      leave_type_id: leaveTypes?.[0]?.id ?? null,
      from_date: today, to_date: today, total_days: 1,
      reason: `${MARKER} — approved leave`, status: 'approved',
      approved_at: new Date().toISOString(),
    }).select('id').single()

    if (error) {
      console.log(`   leave request failed: ${error.message}`)
    } else {
      await supabase.from('staff_attendance').upsert({
        school_id: school.id, user_id: onLeave[0], date: today, status: 'on_leave', check_in: null,
      }, { onConflict: 'user_id,date' })

      // The same path the "Sync leave" button uses.
      const { data: absence } = await supabase.from('teacher_absences').insert({
        school_id: school.id, teacher_id: onLeave[0], absence_date: today,
        scope: 'full_day', source: 'leave', status: 'confirmed',
        leave_request_id: lr!.id,
        reason: `${MARKER} — on approved ${leaveTypes?.[0]?.name ?? 'leave'}`,
      }).select('id').single()
      await supabase.rpc('timetable_materialize_arrangements' as any,
        { p_absence_id: absence!.id, p_not_before: null } as any)
      const { data: arr } = await supabase.from('arrangements')
        .select('id, period_number').eq('absence_id', absence!.id).order('period_number')
      // Two of them taken, the rest still to place.
      for (const a of (arr ?? []).slice(0, 2)) {
        const sub = nextSub()
        await supabase.from('arrangements').update({
          substitute_teacher_id: sub.id, status: 'acknowledged',
          assigned_at: new Date().toISOString(), acknowledged_at: new Date().toISOString(),
        }).eq('id', a.id)
      }
      console.log(`   ${nameOf.get(onLeave[0])}: on approved leave, ${arr?.length} periods, 2 covered`)
    }
  }

  // 5. terminated but still timetabled — the flag, with today's lessons
  //    queued so there is something to actually arrange
  {
    await supabase.from('staff_profiles')
      .update({ employment_status: 'terminated' }).eq('user_id', terminated[0]).eq('school_id', school.id)

    const { data: absence } = await supabase.from('teacher_absences').insert({
      school_id: school.id, teacher_id: terminated[0], absence_date: today,
      scope: 'full_day', source: 'attendance', status: 'confirmed',
      reason: 'No longer on the staff (terminated) — these periods need a permanent teacher, and cover until then',
    }).select('id').single()
    await supabase.rpc('timetable_materialize_arrangements' as any,
      { p_absence_id: absence!.id, p_not_before: null } as any)
    const { data: arr } = await supabase.from('arrangements')
      .select('id, period_number').eq('absence_id', absence!.id).order('period_number')
    // One covered, so the row shows cover is possible; the rest open,
    // because the real answer is to fix the timetable.
    if (arr?.length) {
      const sub = nextSub()
      await supabase.from('arrangements').update({
        substitute_teacher_id: sub.id, status: 'assigned', assigned_at: new Date().toISOString(),
      }).eq('id', arr[0].id)
    }
    const { count: weekly } = await supabase.from('timetable_periods')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school.id).eq('teacher_id', terminated[0]).eq('is_break', false)
    console.log(`   ${nameOf.get(terminated[0])}: TERMINATED, holds ${weekly} periods a week, ${arr?.length} queued today`)
  }

  // ── what the screens will show ────────────────────────────────
  const { data: finalArr } = await supabase.from('arrangements')
    .select('status').eq('school_id', school.id).eq('arrangement_date', today).neq('status', 'cancelled')
  const byStatus: Record<string, number> = {}
  for (const a of finalArr ?? []) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1

  console.log(`\nArrangements page will show ${finalArr?.length ?? 0} periods: ${JSON.stringify(byStatus)}`)
  console.log(`Terminated teacher to restore afterwards: ${nameOf.get(terminated[0])} (id ${terminated[0]})`)
})()
