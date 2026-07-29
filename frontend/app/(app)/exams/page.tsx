'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, BookOpen, CheckCircle, Clock, FileText, Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const EXAM_TYPES = ['unit_test','monthly','half_yearly','annual','pre_board','practical','other']

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  draft:            'secondary',
  published:        'info',
  ongoing:          'warning',
  completed:        'default',
  result_declared:  'success',
}

const titleCase = (t: string) => t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ExamsPage() {
  const [showNew, setShowNew] = useState(false)
  const qc = useQueryClient()

  const { data: stats } = useQuery({
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
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Exam
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Exams" value={stats?.total ?? 0} icon={BookOpen} accent="primary" />
        <StatCard label="Draft" value={stats?.draft ?? 0} icon={Clock} accent="info" />
        <StatCard label="Ongoing" value={stats?.ongoing ?? 0} icon={FileText} accent="warning" />
        <StatCard label="Results Declared" value={stats?.completed ?? 0} icon={CheckCircle} accent="success" />
      </div>

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
              description="Create your first exam to get started"
            />
          ) : (
            <div className="divide-y divide-border">
              {(exams ?? []).map((exam: any) => (
                <div key={exam.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/50">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{exam.name}</p>
                    <div className="mt-0.5 flex items-center gap-3">
                      <span className="text-xs capitalize text-muted-foreground">{exam.exam_type?.replace('_', ' ')}</span>
                      {exam.start_date && <span className="text-xs text-muted-foreground">{formatDate(exam.start_date)}</span>}
                      <span className="text-xs text-muted-foreground">{exam.academic_years?.name}</span>
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[exam.status] ?? 'secondary'} className="capitalize">
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
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/exams/${exam.id}`}>
                        Manage <ChevronRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showNew && <NewExamModal onClose={() => setShowNew(false)} />}
    </div>
  )
}

function NewExamModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '', exam_type: 'unit_test', start_date: '', end_date: '', grading_system: 'marks'
  })

  const { data: ayData } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => api.get('/admission/academic-years').then(r => r.data.data).catch(() => []),
  })

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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.name}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
