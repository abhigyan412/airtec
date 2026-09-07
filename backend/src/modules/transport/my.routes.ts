import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, NON_STAFF_ROLES, resolveOwnStudentId } from '../../shared/utils/helpers'

const router = Router()

// GET /transport/my/status — the one endpoint a parent/student login
// polls for "where is my bus." Deliberately NOT gated by
// requirePermissionV2('transport.view') — that permission is granted to
// STAFF roles (Transport Manager, Principal, ...) and would either 403
// every parent (Parent/Student aren't granted it) or, if granted
// broadly, leak the whole fleet/roster/every-other-family's-child to
// every parent. Scoped instead the same way GET /students/me is:
// resolve the caller's own student via resolveOwnStudentId and return
// only that student's own assignment/trip/location.
router.get('/status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const school_id = req.user!.school_id
  if (!NON_STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'This endpoint is for parent/student accounts' })
  }
  const studentId = await resolveOwnStudentId(req.user!.id, req.user!.role, school_id)
  if (!studentId) return res.status(404).json({ success: false, error: 'No student record is linked to this account yet' })

  const { data: assignment } = await supabase
    .from('student_transport_assignments')
    .select('route_id, stop_id, direction, routes(name), stops(name)')
    .eq('student_id', studentId).eq('school_id', school_id).eq('is_active', true)
    .maybeSingle()
  if (!assignment) return res.json({ success: true, data: null })

  const today = new Date().toISOString().slice(0, 10)
  const { data: trips } = await supabase
    .from('vehicle_trips')
    .select('id, shift, status, vehicle_id, vehicles(registration_no)')
    .eq('route_id', assignment.route_id).eq('trip_date', today)
    .order('shift')

  const tripIds = (trips ?? []).map((t: any) => t.id)
  const [{ data: events }, { data: locations }] = await Promise.all([
    tripIds.length
      ? supabase.from('trip_boarding_events').select('trip_id, event, recorded_at').eq('student_id', studentId).in('trip_id', tripIds).order('recorded_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    tripIds.length
      ? supabase.from('vehicle_location_pings').select('trip_id, lat, lng, recorded_at').in('trip_id', tripIds).order('recorded_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ])

  const latestEventByTrip = new Map<string, any>()
  for (const e of (events ?? []) as any[]) if (!latestEventByTrip.has(e.trip_id)) latestEventByTrip.set(e.trip_id, e)
  const latestLocationByTrip = new Map<string, any>()
  for (const l of (locations ?? []) as any[]) if (!latestLocationByTrip.has(l.trip_id)) latestLocationByTrip.set(l.trip_id, l)

  res.json({
    success: true,
    data: {
      route_name: (assignment.routes as any)?.name,
      stop_name: (assignment.stops as any)?.name,
      direction: assignment.direction,
      trips: (trips ?? []).map((t: any) => ({
        id: t.id, shift: t.shift, status: t.status, vehicle_registration_no: t.vehicles?.registration_no,
        latest_event: latestEventByTrip.get(t.id) ?? null,
        latest_location: latestLocationByTrip.get(t.id) ?? null,
      })),
    },
  })
}))

export default router
