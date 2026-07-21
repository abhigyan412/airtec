'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Phone, Mail, MessageSquare, Calendar, CheckCircle, XCircle, Loader2, Plus, User, FileCheck } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STAGES = [
  { key: 'new',                 label: 'New' },
  { key: 'follow_up',           label: 'Follow Up' },
  { key: 'interested',          label: 'Interested' },
  { key: 'documents_submitted', label: 'Docs Submitted' },
  { key: 'approved',            label: 'Approved' },
  { key: 'fee_pending',         label: 'Fee Pending' },
  { key: 'admitted',            label: 'Admitted' },
]

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  follow_up: 'bg-yellow-100 text-yellow-700',
  interested: 'bg-purple-100 text-purple-700',
  documents_submitted: 'bg-orange-100 text-orange-700',
  entrance_exam: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-teal-100 text-teal-700',
  fee_pending: 'bg-pink-100 text-pink-700',
  admitted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  lost: 'bg-gray-100 text-gray-600',
}

const CHANNEL_ICONS: Record<string, string> = {
  call: '📞', whatsapp: '💬', email: '📧', visit: '🏫', sms: '📱'
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [showStatusChange, setShowStatusChange] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['inquiry', id],
    queryFn: () => admissionApi.inquiries.get(id).then(r => r.data),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => admissionApi.inquiries.update(id, { status }),
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
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <p className="font-medium">Inquiry not found</p>
        <Link href="/admission" className="text-indigo-600 text-sm mt-2 hover:underline">Back to CRM</Link>
      </div>
    )
  }

  const inq = data
  const currentStageIdx = STAGES.findIndex(s => s.key === inq.status)
  const hasApplication = !!inq.application_id // populated below if backend includes it; falls back gracefully if not

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admission" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{inq.student_name}</h1>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[inq.status] ?? 'bg-gray-100 text-gray-600')}>
              {inq.status?.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">{inq.inquiry_number}</span>
          </div>
          <p className="text-gray-500 text-sm mt-1">
            Added {formatDate(inq.created_at)}
            {inq.classes?.name && ` · Applying for ${inq.classes.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!inq.linked_application && inq.status !== 'admitted' && inq.status !== 'rejected' && inq.status !== 'lost' && (
            <button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-60 transition-colors">
              {convertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
              Convert to Application
            </button>
          )}
          {!inq.linked_application && (
            <button onClick={() => setShowStatusChange(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
              Move Stage
            </button>
          )}
        </div>
      </div>

      {/* Pipeline progress — OR link to the live application workflow if converted */}
      {inq.linked_application ? (
        <Link href={`/admission/applications/${inq.linked_application.id}`}
          className="block bg-white rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 hover:bg-emerald-50 transition-colors group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">Converted to Application</p>
              <p className="text-sm text-gray-700">
                <span className="font-mono text-gray-500">{inq.linked_application.application_number}</span>
                {' · '}
                <span className={cn('font-semibold capitalize', inq.linked_application.status === 'admitted' ? 'text-emerald-600' : inq.linked_application.status === 'rejected' ? 'text-red-600' : 'text-amber-600')}>
                  {inq.linked_application.status}
                </span>
              </p>
              <p className="text-xs text-gray-400 mt-1">Real-time approval progress now lives on the application page.</p>
            </div>
            <span className="flex items-center gap-1 text-sm text-emerald-700 font-semibold group-hover:gap-2 transition-all">
              View Application Progress <ArrowLeft className="w-4 h-4 rotate-180" />
            </span>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Admission Pipeline</p>
          <div className="flex items-center gap-0">
            {STAGES.map((stage, idx) => {
              const isDone    = idx < currentStageIdx
              const isCurrent = idx === currentStageIdx
              const isLast    = idx === STAGES.length - 1
              return (
                <div key={stage.key} className="flex items-center flex-1 min-w-0">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                      isDone    ? 'bg-indigo-600 border-indigo-600 text-white' :
                      isCurrent ? 'bg-white border-indigo-600 text-indigo-600' :
                      'bg-white border-gray-200 text-gray-400')}>
                      {isDone ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    <p className={cn('text-xs mt-1 text-center whitespace-nowrap', isCurrent ? 'text-indigo-600 font-semibold' : 'text-gray-400')}>
                      {stage.label}
                    </p>
                  </div>
                  {!isLast && (
                    <div className={cn('flex-1 h-0.5 mx-1 mb-4', idx < currentStageIdx ? 'bg-indigo-600' : 'bg-gray-200')} />
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Convert this inquiry to a formal application to start the Counselor → Accountant → Principal approval workflow. Stage will update automatically as approvals happen.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Left: inquiry details */}
        <div className="col-span-2 space-y-5">
          {/* Contact info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" /> Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Parent Name</p>
                <p className="text-sm font-medium text-gray-800">{inq.parent_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Phone</p>
                <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-gray-400" /> {inq.parent_phone}
                </p>
              </div>
              {inq.parent_email && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Email</p>
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
                    <Mail className="w-3 h-3 text-gray-400" /> {inq.parent_email}
                  </p>
                </div>
              )}
              {inq.gender && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Gender</p>
                  <p className="text-sm font-medium text-gray-800 capitalize">{inq.gender}</p>
                </div>
              )}
              {inq.classes?.name && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Applying for Class</p>
                  <p className="text-sm font-medium text-gray-800">{inq.classes.name}</p>
                </div>
              )}
              {inq.previous_school && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Previous School</p>
                  <p className="text-sm font-medium text-gray-800">{inq.previous_school}</p>
                </div>
              )}
              {inq.budget_range && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Budget Range</p>
                  <p className="text-sm font-medium text-gray-800">{inq.budget_range}</p>
                </div>
              )}
              {inq.users?.full_name && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Assigned Counselor</p>
                  <p className="text-sm font-medium text-gray-800">{inq.users.full_name}</p>
                </div>
              )}
            </div>
            {inq.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-600">{inq.notes}</p>
              </div>
            )}
          </div>

          {/* Follow-ups */}
          <div className="bg-white rounded-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                Follow-ups ({(inq.inquiry_follow_ups ?? []).length})
              </h3>
              <button onClick={() => setShowFollowUp(true)}
                className="flex items-center gap-1.5 text-sm text-indigo-600 font-medium hover:text-indigo-700">
                <Plus className="w-4 h-4" /> Log Follow-up
              </button>
            </div>
            {(inq.inquiry_follow_ups ?? []).length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                <p className="text-sm font-medium">No follow-ups yet</p>
                <p className="text-xs mt-1">Log your first call or visit</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {(inq.inquiry_follow_ups ?? [])
                  .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map((fu: any) => (
                  <div key={fu.id} className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{CHANNEL_ICONS[fu.channel] ?? '📝'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 capitalize">{fu.channel}</span>
                          <span className="text-xs text-gray-400">{formatDate(fu.follow_up_date)}</span>
                          {fu.users?.full_name && (
                            <span className="text-xs text-gray-400">by {fu.users.full_name}</span>
                          )}
                        </div>
                        {fu.notes && <p className="text-sm text-gray-600 mt-1">{fu.notes}</p>}
                        {fu.outcome && (
                          <p className="text-xs text-indigo-600 font-medium mt-1">Outcome: {fu.outcome}</p>
                        )}
                        {fu.next_follow_up_date && (
                          <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Next: {formatDate(fu.next_follow_up_date)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: quick actions */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              {!inq.linked_application && inq.status !== 'admitted' && inq.status !== 'rejected' && inq.status !== 'lost' && (
                <button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-emerald-700 font-medium hover:bg-emerald-50 transition-colors border border-transparent hover:border-emerald-100">
                  Convert to Application <span className="text-emerald-300">→</span>
                </button>
              )}
              <button onClick={() => setShowFollowUp(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-indigo-50 hover:text-indigo-700 transition-colors border border-transparent hover:border-gray-100">
                Log Follow-up <span className="text-gray-300">→</span>
              </button>
              {!inq.linked_application && (
                <>
                  <button onClick={() => setShowStatusChange(true)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-purple-50 hover:text-purple-700 transition-colors border border-transparent hover:border-gray-100">
                    Move Pipeline Stage <span className="text-gray-300">→</span>
                  </button>
                  {inq.status !== 'rejected' && inq.status !== 'lost' && (
                    <button onClick={() => statusMutation.mutate('rejected')}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-red-50 hover:text-red-700 transition-colors border border-transparent hover:border-gray-100">
                      Mark as Rejected <span className="text-gray-300">→</span>
                    </button>
                  )}
                  {inq.status !== 'lost' && (
                    <button onClick={() => statusMutation.mutate('lost')}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                      Mark as Lost <span className="text-gray-300">→</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Record Info</p>
            <p className="text-xs text-gray-500">Created {formatDate(inq.created_at)}</p>
            {inq.inquiry_sources?.name && (
              <p className="text-xs text-gray-500">Source: {inq.inquiry_sources.name}</p>
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
          onSelect={(status) => statusMutation.mutate(status)}
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

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Log Follow-up</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Channel *</label>
            <div className="grid grid-cols-5 gap-2">
              {[
                { key: 'call', icon: '📞', label: 'Call' },
                { key: 'whatsapp', icon: '💬', label: 'WhatsApp' },
                { key: 'email', icon: '📧', label: 'Email' },
                { key: 'visit', icon: '🏫', label: 'Visit' },
                { key: 'sms', icon: '📱', label: 'SMS' },
              ].map(c => (
                <button key={c.key} onClick={() => setForm(f => ({ ...f, channel: c.key }))}
                  className={cn('flex flex-col items-center gap-1 p-2 rounded-xl border-2 text-xs font-medium transition-all',
                    form.channel === c.key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300')}>
                  <span className="text-lg">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Date & Time *</label>
            <input type="datetime-local" className={inputCls} value={form.follow_up_date}
              onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
            <textarea rows={3} className={inputCls + ' resize-none'} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="What was discussed..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Outcome</label>
            <input className={inputCls} value={form.outcome}
              onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Interested, needs more time, wants visit" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Next Follow-up Date</label>
            <input type="date" className={inputCls} value={form.next_follow_up_date}
              onChange={e => setForm(f => ({ ...f, next_follow_up_date: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Log Follow-up
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusChangeModal({ currentStatus, onSelect, isPending, onClose }: {
  currentStatus: string
  onSelect: (s: string) => void
  isPending: boolean
  onClose: () => void
}) {
  const ALL_STATUSES = [
    { key: 'new',                 label: 'New',                color: 'bg-blue-100 text-blue-700' },
    { key: 'follow_up',           label: 'Follow Up',          color: 'bg-yellow-100 text-yellow-700' },
    { key: 'interested',          label: 'Interested',         color: 'bg-purple-100 text-purple-700' },
    { key: 'documents_submitted', label: 'Documents Submitted', color: 'bg-orange-100 text-orange-700' },
    { key: 'entrance_exam',       label: 'Entrance Exam',      color: 'bg-cyan-100 text-cyan-700' },
    { key: 'approved',            label: 'Approved',           color: 'bg-teal-100 text-teal-700' },
    { key: 'fee_pending',         label: 'Fee Pending',        color: 'bg-pink-100 text-pink-700' },
    { key: 'admitted',            label: 'Admitted',           color: 'bg-green-100 text-green-700', locked: true },
    { key: 'rejected',            label: 'Rejected',           color: 'bg-red-100 text-red-700' },
    { key: 'lost',                label: 'Lost',               color: 'bg-gray-100 text-gray-600' },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Move to Stage</h2>
          <p className="text-sm text-gray-500 mt-0.5">Select the new pipeline stage</p>
        </div>
        <div className="px-6 py-4 space-y-2 max-h-80 overflow-y-auto">
          {ALL_STATUSES.map(s => (
            <button key={s.key}
              onClick={() => !s.locked && onSelect(s.key)}
              disabled={s.key === currentStatus || isPending || s.locked}
              title={s.locked ? "Admitted can only be set automatically when the linked application's workflow completes" : undefined}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all',
                s.key === currentStatus
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 cursor-default'
                  : s.locked
                  ? 'border-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                  : 'border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 text-gray-700 disabled:opacity-50'
              )}>
              <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', s.color)}>
                {s.label}
              </span>
              {s.key === currentStatus && <span className="text-xs text-indigo-600">Current</span>}
              {s.locked && s.key !== currentStatus && <span className="text-xs text-gray-400">Auto only</span>}
              {isPending && s.key !== currentStatus && !s.locked && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            </button>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="w-full px-4 py-2 text-sm text-gray-600 font-medium border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}