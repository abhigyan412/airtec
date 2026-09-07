import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { runTransportComplianceAlerts } from '../../shared/utils/transportComplianceAlerts'
import { bulkImport } from '../../shared/utils/bulkImport'

const router = Router()

// CSV cells arrive as strings — z.coerce.number() turns "40" into 40,
// and this trims + lowercases before matching an enum so "Bus"/" bus "
// from a hand-edited spreadsheet still resolves instead of failing
// every row over casing.
const lowerTrim = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v)

// Same base64 -> storage bucket -> getPublicUrl() shape every other
// document feature in this app uses (student_documents, staff_documents,
// application_documents) — see uploadAdmissionDocumentFile in
// admission/routes.ts for the twin this was copied from.
function uploadTransportDocumentFile(schoolId: string, ownerId: string, file_base64: string, file_name: string) {
  const base64Data = file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  const filePath = `${schoolId}/${ownerId}/${Date.now()}_${file_name}`
  const fileSize = buffer.length > 1024 * 1024
    ? `${(buffer.length / (1024 * 1024)).toFixed(1)} MB`
    : `${(buffer.length / 1024).toFixed(0)} KB`
  return { buffer, filePath, fileSize }
}

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

// GET /transport/fleet/vehicles/:id — the full Vehicle Profile: basic
// info, compliance documents, service history, the route it's
// currently assigned to (if any), and its most recent trips. One real
// record instead of a table row + a documents popup.
router.get('/vehicles/:id', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: vehicle } = await supabase.from('vehicles').select('*').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const [{ data: documents }, { data: serviceRecords }, { data: route }, { data: trips }] = await Promise.all([
      supabase.from('vehicle_documents').select('*').eq('vehicle_id', id).order('expiry_date'),
      supabase.from('vehicle_service_records').select('*').eq('vehicle_id', id).order('service_date', { ascending: false }),
      supabase.from('routes').select('id, name, driver_id, drivers(full_name)').eq('vehicle_id', id).maybeSingle(),
      supabase.from('vehicle_trips').select('id, trip_date, shift, status, routes(name)').eq('vehicle_id', id).order('trip_date', { ascending: false }).limit(10),
    ])

    res.json({
      success: true,
      data: { ...vehicle, documents: documents ?? [], service_records: serviceRecords ?? [], route: route ?? null, recent_trips: trips ?? [] },
    })
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

const VehicleImportRowSchema = z.object({
  registration_no: z.string().trim().min(1, 'registration_no is required').max(50),
  vehicle_type: z.preprocess(lowerTrim, z.enum(['bus', 'van', 'minibus', 'car', 'other'])).default('bus'),
  capacity: z.coerce.number().int().positive('capacity must be a positive number'),
  status: z.preprocess(v => v || undefined, z.preprocess(lowerTrim, z.enum(['active', 'in_service', 'maintenance', 'retired'])).optional()),
})

router.post('/vehicles/import', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = z.array(z.record(z.string())).parse(req.body.rows ?? [])
    const school_id = req.user!.school_id
    const result = await bulkImport(
      rows, VehicleImportRowSchema,
      async row => ({ school_id, ...row }),
      async row => {
        const { error } = await supabase.from('vehicles').insert(row)
        return { error: error?.code === '23505' ? `Registration "${row.registration_no}" already exists` : error?.message }
      },
    )
    res.json({ success: true, data: result })
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
  // The scanned copy itself — optional, since a school may log dates
  // before they have it on hand and attach it later.
  file_base64: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
})

router.post('/vehicles/:id/documents', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = VehicleDocSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const { file_base64, file_name, mime_type, ...fields } = parsed.data
    let fileFields: Record<string, string> = {}
    if (file_base64 && file_name) {
      const { buffer, filePath, fileSize } = uploadTransportDocumentFile(req.user!.school_id, vehicle.id, file_base64, file_name)
      const { error: uploadErr } = await supabase.storage.from('transport-documents').upload(filePath, buffer, { contentType: mime_type ?? 'application/pdf', upsert: false })
      if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
      const { data: urlData } = supabase.storage.from('transport-documents').getPublicUrl(filePath)
      fileFields = { file_url: urlData.publicUrl, file_size: fileSize, mime_type: mime_type ?? '' }
    }

    const { data, error } = await supabase.from('vehicle_documents').insert({ vehicle_id: vehicle.id, ...fields, ...fileFields }).select('*').single()
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

// ─── Service / maintenance history ──────────────────────────────
const ServiceRecordSchema = z.object({
  service_date: z.string(),
  service_type: z.enum(['routine', 'repair', 'inspection', 'other']).optional(),
  odometer_km: z.number().nonnegative().nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  next_service_due_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
})

router.post('/vehicles/:id/service-records', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ServiceRecordSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const { data, error } = await supabase.from('vehicle_service_records')
      .insert({ vehicle_id: vehicle.id, created_by: req.user!.id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/vehicles/:id/service-records/:recordId', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' })

    const { error } = await supabase.from('vehicle_service_records').delete().eq('id', req.params.recordId).eq('vehicle_id', vehicle.id)
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

const DriverImportRowSchema = z.object({
  full_name: z.string().trim().min(1, 'full_name is required').max(150),
  phone: z.preprocess(v => v || undefined, z.string().trim().max(20).optional()),
  license_no: z.string().trim().min(1, 'license_no is required').max(50),
  license_class: z.preprocess(v => v || undefined, z.string().trim().max(50).optional()),
  license_expiry: z.preprocess(v => v || undefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'license_expiry must be YYYY-MM-DD').optional()),
  status: z.preprocess(v => v || undefined, z.preprocess(lowerTrim, z.enum(['active', 'on_leave', 'inactive'])).optional()),
})

router.post('/drivers/import', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = z.array(z.record(z.string())).parse(req.body.rows ?? [])
    const school_id = req.user!.school_id
    const result = await bulkImport(
      rows, DriverImportRowSchema,
      async row => ({ school_id, ...row }),
      async row => {
        const { error } = await supabase.from('drivers').insert(row)
        return { error: error?.message }
      },
    )
    res.json({ success: true, data: result })
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
  file_base64: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
})

router.post('/drivers/:id/documents', requirePermissionV2('transport.manage_fleet'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DriverDocSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: driver } = await supabase.from('drivers').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })

    const { file_base64, file_name, mime_type, ...fields } = parsed.data
    let fileFields: Record<string, string> = {}
    if (file_base64 && file_name) {
      const { buffer, filePath, fileSize } = uploadTransportDocumentFile(req.user!.school_id, driver.id, file_base64, file_name)
      const { error: uploadErr } = await supabase.storage.from('transport-documents').upload(filePath, buffer, { contentType: mime_type ?? 'application/pdf', upsert: false })
      if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message })
      const { data: urlData } = supabase.storage.from('transport-documents').getPublicUrl(filePath)
      fileFields = { file_url: urlData.publicUrl, file_size: fileSize, mime_type: mime_type ?? '' }
    }

    const { data, error } = await supabase.from('driver_documents').insert({ driver_id: driver.id, ...fields, ...fileFields }).select('*').single()
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

// ═══════════════════════════════════════════════════════════════
// DRIVER ABSENCE -> SUBSTITUTE OVERLAY
// Mirrors the timetable module's teacher_absences -> arrangements
// shape: recording an absence materializes one trip_substitute_
// assignments row per affected trip, rather than editing the trip
// itself. No ranking-candidate scoring engine (that's specific to
// teaching-load fairness) — just eligibility (not already driving
// elsewhere that date+shift), checked at assign time.
//
// Deliberately NOT gated behind the Driver Reassignment Approval
// Workflow from Settings: that workflow is configurable for a
// PERMANENT route/driver staffing change, but blocking an urgent
// same-day substitute assignment on a multi-step approval chain would
// leave a bus without a driver while waiting for sign-off. This is an
// immediate dispatch decision, recorded for the day, not routed through
// approval.
// ═══════════════════════════════════════════════════════════════
const DriverAbsenceSchema = z.object({
  absence_date: z.string(),
  reason: z.string().trim().max(500).optional(),
})

router.get('/drivers/:id/absences', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: driver } = await supabase.from('drivers').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })
    const { data, error } = await supabase.from('driver_absences').select('*').eq('driver_id', driver.id).order('absence_date', { ascending: false })
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.post('/drivers/:id/absences', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = DriverAbsenceSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: driver } = await supabase.from('drivers').select('id, full_name').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' })

    const { data: absence, error: absErr } = await supabase.from('driver_absences')
      .insert({ school_id, driver_id: driver.id, absence_date: parsed.data.absence_date, reason: parsed.data.reason, created_by: req.user!.id })
      .select('*').single()
    if (absErr) {
      if (absErr.code === '23505') return res.status(409).json({ success: false, error: `${driver.full_name} is already marked absent on this date.` })
      return res.status(500).json({ success: false, error: absErr.message })
    }

    // Materialize: one substitute-assignment row per trip this driver
    // was on for that date, still needing a driver (not yet cancelled).
    const { data: affectedTrips } = await supabase.from('vehicle_trips')
      .select('id').eq('driver_id', driver.id).eq('trip_date', parsed.data.absence_date).in('status', ['scheduled', 'in_progress'])

    let materialized = 0
    if (affectedTrips?.length) {
      const rows = affectedTrips.map(t => ({ trip_id: t.id, absence_id: absence.id, absent_driver_id: driver.id }))
      const { error: matErr } = await supabase.from('trip_substitute_assignments').insert(rows)
      if (!matErr) materialized = rows.length
    }

    res.json({ success: true, data: { absence, materialized } })
  })
)

// GET /transport/fleet/substitute-assignments?date=... — dispatch's
// worklist of trips still needing a substitute driver.
router.get('/substitute-assignments', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const date = req.query.date as string | undefined
    let q = supabase.from('trip_substitute_assignments')
      .select('*, vehicle_trips!inner(id, trip_date, shift, route_id, school_id, routes(name)), drivers!trip_substitute_assignments_absent_driver_id_fkey(full_name)')
      .eq('vehicle_trips.school_id', req.user!.school_id)
    if (date) q = q.eq('vehicle_trips.trip_date', date)
    const { data, error } = await q.order('id')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/substitute-assignments/:id', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const substitute_driver_id = z.string().uuid().parse(req.body.substitute_driver_id)

    const { data: sub } = await supabase.from('trip_substitute_assignments')
      .select('id, trip_id, vehicle_trips!inner(trip_date, shift, school_id)')
      .eq('id', req.params.id).eq('vehicle_trips.school_id', req.user!.school_id).maybeSingle()
    if (!sub) return res.status(404).json({ success: false, error: 'Substitute assignment not found' })

    const trip = (sub as any).vehicle_trips
    const { count: clashCount } = await supabase.from('vehicle_trips').select('id', { count: 'exact', head: true })
      .eq('driver_id', substitute_driver_id).eq('trip_date', trip.trip_date).eq('shift', trip.shift)
    if (clashCount) {
      return res.status(400).json({ success: false, error: 'This driver is already assigned to another trip at the same date and shift.' })
    }

    const { data, error } = await supabase.from('trip_substitute_assignments')
      .update({ substitute_driver_id, status: 'assigned', assigned_at: new Date().toISOString() })
      .eq('id', req.params.id).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    // The substitute now drives this trip for real.
    await supabase.from('vehicle_trips').update({ driver_id: substitute_driver_id }).eq('id', sub.trip_id)

    res.json({ success: true, data })
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
