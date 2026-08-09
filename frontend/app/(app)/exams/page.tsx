'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Plus, BookOpen, CheckCircle, Clock, FileText, Loader2, ChevronRight, LayoutTemplate, Sparkles } from 'lucide-react'
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
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()

  // "Use This Template" on /exams/templates links here with ?template=
  // so picking a template jumps straight into applying it instead of
  // landing on the plain exams list and making you find it again.
  useEffect(() => {
    const t = searchParams.get('template')
    if (t) setApplyTemplateId(t)
  }, [searchParams])

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
            <Button variant="outline" asChild>
              <Link href="/exams/templates"><LayoutTemplate className="h-4 w-4" /> Manage Templates</Link>
            </Button>
            <Button variant="outline" onClick={() => setApplyTemplateId('')}>
              <Sparkles className="h-4 w-4" /> New from Template
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> New Exam
            </Button>
          </>
        }
      />

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
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4" /> New Exam
                </Button>
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

      {applyTemplateId !== null && (
        <ApplyTemplateModal
          initialTemplateId={applyTemplateId || undefined}
          onClose={() => {
            setApplyTemplateId(null)
            if (searchParams.get('template')) router.replace('/exams')
          }}
        />
      )}
    </div>
  )
}

function NewExamModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '', exam_type: 'unit_test', start_date: '', end_date: '', grading_system: 'marks'
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

// Turns a blueprint (Exam Templates) into a real exam + fully-built
// datesheet in one submit — only per-subject dates need touching,
// everything else (class, subject, time slot, marks) is inherited from
// the template as-is.
function ApplyTemplateModal({ initialTemplateId, onClose }: { initialTemplateId?: string; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['exam-templates'],
    queryFn: () => api.get('/exams/templates').then(r => r.data.data),
  })

  const template = (templates ?? []).find((t: any) => t.id === templateId)
  const templateSubjects = template?.exam_template_subjects ?? []

  useEffect(() => {
    if (template && !name) setName(template.name)
  }, [template, name])

  const mutation = useMutation({
    mutationFn: () => api.post(`/exams/templates/${templateId}/apply`, {
      name, start_date: startDate || undefined, end_date: endDate || undefined,
      subjects: templateSubjects.map((ts: any) => ({ template_subject_id: ts.id, exam_date: dates[ts.id] || undefined })),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['exams'] })
      qc.invalidateQueries({ queryKey: ['exam-stats'] })
      toast.success('Exam created from template!')
      onClose()
      router.push(`/exams/${res.data.data.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to apply template'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Exam from Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Template *</Label>
            <Select value={templateId || undefined} disabled={templatesLoading} onValueChange={v => { setTemplateId(v); setName(''); setDates({}) }}>
              <SelectTrigger><SelectValue placeholder={templatesLoading ? 'Loading...' : 'Select template...'} /></SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!templatesLoading && (templates ?? []).length === 0 && (
              <p className="mt-1.5 text-xs text-warning">
                No templates yet — <Link href="/exams/templates" className="underline">create one</Link> first.
              </p>
            )}
          </div>

          {template && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="apply-name">Exam Name *</Label>
                  <Input id="apply-name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-start">Start Date</Label>
                  <Input id="apply-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-end">End Date</Label>
                  <Input id="apply-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Subjects — set each date</Label>
                <div className="space-y-2">
                  {templateSubjects.map((ts: any) => (
                    <div key={ts.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{ts.subject_name} · {ts.classes?.name}</p>
                        {ts.exam_time_slots && (
                          <p className="text-xs text-muted-foreground">{ts.exam_time_slots.name} · {ts.exam_time_slots.start_time?.slice(0, 5)}–{ts.exam_time_slots.end_time?.slice(0, 5)}</p>
                        )}
                      </div>
                      <Input type="date" className="w-auto" value={dates[ts.id] ?? ''}
                        onChange={e => setDates(d => ({ ...d, [ts.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!template || !name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
