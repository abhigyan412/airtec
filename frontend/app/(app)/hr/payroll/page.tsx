'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency } from '@/lib/utils'
import { ArrowLeft, IndianRupee, Loader2, Play, Check, ShieldCheck, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/EmptyState'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// payment_status state machine: pending -> approved (Principal sign-off) -> paid
const PAY_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info'> = {
  pending: 'warning',
  approved: 'info',
  paid: 'success',
  on_hold: 'destructive',
  failed: 'destructive',
}

export default function PayrollPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const canApprove = ['school_admin', 'principal'].includes(user?.role ?? '')
  const [skipped, setSkipped] = useState<{ user_id: string; full_name: string; role: string }[] | null>(null)

  const { data: payslips, isLoading } = useQuery({
    queryKey: ['payslips', month, year],
    queryFn: () => hrmsApi.payslips.list({ month, year, limit: 100 }).then(r => r.data),
  })

  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: () => hrmsApi.payroll.summary({ month, year }).then(r => r.data),
  })

  const generateMutation = useMutation({
    mutationFn: () => hrmsApi.payslips.generate({ month, year }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      qc.invalidateQueries({ queryKey: ['payroll-summary'] })
      // count/skipped are siblings of data (the generated payslips array),
      // not nested inside it — res.data?.count was always undefined.
      toast.success(`${res.count ?? 0} payslip(s) generated`)
      setSkipped(res.skipped ?? [])
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to generate'),
  })

  const approveMutation = useMutation({
    mutationFn: ({ id }: any) => hrmsApi.payslips.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      toast.success('Payslip approved — ready to mark as paid')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to approve'),
  })

  const markPaidMutation = useMutation({
    mutationFn: ({ id }: any) => hrmsApi.payslips.update(id, { payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      qc.invalidateQueries({ queryKey: ['payroll-summary'] })
      toast.success('Marked as paid')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to mark paid'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/staff" aria-label="Back to staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Payroll</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Generate and manage monthly payslips</p>
        </div>
      </div>

      {/* Period selector */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger className="min-w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="min-w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Generate Payslips for {MONTHS[month - 1]}
          </Button>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {summary && summary.payslip_count > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'Payslips Generated', value: summary.payslip_count, color: 'text-foreground' },
            { label: 'Gross Total', value: formatCurrency(Number(summary.total_gross)), color: 'text-success' },
            { label: 'Deductions', value: formatCurrency(Number(summary.total_deductions)), color: 'text-destructive' },
            { label: 'Net Payable', value: formatCurrency(Number(summary.total_net)), color: 'text-primary' },
            { label: 'Paid / Pending', value: `${summary.paid_count}/${summary.pending_count}`, color: 'text-foreground' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {skipped !== null && skipped.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
          <div className="text-sm text-foreground">
            <p className="font-semibold">{skipped.length} staff member{skipped.length !== 1 ? 's' : ''} skipped — no salary structure on file</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {skipped.map((s, i) => (
                <span key={s.user_id}>
                  {i > 0 && ', '}
                  <Link href={`/hr/staff/${s.user_id}`} className="text-primary underline hover:text-primary/80">{s.full_name}</Link>
                </span>
              ))}
              {' — set their salary under Staff → Payroll tab, then generate again.'}
            </p>
          </div>
        </div>
      )}

      {!canApprove && (
        <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          Payslips need Principal approval before they can be marked as paid.
        </div>
      )}

      {/* Payslips table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>
        ) : (payslips ?? []).length === 0 ? (
          <EmptyState
            icon={IndianRupee}
            title={`No payslips for ${MONTHS[month - 1]} ${year}`}
            description='Click "Generate Payslips" to create them from staff salary structures'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payslips ?? []).map((p: any) => (
                <TableRow key={p.id} className="cursor-default">
                  <TableCell>
                    <p className="font-semibold text-foreground">{p.users?.full_name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{p.users?.role?.replace('_', ' ')}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatCurrency(Number(p.gross_salary))}</TableCell>
                  <TableCell className="text-muted-foreground">{formatCurrency(Number(p.total_deductions))}</TableCell>
                  <TableCell className="font-semibold text-foreground">{formatCurrency(Number(p.net_salary))}</TableCell>
                  <TableCell>
                    <Badge variant={PAY_STATUS_VARIANT[p.payment_status] ?? 'secondary'} className="capitalize">
                      {p.payment_status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {p.payment_status === 'pending' && canApprove && (
                      <Button size="sm" variant="secondary" onClick={() => approveMutation.mutate({ id: p.id })} disabled={approveMutation.isPending} className="ml-auto">
                        {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Approve
                      </Button>
                    )}
                    {p.payment_status === 'pending' && !canApprove && (
                      <span className="text-xs text-muted-foreground">Awaiting Principal approval</span>
                    )}
                    {p.payment_status === 'approved' && (
                      <Button size="sm" onClick={() => markPaidMutation.mutate({ id: p.id })} disabled={markPaidMutation.isPending} className="ml-auto bg-success text-success-foreground hover:bg-success/90">
                        {markPaidMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Mark Paid
                      </Button>
                    )}
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
