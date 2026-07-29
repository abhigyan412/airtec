'use client'
import { useQuery } from '@tanstack/react-query'
import { NotebookPen, Paperclip } from 'lucide-react'
import { homeworkApi } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'

const todayStr = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

export default function PortalHomeworkPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })

  const items = [...(data ?? [])].sort((a: any, b: any) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><NotebookPen className="w-5 h-5 text-gray-400" /> Homework</h1>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
          <NotebookPen className="w-10 h-10 mx-auto mb-2 text-gray-200" />
          <p className="font-medium">No homework assigned yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((h: any) => {
            const overdue = h.due_date && h.due_date < todayStr
            return (
              <div key={h.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-600">{h.subject_name}</span>
                      <span className="text-[11px] text-gray-400 capitalize">{h.type}</span>
                    </div>
                    <p className="font-semibold text-gray-900 mt-1.5">{h.title}</p>
                    {h.description && <p className="text-sm text-gray-500 mt-1">{h.description}</p>}
                    {h.attachment_url && (
                      <a href={h.attachment_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 mt-2">
                        <Paperclip className="w-3 h-3" /> Attachment
                      </a>
                    )}
                  </div>
                  {h.due_date && (
                    <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0',
                      overdue ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600')}>
                      Due {formatDate(h.due_date)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
