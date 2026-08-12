'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, FileText, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, invalidateFeeQueries } from '@/lib/api'
import { formatCurrency, formatDate, cn, STATUS_COLORS } from '@/lib/utils'
import { periodLabel } from '@/lib/fees'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'
import { Pagination } from '@/components/shared/Pagination'

// Everything already issued.
//
// Lives under Recovery rather than on a billing screen: once an invoice exists,
// every question anyone asks of it — what is outstanding, what is overdue, what
// needs voiding — is a recovery question. Raising them is done from the plan's
// schedule on Structures.

export function InvoiceList({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [cancelTarget, setCancelTarget] = useState<any>(null)
  const [cancelling, setCancelling] = useState(false)
  const limit = 20

  const params = { page, limit, status: status || undefined, search: search || undefined }
  const { data, isPending, error } = useQuery({
    queryKey: ['fee-invoices', params],
    queryFn: () => feeApi.invoices.list(params),
  })

  const rows: any[] = data?.data ?? []

  const doCancel = async () => {
    setCancelling(true)
    try {
      await feeApi.invoices.cancel(cancelTarget.id)
      toast.success(`${cancelTarget.invoice_number} cancelled`)
      invalidateFeeQueries(qc)
      setCancelTarget(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not cancel the invoice')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Invoices</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Invoice number…"
            className="h-9 w-[180px]"
          />
          <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="partial">Partially paid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="carried_forward">Carried forward</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <div className="p-5"><QueryError error={error} title="Could not load the invoices" /></div>
      ) : !rows.length ? (
        <EmptyState
          icon={FileText}
          title={status || search ? 'No invoices match' : 'No invoices yet'}
          description={status || search
            ? 'Try clearing the filters above.'
            : 'Use the panel above to generate a period’s billing.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Invoice</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(inv => (
                  <TableRow key={inv.id} className="cursor-default">
                    <TableCell>
                      <p className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</p>
                      {/* "Quarter 1", not "quarterly · Q1" — the raw key is a
                          storage detail and reads like one. */}
                      {periodLabel(inv.period_key) && (
                        <p className="text-[11px] text-muted-foreground">{periodLabel(inv.period_key)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{inv.students?.first_name} {inv.students?.last_name}</p>
                      <p className="text-xs text-muted-foreground">{inv.students?.classes?.name}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(inv.total_amount)}</TableCell>
                    <TableCell className={cn('text-right font-semibold tabular-nums', inv.amount_due > 0 ? 'text-destructive' : 'text-success')}>
                      {formatCurrency(inv.amount_due)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                    <TableCell>
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium', STATUS_COLORS[inv.status] ?? 'bg-muted text-muted-foreground')}>
                        {inv.status === 'carried_forward' ? 'carried forward' : inv.status}
                      </span>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {inv.status === 'unpaid' && Number(inv.amount_paid) === 0 && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Cancel invoice"
                            onClick={() => setCancelTarget(inv)}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={data?.meta?.page ?? page}
            limit={data?.meta?.limit ?? limit}
            total={data?.meta?.total ?? rows.length}
            onPageChange={setPage}
            label="invoices"
          />
        </>
      )}

      {cancelTarget && (
        <ConfirmDialog
          open
          onOpenChange={o => { if (!o) setCancelTarget(null) }}
          title={`Cancel ${cancelTarget.invoice_number}?`}
          description="The invoice is voided but kept on record, and the period can be billed again for this student."
          destructive
          confirmLabel="Cancel invoice"
          loading={cancelling}
          onConfirm={doCancel}
        />
      )}
    </Card>
  )
}
