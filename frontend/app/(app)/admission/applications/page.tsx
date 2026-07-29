'use client'
import { useQuery } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { ArrowLeft, FileText, ChevronRight, ClipboardList, Plus } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'

const STATUS_VARIANTS: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
}

export default function ApplicationsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admission-applications'],
    queryFn: () => admissionApi.applications.list().then(r => r.data),
  })

  return (
    <div className="max-w-5xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 -mb-2 text-muted-foreground">
        <Link href="/admission">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>
      </Button>
      <PageHeader
        title="Admission Applications"
        description="Applications going through the approval workflow"
        icon={ClipboardList}
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No applications yet"
            description="Nothing has entered the approval workflow. Start one from the Admission CRM, or convert an existing inquiry."
            action={
              <Button asChild>
                <Link href="/admission">
                  <Plus className="w-4 h-4" /> New Application
                </Link>
              </Button>
            }
            className="py-16"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="uppercase text-xs">Application #</TableHead>
                <TableHead className="uppercase text-xs">Student</TableHead>
                <TableHead className="uppercase text-xs">Parent Phone</TableHead>
                <TableHead className="uppercase text-xs">Status</TableHead>
                <TableHead className="uppercase text-xs">Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((app: any) => (
                <TableRow key={app.id} onClick={() => window.location.href = `/admission/applications/${app.id}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{app.application_number}</TableCell>
                  <TableCell className="font-semibold text-foreground">{app.student_first_name} {app.student_last_name}</TableCell>
                  <TableCell className="text-muted-foreground">{app.father_phone}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[app.status] ?? 'secondary'} className="capitalize">{app.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatDate(app.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="w-4 h-4 text-muted-foreground inline" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
