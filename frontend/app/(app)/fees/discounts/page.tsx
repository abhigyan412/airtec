'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, Plus, Loader2, Check, XCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, academicYearsApi, invalidateFeeQueries } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DiscountLimits, ConcessionRules } from '@/components/fees/SetupPanels'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { StudentSearch, StudentLite } from '@/components/shared/StudentSearch'

// Concessions: sibling, staff ward, hardship.
//
// The rule shown to the user is now read from the server instead of asserted in
// the copy. The old screen said "under ₹2,000 auto-approves" in three places;
// the backend has always read per-role ceilings from fee_discount_limits, and an
// unconfigured role has a ceiling of zero — so on most schools that sentence was
// the opposite of what happened.

const STATUS_STYLE: Record<string, { label: string; className: string; icon: any }> = {
  pending: { label: 'Awaiting approval', className: 'bg-warning/10 text-warning', icon: Clock },
  approved: { label: 'Approved', className: 'bg-success/10 text-success', icon: Check },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive', icon: XCircle },
}

export default function DiscountsPage() {
  const params = useSearchParams()
  const qc = useQueryClient()
  const { can } = usePermissions()
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [tab, setTab] = useState('concessions')

  const studentParam = params.get('student')
  useEffect(() => { if (studentParam) setShowCreate(true) }, [studentParam])

  // Rules are per academic year, so the policy tab needs to know which one.
  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data as any[]),
  })
  const currentYearId = (years ?? []).find((y: any) => y.is_current)?.id ?? (years ?? [])[0]?.id

  const query = { approval_status: status || undefined }
  const { data, isPending } = useQuery({
    queryKey: ['fee-discounts', query],
    queryFn: () => feeApi.discounts.list(query).then(r => r.data as any[]),
  })

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      feeApi.discounts.decide(id, decision),
    // This used to read `res.data.invoices_updated`, a field the server has never
    // sent, and print "0 invoice(s) updated" as if that were the happy path. It
    // was the reason nobody noticed a concession coming off nothing.
    onSuccess: (res: any) => {
      const billed = res.already_billed
      if (billed?.count) {
        toast.warning(`Approved — but ${billed.count} invoice${billed.count === 1 ? '' : 's'} already raised`, {
          description: `${formatCurrency(billed.outstanding)} is still billed at the full amount. `
            + 'The concession applies from the next invoice raised; adjust these if it should reduce them.',
          duration: 10000,
        })
      } else {
        toast.success('Decision recorded')
      }
      invalidateFeeQueries(qc)
      qc.invalidateQueries({ queryKey: ['fee-by-category'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Could not record the decision'),
  })

  const rows = data ?? []
  const canDecide = can('fee.discount')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Concessions"
        description="Sibling, staff-ward and hardship discounts, and who may approve them"
        icon={Tag}
        actions={
          tab === 'concessions' && can('fee.discount') && (
            <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New concession</Button>
          )
        }
      />

      {/* Who may approve a concession sits WITH concessions, not on the billing
          screen. The ceilings decide whether the row above auto-approves, so
          reading one without the other is how "why did that need approval?"
          becomes a support question. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="concessions">Concessions</TabsTrigger>
          {can('fee.structure_manage') && <TabsTrigger value="policy">Policy &amp; authority</TabsTrigger>}
        </TabsList>

        <TabsContent value="concessions">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>All concessions</CardTitle>
          <Select value={status || 'all'} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Awaiting approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !rows.length ? (
            <EmptyState
              icon={Tag}
              title={status ? `Nothing ${status}` : 'No concessions yet'}
              description={status
                ? 'Try a different filter.'
                : 'Record sibling, staff-ward or hardship concessions here. They reduce the next invoice raised for the student.'}
              action={can('fee.discount')
                ? <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New concession</Button>
                : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Student</TableHead>
                    <TableHead>Applies to</TableHead>
                    <TableHead className="text-right">Concession</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(d => {
                    const style = STATUS_STYLE[d.approval_status] ?? STATUS_STYLE.pending
                    const Icon = style.icon
                    return (
                      <TableRow key={d.id} className="cursor-default">
                        <TableCell className="font-medium text-foreground">
                          {d.students?.first_name} {d.students?.last_name}
                          <p className="text-xs font-normal text-muted-foreground">{d.students?.classes?.name}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{d.fee_heads?.name ?? 'Every category'}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-foreground">
                          {d.discount_type === 'percentage' ? `${d.discount_value}%` : formatCurrency(d.discount_value)}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground" title={d.reason}>{d.reason}</TableCell>
                        <TableCell>
                          <span className={cn('flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium', style.className)}>
                            <Icon className="h-3 w-3" /> {style.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                        <TableCell className="text-right">
                          {d.approval_status === 'pending' && canDecide && (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" disabled={decide.isPending}
                                className="bg-success text-success-foreground hover:bg-success/90"
                                onClick={() => decide.mutate({ id: d.id, decision: 'approved' })}>
                                Approve
                              </Button>
                              <Button size="sm" variant="destructive" disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: d.id, decision: 'rejected' })}>
                                Reject
                              </Button>
                            </div>
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
        </TabsContent>

        {can('fee.structure_manage') && (
          <TabsContent value="policy" className="space-y-6">
            {/* Policy above authority: what a category is worth is the decision,
                who may sign one off is the control on it. */}
            <ConcessionRules academicYearId={currentYearId} />
            <DiscountLimits />
          </TabsContent>
        )}
      </Tabs>

      {showCreate && (
        <CreateConcessionDialog
          presetStudentId={studentParam}
          onClose={() => { setShowCreate(false); invalidateFeeQueries(qc) }}
        />
      )}
    </div>
  )
}

function CreateConcessionDialog({ presetStudentId, onClose }: { presetStudentId?: string | null; onClose: () => void }) {
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [headId, setHeadId] = useState('')
  const [type, setType] = useState<'fixed' | 'percentage'>('fixed')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: heads } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data as any[]),
  })

  // What the server will actually do with this, rather than a hardcoded number.
  const { data: limits } = useQuery({
    queryKey: ['fee-discount-limits'],
    queryFn: () => feeApi.discounts.limits().then(r => r.data as any[]),
    // A user who can grant concessions may not be allowed to read the limits
    // table; that is fine, the hint just doesn't render.
    retry: false,
  })

  // What is already on paper for this student, checked BEFORE the concession is
  // recorded. Afterwards is too late to be useful: the decision worth informing
  // is whether this concession can do the job at all, or whether the term that
  // is already billed needs adjusting too.
  const { data: position } = useQuery({
    queryKey: ['fee-student-summary', student?.id],
    queryFn: () => feeApi.student(student!.id).then(r => r.data),
    enabled: !!student?.id,
  })

  const alreadyRaised: any[] = ((position?.invoices ?? []) as any[]).filter(
    i => (i.status === 'unpaid' || i.status === 'partial') && Number(i.discount_total ?? 0) === 0)
  const alreadyRaisedDue = alreadyRaised.reduce((s, i) => s + Number(i.amount_due ?? 0), 0)

  const ceiling = (limits ?? []).reduce((max, r) => Math.max(max, Number(r.max_single_discount ?? 0)), 0)
  const amount = Number(value)
  const willAutoApprove = type === 'fixed' && ceiling > 0 && amount > 0 && amount <= ceiling

  const submit = async () => {
    if (!student || !value || !reason.trim()) return toast.error('Student, amount and reason are required')
    setLoading(true)
    try {
      const res = await feeApi.discounts.create({
        student_id: student.id,
        fee_head_id: headId || undefined,
        discount_type: type,
        discount_value: amount,
        reason: reason.trim(),
      })
      // `res.workflow` never existed — the server sends `approval`. The old copy
      // read "Approved and applied to 0 open invoice(s)" on every single grant.
      const billed = res.already_billed
      const approved = res.approval?.auto_approved
      if (approved && billed?.count) {
        toast.warning(`Approved — but ${billed.count} invoice${billed.count === 1 ? '' : 's'} already raised`, {
          description: `${formatCurrency(billed.outstanding)} is still billed at the full amount. `
            + 'This concession reduces the next invoice raised, not those.',
          duration: 10000,
        })
      } else {
        toast.success(approved
          ? 'Approved — it reduces the next invoice raised for this student'
          : 'Submitted — the Principal will be asked to approve it')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not create the concession')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" /> New concession
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Student *</Label>
            <StudentSearch value={student} onSelect={setStudent} autoFocus={!presetStudentId} />
          </div>

          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Select value={headId || 'all'} onValueChange={v => setHeadId(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every fee category</SelectItem>
                {(heads ?? []).map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Type *</Label>
            <div className="grid grid-cols-2 gap-2">
              {([['fixed', 'Fixed (₹)'], ['percentage', 'Percentage (%)']] as const).map(([v, label]) => (
                <button
                  key={v} type="button" onClick={() => setType(v)}
                  className={cn('rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
                    type === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/40')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="disc-value">Value *</Label>
            <Input id="disc-value" type="number" value={value} onChange={e => setValue(e.target.value)}
              placeholder={type === 'fixed' ? 'e.g. 1500' : 'e.g. 10'} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="disc-reason">Reason *</Label>
            <Textarea id="disc-reason" rows={2} className="resize-none" value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Sibling of an enrolled student, financial hardship" />
          </div>

          {/* Said before the grant, not after: this student's term is already
              billed, and no concession recorded now will reduce that paper. */}
          {alreadyRaised.length > 0 && (
            <Alert
              variant="warning"
              title={`${alreadyRaised.length} invoice${alreadyRaised.length === 1 ? '' : 's'} already raised`}
            >
              {formatCurrency(alreadyRaisedDue)} is outstanding on invoices issued at the full
              amount. A concession applies when an invoice is raised, so this one starts with
              the next billing run — the invoices already out need adjusting separately if it
              should reduce them.
            </Alert>
          )}

          {amount > 0 && (
            willAutoApprove
              ? <Alert variant="success" title="Within your authority">
                  This will be approved immediately and reduces the next invoice raised for this student.
                </Alert>
              : <Alert variant="info" title="Goes to the Principal">
                  {type === 'percentage'
                    ? 'Percentage concessions are always reviewed, because their rupee value depends on the fee they meet.'
                    : ceiling > 0
                      ? `Above your ceiling of ${formatCurrency(ceiling)} per concession.`
                      : 'No approval ceiling is configured for your role, so every concession is reviewed. An administrator can set one under Setup.'}
                </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !student}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
