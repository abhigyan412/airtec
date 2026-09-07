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
  }

  return { vehicleDocsNotified, driverDocsNotified }
}
