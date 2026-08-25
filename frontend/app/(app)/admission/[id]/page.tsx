'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi } from '@/lib/api'
import { cn, formatDate, classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ArrowLeft, Phone, Mail, MessageSquare, Calendar, CheckCircle, Loader2, Plus, User, FileCheck, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SlotBookingCard } from '@/components/admission/SlotBookingCard'

// 'fee_pending' and 'admitted' are deliberately absent — both are set
// automatically from the linked application's own progress (see
// admission/routes.ts, PATCH /inquiries/:id), never picked by hand, so
// offering them here would be a dead-end the backend always rejects.
const STAGES = [
  { key: 'new',                 label: 'New' },
  { key: 'follow_up',           label: 'Follow Up' },
  { key: 'interested',          label: 'Interested' },
  { key: 'documents_submitted', label: 'Docs Submitted' },
  { key: 'approved',            label: 'Approved' },
]

// Pipeline stages are categorical (a stage identifies *where* an inquiry is,
// not whether that is good or bad), so the middle stages stay outside the
// semantic token scale — but every entry uses a theme-aware pill form
// (`bg-<hue>-500/10 text-<hue>-600 dark:text-<hue>-400`) so it stays legible in
// both light and dark mode. Single source of truth for the pill colours and
// for the "Move to Stage" picker below.
const ALL_STATUSES = [
  { key: 'new',                 label: 'New',                 color: 'bg-primary/10 text-primary' },
  { key: 'follow_up',           label: 'Follow Up',           color: 'bg-warning/10 text-warning' },
  { key: 'interested',          label: 'Interested',          color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  { key: 'documents_submitted', label: 'Documents Submitted', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  { key: 'entrance_exam',       label: 'Entrance Exam',       color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  { key: 'approved',            label: 'Approved',            color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  { key: 'waitlisted',          label: 'Waitlisted',          color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { key: 'fee_pending',         label: 'Fee Pending',         color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400' },
  { key: 'admitted',            label: 'Admitted',            color: 'bg-success/10 text-success', locked: true },
  { key: 'rejected',            label: 'Rejected',            color: 'bg-destructive/10 text-destructive' },
  { key: 'lost',                label: 'Lost',                color: 'bg-muted text-muted-foreground' },
]

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  ALL_STATUSES.map(s => [s.key, s.color]),
)

const CHANNEL_ICONS: Record<string, string> = {
  call: '📞', whatsapp: '💬', email: '📧', visit: '🏫', sms: '📱'
}

// Shared shape for the Quick Actions rows. These are bare <button>s rather than
// <Button>s (they're full-width list rows), so the focus ring has to be spelled
// out here — they'd otherwise be invisible to keyboard users.
const QUICK_ACTION =
  'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const classStyle = useClassDisplayStyle()
  const qc = useQueryClient()
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [showStatusChange, setShowStatusChange] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['inquiry', id],
    queryFn: () => admissionApi.inquiries.get(id).then(r => r.data),
  })

  const statusMutation = useMutation({
    mutationFn: (vars: { status: string; waitlist_rank?: number }) => admissionApi.inquiries.update(id, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inquiry', id] })
      qc.invalidateQueries({ queryKey: ['inquiry-stats'] })
      qc.invalidateQueries({ queryKey: ['inquiries'] })
      toast.success('Status updated')
      setShowStatusChange(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const convertMutation = useMutation({
    mutationFn: () => admissionApi.inquiries.convertToApplication(id),
    onSuccess: (res: any) => {
      toast.success('Converted to formal application — approval workflow started')
      const appId = res?.data?.id
      if (appId) {
        window.location.href = `/admission/applications/${appId}`
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to convert'),
  })

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-[132px] w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="col-span-2 space-y-5">
            <Skeleton className="h-[260px] w-full rounded-2xl" />
            <Skeleton className="h-[180px] w-full rounded-2xl" />
          </div>
          <div className="space-y-5">
            <Skeleton className="h-[220px] w-full rounded-2xl" />
            <Skeleton className="h-[104px] w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={UserPlus}
        title="Inquiry not found"
        description="This inquiry may have been deleted, or the link is out of date."
        action={
          <Button variant="outline" asChild>
            <Link href="/admission">
              <ArrowLeft className="w-4 h-4" /> Back to CRM
            </Link>
          </Button>
        }
      />
    )
  }

  const inq = data
  const currentStageIdx = STAGES.findIndex(s => s.key === inq.status)
  const hasApplication = !!inq.application_id // populated below if backend includes it; falls back gracefully if not

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <Button variant="ghost" size="sm" asChild className="-ml-3 -mb-2 text-muted-foreground">
        <Link href="/admission">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>
      </Button>
      <PageHeader
        title={inq.student_name}
        description={[
          inq.inquiry_number,
          `Added ${formatDate(inq.created_at)}`,
          inq.classes?.name && `Applying for ${classLabel(inq.classes.name, inq.classes.numeric_level, classStyle)}`,
        ].filter(Boolean).join(' · ')}
        icon={UserPlus}
        actions={
          <>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[inq.status] ?? 'bg-muted text-muted-foreground')}>
              {inq.status?.replace(/_/g, ' ')}
            </span>
            {!inq.linked_application && inq.status !== 'admitted' && inq.status !== 'rejected' && inq.status !== 'lost' && (
              <Button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
                className="bg-success text-success-foreground hover:bg-success/90">
                {convertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                Convert to Application
              </Button>
            )}
            {!inq.linked_application && (
              <Button onClick={() => setShowStatusChange(true)}>Move Stage</Button>
            )}
          </>
        }
      />

      {/* Pipeline progress — OR link to the live application workflow if converted */}
      {inq.linked_application ? (
        <Link href={`/admission/applications/${inq.linked_application.id}`}
          className="block rounded-2xl border border-success/30 bg-success/5 p-5 hover:bg-success/10 transition-colors group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-success uppercase tracking-wider mb-1">Converted to Application</p>
              <p className="text-sm text-foreground">
                <span className="font-mono text-muted-foreground">{inq.linked_application.application_number}</span>
                {' · '}
                <span className={cn('font-semibold capitalize', inq.linked_application.status === 'admitted' ? 'text-success' : inq.linked_application.status === 'rejected' ? 'text-destructive' : 'text-warning')}>
                  {inq.linked_application.status}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">Real-time approval progress now lives on the application page.</p>
            </div>
            <span className="flex items-center gap-1 text-sm text-success font-semibold group-hover:gap-2 transition-all">
              View Application Progress <ArrowLeft className="w-4 h-4 rotate-180" />
            </span>
          </div>
        </Link>
      ) : (
        <Card className="p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Admission Pipeline</p>
          <div className="flex items-center gap-0">
            {STAGES.map((stage, idx) => {
              const isDone    = idx < currentStageIdx
              const isCurrent = idx === currentStageIdx
              const isLast    = idx === STAGES.length - 1
              return (
                <div key={stage.key} className="flex items-center flex-1 min-w-0">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                      isDone    ? 'bg-primary border-primary text-primary-foreground' :
                      isCurrent ? 'bg-card border-primary text-primary' :
                      'bg-card border-border text-muted-foreground')}>
                      {isDone ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    <p className={cn('text-xs mt-1 text-center whitespace-nowrap', isCurrent ? 'text-primary font-semibold' : 'text-muted-foreground')}>
                      {stage.label}
                    </p>
                  </div>
                  {!isLast && (
                    <div className={cn('flex-1 h-0.5 mx-1 mb-4', idx < currentStageIdx ? 'bg-primary' : 'bg-border')} />
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Convert this inquiry to a formal application to start the Counselor → Accountant → Principal approval workflow. Stage will update automatically as approvals happen.
          </p>
        </Card>
      )}

      {/* Waitlist offer state — visible clock since there's no send channel
          yet to actually notify the family; staff follow up by hand and
          either advance this inquiry (which clears it from the sweep) or
          let the deadline pass (auto re-offered to the next rank). */}
      {inq.status === 'waitlisted' && (
        <Card className={cn('p-4 border-amber-500/30 bg-amber-500/5')}>
          {inq.waitlist_offer_deadline ? (
            <p className="text-sm text-foreground">
              <span className="font-semibold text-amber-600 dark:text-amber-400">Offer pending</span> — a seat opened up and this candidate is next in line.
              Respond by <span className="font-medium">{formatDate(inq.waitlist_offer_deadline)}</span>, or it auto-advances to the next rank.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              On the waitlist{inq.waitlist_rank != null ? <>, rank <span className="font-medium text-foreground">#{inq.waitlist_rank}</span></> : ' (no rank set — first to be offered a freed seat is by enquiry date until one is)'}.
              No seat has freed up for this class yet.
            </p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Left: inquiry details */}
        <div className="col-span-2 space-y-5">
          {/* Contact info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" /> Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Parent Name</p>
                  <p className="text-sm font-medium text-foreground">{inq.parent_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                  <p className="text-sm font-medium text-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3 text-muted-foreground" /> {inq.parent_phone}
                  </p>
                </div>
                {inq.parent_email && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-sm font-medium text-foreground flex items-center gap-1">
                      <Mail className="w-3 h-3 text-muted-foreground" /> {inq.parent_email}
                    </p>
                  </div>
                )}
                {inq.gender && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Gender</p>
                    <p className="text-sm font-medium text-foreground capitalize">{inq.gender}</p>
                  </div>
                )}
                {inq.classes?.name && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Applying for Class</p>
                    <p className="text-sm font-medium text-foreground">{classLabel(inq.classes.name, inq.classes.numeric_level, classStyle)}</p>
                  </div>
                )}
                {inq.previous_school && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Previous School</p>
                    <p className="text-sm font-medium text-foreground">{inq.previous_school}</p>
                  </div>
                )}
                {inq.budget_range && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Budget Range</p>
                    <p className="text-sm font-medium text-foreground">{inq.budget_range}</p>
                  </div>
                )}
                {inq.users?.full_name && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Assigned Counselor</p>
                    <p className="text-sm font-medium text-foreground">{inq.users.full_name}</p>
                  </div>
                )}
              </div>
              {inq.notes && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground">{inq.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-ups */}
          <Card>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Follow-ups ({(inq.inquiry_follow_ups ?? []).length})
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setShowFollowUp(true)} className="text-primary hover:text-primary">
                <Plus className="w-4 h-4" /> Log Follow-up
              </Button>
            </div>
            {(inq.inquiry_follow_ups ?? []).length === 0 ? (
              <EmptyState icon={MessageSquare} title="No follow-ups yet" description="Log your first call or visit" className="py-8" />
            ) : (
              <div className="divide-y divide-border">
                {(inq.inquiry_follow_ups ?? [])
                  .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map((fu: any) => (
                  <div key={fu.id} className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{CHANNEL_ICONS[fu.channel] ?? '📝'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground capitalize">{fu.channel}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(fu.follow_up_date)}</span>
                          {fu.users?.full_name && (
                            <span className="text-xs text-muted-foreground">by {fu.users.full_name}</span>
                          )}
                        </div>
                        {fu.notes && <p className="text-sm text-foreground mt-1">{fu.notes}</p>}
                        {fu.outcome && (
                          <p className="text-xs text-primary font-medium mt-1">Outcome: {fu.outcome}</p>
                        )}
                        {fu.next_follow_up_date && (
                          <p className="text-xs text-warning mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Next: {formatDate(fu.next_follow_up_date)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: quick actions */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {!inq.linked_application && inq.status !== 'admitted' && inq.status !== 'rejected' && inq.status !== 'lost' && (
                  <button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
                    className={cn(QUICK_ACTION, 'text-success hover:bg-success/10')}>
                    Convert to Application <span className="text-success/50">→</span>
                  </button>
                )}
                <button onClick={() => setShowFollowUp(true)}
                  className={cn(QUICK_ACTION, 'text-foreground hover:bg-muted')}>
                  Log Follow-up <span className="text-muted-foreground">→</span>
                </button>
                {!inq.linked_application && (
                  <>
                    <button onClick={() => setShowStatusChange(true)}
                      className={cn(QUICK_ACTION, 'text-foreground hover:bg-muted')}>
                      Move Pipeline Stage <span className="text-muted-foreground">→</span>
                    </button>
                    {inq.status !== 'rejected' && inq.status !== 'lost' && (
                      <button onClick={() => statusMutation.mutate({ status: 'rejected' })}
                        className={cn(QUICK_ACTION, 'text-foreground hover:bg-destructive/10 hover:text-destructive')}>
                        Mark as Rejected <span className="text-muted-foreground">→</span>
                      </button>
                    )}
                    {inq.status !== 'lost' && (
                      <button onClick={() => statusMutation.mutate({ status: 'lost' })}
                        className={cn(QUICK_ACTION, 'text-foreground hover:bg-muted')}>
                        Mark as Lost <span className="text-muted-foreground">→</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <SlotBookingCard inquiryId={id} classId={inq.applying_for_class_id} />

          <div className="bg-muted rounded-2xl p-4 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Record Info</p>
            <p className="text-xs text-muted-foreground">Created {formatDate(inq.created_at)}</p>
            {inq.inquiry_sources?.name && (
              <p className="text-xs text-muted-foreground">Source: {inq.inquiry_sources.name}</p>
            )}
          </div>
        </div>
      </div>

      {/* Follow-up modal */}
      {showFollowUp && (
        <FollowUpModal inquiryId={id} onClose={() => {
          setShowFollowUp(false)
          qc.invalidateQueries({ queryKey: ['inquiry', id] })
        }} />
      )}

      {/* Status change modal */}
      {showStatusChange && (
        <StatusChangeModal
          currentStatus={inq.status}
          currentRank={inq.waitlist_rank}
          onSelect={(status, waitlist_rank) => statusMutation.mutate({ status, waitlist_rank })}
          isPending={statusMutation.isPending}
          onClose={() => setShowStatusChange(false)}
        />
      )}
    </div>
  )
}

function FollowUpModal({ inquiryId, onClose }: { inquiryId: string, onClose: () => void }) {
  const [form, setForm] = useState({
    follow_up_date: new Date().toISOString().slice(0, 16),
    channel: 'call',
    notes: '',
    outcome: '',
    next_follow_up_date: '',
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await admissionApi.inquiries.addFollowUp(inquiryId, form)
      toast.success('Follow-up logged!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Follow-up</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Channel *</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {[
                { key: 'call', icon: '📞', label: 'Call' },
                { key: 'whatsapp', icon: '💬', label: 'WhatsApp' },
                { key: 'email', icon: '📧', label: 'Email' },
                { key: 'visit', icon: '🏫', label: 'Visit' },
                { key: 'sms', icon: '📱', label: 'SMS' },
              ].map(c => (
                <button key={c.key} onClick={() => setForm(f => ({ ...f, channel: c.key }))}
                  aria-pressed={form.channel === c.key}
                  className={cn('flex flex-col items-center gap-1 p-2 rounded-xl border-2 text-xs font-medium transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    form.channel === c.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40')}>
                  <span className="text-lg">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="fu-date" className="mb-1.5 block">Date &amp; Time *</Label>
            <Input id="fu-date" type="datetime-local" value={form.follow_up_date}
              onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="fu-notes" className="mb-1.5 block">Notes</Label>
            <Textarea id="fu-notes" rows={3} className="resize-none" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="What was discussed..." />
          </div>
          <div>
            <Label htmlFor="fu-outcome" className="mb-1.5 block">Outcome</Label>
            <Input id="fu-outcome" value={form.outcome}
              onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Interested, needs more time, wants visit" />
          </div>
          <div>
            <Label htmlFor="fu-next" className="mb-1.5 block">Next Follow-up Date</Label>
            <Input id="fu-next" type="date" value={form.next_follow_up_date}
              onChange={e => setForm(f => ({ ...f, next_follow_up_date: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Log Follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatusChangeModal({ currentStatus, currentRank, onSelect, isPending, onClose }: {
  currentStatus: string
  currentRank?: number | null
  onSelect: (s: string, waitlistRank?: number) => void
  isPending: boolean
  onClose: () => void
}) {
  const [confirmingWaitlist, setConfirmingWaitlist] = useState(false)
  const [rankInput, setRankInput] = useState(currentRank != null ? String(currentRank) : '')

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to Stage</DialogTitle>
          <DialogDescription>Select the new pipeline stage</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto -mx-1 px-1">
          {ALL_STATUSES.map(s => (
            <div key={s.key}>
              <button
                onClick={() => {
                  if (s.locked) return
                  if (s.key === 'waitlisted') { setConfirmingWaitlist(v => !v); return }
                  onSelect(s.key)
                }}
                disabled={s.key === currentStatus || isPending || s.locked}
                title={s.locked ? "Admitted can only be set automatically when the linked application's workflow completes" : undefined}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  s.key === currentStatus
                    ? 'border-primary bg-primary/10 text-primary cursor-default'
                    : s.locked
                    ? 'border-border text-muted-foreground cursor-not-allowed opacity-60'
                    : 'border-border hover:border-primary/40 hover:bg-primary/5 text-foreground disabled:opacity-50'
                )}>
                <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', s.color)}>
                  {s.label}
                </span>
                {s.key === currentStatus && <span className="text-xs text-primary">Current</span>}
                {s.locked && s.key !== currentStatus && <span className="text-xs text-muted-foreground">Auto only</span>}
                {isPending && s.key !== currentStatus && !s.locked && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </button>
              {s.key === 'waitlisted' && confirmingWaitlist && (
                <div className="mt-1.5 mb-1 p-3 rounded-xl bg-muted/40 flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="waitlist-rank" className="text-xs">Rank (optional — lower goes first)</Label>
                    <Input id="waitlist-rank" type="number" min={1} value={rankInput}
                      onChange={e => setRankInput(e.target.value)} placeholder="e.g. 1" />
                  </div>
                  <Button size="sm" disabled={isPending}
                    onClick={() => onSelect('waitlisted', rankInput ? Number(rankInput) : undefined)}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" className="w-full" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
