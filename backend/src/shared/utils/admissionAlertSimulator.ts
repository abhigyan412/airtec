import { supabase } from '../db/client'

/**
 * Dashboard-alert threshold simulators — stage-aging and occupancy warning.
 * Unlike admissionFeeHoldSimulator.ts, these need no historical
 * reconstruction: both alerts (GET /admission-alerts, admission/routes.ts)
 * are pure current-state computations — status_changed_at is always
 * accurate as-of-now (a trigger bumps it only on real status changes), and
 * the seat ledger/cycle-close date are read live. So a "hypothetical
 * threshold" simulation is just the same query with a different number
 * substituted in, run fresh against today's data.
 */

const ACTIVE_STATUSES = ['new', 'follow_up', 'interested', 'documents_submitted', 'entrance_exam', 'approved', 'waitlisted', 'fee_pending']

export interface StageAgingSimulationParams {
  schoolId: string
  hypotheticalAgingDays: number
}

export interface StageAgingSimulationResult {
  hypothetical_aging_days: number
  actual_aging_days: number
  total_flagged: number
  by_status: { status: string; count: number }[]
}

export async function simulateStageAgingAlert(params: StageAgingSimulationParams): Promise<StageAgingSimulationResult> {
  const { schoolId, hypotheticalAgingDays } = params

  const { data: school } = await supabase
    .from('schools')
    .select('admission_stage_aging_days')
    .eq('id', schoolId).maybeSingle()
  const actualAgingDays = (school as any)?.admission_stage_aging_days ?? 10

  const cutoff = new Date(Date.now() - hypotheticalAgingDays * 24 * 60 * 60 * 1000).toISOString()

  // No .limit(50) here unlike the live dashboard widget — a simulator
  // reports an exact count, not an approximate capped list.
  const { data: staleInquiries, error } = await supabase
    .from('admission_inquiries')
    .select('id, status')
    .eq('school_id', schoolId)
    .in('status', ACTIVE_STATUSES)
    .lt('status_changed_at', cutoff)
  if (error) throw new Error(error.message)

  const byStatus = new Map<string, number>()
  for (const inq of (staleInquiries ?? []) as any[]) {
    byStatus.set(inq.status, (byStatus.get(inq.status) ?? 0) + 1)
  }

  return {
    hypothetical_aging_days: hypotheticalAgingDays,
    actual_aging_days: actualAgingDays,
    total_flagged: staleInquiries?.length ?? 0,
    by_status: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
  }
}

export interface OccupancyAlertSimulationParams {
  schoolId: string
  hypotheticalPercent: number
  hypotheticalDays?: number
}

export interface OccupancyAlertSimulationResult {
  hypothetical_percent: number
  hypothetical_days: number
  cycle_closes_at: string | null
  within_window: boolean
  classes_flagged: { class_id: string; class_name: string; occupancy_percent: number; capacity: number; confirmed: number }[]
}

export async function simulateOccupancyAlert(params: OccupancyAlertSimulationParams): Promise<OccupancyAlertSimulationResult> {
  const { schoolId, hypotheticalPercent } = params

  const { data: school } = await supabase
    .from('schools')
    .select('admission_occupancy_warning_days')
    .eq('id', schoolId).maybeSingle()
  const hypotheticalDays = params.hypotheticalDays ?? (school as any)?.admission_occupancy_warning_days ?? 60

  const now = new Date()
  const cutoff = new Date(now.getTime() + hypotheticalDays * 24 * 60 * 60 * 1000)

  const { data: soonestCycle } = await supabase
    .from('admission_cycles' as any)
    .select('closes_at')
    .eq('school_id', schoolId)
    .not('closes_at', 'is', null)
    .gte('closes_at', now.toISOString())
    .order('closes_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const cycleClosesAt = (soonestCycle as any)?.closes_at ?? null
  const withinWindow = !!cycleClosesAt && new Date(cycleClosesAt) <= cutoff

  let classesFlagged: OccupancyAlertSimulationResult['classes_flagged'] = []
  if (withinWindow) {
    const [{ data: classes }, { data: ledgers }] = await Promise.all([
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
      supabase.from('admission_seat_ledger' as any).select('class_id, capacity, confirmed').eq('school_id', schoolId),
    ])
    const ledgerByClass = new Map((ledgers ?? []).map((l: any) => [l.class_id, l]))
    classesFlagged = (classes ?? [])
      .map((c: any) => {
        const l = ledgerByClass.get(c.id) as any
        if (!l || !l.capacity) return null
        const occupancy_percent = Math.round((l.confirmed / l.capacity) * 100)
        if (occupancy_percent >= hypotheticalPercent) return null
        return { class_id: c.id, class_name: c.name, occupancy_percent, capacity: l.capacity, confirmed: l.confirmed }
      })
      .filter((x: any): x is NonNullable<typeof x> => x !== null)
      .sort((a: any, b: any) => a.occupancy_percent - b.occupancy_percent)
  }

  return {
    hypothetical_percent: hypotheticalPercent,
    hypothetical_days: hypotheticalDays,
    cycle_closes_at: cycleClosesAt,
    within_window: withinWindow,
    classes_flagged: classesFlagged,
  }
}
