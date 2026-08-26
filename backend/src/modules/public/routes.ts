// Public, unauthenticated routes — the one part of this app anyone on the
// internet can reach without logging in. Deliberately its own module, not
// folded into admission/routes.ts: that router applies `authenticate` to
// everything in the file before a single route is declared, so a public
// route can't live there without restructuring it. Every route here must
// independently validate school_id (there is no req.user to derive it
// from) and treat all input as hostile.
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { nextDocumentNumber } from '../../shared/utils/documentNumbers'
import { asyncHandler } from '../../shared/utils/helpers'
import { checkAdmissionCycleOpen } from '../admission/routes'

const router = Router()

async function getCurrentAcademicYear(schoolId: string) {
  const { data } = await supabase
    .from('academic_years')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_current', true)
    .maybeSingle()
  return data
}

// GET /public/schools/:schoolId/admission-info — one combined call so the
// public form isn't making three separate round trips: which classes exist,
// and whether admission is even open right now for this school's current
// academic year. Cycle state is derived the same way checkAdmissionCycleOpen
// derives it, just returned as structured state instead of a block/allow
// string, since the form wants to show this proactively, not just discover
// it when a submission fails.
router.get('/schools/:schoolId/admission-info', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId } = req.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(schoolId)) {
    return res.status(404).json({ success: false, error: 'Admission form not found for this link.' })
  }

  const { data: school } = await supabase.from('schools').select('id, name').eq('id', schoolId).maybeSingle()
  if (!school) return res.status(404).json({ success: false, error: 'Admission form not found for this link.' })

  const [{ data: classes }, currentYear] = await Promise.all([
    supabase.from('classes').select('id, name, numeric_level').eq('school_id', schoolId).order('numeric_level'),
    getCurrentAcademicYear(schoolId),
  ])

  let cycle: { state: 'open' | 'not_open' | 'closed'; opens_at: string | null; closes_at: string | null } = {
    state: 'open', opens_at: null, closes_at: null,
  }
  if (currentYear) {
    const { data: cycleRow } = await supabase
      .from('admission_cycles' as any)
      .select('opens_at, closes_at')
      .eq('school_id', schoolId).eq('academic_year_id', currentYear.id)
      .maybeSingle()
    if (cycleRow) {
      const now = new Date()
      const opensAt = (cycleRow as any).opens_at ? new Date((cycleRow as any).opens_at) : null
      const closesAt = (cycleRow as any).closes_at ? new Date((cycleRow as any).closes_at) : null
      let state: 'open' | 'not_open' | 'closed' = 'open'
      if (opensAt && now < opensAt) state = 'not_open'
      else if (closesAt && now > closesAt) state = 'closed'
      cycle = { state, opens_at: (cycleRow as any).opens_at, closes_at: (cycleRow as any).closes_at }
    }
  }

  res.json({
    success: true,
    data: {
      school_name: school.name,
      classes: classes ?? [],
      cycle,
    },
  })
}))

const PublicInquirySchema = z.object({
  student_name: z.string().trim().min(1).max(200),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  parent_name: z.string().trim().min(1).max(200),
  parent_phone: z.string().trim().min(6).max(20),
  parent_email: z.string().trim().email().optional().or(z.literal('')),
  applying_for_class_id: z.string().uuid().optional(),
  previous_school: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  // Honeypot — a real visitor never sees or fills this field (hidden via
  // CSS on the form); a bot that fills every input finds it. Never
  // rendered as an error to the caller, so a scripted submitter has
  // nothing to learn from and can't adapt.
  company: z.string().optional(),
})

// POST /public/schools/:schoolId/inquiries — the actual entry point. A
// candidate created here lands at status 'new', same as one a counselor
// types in by hand — everything downstream (follow-up, documents,
// entrance test, approval, fee, admission) already treats every inquiry
// the same regardless of how it was created.
router.post('/schools/:schoolId/inquiries', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId } = req.params
  const { data: school } = await supabase.from('schools').select('id').eq('id', schoolId).maybeSingle()
  if (!school) return res.status(404).json({ success: false, error: 'Admission form not found for this link.' })

  const body = PublicInquirySchema.parse(req.body)

  if (body.company && body.company.trim()) {
    // Spam signal — pretend success, write nothing.
    return res.json({ success: true, inquiry_number: null })
  }

  if (body.applying_for_class_id) {
    const { data: cls } = await supabase
      .from('classes').select('id').eq('id', body.applying_for_class_id).eq('school_id', schoolId).maybeSingle()
    if (!cls) return res.status(400).json({ success: false, error: 'Invalid class selected.' })
  }

  const currentYear = await getCurrentAcademicYear(schoolId)
  const cycleProblem = currentYear ? await checkAdmissionCycleOpen(schoolId, currentYear.id) : null
  if (cycleProblem) return res.status(400).json({ success: false, error: cycleProblem })

  // Find-or-create the school's "QR Code" source, rather than requiring a
  // backfill migration for schools registered before this feature existed.
  let { data: source } = await supabase
    .from('inquiry_sources').select('id').eq('school_id', schoolId).eq('name', 'QR Code').maybeSingle()
  if (!source) {
    const { data: created } = await supabase
      .from('inquiry_sources').insert({ school_id: schoolId, name: 'QR Code' }).select('id').single()
    source = created
  }

  const inquiryNumber = await nextDocumentNumber(schoolId, 'INQ')
  const { data: created, error } = await supabase.from('admission_inquiries').insert({
    school_id: schoolId,
    inquiry_number: inquiryNumber,
    student_name: body.student_name,
    date_of_birth: body.date_of_birth || null,
    gender: body.gender || null,
    parent_name: body.parent_name,
    parent_phone: body.parent_phone,
    parent_email: body.parent_email || null,
    applying_for_class_id: body.applying_for_class_id || null,
    academic_year_id: currentYear?.id ?? null,
    previous_school: body.previous_school || null,
    notes: body.notes || null,
    source_id: source?.id ?? null,
    status: 'new',
  }).select('id').single()
  if (error) return res.status(400).json({ success: false, error: 'Could not submit — please try again.' })

  // remaining-work-plan.md Section B1: the inquiry's own id doubles as its
  // status-link token — it's already a v4 UUID (122 bits of randomness),
  // never otherwise disclosed (only inquiry_number, a sequential
  // human-readable string, was ever shown before this), and reusing it
  // avoids a second column/table just to mint a bearer token that would
  // carry the exact same trust properties. Same "unguessable link, no
  // login" model as a calendar invite or an exam hall-ticket link — a
  // deliberate choice, not a placeholder for real parent auth (see B1's
  // own note on a full parent account being a separate, bigger initiative).
  res.status(201).json({ success: true, inquiry_number: inquiryNumber, inquiry_id: created!.id })
}))

const STATUS_COPY: Record<string, { label: string; description: string }> = {
  new: { label: 'Received', description: "We've received your inquiry — a counselor will follow up soon." },
  follow_up: { label: 'In Follow-Up', description: 'The school is following up with you on this inquiry.' },
  interested: { label: 'In Progress', description: "You've expressed interest — next steps will follow shortly." },
  documents_submitted: { label: 'Documents Submitted', description: 'Documents are being reviewed by the school.' },
  entrance_exam: { label: 'Entrance Test', description: 'An entrance test or interview is scheduled or pending.' },
  approved: { label: 'Approved', description: 'Your application has been approved and is moving forward.' },
  waitlisted: { label: 'Waitlisted', description: "You're on the waitlist — you'll be notified if a seat opens up." },
  fee_pending: { label: 'Admission Fee Pending', description: 'Approved! Please contact the school to complete the admission fee.' },
  admitted: { label: 'Admitted', description: 'Congratulations — the admission is confirmed!' },
  rejected: { label: 'Not Selected', description: 'This application was not selected this time.' },
  lost: { label: 'Closed', description: 'This inquiry is now closed.' },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /public/schools/:schoolId/inquiries/:inquiryId/status — the
// parent-facing status view. Reuses admission_inquiries.status directly:
// it's already the authoritative, mirrored-from-the-application status for
// the whole journey (see the 2026-08-21 "Fee sequencing rework" follow-up
// fix in admission/plan.md), so this never needs to separately reconcile
// inquiry vs. application state the way some internal views historically
// had to before that fix.
router.get('/schools/:schoolId/inquiries/:inquiryId/status', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId, inquiryId } = req.params
  if (!UUID_RE.test(schoolId) || !UUID_RE.test(inquiryId)) {
    return res.status(404).json({ success: false, error: 'Status link not found.' })
  }

  const { data: inquiry } = await supabase
    .from('admission_inquiries')
    .select('id, student_name, inquiry_number, status, applying_for_class_id')
    .eq('id', inquiryId).eq('school_id', schoolId).maybeSingle()
  if (!inquiry) return res.status(404).json({ success: false, error: 'Status link not found.' })

  const { data: application } = await supabase
    .from('admission_applications')
    .select('id, application_number, applying_for_class_id')
    .eq('inquiry_id', inquiryId).eq('school_id', schoolId).maybeSingle()

  const classId = (application as any)?.applying_for_class_id ?? inquiry.applying_for_class_id

  // remaining-work-plan.md follow-up (2026-08-26): documents can now
  // attach to the inquiry directly (application_documents.inquiry_id),
  // so this no longer waits on an application existing — a parent can see
  // and start satisfying the checklist right after their first inquiry,
  // not only after staff (or the school's own conversion prerequisites)
  // move them into a formal application.
  let documents: { document_type: string; uploaded: boolean; verified: boolean }[] = []
  if (classId) {
    const uploadedFilter = application
      ? `inquiry_id.eq.${inquiryId},application_id.eq.${(application as any).id}`
      : `inquiry_id.eq.${inquiryId}`
    const [{ data: required }, { data: uploaded }] = await Promise.all([
      supabase.from('admission_document_requirements' as any).select('document_type').eq('school_id', schoolId).eq('class_id', classId),
      supabase.from('application_documents').select('document_type, is_verified').or(uploadedFilter).is('deleted_at', null),
    ])
    const uploadedByType = new Map((uploaded ?? []).map((d: any) => [d.document_type, d.is_verified]))
    documents = (required ?? []).map((r: any) => ({
      document_type: r.document_type,
      uploaded: uploadedByType.has(r.document_type),
      verified: uploadedByType.get(r.document_type) === true,
    }))
  }

  const copy = STATUS_COPY[inquiry.status] ?? { label: inquiry.status, description: '' }

  res.json({
    success: true,
    data: {
      student_name: inquiry.student_name,
      inquiry_number: inquiry.inquiry_number,
      application_number: (application as any)?.application_number ?? null,
      status: inquiry.status,
      status_label: copy.label,
      status_description: copy.description,
      can_upload_documents: true,
      documents,
    },
  })
}))

const PublicDocumentSchema = z.object({
  file_base64: z.string().min(1),
  file_name: z.string().trim().min(1).max(300),
  mime_type: z.string().optional(),
  document_type: z.string().trim().min(1).max(100),
})

// POST /public/schools/:schoolId/inquiries/:inquiryId/documents — lets a
// parent fill a gap in the document checklist without calling the school.
// Same base64-in-JSON upload pattern and storage bucket
// (POST /applications/:id/documents, admission/routes.ts) — deliberately
// NOT a second upload mechanism. Always lands unverified: a parent
// uploading their own document is exactly the case document verification
// exists to check, same as any staff-side upload.
//
// remaining-work-plan.md follow-up (2026-08-26): previously required an
// application to already exist — now uploads against the application if
// one exists (unchanged, tested behavior), or directly against the
// inquiry if not (application_documents.inquiry_id, added specifically
// so a parent can start satisfying the checklist right after submitting
// their inquiry, before staff or the school's own conversion
// prerequisites move them into a formal application).
router.post('/schools/:schoolId/inquiries/:inquiryId/documents', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId, inquiryId } = req.params
  if (!UUID_RE.test(schoolId) || !UUID_RE.test(inquiryId)) {
    return res.status(404).json({ success: false, error: 'Status link not found.' })
  }

  const { data: inquiry } = await supabase
    .from('admission_inquiries').select('id').eq('id', inquiryId).eq('school_id', schoolId).maybeSingle()
  if (!inquiry) return res.status(404).json({ success: false, error: 'Status link not found.' })

  const { data: application } = await supabase
    .from('admission_applications').select('id').eq('inquiry_id', inquiryId).eq('school_id', schoolId).maybeSingle()

  const body = PublicDocumentSchema.parse(req.body)
  const base64Data = body.file_base64.replace(/^data:[\w/+.-]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  if (buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: 'File is too large (10 MB limit).' })
  }
  const subjectPath = application ? application.id : `inquiry-${inquiryId}`
  const filePath = `${schoolId}/${subjectPath}/${Date.now()}_${body.file_name}`

  const { error: uploadErr } = await supabase.storage
    .from('admission-documents')
    .upload(filePath, buffer, { contentType: body.mime_type ?? 'application/octet-stream', upsert: false })
  if (uploadErr) return res.status(400).json({ success: false, error: 'Upload failed — please try again.' })

  const { data: urlData } = supabase.storage.from('admission-documents').getPublicUrl(filePath)

  const { error } = await supabase.from('application_documents').insert({
    application_id: application?.id ?? null,
    inquiry_id: application ? null : inquiryId,
    school_id: schoolId,
    document_type: body.document_type,
    document_name: body.file_name,
    file_url: urlData.publicUrl,
    mime_type: body.mime_type ?? null,
    file_size: `${(buffer.length / 1024).toFixed(0)} KB`,
    is_verified: false,
  })
  if (error) return res.status(400).json({ success: false, error: 'Could not save the document — please try again.' })

  res.status(201).json({ success: true })
}))

// ── remaining-work-plan.md Section B3: parent-facing slot self-booking ──
// Extends the B1 status page rather than a separate single-purpose page —
// B1 already built exactly the "scoped, parent-reachable surface" B3's own
// scoping note said this could ship narrower with.
//
// Strictly class-filtered, same as the staff-side booking dropdown
// (SlotBookingCard.tsx / GET /admission-slots?class_id=): a class-agnostic
// slot (no class_id set) is never offered here either — the "no cross-class
// booking mistakes" fix from earlier this project applies just as much to a
// parent self-booking as to a counselor booking on their behalf.
router.get('/schools/:schoolId/inquiries/:inquiryId/slots', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId, inquiryId } = req.params
  if (!UUID_RE.test(schoolId) || !UUID_RE.test(inquiryId)) {
    return res.status(404).json({ success: false, error: 'Status link not found.' })
  }

  const { data: inquiry } = await supabase
    .from('admission_inquiries').select('id, applying_for_class_id').eq('id', inquiryId).eq('school_id', schoolId).maybeSingle()
  if (!inquiry) return res.status(404).json({ success: false, error: 'Status link not found.' })
  if (!inquiry.applying_for_class_id) return res.json({ success: true, data: [] })

  const { data: application } = await supabase
    .from('admission_applications').select('id').eq('inquiry_id', inquiryId).eq('school_id', schoolId).maybeSingle()

  const [{ data: slots }, { data: bookings }] = await Promise.all([
    supabase.from('admission_slots' as any)
      .select('id, slot_type, title, location, starts_at, ends_at, capacity')
      .eq('school_id', schoolId).eq('class_id', inquiry.applying_for_class_id)
      .gte('starts_at', new Date().toISOString())
      .order('starts_at'),
    supabase.from('admission_slot_bookings' as any)
      .select('slot_id, status')
      .eq('school_id', schoolId)
      .or(`inquiry_id.eq.${inquiryId}${application ? `,application_id.eq.${application.id}` : ''}`),
  ])

  const myBookedSlotIds = new Set(((bookings ?? []) as any[]).filter(b => b.status !== 'cancelled').map(b => b.slot_id))
  const activeCountBySlot = new Map<string, number>()
  if ((slots ?? []).length) {
    const { data: allBookings } = await supabase
      .from('admission_slot_bookings' as any)
      .select('slot_id, status')
      .in('slot_id', (slots as any[]).map(s => s.id))
    for (const b of (allBookings ?? []) as any[]) {
      if (b.status === 'cancelled') continue
      activeCountBySlot.set(b.slot_id, (activeCountBySlot.get(b.slot_id) ?? 0) + 1)
    }
  }

  const data = ((slots ?? []) as any[]).map(s => ({
    id: s.id,
    slot_type: s.slot_type,
    title: s.title,
    location: s.location,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    full: s.capacity != null && (activeCountBySlot.get(s.id) ?? 0) >= s.capacity,
    already_booked: myBookedSlotIds.has(s.id),
  }))

  res.json({ success: true, data })
}))

router.post('/schools/:schoolId/inquiries/:inquiryId/slots/:slotId/book', asyncHandler(async (req: Request, res: Response) => {
  const { schoolId, inquiryId, slotId } = req.params
  if (!UUID_RE.test(schoolId) || !UUID_RE.test(inquiryId) || !UUID_RE.test(slotId)) {
    return res.status(404).json({ success: false, error: 'Status link not found.' })
  }

  const { data: inquiry } = await supabase
    .from('admission_inquiries').select('id, status, applying_for_class_id').eq('id', inquiryId).eq('school_id', schoolId).maybeSingle()
  if (!inquiry) return res.status(404).json({ success: false, error: 'Status link not found.' })

  const { data: application } = await supabase
    .from('admission_applications').select('id').eq('inquiry_id', inquiryId).eq('school_id', schoolId).maybeSingle()

  const { data: slot } = await supabase
    .from('admission_slots' as any).select('id, slot_type, capacity, class_id')
    .eq('id', slotId).eq('school_id', schoolId).maybeSingle()
  if (!slot || (slot as any).class_id !== inquiry.applying_for_class_id) {
    return res.status(404).json({ success: false, error: 'This slot is not available for your application.' })
  }

  // Same capacity enforcement as the staff-side POST /admission-slots/:id/book
  // (admission/routes.ts) — not just displayed, actually checked here too.
  const { data: existingForSlot } = await supabase
    .from('admission_slot_bookings' as any).select('id, status, inquiry_id, application_id').eq('slot_id', slotId)
  const activeExisting = ((existingForSlot ?? []) as any[]).filter(b => b.status !== 'cancelled')

  // No unique constraint on (slot_id, inquiry_id) to lean on — checked
  // explicitly, since a parent double-clicking "Book" is a more likely
  // accident than a staff member doing the same on the authenticated
  // equivalent (which has this same gap, unaddressed there too).
  if (activeExisting.some(b => b.inquiry_id === inquiryId || (application && b.application_id === application.id))) {
    return res.status(400).json({ success: false, error: 'You already have a booking for this slot.' })
  }
  if ((slot as any).capacity != null && activeExisting.length >= (slot as any).capacity) {
    return res.status(400).json({ success: false, error: 'This slot is fully booked — please choose another.' })
  }

  const { error } = await supabase.from('admission_slot_bookings' as any).insert({
    slot_id: slotId,
    school_id: schoolId,
    inquiry_id: inquiryId,
    application_id: application?.id ?? null,
  })
  if (error) return res.status(400).json({ success: false, error: 'Could not book this slot — please try again.' })

  // Same status-advance side effect as the staff-side endpoint — never
  // regresses an inquiry already further along.
  if ((slot as any).slot_type === 'entrance_exam' && ['new', 'follow_up', 'interested'].includes(inquiry.status)) {
    await supabase.from('admission_inquiries').update({ status: 'entrance_exam' }).eq('id', inquiryId)
  }

  res.status(201).json({ success: true })
}))

export default router
