'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { api, admitCardApi, API_BASE } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Plus, Upload, BarChart2, Loader2, CheckCircle, FileText, GitBranch, Check, X, MessageSquare, Snowflake, Eye, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const TABS = ['Datesheet', 'Marks Entry', 'Results']

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-purple-100 text-purple-700',
  result_declared: 'bg-green-100 text-green-700',
  result_frozen: 'bg-cyan-100 text-cyan-700',
  result_verified: 'bg-indigo-100 text-indigo-700',
  result_published: 'bg-emerald-100 text-emerald-700',
}

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState('Datesheet')
  const [showAddSubject, setShowAddSubject] = useState(false)
  const qc = useQueryClient()

  const { data: exam, isLoading } = useQuery({
    queryKey: ['exam', id],
    queryFn: () => api.get(`/exams/${id}`).then(r => r.data.data),
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/admission/classes').then(r => r.data.data),
  })

  const generateResults = useMutation({
    mutationFn: () => api.post(`/exams/${id}/generate-results`, {}),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['exam', id] })
      toast.success(`Results generated for ${r.data.data.report_cards_generated} students!`)
      setTab('Results')
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to generate results')
    },
  })

  if (isLoading) {
    return <div className="p-12 text-center text-gray-400">Loading exam...</div>
  }

  if (!exam) {
    return <div className="p-12 text-center text-gray-400">Exam not found</div>
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Link href="/exams" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{exam.name}</h1>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', STATUS_COLORS[exam.status])}>
              {exam.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-0.5 capitalize">
            {exam.exam_type?.replace('_', ' ')} · {exam.academic_years?.name}
            {exam.start_date && ` · ${formatDate(exam.start_date)}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={admitCardApi.bulk(id)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
          >
            Bulk Admit Cards
          </a>
          {(exam.status === 'completed' || exam.status === 'ongoing') && (
            <button
              onClick={() => generateResults.mutate()}
              disabled={generateResults.isPending}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-60"
            >
              {generateResults.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <BarChart2 className="w-4 h-4" />
              }
              Generate Results
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Datesheet' && (
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Exam Schedule</h3>
            <button onClick={() => setShowAddSubject(true)}
              className="flex items-center gap-2 text-sm text-indigo-600 font-medium hover:text-indigo-700">
              <Plus className="w-4 h-4" /> Add Subject
            </button>
          </div>
          {!(exam.exam_subjects ?? []).length ? (
            <div className="p-12 text-center text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="font-medium">No subjects added yet</p>
              <p className="text-sm mt-1">Add subjects to build the datesheet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Subject</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Class</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Max Marks</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Pass Marks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(exam.exam_subjects ?? []).map((sub: any) => (
                  <tr key={sub.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{sub.subject_name}</td>
                    <td className="px-4 py-3 text-gray-600">{sub.classes?.name}</td>
                    <td className="px-4 py-3 text-gray-600">{sub.exam_date ? formatDate(sub.exam_date) : '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{sub.start_time ?? '-'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{sub.max_marks}</td>
                    <td className="px-4 py-3 text-gray-600">{sub.pass_marks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Marks Entry' && (
        <MarksEntry examId={id} exam={exam} classes={classes ?? []} />
      )}

      {tab === 'Results' && (
        <div className="space-y-6">
          <FreezePublishPipeline examId={id} exam={exam} />
          <ResultsView examId={id} />
        </div>
      )}

      {showAddSubject && (
        <AddSubjectModal examId={id} classes={classes ?? []} onClose={() => {
          setShowAddSubject(false)
          qc.invalidateQueries({ queryKey: ['exam', id] })
        }} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RESULT FREEZE & PUBLISH WORKFLOW PIPELINE
// ═══════════════════════════════════════════════════════════════

const STEP_ICONS: Record<string, any> = {
  freeze: Snowflake,
  verify: Eye,
  publish: Megaphone,
}

const STEP_LABELS: Record<string, string> = {
  freeze: 'Freeze Results',
  verify: 'Verify Results',
  publish: 'Publish Results',
}

const RESULT_STATUSES = ['result_declared', 'result_frozen', 'result_verified', 'result_published']

function FreezePublishPipeline({ examId, exam }: { examId: string, exam: any }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null)

  const { data: workflow, isLoading } = useQuery({
    queryKey: ['exam-workflow-status', examId],
    queryFn: () => api.get(`/exams/${examId}/workflow-status`).then(r => r.data.data),
    enabled: RESULT_STATUSES.includes(exam.status),
  })

  const startMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/start-freeze-workflow`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      toast.success('Freeze & publish workflow started')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to start workflow'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ status }: { status: 'approved' | 'rejected' | 'commented' }) =>
      api.post(`/exams/${examId}/workflow-action`, { status, notes: notes.trim() || undefined }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['exam-workflow-status', examId] })
      qc.invalidateQueries({ queryKey: ['exam', examId] })
      qc.invalidateQueries({ queryKey: ['results', examId] })
      if (r.data.data?.completed) {
        toast.success(r.data.data.instance.status === 'approved' ? 'Results published!' : 'Sent back for correction')
      } else {
        toast.success('Decision recorded')
      }
      setNotes('')
      setShowNotesFor(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Action failed'),
  })

  if (!RESULT_STATUSES.includes(exam.status)) {
    return null
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!workflow) {
    const canStart = ['school_admin', 'principal', 'teacher'].includes(user?.role ?? '')
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-gray-400" />
            <h3 className="font-semibold text-gray-900">Result Freeze &amp; Publish</h3>
          </div>
          {canStart && (
            <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60">
              {startMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Start Freeze Workflow
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mt-2">
          Results have been generated but not yet sent for freeze/verify/publish. Start the workflow to send results through Exam Controller and Principal review before they become visible to students and parents.
        </p>
      </div>
    )
  }

  const allSteps: any[] = workflow.all_steps ?? []
  const currentStep = workflow.current_step
  const approvals: any[] = workflow.approvals ?? []
  const status = workflow.status as 'in_progress' | 'approved' | 'rejected' | 'cancelled'

  const roleMap: Record<string, string> = {
    school_admin: 'School Admin',
    principal: 'Principal',
  }
  const canAct = status === 'in_progress' && currentStep && (
    user?.role === 'school_admin' ||
    roleMap[user?.role ?? ''] === currentStep.roles?.name ||
    (user?.role === 'teacher' && currentStep.roles?.name === 'Exam Controller')
  )

  const handleAction = (actionStatus: 'approved' | 'rejected' | 'commented') => {
    if (actionStatus === 'rejected' && !notes.trim()) {
      setShowNotesFor('rejected')
      return
    }
    actionMutation.mutate({ status: actionStatus })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-900">{workflow.workflow_definitions?.name ?? 'Result Freeze & Publish'}</h3>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-center gap-1">
        {allSteps.map((step, idx) => {
          const approval = approvals.find((a: any) => a.workflow_steps?.step_order === step.step_order)
          let state: 'done' | 'current' | 'pending' | 'rejected'
          if (approval?.status === 'approved') state = 'done'
          else if (approval?.status === 'rejected') state = 'rejected'
          else if (currentStep && step.step_order === currentStep.step_order && status === 'in_progress') state = 'current'
          else state = 'pending'

          const Icon = STEP_ICONS[step.action_name] ?? GitBranch

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  state === 'done' && 'bg-emerald-100 text-emerald-600',
                  state === 'current' && 'bg-indigo-600 text-white ring-4 ring-indigo-100',
                  state === 'pending' && 'bg-gray-100 text-gray-400',
                  state === 'rejected' && 'bg-red-100 text-red-600')}>
                  {state === 'done' && <Check className="w-4 h-4" />}
                  {state === 'rejected' && <X className="w-4 h-4" />}
                  {(state === 'current' || state === 'pending') && <Icon className="w-4 h-4" />}
                </div>
                <div className="text-center">
                  <p className={cn('text-xs font-semibold whitespace-nowrap', state === 'pending' ? 'text-gray-400' : 'text-gray-900')}>{step.roles?.name}</p>
                  <p className="text-[10px] text-gray-400 whitespace-nowrap">{STEP_LABELS[step.action_name] ?? step.action_name}</p>
                </div>
              </div>
              {idx < allSteps.length - 1 && (
                <div className={cn('flex-1 h-0.5 mx-2 mb-5', state === 'done' ? 'bg-emerald-200' : 'bg-gray-100')} />
              )}
            </div>
          )
        })}
      </div>

      {status === 'in_progress' && currentStep && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500 mb-3">
            Waiting on <span className="font-semibold text-gray-900">{currentStep.roles?.name}</span> to {STEP_LABELS[currentStep.action_name]?.toLowerCase() ?? currentStep.action_name}
          </p>

          {canAct ? (
            <div className="space-y-3">
              {showNotesFor && (
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={showNotesFor === 'rejected' ? 'Reason for sending back (required)...' : 'Add a note (optional)...'}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <button onClick={() => handleAction('approved')} disabled={actionMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-60">
                  {actionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {currentStep.action_name === 'publish' ? 'Publish' : currentStep.action_name === 'verify' ? 'Verify' : 'Freeze'}
                </button>
                <button onClick={() => handleAction('rejected')} disabled={actionMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-700 text-sm font-semibold rounded-xl hover:bg-red-100 disabled:opacity-60">
                  <X className="w-4 h-4" /> Send Back
                </button>
                {showNotesFor !== 'commented' ? (
                  <button onClick={() => setShowNotesFor('commented')}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
                    <MessageSquare className="w-4 h-4" /> Add Note
                  </button>
                ) : (
                  <button onClick={() => handleAction('commented')} disabled={actionMutation.isPending || !notes.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50">
                    Save Note
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              You don't have the {currentStep.roles?.name} role required for this step.
            </p>
          )}
        </div>
      )}

      {status !== 'in_progress' && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500">
            {status === 'approved' && 'Results have been published and are now visible to students and parents.'}
            {status === 'rejected' && 'This workflow was rejected.'}
            {status === 'cancelled' && 'This workflow was cancelled.'}
          </p>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-3">History</p>
          <div className="space-y-3">
            {approvals.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 text-sm">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                  a.status === 'rejected' ? 'bg-red-100 text-red-600' :
                  'bg-gray-100 text-gray-400')}>
                  {a.status === 'approved' && <Check className="w-3.5 h-3.5" />}
                  {a.status === 'rejected' && <X className="w-3.5 h-3.5" />}
                  {a.status === 'commented' && <MessageSquare className="w-3 h-3" />}
                </div>
                <div className="flex-1">
                  <p className="text-gray-900">
                    <span className="font-semibold">{a.users?.full_name ?? 'System'}</span>
                    {' '}
                    <span className="text-gray-500">
                      {a.status === 'approved' && (a.workflow_steps?.action_name === 'publish' ? 'published results' : a.status)}
                      {a.status === 'rejected' && 'sent back'}
                      {a.status === 'commented' && 'commented'}
                      {' '}({a.workflow_steps?.roles?.name} · {STEP_LABELS[a.workflow_steps?.action_name] ?? a.workflow_steps?.action_name})
                    </span>
                  </p>
                  {a.notes && <p className="text-gray-500 mt-0.5">"{a.notes}"</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(a.acted_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string, className: string }> = {
    in_progress: { label: 'In Progress', className: 'bg-amber-100 text-amber-700' },
    approved: { label: 'Published', className: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: 'Sent Back', className: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
  }
  const c = config[status] ?? config.in_progress
  return <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', c.className)}>{c.label}</span>
}

function MarksEntry({ examId, exam, classes }: any) {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [marksData, setMarksData] = useState<Record<string, any>>({})
  const qc = useQueryClient()

  const subjectsForClass = (exam.exam_subjects ?? []).filter((s: any) => s.class_id === selectedClass)

  const { data: sheetData, isLoading } = useQuery({
    queryKey: ['marks-sheet', examId, selectedClass],
    queryFn: () => api.get(`/exams/${examId}/marks/${selectedClass}`).then(r => r.data.data),
    enabled: !!selectedClass,
  })

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/marks`, {
      exam_subject_id: selectedSubject,
      marks: Object.entries(marksData).map(([student_id, m]: any) => ({
        student_id,
        marks_obtained: m.absent ? null : Number(m.marks),
        is_absent: m.absent ?? false,
      })),
    }),
    onSuccess: () => {
      toast.success('Marks saved!')
      qc.invalidateQueries({ queryKey: ['marks-sheet'] })
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to save')
    },
  })

  const initMarks = () => {
    if (!sheetData || !selectedSubject) return
    const existing = (sheetData.marks ?? []).filter((m: any) => m.exam_subject_id === selectedSubject)
    const init: Record<string, any> = {}
    for (const m of existing) {
      init[m.student_id] = { marks: m.marks_obtained ?? '', absent: m.is_absent }
    }
    setMarksData(init)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Class</label>
          <select value={selectedClass}
            onChange={e => { setSelectedClass(e.target.value); setSelectedSubject(''); setMarksData({}) }}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
            <option value="">Choose class...</option>
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Subject</label>
          <select value={selectedSubject}
            onChange={e => { setSelectedSubject(e.target.value); initMarks() }}
            disabled={!selectedClass}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none disabled:opacity-50">
            <option value="">Choose subject...</option>
            {subjectsForClass.map((s: any) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
          </select>
        </div>
      </div>

      {!selectedClass && (
        <div className="py-10 text-center text-gray-400">
          <Upload className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="text-sm">Select a class and subject to enter marks</p>
        </div>
      )}

      {selectedClass && selectedSubject && (
        <div>
          {isLoading ? (
            <div className="py-8 text-center text-gray-400">Loading students...</div>
          ) : (
            <div>
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Roll No</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Student</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 w-32">Marks</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 w-24">Absent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(sheetData?.students ?? []).map((s: any) => {
                    const m = marksData[s.id] ?? {}
                    const sub = subjectsForClass.find((sub: any) => sub.id === selectedSubject)
                    return (
                      <tr key={s.id} className={cn('hover:bg-gray-50', m.absent && 'opacity-50')}>
                        <td className="px-4 py-3 text-gray-500">{s.roll_number}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {s.first_name} {s.last_name}
                          <span className="text-xs text-gray-400 ml-2">{s.admission_number}</span>
                        </td>
                        <td className="px-4 py-3">
                          <input type="number" min="0" max={sub?.max_marks ?? 100}
                            value={m.marks ?? ''}
                            disabled={m.absent}
                            onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], marks: e.target.value } }))}
                            placeholder={`/${sub?.max_marks ?? 100}`}
                            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none disabled:bg-gray-100" />
                        </td>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={m.absent ?? false}
                            onChange={e => setMarksData(d => ({ ...d, [s.id]: { ...d[s.id], absent: e.target.checked, marks: '' } }))}
                            className="w-4 h-4 text-indigo-600 rounded" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex justify-end">
                <button onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
                  {saveMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle className="w-4 h-4" />
                  }
                  Save Marks
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultsView({ examId }: { examId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['results', examId],
    queryFn: () => api.get(`/exams/${examId}/results`).then(r => r.data.data),
  })

  if (isLoading) {
    return <div className="p-12 text-center text-gray-400">Loading results...</div>
  }

  if (!(data ?? []).length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
        <BarChart2 className="w-10 h-10 mx-auto mb-2 text-gray-200" />
        <p className="font-medium">No results yet</p>
        <p className="text-sm mt-1">Upload marks and click Generate Results</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Results — {(data ?? []).length} students</h3>
        <div className="text-sm text-gray-500">
          Pass: <span className="font-semibold text-green-600">{(data ?? []).filter((r: any) => r.is_pass).length}</span>
          &nbsp; Fail: <span className="font-semibold text-red-600">{(data ?? []).filter((r: any) => !r.is_pass).length}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Rank</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Student</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Marks</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Pct</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Grade</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Result</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {(data ?? []).map((rc: any) => (
            <tr key={rc.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-bold text-indigo-600">#{rc.rank}</td>
              <td className="px-4 py-3 font-medium text-gray-900">
                {rc.students?.first_name} {rc.students?.last_name}
                <span className="text-xs text-gray-400 ml-2">{rc.students?.classes?.name}</span>
              </td>
              <td className="px-4 py-3 text-gray-700">{rc.obtained_marks}/{rc.total_marks}</td>
              <td className="px-4 py-3 font-semibold text-gray-900">{rc.percentage}%</td>
              <td className="px-4 py-3">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold',
                  ['A+','A'].includes(rc.grade) ? 'bg-green-100 text-green-700' :
                  ['B+','B'].includes(rc.grade) ? 'bg-blue-100 text-blue-700' :
                  rc.grade === 'C' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')}>
                  {rc.grade}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold',
                  rc.is_pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                  {rc.is_pass ? 'Pass' : 'Fail'}
                </span>
              </td>
              <td className="px-4 py-3">
                <a href={`${API_BASE}/documents/report-card/${rc.exam_id}/${rc.student_id}?token=${typeof window !== 'undefined' ? localStorage.getItem('airtec_token') ?? '' : ''}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  View Card
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AddSubjectModal({ examId, classes, onClose }: any) {
  const [form, setForm] = useState({
    class_id: '', subject_name: '', exam_date: '',
    start_time: '', end_time: '', max_marks: 100, pass_marks: 33,
  })

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/exams/subjects/add', { ...data, exam_id: examId }),
    onSuccess: () => {
      toast.success('Subject added!')
      onClose()
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed')
    },
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Subject to Datesheet</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
            <select value={form.class_id} onChange={e => setForm(f => ({ ...f, class_id: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none">
              <option value="">Select class...</option>
              {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject Name</label>
            <input value={form.subject_name} onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))}
              placeholder="e.g. Mathematics"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Exam Date</label>
              <input type="date" value={form.exam_date} onChange={e => setForm(f => ({ ...f, exam_date: e.target.value }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Max Marks</label>
              <input type="number" value={form.max_marks} onChange={e => setForm(f => ({ ...f, max_marks: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.class_id || !form.subject_name}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Subject
          </button>
        </div>
      </div>
    </div>
  )
}