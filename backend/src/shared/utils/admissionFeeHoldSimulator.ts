import { supabase } from '../db/client'
import { FEE_HOLD_AUTO_REJECT_REASON } from './admissionSeatLedger'

/**
 * Fee-hold policy simulator — "if admission_fee_hold_days had been X (and
 * grace Y) all along, which resolved applications would have ended up
 * differently?" A read-only backtest, not a live re-run: admission_seat_ledger
 * is a single current-state row per class with no snapshot history, so this
 * can't ask "what did the ledger look like on date X." Instead it
 * reconstructs each application's own timeline from its own columns and
 * re-applies releaseExpiredSeatHolds' rules against a hypothetical deadline.
 *
 * T0 (the moment the fee hold actually started) is NOT any column on
 * admission_applications itself — updated_at is overwritten by every later
 * mutation (collect-fee, expire-fee-holds, extend-fee-hold all touch the same
 * row), and fee_hold_deadline is cleared to null once an application
 * resolves. The one immutable record of that moment is the admission
 * approval workflow's own completion: workflow_instances.completed_at,
 * stamped once when completeAdmissionWorkflow's caller finishes the last
 * approval step, and never touched again.
 *
 * Deliberately zero LLM/AI involvement — this is pure business logic derived
 * from the same rules already encoded in releaseExpiredSeatHolds, computed
 * fresh for a hypothetical instead of the real setting. A natural-language
 * front end over this is a later, separate phase, added only once this
 * engine has been used and trusted.
 */

export interface FeeHoldSimulationParams {
  schoolId: string
  hypotheticalHoldDays: number
  /** Defaults to the school's current admission_fee_hold_grace_days. */
  hypotheticalGraceDays?: number
  classId?: string
  /** Filters on T0 (the reservation instant), not on any application status column. */
  fromDate?: string
  toDate?: string
}

export type FeeHoldRealOutcome = 'admitted' | 'auto_rejected' | 'still_pending'
export type FeeHoldEffect = 'saved' | 'newly_rejected' | 'unaffected'

export interface FeeHoldSimulationApplicationResult {
  application_id: string
  application_number: string | null
  class_id: string
  student_name: string
  real_outcome: FeeHoldRealOutcome
  hypothetical_outcome: FeeHoldRealOutcome
  effect: FeeHoldEffect
  reservation_started_at: string
  actual_deadline: string | null
  hypothetical_deadline: string
  hypothetical_cutoff: string
  fee_paid_at: string | null
  /** Surfaced, not applied — see the header comment on manual extensions below. */
  had_manual_extension: boolean
  revenue_impact: number | null
  revenue_impact_is_estimate: boolean
}

export interface FeeHoldSimulationResult {
  params: {
    hypothetical_hold_days: number
    hypothetical_grace_days: number
    class_id?: string
    from_date?: string
    to_date?: string
  }
  summary: {
    total_considered: number
    saved_count: number
    newly_rejected_count: number
    unaffected_count: number
    still_pending_count: number
    skipped_count: number
    applications_missing_fee_amount: number
    revenue_delta_known: number
    revenue_delta_estimated: number
    revenue_delta_total: number
  }
  applications: FeeHoldSimulationApplicationResult[]
  skipped: { application_id: string; reason: string }[]
}

const CANDIDATE_COLUMNS =
  'id, application_number, applying_for_class_id, student_first_name, student_last_name, ' +
  'status, auto_rejected_reason, fee_hold_deadline, fee_paid_at, application_fee_amount, fee_hold_extended_at'

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export async function simulateFeeHoldPolicy(params: FeeHoldSimulationParams): Promise<FeeHoldSimulationResult> {
  const { schoolId, hypotheticalHoldDays, classId, fromDate, toDate } = params

  const { data: schoolRow } = await supabase
    .from('schools').select('admission_fee_hold_grace_days').eq('id', schoolId).maybeSingle()
  const currentGraceDays = (schoolRow as any)?.admission_fee_hold_grace_days ?? 0
  const hypotheticalGraceDays = params.hypotheticalGraceDays ?? currentGraceDays

  // Two plain queries instead of one .or()/.and() filter string — same
  // result, easier to read and to keep in sync with releaseExpiredSeatHolds'
  // own conditions.
  let resolvedQuery = supabase.from('admission_applications').select(CANDIDATE_COLUMNS)
    .eq('school_id', schoolId).in('status', ['fee_pending', 'admitted'])
  let autoRejectedQuery = supabase.from('admission_applications').select(CANDIDATE_COLUMNS)
    .eq('school_id', schoolId).eq('status', 'rejected').eq('auto_rejected_reason', FEE_HOLD_AUTO_REJECT_REASON)
  if (classId) {
    resolvedQuery = resolvedQuery.eq('applying_for_class_id', classId)
    autoRejectedQuery = autoRejectedQuery.eq('applying_for_class_id', classId)
  }

  const [{ data: resolved, error: resolvedError }, { data: autoRejected, error: autoRejectedError }] =
    await Promise.all([resolvedQuery, autoRejectedQuery])
  if (resolvedError) throw new Error(resolvedError.message)
  if (autoRejectedError) throw new Error(autoRejectedError.message)
  const candidates = [...(resolved ?? []), ...(autoRejected ?? [])] as any[]

  const skipped: { application_id: string; reason: string }[] = []
  const withClass = candidates.filter(app => {
    if (!app.applying_for_class_id) {
      skipped.push({ application_id: app.id, reason: 'no class specified on application' })
      return false
    }
    return true
  })

  const ids = withClass.map(app => app.id)
  const { data: instances } = ids.length
    ? await supabase.from('workflow_instances').select('entity_id, completed_at')
        .eq('school_id', schoolId).eq('entity_type', 'admission_application')
        .eq('status', 'approved').in('entity_id', ids)
    : { data: [] as { entity_id: string; completed_at: string }[] }

  const t0ByApplication = new Map<string, string>()
  for (const instance of instances ?? []) {
    const existing = t0ByApplication.get(instance.entity_id)
    if (!existing || new Date(instance.completed_at) > new Date(existing)) {
      t0ByApplication.set(instance.entity_id, instance.completed_at)
    }
  }

  const classIds = [...new Set(withClass.map(app => app.applying_for_class_id))]
  const { data: classSettings } = classIds.length
    ? await supabase.from('admission_class_settings' as any).select('class_id, admission_fee_amount')
        .eq('school_id', schoolId).in('class_id', classIds)
    : { data: [] as any[] }
  const feeAmountByClass = new Map((classSettings ?? []).map((c: any) => [c.class_id, c.admission_fee_amount]))

  const now = new Date()
  const applications: FeeHoldSimulationApplicationResult[] = []
  let savedCount = 0, newlyRejectedCount = 0, unaffectedCount = 0, stillPendingCount = 0
  let applicationsMissingFeeAmount = 0
  let revenueKnown = 0, revenueEstimated = 0
  let totalConsidered = 0

  for (const app of withClass) {
    const t0Iso = t0ByApplication.get(app.id)
    if (!t0Iso) {
      skipped.push({ application_id: app.id, reason: 'no completed approval workflow instance found (pre-workflow-system application)' })
      continue
    }
    const t0 = new Date(t0Iso)
    if (fromDate && t0 < new Date(fromDate)) continue
    if (toDate && t0 > new Date(toDate)) continue

    totalConsidered++

    const hypotheticalDeadline = addDays(t0, hypotheticalHoldDays)
    const hypotheticalCutoff = addDays(hypotheticalDeadline, hypotheticalGraceDays)

    let realOutcome: FeeHoldRealOutcome
    if (app.status === 'admitted') {
      realOutcome = 'admitted'
    } else if (app.status === 'rejected') {
      realOutcome = 'auto_rejected'
    } else if (app.fee_hold_deadline && now > addDays(new Date(app.fee_hold_deadline), currentGraceDays)) {
      // Past its own real deadline+grace but not yet swept by the hourly
      // cron — functionally dead, not genuinely still open.
      realOutcome = 'auto_rejected'
    } else {
      realOutcome = 'still_pending'
    }

    let hypotheticalOutcome: FeeHoldRealOutcome = realOutcome
    let effect: FeeHoldEffect = 'unaffected'
    let revenueImpact: number | null = null
    let isEstimate = false
    const feeAmount = feeAmountByClass.get(app.applying_for_class_id)

    if (realOutcome === 'admitted') {
      // Only reachable when hypotheticalHoldDays is shorter than what
      // actually applied — the family paid, but after the hypothetical
      // window would have closed.
      const feePaidAt = app.fee_paid_at ? new Date(app.fee_paid_at) : null
      if (feePaidAt && feePaidAt > hypotheticalCutoff) {
        effect = 'newly_rejected'
        hypotheticalOutcome = 'auto_rejected'
        if (app.application_fee_amount != null) {
          revenueImpact = -app.application_fee_amount
          isEstimate = false // the actual amount that was really collected — known, not assumed
        }
      }
    } else if (realOutcome === 'auto_rejected') {
      if (hypotheticalCutoff > now) {
        effect = 'saved'
        hypotheticalOutcome = 'still_pending'
        if (feeAmount != null) {
          revenueImpact = feeAmount
          isEstimate = true // whether the family would actually have paid is unknowable — an assumption, not a fact
        } else {
          applicationsMissingFeeAmount++
        }
      }
    } else {
      // still_pending: only reachable when a shorter hypothetical window
      // would already have lapsed by now.
      if (hypotheticalCutoff <= now) {
        effect = 'newly_rejected'
        hypotheticalOutcome = 'auto_rejected'
        if (feeAmount != null) {
          revenueImpact = -feeAmount
          isEstimate = true // the fee was never actually paid either way — speculative lost opportunity
        } else {
          applicationsMissingFeeAmount++
        }
      }
    }

    if (effect === 'saved') savedCount++
    else if (effect === 'newly_rejected') newlyRejectedCount++
    else if (realOutcome === 'still_pending') stillPendingCount++
    else unaffectedCount++

    if (revenueImpact != null) {
      if (isEstimate) revenueEstimated += revenueImpact
      else revenueKnown += revenueImpact
    }

    if (effect !== 'unaffected') {
      applications.push({
        application_id: app.id,
        application_number: app.application_number,
        class_id: app.applying_for_class_id,
        student_name: `${app.student_first_name} ${app.student_last_name}`.trim(),
        real_outcome: realOutcome,
        hypothetical_outcome: hypotheticalOutcome,
        effect,
        reservation_started_at: t0Iso,
        actual_deadline: app.fee_hold_deadline,
        hypothetical_deadline: hypotheticalDeadline.toISOString(),
        hypothetical_cutoff: hypotheticalCutoff.toISOString(),
        fee_paid_at: app.fee_paid_at,
        // Manual extend-fee-hold overrides are deliberately ignored above
        // when computing the hypothetical timeline (always T0 + hypothetical
        // days, never the real extended deadline) — an admin's extension
        // was a reaction to the real deadline, and how they'd have acted
        // under a different global default is unknowable. Surfaced here so
        // a reviewer can discount/sanity-check these rows.
        had_manual_extension: !!app.fee_hold_extended_at,
        revenue_impact: revenueImpact,
        revenue_impact_is_estimate: isEstimate,
      })
    }
  }

  return {
    params: {
      hypothetical_hold_days: hypotheticalHoldDays,
      hypothetical_grace_days: hypotheticalGraceDays,
      class_id: classId,
      from_date: fromDate,
      to_date: toDate,
    },
    summary: {
      total_considered: totalConsidered,
      saved_count: savedCount,
      newly_rejected_count: newlyRejectedCount,
      unaffected_count: unaffectedCount,
      still_pending_count: stillPendingCount,
      skipped_count: skipped.length,
      applications_missing_fee_amount: applicationsMissingFeeAmount,
      revenue_delta_known: revenueKnown,
      revenue_delta_estimated: revenueEstimated,
      revenue_delta_total: revenueKnown + revenueEstimated,
    },
    applications,
    skipped,
  }
}
