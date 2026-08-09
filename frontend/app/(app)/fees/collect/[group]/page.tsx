'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Search, Users } from 'lucide-react'
import { feeApi } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'

// Every student in one class-section, with their position.
//
// The middle of the drill-down: you came from "5-B owes ₹84,000" and you want to
// know who. Sorted worst-first by default, because the reason anyone opens this
// screen is to find the students who haven't paid — alphabetical would bury them.

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'info' }> = {
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Partial', variant: 'info' },
  pending: { label: 'Pending', variant: 'warning' },
  not_billed: { label: 'Not billed', variant: 'secondary' },
}

export default function ClassSectionFeePage() {
  const params = useParams<{ group: string }>()
  const router = useRouter()
  const [classId, sectionRaw] = (params.group ?? '').split('__')
  const sectionId = sectionRaw && sectionRaw !== 'none' ? sectionRaw : undefined
  const [search, setSearch] = useState('')

  const query = { class_id: classId, section_id: sectionId }
  const { data, isPending } = useQuery({
    queryKey: ['fee-class-students', query],
    queryFn: () => feeApi.classes.students(query),
    enabled: !!classId,
  })

  const rows: any[] = data?.data ?? []
  const totals = data?.meta?.totals

  const visible = rows
    .filter(r =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.admission_number ?? '').toLowerCase().includes(search.toLowerCase()))
    // Most owed first; settled students sink to the bottom where they belong.
    .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name))

  const label = rows[0]
    ? `${rows[0].class_name}${rows[0].section_name ? `-${rows[0].section_name}` : ''}`
    : 'Class fees'

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground">
          <Link href="/fees/collect"><ArrowLeft className="h-3.5 w-3.5" /> All classes</Link>
        </Button>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{label}</h1>
        {!isPending && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {rows.length} student{rows.length === 1 ? '' : 's'} · billed {formatCurrency(totals?.billed ?? 0)} ·
            collected {formatCurrency(totals?.collected ?? 0)} ·{' '}
            <span className="font-medium text-foreground">outstanding {formatCurrency(totals?.outstanding ?? 0)}</span>
            {(totals?.overdue ?? 0) > 0 && (
              <span className="text-destructive"> · {formatCurrency(totals.overdue)} overdue</span>
            )}
          </p>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Filter this class…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !visible.length ? (
            <EmptyState
              icon={Users}
              title={search ? 'Nobody matches' : 'No students in this class-section'}
              description={search ? 'Try a different name or admission number.' : 'Nobody is enrolled here yet.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="hidden lg:table-cell">Next due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(r => {
                    const st = STATUS[r.status] ?? STATUS.pending
                    return (
                      <TableRow
                        key={r.student_id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/fees/collect/student/${r.student_id}`)}
                      >
                        <TableCell className="font-medium text-foreground">
                          {r.name}
                          <span className="block font-mono text-xs font-normal text-muted-foreground">
                            {r.admission_number}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(r.billed)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{formatCurrency(r.collected)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn('font-semibold tabular-nums', r.outstanding > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                            {formatCurrency(r.outstanding)}
                          </span>
                          {r.overdue > 0 && (
                            <span className="block text-[11px] font-medium text-destructive">
                              {formatCurrency(r.overdue)} overdue
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {r.next_due_date ? formatDate(r.next_due_date) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="inline h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
