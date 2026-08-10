'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi, documentsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatCurrency } from '@/lib/utils'
import { CreditCard, Printer, IndianRupee, ReceiptText, Lock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { PayslipBreakdownModal } from '@/components/hr/PayslipBreakdownModal'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PAY_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info'> = {
  pending: 'warning', approved: 'info', paid: 'success', on_hold: 'destructive', failed: 'destructive',
}

export default function MyPayslipsPage() {
  const { user } = useAuth()
  const [selectedPayslip, setSelectedPayslip] = useState<any | null>(null)

  // Always pass user_id explicitly rather than relying on the backend's
  // implicit self-scoping — that only kicks in for non-admins, so a
  // School Admin/Principal/Accountant checking their OWN payslips here
  // would otherwise silently see every staff member's, the same class
  // of bug already fixed on the Leave Requests page earlier.
  const { data: payslips, isLoading } = useQuery({
    queryKey: ['my-payslips', user?.id],
    queryFn: () => hrmsApi.payslips.list({ user_id: user?.id, limit: 24 }).then(r => r.data),
    enabled: !!user,
  })

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="My Payslips"
        description="View and print your salary payslips"
        icon={CreditCard}
      />

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Payslip History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (payslips ?? []).length === 0 ? (
            <EmptyState
              icon={IndianRupee}
              title="No payslips yet"
              description="Payslips appear here once a monthly payroll run including you has been generated."
            />
          ) : (
            <div className="divide-y divide-border">
              {(payslips ?? []).map((p: any) => (
                <div key={p.id} onClick={() => setSelectedPayslip(p)} className="flex cursor-pointer items-center justify-between px-6 py-4 hover:bg-muted/40">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{MONTHS[p.month - 1]} {p.year}</span>
                      <Badge variant={PAY_STATUS_VARIANT[p.payment_status] ?? 'secondary'} className="capitalize">{p.payment_status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Net Pay: <span className="font-semibold text-foreground">{formatCurrency(Number(p.net_salary))}</span>
                      {Number(p.lop_days) > 0 && <span className="ml-2 text-xs text-warning">{p.lop_days} LOP day(s)</span>}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild onClick={e => e.stopPropagation()}>
                    <a href={documentsApi.payslip(p.id)} target="_blank" rel="noreferrer">
                      <Printer className="h-3.5 w-3.5" /> View / Print
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TaxDeclarationCard />
      <TaxReconciliationCard />

      {selectedPayslip && <PayslipBreakdownModal payslip={selectedPayslip} onClose={() => setSelectedPayslip(null)} />}
    </div>
  )
}

const SECTION_80C_CAP = 150000

// ── Stage 6: self-service investment declaration — what feeds the YTD
// TDS projection on the payroll side. Locks after the school's own
// per-year cutoff (GET already tells us whether we're past it).
function TaxDeclarationCard() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['tax-declaration', 'me'],
    queryFn: () => hrmsApi.taxDeclarations.get().then(r => r.data),
  })

  const [section80c, setSection80c] = useState('')
  const [hraExemption, setHraExemption] = useState('')
  const [otherExemptions, setOtherExemptions] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (data && !initialized) {
    setSection80c(String(data.declaration?.section_80c ?? 0))
    setHraExemption(String(data.declaration?.hra_exemption ?? 0))
    setOtherExemptions(String(data.declaration?.other_exemptions ?? 0))
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.taxDeclarations.save({
      section_80c: Number(section80c) || 0,
      hra_exemption: Number(hraExemption) || 0,
      other_exemptions: Number(otherExemptions) || 0,
      academic_year_id: data?.academic_year?.id,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-declaration'] })
      qc.invalidateQueries({ queryKey: ['tax-reconciliation'] })
      toast.success('Investment declaration saved — next payslip\'s TDS reflects it')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not save declaration'),
  })

  if (isLoading) return <Card><CardContent className="p-5"><Skeleton className="h-32 w-full" /></CardContent></Card>
  if (!data?.academic_year) return null

  const over80cCap = Number(section80c) > SECTION_80C_CAP

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-muted-foreground" /> Investment Declaration — {data.academic_year.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {data.is_locked ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 flex-shrink-0" />
            Declarations for {data.academic_year.name} locked on {data.lock_date} — contact payroll for a correction.
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tell payroll what you're claiming this year so TDS is withheld against your actual tax liability instead of
            your gross pay alone. This updates from the next payslip generated onward — it doesn't retroactively change
            what's already been withheld.
            {data.lock_date && <> Editable until <span className="font-medium text-foreground">{data.lock_date}</span>.</>}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Section 80C</Label>
            <Input type="number" min="0" value={section80c} onChange={e => setSection80c(e.target.value)} disabled={data.is_locked} />
            <p className={cn('text-xs', over80cCap ? 'text-warning' : 'text-muted-foreground')}>
              {over80cCap ? `Capped at ${formatCurrency(SECTION_80C_CAP)} — the excess won't reduce TDS.` : `Up to ${formatCurrency(SECTION_80C_CAP)} statutory cap.`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>HRA Exemption</Label>
            <Input type="number" min="0" value={hraExemption} onChange={e => setHraExemption(e.target.value)} disabled={data.is_locked} />
          </div>
          <div className="space-y-1.5">
            <Label>Other Exemptions</Label>
            <Input type="number" min="0" value={otherExemptions} onChange={e => setOtherExemptions(e.target.value)} disabled={data.is_locked} />
          </div>
        </div>
        {!data.is_locked && (
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Declaration
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ── Stage 6: the Form 16 source data — accumulated so far this FY,
// against what's actually being withheld, so a shortfall shows up
// months before March instead of as a surprise.
function TaxReconciliationCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['tax-reconciliation', 'me'],
    queryFn: () => hrmsApi.taxReconciliation.get().then(r => r.data),
  })

  if (isLoading) return <Card><CardContent className="p-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
  if (!data?.academic_year || data.months_covered === 0) return null

  const excess = data.shortfall_or_excess >= 0

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <IndianRupee className="h-4 w-4 text-muted-foreground" /> Tax Reconciliation — {data.academic_year.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Gross Income (YTD)', value: formatCurrency(data.gross_income_ytd) },
            { label: 'Exemptions Applied', value: formatCurrency(data.section_80c_applied + data.hra_exemption + data.other_exemptions) },
            { label: 'Taxable Income (YTD)', value: formatCurrency(data.taxable_income_ytd) },
            { label: 'TDS Withheld (YTD)', value: formatCurrency(data.tds_withheld_ytd) },
          ].map(s => (
            <div key={s.label}>
              <p className="text-sm font-semibold tabular-nums text-foreground">{s.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <div className={cn('mt-4 flex items-center justify-between rounded-xl px-4 py-3', excess ? 'bg-success/10' : 'bg-warning/10')}>
          <span className="text-sm font-medium text-foreground">{excess ? 'Excess withheld so far' : 'Shortfall so far'}</span>
          <span className={cn('text-lg font-bold tabular-nums', excess ? 'text-success' : 'text-warning')}>
            {formatCurrency(Math.abs(data.shortfall_or_excess))}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Based on {data.months_covered} payslip{data.months_covered !== 1 ? 's' : ''} so far this year — not a final figure until the year closes.
        </p>
      </CardContent>
    </Card>
  )
}
