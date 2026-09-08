import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { startWorkflow, actOnWorkflow, getWorkflowStatus } from '../../shared/middleware/workflow-engine'
import { bill } from '../fee/adhoc'
import { ensureLibraryFineFeeHead, applyRteWaiverIfEligible } from './lib/feeBridge'
import { ensureFineWaiverWorkflowDefinition, ensureLostBookChargeWaiverWorkflowDefinition } from '../rbac/seed'
import { runLibraryDueDateAlerts } from '../../shared/utils/libraryDueDateAlerts'

const router = Router()

router.get('/', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('library_fines')
      .select('*, library_members(member_type, student_id, students(first_name, last_name)), book_loans(book_copies(accession_no, book_titles(title)))')
      .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
    if (req.query.status) q = q.eq('status', req.query.status as string)
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// Lost/damage fines — overdue fines are created by the daily sweep
// (libraryDueDateAlerts.ts), not by hand, since they grow day by day.
const CreateFineSchema = z.object({
  loan_id: z.string().uuid(),
  fine_type: z.enum(['lost', 'damage']),
  amount: z.number().nonnegative().optional(),
  calc_basis: z.enum(['flat', 'pct_of_cost']).optional(),
  pct: z.number().positive().max(200).optional(),
})

router.post('/', requirePermissionV2('library.manage_fines'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = CreateFineSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: loan } = await supabase.from('book_loans')
      .select('*, book_copies!inner(id, cost, school_id)').eq('id', parsed.data.loan_id)
      .eq('book_copies.school_id', school_id).in('status', ['active', 'overdue']).maybeSingle()
    if (!loan) return res.status(404).json({ success: false, error: 'Active loan not found' })

    const copy = (loan as any).book_copies
    let amount = parsed.data.amount
    // Lost-book fines are often a multiple of the book's actual price in
    // real library practice, not a flat fee — pct_of_cost drives it off
    // book_copies.cost rather than a single global amount.
    if (amount == null) {
      const pct = parsed.data.pct ?? 100
      amount = copy.cost != null ? Number(copy.cost) * (pct / 100) : 0
    }

    const { data: fine, error } = await supabase.from('library_fines').insert({
      school_id, loan_id: loan.id, member_id: loan.member_id, fine_type: parsed.data.fine_type,
      amount, calc_basis: parsed.data.calc_basis ?? (parsed.data.amount != null ? 'flat' : 'pct_of_cost'),
    }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    if (parsed.data.fine_type === 'lost') {
      await supabase.from('book_copies').update({ status: 'lost' }).eq('id', copy.id)
      await supabase.from('book_loans').update({ status: 'lost' }).eq('id', loan.id)
    } else {
      await supabase.from('book_copies').update({ condition: 'damaged' }).eq('id', copy.id)
    }

    res.json({ success: true, data: fine })
  })
)

// ═══════════════════════════════════════════════════════════════
// BILL — the fee-engine bridge. Raises a real fee_adhoc_charges row
// through fee/adhoc.ts's bill(), the same invoicing/ledger/receipt
// pipeline every other charge in the school goes through, rather than
// a second, disconnected library balance. RTE-quota students get the
// same fee_concession_rules check fees already apply.
// ═══════════════════════════════════════════════════════════════
router.post('/:id/bill', requirePermissionV2('library.manage_fines'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: fine } = await supabase.from('library_fines')
      .select('*, library_members(student_id)').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!fine) return res.status(404).json({ success: false, error: 'Fine not found' })
    if (fine.status !== 'pending') return res.status(400).json({ success: false, error: `This fine is already ${fine.status}.` })

    const studentId = (fine as any).library_members?.student_id
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'Only fines owed by a student can be billed through the fee ledger — log a staff fine manually with HR.' })
    }

    const feeHeadId = await ensureLibraryFineFeeHead(school_id)
    const { billAmount, waivedAmount } = await applyRteWaiverIfEligible(school_id, studentId, feeHeadId, Number(fine.amount))

    if (billAmount <= 0) {
      const { data: updated } = await supabase.from('library_fines').update({ status: 'waived' }).eq('id', fine.id).select('*').single()
      return res.json({ success: true, data: updated, waived_amount: waivedAmount, note: 'Fully waived under this student\'s RTE fee concession.' })
    }

    const title = `Library Fine (${fine.fine_type})${waivedAmount > 0 ? ` — ₹${waivedAmount} waived under RTE concession` : ''}`
    const { data: charge, error: chargeErr } = await supabase.from('fee_adhoc_charges').insert({
      school_id, student_id: studentId, fee_head_id: feeHeadId, title, amount: billAmount, created_by: req.user!.id,
    }).select('*').single()
    if (chargeErr) return res.status(500).json({ success: false, error: chargeErr.message })

    const invoice = await bill(charge, school_id, req.user!.id)
    if (!invoice) return res.status(400).json({ success: false, error: 'Could not raise an invoice — is there a current academic year?' })

    const { data: updated, error } = await supabase.from('library_fines')
      .update({ status: 'billed', fee_adhoc_charge_id: charge.id }).eq('id', fine.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: updated, invoice, waived_amount: waivedAmount })
  })
)

// ═══════════════════════════════════════════════════════════════
// WAIVER WORKFLOWS — overdue fines route through the (usually
// single-step) Fine Waiver workflow; lost/damage charges, often a real
// amount, route through the two-step Lost Book Charge Waiver workflow.
// ═══════════════════════════════════════════════════════════════
function workflowFor(fineType: string) {
  return fineType === 'overdue'
    ? { name: 'Library Fine Waiver Approval Workflow', entityType: 'library_fine_waiver', ensureSeedFn: ensureFineWaiverWorkflowDefinition }
    : { name: 'Lost Book Charge Waiver Approval Workflow', entityType: 'library_lost_book_waiver', ensureSeedFn: ensureLostBookChargeWaiverWorkflowDefinition }
}

router.post('/:id/request-waiver', requirePermissionV2('library.manage_fines'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: fine } = await supabase.from('library_fines').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!fine) return res.status(404).json({ success: false, error: 'Fine not found' })
    if (fine.status !== 'pending') return res.status(400).json({ success: false, error: `This fine is already ${fine.status}.` })

    const workflow = workflowFor(fine.fine_type)
    await workflow.ensureSeedFn(school_id)
    const result = await startWorkflow({
      schoolId: school_id, workflowName: workflow.name, entityType: workflow.entityType,
      entityId: fine.id, initiatedBy: req.user!.id,
    })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })
    res.json({ success: true, data: result })
  })
)

const WorkflowActionSchema = z.object({ status: z.enum(['approved', 'rejected']), notes: z.string().optional() })

router.post('/:id/workflow-action', requirePermissionV2('library.manage_fines'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const parsed = WorkflowActionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: fine } = await supabase.from('library_fines').select('*').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!fine) return res.status(404).json({ success: false, error: 'Fine not found' })

    const workflow = workflowFor(fine.fine_type)
    const { data: instance } = await supabase.from('workflow_instances')
      .select('id, status').eq('entity_type', workflow.entityType).eq('entity_id', fine.id).eq('school_id', school_id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (!instance) return res.status(404).json({ success: false, error: 'No waiver request in progress for this fine.' })
    if (instance.status !== 'in_progress') return res.status(400).json({ success: false, error: `Waiver request already ${instance.status}.` })

    const result = await actOnWorkflow({ instanceId: instance.id, userId: req.user!.id, schoolId: school_id, status: parsed.data.status, notes: parsed.data.notes })
    if (!result.success) return res.status(400).json({ success: false, error: result.error })

    if (result.completed) {
      // Approved -> waived. Rejected -> the fine stays pending, still owed.
      if (result.instance.status === 'approved') {
        await supabase.from('library_fines').update({ status: 'waived' }).eq('id', fine.id)
      }
    }
    res.json({ success: true, data: result })
  })
)

router.get('/:id/workflow-status', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: fine } = await supabase.from('library_fines').select('fine_type').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!fine) return res.status(404).json({ success: false, error: 'Fine not found' })
    const workflow = workflowFor(fine.fine_type)
    const status = await getWorkflowStatus(workflow.entityType, req.params.id, school_id)
    res.json({ success: true, data: status })
  })
)

// POST /library/fines/due-date-alerts/run — manual trigger for the
// daily due-soon/overdue sweep (index.ts runs it unattended every
// morning). Same reasoning as every other manual-trigger route this
// session added: a long-lived in-process cron isn't guaranteed to fire
// on every host.
router.post('/due-date-alerts/run', requirePermissionV2('library.manage_fines'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await runLibraryDueDateAlerts(req.user!.school_id)
    res.json({ success: true, data: result })
  })
)

export default router
