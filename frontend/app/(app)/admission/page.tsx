'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Phone, Search, ChevronRight, Filter, FileCheck } from 'lucide-react'
import { admissionApi } from '@/lib/api'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import Link from 'next/link'

const PIPELINE_STAGES = [
  { key: 'new',                  label: 'New',           color: 'bg-blue-100 text-blue-700' },
  { key: 'follow_up',            label: 'Follow Up',     color: 'bg-yellow-100 text-yellow-700' },
  { key: 'interested',           label: 'Interested',    color: 'bg-purple-100 text-purple-700' },
  { key: 'documents_submitted',  label: 'Docs',          color: 'bg-orange-100 text-orange-700' },
  { key: 'approved',             label: 'Approved',      color: 'bg-teal-100 text-teal-700' },
  { key: 'admitted',             label: 'Admitted',      color: 'bg-green-100 text-green-700' },
  { key: 'rejected',             label: 'Rejected',      color: 'bg-red-100 text-red-700' },
]

const INQUIRY_STATUSES = ['new','follow_up','interested','documents_submitted','entrance_exam','approved','fee_pending','admitted','rejected','lost']

const APP_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  admitted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admission CRM</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {stats?.total ?? 0} inquiries · {stats?.conversion_rate ?? 0}% conversion rate
          </p>
        </div>
        {tab === 'inquiries' ? (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200">
            <Plus className="w-4 h-4" /> New Inquiry
          </button>
        ) : (
          <button onClick={() => setShowNewApp(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200">
            <Plus className="w-4 h-4" /> New Application
          </button>
        )}
      </div>

      {/* Tabs: Inquiries (CRM) vs Applications (formal, workflow-driven) */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('inquiries')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
            tab === 'inquiries' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
          Inquiries
        </button>
        <button onClick={() => setTab('applications')}
          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
            tab === 'applications' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
          <FileCheck className="w-3.5 h-3.5" /> Applications
        </button>
      </div>

      {tab === 'inquiries' ? (
        <>
          {/* Pipeline stats */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {PIPELINE_STAGES.map(stage => {
              const count = stats?.by_status?.find((s: any) => s.status === stage.key)?.count ?? 0
              return (
                <button key={stage.key}
                  onClick={() => setStatus(statusFilter === stage.key ? '' : stage.key)}
                  className={cn('bg-white rounded-xl border p-3 text-center transition-all hover:shadow-sm',
                    statusFilter === stage.key ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-gray-200')}>
                  <p className="text-xl font-bold text-gray-900">{count}</p>
                  <span className={cn('inline-block mt-1 px-1.5 py-0.5 rounded-full text-xs font-medium', stage.color)}>
                    {stage.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Filters */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="Search by student or parent name..."
                value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
            </div>
            <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }}
              className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 min-w-[160px]">
              <option value="">All Status</option>
              {INQUIRY_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
            </select>
            {statusFilter && (
              <button onClick={() => setStatus('')}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50">
                Clear filter
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center">
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : (inquiries?.data ?? []).length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <p className="font-medium">No inquiries found</p>
                <p className="text-sm mt-1">
                  {statusFilter ? 'Try clearing the filter' : 'Add your first inquiry to start tracking admissions'}
                </p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Parent</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Class</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Counselor</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="px-5 py-3.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(inquiries?.data ?? []).map((inq: any) => (
                      <tr key={inq.id} className="hover:bg-gray-50/80 transition-colors group">
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-gray-900">{inq.student_name}</p>
                          <p className="text-xs text-gray-400 font-mono">{inq.inquiry_number}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-gray-700 font-medium">{inq.parent_name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-400">{inq.parent_phone}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-gray-600">{inq.classes?.name ?? '—'}</td>
                        <td className="px-5 py-3.5 text-gray-500 text-xs">{inq.inquiry_sources?.name ?? '—'}</td>
                        <td className="px-5 py-3.5 text-gray-600 text-sm">{inq.users?.full_name ?? 'Unassigned'}</td>
                        <td className="px-5 py-3.5">
                          <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                            STATUS_COLORS[inq.status] ?? 'bg-gray-100 text-gray-600')}>
                            {inq.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(inq.created_at)}</td>
                        <td className="px-5 py-3.5">
                          <Link href={`/admission/${inq.id}`}
                            className="flex items-center gap-1 text-xs text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-700">
                            View <ChevronRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {meta.total > meta.limit && (
                  <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500 bg-gray-50/50">
                    <p className="text-xs">Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs disabled:opacity-40 hover:bg-white">Prev</button>
                      <button onClick={() => setPage(p => p + 1)} disabled={page * meta.limit >= meta.total}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs disabled:opacity-40 hover:bg-white">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        /* Applications tab — formal applications going through the
           Admission Approval Workflow (Counselor -> Accountant -> Principal) */
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {appsLoading ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (applications ?? []).length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <FileCheck className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="font-medium">No applications yet</p>
              <p className="text-sm mt-1">Applications go through Counselor → Accountant → Principal approval</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Application #</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Parent Phone</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(applications ?? []).map((app: any) => (
                  <tr key={app.id} className="hover:bg-gray-50/80 transition-colors group cursor-pointer"
                    onClick={() => window.location.href = `/admission/applications/${app.id}`}>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{app.application_number}</td>
                    <td className="px-5 py-3.5 font-semibold text-gray-900">{app.student_first_name} {app.student_last_name}</td>
                    <td className="px-5 py-3.5 text-gray-600">{app.father_phone}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', APP_STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600')}>
                        {app.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(app.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1 text-xs text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        View <ChevronRight className="w-3 h-3" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
    </div>
  )
}

function NewInquiryModal({ classes, onClose }: { classes: any[], onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    student_name: '', parent_name: '', parent_phone: '', parent_email: '',
    gender: '', notes: '', applying_for_class_id: '', previous_school: '',
    budget_range: '', source_id: '',
  })

  const { data: sourcesData } = useQuery({
    queryKey: ['inquiry-sources'],
    queryFn: () => admissionApi.inquiries.list({ limit: 1 }).then(() => []).catch(() => []),
  })

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
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  )

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Admission Inquiry</h2>
          <p className="text-sm text-gray-500 mt-0.5">Log a new admission inquiry from a parent</p>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Student Name *" span={2}>
              <input className={inputCls} value={form.student_name}
                onChange={e => setForm(f => ({ ...f, student_name: e.target.value }))}
                placeholder="Full name of the student" />
            </Field>
            <Field label="Parent Name *">
              <input className={inputCls} value={form.parent_name}
                onChange={e => setForm(f => ({ ...f, parent_name: e.target.value }))}
                placeholder="Father / Mother name" />
            </Field>
            <Field label="Parent Phone *">
              <input className={inputCls} value={form.parent_phone}
                onChange={e => setForm(f => ({ ...f, parent_phone: e.target.value }))}
                placeholder="+91 98765 43210" />
            </Field>
            <Field label="Parent Email">
              <input type="email" className={inputCls} value={form.parent_email}
                onChange={e => setForm(f => ({ ...f, parent_email: e.target.value }))}
                placeholder="parent@email.com" />
            </Field>
            <Field label="Gender">
              <select className={inputCls} value={form.gender}
                onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Applying for Class">
              <select className={inputCls} value={form.applying_for_class_id}
                onChange={e => setForm(f => ({ ...f, applying_for_class_id: e.target.value }))}>
                <option value="">Select class</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Previous School">
              <input className={inputCls} value={form.previous_school}
                onChange={e => setForm(f => ({ ...f, previous_school: e.target.value }))}
                placeholder="Current/previous school name" />
            </Field>
            <Field label="Budget Range">
              <select className={inputCls} value={form.budget_range}
                onChange={e => setForm(f => ({ ...f, budget_range: e.target.value }))}>
                <option value="">Select range</option>
                <option value="Under 50k">Under ₹50,000/yr</option>
                <option value="50k-1L">₹50,000 - ₹1,00,000/yr</option>
                <option value="1L-2L">₹1,00,000 - ₹2,00,000/yr</option>
                <option value="Above 2L">Above ₹2,00,000/yr</option>
              </select>
            </Field>
            <Field label="Notes" span={2}>
              <textarea rows={3} className={inputCls + ' resize-none'} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional notes about this inquiry..." />
            </Field>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-900">Cancel</button>
          <button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.student_name || !form.parent_name || !form.parent_phone}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Creating...' : 'Create Inquiry'}
          </button>
        </div>
      </div>
    </div>
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

  const inputCls = "w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all"

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Admission Application</h2>
          <p className="text-sm text-gray-500 mt-0.5">Starts the Counselor → Accountant → Principal approval workflow automatically</p>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Student First Name *</label>
              <input className={inputCls} value={form.student_first_name}
                onChange={e => setForm(f => ({ ...f, student_first_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Student Last Name *</label>
              <input className={inputCls} value={form.student_last_name}
                onChange={e => setForm(f => ({ ...f, student_last_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Father's Name</label>
              <input className={inputCls} value={form.father_name}
                onChange={e => setForm(f => ({ ...f, father_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Father's Phone *</label>
              <input className={inputCls} value={form.father_phone}
                onChange={e => setForm(f => ({ ...f, father_phone: e.target.value }))} placeholder="10-digit phone" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mother's Name</label>
              <input className={inputCls} value={form.mother_name}
                onChange={e => setForm(f => ({ ...f, mother_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mother's Phone</label>
              <input className={inputCls} value={form.mother_phone}
                onChange={e => setForm(f => ({ ...f, mother_phone: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date of Birth</label>
              <input type="date" className={inputCls} value={form.date_of_birth}
                onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Gender</label>
              <select className={inputCls} value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Applying for Class</label>
              <select className={inputCls} value={form.applying_for_class_id}
                onChange={e => setForm(f => ({ ...f, applying_for_class_id: e.target.value }))}>
                <option value="">Select class</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-900">Cancel</button>
          <button
            onClick={() => {
              const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? undefined : v]))
              mutation.mutate(clean)
            }}
            disabled={mutation.isPending || !form.student_first_name || !form.student_last_name || !form.father_phone}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Creating...' : 'Create Application'}
          </button>
        </div>
      </div>
    </div>
  )
}