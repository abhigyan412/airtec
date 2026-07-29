'use client'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi } from '@/lib/api'
import { WorkflowPipeline } from '@/components/admission/WorkflowPipeline'
import { formatDate } from '@/lib/utils'
import { ArrowLeft, Phone, User, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'

const STATUS_VARIANTS: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: app, isLoading } = useQuery({
    queryKey: ['admission-application', id],
    queryFn: () => admissionApi.applications.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[220px] w-full rounded-2xl" />
        <Skeleton className="h-[260px] w-full rounded-2xl" />
      </div>
    )
  }

  if (!app) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Application not found"
        description="This application may have been deleted, or the link is out of date."
        action={
          <Button variant="outline" asChild>
            <Link href="/admission/applications">
              <ArrowLeft className="w-4 h-4" /> Back to Applications
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <Button variant="ghost" size="sm" asChild className="-ml-3 -mb-2 text-muted-foreground">
        <Link href="/admission/applications">
          <ArrowLeft className="w-4 h-4" /> Back to Applications
        </Link>
      </Button>
      <PageHeader
        title={`${app.student_first_name} ${app.student_last_name}`}
        description={`${app.application_number} · Submitted ${formatDate(app.created_at)}`}
        icon={ClipboardList}
        actions={<Badge variant={STATUS_VARIANTS[app.status] ?? 'secondary'} className="capitalize">{app.status}</Badge>}
      />

      {/* Basic details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> Application Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Father's Phone</p>
              <p className="text-sm font-medium text-foreground flex items-center gap-1">
                <Phone className="w-3 h-3 text-muted-foreground" /> {app.father_phone}
              </p>
            </div>
            {app.father_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Father's Name</p>
                <p className="text-sm font-medium text-foreground">{app.father_name}</p>
              </div>
            )}
            {app.mother_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Mother's Name</p>
                <p className="text-sm font-medium text-foreground">{app.mother_name}</p>
              </div>
            )}
            {app.classes?.name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Applying for Class</p>
                <p className="text-sm font-medium text-foreground">{app.classes.name}</p>
              </div>
            )}
            {app.users?.full_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Assigned Counselor</p>
                <p className="text-sm font-medium text-foreground">{app.users.full_name}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Workflow approval pipeline */}
      <WorkflowPipeline applicationId={app.id} />
    </div>
  )
}
