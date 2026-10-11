import { supabase } from '../db/client'

/**
 * Qualitative companion to the stage-aging simulator (admissionAlertSimulator.ts):
 * returns real counselor follow-up notes for currently-stuck inquiries, so
 * the policy copilot can explain WHY they're stuck instead of only counting
 * them. inquiry_follow_ups has no school_id column — it's only reachable via
 * inquiry_id -> admission_inquiries.id, so this always scopes by first
 * selecting matching inquiries for the school, then fetching follow-ups for
 * just those IDs. Never query inquiry_follow_ups bare.
 *
 * notes/outcome are optional free-text fields staff fill in at their own
 * discretion — the existing follow-up UI already expects them to often be
 * empty. Capped to a sample (not "all of them") since raw notes are
 * unpredictable-length free text, unlike every other tool's fixed numeric
 * output; total_matching always reports the true count so nothing implies
 * completeness that isn't there.
 */

const ACTIVE_STATUSES = ['new', 'follow_up', 'interested', 'documents_submitted', 'entrance_exam', 'approved', 'waitlisted', 'fee_pending']
const MAX_INQUIRIES_RETURNED = 15
const MAX_FOLLOW_UPS_PER_INQUIRY = 3

export interface StuckInquiryDetailsParams {
  schoolId: string
  hypotheticalAgingDays?: number
}

export interface StuckInquiryFollowUp {
  follow_up_date: string
  channel: string | null
  outcome: string | null
  notes: string | null
}

export interface StuckInquiryDetail {
  inquiry_id: string
  student_name: string
  status: string
  status_changed_at: string
  follow_ups: StuckInquiryFollowUp[]
}

export interface StuckInquiryDetailsResult {
  hypothetical_aging_days: number
  total_matching: number
  inquiries: StuckInquiryDetail[]
}

export async function getStuckInquiryDetails(params: StuckInquiryDetailsParams): Promise<StuckInquiryDetailsResult> {
  const { schoolId } = params

  const { data: school } = await supabase
    .from('schools').select('admission_stage_aging_days').eq('id', schoolId).maybeSingle()
  const hypotheticalAgingDays = params.hypotheticalAgingDays ?? (school as any)?.admission_stage_aging_days ?? 10

  const cutoff = new Date(Date.now() - hypotheticalAgingDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: stale, error } = await supabase
    .from('admission_inquiries')
    .select('id, student_name, status, status_changed_at')
    .eq('school_id', schoolId)
    .in('status', ACTIVE_STATUSES)
    .lt('status_changed_at', cutoff)
    .order('status_changed_at', { ascending: true })
  if (error) throw new Error(error.message)

  const totalMatching = stale?.length ?? 0
  const sample = ((stale ?? []) as any[]).slice(0, MAX_INQUIRIES_RETURNED)
  const ids = sample.map(s => s.id)

  const { data: followUps } = ids.length
    ? await supabase
        .from('inquiry_follow_ups')
        .select('inquiry_id, follow_up_date, channel, outcome, notes')
        .in('inquiry_id', ids)
        .order('follow_up_date', { ascending: false })
    : { data: [] as any[] }

  const followUpsByInquiry = new Map<string, StuckInquiryFollowUp[]>()
  for (const fu of (followUps ?? []) as any[]) {
    const list = followUpsByInquiry.get(fu.inquiry_id) ?? []
    if (list.length < MAX_FOLLOW_UPS_PER_INQUIRY) {
      list.push({ follow_up_date: fu.follow_up_date, channel: fu.channel, outcome: fu.outcome, notes: fu.notes })
    }
    followUpsByInquiry.set(fu.inquiry_id, list)
  }

  return {
    hypothetical_aging_days: hypotheticalAgingDays,
    total_matching: totalMatching,
    inquiries: sample.map(s => ({
      inquiry_id: s.id,
      student_name: s.student_name,
      status: s.status,
      status_changed_at: s.status_changed_at,
      follow_ups: followUpsByInquiry.get(s.id) ?? [],
    })),
  }
}
