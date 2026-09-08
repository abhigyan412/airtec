import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { dayOfWeekFor } from '../timetable/lib/core'
import { toLocalDateStr } from '../../shared/utils/academicCalendar'
import { resolvePolicy } from './lib/policy'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// MEMBERS — a thin wrapper so circulation never cares whether the
// borrower is a student (usually no login of their own — most Indian
// school students don't have individual portal access, only their
// parents do) or a staff user.
// ═══════════════════════════════════════════════════════════════
const EnsureMemberSchema = z.object({
  student_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
}).refine(d => !!d.student_id !== !!d.user_id, { message: 'Provide exactly one of student_id or user_id' })

router.post('/members/ensure', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = EnsureMemberSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id
    const member_type = parsed.data.student_id ? 'student' : 'staff'

    const existingQuery = parsed.data.student_id
      ? supabase.from('library_members').select('*').eq('school_id', school_id).eq('student_id', parsed.data.student_id)
      : supabase.from('library_members').select('*').eq('school_id', school_id).eq('user_id', parsed.data.user_id)
    const { data: existing } = await existingQuery.maybeSingle()
    if (existing) return res.json({ success: true, data: existing })

    const { data, error } = await supabase.from('library_members')
      .insert({ school_id, member_type, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.get('/members/:memberId', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: member } = await supabase.from('library_members').select('*, students(first_name, last_name, admission_number)')
      .eq('id', req.params.memberId).eq('school_id', req.user!.school_id).maybeSingle()
    if (!member) return res.status(404).json({ success: false, error: 'Member not found' })

    const { data: loans } = await supabase.from('book_loans')
      .select('*, book_copies(accession_no, book_titles(title, category))')
      .eq('member_id', member.id).in('status', ['active', 'overdue']).order('due_date')

    res.json({ success: true, data: { ...member, active_loans: loans ?? [] } })
  })
)

// ═══════════════════════════════════════════════════════════════
// TODAY'S LIBRARY PERIODS — CBSE mandates a weekly Library Period in
// the timetable; circulation is meant to happen then, not between
// classes. Matches library_settings.timetable_subject_name against
// timetable_periods.subject_name (schools label the slot differently).
// ═══════════════════════════════════════════════════════════════
router.get('/today', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: settings } = await supabase.from('library_settings').select('timetable_subject_name').eq('school_id', school_id).maybeSingle()
    const subjectName = settings?.timetable_subject_name ?? 'Library'
    const dow = dayOfWeekFor(toLocalDateStr(new Date()))

    const { data, error } = await supabase
      .from('timetable_periods')
      .select('id, class_id, section_id, period_number, start_time, end_time, classes(name), sections(name)')
      .eq('school_id', school_id).eq('day_of_week', dow).ilike('subject_name', subjectName)
      .order('start_time')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// SCAN — the rush-hour continuous flow: scan a member (once), then
// scan book barcodes one after another. The server decides issue vs.
// return from the copy's own current state, so the frontend queue
// never needs a mode toggle (documented real complaint about Indian
// library software: slow/error-prone during the one weekly period a
// whole class hits the desk).
// ═══════════════════════════════════════════════════════════════
async function fulfillNextReservation(copyId: string, titleId: string) {
  // A returned copy goes to the front of the reservation queue instead
  // of straight back to 'available', if anyone is waiting.
  const { data: nextRes } = await supabase.from('book_reservations')
    .select('*').eq('title_id', titleId).eq('status', 'waiting').order('queue_position').limit(1).maybeSingle()
  if (!nextRes) {
    await supabase.from('book_copies').update({ status: 'available' }).eq('id', copyId)
    return null
  }
  await supabase.from('book_copies').update({ status: 'reserved' }).eq('id', copyId)
  const { data: updated } = await supabase.from('book_reservations')
    .update({ status: 'ready', expires_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() })
    .eq('id', nextRes.id).select('*, library_members(user_id, student_id)').single()
  return updated
}

const ScanSchema = z.object({ member_id: z.string().uuid(), barcode: z.string().trim().min(1) })

router.post('/scan', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ScanSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: member } = await supabase.from('library_members').select('*').eq('id', parsed.data.member_id).eq('school_id', school_id).maybeSingle()
    if (!member) return res.status(404).json({ success: false, error: 'Member not found' })

    const { data: copy } = await supabase.from('book_copies')
      .select('*, book_titles(id, title, category, is_circulating)')
      .or(`barcode.eq.${parsed.data.barcode},accession_no.eq.${parsed.data.barcode}`)
      .eq('school_id', school_id).maybeSingle()
    if (!copy) return res.status(404).json({ success: false, error: `No book found for "${parsed.data.barcode}"` })

    // RETURN path: this copy is on an active loan to THIS member.
    const { data: activeLoan } = await supabase.from('book_loans')
      .select('*').eq('copy_id', copy.id).in('status', ['active', 'overdue']).maybeSingle()

    if (activeLoan) {
      if (activeLoan.member_id !== member.id) {
        return res.status(400).json({ success: false, error: 'This copy is issued to someone else — scan it at their return, not here.' })
      }
      const { data: returnedLoan, error: retErr } = await supabase.from('book_loans')
        .update({ status: 'returned', returned_at: new Date().toISOString() })
        .eq('id', activeLoan.id).select('*').single()
      if (retErr) return res.status(500).json({ success: false, error: retErr.message })
      const readyReservation = await fulfillNextReservation(copy.id, copy.title_id)
      return res.json({ success: true, data: { action: 'returned', loan: returnedLoan, copy: copy.book_titles, reservation_notified: !!readyReservation } })
    }

    // ISSUE path.
    if (!copy.book_titles.is_circulating) {
      return res.status(400).json({ success: false, error: `"${copy.book_titles.title}" is room-only and can't be issued.` })
    }
    if (copy.status !== 'available') {
      return res.status(400).json({ success: false, error: `This copy is currently ${copy.status}, not available to issue.` })
    }

    const policy = await resolvePolicy(school_id, member, copy.book_titles.category)
    const { count: activeCount } = await supabase.from('book_loans').select('id', { count: 'exact', head: true })
      .eq('member_id', member.id).in('status', ['active', 'overdue'])
    if ((activeCount ?? 0) >= policy.max_books) {
      return res.status(400).json({ success: false, error: `This member already has ${activeCount} book(s) out — the limit is ${policy.max_books}.` })
    }

    const dueDate = new Date(Date.now() + policy.loan_days * 24 * 60 * 60 * 1000)
    const { data: loan, error: loanErr } = await supabase.from('book_loans')
      .insert({ copy_id: copy.id, member_id: member.id, due_date: toLocalDateStr(dueDate), issued_by: req.user!.id })
      .select('*').single()
    if (loanErr) {
      if (loanErr.code === '23505') return res.status(409).json({ success: false, error: 'This copy was just issued to someone else — try another copy.' })
      return res.status(500).json({ success: false, error: loanErr.message })
    }
    await supabase.from('book_copies').update({ status: 'issued' }).eq('id', copy.id)
    res.json({ success: true, data: { action: 'issued', loan, copy: copy.book_titles, due_date: loan.due_date } })
  })
)

// ═══════════════════════════════════════════════════════════════
// LOANS — direct list/renew/return, for browsing rather than scanning.
// ═══════════════════════════════════════════════════════════════
router.get('/loans', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('book_loans')
      .select('*, book_copies!inner(accession_no, school_id, book_titles(title)), library_members(member_type, student_id, user_id, students(first_name, last_name))')
      .eq('book_copies.school_id', req.user!.school_id)
      .order('due_date')
    if (req.query.status) q = q.eq('status', req.query.status as string)
    else q = q.in('status', ['active', 'overdue'])
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/loans/:id/return', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: loan } = await supabase.from('book_loans')
      .select('*, book_copies!inner(id, title_id, school_id)').eq('id', req.params.id)
      .eq('book_copies.school_id', req.user!.school_id).in('status', ['active', 'overdue']).maybeSingle()
    if (!loan) return res.status(404).json({ success: false, error: 'Active loan not found' })

    const { data: returnedLoan, error } = await supabase.from('book_loans')
      .update({ status: 'returned', returned_at: new Date().toISOString() })
      .eq('id', loan.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    await fulfillNextReservation((loan as any).book_copies.id, (loan as any).book_copies.title_id)
    res.json({ success: true, data: returnedLoan })
  })
)

router.post('/loans/:id/renew', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: loan } = await supabase.from('book_loans')
      .select('*, book_copies!inner(id, title_id, category, school_id)').eq('id', req.params.id)
      .eq('book_copies.school_id', school_id).in('status', ['active', 'overdue']).maybeSingle()
    if (!loan) return res.status(404).json({ success: false, error: 'Active loan not found' })

    const { count: waitingCount } = await supabase.from('book_reservations').select('id', { count: 'exact', head: true })
      .eq('title_id', (loan as any).book_copies.title_id).in('status', ['waiting', 'ready'])
    if (waitingCount) {
      return res.status(400).json({ success: false, error: 'This title has a reservation queue — it can\'t be renewed, only returned.' })
    }

    const { data: member } = await supabase.from('library_members').select('*').eq('id', loan.member_id).maybeSingle()
    const policy = await resolvePolicy(school_id, member!, (loan as any).book_copies.category)
    if (loan.renewed_count >= policy.renewal_limit) {
      return res.status(400).json({ success: false, error: `Renewal limit (${policy.renewal_limit}) already reached for this loan.` })
    }

    const newDue = new Date(Date.now() + policy.loan_days * 24 * 60 * 60 * 1000)
    const { data, error } = await supabase.from('book_loans')
      .update({ due_date: toLocalDateStr(newDue), renewed_count: loan.renewed_count + 1, status: 'active' })
      .eq('id', loan.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════════════════════════════
router.get('/reservations', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('book_reservations')
      .select('*, book_titles!inner(title, school_id), library_members(member_type, students(first_name, last_name))')
      .eq('book_titles.school_id', req.user!.school_id)
      .in('status', ['waiting', 'ready'])
      .order('queue_position')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const ReserveSchema = z.object({ title_id: z.string().uuid(), member_id: z.string().uuid() })

router.post('/reservations', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ReserveSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { count: available } = await supabase.from('book_copies').select('id', { count: 'exact', head: true })
      .eq('title_id', parsed.data.title_id).eq('status', 'available')
    if (available) {
      return res.status(400).json({ success: false, error: 'A copy is available right now — issue it instead of reserving.' })
    }

    const { count: queueLength } = await supabase.from('book_reservations').select('id', { count: 'exact', head: true })
      .eq('title_id', parsed.data.title_id).in('status', ['waiting', 'ready'])

    const { data, error } = await supabase.from('book_reservations')
      .insert({ ...parsed.data, queue_position: (queueLength ?? 0) + 1 })
      .select('*').single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'This member already has a reservation on this title.' })
      return res.status(500).json({ success: false, error: error.message })
    }
    res.json({ success: true, data })
  })
)

router.delete('/reservations/:id', requirePermissionV2('library.circulation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('book_reservations')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id).in('status', ['waiting', 'ready'])
      .select('*, book_titles!inner(school_id)').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data || (data as any).book_titles.school_id !== req.user!.school_id) return res.status(404).json({ success: false, error: 'Reservation not found' })
    res.json({ success: true })
  })
)

export default router
