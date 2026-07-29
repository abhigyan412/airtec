'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { complaintsApi, studentsApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, AlertCircle, Clock, CheckCircle, MessageSquare, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const CATEGORIES = ['academic','behavioral','facility','staff','fee','transport','bullying','other']
const PRIORITIES = ['low','medium','high','urgent']

const PRIORITY_VARIANTS: Record<string, BadgeProps['variant']> = {
  low: 'secondary',
  medium: 'info',
  high: 'warning',
  urgent: 'destructive',
}

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  closed: 'secondary',
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Complaints</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Track and resolve student and parent complaints</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> New Complaint
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={stats?.open ?? 0} icon={AlertCircle} accent="warning" />
        <StatCard label="In Progress" value={stats?.in_progress ?? 0} icon={Clock} accent="info" />
        <StatCard label="Resolved" value={stats?.resolved ?? 0} icon={CheckCircle} accent="success" />
        <StatCard label="Urgent" value={stats?.urgent ?? 0} icon={AlertCircle} accent="destructive" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-auto min-w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter || 'all'} onValueChange={v => setPriorityFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-auto min-w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Complaints list */}
      <Card>
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading...</div>
        ) : !(complaints ?? []).length ? (
          <EmptyState icon={MessageSquare} title="No complaints yet" />
        ) : (
          <div className="divide-y divide-border">
            {(complaints ?? []).map((c: any) => (
              <div key={c.id} className="cursor-pointer px-6 py-4 transition-colors hover:bg-muted/50"
                onClick={() => setSelected(c)}>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant={PRIORITY_VARIANTS[c.priority]} className="capitalize">
                        {c.priority}
                      </Badge>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                        {c.category}
                      </span>
                      {c.students && (
                        <span className="text-xs font-medium text-primary">
                          {c.students.first_name} {c.students.last_name} · {c.students.classes?.name}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-foreground">{c.subject}</p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{c.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(c.created_at)} · by {c.raised_by_user?.full_name ?? 'Unknown'}</p>
                  </div>
                  <Badge variant={STATUS_VARIANTS[c.status]} className="shrink-0 capitalize">
                    {c.status.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Complaint</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Related Student (optional)</Label>
            <Select value={form.student_id || 'none'} onValueChange={v => setForm(f => ({ ...f, student_id: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not student-specific</SelectItem>
                {(students ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name} — {s.classes?.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complaint-subject">Subject *</Label>
            <Input id="complaint-subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief summary of the complaint" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complaint-desc">Description *</Label>
            <Textarea id="complaint-desc" rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detailed description..." className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit Complaint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant={PRIORITY_VARIANTS[complaint.priority]} className="capitalize">{complaint.priority}</Badge>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{complaint.category}</span>
            <Badge variant={STATUS_VARIANTS[complaint.status]} className="capitalize">{complaint.status.replace('_',' ')}</Badge>
          </div>
          <DialogTitle>{complaint.subject}</DialogTitle>
          {complaint.students && (
            <p className="text-sm text-primary">{complaint.students.first_name} {complaint.students.last_name} · {complaint.students.classes?.name}</p>
          )}
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl bg-muted/40 p-4">
            <p className="text-sm text-foreground">{complaint.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">Raised by {complaint.raised_by_user?.full_name} · {formatDate(complaint.created_at)}</p>
          </div>

          {/* Status update */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Update Status</Label>
              <Select defaultValue={complaint.status} onValueChange={v => onUpdate(complaint.id, { status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resolution-note">Resolution Note</Label>
              <div className="flex gap-2">
                <Input id="resolution-note" value={resolution} onChange={e => setResolution(e.target.value)}
                  placeholder="How was it resolved?" />
                <Button onClick={() => onUpdate(complaint.id, { resolution })}>Save</Button>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="mb-3 text-sm font-semibold text-foreground">Comments ({(comments ?? []).length})</h4>
            <div className="mb-3 max-h-48 space-y-3 overflow-y-auto">
              {(comments ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No comments yet</p>
              ) : (comments ?? []).map((c: any) => (
                <div key={c.id} className="rounded-xl bg-muted/40 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{c.users?.full_name}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Add a comment..."
                onKeyDown={e => e.key === 'Enter' && comment && commentMutation.mutate()} />
              <Button size="icon" onClick={() => commentMutation.mutate()}
                disabled={!comment || commentMutation.isPending} aria-label="Send comment">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
