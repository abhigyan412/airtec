import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { bulkImport } from '../../shared/utils/bulkImport'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// STOPS — master list, reused across routes
// ═══════════════════════════════════════════════════════════════
router.get('/stops', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase.from('stops').select('*').eq('school_id', req.user!.school_id).order('name')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const StopSchema = z.object({
  name: z.string().trim().min(1).max(150),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
})

router.post('/stops', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = StopSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('stops').insert({ school_id: req.user!.school_id, ...parsed.data }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const StopImportRowSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(150),
  lat: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.number().min(-90).max(90).optional()),
  lng: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.number().min(-180).max(180).optional()),
})

router.post('/stops/import', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = z.array(z.record(z.string())).parse(req.body.rows ?? [])
    const school_id = req.user!.school_id
    const result = await bulkImport(
      rows, StopImportRowSchema,
      async row => ({ school_id, ...row }),
      async row => {
        const { error } = await supabase.from('stops').insert(row)
        return { error: error?.message }
      },
    )
    res.json({ success: true, data: result })
  })
)

router.patch('/stops/:id', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = StopSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('stops').update(parsed.data)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id).select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Stop not found' })
    res.json({ success: true, data })
  })
)

router.delete('/stops/:id', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { data: stop } = await supabase.from('stops').select('id, name').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!stop) return res.status(404).json({ success: false, error: 'Stop not found' })

    const [{ count: routeStopCount }, { count: assignmentCount }] = await Promise.all([
      supabase.from('route_stops').select('id', { count: 'exact', head: true }).eq('stop_id', id),
      supabase.from('student_transport_assignments').select('id', { count: 'exact', head: true }).eq('stop_id', id).eq('is_active', true),
    ])
    if (routeStopCount || assignmentCount) {
      const blockers: string[] = []
      if (routeStopCount) blockers.push(`${routeStopCount} route${routeStopCount === 1 ? '' : 's'}`)
      if (assignmentCount) blockers.push(`${assignmentCount} student${assignmentCount === 1 ? '' : 's'} assigned to it`)
      return res.status(400).json({ success: false, error: `Cannot delete "${stop.name}" — used by ${blockers.join(' and ')}.` })
    }

    const { error } = await supabase.from('stops').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// ROUTES + their ordered stops
// ═══════════════════════════════════════════════════════════════
router.get('/routes', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('routes')
      .select('*, vehicles(registration_no), drivers(full_name), route_stops(id, sequence_no, distance_from_school_km, stops(id, name))')
      .eq('school_id', req.user!.school_id)
      .order('name')
    if (error) return res.status(500).json({ success: false, error: error.message })
    const sorted = (data ?? []).map((r: any) => ({ ...r, route_stops: (r.route_stops ?? []).sort((a: any, b: any) => a.sequence_no - b.sequence_no) }))
    res.json({ success: true, data: sorted })
  })
)

const RouteSchema = z.object({
  name: z.string().trim().min(1).max(150),
  vehicle_id: z.string().uuid().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
})

router.post('/routes', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = RouteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('routes').insert({ school_id: req.user!.school_id, ...parsed.data }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/routes/:id', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = RouteSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('routes').update(parsed.data)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id).select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Route not found' })
    res.json({ success: true, data })
  })
)

router.delete('/routes/:id', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { data: route } = await supabase.from('routes').select('id, name').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' })

    const [{ count: assignmentCount }, { count: tripCount }] = await Promise.all([
      supabase.from('student_transport_assignments').select('id', { count: 'exact', head: true }).eq('route_id', id).eq('is_active', true),
      supabase.from('vehicle_trips').select('id', { count: 'exact', head: true }).eq('route_id', id),
    ])
    if (assignmentCount || tripCount) {
      const blockers: string[] = []
      if (assignmentCount) blockers.push(`${assignmentCount} student${assignmentCount === 1 ? '' : 's'} assigned to it`)
      if (tripCount) blockers.push(`${tripCount} scheduled trip${tripCount === 1 ? '' : 's'}`)
      return res.status(400).json({ success: false, error: `Cannot delete "${route.name}" — ${blockers.join(' and ')}. Reassign or clear those first.` })
    }

    const { error } = await supabase.from('routes').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ─── Route stops (ordered) ───────────────────────────────────────
const RouteStopSchema = z.object({
  stop_id: z.string().uuid(),
  sequence_no: z.number().int().nonnegative(),
  distance_from_school_km: z.number().nonnegative().nullable().optional(),
})

router.post('/routes/:id/stops', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = RouteStopSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: route } = await supabase.from('routes').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' })

    const { data, error } = await supabase.from('route_stops').insert({ route_id: route.id, ...parsed.data }).select('*, stops(name)').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/routes/:id/stops/:routeStopId', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = RouteStopSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: route } = await supabase.from('routes').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' })

    const { data, error } = await supabase.from('route_stops').update(parsed.data)
      .eq('id', req.params.routeStopId).eq('route_id', route.id).select('*, stops(name)').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Route stop not found' })
    res.json({ success: true, data })
  })
)

router.delete('/routes/:id/stops/:routeStopId', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: route } = await supabase.from('routes').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' })

    const { data: routeStop } = await supabase.from('route_stops').select('stop_id').eq('id', req.params.routeStopId).eq('route_id', route.id).maybeSingle()
    if (!routeStop) return res.status(404).json({ success: false, error: 'Route stop not found' })

    const { count: assignmentCount } = await supabase.from('student_transport_assignments').select('id', { count: 'exact', head: true })
      .eq('route_id', route.id).eq('stop_id', routeStop.stop_id).eq('is_active', true)
    if (assignmentCount) {
      return res.status(400).json({ success: false, error: `Cannot remove this stop — ${assignmentCount} student${assignmentCount === 1 ? '' : 's'} still assigned to it on this route.` })
    }

    const { error } = await supabase.from('route_stops').delete().eq('id', req.params.routeStopId)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// STUDENT STOP ASSIGNMENT
// ═══════════════════════════════════════════════════════════════
router.get('/students/:studentId/assignment', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('student_transport_assignments')
      .select('*, routes(name), stops(name)')
      .eq('student_id', req.params.studentId).eq('school_id', req.user!.school_id).eq('is_active', true)
      .maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const AssignmentSchema = z.object({
  route_id: z.string().uuid(),
  stop_id: z.string().uuid(),
  direction: z.enum(['pickup', 'drop', 'both']).optional(),
})

router.post('/students/:studentId/assignment', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = AssignmentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id
    const { studentId } = req.params

    const { data: student } = await supabase.from('students').select('id').eq('id', studentId).eq('school_id', school_id).maybeSingle()
    if (!student) return res.status(404).json({ success: false, error: 'Student not found' })

    const { data: routeStop } = await supabase.from('route_stops')
      .select('id, routes!inner(id, school_id)')
      .eq('route_id', parsed.data.route_id).eq('stop_id', parsed.data.stop_id).eq('routes.school_id', school_id)
      .maybeSingle()
    if (!routeStop) return res.status(400).json({ success: false, error: 'That stop is not on the selected route.' })

    // Retire the previous active assignment first — never delete it, so
    // fee history and past trip records stay attributable to whichever
    // route/stop the student was actually on at the time.
    const { error: retireErr } = await supabase.from('student_transport_assignments')
      .update({ is_active: false }).eq('student_id', studentId).eq('school_id', school_id).eq('is_active', true)
    if (retireErr) return res.status(500).json({ success: false, error: retireErr.message })

    const { data, error } = await supabase.from('student_transport_assignments')
      .insert({ school_id, student_id: studentId, ...parsed.data })
      .select('*, routes(name), stops(name)').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.delete('/students/:studentId/assignment', requirePermissionV2('transport.manage_routes'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { error } = await supabase.from('student_transport_assignments')
      .update({ is_active: false })
      .eq('student_id', req.params.studentId).eq('school_id', req.user!.school_id).eq('is_active', true)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

export default router
