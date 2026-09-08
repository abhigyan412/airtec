import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'

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

export default router
