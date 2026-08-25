import { supabase } from '../db/client'

/**
 * Seats left for new admission in a class — Phase 1 of admission/plan.md: a
 * stored ledger row (admission_seat_ledger) instead of a live join across
 * sections/students/admission_applications on every call. The migration
 * that created this table backfilled one row per class from exactly what
 * the old live calculation would have returned, so existing schools don't
 * see their numbers reset.
 *
 * capacity === 0 (no ledger row, or a genuinely unconfigured class) reads
 * as "not set up for admission" rather than "zero seats" — treated as
 * unlimited so an unconfigured class doesn't silently block everyone, same
 * behavior as before.
 *
 * A class with no ledger row yet (created after the backfill migration
 * ran) gets one lazily here, seeded from current sections.max_strength —
 * mirrors how admission_cycles treats "no row" as a default rather than
 * an error.
 */
export async function getClassSeatAvailability(schoolId: string, classId: string) {
  const { data: ledger } = await supabase
    .from('admission_seat_ledger' as any)
    .select('capacity, frozen, reserved, confirmed, is_locked, lock_reason')
    .eq('school_id', schoolId).eq('class_id', classId).maybeSingle()

  if (ledger) {
    const { capacity, frozen, reserved, confirmed, is_locked, lock_reason } = ledger as any
    return { capacity, frozen, reserved, confirmed, is_locked, lock_reason, available: capacity - frozen - reserved - confirmed }
  }

  const { data: sections } = await supabase.from('sections').select('max_strength').eq('school_id', schoolId).eq('class_id', classId)
  const capacity = (sections ?? []).reduce((sum, s) => sum + (s.max_strength ?? 0), 0)
  await supabase.from('admission_seat_ledger' as any).insert({ school_id: schoolId, class_id: classId, capacity })
  return { capacity, frozen: 0, reserved: 0, confirmed: 0, is_locked: false, lock_reason: null, available: capacity }
}

/**
 * Mutates the ledger for one class by exactly one seat, read-then-write —
 * matching the decided concurrency rule (last-write-wins, no locking):
 * see admission/decisions.md, Phase 1. 'reserve' on a new application,
 * 'confirm' on final admit (reserved -> confirmed), 'release' on reject or
 * fee-hold expiry (reserved freed, nothing confirmed).
 *
 * userId is null for system-triggered releases (the fee-hold sweep has no
 * acting user) — admission_seat_ledger.updated_by allows null for exactly
 * this reason.
 */
export async function applyLedgerTransition(
  schoolId: string, classId: string | null | undefined,
  action: 'reserve' | 'confirm' | 'release', userId: string | null,
) {
  if (!classId) return
  const { data: existing } = await supabase
    .from('admission_seat_ledger' as any)
    .select('id, capacity, reserved, confirmed')
    .eq('school_id', schoolId).eq('class_id', classId).maybeSingle()

  const row = (existing as any) ?? { capacity: 0, reserved: 0, confirmed: 0 }
  let { reserved, confirmed } = row

  if (action === 'reserve') reserved += 1
  if (action === 'release') reserved = Math.max(0, reserved - 1)
  if (action === 'confirm') { reserved = Math.max(0, reserved - 1); confirmed += 1 }

  if (existing) {
    await supabase.from('admission_seat_ledger' as any)
      .update({ reserved, confirmed, updated_by: userId })
      .eq('id', (existing as any).id)
  } else {
    await supabase.from('admission_seat_ledger' as any)
      .insert({ school_id: schoolId, class_id: classId, capacity: row.capacity, reserved, confirmed, updated_by: userId })
  }

  // Phase 4: every release (reject, or Phase 3's fee-hold expiry) is a
  // seat becoming available again — try the waitlist before it just sits
  // open. Best-effort: a failure here must not break the release itself,
  // which is why this isn't awaited into the caller's error handling.
  if (action === 'release') {
    await tryPromoteWaitlist(schoolId, classId).catch(err =>
      console.error('[admission-waitlist] promotion after release failed:', err?.message))
  }
}

/**
 * Phase 4: offers the freed seat to the next-ranked waitlisted inquiry for
 * this class, if one exists and doesn't already have an offer pending.
 * No real send channel exists yet (Phase 8 still blocked) — this starts a
 * visible response clock (waitlist_offer_made_at/deadline) rather than
 * actually messaging anyone; staff follow up by hand using the same
 * follow-up logging every other inquiry uses. Not auto-confirm: nothing
 * here admits the candidate, it only starts their window to respond.
 *
 * Tie-break, decisions.md Phase 4: waitlist_rank ascending (nulls last —
 * every existing row is null until the rank UI is actually used), then
 * enquiry date ascending (earlier wins), matching the adopted default.
 */
export async function tryPromoteWaitlist(schoolId: string, classId: string) {
  const { data: candidate } = await supabase
    .from('admission_inquiries')
    .select('id, waitlist_rank, created_at')
    .eq('school_id', schoolId)
    .eq('applying_for_class_id', classId)
    .eq('status', 'waitlisted')
    .is('waitlist_offer_made_at', null)
    .order('waitlist_rank', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!candidate) return null

  const { data: schoolRow } = await supabase.from('schools').select('admission_waitlist_response_days').eq('id', schoolId).maybeSingle()
  const responseDays = (schoolRow as any)?.admission_waitlist_response_days ?? 3
  const deadline = new Date(Date.now() + responseDays * 24 * 60 * 60 * 1000).toISOString()

  await supabase.from('admission_inquiries').update({
    waitlist_offer_made_at: new Date().toISOString(),
    waitlist_offer_deadline: deadline,
  }).eq('id', candidate.id)

  console.log(`[admission-waitlist] offered class ${classId} seat to inquiry ${candidate.id}, responds by ${deadline}`)
  return candidate.id as string
}

// ── Waitlist offer expiry sweep (Phase 4) ───────────────────────────────
//
// A waitlisted candidate who was offered a seat but never responded (the
// inquiry is still 'waitlisted' with a passed deadline — anything else,
// like staff converting them to an application, moves them out of
// 'waitlisted' entirely and takes them out of this sweep's reach). Clears
// their offer and tries the next rank, same cadence as Phase 3's sweep.
//
// schoolId: omit for the unattended cron (all schools); pass it for the
// admin-triggered manual endpoint.
export async function processExpiredWaitlistOffers(schoolId?: string) {
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('admission_inquiries')
    .select('id, school_id, applying_for_class_id')
    .eq('status', 'waitlisted')
    .not('waitlist_offer_made_at', 'is', null)
    .lt('waitlist_offer_deadline', nowIso)

  if (schoolId) query = query.eq('school_id', schoolId)

  const { data: expired, error } = await query
  if (error) {
    console.error('[admission-waitlist] could not read expired offers:', error.message)
    return { expired: 0, rePromoted: 0 }
  }
  if (!expired?.length) return { expired: 0, rePromoted: 0 }

  let rePromoted = 0
  for (const inq of expired as any[]) {
    await supabase.from('admission_inquiries').update({
      waitlist_offer_made_at: null,
      waitlist_offer_deadline: null,
    }).eq('id', inq.id)

    if (inq.applying_for_class_id) {
      const promoted = await tryPromoteWaitlist(inq.school_id, inq.applying_for_class_id)
      if (promoted) rePromoted++
    }
  }

  console.log(`[admission-waitlist] ${expired.length} offer(s) expired unanswered, ${rePromoted} re-offered to the next rank`)
  return { expired: expired.length, rePromoted }
}

/**
 * Phase 2: class-level lock, independent of the cycle-wide open/close
 * window in checkAdmissionCycleOpen (admission/routes.ts) — a school can
 * be mid-cycle but still lock one specific class without closing
 * admission entirely. No ledger row = never locked, same
 * "absence is permissive" convention as checkAdmissionCycleOpen.
 */
export async function checkClassLockOpen(schoolId: string, classId: unknown): Promise<string | null> {
  if (!classId || typeof classId !== 'string') return null
  const { data: ledger } = await supabase
    .from('admission_seat_ledger' as any)
    .select('is_locked, lock_reason')
    .eq('school_id', schoolId).eq('class_id', classId).maybeSingle()
  if (!ledger || !(ledger as any).is_locked) return null
  const reason = (ledger as any).lock_reason
  return `Admission for this class is currently locked.${reason ? ` (${reason})` : ''}`
}

// ── Fee seat-hold expiry sweep (Phase 3) ────────────────────────────────
//
// A reserved seat carries a deadline (admission_applications.fee_hold_deadline,
// set on application creation from the school's admission_fee_hold_days
// setting). If the fee still isn't paid once that deadline plus the
// school's grace period has passed, the seat is released back to the pool
// and the application auto-rejected — matching how a real, un-actioned
// reservation is a lost seat, not a limbo state.
//
// schoolId: omit for the unattended cron (all schools); pass it for the
// admin-triggered manual endpoint, same convention as runFeeReminders.
export async function releaseExpiredSeatHolds(schoolId?: string) {
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('admission_applications')
    .select('id, school_id, applying_for_class_id, inquiry_id, fee_hold_deadline')
    .not('fee_hold_deadline', 'is', null)
    .eq('application_fee_paid', false)
    .not('status', 'in', '(admitted,rejected)')
    .lt('fee_hold_deadline', nowIso)

  if (schoolId) query = query.eq('school_id', schoolId)

  const { data: candidates, error } = await query
  if (error) {
    console.error('[admission-fee-hold] could not read expired holds:', error.message)
    return { released: 0 }
  }
  if (!candidates?.length) return { released: 0 }

  const schoolIds = [...new Set(candidates.map((c: any) => c.school_id))]
  const { data: schools } = await supabase.from('schools').select('id, admission_fee_hold_grace_days').in('id', schoolIds)
  const graceDays = new Map((schools ?? []).map((s: any) => [s.id, s.admission_fee_hold_grace_days ?? 0]))

  let released = 0
  for (const app of candidates as any[]) {
    const grace = graceDays.get(app.school_id) ?? 0
    const graceUntil = new Date(app.fee_hold_deadline)
    graceUntil.setDate(graceUntil.getDate() + grace)
    if (new Date() < graceUntil) continue // deadline passed but still within grace

    await supabase.from('admission_applications').update({
      status: 'rejected',
      auto_rejected_reason: 'Application fee not paid within the hold period',
      fee_hold_deadline: null,
    }).eq('id', app.id)

    await applyLedgerTransition(app.school_id, app.applying_for_class_id, 'release', null)

    if (app.inquiry_id) {
      await supabase.from('admission_inquiries').update({ status: 'rejected' }).eq('id', app.inquiry_id)
    }
    released++
  }

  if (released) console.log(`[admission-fee-hold] auto-released ${released} expired seat hold(s)`)
  return { released }
}
