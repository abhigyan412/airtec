import { supabase } from '../db/client'
import { fetchPaidByInvoice } from './feePayments'
import { toLocalDateStr } from './academicCalendar'
import { createNotifications, getRecipientUserIdsForStudent } from './notifications'

// ── Fee due/overdue reminders ────────────────────────────────────
//
// Runs across ALL schools (not one — this is a background job, not a
// per-request handler, so there's no req.user.school_id to scope by).
// "Due soon" = due within the next 3 days. "Overdue" = due_date has
// already passed. Both read the REAL remaining balance (total_amount
// minus payments already made), same as GET /fees/dues — an invoice
// that's been partially paid down to zero shouldn't still nag someone.
//
// Notification creation is deduped per user/type/invoice/day (see the
// notifications table's unique index), so running this more than once
// on the same day — a manual trigger right after the scheduled run,
// for example — never double-notifies.
const DUE_SOON_WINDOW_DAYS = 3

// schoolId: omit for the unattended daily cron (all schools); pass it
// for the admin-triggered manual endpoint, which — like every other
// route in this app — stays scoped to the caller's own school.
export async function runFeeReminders(schoolId?: string) {
  const today = toLocalDateStr(new Date())
  const dueSoonCutoff = toLocalDateStr(new Date(Date.now() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000))

  let query = supabase
    .from('fee_invoices')
    .select('id, school_id, student_id, invoice_number, total_amount, due_date')
    .in('status', ['unpaid', 'partial'])
    .not('due_date', 'is', null)
    .lte('due_date', dueSoonCutoff)
  if (schoolId) query = query.eq('school_id', schoolId)

  const { data: invoices, error } = await query

  if (error) throw new Error(error.message)
  if (!invoices?.length) return { checked: 0, notified: 0 }

  const invoiceIds = invoices.map(i => i.id)
  // Chunked + error-checked. The old inline version silently produced an empty
  // map once the due-soon window held more than ~300 invoices, which would have
  // made every reminder quote the FULL original bill instead of the balance.
  const paidByInvoice = await fetchPaidByInvoice(invoiceIds)

  let notified = 0
  for (const inv of invoices) {
    const remaining = Number(inv.total_amount) - (paidByInvoice.get(inv.id) ?? 0)
    if (remaining <= 0) continue // fully paid despite still being marked unpaid/partial — nothing to remind about

    const isOverdue = inv.due_date! < today
    const recipients = await getRecipientUserIdsForStudent(inv.student_id)
    if (!recipients.length) continue

    await createNotifications(recipients, {
      schoolId: inv.school_id,
      type: isOverdue ? 'fee_overdue' : 'fee_due_soon',
      title: isOverdue ? 'Fee payment overdue' : 'Fee payment due soon',
      message: isOverdue
        ? `Invoice ${inv.invoice_number} (₹${remaining.toLocaleString('en-IN')}) was due on ${inv.due_date} and is still unpaid.`
        : `Invoice ${inv.invoice_number} (₹${remaining.toLocaleString('en-IN')}) is due on ${inv.due_date}.`,
      link: '/fees',
      relatedEntityType: 'fee_invoice', relatedEntityId: inv.id,
    })
    notified++
  }

  return { checked: invoices.length, notified }
}
