'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi, teamApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Phone, Mail, Star, Briefcase, X, Loader2, ChevronDown, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STAGES = [
  { key: 'applied',             label: 'Applied',     color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'shortlisted',         label: 'Shortlisted', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { key: 'interview_scheduled', label: 'Interview',   color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'interviewed',         label: 'Interviewed', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  { key: 'selected',            label: 'Selected',    color: 'bg-teal-100 text-teal-700 border-teal-200' },
  { key: 'offer_sent',          label: 'Offer Sent',  color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'joined',              label: 'Joined',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
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
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recruitment</h1>
            <p className="text-gray-500 text-sm mt-0.5">Apply → Shortlist → Interview → Selection → Joining</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/hr/recruitment/jobs"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
            <Briefcase className="w-4 h-4" /> Manage Jobs
          </Link>
          <button onClick={() => setShowJobModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
            <Briefcase className="w-4 h-4" /> New Job Posting
          </button>
          <button onClick={() => setShowCandidateModal(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
            <Plus className="w-4 h-4" /> Add Candidate
          </button>
        </div>
      </div>

      {!canApproveOffer && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-xl px-4 py-2.5">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
          Only School Admin or Principal can approve sending an offer to a selected candidate.
        </div>
      )}

      {/* Job posting filter pills */}
      {jobsData && jobsData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setJobFilter('')}
            className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
              !jobFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300')}>
            All Positions
          </button>
          {jobsData.map((j: any) => (
            <button key={j.id} onClick={() => setJobFilter(jobFilter === j.id ? '' : j.id)}
              className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5',
                jobFilter === j.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300')}>
              {j.title}
              <span className={cn('px-1.5 rounded-full text-xs', jobFilter === j.id ? 'bg-white/20' : 'bg-gray-100')}>{j.application_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pipeline stats */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {STAGES.map(stage => {
          const count = stats?.by_status?.find((s: any) => s.status === stage.key)?.count ?? 0
          return (
            <div key={stage.key} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{count}</p>
              <span className={cn('inline-block mt-1 px-1.5 py-0.5 rounded-full text-xs font-medium', stage.color)}>{stage.label}</span>
            </div>
          )
        })}
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map(stage => (
              <div key={stage.key} className="w-72 flex-shrink-0">
                <div className={cn('rounded-xl px-3 py-2 mb-3 flex items-center justify-between border', stage.color)}>
                  <span className="text-sm font-semibold">{stage.label}</span>
                  <span className="text-xs font-bold bg-white/60 px-2 py-0.5 rounded-full">{byStage[stage.key]?.length ?? 0}</span>
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
                        className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:shadow-md hover:border-indigo-200 transition-all group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 text-sm truncate">{cand.candidate_name}</p>
                            <p className="text-xs text-gray-400 font-mono">{cand.application_number}</p>
                          </div>
                          {cand.rating && (
                            <div className="flex items-center gap-0.5 text-amber-500 flex-shrink-0">
                              <Star className="w-3 h-3 fill-current" />
                              <span className="text-xs font-semibold">{cand.rating}</span>
                            </div>
                          )}
                        </div>
                        {cand.job_postings?.title && <p className="text-xs text-indigo-600 font-medium mt-1.5">{cand.job_postings.title}</p>}
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                          <Phone className="w-3 h-3" /> {cand.phone}
                        </div>
                        {cand.experience_years != null && (
                          <p className="text-xs text-gray-400 mt-1">{cand.experience_years} yrs exp</p>
                        )}

                        {/* Approve & Send Offer — only for 'selected' candidates, only for approvers */}
                        {isSelectedStage && canApproveOffer && (
                          <button
                            onClick={e => { e.stopPropagation(); moveMutation.mutate({ id: cand.id, status: 'offer_sent' }) }}
                            disabled={moveMutation.isPending}
                            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100 disabled:opacity-50">
                            {moveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Approve & Send Offer
                          </button>
                        )}
                        {isSelectedStage && !canApproveOffer && (
                          <p className="mt-2 text-xs text-gray-400 text-center">Awaiting admin/principal approval to send offer</p>
                        )}

                        {/* Quick move */}
                        <div className="mt-2 pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <select
                            value={cand.status}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              e.stopPropagation()
                              const newStatus = e.target.value
                              if (newStatus === 'joined') {
                                if (!cand.email) {
                                  toast.error('Add an email for this candidate first (open their card → Email field) — it\'s needed to create their login.')
                                  return
                                }
                                setJoiningCandidate(cand)
                              } else {
                                moveMutation.mutate({ id: cand.id, status: newStatus })
                              }
                            }}
                            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-gray-50 focus:outline-none">
                            {moveOptions.map(s => (
                              <option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                  {(byStage[stage.key] ?? []).length === 0 && (
                    <div className="border-2 border-dashed border-gray-100 rounded-xl p-6 text-center text-xs text-gray-300">
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
  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New Job Posting</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Job Title *</label>
            <input className={ic} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Mathematics Teacher" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
              <input className={ic} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Academics" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Designation</label>
              <input className={ic} value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. PGT Mathematics" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Employment Type</label>
              <select className={ic} value={form.employment_type} onChange={e => setForm(f => ({ ...f, employment_type: e.target.value }))}>
                <option value="full_time">Full Time</option><option value="part_time">Part Time</option><option value="contract">Contract</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Vacancies</label>
              <input type="number" min="1" className={ic} value={form.vacancies} onChange={e => setForm(f => ({ ...f, vacancies: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Experience Required</label>
              <input className={ic} value={form.experience_required} onChange={e => setForm(f => ({ ...f, experience_required: e.target.value }))} placeholder="e.g. 2-5 years" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Salary Range</label>
              <input className={ic} value={form.salary_range} onChange={e => setForm(f => ({ ...f, salary_range: e.target.value }))} placeholder="e.g. 30k-45k" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea rows={3} className={ic + ' resize-none'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Create Posting
          </button>
        </div>
      </div>
    </div>
  )
}

function CandidateModal({ jobs, onClose }: { jobs: any[], onClose: () => void }) {
  const [form, setForm] = useState({ candidate_name: '', email: '', phone: '', job_posting_id: '', experience_years: '', current_designation: '', expected_salary: '', notice_period: '', source: '', resume_url: '' })
  const [loading, setLoading] = useState(false)
  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Candidate</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Candidate Name *</label>
              <input className={ic} value={form.candidate_name} onChange={e => setForm(f => ({ ...f, candidate_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone *</label>
              <input className={ic} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input type="email" className={ic} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Applying For</label>
              <select className={ic} value={form.job_posting_id} onChange={e => setForm(f => ({ ...f, job_posting_id: e.target.value }))}>
                <option value="">General application</option>
                {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Current Designation</label>
              <input className={ic} value={form.current_designation} onChange={e => setForm(f => ({ ...f, current_designation: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Experience (years)</label>
              <input type="number" className={ic} value={form.experience_years} onChange={e => setForm(f => ({ ...f, experience_years: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Expected Salary</label>
              <input type="number" className={ic} value={form.expected_salary} onChange={e => setForm(f => ({ ...f, expected_salary: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notice Period</label>
              <input className={ic} value={form.notice_period} onChange={e => setForm(f => ({ ...f, notice_period: e.target.value }))} placeholder="e.g. 30 days" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Source</label>
              <select className={ic} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                <option value="">Select source</option>
                <option value="referral">Referral</option><option value="naukri">Naukri</option><option value="linkedin">LinkedIn</option>
                <option value="walk_in">Walk-in</option><option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Add Candidate
          </button>
        </div>
      </div>
    </div>
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

  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{candidate.candidate_name}</h2>
            <p className="text-xs text-gray-400 font-mono">{candidate.application_number}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-600"><Phone className="w-3.5 h-3.5 text-gray-400" /> {candidate.phone}</div>
            {candidate.job_postings?.title && <div className="col-span-2"><span className="text-xs text-gray-400">Position: </span><span className="font-medium text-indigo-600">{candidate.job_postings.title}</span></div>}
            {candidate.current_designation && <div><span className="text-xs text-gray-400">Current Role: </span>{candidate.current_designation}</div>}
            {candidate.experience_years != null && <div><span className="text-xs text-gray-400">Experience: </span>{candidate.experience_years} yrs</div>}
            {candidate.expected_salary && <div><span className="text-xs text-gray-400">Expected Salary: </span>₹{Number(candidate.expected_salary).toLocaleString('en-IN')}</div>}
            {candidate.notice_period && <div><span className="text-xs text-gray-400">Notice Period: </span>{candidate.notice_period}</div>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email {!email && <span className="text-amber-600 font-normal">(required before marking as Joined)</span>}
            </label>
            <input type="email" className={ic} value={email} onChange={e => setEmail(e.target.value)} placeholder="candidate@example.com" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Interview Date & Time</label>
            <input type="datetime-local" className={ic} value={interviewDate} onChange={e => setInterviewDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rating (1-5)</label>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(r => (
                <button key={r} onClick={() => setRating(r)}
                  className={cn('w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all', Number(rating) === r ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-amber-200')}>
                  <Star className={cn('w-4 h-4', Number(rating) >= r ? 'text-amber-400 fill-current' : 'text-gray-300')} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes / Interview Feedback</label>
            <textarea rows={4} className={ic + ' resize-none'} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes about this candidate..." />
          </div>

          {candidate.application_status_history?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Timeline</p>
              <div className="space-y-2">
                {candidate.application_status_history.map((h: any) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    <span className="font-medium text-gray-700 capitalize">{h.status.replace('_',' ')}</span>
                    <span>· {formatDate(h.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Close</button>
          <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
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

  const ic = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'role' ? `Welcome ${candidate.candidate_name}!` : 'Set up login'}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {step === 'role' ? (
          <>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                Confirm their role so they show up correctly under Team Members with the right permissions.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Role *</label>
                <select className={ic} value={role} onChange={e => setRole(e.target.value)}>
                  {Object.entries(JOIN_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {candidate.current_designation && (
                  <p className="text-xs text-gray-400 mt-1.5">Based on designation: "{candidate.current_designation}"</p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
              <button onClick={handleConfirmRole} disabled={loading}
                className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Confirm & Add to Team
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              {credentials ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-emerald-800 mb-2">Login created! Share these credentials:</p>
                  <div className="bg-white rounded-lg p-3 font-mono text-sm space-y-1">
                    <p><span className="text-gray-400">Email:</span> {credentials.email}</p>
                    <p><span className="text-gray-400">Password:</span> {credentials.password}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500">
                    {candidate.candidate_name} has been added to Team Members as {JOIN_ROLE_LABELS[role]}. Create a login now so they can sign in right away — or skip and do it later from Team & Settings.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Temporary Password</label>
                    <div className="flex gap-2">
                      <input className={ic + ' font-mono'} value={password} onChange={e => setPassword(e.target.value)} />
                      <button onClick={() => setPassword(generatePassword())}
                        className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 whitespace-nowrap">
                        Regenerate
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              {credentials ? (
                <button onClick={onClose} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Done</button>
              ) : (
                <>
                  <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Skip for now</button>
                  <button onClick={handleCreateLogin} disabled={loading}
                    className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />} Create Login
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}