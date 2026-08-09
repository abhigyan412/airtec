'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Receipt, Printer, Search, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DayBook } from '@/components/fees/DayBook'
import { Pagination } from '@/components/shared/Pagination'
import { printReceipt } from '@/components/fees/printReceipt'

// The day book, and the printed receipt behind every row.
//
// Payments were previously listed inside the Collect screen, which meant the
// reconciliation job (what came in today, across everyone) shared a page with
// the transaction job (this parent, right now). They are different tasks done by
// the same person at different times of day, so they get different screens.

export default function ReceiptsPage() {
  const params = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [printing, setPrinting] = useState<string | null>(null)
  const [tab, setTab] = useState('receipts')
  const limit = 25

  const query = { page, limit, search: search || undefined }
  const { data, isPending } = useQuery({
    queryKey: ['fee-receipts', query],
    // A receipt IS a payment — there is no separate list endpoint and there
    // should not be, or the two would drift on what "collected" means.
    queryFn: () => feeApi.payments.list(query),
  })

  const openPrint = async (paymentId: string) => {
    setPrinting(paymentId)
    try {
      const res = await feeApi.receipts.get(paymentId)
      const ok = printReceipt(res.data)
      if (!ok) toast.error('Your browser blocked the print window — allow pop-ups for this site.')
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not load the receipt')
    } finally {
      setPrinting(null)
    }
  }

  // Arriving from "print receipt" straight after collecting: open the document
  // rather than making the cashier find the row they just created.
  const openId = params.get('open')
  useEffect(() => {
    if (openId) openPrint(openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const rows: any[] = data?.data ?? []
  // Server-computed, so this figure and the day book's cannot disagree. Cancelled
  // and bounced receipts are already excluded there.
  const pageTotal = data?.meta?.collected ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        description="Every payment taken, the printable receipt for each, and one day's takings"
        icon={Receipt}
      />

      {/* Two views of the same table. Searching for one family's receipt and
          tallying a day's drawer are the same person's job at different moments,
          so they are tabs rather than two nav entries nobody could tell apart. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="receipts">All receipts</TabsTrigger>
          <TabsTrigger value="daybook">Day book</TabsTrigger>
        </TabsList>

        <TabsContent value="daybook"><DayBook /></TabsContent>

        <TabsContent value="receipts">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Payments</CardTitle>
            {!isPending && !!rows.length && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatCurrency(pageTotal)} on this page
              </p>
            )}
          </div>
          <div className="relative w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9"
              placeholder="Receipt number…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
        </CardHeader>

        {isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !rows.length ? (
          <EmptyState
            icon={Receipt}
            title={search ? 'No receipt matches' : 'No payments yet'}
            description={search ? 'Try a different receipt number.' : 'Receipts appear here as payments are taken.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Receipt</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const refunded = Number(r.refunded_amount ?? 0)
                    // Bounced money left again, so it reads like a cancellation
                    // even though the two are different events on the record.
                    const dead = ['cancelled', 'bounced'].includes(r.status)
                    const amount = Number(r.amount)
                    const parts = Number(r.settled_invoices ?? 0)
                    const advance = Number(r.unallocated_amount ?? 0)
                    return (
                      <TableRow key={r.id} className={cn('cursor-default', dead && 'opacity-60')}>
                        <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">
                            {r.students?.first_name} {r.students?.last_name}
                          </p>
                          <p className="text-xs text-muted-foreground">{r.students?.classes?.name}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(r.payment_date)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm capitalize">
                          {r.method}
                          {/* Nobody handled an online payment, and knowing that
                              matters when a day's takings are being reconciled
                              against a named cashier. */}
                          {!r.users?.full_name && (
                            <span className="block text-[11px] text-muted-foreground">online</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('font-semibold tabular-nums', dead ? 'text-muted-foreground line-through' : 'text-success')}>
                            {formatCurrency(amount)}
                          </span>
                          {parts > 1 && (
                            <span className="block text-[11px] text-muted-foreground">
                              across {parts} invoices
                            </span>
                          )}
                          {advance > 0 && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatCurrency(advance)} held as advance
                            </span>
                          )}
                          {refunded > 0 && (
                            <span className="block text-[11px] text-warning">
                              {formatCurrency(refunded)} refunded
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.status === 'bounced' ? 'destructive' : dead ? 'secondary' : refunded > 0 ? 'warning' : 'success'}
                            className="text-xs capitalize"
                          >
                            {r.status ?? 'captured'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm" variant="ghost" className="h-8"
                            onClick={() => openPrint(r.id)}
                            disabled={printing === r.id}
                          >
                            {printing === r.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            Print
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={data?.meta?.page ?? page}
              limit={data?.meta?.limit ?? limit}
              total={data?.meta?.total ?? rows.length}
              onPageChange={setPage}
              label="receipts"
            />
          </>
        )}
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
