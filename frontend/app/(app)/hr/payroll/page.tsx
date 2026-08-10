'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, IndianRupee, Loader2, Play, Check, ShieldCheck, ShieldAlert, AlertTriangle, Wallet, Download, CalendarX2, Settings, Plus, Trash2, Gift, XCircle, History, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { StaffAvatar, staffPhotoUrl } from '@/components/hr/StaffAvatar'
import { PayslipBreakdownModal } from '@/components/hr/PayslipBreakdownModal'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { usePermissions } from '@/lib/usePermissions'

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
  const [selectedPayslip, setSelectedPayslip] = useState<any | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showBonuses, setShowBonuses] = useState(false)
  const [showArrears, setShowArrears] = useState(false)
  const [showDutyLog, setShowDutyLog] = useState(false)

  const { data: payslips, isLoading } = useQuery({
    queryKey: ['payslips', month, year],
    queryFn: () => hrmsApi.payslips.list({ month, year, limit: 100 }).then(r => r.data),
  })

  // Stage 8: school-wide, not scoped to whichever month happens to be
  // selected above — a failure from two months ago is still someone
  // who hasn't been paid, and it must not go unnoticed just because
  // the accountant is looking at this month's run.
  const { data: failedPayslips } = useQuery({
    queryKey: ['payslips', 'failed'],
    queryFn: () => hrmsApi.payslips.list({ payment_status: 'failed', limit: 100 }).then(r => r.data),
    enabled: canApprove,
  })
  const [failingPayslip, setFailingPayslip] = useState<any | null>(null)

  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: () => hrmsApi.payroll.summary({ month, year }).then(r => r.data),
  })

  const [coverageWarning, setCoverageWarning] = useState<{ error: string; coverage_pct: number; unmarked_dates: string[]; unmarked_dates_more: number } | null>(null)

  const generateMutation = useMutation({
    mutationFn: (confirm?: boolean) => hrmsApi.payslips.generate({ month, year, confirm }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['payslips'] })
      qc.invalidateQueries({ queryKey: ['payroll-summary'] })
      // count/skipped are siblings of data (the generated payslips array),
      // not nested inside it — res.data?.count was always undefined.
      toast.success(`${res.count ?? 0} payslip(s) generated`)
      setSkipped(res.skipped ?? [])
      setCoverageWarning(null)
    },
    onError: (e: any) => {
      // Attendance-coverage guard: the backend refuses to generate
      // (409, needs_confirmation) when most of the month's working days
      // have no attendance marked yet, since LOP would otherwise treat
      // that data gap as absenteeism for most of the staff. Surface it
      // as a confirmation step instead of a plain error toast.
      if (e?.response?.data?.needs_confirmation) {
        setCoverageWarning({
          error: e.response.data.error, coverage_pct: e.response.data.coverage_pct,
          unmarked_dates: e.response.data.unmarked_dates ?? [], unmarked_dates_more: e.response.data.unmarked_dates_more ?? 0,
        })
        return
      }
      toast.error(e?.response?.data?.error ?? 'Failed to generate')
    },
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
        <PageHeader
          className="mb-0 flex-1"
          title="Payroll"
          description="Generate and manage monthly payslips"
          icon={Wallet}
          actions={<HrQuickNav current="payroll" />}
        />
      </div>

      {/* Stage 8: failed payments — school-wide and always shown up here
          regardless of which month/year is currently selected below, so
          a bounced transfer from a different month can't go unnoticed. */}
      {canApprove && (failedPayslips ?? []).length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4">
          <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-destructive">
              {failedPayslips!.length} payment{failedPayslips!.length !== 1 ? 's' : ''} failed — action needed
            </p>
            <div className="mt-2 space-y-1.5">
              {failedPayslips!.map((p: any) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 px-3 py-2">
                  <div className="min-w-0">
                    <button type="button" onClick={() => { setMonth(p.month); setYear(p.year); setSelectedPayslip(p) }}
                      className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
                      {p.users?.full_name}
                    </button>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {MONTHS[p.month - 1]} {p.year}{p.failure_reason ? ` · ${p.failure_reason}` : ''}
                    </span>
                  </div>
                  <Link href={`/hr/staff/${p.user_id}`} className="whitespace-nowrap text-xs font-medium text-primary underline hover:text-primary/80">
                    Fix bank details →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
          <Button variant="outline" onClick={() => hrmsApi.payroll.downloadBankExport(month, year)}>
            <Download className="h-4 w-4" /> Bank Export (CSV)
          </Button>
          <Button variant="outline" onClick={() => setShowBonuses(true)}>
            <Gift className="h-4 w-4" /> Bonuses
          </Button>
          <Button variant="outline" onClick={() => setShowArrears(true)}>
            <History className="h-4 w-4" /> Salary Arrears
          </Button>
          <Button variant="outline" onClick={() => setShowDutyLog(true)}>
            <ClipboardList className="h-4 w-4" /> Duty Log
          </Button>
          <Button variant="outline" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4" /> Payroll Settings
          </Button>
          <Button onClick={() => generateMutation.mutate(undefined)} disabled={generateMutation.isPending}>
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
                <p className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {skipped !== null && skipped.length > 0 && (() => {
        const missingStructure = skipped.filter((s: any) => s.reason === 'no_salary_structure')
        const resigned = skipped.filter((s: any) => s.reason === 'resigned')
        const exited = skipped.filter((s: any) => s.reason === 'exited')
        const alreadyFinalized = skipped.filter((s: any) => s.reason === 'already_finalized')
        const suspended = skipped.filter((s: any) => s.reason === 'suspended')
        const absconded = skipped.filter((s: any) => s.reason === 'absconded')
        const insufficientData = skipped.filter((s: any) => s.reason === 'insufficient_attendance_data')
        const noApprovedSessions = skipped.filter((s: any) => s.reason === 'no_approved_sessions')
        const nameList = (list: any[]) => list.map((s, i) => (
          <span key={s.user_id}>
            {i > 0 && ', '}
            <Link href={`/hr/staff/${s.user_id}`} className="text-primary underline hover:text-primary/80">{s.full_name}</Link>
          </span>
        ))
        return (
          <div className="space-y-2">
            {missingStructure.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{missingStructure.length} staff member{missingStructure.length !== 1 ? 's' : ''} skipped — no salary structure on file</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(missingStructure)}
                    {' — set their salary under Staff → Payroll tab, then generate again.'}
                  </p>
                </div>
              </div>
            )}
            {alreadyFinalized.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 px-5 py-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{alreadyFinalized.length} staff member{alreadyFinalized.length !== 1 ? 's' : ''} left untouched — already approved/paid</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(alreadyFinalized)}
                    {' — re-running Generate never overwrites a payslip that\'s already been approved or paid. Need to fix one? Edit it directly from the table below.'}
                  </p>
                </div>
              </div>
            )}
            {resigned.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{resigned.length} staff member{resigned.length !== 1 ? 's' : ''} excluded — resigned/terminated</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(resigned)}
                    {' — no longer part of active payroll. Their prior payslips are unaffected and still payable via Bank Export.'}
                  </p>
                </div>
              </div>
            )}
            {exited.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{exited.length} staff member{exited.length !== 1 ? 's' : ''} excluded — notice period ended before this month</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(exited)}
                    {' — their last working day was before this period, but their exit settlement hasn\'t been approved yet. Approve it under Staff → Exit, or generate their final payslip for the month they actually left.'}
                  </p>
                </div>
              </div>
            )}
            {suspended.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 px-5 py-4">
                <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{suspended.length} staff member{suspended.length !== 1 ? 's' : ''} excluded — suspended</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(suspended)}
                    {' — this school\'s suspension pay policy is set to Exclude. Change it under Payroll Settings if suspended staff should still be paid in full or in part.'}
                  </p>
                </div>
              </div>
            )}
            {absconded.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{absconded.length} staff member{absconded.length !== 1 ? 's' : ''} excluded — absconded</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {absconded.map((s: any, i: number) => (
                      <span key={s.user_id}>
                        {i > 0 && ', '}
                        <Link href={`/hr/staff/${s.user_id}`} className="text-primary underline hover:text-primary/80">{s.full_name}</Link>
                        {s.last_seen && <span className="text-muted-foreground"> (last seen {s.last_seen})</span>}
                      </span>
                    ))}
                    {' — manually transition them to Active or Terminated once resolved.'}
                  </p>
                </div>
              </div>
            )}
            {insufficientData.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{insufficientData.length} hourly staff member{insufficientData.length !== 1 ? 's' : ''} skipped — no attendance marked</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(insufficientData)}
                    {' — hourly pay is derived from present/half-day attendance; mark it first, then generate again.'}
                  </p>
                </div>
              </div>
            )}
            {noApprovedSessions.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                <div className="text-sm text-foreground">
                  <p className="font-semibold">{noApprovedSessions.length} per-session staff member{noApprovedSessions.length !== 1 ? 's' : ''} skipped — no approved sessions</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameList(noApprovedSessions)}
                    {' — log and approve their sessions under Payroll → Duty Log, then generate again.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {!canApprove && (
        <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          Payslips need Principal approval before they can be marked as paid.
        </div>
      )}

      {canApprove && <PendingCorrections />}

      {/* Payslips table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (payslips ?? []).length === 0 ? (
          <EmptyState
            icon={IndianRupee}
            title={`No payslips for ${MONTHS[month - 1]} ${year}`}
            description='Click "Generate Payslips" to create them from staff salary structures'
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">LOP</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payslips ?? []).map((p: any) => (
                  <TableRow key={p.id} onClick={() => setSelectedPayslip(p)} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <StaffAvatar photoUrl={staffPhotoUrl(p.users?.staff_profiles)} fullName={p.users?.full_name} className="h-8 w-8 text-xs" />
                        <div>
                          <p className="font-semibold text-foreground">{p.users?.full_name}</p>
                          <p className="text-xs capitalize text-muted-foreground">{p.users?.role?.replace('_', ' ')}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(Number(p.gross_salary))}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(p.lop_days) > 0
                        ? <span className="text-warning">{p.lop_days}d · {formatCurrency(Number(p.lop_amount))}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(Number(p.total_deductions))}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(Number(p.net_salary))}</TableCell>
                    <TableCell>
                      <Badge variant={PAY_STATUS_VARIANT[p.payment_status] ?? 'secondary'} className="capitalize">
                        {p.payment_status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
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
                      {p.payment_status === 'paid' && canApprove && (
                        <Button size="sm" variant="ghost" onClick={() => setFailingPayslip(p)} className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive">
                          <XCircle className="h-3.5 w-3.5" /> Mark Failed
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {selectedPayslip && <PayslipBreakdownModal payslip={selectedPayslip} onClose={() => setSelectedPayslip(null)} />}
      {showSettings && <PayrollSettingsModal onClose={() => setShowSettings(false)} />}
      {showBonuses && <BonusesModal month={month} year={year} onClose={() => setShowBonuses(false)} />}
      {showArrears && <ArrearsModal onClose={() => setShowArrears(false)} />}
      {showDutyLog && <DutyLogModal onClose={() => setShowDutyLog(false)} />}
      {failingPayslip && <MarkFailedModal payslip={failingPayslip} onClose={() => setFailingPayslip(null)} />}

      {coverageWarning && (
        <Dialog open onOpenChange={(o) => { if (!o) setCoverageWarning(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning"><AlertTriangle className="h-5 w-5" /> Attendance mostly unmarked</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground">{coverageWarning.error}</p>
            <p className="text-xs text-muted-foreground">Only {coverageWarning.coverage_pct}% attendance coverage for {MONTHS[month - 1]} {year} so far.</p>
            {coverageWarning.unmarked_dates.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Dates needing attention</p>
                <div className="flex flex-wrap gap-1.5">
                  {coverageWarning.unmarked_dates.map(d => (
                    <span key={d} className="rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning">{formatDate(d)}</span>
                  ))}
                  {coverageWarning.unmarked_dates_more > 0 && (
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">and {coverageWarning.unmarked_dates_more} more</span>
                  )}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCoverageWarning(null)}>Cancel — mark attendance first</Button>
              <Button
                variant="secondary"
                className="bg-warning/10 text-warning hover:bg-warning/20"
                onClick={() => generateMutation.mutate(true)}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Generate Anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── PAYROLL SETTINGS — LOP grace/formula + professional tax slabs. Both
// were already fully built on the backend (GET/PUT /hrms/payroll/settings)
// with no UI anywhere to reach them — this is that missing UI.
function PayrollSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn: () => hrmsApi.payroll.settings.get().then(r => r.data),
  })

  const [graceDays, setGraceDays] = useState('0')
  const [formula, setFormula] = useState<'gross_30' | 'working_days'>('gross_30')
  const [suspensionPolicy, setSuspensionPolicy] = useState<'exclude' | 'full' | 'partial'>('exclude')
  const [suspensionPercent, setSuspensionPercent] = useState('0')
  const [prorationBasis, setProrationBasis] = useState<'calendar_days' | 'working_days'>('calendar_days')
  const [abscondedThreshold, setAbscondedThreshold] = useState('15')
  const [abscondedAutoFlag, setAbscondedAutoFlag] = useState(false)
  const [overtimeMultiplier, setOvertimeMultiplier] = useState('1.5')
  const [slabs, setSlabs] = useState<{ min_gross: string; max_gross: string; amount: string }[]>([])
  const [initialized, setInitialized] = useState(false)

  if (data && !initialized) {
    setGraceDays(String(data.lop_grace_days ?? 0))
    setFormula(data.lop_per_day_formula === 'working_days' ? 'working_days' : 'gross_30')
    setSuspensionPolicy(['exclude', 'full', 'partial'].includes(data.suspension_pay_policy) ? data.suspension_pay_policy : 'exclude')
    setSuspensionPercent(String(data.suspension_pay_percent ?? 0))
    setProrationBasis(data.segment_proration_basis === 'working_days' ? 'working_days' : 'calendar_days')
    setAbscondedThreshold(String(data.absconded_threshold_days ?? 15))
    setAbscondedAutoFlag(!!data.absconded_auto_flag)
    setOvertimeMultiplier(String(data.overtime_rate_multiplier ?? 1.5))
    setSlabs((data.professional_tax_slabs ?? []).map((s: any) => ({
      min_gross: String(s.min_gross ?? 0), max_gross: s.max_gross != null ? String(s.max_gross) : '', amount: String(s.amount ?? 0),
    })))
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.payroll.settings.update({
      lop_grace_days: Number(graceDays) || 0,
      lop_per_day_formula: formula,
      suspension_pay_policy: suspensionPolicy,
      suspension_pay_percent: suspensionPolicy === 'partial' ? Number(suspensionPercent) || 0 : 0,
      segment_proration_basis: prorationBasis,
      absconded_threshold_days: Number(abscondedThreshold) || 15,
      absconded_auto_flag: abscondedAutoFlag,
      overtime_rate_multiplier: Number(overtimeMultiplier) || 1.5,
      professional_tax_slabs: slabs
        .filter(s => s.min_gross !== '' && s.amount !== '')
        .map(s => ({ min_gross: Number(s.min_gross), max_gross: s.max_gross === '' ? null : Number(s.max_gross), amount: Number(s.amount) })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-settings'] })
      toast.success('Payroll settings saved')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const addSlab = () => setSlabs(s => [...s, { min_gross: '', max_gross: '', amount: '' }])
  const removeSlab = (i: number) => setSlabs(s => s.filter((_, idx) => idx !== i))
  const updateSlab = (i: number, field: 'min_gross' | 'max_gross' | 'amount', value: string) =>
    setSlabs(s => s.map((row, idx) => idx === i ? { ...row, [field]: value } : row))

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Payroll Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Loss of Pay (LOP)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Grace Days</Label>
                  <Input type="number" min="0" value={graceDays} onChange={e => setGraceDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Unmarked + absent days within this buffer aren't deducted.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Per-Day Rate</Label>
                  <Select value={formula} onValueChange={(v: any) => setFormula(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gross_30">Gross ÷ 30 (flat)</SelectItem>
                      <SelectItem value="working_days">Gross ÷ actual working days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Mid-Month Salary Changes</p>
              <div className="space-y-1.5">
                <Label>Proration Basis</Label>
                <Select value={prorationBasis} onValueChange={(v: any) => setProrationBasis(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar_days">Calendar days</SelectItem>
                    <SelectItem value="working_days">Working days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                When a promotion or salary update takes effect mid-month, the payslip splits into segments — one per
                salary structure, each earning its share of the month by {prorationBasis === 'working_days' ? 'working days' : 'calendar days'} covered.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Suspended Staff</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Pay Policy</Label>
                  <Select value={suspensionPolicy} onValueChange={(v: any) => setSuspensionPolicy(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">Exclude from payroll</SelectItem>
                      <SelectItem value="full">Pay in full</SelectItem>
                      <SelectItem value="partial">Pay a percentage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {suspensionPolicy === 'partial' && (
                  <div className="space-y-1.5">
                    <Label>Percent of Gross</Label>
                    <Input type="number" min="0" max="100" value={suspensionPercent} onChange={e => setSuspensionPercent(e.target.value)} />
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {suspensionPolicy === 'exclude'
                  ? 'A suspended staff member is skipped when Generate runs, same as resigned/terminated.'
                  : suspensionPolicy === 'full'
                  ? 'A suspended staff member is paid exactly like anyone else.'
                  : 'A suspended staff member\'s gross is scaled to this percentage before deductions are computed.'}
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Overtime</p>
              <div className="space-y-1.5">
                <Label>Overtime Rate Multiplier</Label>
                <Input type="number" min="1" step="0.1" className="w-32" value={overtimeMultiplier} onChange={e => setOvertimeMultiplier(e.target.value)} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Overtime hours are paid at this multiple of the regular hourly rate — for hourly staff, their own rate;
                for fixed-monthly staff with a shift assigned, an effective rate derived from gross ÷ working days ÷ shift hours.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Absconded Detection</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Consecutive Unmarked Days</Label>
                  <Input type="number" min="1" value={abscondedThreshold} onChange={e => setAbscondedThreshold(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>On Threshold Crossed</Label>
                  <Select value={abscondedAutoFlag ? 'auto' : 'review'} onValueChange={(v: any) => setAbscondedAutoFlag(v === 'auto')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="review">Notify HR for review</SelectItem>
                      <SelectItem value="auto">Auto-set to Absconded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A daily sweep checks for staff with this many consecutive unmarked/absent working days, excluding days
                covered by approved leave or a pending regularization request. {abscondedAutoFlag
                  ? 'Their employment status is set to Absconded automatically and they stop generating payslips.'
                  : 'HR is notified to review — nothing changes automatically until someone acts on it.'}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Professional Tax Slabs</p>
                <Button size="sm" variant="ghost" onClick={addSlab}><Plus className="h-3.5 w-3.5" /> Add Slab</Button>
              </div>
              {slabs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No slabs configured — professional tax falls back to each staff member's flat Salary Structure figure.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
                    <span>Min Gross</span><span>Max Gross</span><span>Amount</span><span />
                  </div>
                  {slabs.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                      <Input type="number" placeholder="0" value={s.min_gross} onChange={e => updateSlab(i, 'min_gross', e.target.value)} />
                      <Input type="number" placeholder="No limit" value={s.max_gross} onChange={e => updateSlab(i, 'max_gross', e.target.value)} />
                      <Input type="number" placeholder="0" value={s.amount} onChange={e => updateSlab(i, 'amount', e.target.value)} />
                      <Button variant="ghost" size="icon" onClick={() => removeSlab(i)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <TaxDeclarationWindowSection />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Stage 6: the per-year cutoff after which staff can no longer edit
// their own investment declaration — saved separately from the rest of
// Payroll Settings since it's keyed by academic year, not the school.
function TaxDeclarationWindowSection() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['tax-declaration-window'],
    queryFn: () => hrmsApi.taxDeclarations.window.get().then(r => r.data),
  })
  const [lockDate, setLockDate] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (data && !initialized) {
    setLockDate(data.lock_date ?? '')
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.taxDeclarations.window.save({ lock_date: lockDate, academic_year_id: data?.academic_year?.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-declaration-window'] })
      toast.success('Declaration lock date saved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  if (isLoading || !data?.academic_year) return null

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Investment Declaration Lock — {data.academic_year.name}</p>
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label>Lock Date</Label>
          <Input type="date" value={lockDate} onChange={e => setLockDate(e.target.value)} className="w-44" />
        </div>
        <Button size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !lockDate}>
          {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        After this date, staff can no longer edit their own 80C/HRA/exemption declaration for {data.academic_year.name} —
        leave blank for no lock.
      </p>
    </div>
  )
}

// ── BONUSES — one-off festival/performance bonuses for a specific
// month. Staged here (staff_bonuses table); POST /payslips/generate
// picks up whatever's on file for the selected month and adds it to
// that staff member's payslip as its own earnings line.
function BonusesModal({ month, year, onClose }: { month: number; year: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })
  const staff = (staffData ?? []).filter((s: any) => !['resigned', 'terminated'].includes(s.staff_profile?.employment_status))

  const { data: bonuses, isLoading: bonusesLoading } = useQuery({
    queryKey: ['staff-bonuses', month, year],
    queryFn: () => hrmsApi.bonuses.list(month, year).then(r => r.data),
  })

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allSelected = staff.length > 0 && selected.size === staff.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(staff.map((s: any) => s.id)))

  const awardMutation = useMutation({
    mutationFn: () => hrmsApi.bonuses.create({
      user_ids: Array.from(selected), month, year, amount: Number(amount), reason: reason.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-bonuses', month, year] })
      toast.success(`Bonus awarded to ${selected.size} staff member${selected.size !== 1 ? 's' : ''}`)
      setSelected(new Set()); setAmount(''); setReason('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to award bonus'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.bonuses.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-bonuses', month, year] })
      toast.success('Bonus removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const canAward = selected.size > 0 && Number(amount) > 0 && reason.trim().length > 0

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="h-4 w-4 text-primary" /> Bonuses — {MONTHS[month - 1]} {year}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Awarded here shows up as its own earnings line the next time payslips are generated for this month — it doesn't affect PF, professional tax, or TDS.
          </p>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Recipients</Label>
              {staff.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-xs font-medium text-primary hover:text-primary/80">
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            {staffLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {staff.map((s: any) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                    <input type="checkbox" className="h-4 w-4 rounded border-border" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    <StaffAvatar photoUrl={s.staff_profile?.photo_url} fullName={s.full_name} className="h-6 w-6 text-[10px]" />
                    <span className="text-foreground">{s.full_name}</span>
                    <span className="text-xs text-muted-foreground">{s.staff_profile?.designation ?? s.role}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2000" />
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Diwali Bonus" />
            </div>
          </div>

          <Button onClick={() => awardMutation.mutate()} disabled={!canAward || awardMutation.isPending} className="w-full">
            {awardMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            Award to {selected.size || 0} staff member{selected.size !== 1 ? 's' : ''}
          </Button>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Already staged for {MONTHS[month - 1]}</p>
            {bonusesLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (bonuses ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No bonuses staged for this month yet.</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {(bonuses ?? []).map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <StaffAvatar photoUrl={staffPhotoUrl(b.users?.staff_profiles)} fullName={b.users?.full_name} className="h-7 w-7 text-[10px]" />
                      <div>
                        <p className="font-medium text-foreground">{b.users?.full_name}</p>
                        <p className="text-xs text-muted-foreground">{b.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-semibold text-success">{formatCurrency(Number(b.amount))}</span>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(b.id)} disabled={deleteMutation.isPending} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Stage 7: salary arrears — back-pay the school owes the employee.
// Raise a manual record here; auto-staged ones (from a backdated
// promotion) show up in the same pending list below, already reasoned
// about. Both go through the same approve/reject decide() — self-decide
// is blocked server-side, so whoever raises one needs a second person.
function ArrearsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')
  const [fromMonth, setFromMonth] = useState(String(new Date().getMonth() + 1))
  const [fromYear, setFromYear] = useState(String(new Date().getFullYear()))
  const [toMonth, setToMonth] = useState(String(new Date().getMonth() + 1))
  const [toYear, setToYear] = useState(String(new Date().getFullYear()))
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })
  const staff = (staffData ?? []).filter((s: any) => !['resigned', 'terminated'].includes(s.staff_profile?.employment_status))

  const { data: arrears, isLoading: arrearsLoading } = useQuery({
    queryKey: ['salary-arrears', 'all'],
    queryFn: () => hrmsApi.salaryArrears.list({}).then(r => r.data as any[]),
  })
  const pending = (arrears ?? []).filter((a: any) => a.status === 'pending')
  const others = (arrears ?? []).filter((a: any) => a.status !== 'pending').slice(0, 10)

  const raiseMutation = useMutation({
    mutationFn: () => hrmsApi.salaryArrears.create({
      user_id: userId, from_month: Number(fromMonth), from_year: Number(fromYear),
      to_month: Number(toMonth), to_year: Number(toYear), amount: Number(amount), reason: reason.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-arrears'] })
      toast.success('Arrears raised — needs a second person to approve')
      setUserId(''); setAmount(''); setReason('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to raise arrears'),
  })

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) => hrmsApi.salaryArrears.decide(id, decision),
    onSuccess: (_res, { decision }) => {
      qc.invalidateQueries({ queryKey: ['salary-arrears'] })
      toast.success(decision === 'approved' ? 'Arrears approved — staged for the next payslip' : 'Arrears rejected')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not record the decision'),
  })

  const canRaise = userId && amount && Number(amount) !== 0 && reason.trim().length >= 3

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Salary Arrears</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Raise Manual Arrears</p>
            <div className="space-y-1.5">
              <Label>Staff Member</Label>
              <Select value={userId} onValueChange={setUserId} disabled={staffLoading}>
                <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label>From Month</Label>
                <Input type="number" min="1" max="12" value={fromMonth} onChange={e => setFromMonth(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>From Year</Label>
                <Input type="number" value={fromYear} onChange={e => setFromYear(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To Month</Label>
                <Input type="number" min="1" max="12" value={toMonth} onChange={e => setToMonth(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To Year</Label>
                <Input type="number" value={toYear} onChange={e => setToYear(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Backdated pay-scale revision" />
              </div>
            </div>
            <Button onClick={() => raiseMutation.mutate()} disabled={!canRaise || raiseMutation.isPending}>
              {raiseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Raise Arrears
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pending Review</p>
            {arrearsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing pending.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((a: any) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-foreground">
                        {a.users?.full_name} — {MONTHS[a.from_month - 1]} {a.from_year}
                        {(a.from_month !== a.to_month || a.from_year !== a.to_year) && ` to ${MONTHS[a.to_month - 1]} ${a.to_year}`}
                        <span className={cn('ml-1.5 tabular-nums', Number(a.amount) >= 0 ? 'text-success' : 'text-destructive')}>
                          {Number(a.amount) >= 0 ? '+' : ''}{formatCurrency(Number(a.amount))}
                        </span>
                        {a.source === 'auto_promotion' && <Badge variant="info" className="ml-1.5">auto-staged</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{a.reason} · raised by {a.requester?.full_name}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => decideMutation.mutate({ id: a.id, decision: 'approved' })} disabled={decideMutation.isPending}
                        className="bg-success/10 text-success shadow-none hover:bg-success/20">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" onClick={() => decideMutation.mutate({ id: a.id, decision: 'rejected' })} disabled={decideMutation.isPending}
                        className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {others.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recent History</p>
              <div className="space-y-1.5">
                {others.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
                    <span className="text-foreground">
                      {a.users?.full_name} — {MONTHS[a.from_month - 1]} {a.from_year} · {formatCurrency(Number(a.amount))}
                    </span>
                    <Badge variant={a.status === 'applied' ? 'success' : a.status === 'staged' ? 'info' : 'secondary'} className="capitalize">{a.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Stage 9: per-session staff have no fixed pay at all — earnings come
// entirely from approved entries here, summed by Generate into one
// Session Pay line. Unapproved entries are never picked up.
function DutyLogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [sessionType, setSessionType] = useState('')
  const [description, setDescription] = useState('')
  const [rate, setRate] = useState('')

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })
  const staff = (staffData ?? []).filter((s: any) => !['resigned', 'terminated'].includes(s.staff_profile?.employment_status))

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['duty-log', 'all'],
    queryFn: () => hrmsApi.dutyLog.list({}).then(r => r.data as any[]),
  })
  const pending = (entries ?? []).filter((d: any) => !d.approved_by).slice(0, 30)
  const approved = (entries ?? []).filter((d: any) => d.approved_by).slice(0, 10)

  const createMutation = useMutation({
    mutationFn: () => hrmsApi.dutyLog.create({ user_id: userId, date, session_type: sessionType.trim(), description: description.trim() || undefined, rate: Number(rate) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duty-log'] })
      toast.success('Session logged — needs approval before it counts toward pay')
      setSessionType(''); setDescription(''); setRate('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to log session'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.dutyLog.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duty-log'] })
      toast.success('Session approved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to approve'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.dutyLog.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duty-log'] })
      toast.success('Entry removed')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove'),
  })

  const canLog = userId && date && sessionType.trim() && Number(rate) > 0

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> Duty Log</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Log a Session</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Staff Member</Label>
                <Select value={userId} onValueChange={setUserId} disabled={staffLoading}>
                  <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>
                    {staff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Session Type</Label>
                <Input value={sessionType} onChange={e => setSessionType(e.target.value)} placeholder="e.g. Exam Invigilation" />
              </div>
              <div className="space-y-1.5">
                <Label>Rate (₹)</Label>
                <Input type="number" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 500" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description (optional)</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Class X Mid-Term, Hall 3" />
              </div>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={!canLog || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Log Session
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pending Approval</p>
            {entriesLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing pending.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((d: any) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-foreground">
                        {d.users?.full_name} — {d.session_type} · {formatDate(d.date)}
                        <span className="ml-1.5 tabular-nums text-foreground">{formatCurrency(Number(d.rate))}</span>
                      </p>
                      {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveMutation.mutate(d.id)} disabled={approveMutation.isPending}
                        className="bg-success/10 text-success shadow-none hover:bg-success/20">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(d.id)} disabled={deleteMutation.isPending}
                        className="text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {approved.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recently Approved</p>
              <div className="space-y-1.5">
                {approved.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
                    <span className="text-foreground">{d.users?.full_name} — {d.session_type} · {formatDate(d.date)} · {formatCurrency(Number(d.rate))}</span>
                    <Badge variant="success">approved</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Stage 4: the correction approval queue — one open request per
// payslip at a time (the DB enforces that), each either voiding and
// replacing an unpaid payslip in place, or an adjustment that rides
// along on whoever's NEXT payslip once approved.
function PendingCorrections() {
  const qc = useQueryClient()
  const { data: corrections, isLoading } = useQuery({
    queryKey: ['payslip-corrections', 'pending'],
    queryFn: () => hrmsApi.payslipCorrections.list({ decision: 'pending' }).then(r => r.data as any[]),
  })

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) => hrmsApi.payslipCorrections.decide(id, decision),
    onSuccess: (_res, { decision }) => {
      qc.invalidateQueries({ queryKey: ['payslip-corrections'] })
      qc.invalidateQueries({ queryKey: ['payslips'] })
      toast.success(decision === 'approved' ? 'Correction approved' : 'Correction rejected')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not record the decision'),
  })

  if (isLoading || !corrections?.length) return null

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" /> Pending payslip corrections
        </p>
        {corrections.map((c: any) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-foreground">
                {c.users?.full_name} — {c.kind === 'adjustment' ? 'Adjustment on a future payslip' : 'Correct this payslip'}
                {c.kind === 'adjustment' && (
                  <span className={cn('ml-1.5 tabular-nums', Number(c.adjustment_amount) >= 0 ? 'text-success' : 'text-destructive')}>
                    {Number(c.adjustment_amount) >= 0 ? '+' : ''}{formatCurrency(Number(c.adjustment_amount))}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{c.reason} · requested by {c.requester?.full_name}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decideMutation.mutate({ id: c.id, decision: 'approved' })} disabled={decideMutation.isPending}
                className="bg-success/10 text-success shadow-none hover:bg-success/20">
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" onClick={() => decideMutation.mutate({ id: c.id, decision: 'rejected' })} disabled={decideMutation.isPending}
                className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Stage 8: mark a 'paid' payslip as failed (bounced/rejected by the
// bank). payment_exported resets to false server-side — the money is
// treated as never having arrived, so the next bank export and the
// failed-payments banner both pick it back up automatically.
function MarkFailedModal({ payslip, onClose }: { payslip: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [bankRef, setBankRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (reason.trim().length < 3) return toast.error('Give a reason — what did the bank say?')
    setLoading(true)
    try {
      await hrmsApi.payslips.markFailed(payslip.id, { reason: reason.trim(), bank_reference: bankRef.trim() || undefined })
      qc.invalidateQueries({ queryKey: ['payslips'] })
      setDone(true)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not mark as failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /> Marked Failed</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground">
              {payslip.users?.full_name}'s payslip is back to an actionable state and will be picked up in the next bank export.
              The most common cause of a bounced transfer is a wrong or outdated bank detail — worth checking now.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button asChild>
                <Link href={`/hr/staff/${payslip.user_id}`}>Go to Bank & Tax Details</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /> Mark Payment Failed — {payslip.users?.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                For a payslip that was marked paid but the bank transfer bounced or was rejected. It goes back to an
                actionable, re-exportable state — nothing here reverses PF/TDS/other figures, only the payment outcome.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="fail-reason">Reason *</Label>
                <Textarea id="fail-reason" rows={2} className="resize-none" value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Account number invalid — bounced back from bank" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fail-ref">Bank Reference (optional)</Label>
                <Input id="fail-ref" value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="Bank's own rejection reference, if any" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={loading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Mark Failed
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
