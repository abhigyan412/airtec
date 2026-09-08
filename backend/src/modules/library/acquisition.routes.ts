import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { ensureAcquisitionRequestWorkflowDefinition } from '../rbac/seed'
import { createNotifications } from '../../shared/utils/notifications'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// BOOK DONATIONS — the second-hand book-bank intake queue, a common
// Indian-school affordability practice (a student donates last year's
// textbook, the school redistributes it to a needy student next year).
// Acquisition requests and periodicals land here in a later phase.
// ═══════════════════════════════════════════════════════════════
router.get('/donations', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('book_donations').select('*, students(first_name, last_name), book_titles(title)')
      .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
    if (req.query.status === 'pending') q = q.is('accepted', null)
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const DonationSchema = z.object({
  donated_by_student_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300),
  condition: z.enum(['new', 'good', 'worn', 'damaged']).optional(),
})

router.post('/donations', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DonationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('book_donations')
      .insert({ school_id: req.user!.school_id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// Accepting a donation turns it into a real book_copies row (source =
// 'book_bank'). If title_id isn't given, a new minimal title is
// created from the donation's free-text title — donations are almost
// always a re-donation of a textbook students already recognize by
// name, not a new catalogue entry a librarian needs to flesh out first.
const AcceptDonationSchema = z.object({ title_id: z.string().uuid().optional() })

router.patch('/donations/:id/accept', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = AcceptDonationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: donation } = await supabase.from('book_donations').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!donation) return res.status(404).json({ success: false, error: 'Donation not found' })
    if (donation.accepted !== null) return res.status(400).json({ success: false, error: 'This donation was already reviewed.' })

    let title_id = parsed.data.title_id
    if (!title_id) {
      const { data: newTitle, error: titleErr } = await supabase.from('book_titles')
        .insert({ school_id, title: donation.title, category: 'textbook', is_circulating: true })
        .select('id').single()
      if (titleErr) return res.status(500).json({ success: false, error: titleErr.message })
      title_id = newTitle.id
    }

    const { data: accessionNo, error: accErr } = await supabase.rpc('library_next_accession_no', { p_school_id: school_id })
    if (accErr) return res.status(500).json({ success: false, error: accErr.message })
    const accession_no = accessionNo as string

    const { data: copy, error: copyErr } = await supabase.from('book_copies')
      .insert({ title_id, school_id, accession_no, barcode: accession_no, condition: donation.condition ?? 'good', source: 'book_bank' })
      .select('*').single()
    if (copyErr) return res.status(500).json({ success: false, error: copyErr.message })

    const { data, error } = await supabase.from('book_donations')
      .update({ accepted: true, accepted_copy_id: copy.id })
      .eq('id', donation.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: { ...data, copy } })
  })
)

router.patch('/donations/:id/reject', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('book_donations')
      .update({ accepted: false })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id).is('accepted', null)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Donation not found or already reviewed' })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// ACQUISITION REQUESTS — a purchase decision is a budget call, same
// Librarian-review-then-Principal-approval tier as Transport's Vehicle
// Onboarding. The workflow definition was seeded in Phase 0; this is
// what actually starts and drives it.
// ═══════════════════════════════════════════════════════════════
router.get('/requests', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('book_acquisition_requests').select('*, users!requested_by(full_name)')
      .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
    if (req.query.status) q = q.eq('status', req.query.status as string)
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const RequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(1000).optional(),
  estimated_cost: z.number().nonnegative().optional(),
})

router.post('/requests', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = RequestSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: request, error } = await supabase.from('book_acquisition_requests')
      .insert({ school_id, requested_by: req.user!.id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    await ensureAcquisitionRequestWorkflowDefinition(school_id)
    const wfResult = await startWorkflow({
      schoolId: school_id, workflowName: 'Book Acquisition Request Approval Workflow',
      entityType: 'book_acquisition_request', entityId: request.id, initiatedBy: req.user!.id,
    })
    res.json({ success: true, data: request, workflow: wfResult.success ? wfResult.instance : null })
  })
)

router.post('/requests/:id/workflow-action', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const parsed = z.object({ status: z.enum(['approved', 'rejected']), notes: z.string().optional() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: request } = await supabase.from('book_acquisition_requests').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!request) return res.status(404).json({ success: false, error: 'Request not found' })

    const { data: instance } = await supabase.from('workflow_instances')
      .select('id, status').eq('entity_type', 'book_acquisition_request').eq('entity_id', request.id).eq('school_id', school_id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (!instance) return res.status(404).json({ success: false, error: 'No workflow instance found for this request.' })
    if (instance.status !== 'in_progress') return res.status(400).json({ success: false, error: `Workflow already ${instance.status}` })

    const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status: parsed.data.status, notes: parsed.data.notes })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })

    if (result.completed) {
      const newStatus = result.instance.status === 'approved' ? 'approved' : 'rejected'
      await supabase.from('book_acquisition_requests').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', request.id)
      await createNotifications([request.requested_by], {
        schoolId: school_id, type: 'library_acquisition_update',
        title: newStatus === 'approved' ? 'Book request approved' : 'Book request rejected',
        message: `Your request for "${request.title}" was ${newStatus}.`,
        link: '/library/acquisition', relatedEntityType: 'book_acquisition_request', relatedEntityId: request.id,
      })
    }
    res.json({ success: true, data: result })
  })
)

router.get('/requests/:id/workflow-status', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = await getWorkflowStatus('book_acquisition_request', req.params.id, req.user!.school_id)
    res.json({ success: true, data: status })
  })
)

// Once approved, mark it ordered, then received. Receiving creates a
// real book_copies row — the same "a decision becomes real stock"
// pattern donation-acceptance already uses.
router.patch('/requests/:id/order', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('book_acquisition_requests')
      .update({ status: 'ordered', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id).eq('status', 'approved')
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(400).json({ success: false, error: 'Request must be approved first' })
    res.json({ success: true, data })
  })
)

const ReceiveSchema = z.object({ title_id: z.string().uuid().optional(), cost: z.number().nonnegative().optional() })

router.patch('/requests/:id/receive', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ReceiveSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: request } = await supabase.from('book_acquisition_requests').select('*').eq('id', req.params.id).eq('school_id', school_id).eq('status', 'ordered').maybeSingle()
    if (!request) return res.status(400).json({ success: false, error: 'Request must be marked ordered first' })

    let title_id = parsed.data.title_id
    if (!title_id) {
      const { data: newTitle, error: titleErr } = await supabase.from('book_titles')
        .insert({ school_id, title: request.title, authors: request.author ? [request.author] : null, category: 'other', is_circulating: true })
        .select('id').single()
      if (titleErr) return res.status(500).json({ success: false, error: titleErr.message })
      title_id = newTitle.id
    }

    const { data: accessionNo, error: accErr } = await supabase.rpc('library_next_accession_no', { p_school_id: school_id })
    if (accErr) return res.status(500).json({ success: false, error: accErr.message })

    const { data: copy, error: copyErr } = await supabase.from('book_copies')
      .insert({ title_id, school_id, accession_no: accessionNo, barcode: accessionNo, condition: 'new', source: 'purchased', cost: parsed.data.cost ?? request.estimated_cost ?? null })
      .select('*').single()
    if (copyErr) return res.status(500).json({ success: false, error: copyErr.message })

    const { data, error } = await supabase.from('book_acquisition_requests')
      .update({ status: 'received', received_copy_id: copy.id, updated_at: new Date().toISOString() }).eq('id', request.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: { ...data, copy } })
  })
)

// ═══════════════════════════════════════════════════════════════
// PERIODICALS — newspapers/magazines and the issues expected under
// each subscription, so "this week's issue never arrived" shows up
// instead of relying on memory.
// ═══════════════════════════════════════════════════════════════
router.get('/periodicals', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('periodicals').select('*').eq('school_id', req.user!.school_id).order('title')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const PeriodicalSchema = z.object({
  title: z.string().trim().min(1).max(300),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annual']),
  vendor: z.string().trim().max(200).optional(),
  subscription_valid_until: z.string().optional(),
})

router.post('/periodicals', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = PeriodicalSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('periodicals').insert({ school_id: req.user!.school_id, ...parsed.data }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.get('/periodicals/:id/issues', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('periodical_issues')
      .select('*').eq('periodical_id', req.params.id).eq('school_id', req.user!.school_id).order('issue_date', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/periodicals/:id/issues', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = z.object({ issue_date: z.string() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('periodical_issues')
      .insert({ periodical_id: req.params.id, school_id: req.user!.school_id, issue_date: parsed.data.issue_date })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/periodicals/issues/:issueId', requirePermissionV2('library.manage_acquisition'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = z.object({ status: z.enum(['received', 'missing']) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('periodical_issues')
      .update({ status: parsed.data.status, received_at: parsed.data.status === 'received' ? new Date().toISOString() : null })
      .eq('id', req.params.issueId).eq('school_id', req.user!.school_id).select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Issue not found' })
    res.json({ success: true, data })
  })
)

export default router
