'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Loader2, FileCheck2, FileClock, Upload, CheckCircle2, CalendarClock, MapPin } from 'lucide-react'
import { publicAdmissionApi } from '@/lib/publicApi'
import { ADMISSION_DOC_LABELS as DOC_LABELS } from '@/lib/admissionDocumentTypes'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// remaining-work-plan.md Section B1: the parent-facing status view — the
// gap named directly in the competitive comparison ("no way to check
// status, no way to upload a document later without calling the school").
// Public by the same mechanism as /apply/[schoolId] itself (outside
// app/(app)/, no login anywhere). Access model is a deliberately
// unguessable link (the inquiry's own v4 UUID id, never otherwise shown to
// anyone but this parent) rather than a password or account — see the
// backend route's own comment for the full reasoning; a real parent
// account is a separate, bigger initiative this pass didn't build.
//
// DOC_LABELS now comes from lib/admissionDocumentTypes.ts (2026-08-25) —
// previously hand-duplicated here specifically because the staff-side copy
// lived under app/(app)/ and this public page couldn't safely import from
// there. That's no longer a concern: the shared file is pure data with no
// app-tree coupling, so importing it doesn't pull anything unwanted in.

const STATUS_TONE: Record<string, string> = {
  admitted: 'border-success/30 bg-success/10 text-success',
  fee_pending: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  approved: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  waitlisted: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
  lost: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}
const defaultTone = 'border-primary/30 bg-primary/10 text-primary'

export default function PublicApplicationStatusPage() {
  const params = useParams<{ schoolId: string; inquiryId: string }>()
  const { schoolId, inquiryId } = params

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['public-application-status', schoolId, inquiryId],
    queryFn: () => publicAdmissionApi.status(schoolId, inquiryId).then(r => r.data),
    retry: false,
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow-indigo">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-foreground">Application Status</span>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
            <h1 className="text-lg font-bold text-foreground">Status link not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This link doesn&apos;t look right. Please use the link you received after submitting your enquiry.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {data.application_number ?? data.inquiry_number}
              </p>
              <h1 className="mt-1 text-xl font-bold text-foreground">{data.student_name}</h1>
              <div className={`mt-4 inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold ${STATUS_TONE[data.status] ?? defaultTone}`}>
                {data.status_label}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{data.status_description}</p>
            </div>

            {data.can_upload_documents && (
              <DocumentChecklist schoolId={schoolId} inquiryId={inquiryId} documents={data.documents} onChanged={() => refetch()} />
            )}

            <SlotBooking schoolId={schoolId} inquiryId={inquiryId} />
          </div>
        )}
      </div>
    </div>
  )
}

// remaining-work-plan.md Section B3: parent-facing slot self-booking,
// extending this same status page rather than a separate surface — see the
// backend route's own comment for why. Rendered unconditionally (not gated
// on can_upload_documents like the checklist above): a slot can be
// class-scoped from the moment an inquiry is created, before any
// application exists, so there's no equivalent "nothing to show yet" case
// to gate on — an empty list already reads fine on its own.
function SlotBooking({ schoolId, inquiryId }: { schoolId: string; inquiryId: string }) {
  const qc = useQueryClient()
  const [bookingId, setBookingId] = useState<string | null>(null)

  const { data: slots, isLoading } = useQuery({
    queryKey: ['public-slots', schoolId, inquiryId],
    queryFn: () => publicAdmissionApi.slots(schoolId, inquiryId).then(r => r.data),
  })

  const bookMutation = useMutation({
    mutationFn: (slotId: string) => publicAdmissionApi.bookSlot(schoolId, inquiryId, slotId),
    onSuccess: () => {
      toast.success('Slot booked')
      qc.invalidateQueries({ queryKey: ['public-slots', schoolId, inquiryId] })
      qc.invalidateQueries({ queryKey: ['public-application-status'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not book this slot — please try again.'),
    onSettled: () => setBookingId(null),
  })

  if (isLoading || !slots?.length) return null

  const SLOT_TYPE_LABEL: Record<string, string> = { entrance_exam: 'Entrance Test', interview: 'Interview', campus_tour: 'Campus Tour' }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Available Slots</h2>
      <div className="mt-3 space-y-2">
        {slots.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">{s.title} <span className="text-xs font-normal text-muted-foreground">({SLOT_TYPE_LABEL[s.slot_type] ?? s.slot_type})</span></p>
                <p className="text-xs text-muted-foreground">
                  {new Date(s.starts_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  {s.location && <> · <MapPin className="inline h-3 w-3" /> {s.location}</>}
                </p>
              </div>
            </div>
            {s.already_booked ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Booked</span>
            ) : s.full ? (
              <span className="text-xs font-medium text-muted-foreground">Full</span>
            ) : (
              <Button size="sm" variant="outline" disabled={bookingId === s.id}
                onClick={() => { setBookingId(s.id); bookMutation.mutate(s.id) }}>
                {bookingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Book'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function DocumentChecklist({ schoolId, inquiryId, documents, onChanged }: {
  schoolId: string
  inquiryId: string
  documents: { document_type: string; uploaded: boolean; verified: boolean }[]
  onChanged: () => void
}) {
  if (!documents.length) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Required Documents</h2>
      <div className="mt-3 space-y-2">
        {documents.map(doc => (
          <DocumentRow key={doc.document_type} schoolId={schoolId} inquiryId={inquiryId} doc={doc} onUploaded={onChanged} />
        ))}
      </div>
    </div>
  )
}

function DocumentRow({ schoolId, inquiryId, doc, onUploaded }: {
  schoolId: string
  inquiryId: string
  doc: { document_type: string; uploaded: boolean; verified: boolean }
  onUploaded: () => void
}) {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => new Promise<void>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          await publicAdmissionApi.uploadDocument(schoolId, inquiryId, {
            file_base64: reader.result as string,
            file_name: file.name,
            mime_type: file.type,
            document_type: doc.document_type,
          })
          resolve()
        } catch (e) { reject(e) }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    }),
    onSuccess: () => {
      toast.success('Document uploaded')
      qc.invalidateQueries({ queryKey: ['public-application-status'] })
      onUploaded()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Upload failed — please try again.'),
    onSettled: () => setUploading(false),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    uploadMutation.mutate(file)
  }

  const label = DOC_LABELS[doc.document_type] ?? doc.document_type

  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {doc.verified ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : doc.uploaded ? (
          <FileClock className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            {doc.verified ? 'Verified' : doc.uploaded ? 'Uploaded — pending review' : 'Not yet uploaded'}
          </p>
        </div>
      </div>
      {!doc.verified && (
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {doc.uploaded ? 'Replace' : 'Upload'}
          <input type="file" className="hidden" onChange={handleFile} disabled={uploading} accept="image/*,.pdf" />
        </label>
      )}
    </div>
  )
}
