'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { ShieldAlert, CalendarX2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { StaffAvatar, staffPhotoUrl } from '@/components/hr/StaffAvatar'
import { usePermissions } from '@/lib/usePermissions'

// Shared by the admin Payroll page and the self-service My Payslips page —
// one component, one set of named earnings/deduction lines, so the two
// views can never drift apart the way two hand-copies of this dialog
// eventually would (the exact failure mode already fixed once elsewhere
// in this codebase for Staff Directory / Leave Summary).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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
export function PayslipBreakdownModal({ payslip: initialPayslip, onClose }: { payslip: any; onClose: () => void }) {
  const { can } = usePermissions()
  const [showCorrection, setShowCorrection] = useState(false)

  // The row from the list is enough for the summary card, but segments
  // (Stage 5 — a mid-month salary change) only come from the full
  // per-id detail, so this refetches and prefers that once it lands.
  const { data: detail } = useQuery({
    queryKey: ['payslip-detail', initialPayslip.id],
    queryFn: () => hrmsApi.payslips.get(initialPayslip.id).then(r => r.data),
  })
  const p = detail ?? initialPayslip
  const segments: any[] = p.payslip_segments ?? []

  const { data: openCorrections } = useQuery({
    queryKey: ['payslip-corrections', p.id],
    queryFn: () => hrmsApi.payslipCorrections.list({ payslip_id: p.id, decision: 'pending' }).then(r => r.data as any[]),
    enabled: ['approved', 'paid'].includes(p.payment_status),
  })
  const hasPendingCorrection = (openCorrections ?? []).length > 0

  // Stage 7: which specific arrears records were applied here, so the
  // line below can name the actual period(s) they cover instead of just
  // showing the aggregate amount stored on the payslip itself.
  const { data: appliedArrears } = useQuery({
    queryKey: ['salary-arrears', 'applied', p.id],
    queryFn: () => hrmsApi.salaryArrears.list({ applied_to_payslip_id: p.id }).then(r => r.data as any[]),
    enabled: Number(p.arrears_amount) !== 0,
  })

  // Back-reference for the correction line: which correction record(s)
  // fed this payslip's correction_adjustment, and which ORIGINAL payslip
  // (correction.payslip_id) they were raised against — identified by
  // period, since there's no in-dialog deep link to jump to another
  // payslip's own breakdown from here.
  const { data: appliedCorrections } = useQuery({
    queryKey: ['payslip-corrections', 'applied', p.id],
    queryFn: async () => {
      const corrections = await hrmsApi.payslipCorrections.list({ applied_to_payslip_id: p.id }).then(r => r.data as any[])
      return Promise.all(corrections.map(async (c: any) => {
        if (!c.payslip_id) return c
        try {
          const source = await hrmsApi.payslips.get(c.payslip_id).then(r => r.data)
          return { ...c, source_month: source.month, source_year: source.year }
        } catch {
          return c
        }
      }))
    },
    enabled: Number(p.correction_adjustment) !== 0,
  })

  // Session count for the Session Pay line — duty log entries aren't
  // consumed/tagged when Generate sums them (recomputed fresh from the
  // same period each run, same as bonuses), so the count for THIS
  // payslip is just "however many approved entries exist for this
  // user/period," identical to what Generate itself summed.
  const { data: sessionEntries } = useQuery({
    queryKey: ['duty-log', p.user_id, p.month, p.year],
    queryFn: () => hrmsApi.dutyLog.list({ user_id: p.user_id, month: p.month, year: p.year, approved_only: true }).then(r => r.data as any[]),
    enabled: Number(p.session_pay_amount) > 0,
  })

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

  // Stage 9: hourly staff's regular pay is folded into gross_salary
  // directly (no dedicated column, unlike session pay) — the remainder
  // after every OTHER known earnings line is subtracted is exactly that
  // figure, shown under its own label rather than left unexplained.
  const knownEarningsSum = Number(p.basic_salary) + Number(p.hra) + Number(p.da) + Number(p.conveyance_allowance)
    + Number(p.medical_allowance) + Number(p.other_allowances) + Number(p.session_pay_amount ?? 0)
  const hourlyRegularPay = Math.round(Number(p.gross_salary) - knownEarningsSum)

  const sessionCount = sessionEntries?.length ?? 0

  const earnings = [
    ['Basic Salary', p.basic_salary], ['HRA', p.hra], ['DA', p.da],
    ['Conveyance', p.conveyance_allowance], ['Medical Allowance', p.medical_allowance],
    ['Other Allowances', p.other_allowances], ['Leave Encashment', p.leave_encashment],
    [p.bonus_reason ? `Bonus (${p.bonus_reason})` : 'Bonus', p.bonus_amount],
    ['Hourly Pay', hourlyRegularPay],
    [sessionCount > 0 ? `Session Pay — ${sessionCount} session${sessionCount === 1 ? '' : 's'}` : 'Session Pay', p.session_pay_amount],
    ['Stipend', p.stipend_amount],
    ['Overtime Pay', p.overtime_amount],
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
          <DialogTitle className="flex items-center gap-2.5">
            <StaffAvatar photoUrl={staffPhotoUrl(p.users?.staff_profiles)} fullName={p.users?.full_name} className="h-7 w-7 text-[11px]" />
            {p.users?.full_name} — {MONTHS[p.month - 1]} {p.year}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {segments.length > 1 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase text-primary">
                Segmented — {segments.length} salary structures this month
              </p>
              <div className="space-y-1.5">
                {segments.map((seg: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-background/60 px-2.5 py-1.5 text-xs">
                    <span className="text-foreground">
                      {formatDate(seg.segment_from)} – {formatDate(seg.segment_to)}
                      <span className="ml-1.5 text-muted-foreground">({seg.basis_days} of {seg.total_basis_days} days)</span>
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(seg.gross_salary))}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A salary change took effect partway through this month — each segment earned its own share of Basic/HRA/DA/etc, prorated by days covered. PF, Professional Tax, TDS and LOP are computed once on the combined total below.
              </p>
            </div>
          )}

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

          {Number(p.arrears_amount) !== 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
              {(appliedArrears ?? []).length > 0 ? (
                (appliedArrears ?? []).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Salary Arrears — {MONTHS[a.from_month - 1]} {a.from_year}
                      {(a.from_month !== a.to_month || a.from_year !== a.to_year) && ` to ${MONTHS[a.to_month - 1]} ${a.to_year}`}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(a.amount))}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Salary Arrears</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(p.arrears_amount))}</span>
                </div>
              )}
            </div>
          )}

          {Number(p.correction_adjustment) !== 0 && (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Correction {Number(p.correction_adjustment) > 0 ? 'top-up' : 'recovery'} from a prior payslip</span>
                <span className={cn('font-semibold tabular-nums', Number(p.correction_adjustment) > 0 ? 'text-success' : 'text-destructive')}>
                  {Number(p.correction_adjustment) > 0 ? '+' : ''}{formatCurrency(Number(p.correction_adjustment))}
                </span>
              </div>
              {(appliedCorrections ?? []).map((c: any) => (
                <p key={c.id} className="mt-1 text-xs text-muted-foreground">
                  From the {c.source_month ? `${MONTHS[c.source_month - 1]} ${c.source_year}` : 'prior'} payslip — {c.reason}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Net Pay</span>
            <span className="text-lg font-bold tabular-nums text-primary">{formatCurrency(Number(p.net_salary))}</span>
          </div>

          {['approved', 'paid'].includes(p.payment_status) && can('staff.payroll_manage') && (
            hasPendingCorrection ? (
              <div className="flex items-center gap-2 rounded-xl bg-warning/10 px-4 py-2.5 text-xs text-warning">
                <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
                A correction request is already pending on this payslip — decide it from the queue above before raising another.
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowCorrection(true)}>
                <ShieldAlert className="h-3.5 w-3.5" /> Request Correction
              </Button>
            )
          )}

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

      {showCorrection && <CorrectionRequestModal payslip={p} onClose={() => setShowCorrection(false)} />}
    </Dialog>
  )
}

// ── Stage 4: raise a correction request. Which shape it takes is
// decided by the payslip's own state (payment_exported / paid), not
// by anything the requester picks — same rule the backend enforces.
function CorrectionRequestModal({ payslip, onClose }: { payslip: any; onClose: () => void }) {
  const qc = useQueryClient()
  const moneyHasLeft = payslip.payment_status === 'paid' || payslip.payment_exported
  const [reason, setReason] = useState('')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(CORRECTION_FIELD_KEYS.map(k => [k, String(payslip[k] ?? 0)])))
  const [loading, setLoading] = useState(false)

  const setField = (key: string, value: string) => setFields(f => ({ ...f, [key]: value }))

  const submit = async () => {
    if (reason.trim().length < 3) return toast.error('Give a reason — it is what the approver decides on')
    setLoading(true)
    try {
      if (moneyHasLeft) {
        const amount = Number(adjustmentAmount)
        if (!amount) { toast.error('Enter a nonzero adjustment amount'); return }
        await hrmsApi.payslips.requestCorrection(payslip.id, { reason: reason.trim(), adjustment_amount: amount })
      } else {
        const corrected: Record<string, number> = {}
        for (const key of CORRECTION_FIELD_KEYS) {
          const next = Number(fields[key])
          if (Number.isFinite(next) && next !== Number(payslip[key] ?? 0)) corrected[key] = next
        }
        if (!Object.keys(corrected).length) { toast.error('Change at least one figure'); return }
        await hrmsApi.payslips.requestCorrection(payslip.id, { reason: reason.trim(), corrected })
      }
      toast.success('Correction request raised — it needs an approver before it takes effect')
      qc.invalidateQueries({ queryKey: ['payslip-corrections'] })
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not raise the request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Correction — {payslip.users?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {moneyHasLeft ? (
            <>
              <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                This payslip is {payslip.payment_status === 'paid' ? 'already marked paid' : 'already in a bank export'} — its
                own figures stay exactly as they were. Enter the difference instead; it's applied as its own line the next
                time a payslip is generated for {payslip.users?.full_name}.
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-amount">Adjustment Amount *</Label>
                <Input id="adj-amount" type="number" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} placeholder="e.g. 1500 or -1500" />
                <p className="text-xs text-muted-foreground">Positive = top-up owed to them. Negative = recovery owed back to the school.</p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                Nothing has been paid out on this payslip yet — change any figure below and it's corrected in place, then sent
                back for approval before it can be marked paid again.
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CORRECTION_FIELD_KEYS.map(key => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{CORRECTION_FIELD_LABELS[key]}</Label>
                    <Input type="number" value={fields[key]} onChange={e => setField(key, e.target.value)} />
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="corr-reason">Reason *</Label>
            <Textarea id="corr-reason" rows={2} className="resize-none" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="What was wrong, and why should this be approved?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Raise Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CORRECTION_FIELD_KEYS = [
  'basic_salary', 'hra', 'da', 'conveyance_allowance', 'medical_allowance', 'other_allowances',
  'pf_deduction', 'professional_tax', 'other_deductions', 'tds', 'bonus_amount', 'lop_days', 'lop_amount',
] as const

const CORRECTION_FIELD_LABELS: Record<string, string> = {
  basic_salary: 'Basic Salary', hra: 'HRA', da: 'DA', conveyance_allowance: 'Conveyance',
  medical_allowance: 'Medical Allowance', other_allowances: 'Other Allowances',
  pf_deduction: 'PF', professional_tax: 'Professional Tax', other_deductions: 'Other Deductions',
  tds: 'TDS', bonus_amount: 'Bonus', lop_days: 'LOP Days', lop_amount: 'LOP Amount',
}
