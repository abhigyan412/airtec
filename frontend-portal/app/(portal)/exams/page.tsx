'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { api, studentsApi } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'

export default function PortalExamsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data: exams, isLoading } = useQuery({
    queryKey: ['portal-exams'],
    queryFn: () => api.get('/exams', { params: { status: 'result_published', limit: 50 } }).then(r => r.data.data),
  })

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><BookOpen className="w-5 h-5 text-gray-400" /> Exam Results</h1>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : !(exams ?? []).length ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <BookOpen className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="font-medium">No results published yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(exams ?? []).map((exam: any) => (
            <ExamCard key={exam.id} exam={exam} studentId={me?.id}
              isOpen={expanded === exam.id}
              onToggle={() => setExpanded(expanded === exam.id ? null : exam.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ExamCard({ exam, studentId, isOpen, onToggle }: { exam: any, studentId?: string, isOpen: boolean, onToggle: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-exam-results', exam.id],
    // :student_id in the URL is ignored server-side for a parent/
    // student account — it always resolves their own child regardless.
    queryFn: () => api.get(`/exams/${exam.id}/results/${studentId ?? 'me'}`).then(r => r.data.data),
    enabled: isOpen,
  })

  const marks: any[] = data?.marks ?? []
  const totalObtained = marks.reduce((s, m) => s + (m.marks_obtained ?? 0), 0)
  const totalMax = marks.reduce((s, m) => s + (m.exam_subjects?.max_marks ?? 0), 0)
  const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <div className="text-left">
          <p className="font-semibold text-gray-900">{exam.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 capitalize">{exam.exam_type?.replace('_', ' ')} · {exam.start_date ? formatDate(exam.start_date) : ''}</p>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading results...</p>
          ) : marks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No marks recorded for this exam</p>
          ) : (
            <>
              <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[340px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                    <th className="text-left pb-2 font-medium">Subject</th>
                    <th className="text-right pb-2 font-medium">Marks</th>
                    <th className="text-right pb-2 font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {marks.map((m: any) => (
                    <tr key={m.id}>
                      <td className="py-2.5 text-gray-900 font-medium">{m.exam_subjects?.subject_name}</td>
                      <td className="py-2.5 text-right font-mono text-gray-700">
                        {m.is_absent ? <span className="text-rose-500">Absent</span> : `${m.marks_obtained ?? '—'} / ${m.exam_subjects?.max_marks ?? '—'}`}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-gray-900">{m.grade ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <span className="text-sm font-medium text-gray-500">Overall</span>
                <span className={cn('text-lg font-bold', overallPct >= 50 ? 'text-emerald-600' : 'text-rose-600')}>
                  {totalObtained} / {totalMax} ({overallPct}%)
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
