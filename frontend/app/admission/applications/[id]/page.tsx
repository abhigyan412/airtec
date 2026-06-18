'use client'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi } from '@/lib/api'
import { WorkflowPipeline } from '@/components/admission/WorkflowPipeline'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Phone, User } from 'lucide-react'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: app, isLoading } = useQuery({
    queryKey: ['admission-application', id],
    queryFn: () => admissionApi.applications.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <p className="font-medium">Application not found</p>
        <Link href="/admission/applications" className="text-indigo-600 text-sm mt-2 hover:underline">Back to Applications</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admission/applications" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{app.student_first_name} {app.student_last_name}</h1>
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600')}>
              {app.status}
            </span>
            <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">{app.application_number}</span>
          </div>
          <p className="text-gray-500 text-sm mt-1">Submitted {formatDate(app.created_at)}</p>
        </div>
      </div>

      {/* Basic details */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-400" /> Application Details
        </h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Father's Phone</p>
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
              <Phone className="w-3 h-3 text-gray-400" /> {app.father_phone}
            </p>
          </div>
          {app.father_name && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Father's Name</p>
              <p className="text-sm font-medium text-gray-800">{app.father_name}</p>
            </div>
          )}
          {app.mother_name && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Mother's Name</p>
              <p className="text-sm font-medium text-gray-800">{app.mother_name}</p>
            </div>
          )}
          {app.classes?.name && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Applying for Class</p>
              <p className="text-sm font-medium text-gray-800">{app.classes.name}</p>
            </div>
          )}
          {app.users?.full_name && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Assigned Counselor</p>
              <p className="text-sm font-medium text-gray-800">{app.users.full_name}</p>
            </div>
          )}
        </div>
      </div>

      {/* Workflow approval pipeline */}
      <WorkflowPipeline applicationId={app.id} />
    </div>
  )
}