'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { complaintsApi, studentsApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Plus, AlertCircle, Clock, CheckCircle, MessageSquare, Loader2, X, Send } from 'lucide-react'
import { toast } from 'sonner'

const CATEGORIES = ['academic','behavioral','facility','staff','fee','transport','bullying','other']
const PRIORITIES = ['low','medium','high','urgent']

const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-100 text-gray-600',
}

export default function ComplaintsPage() {
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const qc = useQueryClient()

  const { data: stats } = useQuery({
    queryKey: ['complaint-stats'],
    queryFn: () => complaintsApi.stats().then(r => r.data),
  })

  const { data: complaints, isLoading } = useQuery({
    queryKey: ['complaints', statusFilter, priorityFilter],
    queryFn: () => complaintsApi.list({
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
    }).then(r => r.data),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => complaintsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['complaints'] })
      qc.invalidateQueries({ queryKey: ['complaint-stats'] })
      toast.success('Complaint updated')
      setSelected(null)
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Complaints</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track and resolve student and parent complaints</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
          <Plus className="w-4 h-4" /> New Complaint
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Open',        value: stats?.open ?? 0,        icon: AlertCircle, color: 'bg-yellow-500' },
          { label: 'In Progress', value: stats?.in_progress ?? 0, icon: Clock,       color: 'bg-blue-500' },
          { label: 'Resolved',    value: stats?.resolved ?? 0,    icon: CheckCircle, color: 'bg-green-500' },
          { label: 'Urgent',      value: stats?.urgent ?? 0,      icon: AlertCircle, color: 'bg-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${s.color}`}>
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex gap-3 flex-wrap">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">All Priority</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* Complaints list */}
      <div className="bg-white rounded-2xl border border-gray-200">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : !(complaints ?? []).length ? (
          <div className="p-12 text-center text-gray-400">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="font-medium">No complaints yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(complaints ?? []).map((c: any) => (
              <div key={c.id} className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => setSelected(c)}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', PRIORITY_COLORS[c.priority])}>
                        {c.priority}
                      </span>
                      <span className="text-xs text-gray-400 capitalize bg-gray-100 px-2 py-0.5 rounded-full">
                        {c.category}
                      </span>
                      {c.students && (
                        <span className="text-xs text-indigo-600 font-medium">
                          {c.students.first_name} {c.students.last_name} · {c.students.classes?.name}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900">{c.subject}</p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{c.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{formatDate(c.created_at)} · by {c.raised_by_user?.full_name ?? 'Unknown'}</p>
                  </div>
                  <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0', STATUS_COLORS[c.status])}>
                    {c.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && <NewComplaintModal onClose={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['complaints'] }); qc.invalidateQueries({ queryKey: ['complaint-stats'] }) }} />}
      {selected && <ComplaintDetailModal complaint={selected} onClose={() => setSelected(null)} onUpdate={(id, data) => updateMutation.mutate({ id, data })} />}
    </div>
  )
}

function NewComplaintModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ category: 'academic', subject: '', description: '', priority: 'medium', student_id: '' })
  const [loading, setLoading] = useState(false)

  const { data: students } = useQuery({
    queryKey: ['students-list'],
    queryFn: () => studentsApi.list({ limit: 200 }).then(r => r.data),
  })

  const handleSubmit = async () => {
    if (!form.subject || !form.description) return toast.error('Subject and description required')
    setLoading(true)
    try {
      await complaintsApi.create(form)
      toast.success('Complaint submitted')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New Complaint</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Related Student (optional)</label>
            <select value={form.student_id} onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Not student-specific</option>
              {(students ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name} — {s.classes?.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject *</label>
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief summary of the complaint"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description *</label>
            <textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detailed description..."
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Complaint
          </button>
        </div>
      </div>
    </div>
  )
}

function ComplaintDetailModal({ complaint, onClose, onUpdate }: { complaint: any, onClose: () => void, onUpdate: (id: string, data: any) => void }) {
  const [comment, setComment] = useState('')
  const [resolution, setResolution] = useState(complaint.resolution ?? '')
  const qc = useQueryClient()

  const { data: comments } = useQuery({
    queryKey: ['complaint-comments', complaint.id],
    queryFn: () => complaintsApi.getComments(complaint.id).then(r => r.data),
  })

  const commentMutation = useMutation({
    mutationFn: () => complaintsApi.addComment(complaint.id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['complaint-comments', complaint.id] })
      setComment('')
      toast.success('Comment added')
    },
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', PRIORITY_COLORS[complaint.priority])}>{complaint.priority}</span>
              <span className="text-xs text-gray-400 capitalize bg-gray-100 px-2 py-0.5 rounded-full">{complaint.category}</span>
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_COLORS[complaint.status])}>{complaint.status.replace('_',' ')}</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{complaint.subject}</h2>
            {complaint.students && (
              <p className="text-sm text-indigo-600 mt-0.5">{complaint.students.first_name} {complaint.students.last_name} · {complaint.students.classes?.name}</p>
            )}
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm text-gray-700">{complaint.description}</p>
            <p className="text-xs text-gray-400 mt-2">Raised by {complaint.raised_by_user?.full_name} · {formatDate(complaint.created_at)}</p>
          </div>

          {/* Status update */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Update Status</label>
              <select defaultValue={complaint.status}
                onChange={e => onUpdate(complaint.id, { status: e.target.value })}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Resolution Note</label>
              <div className="flex gap-2">
                <input value={resolution} onChange={e => setResolution(e.target.value)}
                  placeholder="How was it resolved?"
                  className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                <button onClick={() => onUpdate(complaint.id, { resolution })}
                  className="px-3 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-sm font-medium">
                  Save
                </button>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Comments ({(comments ?? []).length})</h4>
            <div className="space-y-3 max-h-48 overflow-y-auto mb-3">
              {(comments ?? []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No comments yet</p>
              ) : (comments ?? []).map((c: any) => (
                <div key={c.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-gray-700">{c.users?.full_name}</span>
                    <span className="text-xs text-gray-400">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-600">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Add a comment..."
                onKeyDown={e => e.key === 'Enter' && comment && commentMutation.mutate()}
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              <button onClick={() => commentMutation.mutate()}
                disabled={!comment || commentMutation.isPending}
                className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-60">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}