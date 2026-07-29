'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Phone, Search, ChevronRight, FileCheck } from 'lucide-react'
import { admissionApi } from '@/lib/api'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import Link from 'next/link'
import { PipelineCharts } from '@/components/admission/PipelineCharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

// Theme-aware pill classes per pipeline stage (light + dark mode).
const PIPELINE_STAGES = [
  { key: 'new',                  label: 'New',           color: 'bg-primary/10 text-primary' },
  { key: 'follow_up',            label: 'Follow Up',     color: 'bg-warning/10 text-warning' },
  { key: 'interested',           label: 'Interested',    color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  { key: 'documents_submitted',  label: 'Docs',          color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  { key: 'approved',             label: 'Approved',      color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  { key: 'admitted',             label: 'Admitted',      color: 'bg-success/10 text-success' },
  { key: 'rejected',             label: 'Rejected',      color: 'bg-destructive/10 text-destructive' },
]

const INQUIRY_STATUSES = ['new','follow_up','interested','documents_submitted','entrance_exam','approved','fee_pending','admitted','rejected','lost']

const APP_STATUS_VARIANTS: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  admitted: 'success',
  rejected: 'destructive',
}

export default function AdmissionPage() {
  const [tab, setTab] = useState<'inquiries' | 'applications'>('inquiries')
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState('')
  const [showNewForm, setShowNew]   = useState(false)
  const [showNewApp, setShowNewApp] = useState(false)
  const [page, setPage]             = useState(1)

  const { data: inquiries, isLoading } = useQuery({
    queryKey: ['inquiries', search, statusFilter, page],
    queryFn: () => admissionApi.inquiries.list({
      search: search || undefined,
      status: statusFilter || undefined,
      page, limit: 25,
    }).then(r => r),
    placeholderData: (prev: any) => prev,
    enabled: tab === 'inquiries',
  })

  const { data: stats } = useQuery({
    queryKey: ['inquiry-stats'],
    queryFn: () => admissionApi.inquiries.stats().then(r => r.data),
  })

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: applications, isLoading: appsLoading } = useQuery({
    queryKey: ['admission-applications'],
    queryFn: () => admissionApi.applications.list().then(r => r.data),
    enabled: tab === 'applications',
  })

  const meta = inquiries?.meta ?? { total: 0, page: 1, limit: 25 }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'inquiries' | 'applications')} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admission CRM</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {stats?.total ?? 0} inquiries · {stats?.conversion_rate ?? 0}% conversion rate
          </p>
        </div>
        {tab === 'inquiries' ? (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> New Inquiry
          </Button>
        ) : (
          <Button onClick={() => setShowNewApp(true)}>
            <Plus className="w-4 h-4" /> New Application
          </Button>
        )}
      </div>

      {/* Tabs: Inquiries (CRM) vs Applications (formal, workflow-driven) */}
      <TabsList>
        <TabsTrigger value="inquiries">Inquiries</TabsTrigger>
        <TabsTrigger value="applications" className="gap-1.5">
          <FileCheck className="w-3.5 h-3.5" /> Applications
        </TabsTrigger>
      </TabsList>

      <TabsContent value="inquiries" className="space-y-6 mt-0">
        {/* Visual pipeline + source breakdown */}
        <PipelineCharts stats={stats} />

        {/* Pipeline stats */}
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {PIPELINE_STAGES.map(stage => {
            const count = stats?.by_status?.find((s: any) => s.status === stage.key)?.count ?? 0
            return (
              <button key={stage.key}
                onClick={() => setStatus(statusFilter === stage.key ? '' : stage.key)}
                className={cn('bg-card rounded-xl border p-3 text-center transition-all hover:shadow-sm',
                  statusFilter === stage.key ? 'border-primary ring-2 ring-primary/20' : 'border-border')}>
                <p className="text-xl font-bold text-foreground">{count}</p>
                <span className={cn('inline-block mt-1 px-1.5 py-0.5 rounded-full text-xs font-medium', stage.color)}>
                  {stage.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <Card className="p-4 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input type="text" placeholder="Search by student or parent name..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="pl-9" />
          </div>
          <Select value={statusFilter || '__all__'}
            onValueChange={v => { setStatus(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-auto min-w-[160px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Status</SelectItem>
              {INQUIRY_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusFilter && (
            <Button variant="outline" onClick={() => setStatus('')}>Clear filter</Button>
          )}
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (inquiries?.data ?? []).length === 0 ? (
            <EmptyState
              icon={Search}
              title="No inquiries found"
              description={statusFilter ? 'Try clearing the filter' : 'Add your first inquiry to start tracking admissions'}
              className="py-16"
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="uppercase text-xs tracking-wide">Student</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Parent</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Class</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Source</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Counselor</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Status</TableHead>
                    <TableHead className="uppercase text-xs tracking-wide">Date</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(inquiries?.data ?? []).map((inq: any) => (
                    <TableRow key={inq.id} className="group cursor-default">
                      <TableCell>
                        <p className="font-semibold text-foreground">{inq.student_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{inq.inquiry_number}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-foreground font-medium">{inq.parent_name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{inq.parent_phone}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inq.classes?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{inq.inquiry_sources?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{inq.users?.full_name ?? 'Unassigned'}</TableCell>
                      <TableCell>
                        <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                          STATUS_COLORS[inq.status] ?? 'bg-muted text-muted-foreground')}>
                          {inq.status.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(inq.created_at)}</TableCell>
                      <TableCell>
                        <Link href={`/admission/${inq.id}`}
                          className="flex items-center gap-1 text-xs text-primary font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:text-primary/80">
                          View <ChevronRight className="w-3 h-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {meta.total > meta.limit && (
                <div className="px-5 py-3.5 border-t border-border flex items-center justify-between text-sm text-muted-foreground bg-muted/30">
                  <p className="text-xs">Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * meta.limit >= meta.total}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </TabsContent>

      {/* Applications tab — formal applications going through the
          Admission Approval Workflow (Counselor -> Accountant -> Principal) */}
      <TabsContent value="applications" className="mt-0">
        <Card className="overflow-hidden">
          {appsLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (applications ?? []).length === 0 ? (
            <EmptyState
              icon={FileCheck}
              title="No applications yet"
              description="Applications go through Counselor → Accountant → Principal approval"
              className="py-16"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="uppercase text-xs tracking-wide">Application #</TableHead>
                  <TableHead className="uppercase text-xs tracking-wide">Student</TableHead>
                  <TableHead className="uppercase text-xs tracking-wide">Parent Phone</TableHead>
                  <TableHead className="uppercase text-xs tracking-wide">Status</TableHead>
                  <TableHead className="uppercase text-xs tracking-wide">Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(applications ?? []).map((app: any) => (
                  <TableRow key={app.id} className="group"
                    onClick={() => window.location.href = `/admission/applications/${app.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{app.application_number}</TableCell>
                    <TableCell className="font-semibold text-foreground">{app.student_first_name} {app.student_last_name}</TableCell>
                    <TableCell className="text-muted-foreground">{app.father_phone}</TableCell>
                    <TableCell>
                      <Badge variant={APP_STATUS_VARIANTS[app.status] ?? 'secondary'} className="capitalize">{app.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(app.created_at)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-xs text-primary font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        View <ChevronRight className="w-3 h-3" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </TabsContent>

      {showNewForm && (
        <NewInquiryModal
          classes={classesData ?? []}
          onClose={() => setShowNew(false)}
        />
      )}

      {showNewApp && (
        <NewApplicationModal
          classes={classesData ?? []}
          onClose={() => setShowNewApp(false)}
        />
      )}
    </Tabs>
  )
}

function NewInquiryModal({ classes, onClose }: { classes: any[], onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    student_name: '', parent_name: '', parent_phone: '', parent_email: '',
    gender: '', notes: '', applying_for_class_id: '', previous_school: '',
    budget_range: '', source_id: '',
  })

  // Was previously a dead stub — called the unrelated inquiries list
  // endpoint, threw the result away, and always resolved to []. No
  // Source field was ever rendered for it either, so every inquiry
  // created through this form got source_id: null regardless of what a
  // counselor might have picked, forever.
  const { data: sourcesData } = useQuery({
    queryKey: ['inquiry-sources'],
    queryFn: () => admissionApi.inquiries.sources.list().then(r => r.data),
  })
  const [addingSource, setAddingSource] = useState(false)
  const [newSourceName, setNewSourceName] = useState('')
  const addSourceMutation = useMutation({
    mutationFn: (name: string) => admissionApi.inquiries.sources.create(name),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['inquiry-sources'] })
      setForm(f => ({ ...f, source_id: res.data.id }))
      setAddingSource(false)
      setNewSourceName('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add source'),
  })
  const addSource = () => newSourceName.trim() && addSourceMutation.mutate(newSourceName.trim())

  const mutation = useMutation({
    mutationFn: (data: any) => admissionApi.inquiries.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inquiries'] })
      qc.invalidateQueries({ queryKey: ['inquiry-stats'] })
      toast.success('Inquiry created successfully')
      onClose()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to create inquiry'),
  })

  const Field = ({ label, children, span = 1 }: { label: string, children: React.ReactNode, span?: number }) => (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Admission Inquiry</DialogTitle>
          <DialogDescription>Log a new admission inquiry from a parent</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Student Name *" span={2}>
            <Input value={form.student_name}
              onChange={e => setForm(f => ({ ...f, student_name: e.target.value }))}
              placeholder="Full name of the student" />
          </Field>
          <Field label="Parent Name *">
            <Input value={form.parent_name}
              onChange={e => setForm(f => ({ ...f, parent_name: e.target.value }))}
              placeholder="Father / Mother name" />
          </Field>
          <Field label="Parent Phone *">
            <Input value={form.parent_phone}
              onChange={e => setForm(f => ({ ...f, parent_phone: e.target.value }))}
              placeholder="+91 98765 43210" />
          </Field>
          <Field label="Parent Email">
            <Input type="email" value={form.parent_email}
              onChange={e => setForm(f => ({ ...f, parent_email: e.target.value }))}
              placeholder="parent@email.com" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Applying for Class">
            <Select value={form.applying_for_class_id} onValueChange={v => setForm(f => ({ ...f, applying_for_class_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Previous School">
            <Input value={form.previous_school}
              onChange={e => setForm(f => ({ ...f, previous_school: e.target.value }))}
              placeholder="Current/previous school name" />
          </Field>
          <Field label="Budget Range">
            <Select value={form.budget_range} onValueChange={v => setForm(f => ({ ...f, budget_range: v }))}>
              <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Under 50k">Under ₹50,000/yr</SelectItem>
                <SelectItem value="50k-1L">₹50,000 - ₹1,00,000/yr</SelectItem>
                <SelectItem value="1L-2L">₹1,00,000 - ₹2,00,000/yr</SelectItem>
                <SelectItem value="Above 2L">Above ₹2,00,000/yr</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="How did they hear about us?">
            {addingSource ? (
              <div className="flex gap-2">
                <Input value={newSourceName} autoFocus
                  onChange={e => setNewSourceName(e.target.value)}
                  placeholder="e.g. Newspaper Ad"
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSource())} />
                <Button type="button" variant="ghost" onClick={addSource} disabled={addSourceMutation.isPending || !newSourceName.trim()}
                  className="text-primary hover:text-primary whitespace-nowrap px-3">
                  {addSourceMutation.isPending ? '...' : 'Save'}
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => { setAddingSource(false); setNewSourceName('') }}
                  aria-label="Cancel adding source">✕</Button>
              </div>
            ) : (
              <Select value={form.source_id}
                onValueChange={v => {
                  if (v === '__add_new__') { setAddingSource(true); return }
                  setForm(f => ({ ...f, source_id: v }))
                }}>
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  {(sourcesData ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  <SelectItem value="__add_new__">+ Add new source...</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Notes" span={2}>
            <Textarea rows={3} className="resize-none" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes about this inquiry..." />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.student_name || !form.parent_name || !form.parent_phone}>
            {mutation.isPending ? 'Creating...' : 'Create Inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewApplicationModal({ classes, onClose }: { classes: any[], onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    student_first_name: '', student_last_name: '', father_name: '', father_phone: '',
    mother_name: '', mother_phone: '', applying_for_class_id: '', date_of_birth: '', gender: '',
  })

  const mutation = useMutation({
    mutationFn: (data: any) => admissionApi.applications.create(data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['admission-applications'] })
      toast.success('Application created — workflow started automatically')
      const newId = res?.data?.id
      if (newId) {
        window.location.href = `/admission/applications/${newId}`
      } else {
        onClose()
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to create application'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Admission Application</DialogTitle>
          <DialogDescription>Starts the Counselor → Accountant → Principal approval workflow automatically</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="app-fn" className="mb-1.5 block">Student First Name *</Label>
            <Input id="app-fn" value={form.student_first_name}
              onChange={e => setForm(f => ({ ...f, student_first_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="app-ln" className="mb-1.5 block">Student Last Name *</Label>
            <Input id="app-ln" value={form.student_last_name}
              onChange={e => setForm(f => ({ ...f, student_last_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="app-father" className="mb-1.5 block">Father's Name</Label>
            <Input id="app-father" value={form.father_name}
              onChange={e => setForm(f => ({ ...f, father_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="app-father-phone" className="mb-1.5 block">Father's Phone *</Label>
            <Input id="app-father-phone" value={form.father_phone}
              onChange={e => setForm(f => ({ ...f, father_phone: e.target.value }))} placeholder="10-digit phone" />
          </div>
          <div>
            <Label htmlFor="app-mother" className="mb-1.5 block">Mother's Name</Label>
            <Input id="app-mother" value={form.mother_name}
              onChange={e => setForm(f => ({ ...f, mother_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="app-mother-phone" className="mb-1.5 block">Mother's Phone</Label>
            <Input id="app-mother-phone" value={form.mother_phone}
              onChange={e => setForm(f => ({ ...f, mother_phone: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="app-dob" className="mb-1.5 block">Date of Birth</Label>
            <Input id="app-dob" type="date" value={form.date_of_birth}
              onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
          </div>
          <div>
            <Label className="mb-1.5 block">Gender</Label>
            <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block">Applying for Class</Label>
            <Select value={form.applying_for_class_id} onValueChange={v => setForm(f => ({ ...f, applying_for_class_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? undefined : v]))
              mutation.mutate(clean)
            }}
            disabled={mutation.isPending || !form.student_first_name || !form.student_last_name || !form.father_phone}>
            {mutation.isPending ? 'Creating...' : 'Create Application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
