'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  CreditCard, ChevronRight, IndianRupee, Wallet, Users, AlertTriangle, Receipt,
} from 'lucide-react'
import { feeApi } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { StudentSearch, StudentLite } from '@/components/shared/StudentSearch'

// Collect, entered two ways.
//
// A parent standing at the counter is a SEARCH — you have a name, you want their
// ledger, now. Chasing a term's dues is a BROWSE — you work down 5-A, then 5-B.
// This page offers both and the rest of the flow is shared: whichever way you
// arrive, you land on the same student page and the same collect screen.
//
// The browse path is the one that was missing entirely; the search box alone
// meant there was no way to answer "how is 5-B doing on this term's fee".

// Not exported: a Next.js page module may only export the component and its
// route config, and [group]/page.tsx parses the key back out inline anyway.
const groupKey = (classId: string, sectionId: string | null | undefined) =>
  `${classId}__${sectionId ?? 'none'}`

export default function CollectPage() {
  const router = useRouter()
  const [classFilter, setClassFilter] = useState('')

  const { data, isPending } = useQuery({
    queryKey: ['fee-classes'],
    queryFn: () => feeApi.classes.summary(),
  })

  const rows: any[] = data?.data ?? []
  const totals = data?.meta?.totals
  const visible = rows.filter(r => !classFilter || r.class_id === classFilter)
  const classOptions = Array.from(new Map(rows.map(r => [r.class_id, r.class_name])).entries())

  // Searching jumps straight past the class grid to the student — the counter
  // case should never have to know which section the child is in.
  const onPick = (s: StudentLite | null) => {
    if (!s) return
    router.push(`/fees/collect/student/${s.id}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collect"
        description="Fee position by class, or search a student to take a payment"
        icon={CreditCard}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/fees/receipts"><Receipt className="h-4 w-4" /> Receipts &amp; day book</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-4">
          <StudentSearch
            value={null}
            onSelect={onPick}
            autoFocus
            placeholder="Parent at the desk? Search by name or admission number…"
          />
        </CardContent>
      </Card>

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Billed" value={formatCurrency(totals?.billed ?? 0)} icon={IndianRupee} accent="primary" />
          <StatCard label="Collected" value={formatCurrency(totals?.collected ?? 0)} icon={Wallet} accent="success" />
          <StatCard label="Outstanding" value={formatCurrency(totals?.outstanding ?? 0)} icon={Users} accent="warning" />
          {/* Overdue is a subset of outstanding, not a peer — it is the part that
              has passed its due date, which is what recovery work targets. */}
          <StatCard
            label="Overdue" value={formatCurrency(totals?.overdue ?? 0)}
            icon={AlertTriangle} accent="destructive"
            hint="Past its due date"
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>By class &amp; section</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">Open a class to see every student and their dues</p>
          </div>
          <Select value={classFilter || 'all'} onValueChange={v => setClassFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {classOptions.map(([id, name]) => (
                <SelectItem key={id as string} value={id as string}>{name as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !visible.length ? (
            <EmptyState
              icon={Users}
              title={classFilter ? 'No sections in this class' : 'No classes with students yet'}
              description={classFilter
                ? 'Try a different class.'
                : 'Once students are enrolled and assigned to classes, their fee position shows up here.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Class &amp; section</TableHead>
                    <TableHead className="hidden sm:table-cell">Billed</TableHead>
                    <TableHead className="text-right">Total billed</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Overdue</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(r => {
                    const key = groupKey(r.class_id, r.section_id)
                    const unbilled = r.student_count - r.billed_student_count
                    return (
                      <TableRow
                        key={key}
                        className="cursor-pointer"
                        onClick={() => router.push(`/fees/collect/${key}`)}
                      >
                        <TableCell className="font-medium text-foreground">
                          {r.class_name}{r.section_name ? `-${r.section_name}` : ''}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {r.billed_student_count}/{r.student_count}
                          {/* Nobody billed in a whole section is almost always an
                              oversight, so it is called out rather than left as
                              a ratio to notice. */}
                          {unbilled > 0 && (
                            <span className={cn('ml-1.5 text-xs', r.billed_student_count === 0 ? 'text-warning' : 'text-muted-foreground')}>
                              ({unbilled} not billed)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(r.billed)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{formatCurrency(r.collected)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(r.outstanding)}</TableCell>
                        <TableCell className="hidden md:table-cell text-right">
                          {r.overdue > 0 ? (
                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive">
                              {formatCurrency(r.overdue)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
