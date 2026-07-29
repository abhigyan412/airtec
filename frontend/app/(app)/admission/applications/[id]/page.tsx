'use client'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { admissionApi } from '@/lib/api'
import { WorkflowPipeline } from '@/components/admission/WorkflowPipeline'
import { formatDate } from '@/lib/utils'
import { ArrowLeft, Phone, User, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="font-medium text-foreground">Application not found</p>
        <Link href="/admission/applications" className="text-primary text-sm mt-2 hover:underline">Back to Applications</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild className="mt-1">
          <Link href="/admission/applications" aria-label="Back to Applications">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{app.student_first_name} {app.student_last_name}</h1>
            <Badge variant={STATUS_VARIANTS[app.status] ?? 'secondary'} className="capitalize">{app.status}</Badge>
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">{app.application_number}</span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Submitted {formatDate(app.created_at)}</p>
        </div>
      </div>

      {/* Basic details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> Application Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
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
