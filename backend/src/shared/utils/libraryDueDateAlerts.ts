import { supabase } from '../db/client'
import { toLocalDateStr } from './academicCalendar'
import { createNotifications, getRecipientUserIdsForStudent } from './notifications'
import { resolvePolicy } from '../../modules/library/lib/policy'

// ── Library due-date sweep: due-soon reminders, overdue detection and
// the accruing overdue fine ── ─────────────────────────────────────
//
// Same unattended-sweep + manual-trigger shape as hrAlerts.ts and
// transportComplianceAlerts.ts. A loan's overdue fine is recalculated
// (not re-created) every run — it's ONE pending row per loan whose
// amount grows with days overdue, not a new charge stacking up daily,
// matching the partial unique index that allows only one pending
// overdue fine per loan.
export async function runLibraryDueDateAlerts(schoolId?: string) {
  const today = toLocalDateStr(new Date())
  const dueSoonWindow = toLocalDateStr(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))

  let schoolsQuery = supabase.from('schools').select('id')
  if (schoolId) schoolsQuery = schoolsQuery.eq('id', schoolId)
  const { data: schools } = await schoolsQuery

  let dueSoonNotified = 0
  let overdueMarked = 0
  let finesUpdated = 0

  for (const school of (schools ?? []) as { id: string }[]) {
    const { data: settings } = await supabase.from('library_settings').select('grace_days').eq('school_id', school.id).maybeSingle()
    const graceDays = settings?.grace_days ?? 0

    // Due soon (not yet overdue) — a light reminder, no fine involved.
    const { data: dueSoonLoans } = await supabase.from('book_loans')
      .select('id, member_id, due_date, book_copies!inner(school_id, book_titles(title)), library_members(student_id, user_id)')
      .eq('book_copies.school_id', school.id).eq('status', 'active').gte('due_date', today).lte('due_date', dueSoonWindow)
    for (const loan of (dueSoonLoans ?? []) as any[]) {
      const recipients = loan.library_members?.student_id ? await getRecipientUserIdsForStudent(loan.library_members.student_id) : []
      if (!recipients.length) continue
      await createNotifications(recipients, {
        schoolId: school.id, type: 'library_due_soon',
        title: 'Library book due soon',
        message: `"${loan.book_copies?.book_titles?.title}" is due on ${loan.due_date}.`,
        link: '/library/circulation', relatedEntityType: 'book_loan', relatedEntityId: loan.id,
      })
      dueSoonNotified++
    }

    // Overdue: flip status, recompute the accruing fine, notify.
    const { data: overdueLoans } = await supabase.from('book_loans')
      .select('*, book_copies!inner(school_id, book_titles(category)), library_members(student_id, user_id)')
      .eq('book_copies.school_id', school.id).in('status', ['active', 'overdue']).lt('due_date', today)

    for (const loan of (overdueLoans ?? []) as any[]) {
      if (loan.status !== 'overdue') {
        await supabase.from('book_loans').update({ status: 'overdue' }).eq('id', loan.id)
        overdueMarked++
      }

      const daysLate = Math.floor((Date.now() - new Date(`${loan.due_date}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000))
      const fineableDays = Math.max(0, daysLate - graceDays)

      if (fineableDays > 0) {
        const policy = await resolvePolicy(school.id, loan.library_members, loan.book_copies.book_titles?.category ?? 'other')
        const amount = fineableDays * policy.fine_per_day
        if (amount > 0) {
          const { data: existingFine } = await supabase.from('library_fines')
            .select('id, amount').eq('loan_id', loan.id).eq('fine_type', 'overdue').eq('status', 'pending').maybeSingle()
          if (existingFine) {
            if (Number(existingFine.amount) !== amount) {
              await supabase.from('library_fines').update({ amount, updated_at: new Date().toISOString() }).eq('id', existingFine.id)
              finesUpdated++
            }
          } else {
            await supabase.from('library_fines').insert({
              school_id: school.id, loan_id: loan.id, member_id: loan.member_id,
              fine_type: 'overdue', amount, calc_basis: 'per_day',
            })
            finesUpdated++
            const recipients = loan.library_members?.student_id ? await getRecipientUserIdsForStudent(loan.library_members.student_id) : []
            if (recipients.length) {
              await createNotifications(recipients, {
                schoolId: school.id, type: 'library_overdue',
                title: 'Library book overdue',
                message: `A book was due on ${loan.due_date} and is now ${daysLate} day(s) late.`,
                link: '/library/circulation', relatedEntityType: 'book_loan', relatedEntityId: loan.id,
              })
            }
          }
        }
      }
    }
  }

  return { dueSoonNotified, overdueMarked, finesUpdated }
}
