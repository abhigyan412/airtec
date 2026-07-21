'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Plus, Briefcase, Users, X, Loader2, Pause, Play, XCircle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-600',
  on_hold: 'bg-amber-100 text-amber-700',
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
        <div className="flex items-start gap-4">
          <Link href="/hr/recruitment" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job Postings</h1>
            <p className="text-gray-500 text-sm mt-0.5">Manage open positions and vacancies</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200">
          <Plus className="w-4 h-4" /> New Job Posting
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {['', 'open', 'on_hold', 'closed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-all capitalize',
              statusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300')}>
            {s === '' ? 'All' : s.replace('_',' ')}
          </button>
        ))}
      </div>

      {/* Jobs grid */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (jobs ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
          <Briefcase className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="font-medium">No job postings yet</p>
          <p className="text-sm mt-1">Create your first job posting to start hiring</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(jobs ?? []).map((j: any) => (
            <div key={j.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900">{j.title}</h3>
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[j.status])}>{j.status.replace('_',' ')}</span>
              </div>
              <div className="space-y-1 text-sm text-gray-500 mb-3">
                {j.department && <p>{j.department}{j.designation ? ` · ${j.designation}` : ''}</p>}
                {j.experience_required && <p className="text-xs text-gray-400">Experience: {j.experience_required}</p>}
                {j.salary_range && <p className="text-xs text-gray-400">Salary: {j.salary_range}</p>}
                <p className="text-xs text-gray-400 capitalize">{j.employment_type?.replace('_',' ')} · {j.vacancies} vacancy(ies)</p>
              </div>
              {j.description && <p className="text-xs text-gray-400 line-clamp-2 mb-3">{j.description}</p>}

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <Link href={`/hr/recruitment?job=${j.id}`} className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold hover:text-indigo-700">
                  <Users className="w-3.5 h-3.5" /> {j.application_count} candidate(s)
                </Link>
                <div className="flex gap-1">
                  {j.status === 'open' && (
                    <button onClick={() => statusMutation.mutate({ id: j.id, status: 'on_hold' })} title="Put on hold"
                      className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {j.status === 'on_hold' && (
                    <button onClick={() => statusMutation.mutate({ id: j.id, status: 'open' })} title="Reopen"
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {j.status !== 'closed' && (
                    <button onClick={() => statusMutation.mutate({ id: j.id, status: 'closed' })} title="Close"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Requirements</label>
            <textarea rows={3} className={ic + ' resize-none'} value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} placeholder="Qualifications, skills required..." />
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
