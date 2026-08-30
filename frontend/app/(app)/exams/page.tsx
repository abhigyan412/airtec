'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, BookOpen, CheckCircle, Clock, FileText, Loader2, ChevronRight, LayoutTemplate, CalendarRange } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyTemplateModal } from '@/components/exams/ApplyTemplateModal'
import { NeedsAttentionPanel } from '@/components/exams/NeedsAttentionPanel'
import { STATUS_VARIANT } from '@/components/exams/statusVariant'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const EXAM_TYPES = ['unit_test','monthly','half_yearly','annual','pre_board','practical','other']

const titleCase = (t: string) => t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ExamsPage() {
  const [showNew, setShowNew] = useState(false)
  const [showApplyTemplate, setShowApplyTemplate] = useState(false)
  const qc = useQueryClient()

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['exam-stats'],
    queryFn: () => api.get('/exams/stats').then(r => r.data.data),
  })

  const { data: exams, isLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get('/exams').then(r => r.data.data),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/exams/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] })
      qc.invalidateQueries({ queryKey: ['exam-stats'] })
      toast.success('Exam status updated')
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examinations"
        description="Manage exams, datesheets, marks and results"
        icon={BookOpen}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowApplyTemplate(true)}>
              <LayoutTemplate className="h-4 w-4" /> New from Template
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> New Exam
            </Button>
          </>
        }
      />

      <NeedsAttentionPanel />

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Exams" value={stats?.total ?? 0} icon={BookOpen} accent="primary" />
          <StatCard label="Draft" value={stats?.draft ?? 0} icon={Clock} accent="info" />
          <StatCard label="Ongoing" value={stats?.ongoing ?? 0} icon={FileText} accent="warning" />
          <StatCard label="Results Declared" value={stats?.results_declared ?? 0} icon={CheckCircle} accent="success" />
        </div>
      )}

      {/* Exams list */}
      <Card>
        <CardHeader>
          <CardTitle>All Examinations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !(exams ?? []).length ? (
            <EmptyState
              icon={BookOpen}
              title="No exams yet"
              description="Create an exam to build its datesheet, enter marks and publish results."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" onClick={() => setShowApplyTemplate(true)}>
                    <LayoutTemplate className="h-4 w-4" /> New from Template
                  </Button>
                  <Button onClick={() => setShowNew(true)}>
                    <Plus className="h-4 w-4" /> New Exam
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {(exams ?? []).map((exam: any) => (
                <div key={exam.id} className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
                  <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{exam.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="text-xs capitalize text-muted-foreground">{exam.exam_type?.replace('_', ' ')}</span>
                      {exam.start_date && <span className="text-xs text-muted-foreground">{formatDate(exam.start_date)}</span>}
                      <span className="text-xs text-muted-foreground">{exam.academic_years?.name}</span>
                    </div>
                    </div>
                  </div>
                  {/* pl-[3.25rem] lines the action row up under the exam name on
                      mobile (40px icon + 12px gap); on sm+ it sits inline instead. */}
                  <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:pl-0">
                  <Badge variant={STATUS_VARIANT[exam.status] ?? 'secondary'} className="shrink-0 capitalize">
                    {exam.status?.replace('_', ' ')}
                  </Badge>
                  {/* Status actions */}
                  <div className="flex items-center gap-2">
                    {exam.status === 'draft' && (
                      <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ id: exam.id, status: 'published' })}>
                        Publish
                      </Button>
                    )}
                    {exam.status === 'published' && (
                      <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ id: exam.id, status: 'ongoing' })}>
                        Start
                      </Button>
                    )}
                    {exam.status === 'ongoing' && (
                      <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ id: exam.id, status: 'completed' })}>
                        Complete
                      </Button>
                    )}
                    <Button variant="outline" size="icon" className="h-8 w-8" asChild title="Datesheet">
                      <Link href={`/exams/${exam.id}?tab=Datesheet`}>
                        <CalendarRange className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/exams/${exam.id}`}>
                        Manage <ChevronRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showNew && <NewExamModal onClose={() => setShowNew(false)} />}
      {showApplyTemplate && <ApplyTemplateModal onClose={() => setShowApplyTemplate(false)} />}
    </div>
  )
}

function NewExamModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '', exam_type: 'unit_test', start_date: '', end_date: '', grading_system: 'marks', default_time_slot_id: '',
  })

  // A default time slot most exams' subjects will all share (e.g. every
  // paper 9:00-11:00) — picked once here instead of on every single
  // "Add Subject" afterward. Still just a pre-fill: Add Subject can
  // always override it per subject.
  const { data: timeSlots } = useQuery({
    queryKey: ['exam-time-slots'],
    queryFn: () => api.get('/exams/time-slots').then(r => r.data.data),
  })

  // academic_year_id is intentionally not a field here — the backend
  // defaults it to the school's current academic year on its own
  // (POST /exams), so there's nothing for this form to collect.
  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/exams', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] })
      qc.invalidateQueries({ queryKey: ['exam-stats'] })
      toast.success('Exam created!')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Exam</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exam-name">Exam Name *</Label>
            <Input id="exam-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Half Yearly Examination 2024" />
          </div>
          <div className="space-y-1.5">
            <Label>Exam Type *</Label>
            <Select value={form.exam_type} onValueChange={v => setForm(f => ({ ...f, exam_type: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_TYPES.map(t => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="exam-start">Start Date</Label>
              <Input id="exam-start" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-end">End Date</Label>
              <Input id="exam-end" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Default Time Slot</Label>
            <Select value={form.default_time_slot_id || 'none'} onValueChange={v => setForm(f => ({ ...f, default_time_slot_id: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="No default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default</SelectItem>
                {(timeSlots ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Pre-fills the time on every subject you add to this exam's datesheet — still changeable per subject.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate({ ...form, default_time_slot_id: form.default_time_slot_id || undefined })} disabled={mutation.isPending || !form.name}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
