'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi, documentsApi } from '@/lib/api'
import { WorkflowPipeline } from '@/components/admission/WorkflowPipeline'
import { formatDate, admissionApplicationStatusBadge, cn, classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ADMISSION_DOC_TYPES as DOC_TYPES } from '@/lib/admissionDocumentTypes'
import {
  ArrowLeft, Phone, User, ClipboardList, FileText, Upload, Eye, Trash2,
  CheckCircle, XCircle, Wallet, Award, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SlotBookingCard } from '@/components/admission/SlotBookingCard'
import { ParentStatusLinkCard } from '@/components/admission/ParentStatusLinkCard'


const FEE_METHODS = [
  { value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }, { value: 'neft', label: 'NEFT' },
  { value: 'card', label: 'Card' }, { value: 'upi', label: 'UPI' }, { value: 'online', label: 'Online' },
  { value: 'dd', label: 'DD' }, { value: 'wallet', label: 'Wallet' },
]

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const classStyle = useClassDisplayStyle()

  const { data: app, isLoading } = useQuery({
    queryKey: ['admission-application', id],
    queryFn: () => admissionApi.applications.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[220px] w-full rounded-2xl" />
        <Skeleton className="h-[260px] w-full rounded-2xl" />
      </div>
    )
  }

  if (!app) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Application not found"
        description="This application may have been deleted, or the link is out of date."
        action={
          <Button variant="outline" asChild>
            <Link href="/admission/applications">
              <ArrowLeft className="w-4 h-4" /> Back to Applications
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <Button variant="ghost" size="sm" asChild className="-ml-3 -mb-2 text-muted-foreground">
        <Link href="/admission/applications">
          <ArrowLeft className="w-4 h-4" /> Back to Applications
        </Link>
      </Button>
      <PageHeader
        title={`${app.student_first_name} ${app.student_last_name}`}
        description={`${app.application_number} · Submitted ${formatDate(app.created_at)}`}
        icon={ClipboardList}
        actions={(() => {
          const badge = admissionApplicationStatusBadge(app)
          return <Badge variant={badge.variant}>{badge.label}</Badge>
        })()}
      />

      {/* Basic details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> Application Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Father's Phone</p>
              <p className="text-sm font-medium text-foreground flex items-center gap-1">
                <Phone className="w-3 h-3 text-muted-foreground" /> {app.father_phone}
              </p>
            </div>
            {app.father_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Father's Name</p>
                <p className="text-sm font-medium text-foreground">{app.father_name}</p>
              </div>
            )}
            {app.mother_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Mother's Name</p>
                <p className="text-sm font-medium text-foreground">{app.mother_name}</p>
              </div>
            )}
            {app.classes?.name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Applying for Class</p>
                <p className="text-sm font-medium text-foreground">{classLabel(app.classes.name, app.classes.numeric_level, classStyle)}</p>
              </div>
            )}
            {app.users?.full_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Assigned Counselor</p>
                <p className="text-sm font-medium text-foreground">{app.users.full_name}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Workflow approval pipeline */}
      <WorkflowPipeline applicationId={app.id} />

      <DocumentsCard applicationId={app.id} />
      <FeeCard app={app} />
      <OfferLetterCard app={app} />
      {app.inquiry_id && <ParentStatusLinkCard schoolId={app.school_id} inquiryId={app.inquiry_id} />}
      <SlotBookingCard applicationId={app.id} classId={app.applying_for_class_id} alsoInquiryId={app.inquiry_id ?? undefined} />
    </div>
  )
}

function DocumentsCard({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient()
  const [showUpload, setShowUpload] = useState(false)

  const { data: docs, isLoading } = useQuery({
    queryKey: ['admission-application-documents', applicationId],
    queryFn: () => admissionApi.applications.documents.list(applicationId).then(r => r.data),
  })

  const verifyMutation = useMutation({
    mutationFn: ({ docId, is_verified }: { docId: string; is_verified: boolean }) =>
      admissionApi.applications.documents.verify(applicationId, docId, is_verified),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-application-documents', applicationId] })
      toast.success('Document updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update document'),
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => admissionApi.applications.documents.delete(applicationId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-application-documents', applicationId] })
      toast.success('Document removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove document'),
  })

  return (
    <Card>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> Documents ({(docs ?? []).length})
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setShowUpload(true)} className="text-primary hover:text-primary">
          <Upload className="w-4 h-4" /> Upload
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-3 p-6">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
      ) : !(docs ?? []).length ? (
        <EmptyState icon={FileText} title="No documents uploaded yet" description="Upload birth certificate, marksheets, and more" className="py-8" />
      ) : (
        <div className="divide-y divide-border">
          {(docs ?? []).map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-4 px-6 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">{doc.document_name}</p>
                  <Badge className="border-transparent bg-primary/10 text-primary whitespace-nowrap">
                    {DOC_TYPES.find(t => t.value === doc.document_type)?.label ?? doc.document_type}
                  </Badge>
                  {doc.is_verified ? (
                    <Badge variant="success">Verified</Badge>
                  ) : (
                    <Badge variant="warning">Pending Review</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(doc.created_at)}{doc.users?.full_name && <> · uploaded by {doc.users.full_name}</>}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" title="View">
                  <a href={doc.file_url} target="_blank" rel="noreferrer" aria-label="View document"><Eye className="h-4 w-4" /></a>
                </Button>
                {!doc.is_verified ? (
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-success" title="Verify"
                    onClick={() => verifyMutation.mutate({ docId: doc.id, is_verified: true })}>
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-warning" title="Unverify"
                    onClick={() => verifyMutation.mutate({ docId: doc.id, is_verified: false })}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="Delete"
                  onClick={() => { if (confirm('Delete this document?')) deleteMutation.mutate(doc.id) }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showUpload && (
        <DocumentUploadModal applicationId={applicationId} onClose={() => {
          setShowUpload(false)
          qc.invalidateQueries({ queryKey: ['admission-application-documents', applicationId] })
        }} />
      )}
    </Card>
  )
}

function DocumentUploadModal({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const [form, setForm] = useState({ document_type: 'birth_certificate', document_name: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!file) return toast.error('Please select a file')
    if (!form.document_name) return toast.error('Please enter a document name')
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          await admissionApi.applications.documents.upload(applicationId, {
            file_base64: reader.result,
            file_name: file.name,
            mime_type: file.type,
            ...form,
          })
          toast.success('Document uploaded!')
          onClose()
        } catch (e: any) {
          toast.error(e?.response?.data?.error ?? 'Upload failed')
        } finally {
          setUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch {
      setUploading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={form.document_type} onValueChange={v => setForm(f => ({ ...f, document_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-name">Document Name *</Label>
            <Input id="doc-name" value={form.document_name}
              onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))}
              placeholder="e.g. Birth Certificate" />
          </div>
          <div className="space-y-1.5">
            <Label>File *</Label>
            <div
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                file ? 'border-primary bg-primary/10' : 'border-input hover:border-primary hover:bg-muted/50'
              )}>
              {file ? (
                <div>
                  <p className="text-sm font-medium text-primary">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Click to select file</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">PDF, JPG, PNG up to 10MB</p>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-notes">Notes (optional)</Label>
            <Input id="doc-notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</> : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FeeCard({ app }: { app: any }) {
  const qc = useQueryClient()
  const [showCollect, setShowCollect] = useState(false)
  const [showExtend, setShowExtend] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-muted-foreground" /> Admission Fee
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* fee_paid_at, not the legacy application_fee_paid boolean — found
            live 2026-08-26 while verifying the Extend Hold UI: two real
            fee_pending seed applications had application_fee_paid=true with
            status still 'fee_pending' and fee_paid_at null (fee never
            actually collected through the real flow), so this card showed
            "Paid" for an application that plainly wasn't. Same class of bug
            already documented and fixed once for the status badge itself
            (see plan.md's "Fee sequencing rework" follow-up) — status/
            fee_paid_at are authoritative post-rework, the older boolean can
            disagree on seed data created before or outside that flow. */}
        {app.fee_paid_at ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Amount</p>
              <p className="text-sm font-medium text-foreground">₹{Number(app.application_fee_amount ?? 0).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Method</p>
              <p className="text-sm font-medium text-foreground capitalize">{app.fee_payment_method ?? '—'}</p>
            </div>
            {app.fee_payment_reference && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Reference</p>
                <p className="text-sm font-medium text-foreground">{app.fee_payment_reference}</p>
              </div>
            )}
            {app.fee_paid_at && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Collected</p>
                <p className="text-sm font-medium text-foreground">{formatDate(app.fee_paid_at)}</p>
              </div>
            )}
            <Badge variant="success" className="w-fit">Paid</Badge>
          </div>
        ) : app.status === 'fee_pending' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Approved — the seat is reserved and awaiting fee payment.</p>
              <Button size="sm" onClick={() => setShowCollect(true)}>Collect Fee</Button>
            </div>
            {app.fee_hold_deadline && (
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Seat hold expires <span className="font-medium text-foreground">{formatDate(app.fee_hold_deadline)}</span> — the seat auto-releases if unpaid by then.
                  </p>
                  {app.fee_hold_extended_at && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Extended {formatDate(app.fee_hold_extended_at)}{app.fee_hold_extension_reason ? ` — ${app.fee_hold_extension_reason}` : ''}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setShowExtend(true)}>Extend Hold</Button>
              </div>
            )}
          </div>
        ) : app.status === 'rejected' ? (
          <p className="text-sm text-muted-foreground">This application was rejected — no fee is due.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not yet payable — the admission fee opens up once the Counselor → Principal → Admin approval chain is complete.
          </p>
        )}
      </CardContent>
      {showCollect && (
        <CollectFeeModal applicationId={app.id} classId={app.applying_for_class_id} onClose={() => {
          setShowCollect(false)
          qc.invalidateQueries({ queryKey: ['admission-application', app.id] })
        }} />
      )}
      {showExtend && (
        <ExtendFeeHoldModal applicationId={app.id} onClose={() => {
          setShowExtend(false)
          qc.invalidateQueries({ queryKey: ['admission-application', app.id] })
        }} />
      )}
    </Card>
  )
}

// remaining-work-plan.md follow-up (2026-08-26): POST
// /applications/:id/extend-fee-hold has existed since Phase 3 shipped —
// School Admin/Principal manually push out a specific application's seat
// hold before it auto-releases — but had no `lib/api.ts` wrapper and no UI
// anywhere, the same class of "built but unreachable" gap the parent
// status link had. Deliberately not client-side role-gated: this file
// doesn't role-gate any of its other actions either (Collect Fee, offer
// letter issuance) — the backend's own requireRole('school_admin',
// 'principal') is the real enforcement; an unauthorized click just
// surfaces a clean error toast, same as everywhere else here.
function ExtendFeeHoldModal({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const [days, setDays] = useState('3')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const n = Number(days)
    if (!Number.isInteger(n) || n <= 0) {
      toast.error('Enter a positive whole number of days')
      return
    }
    setSaving(true)
    try {
      await admissionApi.applications.extendFeeHold(applicationId, { days: n, reason: reason.trim() || undefined })
      toast.success(`Fee hold extended by ${n} day${n === 1 ? '' : 's'}`)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to extend the fee hold')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Extend Fee Hold</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="extend-days">Extend by (days)</Label>
            <Input id="extend-days" type="number" min={1} value={days} onChange={e => setDays(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="extend-reason">Reason (optional)</Label>
            <Input id="extend-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Parent traveling, requested more time" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Extend'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CollectFeeModal({ applicationId, classId, onClose }: { applicationId: string; classId?: string; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  // Pre-fills from the class's configured admission fee (Slots page ->
  // Entrance Mode & Admission Fee by Class) so staff don't have to type
  // in the same figure every time — still freely editable per-application
  // for a scholarship or sibling discount.
  const { data: classSettings } = useQuery({
    queryKey: ['admission-class-settings'],
    queryFn: () => admissionApi.classSettings.list().then(r => r.data),
  })
  const configuredFee = classSettings?.find((s: any) => s.class_id === classId)?.admission_fee_amount
  useEffect(() => {
    if (configuredFee != null && !amountTouched) setAmount(String(configuredFee))
  }, [configuredFee, amountTouched])

  const handleSave = async () => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      await admissionApi.applications.collectFee(applicationId, { amount: n, method, reference: reference.trim() || undefined })
      toast.success('Fee collected')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to collect fee')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Collect Admission Fee</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fee-amount">Amount *</Label>
            <Input id="fee-amount" type="number" min={1} value={amount}
              onChange={e => { setAmount(e.target.value); setAmountTouched(true) }}
              placeholder={configuredFee != null ? undefined : 'e.g. 500'} />
            {configuredFee != null && (
              <p className="text-xs text-muted-foreground">Pre-filled from this class's configured admission fee — editable.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Method *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEE_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fee-reference">Reference (optional)</Label>
            <Input id="fee-reference" value={reference} onChange={e => setReference(e.target.value)} placeholder="Transaction / cheque no." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Collect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OfferLetterCard({ app }: { app: any }) {
  const qc = useQueryClient()
  const issueMutation = useMutation({
    mutationFn: () => admissionApi.applications.issueOfferLetter(app.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-application', app.id] })
      toast.success('Offer letter issued')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to issue offer letter'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="w-4 h-4 text-muted-foreground" /> Offer Letter
        </CardTitle>
      </CardHeader>
      <CardContent>
        {app.status !== 'admitted' ? (
          <p className="text-sm text-muted-foreground">Available once this application is admitted.</p>
        ) : app.offer_letter_number ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{app.offer_letter_number}</p>
              <p className="text-xs text-muted-foreground">Issued {app.offer_letter_issued_at ? formatDate(app.offer_letter_issued_at) : ''}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={documentsApi.admissionOfferLetter(app.id)} target="_blank" rel="noreferrer">
                <Eye className="w-3.5 h-3.5" /> View / Print
              </a>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">No offer letter issued yet.</p>
            <Button size="sm" onClick={() => issueMutation.mutate()} disabled={issueMutation.isPending}>
              {issueMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Issue Offer Letter'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

