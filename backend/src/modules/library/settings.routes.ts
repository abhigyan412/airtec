import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { getEditableWorkflowStatus, saveEditableWorkflowSteps } from '../../shared/middleware/workflowSettings'
import {
  ensureFineWaiverWorkflowDefinition,
  ensureLostBookChargeWaiverWorkflowDefinition,
  ensureAcquisitionRequestWorkflowDefinition,
  ensureBookWithdrawalWorkflowDefinition,
} from '../rbac/seed'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// WORKFLOWS — Fine Waiver, Lost-Book Charge Waiver, Acquisition
// Request, Book Withdrawal. Same GET/PUT-a-step-list pattern every
// other module's settings page uses, all on the shared workflow engine.
// ═══════════════════════════════════════════════════════════════
const LibraryWorkflowStepSchema = z.object({ role_id: z.string(), action_name: z.string().min(1) })
const SaveLibraryWorkflowSchema = z.object({ steps: z.array(LibraryWorkflowStepSchema).min(1) })

const LIBRARY_WORKFLOWS: Record<string, { name: string; entityType: string; ensureSeedFn: (schoolId: string) => Promise<void> }> = {
  'fine-waiver': { name: 'Library Fine Waiver Approval Workflow', entityType: 'library_fine_waiver', ensureSeedFn: ensureFineWaiverWorkflowDefinition },
  'lost-book-waiver': { name: 'Lost Book Charge Waiver Approval Workflow', entityType: 'library_lost_book_waiver', ensureSeedFn: ensureLostBookChargeWaiverWorkflowDefinition },
  'acquisition': { name: 'Book Acquisition Request Approval Workflow', entityType: 'book_acquisition_request', ensureSeedFn: ensureAcquisitionRequestWorkflowDefinition },
  'withdrawal': { name: 'Book Withdrawal Approval Workflow', entityType: 'book_withdrawal', ensureSeedFn: ensureBookWithdrawalWorkflowDefinition },
}

router.get('/workflow/:key', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const workflow = LIBRARY_WORKFLOWS[req.params.key]
    if (!workflow) return res.status(404).json({ success: false, error: 'Unknown workflow' })
    const status = await getEditableWorkflowStatus(req.user!.school_id, workflow.name, workflow.ensureSeedFn)
    if (!status) return res.status(500).json({ success: false, error: `Could not load the "${workflow.name}"` })
    res.json({ success: true, data: status })
  })
)

router.put('/workflow/:key', requirePermissionV2('library.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const workflow = LIBRARY_WORKFLOWS[req.params.key]
    if (!workflow) return res.status(404).json({ success: false, error: 'Unknown workflow' })
    const { steps } = SaveLibraryWorkflowSchema.parse(req.body)
    const result = await saveEditableWorkflowSteps(
      req.user!.school_id,
      { workflowName: workflow.name, module: 'library', entityType: workflow.entityType, ensureSeedFn: workflow.ensureSeedFn },
      steps,
    )
    if (!result.success) return res.status(400).json({ success: false, error: result.error })
    res.json({ success: true, data: { definition_id: result.definition_id, steps: result.steps } })
  })
)

// ═══════════════════════════════════════════════════════════════
// GENERAL SETTINGS — default loan days, fine/day, max books, grace
// days, and the Library Period timetable-subject-name match. One row
// per school, created lazily on first GET.
// ═══════════════════════════════════════════════════════════════
router.get('/general', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: existing } = await supabase.from('library_settings').select('*').eq('school_id', school_id).maybeSingle()
    if (existing) return res.json({ success: true, data: existing })

    const { data: created, error } = await supabase.from('library_settings').insert({ school_id }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: created })
  })
)

const SaveGeneralSettingsSchema = z.object({
  default_loan_days: z.number().int().positive(),
  default_fine_per_day: z.number().nonnegative(),
  default_max_books: z.number().int().positive(),
  grace_days: z.number().int().nonnegative(),
  timetable_subject_name: z.string().trim().min(1).max(100),
})

router.put('/general', requirePermissionV2('library.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const parsed = SaveGeneralSettingsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data, error } = await supabase
      .from('library_settings')
      .upsert({ school_id, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: 'school_id' })
      .select('*')
      .single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// BORROWING POLICIES — per-role or per-category override of the
// defaults above. Exactly one of applies_to_role_id / applies_to_category
// is expected per row (enforced here, not as a DB CHECK).
// ═══════════════════════════════════════════════════════════════
router.get('/borrowing-policies', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('library_borrowing_policies')
      .select('*, roles(name)')
      .eq('school_id', req.user!.school_id)
      .order('created_at')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const CATEGORIES = ['fiction', 'non_fiction', 'reference', 'textbook', 'periodical', 'av_media', 'other'] as const

const BorrowingPolicySchema = z.object({
  applies_to_role_id: z.string().uuid().nullable().optional(),
  applies_to_category: z.enum(CATEGORIES).nullable().optional(),
  max_books: z.number().int().positive().nullable().optional(),
  loan_days: z.number().int().positive().nullable().optional(),
  renewal_limit: z.number().int().nonnegative().nullable().optional(),
  fine_per_day: z.number().nonnegative().nullable().optional(),
}).refine(
  d => (!!d.applies_to_role_id) !== (!!d.applies_to_category),
  { message: 'Choose either a role or a book category, not both or neither.' },
)

router.post('/borrowing-policies', requirePermissionV2('library.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = BorrowingPolicySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data, error } = await supabase
      .from('library_borrowing_policies')
      .insert({ school_id: req.user!.school_id, ...parsed.data })
      .select('*, roles(name)')
      .single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'A policy for this role or category already exists — edit it instead.' })
      return res.status(500).json({ success: false, error: error.message })
    }
    res.json({ success: true, data })
  })
)

router.patch('/borrowing-policies/:id', requirePermissionV2('library.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = BorrowingPolicySchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data, error } = await supabase
      .from('library_borrowing_policies')
      .update(parsed.data)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*, roles(name)')
      .maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Policy not found' })
    res.json({ success: true, data })
  })
)

router.delete('/borrowing-policies/:id', requirePermissionV2('library.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase
      .from('library_borrowing_policies')
      .delete()
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

export default router
