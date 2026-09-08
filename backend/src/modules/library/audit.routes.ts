import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// STOCK VERIFICATION — a periodic physical count against the
// register, the accountability exercise every real library runs (and
// every school-audit checklist expects). One audit "session" snapshots
// every non-withdrawn copy's current status, then each is scanned in
// (or left unscanned, meaning missing) as the physical count proceeds.
// ═══════════════════════════════════════════════════════════════
router.get('/', requirePermissionV2('library.stock_audit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('library_stock_audits')
      .select('*, users!started_by(full_name)').eq('school_id', req.user!.school_id).order('started_at', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/', requirePermissionV2('library.stock_audit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: openAudit } = await supabase.from('library_stock_audits').select('id').eq('school_id', school_id).eq('status', 'in_progress').maybeSingle()
    if (openAudit) return res.status(400).json({ success: false, error: 'An audit is already in progress — complete it before starting a new one.' })

    const { data: audit, error } = await supabase.from('library_stock_audits')
      .insert({ school_id, started_by: req.user!.id }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    const { data: copies, error: copiesErr } = await supabase.from('book_copies').select('id, status').eq('school_id', school_id).neq('status', 'withdrawn')
    if (copiesErr) return res.status(500).json({ success: false, error: copiesErr.message })

    if (copies?.length) {
      const items = copies.map(c => ({ audit_id: audit.id, copy_id: c.id, expected_status: c.status }))
      const { error: itemsErr } = await supabase.from('library_stock_audit_items').insert(items)
      if (itemsErr) return res.status(500).json({ success: false, error: itemsErr.message })
    }
    res.json({ success: true, data: { ...audit, item_count: copies?.length ?? 0 } })
  })
)

router.get('/:id', requirePermissionV2('library.stock_audit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: audit } = await supabase.from('library_stock_audits').select('*').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found' })
    const { data: items, error } = await supabase.from('library_stock_audit_items')
      .select('*, book_copies(accession_no, barcode, book_titles(title))').eq('audit_id', audit.id).order('scanned_at', { ascending: false, nullsFirst: true })
    if (error) return res.status(500).json({ success: false, error: error.message })
    const summary = {
      total: items?.length ?? 0,
      found: items?.filter(i => i.found === true).length ?? 0,
      missing: items?.filter(i => i.found === false).length ?? 0,
      pending: items?.filter(i => i.found === null).length ?? 0,
    }
    res.json({ success: true, data: { ...audit, items, summary } })
  })
)

const ScanSchema = z.object({ barcode: z.string().trim().min(1) })

router.post('/:id/scan', requirePermissionV2('library.stock_audit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ScanSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: audit } = await supabase.from('library_stock_audits').select('id, status').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found' })
    if (audit.status !== 'in_progress') return res.status(400).json({ success: false, error: 'This audit is already completed.' })

    const { data: copy } = await supabase.from('book_copies').select('id, status')
      .eq('school_id', school_id).or(`barcode.eq.${parsed.data.barcode},accession_no.eq.${parsed.data.barcode}`).maybeSingle()
    if (!copy) return res.status(404).json({ success: false, error: 'No book copy matches that barcode/accession number.' })

    const { data: item } = await supabase.from('library_stock_audit_items').select('*').eq('audit_id', audit.id).eq('copy_id', copy.id).maybeSingle()
    if (!item) return res.status(400).json({ success: false, error: 'This copy was not part of the audit snapshot (added after the audit started?).' })

    const discrepancy = item.expected_status !== copy.status ? `Register said "${item.expected_status}", now "${copy.status}"` : null
    const { data, error } = await supabase.from('library_stock_audit_items')
      .update({ found: true, scanned_at: new Date().toISOString(), discrepancy_note: discrepancy })
      .eq('id', item.id).select('*, book_copies(accession_no, book_titles(title))').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const CompleteSchema = z.object({ mark_unscanned_as_lost: z.boolean().default(false) })

router.post('/:id/complete', requirePermissionV2('library.stock_audit'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = CompleteSchema.safeParse(req.body)
    const school_id = req.user!.school_id
    const { data: audit } = await supabase.from('library_stock_audits').select('id, status').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found' })
    if (audit.status !== 'in_progress') return res.status(400).json({ success: false, error: 'This audit is already completed.' })

    const { data: unscanned } = await supabase.from('library_stock_audit_items').select('id, copy_id').eq('audit_id', audit.id).is('found', null)
    if (unscanned?.length) {
      await supabase.from('library_stock_audit_items').update({ found: false }).in('id', unscanned.map(i => i.id))
      if (parsed.data!.mark_unscanned_as_lost) {
        await supabase.from('book_copies').update({ status: 'lost' }).in('id', unscanned.map(i => i.copy_id))
      }
    }

    const { data, error } = await supabase.from('library_stock_audits')
      .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', audit.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: { ...data, missing_count: unscanned?.length ?? 0 } })
  })
)

export default router
