import { supabase } from '../db/client'
import { toLocalDateStr } from './academicCalendar'
import { createNotifications } from './notifications'
import { getUserIdsWithPermission } from '../middleware/permissions-v2'

// ── HR alerts: probation ending, document/contract expiring, work
// anniversary ─────────────────────────────────────────────────────
//
// Same shape as feeReminders.ts/leavePolicy.ts: an unattended
// cross-school sweep (no per-request school_id) plus a per-school
// manual trigger for hosts where a long-lived in-process cron isn't
// guaranteed to fire. Recipient resolution and dedup both lean on
// existing mechanisms — getUserIdsWithPermission for "who's HR here,"
// and notifications' own per-user/type/entity/day unique index for
// "don't re-notify if this runs twice."
const ALERT_WINDOW_DAYS = 30

export async function runHrAlerts(schoolId?: string) {
  const today = toLocalDateStr(new Date())
  const windowEnd = toLocalDateStr(new Date(Date.now() + ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000))
  const todayMonthDay = today.slice(5)
  const todayYear = today.slice(0, 4)

  // Cache "who holds staff.edit" per school — the probation and
  // document sweeps below both need it, and a multi-school run
  // shouldn't re-resolve it once per row.
  const hrRecipientsBySchool = new Map<string, string[]>()
  const getHrRecipients = async (targetSchoolId: string) => {
    if (!hrRecipientsBySchool.has(targetSchoolId)) {
      hrRecipientsBySchool.set(targetSchoolId, await getUserIdsWithPermission(targetSchoolId, 'staff.edit'))
    }
    return hrRecipientsBySchool.get(targetSchoolId)!
  }

  // Resigned/terminated staff shouldn't keep generating HR alerts —
  // probation review, document expiry, and work-anniversary notices are
  // all about ongoing employment, not people who've already left.
  const NOT_DEPARTED = ['resigned', 'terminated']

  let probationNotified = 0
  {
    let q = supabase.from('staff_profiles')
      .select('school_id, user_id, probation_end_date, users:user_id(full_name)')
      .not('probation_end_date', 'is', null).lte('probation_end_date', windowEnd)
      .not('employment_status', 'in', `(${NOT_DEPARTED.join(',')})`)
    if (schoolId) q = q.eq('school_id', schoolId)
    const { data: rows } = await q

    for (const row of (rows ?? []) as any[]) {
      const recipients = await getHrRecipients(row.school_id)
      if (!recipients.length) continue
      const overdue = row.probation_end_date < today
      await createNotifications(recipients, {
        schoolId: row.school_id, type: 'probation_ending',
        title: overdue ? 'Probation period overdue for review' : 'Probation ending soon',
        message: `${row.users?.full_name ?? 'A staff member'}'s probation ${overdue ? 'ended' : 'ends'} on ${row.probation_end_date} — confirm or extend.`,
        link: '/hr/staff', relatedEntityType: 'staff_profile', relatedEntityId: row.user_id,
      })
      probationNotified++
    }
  }

  let documentsNotified = 0
  {
    // staff_documents.user_id and staff_profiles.user_id are siblings
    // (both FK to users, not each other — same shape as the bank-export
    // embed bug) so employment_status can't be embedded directly here;
    // fetch the departed set separately and filter in JS instead.
    let deptQuery = supabase.from('staff_profiles').select('user_id').in('employment_status', NOT_DEPARTED)
    if (schoolId) deptQuery = deptQuery.eq('school_id', schoolId)
    const { data: departedRows } = await deptQuery
    const departedUserIds = new Set((departedRows ?? []).map((p: any) => p.user_id))

    let q = supabase.from('staff_documents')
      .select('id, school_id, user_id, document_type, document_name, expiry_date, users:user_id(full_name)')
      .not('expiry_date', 'is', null).lte('expiry_date', windowEnd)
    if (schoolId) q = q.eq('school_id', schoolId)
    const { data: rowsRaw } = await q
    const rows = (rowsRaw ?? []).filter((r: any) => !departedUserIds.has(r.user_id))

    for (const row of (rows ?? []) as any[]) {
      const recipients = await getHrRecipients(row.school_id)
      if (!recipients.length) continue
      const isContract = row.document_type === 'contract'
      const overdue = row.expiry_date < today
      await createNotifications(recipients, {
        schoolId: row.school_id, type: isContract ? 'contract_review_due' : 'document_expiring',
        title: isContract ? 'Contract review due' : 'Staff document expiring',
        message: `${row.users?.full_name ?? 'A staff member'}'s ${row.document_name} ${overdue ? 'expired' : 'expires'} on ${row.expiry_date}.`,
        link: `/hr/staff/${row.user_id}`, relatedEntityType: 'staff_document', relatedEntityId: row.id,
      })
      documentsNotified++
    }
  }

  let anniversariesNotified = 0
  {
    let q = supabase.from('staff_profiles').select('school_id, user_id, date_of_joining').not('date_of_joining', 'is', null)
      .not('employment_status', 'in', `(${NOT_DEPARTED.join(',')})`)
    if (schoolId) q = q.eq('school_id', schoolId)
    const { data: rows } = await q

    const matches = (rows ?? []).filter((p: any) => p.date_of_joining.slice(5) === todayMonthDay && p.date_of_joining.slice(0, 4) < todayYear)
    for (const row of matches as any[]) {
      const years = Number(todayYear) - Number(row.date_of_joining.slice(0, 4))
      await createNotifications([row.user_id], {
        schoolId: row.school_id, type: 'work_anniversary',
        title: 'Happy work anniversary!',
        message: `You've completed ${years} year${years === 1 ? '' : 's'} with the school today.`,
        relatedEntityType: 'staff_profile', relatedEntityId: row.user_id,
      })
      anniversariesNotified++
    }
  }

  return { probationNotified, documentsNotified, anniversariesNotified }
}
