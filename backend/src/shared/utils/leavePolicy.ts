import { supabase } from '../db/client'

// ── Leave accrual + year-end carry-forward/encashment ────────────
//
// Same shape as feeReminders.ts: an unattended cross-school sweep (no
// per-request school_id) plus a per-school manual trigger for hosts
// where a long-lived in-process cron isn't guaranteed to fire.

// Runs monthly (1st of the month). For every 'monthly'-accrual leave
// type, credits default_days_per_year/12 to every active staff member's
// balance for the current year. Deduped via leave_accrual_log's unique
// (user_id, leave_type_id, year, month) index — safe to re-trigger
// manually within the same month without double-crediting.
export async function runLeaveAccrual(schoolId?: string) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  let typeQuery = supabase.from('leave_types').select('id, school_id, default_days_per_year').eq('accrual_frequency', 'monthly')
  if (schoolId) typeQuery = typeQuery.eq('school_id', schoolId)
  const { data: monthlyTypes } = await typeQuery
  if (!monthlyTypes?.length) return { checked: 0, credited: 0 }

  let credited = 0
  for (const lt of monthlyTypes) {
    const { data: staff } = await supabase
      .from('staff_profiles').select('user_id').eq('school_id', lt.school_id).eq('employment_status', 'active')
    if (!staff?.length) continue

    const monthlyAmount = Math.round((Number(lt.default_days_per_year) / 12) * 100) / 100

    for (const s of staff) {
      const { data: log, error: logErr } = await supabase
        .from('leave_accrual_log')
        .insert({ school_id: lt.school_id, user_id: s.user_id, leave_type_id: lt.id, year, month, credited_days: monthlyAmount })
        .select('id')
        .maybeSingle()
      if (logErr || !log) continue // already credited this month (unique index) — skip silently

      const { data: balance } = await supabase
        .from('leave_balances').select('id, total_days').eq('user_id', s.user_id).eq('leave_type_id', lt.id).eq('year', year).maybeSingle()

      if (balance) {
        await supabase.from('leave_balances').update({ total_days: Number(balance.total_days) + monthlyAmount }).eq('id', balance.id)
      } else {
        await supabase.from('leave_balances').insert({
          school_id: lt.school_id, user_id: s.user_id, leave_type_id: lt.id, year, total_days: monthlyAmount, used_days: 0,
        })
      }
      credited++
    }
  }

  return { checked: monthlyTypes.length, credited }
}

// Runs once a year, early January, for the year that just ended
// (forYear). For every leave type with carry_forward or is_encashable
// set: unused = total_days - used_days; the carry-forward portion (capped
// at max_carry_forward_days) is credited into forYear+1's balance;
// whatever's left over is added to pending_leave_encashment_days if the
// type is encashable (picked up and paid out at next payslip generation,
// using that month's gross — see POST /payslips/generate).
//
// Idempotency: skips a user/type pair entirely if forYear+1's balance
// row already exists — this job only runs once a year, so "the next
// year's row already exists" is a reliable signal it already ran.
export async function runLeaveYearEnd(schoolId?: string, forYear?: number) {
  const year = forYear ?? new Date().getFullYear()
  const nextYear = year + 1

  let typeQuery = supabase.from('leave_types').select('id, school_id, default_days_per_year, carry_forward, max_carry_forward_days, is_encashable')
    .or('carry_forward.eq.true,is_encashable.eq.true')
  if (schoolId) typeQuery = typeQuery.eq('school_id', schoolId)
  const { data: types } = await typeQuery
  if (!types?.length) return { checked: 0, processed: 0 }

  let processed = 0
  for (const lt of types) {
    const { data: balances } = await supabase
      .from('leave_balances').select('user_id, total_days, used_days').eq('leave_type_id', lt.id).eq('year', year)
    if (!balances?.length) continue

    for (const bal of balances) {
      const { data: nextRow } = await supabase
        .from('leave_balances').select('id').eq('user_id', bal.user_id).eq('leave_type_id', lt.id).eq('year', nextYear).maybeSingle()
      if (nextRow) continue // already processed for this user/type

      const unused = Math.max(0, Number(bal.total_days) - Number(bal.used_days))
      const carried = lt.carry_forward ? Math.min(unused, Number(lt.max_carry_forward_days ?? 0)) : 0

      // Insert the next year's row unconditionally (carried may be 0)
      // so it doubles as the idempotency marker above for encashment-
      // only types too, not just carry-forward ones.
      await supabase.from('leave_balances').insert({
        school_id: lt.school_id, user_id: bal.user_id, leave_type_id: lt.id, year: nextYear,
        total_days: Number(lt.default_days_per_year) + carried, used_days: 0,
      })

      const encashable = unused - carried
      if (lt.is_encashable && encashable > 0) {
        const { data: profile } = await supabase
          .from('staff_profiles').select('id, pending_leave_encashment_days').eq('user_id', bal.user_id).eq('school_id', lt.school_id).maybeSingle()
        if (profile) {
          await supabase.from('staff_profiles')
            .update({ pending_leave_encashment_days: Number(profile.pending_leave_encashment_days ?? 0) + encashable })
            .eq('id', profile.id)
        }
      }

      processed++
    }
  }

  return { checked: types.length, processed }
}
