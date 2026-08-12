import { selectAll } from '../db/paged'
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

// Categories whose outstanding balance is not the family's debt.
//
// An RTE seat under §12(1)(c) is admitted free and reimbursed by the STATE, at
// the state's own per-child rate and on the state's own (late) timetable. Any
// balance sitting on that invoice is a government receivable. Texting the
// parents about it at 7am is the module's most embarrassing possible output:
// the family owes nothing, has been told so at admission, and cannot act on the
// message even if they wanted to.
//
// This does not decide whether an RTE invoice should exist — that is the
// school's billing policy, and until a concession rule zeroes it the invoice is
// still raised and still counted. It decides only that nobody is chased for it.
const NOT_THE_FAMILYS_DEBT = ['rte']

/**
 * Students whose dues belong to somebody other than their family.
 *
 * Read once per sweep rather than per invoice: a school with four billed
 * quarters has thousands of open invoices and only a few hundred students.
 */
async function studentsNotToChase(schoolId?: string): Promise<Set<string>> {
  try {
    // Paged. A capped read here dropped every RTE student past row 1,000 out of
    // the exclusion set — and this function exists precisely so those families
    // are not telephoned about a debt the state owes.
    const rows = await selectAll<any>('fee_assignments', 'student_id', q => {
      const scoped = q.eq('status', 'active').in('fee_category', NOT_THE_FAMILYS_DEBT)
      return schoolId ? scoped.eq('school_id', schoolId) : scoped
    })
    return new Set(rows.map(a => a.student_id))
  } catch (e: any) {
    // A failure here must not silence the whole sweep — reminding everyone is the
    // status quo and is recoverable; skipping every reminder silently is not.
    console.error('[fee-reminders] could not read fee categories, chasing everyone:', e.message)
    return new Set()
  }
}

// schoolId: omit for the unattended daily cron (all schools); pass it
// for the admin-triggered manual endpoint, which — like every other
// route in this app — stays scoped to the caller's own school.
export async function runFeeReminders(schoolId?: string) {
  const today = toLocalDateStr(new Date())
  const dueSoonCutoff = toLocalDateStr(new Date(Date.now() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000))

  // Paged. On the cron path this scan covers EVERY school, so the 1,000-row cap
  // bit early and hard: every invoice past the first thousand was never
  // reminded about — not late, never — while the log reported `checked: 1000`
  // and looked perfectly healthy.
  const invoices = await selectAll<any>(
    'fee_invoices',
    'id, school_id, student_id, invoice_number, total_amount, due_date',
    q => {
      const scoped = q
        .in('status', ['unpaid', 'partial'])
        .not('due_date', 'is', null)
        .lte('due_date', dueSoonCutoff)
      return schoolId ? scoped.eq('school_id', schoolId) : scoped
    },
  )

  if (!invoices.length) return { checked: 0, notified: 0, skipped_not_owed_by_family: 0 }

  const invoiceIds = invoices.map(i => i.id)
  // Chunked + error-checked. The old inline version silently produced an empty
  // map once the due-soon window held more than ~300 invoices, which would have
  // made every reminder quote the FULL original bill instead of the balance.
  const paidByInvoice = await fetchPaidByInvoice(invoiceIds)
  const doNotChase = await studentsNotToChase(schoolId)

  let notified = 0
  let skippedNotOwed = 0
  for (const inv of invoices) {
    // Counted, not hidden: "checked 400, notified 380, 20 not the family's debt"
    // is the honest line, and a sudden jump in the third number is how a
    // miscategorised student gets noticed.
    if (doNotChase.has(inv.student_id)) { skippedNotOwed++; continue }

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

  return { checked: invoices.length, notified, skipped_not_owed_by_family: skippedNotOwed }
}
