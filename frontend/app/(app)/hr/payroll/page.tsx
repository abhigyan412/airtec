'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, IndianRupee, Loader2, Play, Check, ShieldCheck, AlertTriangle, Wallet, Download, CalendarX2, Settings, Plus, Trash2, Gift } from 'lucide-react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

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

  const { data: payslips, isLoading } = useQuery({
    queryKey: ['payslips', month, year],
    queryFn: () => hrmsApi.payslips.list({ month, year, limit: 100 }).then(r => r.data),
  })

  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: () => hrmsApi.payroll.summary({ month, year }).then(r => r.data),
  })

  const [coverageWarning, setCoverageWarning] = useState<{ error: string; coverage_pct: number } | null>(null)

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
        setCoverageWarning({ error: e.response.data.error, coverage_pct: e.response.data.coverage_pct })
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
        const alreadyFinalized = skipped.filter((s: any) => s.reason === 'already_finalized')
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
          </div>
        )
      })()}

      {!canApprove && (
        <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          Payslips need Principal approval before they can be marked as paid.
        </div>
      )}

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
                      <p className="font-semibold text-foreground">{p.users?.full_name}</p>
                      <p className="text-xs capitalize text-muted-foreground">{p.users?.role?.replace('_', ' ')}</p>
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

      {coverageWarning && (
        <Dialog open onOpenChange={(o) => { if (!o) setCoverageWarning(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning"><AlertTriangle className="h-5 w-5" /> Attendance mostly unmarked</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground">{coverageWarning.error}</p>
            <p className="text-xs text-muted-foreground">Only {coverageWarning.coverage_pct}% attendance coverage for {MONTHS[month - 1]} {year} so far.</p>
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
  const [slabs, setSlabs] = useState<{ min_gross: string; max_gross: string; amount: string }[]>([])
  const [initialized, setInitialized] = useState(false)

  if (data && !initialized) {
    setGraceDays(String(data.lop_grace_days ?? 0))
    setFormula(data.lop_per_day_formula === 'working_days' ? 'working_days' : 'gross_30')
    setSlabs((data.professional_tax_slabs ?? []).map((s: any) => ({
      min_gross: String(s.min_gross ?? 0), max_gross: s.max_gross != null ? String(s.max_gross) : '', amount: String(s.amount ?? 0),
    })))
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.payroll.settings.update({
      lop_grace_days: Number(graceDays) || 0,
      lop_per_day_formula: formula,
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
                    <div>
                      <p className="font-medium text-foreground">{b.users?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{b.reason}</p>
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

const ATTENDANCE_STATUS_LABEL: Record<string, string> = { present: 'Present', absent: 'Absent', half_day: 'Half Day', on_leave: 'On Leave' }
const ATTENDANCE_STATUS_COLOR: Record<string, string> = {
  present: 'bg-success/10 text-success', absent: 'bg-destructive/10 text-destructive',
  half_day: 'bg-warning/10 text-warning', on_leave: 'bg-info/10 text-info',
}

// Line-item breakdown of what actually built this payslip's numbers —
// every figure below is read straight off the payslip row itself
// (generation already computed and stored each of these; this just
// makes them visible instead of only the collapsed Gross/Deductions/Net
// columns in the table). The attendance and leave sections underneath
// answer "which days" for the LOP figure, since the payslip itself only
// stores the day COUNT, not which dates — those come from the same
// staff_attendance/leave_requests data the LOP calculation itself reads.
function PayslipBreakdownModal({ payslip: p, onClose }: { payslip: any; onClose: () => void }) {
  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    queryKey: ['payslip-attendance', p.user_id, p.month, p.year],
    queryFn: () => hrmsApi.attendance.list({ user_id: p.user_id, month: p.month, year: p.year }).then(r => r.data),
  })

  const { data: leaveRequests, isLoading: leaveLoading } = useQuery({
    queryKey: ['payslip-leave-requests', p.user_id, p.month, p.year],
    queryFn: () => hrmsApi.leaveRequests.list({ user_id: p.user_id, status: 'approved', limit: 50 }).then(r => r.data),
  })

  const monthStart = `${p.year}-${String(p.month).padStart(2, '0')}-01`
  const monthEnd = `${p.year}-${String(p.month).padStart(2, '0')}-31`
  const leavesThisMonth = (leaveRequests ?? []).filter((lr: any) => lr.from_date <= monthEnd && lr.to_date >= monthStart)

  // Only the days that actually explain the deductions/pace — present
  // days aren't interesting here, so they're excluded from the list
  // (still counted in the "Present" tally above it).
  const nonPresentDays = (attendance ?? []).filter((a: any) => a.status !== 'present').sort((a: any, b: any) => a.date.localeCompare(b.date))
  const presentCount = (attendance ?? []).filter((a: any) => a.status === 'present').length

  const earnings = [
    ['Basic Salary', p.basic_salary], ['HRA', p.hra], ['DA', p.da],
    ['Conveyance', p.conveyance_allowance], ['Medical Allowance', p.medical_allowance],
    ['Other Allowances', p.other_allowances], ['Leave Encashment', p.leave_encashment],
    [p.bonus_reason ? `Bonus (${p.bonus_reason})` : 'Bonus', p.bonus_amount],
  ].filter(([, v]) => Number(v) > 0) as [string, number][]

  const deductions = [
    ['PF (Employee)', p.pf_deduction],
    ['Professional Tax', p.professional_tax],
    ['TDS', p.tds],
    ['Loan Recovery', p.loan_deduction],
    ['Other Deductions', p.other_deductions],
  ].filter(([, v]) => Number(v) > 0) as [string, number][]

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{p.users?.full_name} — {MONTHS[p.month - 1]} {p.year}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Earnings</p>
              <div className="space-y-1 text-sm">
                {earnings.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-foreground">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{formatCurrency(Number(value))}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-sm font-semibold text-foreground">
                <span>Gross</span>
                <span className="tabular-nums">{formatCurrency(Number(p.gross_salary))}</span>
              </div>
            </div>

            <div className="rounded-xl bg-muted/50 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Deductions</p>
              <div className="space-y-1 text-sm">
                {Number(p.lop_days) > 0 && (
                  <div className="flex justify-between text-foreground">
                    <span className="text-muted-foreground">LOP ({p.lop_days} day{Number(p.lop_days) === 1 ? '' : 's'})</span>
                    <span className="tabular-nums text-destructive">{formatCurrency(Number(p.lop_amount))}</span>
                  </div>
                )}
                {deductions.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-foreground">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{formatCurrency(Number(value))}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-sm font-semibold text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(Number(p.total_deductions))}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Net Pay</span>
            <span className="text-lg font-bold tabular-nums text-primary">{formatCurrency(Number(p.net_salary))}</span>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Attendance this month {!attendanceLoading && <span className="font-normal normal-case">· {presentCount} present</span>}
            </p>
            {attendanceLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : nonPresentDays.length === 0 ? (
              <p className="text-xs text-muted-foreground">No absences, half-days, or leave marked this month.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {nonPresentDays.map((a: any) => (
                  <span key={a.id} className={cn('rounded-full px-2 py-1 text-xs font-medium', ATTENDANCE_STATUS_COLOR[a.status] ?? 'bg-muted text-muted-foreground')}>
                    {formatDate(a.date)} · {ATTENDANCE_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                ))}
              </div>
            )}
            {Number(p.lop_days) > (attendance ?? []).filter((a: any) => a.status === 'absent').length && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <CalendarX2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                The LOP count also includes days with no attendance record marked at all (unmarked) — those don't show as a badge above since there's no record to display, only a gap in the calendar.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Leave taken this month</p>
            {leaveLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : leavesThisMonth.length === 0 ? (
              <p className="text-xs text-muted-foreground">No approved leave overlapping this month.</p>
            ) : (
              <div className="space-y-1.5">
                {leavesThisMonth.map((lr: any) => (
                  <div key={lr.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-xs">
                    <span className="text-foreground">{lr.leave_types?.name ?? 'Leave'} · {formatDate(lr.from_date)}–{formatDate(lr.to_date)} · {lr.total_days}d</span>
                    <Badge variant={lr.leave_types?.is_paid ? 'success' : 'destructive'}>{lr.leave_types?.is_paid ? 'Paid' : 'Unpaid'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
