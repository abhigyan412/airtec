'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Plus, BookOpen, CheckCircle, Clock, FileText, BarChart2, Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const EXAM_TYPES = ['unit_test','monthly','half_yearly','annual','pre_board','practical','other']
const STATUS_COLORS: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-600',
  published:        'bg-blue-100 text-blue-700',
  ongoing:          'bg-yellow-100 text-yellow-700',
  completed:        'bg-purple-100 text-purple-700',
  result_declared:  'bg-green-100 text-green-700',
}

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Examinations</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage exams, datesheets, marks and results</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
          <Plus className="w-4 h-4" /> New Exam
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Exams', value: stats?.total ?? 0, icon: BookOpen, color: 'bg-indigo-600' },
          { label: 'Draft', value: stats?.draft ?? 0, icon: Clock, color: 'bg-gray-500' },
          { label: 'Ongoing', value: stats?.ongoing ?? 0, icon: FileText, color: 'bg-yellow-500' },
          { label: 'Results Declared', value: stats?.completed ?? 0, icon: CheckCircle, color: 'bg-green-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${s.color}`}>
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Exams list */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">All Examinations</h3>
        </div>
        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : !(exams ?? []).length ? (
          <div className="p-12 text-center text-gray-400">
            <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="font-medium">No exams yet</p>
            <p className="text-sm mt-1">Create your first exam to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(exams ?? []).map((exam: any) => (
              <div key={exam.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{exam.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400 capitalize">{exam.exam_type?.replace('_', ' ')}</span>
                    {exam.start_date && <span className="text-xs text-gray-400">{formatDate(exam.start_date)}</span>}
                    <span className="text-xs text-gray-400">{exam.academic_years?.name}</span>
                  </div>
                </div>
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', STATUS_COLORS[exam.status])}>
                  {exam.status?.replace('_', ' ')}
                </span>
                {/* Status actions */}
                <div className="flex items-center gap-2">
                  {exam.status === 'draft' && (
                    <button onClick={() => statusMutation.mutate({ id: exam.id, status: 'published' })}
                      className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 font-medium">
                      Publish
                    </button>
                  )}
                  {exam.status === 'published' && (
                    <button onClick={() => statusMutation.mutate({ id: exam.id, status: 'ongoing' })}
                      className="text-xs px-3 py-1.5 border border-yellow-200 text-yellow-600 rounded-lg hover:bg-yellow-50 font-medium">
                      Start
                    </button>
                  )}
                  {exam.status === 'ongoing' && (
                    <button onClick={() => statusMutation.mutate({ id: exam.id, status: 'completed' })}
                      className="text-xs px-3 py-1.5 border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 font-medium">
                      Complete
                    </button>
                  )}
                  <Link href={`/exams/${exam.id}`}
                    className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium flex items-center gap-1">
                    Manage <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Create New Exam</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Exam Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Half Yearly Examination 2024"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Exam Type *</label>
            <select value={form.exam_type} onChange={e => setForm(f => ({ ...f, exam_type: e.target.value }))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white">
              {EXAM_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium hover:text-gray-900">Cancel</button>
          <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.name}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Exam
          </button>
        </div>
      </div>
    </div>
  )
}