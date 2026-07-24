'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Plus, Briefcase, Users, Loader2, Pause, Play, XCircle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'warning'> = {
  open: 'success',
  closed: 'secondary',
  on_hold: 'warning',
}

export default function JobPostingsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['job-postings-all', statusFilter],
    queryFn: () => hrmsApi.jobPostings.list({ status: statusFilter || undefined }).then(r => r.data),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.jobPostings.update(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-postings-all'] })
      qc.invalidateQueries({ queryKey: ['job-postings'] })
      toast.success('Job posting updated')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
            <Link href="/hr/recruitment" aria-label="Back to recruitment"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Job Postings</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage open positions and vacancies</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Job Posting
        </Button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {['', 'open', 'on_hold', 'closed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-all',
              statusFilter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Jobs grid */}
      {isLoading ? (
        <Card className="p-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></Card>
      ) : (jobs ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={Briefcase} title="No job postings yet" description="Create your first job posting to start hiring" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(jobs ?? []).map((j: any) => (
            <Card key={j.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{j.title}</h3>
                  <Badge variant={STATUS_VARIANT[j.status] ?? 'secondary'} className="capitalize">{j.status.replace('_', ' ')}</Badge>
                </div>
                <div className="mb-3 space-y-1 text-sm text-muted-foreground">
                  {j.department && <p>{j.department}{j.designation ? ` · ${j.designation}` : ''}</p>}
                  {j.experience_required && <p className="text-xs">Experience: {j.experience_required}</p>}
                  {j.salary_range && <p className="text-xs">Salary: {j.salary_range}</p>}
                  <p className="text-xs capitalize">{j.employment_type?.replace('_', ' ')} · {j.vacancies} vacancy(ies)</p>
                </div>
                {j.description && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{j.description}</p>}

                <div className="flex items-center justify-between border-t border-border pt-3">
                  <Link href={`/hr/recruitment?job=${j.id}`} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80">
                    <Users className="h-3.5 w-3.5" /> {j.application_count} candidate(s)
                  </Link>
                  <div className="flex gap-1">
                    {j.status === 'open' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-warning" onClick={() => statusMutation.mutate({ id: j.id, status: 'on_hold' })} title="Put on hold" aria-label="Put on hold">
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {j.status === 'on_hold' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-success" onClick={() => statusMutation.mutate({ id: j.id, status: 'open' })} title="Reopen" aria-label="Reopen">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {j.status !== 'closed' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => statusMutation.mutate({ id: j.id, status: 'closed' })} title="Close" aria-label="Close">
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateJobModal onClose={() => {
          setShowCreate(false)
          qc.invalidateQueries({ queryKey: ['job-postings-all'] })
          qc.invalidateQueries({ queryKey: ['job-postings'] })
        }} />
      )}
    </div>
  )
}

function CreateJobModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ title: '', department: '', designation: '', employment_type: 'full_time', description: '', requirements: '', experience_required: '', salary_range: '', vacancies: '1' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.title) return toast.error('Title required')
    setLoading(true)
    try {
      await hrmsApi.jobPostings.create({ ...form, vacancies: Number(form.vacancies) || 1 })
      toast.success('Job posting created')
      onClose()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Job Posting</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Job Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Mathematics Teacher" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Academics" />
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. PGT Mathematics" />
            </div>
            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Select value={form.employment_type} onValueChange={v => setForm(f => ({ ...f, employment_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vacancies</Label>
              <Input type="number" min="1" value={form.vacancies} onChange={e => setForm(f => ({ ...f, vacancies: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Experience Required</Label>
              <Input value={form.experience_required} onChange={e => setForm(f => ({ ...f, experience_required: e.target.value }))} placeholder="e.g. 2-5 years" />
            </div>
            <div className="space-y-1.5">
              <Label>Salary Range</Label>
              <Input value={form.salary_range} onChange={e => setForm(f => ({ ...f, salary_range: e.target.value }))} placeholder="e.g. 30k-45k" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} className="resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Requirements</Label>
            <Textarea rows={3} className="resize-none" value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} placeholder="Qualifications, skills required..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create Posting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
