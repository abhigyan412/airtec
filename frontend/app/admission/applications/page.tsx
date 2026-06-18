'use client'
import { useQuery } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, FileText, ChevronRight } from 'lucide-react'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function ApplicationsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admission-applications'],
    queryFn: () => admissionApi.applications.list().then(r => r.data),
  })

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/admission" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admission Applications</h1>
          <p className="text-gray-500 text-sm mt-0.5">Applications going through the approval workflow</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (data ?? []).length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-2 text-gray-200" />
            <p className="font-medium">No applications yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Application #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Parent Phone</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data ?? []).map((app: any) => (
                <tr key={app.id} onClick={() => window.location.href = `/admission/applications/${app.id}`}
                  className="hover:bg-gray-50/80 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{app.application_number}</td>
                  <td className="px-5 py-3.5 font-semibold text-gray-900">{app.student_first_name} {app.student_last_name}</td>
                  <td className="px-5 py-3.5 text-gray-600">{app.father_phone}</td>
                  <td className="px-5 py-3.5">
                    <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600')}>
                      {app.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(app.created_at)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <ChevronRight className="w-4 h-4 text-gray-300 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}