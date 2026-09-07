import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { createNotifications, getRecipientUserIdsForStudent } from '../../shared/utils/notifications'
import { getUserIdsWithPermission } from '../../shared/middleware/permissions-v2'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// TRIPS — one scheduled run of a route on a given date/shift
// ═══════════════════════════════════════════════════════════════
router.get('/', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('vehicle_trips')
      .select('*, routes(name), vehicles(registration_no), drivers(full_name)')
      .eq('school_id', req.user!.school_id).eq('trip_date', date)
      .order('shift')
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const ScheduleTripSchema = z.object({
  route_id: z.string().uuid(),
  trip_date: z.string(),
  shift: z.enum(['morning', 'afternoon']),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
})

router.post('/', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ScheduleTripSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: route } = await supabase.from('routes').select('id, vehicle_id, driver_id').eq('id', parsed.data.route_id).eq('school_id', school_id).maybeSingle()
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' })

    const vehicle_id = parsed.data.vehicle_id ?? route.vehicle_id
    const driver_id = parsed.data.driver_id ?? route.driver_id
    if (!vehicle_id) return res.status(400).json({ success: false, error: 'This route has no vehicle assigned — pick one for this trip.' })

    const { data, error } = await supabase.from('vehicle_trips')
      .insert({ school_id, route_id: route.id, vehicle_id, driver_id, trip_date: parsed.data.trip_date, shift: parsed.data.shift })
      .select('*, routes(name), vehicles(registration_no), drivers(full_name)').single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'A trip for this route/date/shift already exists.' })
      return res.status(500).json({ success: false, error: error.message })
    }
    res.json({ success: true, data })
  })
)

const UpdateTripSchema = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().nullable().optional(),
})

router.patch('/:id', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = UpdateTripSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const patch: Record<string, any> = { ...parsed.data }
    if (parsed.data.status === 'in_progress') patch.started_at = new Date().toISOString()
    if (parsed.data.status === 'completed') patch.completed_at = new Date().toISOString()

    const { data, error } = await supabase.from('vehicle_trips').update(patch)
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*, routes(name), vehicles(registration_no), drivers(full_name)').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Trip not found' })
    res.json({ success: true, data })
  })
)

router.delete('/:id', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: trip } = await supabase.from('vehicle_trips').select('id, status').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' })
    if (trip.status !== 'scheduled') {
      return res.status(400).json({ success: false, error: 'Only a trip that has not started can be removed — cancel it instead.' })
    }
    const { error } = await supabase.from('vehicle_trips').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// ROSTER — students expected on this trip's route, each with their
// latest boarding event for the trip (if any yet).
// ═══════════════════════════════════════════════════════════════
router.get('/:id/roster', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: trip } = await supabase.from('vehicle_trips').select('id, route_id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' })

    const [{ data: assignments }, { data: events }] = await Promise.all([
      supabase.from('student_transport_assignments')
        .select('student_id, direction, stop_id, stops(name), students(id, first_name, last_name, admission_number)')
        .eq('route_id', trip.route_id).eq('is_active', true),
      supabase.from('trip_boarding_events').select('*').eq('trip_id', trip.id),
    ])

    const eventsByStudent = new Map<string, any[]>()
    for (const e of (events ?? []) as any[]) {
      const list = eventsByStudent.get(e.student_id) ?? []
      list.push(e)
      eventsByStudent.set(e.student_id, list)
    }

    const roster = (assignments ?? []).map((a: any) => ({
      student_id: a.student_id,
      student: a.students,
      direction: a.direction,
      stop_id: a.stop_id,
      stop_name: a.stops?.name,
      events: eventsByStudent.get(a.student_id) ?? [],
    }))

    res.json({ success: true, data: roster })
  })
)

// ═══════════════════════════════════════════════════════════════
// BOARDING EVENTS
// ═══════════════════════════════════════════════════════════════
const BoardingEventSchema = z.object({
  student_id: z.string().uuid(),
  stop_id: z.string().uuid().optional(),
  event: z.enum(['boarded', 'alighted', 'absent_no_show']),
  method: z.enum(['manual', 'rfid', 'app']).optional(),
})

router.post('/:id/boarding', requirePermissionV2('transport.mark_boarding'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = BoardingEventSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: trip } = await supabase.from('vehicle_trips').select('id, route_id, trip_date').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' })

    const { data: assignment } = await supabase.from('student_transport_assignments')
      .select('id, stop_id').eq('student_id', parsed.data.student_id).eq('route_id', trip.route_id).eq('is_active', true).maybeSingle()
    if (!assignment) return res.status(400).json({ success: false, error: 'This student is not assigned to this route.' })

    const { data: event, error } = await supabase.from('trip_boarding_events').insert({
      trip_id: trip.id,
      student_id: parsed.data.student_id,
      stop_id: parsed.data.stop_id ?? assignment.stop_id,
      event: parsed.data.event,
      method: parsed.data.method ?? 'manual',
      recorded_by: req.user!.id,
    }).select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    const { data: settings } = await supabase.from('transport_settings').select('*').eq('school_id', school_id).maybeSingle()
    const notifyFlag = parsed.data.event === 'boarded' ? settings?.notify_boarded
      : parsed.data.event === 'alighted' ? settings?.notify_alighted : false
    // Defaults to on (undefined settings row) — matches transport_settings'
    // own column defaults, so a school that never opened Settings still
    // gets alerts rather than silence.
    if (notifyFlag !== false && parsed.data.event !== 'absent_no_show') {
      const recipients = await getRecipientUserIdsForStudent(parsed.data.student_id)
      if (recipients.length) {
        const { data: student } = await supabase.from('students').select('first_name, last_name').eq('id', parsed.data.student_id).maybeSingle()
        const name = student ? `${student.first_name} ${student.last_name}` : 'Your child'
        await createNotifications(recipients, {
          schoolId: school_id,
          type: parsed.data.event === 'boarded' ? 'student_boarded' : 'student_alighted',
          title: parsed.data.event === 'boarded' ? `${name} boarded the bus` : `${name} got off the bus`,
          message: `Recorded at ${new Date(event.recorded_at).toLocaleTimeString()}.`,
          link: '/transport/trips', relatedEntityType: 'trip_boarding_event', relatedEntityId: event.id,
        })
      }
    }

    // Pre-fills attendance as 'present' on boarding — never overwrites an
    // existing mark (ignoreDuplicates), since a teacher's own attendance
    // entry is authoritative and a bus boarding is only a convenience
    // pre-fill, not proof the student stayed in school all day. A
    // no-show on the bus is deliberately NOT synced as absent — the
    // parent may simply have driven them in instead.
    if (settings?.sync_boarding_to_attendance && parsed.data.event === 'boarded') {
      const { data: student } = await supabase.from('students').select('class_id, section_id').eq('id', parsed.data.student_id).maybeSingle()
      if (student) {
        await supabase.from('attendance').upsert({
          school_id, student_id: parsed.data.student_id, class_id: student.class_id, section_id: student.section_id,
          date: trip.trip_date, status: 'present', marked_by: req.user!.id, remarks: 'Auto-marked from transport boarding',
        }, { onConflict: 'student_id,date', ignoreDuplicates: true })
      }
    }

    res.json({ success: true, data: event })
  })
)

// ═══════════════════════════════════════════════════════════════
// LIVE LOCATION — driver-app-posted pings, polled by staff/parents.
// No hardware GPS vendor or push channel yet (Phase 5) — the driver
// side is a plain authenticated POST every 15-30s while the trip is
// in_progress, and reads are plain REST polling. See my.routes.ts for
// the parent-scoped equivalent read.
// ═══════════════════════════════════════════════════════════════
const LocationSchema = z.object({ lat: z.number(), lng: z.number() })

router.post('/:id/location', requirePermissionV2('transport.mark_boarding'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = LocationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const { data: trip } = await supabase.from('vehicle_trips').select('id, vehicle_id, status').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' })
    if (trip.status !== 'in_progress') return res.status(400).json({ success: false, error: 'This trip is not in progress.' })

    const { data, error } = await supabase.from('vehicle_location_pings')
      .insert({ vehicle_id: trip.vehicle_id, trip_id: trip.id, lat: parsed.data.lat, lng: parsed.data.lng })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.get('/:id/location', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: trip } = await supabase.from('vehicle_trips').select('id').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' })

    const { data, error } = await supabase.from('vehicle_location_pings').select('*')
      .eq('trip_id', trip.id).order('recorded_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

// ═══════════════════════════════════════════════════════════════
// INCIDENTS — breakdown/accident/delay reports, and the SOS button.
// ═══════════════════════════════════════════════════════════════
router.get('/incidents', requirePermissionV2('transport.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('transport_incidents').select('*, vehicle_trips(route_id, routes(name)), vehicles(registration_no)')
      .eq('school_id', req.user!.school_id).order('created_at', { ascending: false })
    if (req.query.status) q = q.eq('status', req.query.status as string)
    const { data, error } = await q
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

const IncidentSchema = z.object({
  trip_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid().optional(),
  incident_type: z.enum(['breakdown', 'accident', 'delay', 'sos', 'other']),
  notes: z.string().trim().max(2000).optional(),
})

router.post('/incidents', requirePermissionV2('transport.mark_boarding'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = IncidentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: incident, error } = await supabase.from('transport_incidents')
      .insert({ school_id, reported_by: req.user!.id, ...parsed.data })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    // Every incident pages dispatch (transport.manage_trips holders) —
    // an SOS is exactly as urgent as a breakdown/accident report from
    // whoever is actually on the vehicle, just self-reported instead of
    // radioed in. No separate escalation tier yet (Phase 5 territory
    // once there's a real dispatch/on-call concept).
    const recipients = await getUserIdsWithPermission(school_id, 'transport.manage_trips')
    if (recipients.length) {
      const urgent = parsed.data.incident_type === 'sos'
      await createNotifications(recipients, {
        schoolId: school_id,
        type: 'transport_incident_reported',
        title: urgent ? 'SOS raised on a transport trip' : `Transport incident: ${parsed.data.incident_type}`,
        message: parsed.data.notes ?? 'No further details provided.',
        link: '/transport/trips', relatedEntityType: 'transport_incident', relatedEntityId: incident.id,
      })
    }

    res.json({ success: true, data: incident })
  })
)

const ResolveIncidentSchema = z.object({ notes: z.string().trim().max(2000).optional() })

router.patch('/incidents/:id/resolve', requirePermissionV2('transport.manage_trips'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = ResolveIncidentSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase.from('transport_incidents')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), notes: parsed.data.notes })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Incident not found' })
    res.json({ success: true, data })
  })
)

export default router
