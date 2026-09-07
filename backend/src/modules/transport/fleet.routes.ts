import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { runTransportComplianceAlerts } from '../../shared/utils/transportComplianceAlerts'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════
router.get('/vehicles', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*, vehicle_documents(id, doc_type, expiry_date)')
      .eq('school_id', req.user!.school_id)
      .order('registration_no')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const VehicleSchema = z.object({
  registration_no: z.string().trim().min(1).max(50),
  vehicle_type: z.enum(['bus', 'van', 'minibus', 'car', 'other']),
  capacity: z.number().int().positive(),
  status: z.enum(['active', 'in_service', 'maintenance', 'retired']).optional(),
})

router.post('/vehicles', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = VehicleSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('vehicles')
      .insert({ school_id: req.user!.school_id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/vehicles/:id', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = VehicleSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('vehicles').update(parsed.data)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Vehicle not found' })
    res.json({ success: true, data })
  })
)

router.delete('/vehicles/:id', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: vehicle } = await supabase.from('vehicles').select('id, registration_no').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    // routes.vehicle_id has no ON DELETE clause (plain FK) — a route
    // still pointing at this vehicle would otherwise hard-fail with a
    // raw constraint error instead of a clear message.
    const { count: routeCount } = await supabase.from('routes').select('id', { count: 'exact', head: true }).eq('vehicle_id', id)
    if (routeCount) {
      return res.status(400).json({ success: false, error: `Cannot delete "${vehicle.registration_no}" — it is assigned to ${routeCount} route${routeCount === 1 ? '' : 's'}. Reassign those first.` })
    }

    const { error } = await supabase.from('vehicles').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ─── Vehicle documents ───────────────────────────────────────────
const VehicleDocSchema = z.object({
  doc_type: z.enum(['rc', 'insurance', 'permit', 'fitness', 'pollution', 'other']),
  document_no: z.string().trim().max(100).optional(),
  issued_date: z.string().optional(),
  expiry_date: z.string().optional(),
})

router.post('/vehicles/:id/documents', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = VehicleDocSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const { data, error } = await supabase.from('vehicle_documents').insert({ vehicle_id: vehicle.id, ...parsed.data }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/vehicles/:id/documents/:docId', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const { error } = await supabase.from('vehicle_documents').delete().eq('id', req.params.docId).eq('vehicle_id', vehicle.id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// DRIVERS
// ═══════════════════════════════════════════════════════════════
router.get('/drivers', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('drivers')
      .select('*, driver_documents(id, doc_type, expiry_date)')
      .eq('school_id', req.user!.school_id)
      .order('full_name')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const DriverSchema = z.object({
  full_name: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(20).optional(),
  license_no: z.string().trim().min(1).max(50),
  license_class: z.string().trim().max(50).optional(),
  license_expiry: z.string().optional(),
  status: z.enum(['active', 'on_leave', 'inactive']).optional(),
})

router.post('/drivers', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DriverSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('drivers')
      .insert({ school_id: req.user!.school_id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/drivers/:id', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DriverSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('drivers').update(parsed.data)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Driver not found' })
    res.json({ success: true, data })
  })
)

router.delete('/drivers/:id', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: driver } = await supabase.from('drivers').select('id, full_name').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })

    const { count: routeCount } = await supabase.from('routes').select('id', { count: 'exact', head: true }).eq('driver_id', id)
    if (routeCount) {
      return res.status(400).json({ success: false, error: `Cannot delete "${driver.full_name}" — assigned to ${routeCount} route${routeCount === 1 ? '' : 's'}. Reassign those first.` })
    }

    const { error } = await supabase.from('drivers').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ─── Driver documents ────────────────────────────────────────────
const DriverDocSchema = z.object({
  doc_type: z.enum(['license', 'medical_certificate', 'police_verification', 'other']),
  document_no: z.string().trim().max(100).optional(),
  issued_date: z.string().optional(),
  expiry_date: z.string().optional(),
})

router.post('/drivers/:id/documents', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DriverDocSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: driver } = await supabase.from('drivers').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })

    const { data, error } = await supabase.from('driver_documents').insert({ driver_id: driver.id, ...parsed.data }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/drivers/:id/documents/:docId', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: driver } = await supabase.from('drivers').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })

    const { error } = await supabase.from('driver_documents').delete().eq('id', req.params.docId).eq('driver_id', driver.id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// POST /transport/fleet/compliance-alerts/run — manual trigger for the
// daily vehicle/driver document expiry sweep (index.ts runs it
// unattended every morning). Same reasoning as HR's own manual-trigger
// routes: a long-lived in-process cron isn't guaranteed to fire on
// every host.
router.post('/compliance-alerts/run', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await runTransportComplianceAlerts(req.user!.school_id)
    res.json({ success: true, data: result })
  })
)

export default router
