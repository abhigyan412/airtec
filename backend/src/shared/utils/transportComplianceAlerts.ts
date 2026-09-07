import { supabase } from '../db/client'
import { toLocalDateStr } from './academicCalendar'
import { createNotifications } from './notifications'
import { getUserIdsWithPermission } from '../middleware/permissions-v2'

// ── Transport compliance alerts: vehicle/driver documents expiring ──
//
// Same unattended-sweep + manual-trigger shape as hrAlerts.ts, but the
// alert window is NOT a fixed constant — it's transport_settings.
// compliance_alert_lead_days, set per school (defaults to 30 for a
// school with no settings row yet). That's why this loops schools one
// at a time rather than running one cross-school query like hrAlerts
// does for its fixed 30-day window: each school's window is a different
// date. Recipient resolution (transport.manage_fleet holders) and dedup
// both lean on existing mechanisms, same as hrAlerts.
export async function runTransportComplianceAlerts(schoolId?: string) {
  const today = toLocalDateStr(new Date())

  let schoolsQuery = supabase.from('schools').select('id')
  if (schoolId) schoolsQuery = schoolsQuery.eq('id', schoolId)
  const { data: schools } = await schoolsQuery

  let vehicleDocsNotified = 0
  let driverDocsNotified = 0

  for (const school of (schools ?? []) as { id: string }[]) {
    const { data: settings } = await supabase
      .from('transport_settings').select('compliance_alert_lead_days')
      .eq('school_id', school.id).maybeSingle()
    const leadDays = settings?.compliance_alert_lead_days ?? 30
    const windowEnd = toLocalDateStr(new Date(Date.now() + leadDays * 24 * 60 * 60 * 1000))

    const recipients = await getUserIdsWithPermission(school.id, 'transport.manage_fleet')
    if (!recipients.length) continue

    const { data: vDocs } = await supabase
      .from('vehicle_documents')
      .select('id, doc_type, document_no, expiry_date, vehicles!inner(school_id, registration_no)')
      .eq('vehicles.school_id', school.id)
      .not('expiry_date', 'is', null).lte('expiry_date', windowEnd)

    for (const doc of (vDocs ?? []) as any[]) {
      const overdue = doc.expiry_date < today
      await createNotifications(recipients, {
        schoolId: school.id, type: 'transport_document_expiring',
        title: overdue ? 'Vehicle document expired' : 'Vehicle document expiring soon',
        message: `${doc.vehicles.registration_no}'s ${doc.doc_type.replace('_', ' ')} ${overdue ? 'expired' : 'expires'} on ${doc.expiry_date}.`,
        link: '/transport/fleet', relatedEntityType: 'vehicle_document', relatedEntityId: doc.id,
      })
      vehicleDocsNotified++
    }

    const { data: dDocs } = await supabase
      .from('driver_documents')
      .select('id, doc_type, document_no, expiry_date, drivers!inner(school_id, full_name)')
      .eq('drivers.school_id', school.id)
      .not('expiry_date', 'is', null).lte('expiry_date', windowEnd)

    for (const doc of (dDocs ?? []) as any[]) {
      const overdue = doc.expiry_date < today
      await createNotifications(recipients, {
        schoolId: school.id, type: 'transport_document_expiring',
        title: overdue ? 'Driver document expired' : 'Driver document expiring soon',
        message: `${doc.drivers.full_name}'s ${doc.doc_type.replace('_', ' ')} ${overdue ? 'expired' : 'expires'} on ${doc.expiry_date}.`,
        link: '/transport/fleet', relatedEntityType: 'driver_document', relatedEntityId: doc.id,
      })
      driverDocsNotified++
    }

    // Service-due: only the MOST RECENT service record per vehicle is
    // the live outstanding due date — an earlier record's
    // next_service_due_date is superseded the moment a later service
    // happens, even one that hasn't set its own next-due date yet.
    // Fetched ordered by service_date desc and reduced to one row per
    // vehicle in JS since Supabase's client has no DISTINCT ON.
    const { data: serviceRecords } = await supabase
      .from('vehicle_service_records')
      .select('id, vehicle_id, service_date, next_service_due_date, vehicles!inner(school_id, registration_no)')
      .eq('vehicles.school_id', school.id)
      .order('service_date', { ascending: false })

    const latestByVehicle = new Map<string, any>()
    for (const rec of (serviceRecords ?? []) as any[]) {
      if (!latestByVehicle.has(rec.vehicle_id)) latestByVehicle.set(rec.vehicle_id, rec)
    }

    for (const rec of latestByVehicle.values()) {
      if (!rec.next_service_due_date || rec.next_service_due_date > windowEnd) continue
      const overdue = rec.next_service_due_date < today
      await createNotifications(recipients, {
        schoolId: school.id, type: 'transport_service_due',
        title: overdue ? 'Vehicle service overdue' : 'Vehicle service due soon',
        message: `${rec.vehicles.registration_no}'s next service ${overdue ? 'was due' : 'is due'} on ${rec.next_service_due_date}.`,
        link: '/transport/fleet', relatedEntityType: 'vehicle_service_record', relatedEntityId: rec.id,
      })
      vehicleDocsNotified++
    }
  }

  return { vehicleDocsNotified, driverDocsNotified }
}
