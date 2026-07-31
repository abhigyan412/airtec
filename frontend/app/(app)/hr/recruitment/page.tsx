'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi, teamApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Phone, Star, Briefcase, Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'

// Stage colours are categorical — they identify a step in the hiring pipeline,
// not a good/bad state — so they stay outside the semantic token scale. Each
// entry uses the `bg-<hue>-500/10 + text-<hue>-600 dark:text-<hue>-400` form so
// it stays legible in both themes.
const STAGES = [
  { key: 'applied',             label: 'Applied',     color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25' },
  { key: 'shortlisted',         label: 'Shortlisted', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25' },
  { key: 'interview_scheduled', label: 'Interview',   color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25' },
  { key: 'interviewed',         label: 'Interviewed', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25' },
  { key: 'selected',            label: 'Selected',    color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25' },
  { key: 'offer_sent',          label: 'Offer Sent',  color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25' },
  { key: 'joined',              label: 'Joined',      color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
]

export default function RecruitmentPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showJobModal, setShowJobModal] = useState(false)
  const [showCandidateModal, setShowCandidateModal] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null)
  const [joiningCandidate, setJoiningCandidate] = useState<any>(null)
  const [jobFilter, setJobFilter] = useState('')

  const canApproveOffer = ['school_admin', 'principal'].includes(user?.role ?? '')

  const { data: jobsData } = useQuery({
    queryKey: ['job-postings'],
    queryFn: () => hrmsApi.jobPostings.list().then(r => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['application-stats'],
    queryFn: () => hrmsApi.applications.stats().then(r => r.data),
  })

  const { data: applications, isLoading } = useQuery({
    queryKey: ['applications', jobFilter],
    queryFn: () => hrmsApi.applications.list({ job_posting_id: jobFilter || undefined }).then(r => r.data),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.applications.update(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] })
      qc.invalidateQueries({ queryKey: ['application-stats'] })
      toast.success('Candidate moved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to move candidate'),
  })

  const byStage: Record<string, any[]> = {}
  for (const s of STAGES) byStage[s.key] = []
  for (const app of applications ?? []) {
    if (byStage[app.status]) byStage[app.status].push(app)
    else if (['rejected','withdrawn'].includes(app.status)) { /* skip from board */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Recruitment"
          description="Apply → Shortlist → Interview → Selection → Joining"
          icon={UserPlus}
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/hr/recruitment/jobs"><Briefcase className="h-4 w-4" /> Manage Jobs</Link>
              </Button>
              <Button variant="outline" onClick={() => setShowJobModal(true)}>
                <Briefcase className="h-4 w-4" /> New Job Posting
              </Button>
              <Button onClick={() => setShowCandidateModal(true)}>
                <Plus className="h-4 w-4" /> Add Candidate
              </Button>
            </>
          }
        />
      </div>

      {!canApproveOffer && (
        <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          Only School Admin or Principal can approve sending an offer to a selected candidate.
        </div>
      )}

      {/* Job posting filter pills */}
      {jobsData && jobsData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setJobFilter('')}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              !jobFilter ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
            All Positions
          </button>
          {jobsData.map((j: any) => (
            <button key={j.id} onClick={() => setJobFilter(jobFilter === j.id ? '' : j.id)}
              className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                jobFilter === j.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
              {j.title}
              <span className={cn('rounded-full px-1.5 text-xs', jobFilter === j.id ? 'bg-primary-foreground/20' : 'bg-muted')}>{j.application_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pipeline stats */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {STAGES.map(stage => {
          const count = stats?.by_status?.find((s: any) => s.status === stage.key)?.count ?? 0
          return (
            <Card key={stage.key} className="p-3 text-center">
              <p className="text-xl font-bold tabular-nums text-foreground">{count}</p>
              <span className={cn('mt-1 inline-block rounded-full border px-1.5 py-0.5 text-xs font-medium', stage.color)}>{stage.label}</span>
            </Card>
          )
        })}
      </div>

      {/* Kanban board */}
      {isLoading ? (
        // Same shape as the board: seven fixed-width columns, each a stage
        // header plus a couple of candidate cards.
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4">
            {STAGES.map(stage => (
              <div key={stage.key} className="w-72 flex-shrink-0">
                <Skeleton className="mb-3 h-[42px] w-full rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-[104px] w-full rounded-xl" />
                  <Skeleton className="h-[104px] w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (applications ?? []).length === 0 ? (
        <Card>
          {jobFilter ? (
            <EmptyState
              icon={Users}
              title="No candidates for this position"
              description="Nobody has applied to this job posting yet. Clear the filter to see the whole pipeline, or add a candidate against this posting."
              action={
                <Button variant="outline" onClick={() => setJobFilter('')}>Show all positions</Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No candidates in the pipeline"
              description="Add a candidate to start tracking them through Apply → Shortlist → Interview → Selection → Joining."
              action={
                <Button onClick={() => setShowCandidateModal(true)}>
                  <Plus className="h-4 w-4" /> Add Candidate
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4">
            {STAGES.map(stage => (
              <div key={stage.key} className="w-72 flex-shrink-0">
                <div className={cn('mb-3 flex items-center justify-between rounded-xl border px-3 py-2', stage.color)}>
                  <span className="text-sm font-semibold">{stage.label}</span>
                  <span className="rounded-full bg-background/60 px-2 py-0.5 text-xs font-bold">{byStage[stage.key]?.length ?? 0}</span>
                </div>
                <div className="space-y-2">
                  {(byStage[stage.key] ?? []).map((cand: any) => {
                    // The 'selected' -> 'offer_sent' move needs admin/principal
                    // approval. For everyone else on a 'selected' card, the
                    // quick-move dropdown excludes 'offer_sent' and a note
                    // explains why. Approvers see a dedicated button instead
                    // of the generic dropdown for this specific transition.
                    const isSelectedStage = stage.key === 'selected'
                    const moveOptions = [...STAGES.map(s => s.key), 'rejected', 'withdrawn']
                      .filter(s => !(isSelectedStage && s === 'offer_sent' && !canApproveOffer))

                    return (
                      <div key={cand.id} onClick={() => setSelectedCandidate(cand)}
                        role="button"
                        tabIndex={0}
                        // Guarded on currentTarget so Enter/Space inside the
                        // nested quick-move Select doesn't reopen the card.
                        onKeyDown={e => {
                          if (e.target !== e.currentTarget) return
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCandidate(cand) }
                        }}
                        className="group cursor-pointer rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{cand.candidate_name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{cand.application_number}</p>
                          </div>
                          {cand.rating && (
                            <div className="flex flex-shrink-0 items-center gap-0.5 text-amber-500 dark:text-amber-400">
                              <Star className="h-3 w-3 fill-current" />
                              <span className="text-xs font-semibold">{cand.rating}</span>
                            </div>
                          )}
                        </div>
                        {cand.job_postings?.title && <p className="mt-1.5 text-xs font-medium text-primary">{cand.job_postings.title}</p>}
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {cand.phone}
                        </div>
                        {cand.experience_years != null && (
                          <p className="mt-1 text-xs text-muted-foreground">{cand.experience_years} yrs exp</p>
                        )}

                        {/* Approve & Send Offer — only for 'selected' candidates, only for approvers */}
                        {isSelectedStage && canApproveOffer && (
                          <Button size="sm" variant="secondary" className="mt-2 w-full"
                            onClick={e => { e.stopPropagation(); moveMutation.mutate({ id: cand.id, status: 'offer_sent' }) }}
                            disabled={moveMutation.isPending}>
                            {moveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Approve & Send Offer
                          </Button>
                        )}
                        {isSelectedStage && !canApproveOffer && (
                          <p className="mt-2 text-center text-xs text-muted-foreground">Awaiting admin/principal approval to send offer</p>
                        )}

                        {/* Quick move */}
                        <div onClick={e => e.stopPropagation()} className="mt-2 border-t border-border pt-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <Select
                            value={cand.status}
                            onValueChange={(newStatus) => {
                              if (newStatus === 'joined') {
                                if (!cand.email) {
                                  toast.error('Add an email for this candidate first (open their card → Email field) — it\'s needed to create their login.')
                                  return
                                }
                                setJoiningCandidate(cand)
                              } else {
                                moveMutation.mutate({ id: cand.id, status: newStatus })
                              }
                            }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {moveOptions.map(s => (
                                <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )
                  })}
                  {(byStage[stage.key] ?? []).length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      No candidates
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showJobModal && (
        <JobPostingModal onClose={() => { setShowJobModal(false); qc.invalidateQueries({ queryKey: ['job-postings'] }) }} />
      )}

      {showCandidateModal && (
        <CandidateModal jobs={jobsData ?? []} onClose={() => {
          setShowCandidateModal(false)
          qc.invalidateQueries({ queryKey: ['applications'] })
          qc.invalidateQueries({ queryKey: ['application-stats'] })
        }} />
      )}

      {selectedCandidate && (
        <CandidateDetailModal candidate={selectedCandidate} onClose={() => {
          setSelectedCandidate(null)
          qc.invalidateQueries({ queryKey: ['applications'] })
        }} />
      )}

      {joiningCandidate && (
        <JoinedRoleModal candidate={joiningCandidate} onClose={() => {
          setJoiningCandidate(null)
          qc.invalidateQueries({ queryKey: ['applications'] })
          qc.invalidateQueries({ queryKey: ['application-stats'] })
        }} />
      )}
    </div>
  )
}

function JobPostingModal({ onClose }: { onClose: () => void }) {
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

function CandidateModal({ jobs, onClose }: { jobs: any[], onClose: () => void }) {
  const [form, setForm] = useState({ candidate_name: '', email: '', phone: '', job_posting_id: '', experience_years: '', current_designation: '', expected_salary: '', notice_period: '', source: '', resume_url: '' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.candidate_name || !form.phone) return toast.error('Name and phone required')
    setLoading(true)
    try {
      await hrmsApi.applications.create({
        ...form,
        experience_years: form.experience_years ? Number(form.experience_years) : undefined,
        expected_salary: form.expected_salary ? Number(form.expected_salary) : undefined,
        job_posting_id: form.job_posting_id || undefined,
      })
      toast.success('Candidate added')
      onClose()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Candidate</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>Candidate Name *</Label>
            <Input value={form.candidate_name} onChange={e => setForm(f => ({ ...f, candidate_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone *</Label>
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Applying For</Label>
            <Select value={form.job_posting_id || '__general__'} onValueChange={v => setForm(f => ({ ...f, job_posting_id: v === '__general__' ? '' : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__general__">General application</SelectItem>
                {jobs.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Current Designation</Label>
            <Input value={form.current_designation} onChange={e => setForm(f => ({ ...f, current_designation: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Experience (years)</Label>
            <Input type="number" value={form.experience_years} onChange={e => setForm(f => ({ ...f, experience_years: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Expected Salary</Label>
            <Input type="number" value={form.expected_salary} onChange={e => setForm(f => ({ ...f, expected_salary: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Notice Period</Label>
            <Input value={form.notice_period} onChange={e => setForm(f => ({ ...f, notice_period: e.target.value }))} placeholder="e.g. 30 days" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Source</Label>
            <Select value={form.source || '__none__'} onValueChange={v => setForm(f => ({ ...f, source: v === '__none__' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select source</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="naukri">Naukri</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="walk_in">Walk-in</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Add Candidate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CandidateDetailModal({ candidate, onClose }: { candidate: any, onClose: () => void }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState(candidate.notes ?? '')
  const [email, setEmail] = useState(candidate.email ?? '')
  const [rating, setRating] = useState(candidate.rating ?? '')
  const [interviewDate, setInterviewDate] = useState(candidate.interview_date ? candidate.interview_date.slice(0,16) : '')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      await hrmsApi.applications.update(candidate.id, {
        notes, rating: rating ? Number(rating) : undefined,
        interview_date: interviewDate || undefined,
        email: email || undefined,
      })
      toast.success('Updated')
      qc.invalidateQueries({ queryKey: ['applications'] })
      onClose()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{candidate.candidate_name}</DialogTitle>
          <p className="font-mono text-xs text-muted-foreground">{candidate.application_number}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {candidate.phone}</div>
            {candidate.job_postings?.title && <div className="col-span-2"><span className="text-xs text-muted-foreground">Position: </span><span className="font-medium text-primary">{candidate.job_postings.title}</span></div>}
            {candidate.current_designation && <div className="text-foreground"><span className="text-xs text-muted-foreground">Current Role: </span>{candidate.current_designation}</div>}
            {candidate.experience_years != null && <div className="text-foreground"><span className="text-xs text-muted-foreground">Experience: </span>{candidate.experience_years} yrs</div>}
            {candidate.expected_salary && <div className="text-foreground"><span className="text-xs text-muted-foreground">Expected Salary: </span>{formatCurrency(Number(candidate.expected_salary))}</div>}
            {candidate.notice_period && <div className="text-foreground"><span className="text-xs text-muted-foreground">Notice Period: </span>{candidate.notice_period}</div>}
          </div>

          <div className="space-y-1.5">
            <Label>
              Email {!email && <span className="font-normal text-warning">(required before marking as Joined)</span>}
            </Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="candidate@example.com" />
          </div>

          <div className="space-y-1.5">
            <Label>Interview Date & Time</Label>
            <Input type="datetime-local" value={interviewDate} onChange={e => setInterviewDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Rating (1-5)</Label>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(r => (
                <button key={r} onClick={() => setRating(r)}
                  aria-label={`Rate ${r} out of 5`}
                  aria-pressed={Number(rating) === r}
                  className={cn('flex h-10 w-10 items-center justify-center rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', Number(rating) === r ? 'border-amber-500/60 bg-amber-500/10' : 'border-border hover:border-amber-500/40')}>
                  <Star className={cn('h-4 w-4', Number(rating) >= r ? 'fill-current text-amber-500 dark:text-amber-400' : 'text-muted-foreground')} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes / Interview Feedback</Label>
            <Textarea rows={4} className="resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes about this candidate..." />
          </div>

          {candidate.application_status_history?.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Timeline</p>
              <div className="space-y-2">
                {candidate.application_status_history.map((h: any) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="font-medium capitalize text-foreground">{h.status.replace('_',' ')}</span>
                    <span>· {formatDate(h.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════
// "Joined" flow — confirm role, then offer immediate login creation
// ═══════════════════════════════════════════════════════════════

function guessRoleFromDesignation(designation?: string, department?: string): string {
  const text = `${designation ?? ''} ${department ?? ''}`.toLowerCase()
  if (text.includes('account') || text.includes('finance')) return 'accountant'
  if (text.includes('counsel') || text.includes('admission')) return 'counselor'
  if (text.includes('principal') || text.includes('head')) return 'principal'
  if (text.includes('admin')) return 'school_admin'
  return 'teacher'
}

const JOIN_ROLE_LABELS: Record<string, string> = {
  school_admin: 'School Admin',
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  counselor: 'Counselor',
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function JoinedRoleModal({ candidate, onClose }: { candidate: any, onClose: () => void }) {
  const [role, setRole] = useState(guessRoleFromDesignation(candidate.current_designation, candidate.job_postings?.department))
  const [step, setStep] = useState<'role' | 'login'>('role')
  const [loading, setLoading] = useState(false)
  const [newUserId, setNewUserId] = useState<string | null>(null)
  const [password, setPassword] = useState(generatePassword())
  const [credentials, setCredentials] = useState<{ email: string, password: string } | null>(null)

  const handleConfirmRole = async () => {
    setLoading(true)
    try {
      const res = await hrmsApi.applications.update(candidate.id, { status: 'joined', role })
      const userId = res.data?.new_user_id
      toast.success('Candidate marked as joined')
      if (userId) {
        setNewUserId(userId)
        setStep('login')
      } else {
        onClose()
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateLogin = async () => {
    if (!newUserId) return
    setLoading(true)
    try {
      await teamApi.resetLogin(newUserId, password)
      setCredentials({ email: candidate.email, password })
      toast.success('Login created')
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{step === 'role' ? `Welcome ${candidate.candidate_name}!` : 'Set up login'}</DialogTitle>
        </DialogHeader>

        {step === 'role' ? (
          <>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Confirm their role so they show up correctly under Team Members with the right permissions.
              </p>
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(JOIN_ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                {candidate.current_designation && (
                  <p className="mt-1.5 text-xs text-muted-foreground">Based on designation: "{candidate.current_designation}"</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleConfirmRole} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Confirm & Add to Team
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {credentials ? (
                <div className="rounded-xl border border-success/20 bg-success/10 p-4">
                  <p className="mb-2 text-sm font-semibold text-success">Login created! Share these credentials:</p>
                  <div className="space-y-1 rounded-lg bg-card p-3 font-mono text-sm">
                    <p><span className="text-muted-foreground">Email:</span> {credentials.email}</p>
                    <p><span className="text-muted-foreground">Password:</span> {credentials.password}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {candidate.candidate_name} has been added to Team Members as {JOIN_ROLE_LABELS[role]}. Create a login now so they can sign in right away — or skip and do it later from Team & Settings.
                  </p>
                  <div className="space-y-1.5">
                    <Label>Temporary Password</Label>
                    <div className="flex gap-2">
                      <Input className="font-mono" value={password} onChange={e => setPassword(e.target.value)} />
                      <Button variant="outline" className="whitespace-nowrap" onClick={() => setPassword(generatePassword())}>
                        Regenerate
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              {credentials ? (
                <Button onClick={onClose}>Done</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={onClose}>Skip for now</Button>
                  <Button onClick={handleCreateLogin} disabled={loading}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create Login
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
