import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { bulkImport } from '../../shared/utils/bulkImport'
import { getEditableWorkflowStatus, saveEditableWorkflowSteps } from '../../shared/middleware/workflowSettings'
import {
  ensureRouteChangeApprovalWorkflowDefinition,
  ensureVehicleOnboardingWorkflowDefinition,
  ensureDriverReassignmentWorkflowDefinition,
} from '../rbac/seed'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// WORKFLOWS — Route/Stop Change, Vehicle Onboarding, Driver Reassignment
// Same GET/PUT-a-step-list pattern as HR/SIS/Admission settings, all on
// the shared workflow engine.
// ═══════════════════════════════════════════════════════════════
const TransportWorkflowStepSchema = z.object({ role_id: z.string(), action_name: z.string().min(1) })
const SaveTransportWorkflowSchema = z.object({ steps: z.array(TransportWorkflowStepSchema).min(1) })

const TRANSPORT_WORKFLOWS: Record<string, { name: string; entityType: string; ensureSeedFn: (schoolId: string) => Promise<void> }> = {
  'route-change': { name: 'Route & Stop Change Approval Workflow', entityType: 'transport_route_change', ensureSeedFn: ensureRouteChangeApprovalWorkflowDefinition },
  'vehicle-onboarding': { name: 'New Vehicle Onboarding Workflow', entityType: 'vehicle_onboarding', ensureSeedFn: ensureVehicleOnboardingWorkflowDefinition },
  'driver-reassignment': { name: 'Driver Reassignment Approval Workflow', entityType: 'driver_reassignment', ensureSeedFn: ensureDriverReassignmentWorkflowDefinition },
}

router.get('/workflow/:key', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const workflow = TRANSPORT_WORKFLOWS[req.params.key]
    if (!workflow) return res.status(404).json({ success: false, error: 'Unknown workflow' })
    const status = await getEditableWorkflowStatus(req.user!.school_id, workflow.name, workflow.ensureSeedFn)
    if (!status) return res.status(500).json({ success: false, error: `Could not load the "${workflow.name}"` })
    res.json({ success: true, data: status })
  })
)

router.put('/workflow/:key', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const workflow = TRANSPORT_WORKFLOWS[req.params.key]
    if (!workflow) return res.status(404).json({ success: false, error: 'Unknown workflow' })
    const { steps } = SaveTransportWorkflowSchema.parse(req.body)
    const result = await saveEditableWorkflowSteps(
      req.user!.school_id,
      { workflowName: workflow.name, module: 'transport', entityType: workflow.entityType, ensureSeedFn: workflow.ensureSeedFn },
      steps,
    )
    if (!result.success) return res.status(400).json({ success: false, error: result.error })
    res.json({ success: true, data: { definition_id: result.definition_id, steps: result.steps } })
  })
)

// ═══════════════════════════════════════════════════════════════
// SCHOOL SETTINGS — boarding method, notification triggers, compliance
// alert lead time. One row per school (transport_settings), created
// lazily on first GET.
// ═══════════════════════════════════════════════════════════════
router.get('/general', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data: existing } = await supabase.from('transport_settings').select('*').eq('school_id', school_id).maybeSingle()
    if (existing) return res.json({ success: true, data: existing })

    const { data: created, error } = await supabase.from('transport_settings').insert({ school_id }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data: created })
  })
)

const SaveGeneralSettingsSchema = z.object({
  boarding_method: z.enum(['manual', 'rfid', 'app']),
  notify_boarded: z.boolean(),
  notify_alighted: z.boolean(),
  notify_delayed: z.boolean(),
  notify_approaching: z.boolean(),
  sync_boarding_to_attendance: z.boolean(),
  compliance_alert_lead_days: z.number().int().min(1).max(365),
})

router.put('/general', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const parsed = SaveGeneralSettingsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data, error } = await supabase
      .from('transport_settings')
      .upsert({ school_id, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: 'school_id' })
      .select('*')
      .single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// FEE SLABS — school-defined zone/distance/route pricing bands.
// A slab is either: a flat named zone (label + amount, no distance
// range), a distance band (min/max_distance_km + amount), or tied to a
// specific route (route_id) — schools aren't forced into one shape.
// ═══════════════════════════════════════════════════════════════
router.get('/fee-slabs', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('transport_fee_slabs')
      .select('*, routes(name), fee_heads(name)')
      .eq('school_id', req.user!.school_id)
      .order('sort_order')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const FeeSlabSchema = z.object({
  label: z.string().trim().min(1).max(100),
  fee_head_id: z.string().uuid(),
  route_id: z.string().uuid().nullable().optional(),
  min_distance_km: z.number().nonnegative().nullable().optional(),
  max_distance_km: z.number().positive().nullable().optional(),
  amount: z.number().nonnegative(),
  sort_order: z.number().int().optional(),
})

router.post('/fee-slabs', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = FeeSlabSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: head } = await supabase.from('fee_heads').select('id').eq('id', parsed.data.fee_head_id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!head) return res.status(400).json({ success: false, error: 'Unknown fee head' })

    const { data, error } = await supabase
      .from('transport_fee_slabs')
      .insert({ school_id: req.user!.school_id, ...parsed.data })
      .select('*')
      .single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const FeeSlabImportRowSchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(100),
  fee_head_name: z.string().trim().min(1, 'fee_head_name is required'),
  min_distance_km: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.number().nonnegative().optional()),
  max_distance_km: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.number().positive().optional()),
  amount: z.coerce.number().nonnegative('amount must be a non-negative number'),
})

router.post('/fee-slabs/import', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = z.array(z.record(z.string())).parse(req.body.rows ?? [])
    const school_id = req.user!.school_id

    // Resolved once, not per row — a CSV of 100 slabs referencing the
    // same 5 fee heads shouldn't cost 100 round trips.
    const { data: heads } = await supabase.from('fee_heads').select('id, name').eq('school_id', school_id)
    const headIdByLowerName = new Map((heads ?? []).map(h => [h.name.toLowerCase(), h.id]))

    const result = await bulkImport(
      rows, FeeSlabImportRowSchema,
      async row => {
        const fee_head_id = headIdByLowerName.get(row.fee_head_name.toLowerCase())
        if (!fee_head_id) return { error: `Unknown fee head "${row.fee_head_name}"` }
        const { fee_head_name, ...rest } = row
        return { school_id, fee_head_id, ...rest }
      },
      async row => {
        const { error } = await supabase.from('transport_fee_slabs').insert(row)
        return { error: error?.message }
      },
    )
    res.json({ success: true, data: result })
  })
)

router.patch('/fee-slabs/:id', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = FeeSlabSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data, error } = await supabase
      .from('transport_fee_slabs')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
      .select('*')
      .maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Fee slab not found' })
    res.json({ success: true, data })
  })
)

router.delete('/fee-slabs/:id', requirePermissionV2('transport.settings_manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase
      .from('transport_fee_slabs')
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user!.school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

export default router
