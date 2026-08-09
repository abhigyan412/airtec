'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Banknote, Landmark, Receipt, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, downloadFeeCsv } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatCard } from '@/components/shared/StatCard'

// One day's takings, for tallying the drawer.
//
// Lives beside the receipts list rather than on its own screen: both read the
// same payments, and they are the same person's job at different moments —
// "find this parent's receipt" and "what did we take today". Two destinations
// for one table was a nav entry nobody could tell apart from the other.

const today = () => new Date().toISOString().slice(0, 10)

export function DayBook() {
  const [date, setDate] = useState(today())
  const [downloading, setDownloading] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['fee-daybook', date],
    queryFn: () => feeApi.daybook(date).then(r => r.data),
  })

  const rows: any[] = data?.rows ?? []
  const totals = data?.totals
  const byMethod: any[] = data?.by_method ?? []
  const byCollector: any[] = data?.by_collector ?? []

  const exportCsv = async () => {
    setDownloading(true)
    try {
      await downloadFeeCsv('/fees/daybook', { date }, `day-book-${date}.csv`)
    } catch {
      toast.error('Could not download the day book')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="h-9 w-[160px]" aria-label="Day book date"
          />
          {date !== today() && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today())}>Today</Button>
          )}
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={downloading || !rows.length}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* Cash first and on its own: it is the only line that has to match a
              physical count, and it is the one that goes missing. */}
          <StatCard label="Cash in drawer" value={formatCurrency(totals?.cash ?? 0)} icon={Banknote} accent="success"
            hint="Count this against the box" />
          <StatCard label="Bank & online" value={formatCurrency(totals?.bank ?? 0)} icon={Landmark} accent="primary" />
          <StatCard label="Total collected" value={formatCurrency(totals?.collected ?? 0)} icon={Receipt}
            hint={`${totals?.receipts ?? 0} receipt${totals?.receipts === 1 ? '' : 's'}`} />
          <StatCard
            label="Reversed" value={String(totals?.reversed ?? 0)} icon={AlertTriangle}
            accent={(totals?.reversed ?? 0) > 0 ? 'destructive' : undefined}
            hint="Cancelled or bounced"
          />
        </div>
      )}

      {!isPending && !!rows.length && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle>By method</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {byMethod.map(m => (
                <div key={m.method} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {m.label}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({m.count} receipt{m.count === 1 ? '' : 's'})
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(m.total)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle>By collector</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {byCollector.map(c => (
                <div key={c.name} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {c.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({c.count} receipt{c.count === 1 ? '' : 's'})
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(c.total)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Receipts on {formatDate(date)}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !rows.length ? (
            <EmptyState
              icon={Receipt}
              title="Nothing taken on this day"
              description="No payments were recorded. Pick another date above."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Receipt</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="hidden md:table-cell">Method</TableHead>
                    <TableHead className="hidden lg:table-cell">Collected by</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const dead = ['cancelled', 'bounced'].includes(r.status)
                    return (
                      <TableRow key={r.id} className={cn('cursor-default', dead && 'opacity-60')}>
                        <TableCell>
                          <p className="font-mono text-xs text-muted-foreground">{r.receipt_number}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{r.student}</p>
                          <p className="text-xs text-muted-foreground">
                            {[r.class_section, r.admission_number].filter(Boolean).join(' · ')}
                          </p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm capitalize text-foreground">{r.method}</span>
                          {r.reference && (
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {r.reference}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {r.collected_by}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('font-semibold tabular-nums',
                            dead ? 'text-muted-foreground line-through' : 'text-success')}>
                            {formatCurrency(r.amount)}
                          </span>
                          {dead && (
                            <span className="block text-[11px] font-medium text-destructive">{r.status}</span>
                          )}
                          {r.advance > 0 && !dead && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatCurrency(r.advance)} advance
                            </span>
                          )}
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
