'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi, academicYearsApi } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { ArrowLeft, Loader2, ArrowRightLeft, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  partial: 'bg-warning/15 text-warning',
  cleared: 'bg-success/10 text-success',
  waived: 'bg-muted text-muted-foreground',
}

export default function ArrearsPage() {
  const qc = useQueryClient()
  const [showCarryForward, setShowCarryForward] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [payTarget, setPayTarget] = useState<any>(null)
  const [waiveTarget, setWaiveTarget] = useState<any>(null)

  const { data: arrears, isLoading } = useQuery({
    queryKey: ['fee-arrears', statusFilter],
    queryFn: () => feeApi.arrears.list(statusFilter ? { status: statusFilter } : undefined).then(r => r.data),
  })

  const totalOutstanding = (arrears ?? [])
    .filter((a: any) => a.status !== 'cleared' && a.status !== 'waived')
    .reduce((s: number, a: any) => s + (Number(a.amount) - Number(a.amount_paid)), 0)

  return (
    <div className="animate-fade-in space-y-6">
      {/* The back arrow sits outside PageHeader so the shared header keeps its
          icon + title + actions layout on every page. */}
      <div className="mb-6 flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="Back to fees">
          <Link href="/fees"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          title="Arrears"
          description="Carried-forward dues from previous academic years"
          icon={BarChart3}
          className="mb-0 flex-1"
          actions={
            <Button onClick={() => setShowCarryForward(true)}>
              <ArrowRightLeft className="h-4 w-4" /> Carry Forward Dues
            </Button>
          }
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Total Outstanding Arrears</p>
          <p className="text-2xl font-bold tabular-nums text-destructive">{formatCurrency(totalOutstanding)}</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {['', 'pending', 'partial', 'cleared', 'waived'].map(s => (
          <Button key={s} onClick={() => setStatusFilter(s)}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            className="rounded-full capitalize">
            {s || 'All'}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !(arrears ?? []).length ? (
            <EmptyState
              icon={ArrowRightLeft}
              title={statusFilter ? `No ${statusFilter} arrears` : 'No arrears found'}
              description={statusFilter
                ? 'Nothing matches this status filter — try "All" to see every arrear.'
                : 'Use "Carry Forward Dues" at the start of a new academic year to bring unpaid balances forward.'}
              action={statusFilter
                ? <Button variant="outline" onClick={() => setStatusFilter('')}>Clear filter</Button>
                : <Button onClick={() => setShowCarryForward(true)}><ArrowRightLeft className="h-4 w-4" /> Carry Forward Dues</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Student</TableHead>
                  <TableHead>From → To Year</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(arrears ?? []).map((a: any) => {
                  const isSettled = a.status === 'cleared' || a.status === 'waived'
                  const remaining = isSettled ? 0 : Number(a.amount) - Number(a.amount_paid)
                  const canAct = a.status === 'pending' || a.status === 'partial'
                  return (
                    <TableRow key={a.id} className="cursor-default">
                      <TableCell className="font-semibold text-foreground">
                        {a.students?.first_name} {a.students?.last_name}
                        <p className="text-xs text-muted-foreground">{a.students?.classes?.name}</p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.from_year?.name ?? '—'} → {a.to_year?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">{formatCurrency(a.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{formatCurrency(a.amount_paid)}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-destructive">{formatCurrency(remaining)}</TableCell>
                      <TableCell>
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', STATUS_STYLES[a.status])}>
                          {a.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {canAct && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setPayTarget(a)}>
                              Record Payment
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setWaiveTarget(a)}>
                              Waive
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showCarryForward && (
        <CarryForwardModal onClose={() => { setShowCarryForward(false); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
      {payTarget && (
        <RecordPaymentModal arrear={payTarget} onClose={() => { setPayTarget(null); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
      {waiveTarget && (
        <WaiveModal arrear={waiveTarget} onClose={() => { setWaiveTarget(null); qc.invalidateQueries({ queryKey: ['fee-arrears'] }) }} />
      )}
    </div>
  )
}

function CarryForwardModal({ onClose }: { onClose: () => void }) {
  const [fromYear, setFromYear] = useState('')
  const [toYear, setToYear] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data),
  })

  const handleSubmit = async () => {
    if (!fromYear || !toYear) return toast.error('Select both academic years')
    if (fromYear === toYear) return toast.error('From and To years must be different')
    setLoading(true)
    try {
      const res = await feeApi.arrears.carryForward(fromYear, toYear)
      setResult(res.data)
      toast.success(res.data?.message ?? `${res.data?.carried_forward ?? 0} arrears created`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to carry forward')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Carry Forward Dues</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {result ? (
            <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
              <p className="font-semibold">{result.message ?? `${result.carried_forward} arrears created`}</p>
              {result.total_amount != null && <p className="mt-1">Total: {formatCurrency(result.total_amount)}</p>}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                For every student with unpaid or partially-paid invoices in the "From" year, this creates an arrear carrying the remaining balance into the "To" year. Safe to re-run — already-carried invoices won't be duplicated.
              </p>
              <div className="space-y-1.5">
                <Label>From Academic Year *</Label>
                <Select value={fromYear} onValueChange={setFromYear}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {(years ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To Academic Year *</Label>
                <Select value={toYear} onValueChange={setToYear}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {(years ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Carry Forward
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordPaymentModal({ arrear, onClose }: { arrear: any, onClose: () => void }) {
  const remaining = Number(arrear.amount) - Number(arrear.amount_paid)
  const [amount, setAmount] = useState(String(remaining))
  const [paymentMode, setPaymentMode] = useState('cash')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > remaining) return toast.error(`Amount can't exceed the remaining balance of ${formatCurrency(remaining)}`)
    setLoading(true)
    try {
      await feeApi.arrears.recordPayment(arrear.id, { amount: amt, payment_mode: paymentMode })
      toast.success('Payment recorded')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {arrear.students?.first_name} {arrear.students?.last_name} · Remaining: <span className="font-semibold text-destructive">{formatCurrency(remaining)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="arrear-amount">Amount *</Label>
            <Input id="arrear-amount" type="number" max={remaining} value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Mode</Label>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="neft">NEFT</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="online">Online</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WaiveModal({ arrear, onClose }: { arrear: any, onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!reason.trim()) return toast.error('A reason is required to waive an arrear')
    setLoading(true)
    try {
      await feeApi.arrears.waive(arrear.id, reason)
      toast.success('Arrear waived')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Waive Arrear</DialogTitle>
          <DialogDescription>
            This permanently waives the remaining balance for {arrear.students?.first_name} {arrear.students?.last_name}. This action should be reserved for admin/principal-approved hardship cases.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="waive-reason">Reason *</Label>
          <Textarea id="waive-reason" rows={2} className="resize-none"
            value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Financial hardship, approved by Principal" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Waive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
