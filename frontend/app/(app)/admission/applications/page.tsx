'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { admissionApi } from '@/lib/api'
import { formatDate, admissionApplicationStatusBadge, classLabel } from '@/lib/utils'
import { useClassDisplayStyle } from '@/lib/useClassDisplayStyle'
import { ArrowLeft, FileText, ChevronRight, ClipboardList, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

// The four "_approved"/"_verified"/"_paid" values are legacy — no live
// code writes them anymore (see admissionApplicationStatusBadge in
// lib/utils.ts) — kept as filter options only so old seed rows in those
// states stay findable, not because anything new can land in them.
const APPLICATION_STATUSES = ['pending', 'counselor_approved', 'documents_verified', 'fee_paid', 'principal_approved', 'admitted', 'rejected']
const titleCaseStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ApplicationsListPage() {
  const classStyle = useClassDisplayStyle()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [classId, setClassId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: classes } = useQuery({
    queryKey: ['admission-classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['admission-applications', search, status, classId, dateFrom, dateTo],
    queryFn: () => admissionApi.applications.list({
      search: search || undefined, status: status || undefined, class_id: classId || undefined,
      date_from: dateFrom || undefined, date_to: dateTo || undefined,
    }).then(r => r.data),
  })

  const hasFilters = !!(search || status || classId || dateFrom || dateTo)
  const clearFilters = () => { setSearch(''); setStatus(''); setClassId(''); setDateFrom(''); setDateTo('') }

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

      <Card className="flex flex-wrap items-end gap-4 p-5">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Student name, parent phone, or application #..."
              value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
        <div className="min-w-[160px] space-y-1.5">
          <Label>Status</Label>
          <Select value={status || 'all'} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {APPLICATION_STATUSES.map(s => <SelectItem key={s} value={s}>{titleCaseStatus(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] space-y-1.5">
          <Label>Class</Label>
          <Select value={classId || 'all'} onValueChange={v => setClassId(v === 'all' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {(classes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-date-from">From</Label>
          <Input id="app-date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-date-to">To</Label>
          <Input id="app-date-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-auto" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
        )}
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            icon={FileText}
            title={hasFilters ? 'No applications match these filters' : 'No applications yet'}
            description={hasFilters
              ? 'Try a different search term, or clear the filters to see every application.'
              : 'Nothing has entered the approval workflow. Start one from the Admission CRM, or convert an existing inquiry.'}
            action={hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Button asChild>
                <Link href="/admission">
                  <Plus className="w-4 h-4" /> New Application
                </Link>
              </Button>
            )}
            className="py-16"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="uppercase text-xs">Application #</TableHead>
                <TableHead className="uppercase text-xs">Student</TableHead>
                <TableHead className="uppercase text-xs">Class Applying For</TableHead>
                <TableHead className="uppercase text-xs">Parent Phone</TableHead>
                <TableHead className="uppercase text-xs">Status</TableHead>
                <TableHead className="uppercase text-xs">Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((app: any) => {
                const badge = admissionApplicationStatusBadge(app)
                return (
                  <TableRow key={app.id} onClick={() => window.location.href = `/admission/applications/${app.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{app.application_number}</TableCell>
                    <TableCell className="font-semibold text-foreground">{app.student_first_name} {app.student_last_name}</TableCell>
                    <TableCell className="text-muted-foreground">{app.classes ? classLabel(app.classes.name, app.classes.numeric_level, classStyle) : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{app.father_phone}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(app.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="w-4 h-4 text-muted-foreground inline" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
