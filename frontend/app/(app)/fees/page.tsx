'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feeApi, studentsApi, classesApi, academicYearsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, STATUS_COLORS, formatCurrency, formatDate } from '@/lib/utils'
import { CreditCard, AlertCircle, CheckCircle, Clock, Plus, X, Loader2, Tag, Check, XCircle, AlertTriangle, Pencil, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowRightLeft } from 'lucide-react'
import { FeeAnalytics } from '@/components/fees/FeeAnalytics'
import { FeeCollectionTrend } from '@/components/dashboard/FeeCollectionTrend'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'

/** Table-shaped placeholder so rows don't jump in when a fee query lands. */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export default function FeesPage() {
  const [tab, setTab] = useState<'invoices' | 'dues' | 'structures' | 'discounts'>('invoices')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['fee-stats'],
    queryFn: () => feeApi.stats().then(r => r.data),
  })

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => feeApi.invoices.list({ limit: 50 }).then(r => r),
    enabled: tab === 'invoices',
  })

  const { data: dues, isLoading: duesLoading } = useQuery({
    queryKey: ['dues'],
    queryFn: () => feeApi.dues().then(r => r),
    enabled: tab === 'dues',
  })

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Fee Management"
        description="Track collections, invoices, and dues"
        icon={Wallet}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/fees/arrears"><ArrowRightLeft className="h-4 w-4" /> Arrears</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/fees/collections"><AlertTriangle className="h-4 w-4" /> Collections &amp; Dues</Link>
            </Button>
          </>
        }
      />

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Billed" value={formatCurrency(stats?.total_billed ?? 0)} icon={CreditCard} accent="primary" />
          <StatCard label="Collected" value={formatCurrency(stats?.total_collected ?? 0)} icon={CheckCircle} accent="success" />
          <StatCard label="Due" value={formatCurrency(stats?.total_due ?? 0)} icon={AlertCircle} accent="destructive" />
          <StatCard label="Partial Paid" value={stats?.partial_invoices ?? 0} icon={Clock} accent="warning" />
        </div>
      )}

      {/* Analytics */}
      <FeeAnalytics stats={stats} />
      <FeeCollectionTrend />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="dues">Pending Dues</TabsTrigger>
          <TabsTrigger value="structures">Fee Structure</TabsTrigger>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <InvoicesTable data={invoices?.data ?? []} isLoading={invoicesLoading} />
        </TabsContent>
        <TabsContent value="dues">
          <DuesTable data={dues?.data ?? []} isLoading={duesLoading} />
        </TabsContent>
        <TabsContent value="structures">
          <Card><CardContent className="p-4"><FeeStructures /></CardContent></Card>
        </TabsContent>
        <TabsContent value="discounts">
          <Card><CardContent className="p-4"><DiscountsTab /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RECORD PAYMENT — for dues collected offline (cash/cheque/UPI at
// the school office). Opened from a specific invoice's row on the
// Pending Dues tab, which already has the real remaining balance
// (amount_due = total_amount minus whatever's already been paid).
// ═══════════════════════════════════════════════════════════════

const PAYMENT_MODES = ['cash', 'cheque', 'neft', 'card', 'upi', 'online'] as const

function RecordInvoicePaymentModal({ invoice, onClose }: { invoice: any, onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(invoice.amount_due))
  const [paymentMode, setPaymentMode] = useState<typeof PAYMENT_MODES[number]>('cash')
  const [transactionReference, setTransactionReference] = useState('')
  const [chequeNumber, setChequeNumber] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => feeApi.payments.record({
      invoice_id: invoice.id,
      amount_paid: Number(amount),
      payment_mode: paymentMode,
      transaction_reference: transactionReference || undefined,
      cheque_number: paymentMode === 'cheque' ? chequeNumber || undefined : undefined,
      notes: notes || undefined,
    }),
    onSuccess: (res: any) => {
      toast.success(`Payment recorded — receipt ${res.data?.payment?.receipt_number ?? ''}`)
      qc.invalidateQueries({ queryKey: ['dues'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['fee-stats'] })
      qc.invalidateQueries({ queryKey: ['dashboard-fee-trend'] })
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record payment'),
  })

  const handleSubmit = () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > Number(invoice.amount_due)) return toast.error(`Amount can't exceed the outstanding balance of ${formatCurrency(invoice.amount_due)}`)
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {invoice.students?.first_name} {invoice.students?.last_name} · {invoice.invoice_number}
          <br />Outstanding: <span className="font-semibold text-destructive">{formatCurrency(invoice.amount_due)}</span>
        </p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Amount *</Label>
            <Input id="pay-amount" type="number" max={invoice.amount_due} value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Mode</Label>
            <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map(m => (
                  <SelectItem key={m} value={m}>{m === 'neft' ? 'NEFT' : m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {paymentMode === 'cheque' ? (
            <div className="space-y-1.5">
              <Label htmlFor="cheque-number">Cheque Number</Label>
              <Input id="cheque-number" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
            </div>
          ) : paymentMode !== 'cash' && (
            <div className="space-y-1.5">
              <Label htmlFor="txn-ref">Transaction Reference</Label>
              <Input id="txn-ref" value={transactionReference} onChange={e => setTransactionReference(e.target.value)} placeholder="UTR / reference number" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pay-notes">Notes</Label>
            <Input id="pay-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InvoicesTable({ data, isLoading }: { data: any[], isLoading?: boolean }) {
  if (isLoading) return <Card><CardContent className="p-0"><TableSkeleton /></CardContent></Card>
  if (!data.length) return (
    <Card>
      <EmptyState
        icon={CreditCard}
        title="No invoices yet"
        description="Invoices appear here once fee structures are set up and billing is generated for a class."
      />
    </Card>
  )
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((inv: any) => (
              <TableRow key={inv.id} className="cursor-default">
                <TableCell className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</TableCell>
                <TableCell>
                  <p className="font-medium text-foreground">
                    {inv.students?.first_name} {inv.students?.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{inv.students?.classes?.name}</p>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(inv.total_amount)}</TableCell>
                <TableCell className="text-muted-foreground">{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                <TableCell>
                  <span className={cn('rounded-full px-2 py-1 text-xs font-medium', STATUS_COLORS[inv.status])}>
                    {inv.status}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function DuesTable({ data, isLoading }: { data: any[], isLoading?: boolean }) {
  const [payTarget, setPayTarget] = useState<any>(null)
  if (isLoading) return <Card><CardContent className="p-0"><TableSkeleton /></CardContent></Card>
  if (!data.length) return (
    <Card>
      <EmptyState
        icon={CheckCircle}
        title="No pending dues 🎉"
        description="Every issued invoice has been paid in full. New dues show up here as invoices fall due."
      />
    </Card>
  )
  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Amount Due</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((inv: any) => (
                <TableRow key={inv.id} className="cursor-default">
                  <TableCell className="font-medium text-foreground">
                    {inv.students?.first_name} {inv.students?.last_name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{inv.students?.classes?.name}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-destructive">{formatCurrency(inv.amount_due)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', STATUS_COLORS[inv.status])}>
                      {inv.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setPayTarget(inv)}>
                      Record Payment
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {payTarget && <RecordInvoicePaymentModal invoice={payTarget} onClose={() => setPayTarget(null)} />}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// FEE STRUCTURE — grouped by category (fee head: Tuition, Exam,
// Annual Fund, ...) rather than one flat class×head table, since
// that's how schools actually think about fee configuration:
// "here's every category, and what each class pays for it."
// Both categories and per-class amounts are fully custom — neither
// had any creation UI before (only feeApi.heads.create /
// structures.create existed on the backend, unused).
// ═══════════════════════════════════════════════════════════════

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-Yearly', annually: 'Annually', one_time: 'One-Time',
}

function FeeStructures() {
  const qc = useQueryClient()
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [showAddAmount, setShowAddAmount] = useState(false)
  const [selectedHeadId, setSelectedHeadId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editFrequency, setEditFrequency] = useState('')
  const [editOptional, setEditOptional] = useState(false)

  const { data: heads, isLoading: headsLoading } = useQuery({
    queryKey: ['fee-heads'],
    queryFn: () => feeApi.heads.list().then(r => r.data),
  })

  const { data: structures, isLoading: structuresLoading } = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => feeApi.structures.list().then(r => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fee-heads'] })
    qc.invalidateQueries({ queryKey: ['fee-structures'] })
  }

  const updateMutation = useMutation({
    mutationFn: (data: { amount: number, frequency: string, is_optional: boolean }) =>
      feeApi.structures.update(editingId as string, data),
    onSuccess: () => {
      toast.success('Updated')
      setEditingId(null)
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const rows = (structures ?? [])
    .filter((s: any) => !selectedHeadId || s.fee_head_id === selectedHeadId)
    .slice()
    .sort((a: any, b: any) =>
      (a.fee_heads?.name ?? '').localeCompare(b.fee_heads?.name ?? '') ||
      (a.classes?.name ?? '').localeCompare(b.classes?.name ?? '', undefined, { numeric: true }))

  const startEdit = (s: any) => {
    setEditingId(s.id)
    setEditAmount(String(s.amount))
    setEditFrequency(s.frequency)
    setEditOptional(s.is_optional)
  }

  const saveEdit = () => {
    const amt = Number(editAmount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    updateMutation.mutate({ amount: amt, frequency: editFrequency, is_optional: editOptional })
  }

  const selectedHeadName = (heads ?? []).find((h: any) => h.id === selectedHeadId)?.name

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={selectedHeadId || 'all'} onValueChange={v => setSelectedHeadId(v === 'all' ? '' : v)}>
            <SelectTrigger className="min-w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(heads ?? []).map((h: any) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowAddCategory(true)}>
            <Plus className="h-4 w-4" /> Add Category
          </Button>
          <Button onClick={() => setShowAddAmount(true)}>
            <Plus className="h-4 w-4" /> Add Class Amount
          </Button>
        </div>
      </div>

      {(headsLoading || structuresLoading) ? (
        <TableSkeleton rows={5} />
      ) : !(heads ?? []).length ? (
        <EmptyState
          icon={Tag}
          title="No fee categories yet"
          description="Categories are the fee heads you bill against — Tuition, Exam, Transport. Add one, then set a per-class amount for it."
          action={<Button onClick={() => setShowAddCategory(true)}><Plus className="h-4 w-4" /> Add Category</Button>}
        />
      ) : !rows.length ? (
        <EmptyState
          icon={Tag}
          title={selectedHeadName ? `No classes configured under ${selectedHeadName}` : 'No fee structures configured yet'}
          description={selectedHeadName
            ? `Add the amount each class pays for ${selectedHeadName}, or pick a different category above.`
            : 'Set what each class pays for each category so invoices can be generated.'}
          action={<Button onClick={() => setShowAddAmount(true)}><Plus className="h-4 w-4" /> Add Class Amount</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {!selectedHeadId && <TableHead>Category</TableHead>}
              <TableHead>Class</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead>Academic Year</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s: any) => {
              const isEditing = editingId === s.id
              return (
                <TableRow key={s.id} className="cursor-default">
                  {!selectedHeadId && <TableCell className="text-muted-foreground">{s.fee_heads?.name}</TableCell>}
                  <TableCell className="font-medium text-foreground">{s.classes?.name}</TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input type="number" autoFocus className="h-8 w-28"
                        value={editAmount} onChange={e => setEditAmount(e.target.value)} />
                    ) : (
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(s.amount)}{s.is_optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {isEditing ? (
                      <Select value={editFrequency} onValueChange={setEditFrequency}>
                        <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(FREQUENCY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      FREQUENCY_LABELS[s.frequency] ?? s.frequency
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.academic_years?.name}</TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-1.5">
                        <Button size="icon" className="h-8 w-8 bg-success text-success-foreground hover:bg-success/90"
                          onClick={saveEdit} disabled={updateMutation.isPending} aria-label="Save">
                          {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => setEditingId(null)} aria-label="Cancel">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(s)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {showAddCategory && <AddCategoryModal onClose={() => { setShowAddCategory(false); invalidate() }} />}
      {showAddAmount && (
        <AddStructureModal heads={heads ?? []} initialHeadId={selectedHeadId}
          onClose={() => { setShowAddAmount(false); invalidate() }} />
      )}
    </div>
  )
}

function AddCategoryModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error('Category name is required')
    setLoading(true)
    try {
      await feeApi.heads.create({ name: name.trim(), description: description.trim() || undefined })
      toast.success('Category added')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add category')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Fee Category</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Category Name *</Label>
            <Input id="cat-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Transport Fee, Lab Fee" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Description</Label>
            <Input id="cat-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Add Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddStructureModal({ heads, initialHeadId, onClose }: { heads: any[], initialHeadId: string, onClose: () => void }) {
  const [headId, setHeadId] = useState(initialHeadId)
  const [classId, setClassId] = useState('')
  const [academicYearId, setAcademicYearId] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly' | 'half_yearly' | 'annually' | 'one_time'>('monthly')
  const [isOptional, setIsOptional] = useState(false)
  const [loading, setLoading] = useState(false)

  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => classesApi.list().then((r: any) => r.data) })
  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then((r: any) => r.data),
  })

  // Default to the current academic year once it loads.
  if (!academicYearId && years?.length) {
    const current = years.find((y: any) => y.is_current) ?? years[0]
    if (current) setAcademicYearId(current.id)
  }

  const handleSubmit = async () => {
    if (!headId || !classId || !academicYearId || !amount) return toast.error('Category, class, academic year, and amount are required')
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    setLoading(true)
    try {
      await feeApi.structures.create({
        academic_year_id: academicYearId, class_id: classId, fee_head_id: headId,
        amount: amt, frequency, is_optional: isOptional,
      })
      toast.success('Class amount added')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Class Amount</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Category *</Label>
            <Select value={headId} onValueChange={setHeadId}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {heads.map((h: any) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Class *</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {(classes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Academic Year *</Label>
            <Select value={academicYearId} onValueChange={setAcademicYearId}>
              <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
              <SelectContent>
                {(years ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="struct-amount">Amount *</Label>
              <Input id="struct-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 2500" />
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={isOptional} onChange={e => setIsOptional(e.target.checked)} className="rounded border-input" />
            Optional (not auto-included on every invoice)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════
// DISCOUNTS TAB — Fee Discount Approval Workflow
// ═══════════════════════════════════════════════════════════════
//
// - "New Discount" form: discounts < ₹2000 auto-approve immediately
//   (workflow engine's auto_approve_condition); >= ₹2000 sit as
//   'pending' awaiting Principal approval.
// - Approve/Reject buttons appear for pending discounts only when the
//   logged-in user is Principal or School Admin (workflow step 1 role
//   is "Principal"; School Admin always bypasses via actOnWorkflow).

const APPROVAL_STYLES: Record<string, { label: string, className: string, icon: any }> = {
  pending: { label: 'Pending Approval', className: 'bg-warning/10 text-warning', icon: Clock },
  approved: { label: 'Approved', className: 'bg-success/10 text-success', icon: Check },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive', icon: XCircle },
}

function DiscountsTab() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['fee-discounts'],
    queryFn: () => feeApi.discounts.list().then(r => r.data),
  })

  const canApprove = ['principal', 'school_admin'].includes(user?.role ?? '')

  const actionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: 'approved' | 'rejected' }) =>
      feeApi.discounts.workflowAction(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee-discounts'] })
      toast.success('Decision recorded')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Discounts under ₹2,000 auto-approve. ₹2,000 and above need Principal approval.</p>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Discount
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : !(discounts ?? []).length ? (
        <EmptyState
          icon={Tag}
          title="No discounts created yet"
          description="Record sibling, staff-ward or hardship concessions here so they're applied to the student's invoices."
          action={<Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Discount</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Student</TableHead>
              <TableHead>Fee Head</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(discounts ?? []).map((d: any) => {
              const style = APPROVAL_STYLES[d.approval_status] ?? APPROVAL_STYLES.pending
              const Icon = style.icon
              return (
                <TableRow key={d.id} className="cursor-default">
                  <TableCell className="font-medium text-foreground">
                    {d.students?.first_name} {d.students?.last_name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.fee_heads?.name ?? 'All fees'}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-foreground">
                    {d.discount_type === 'percentage' ? `${d.discount_value}%` : formatCurrency(d.discount_value)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.reason}</TableCell>
                  <TableCell>
                    <span className={cn('flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium', style.className)}>
                      <Icon className="h-3 w-3" /> {style.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {d.approval_status === 'pending' && canApprove && (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => actionMutation.mutate({ id: d.id, status: 'approved' })}
                          disabled={actionMutation.isPending}
                          className="bg-success text-success-foreground hover:bg-success/90">
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate({ id: d.id, status: 'rejected' })}
                          disabled={actionMutation.isPending}>
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
      )}

      {showCreate && (
        <CreateDiscountModal onClose={() => {
          setShowCreate(false)
          qc.invalidateQueries({ queryKey: ['fee-discounts'] })
        }} />
      )}
    </div>
  )
}

function CreateDiscountModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<any>(null)
  const [form, setForm] = useState({
    student_id: '',
    discount_type: 'fixed' as 'fixed' | 'percentage',
    discount_value: '',
    reason: '',
  })
  const [loading, setLoading] = useState(false)

  const { data: students } = useQuery({
    queryKey: ['students-search', search],
    queryFn: () => studentsApi.list({ search, limit: 10 }).then(r => r.data),
    enabled: search.length > 1,
  })

  const handleSubmit = async () => {
    if (!form.student_id || !form.discount_value || !form.reason) {
      return toast.error('Please fill all required fields')
    }
    setLoading(true)
    try {
      const res = await feeApi.discounts.create({
        ...form,
        discount_value: Number(form.discount_value),
      })
      if (res.workflow?.auto_approved) {
        toast.success('Discount auto-approved (under ₹2,000)')
      } else {
        toast.success('Discount submitted — pending Principal approval')
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create discount')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" /> New Fee Discount
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Student *</Label>
            {selectedStudent ? (
              <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2.5 text-sm">
                <span className="font-medium text-primary">{selectedStudent.first_name} {selectedStudent.last_name} · {selectedStudent.classes?.name}</span>
                <button onClick={() => { setForm(f => ({ ...f, student_id: '' })); setSelectedStudent(null); setSearch('') }} className="text-primary/60 transition-colors hover:text-primary" aria-label="Clear student">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student by name..." autoComplete="off" />
                {search.length > 1 && (
                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
                    {(students ?? []).length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">No students found</p>
                    ) : (
                      (students ?? []).map((s: any) => (
                        <button key={s.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, student_id: s.id })); setSelectedStudent(s); setSearch('') }}
                          className="w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent">
                          <span className="font-medium text-foreground">{s.first_name} {s.last_name}</span>
                          <span className="text-muted-foreground"> · {s.classes?.name}{s.sections?.name ? `-${s.sections.name}` : ''}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Discount Type *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['fixed', 'percentage'] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, discount_type: t }))}
                  className={cn('rounded-xl border-2 px-3 py-2 text-sm font-medium capitalize transition-all',
                    form.discount_type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                  {t === 'fixed' ? 'Fixed (₹)' : 'Percentage (%)'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="disc-value">
              Discount Value * {form.discount_type === 'fixed' && <span className="text-xs font-normal text-muted-foreground">(under ₹2,000 auto-approves)</span>}
            </Label>
            <Input id="disc-value" type="number" value={form.discount_value}
              onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))}
              placeholder={form.discount_type === 'fixed' ? 'e.g. 1500' : 'e.g. 10'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="disc-reason">Reason *</Label>
            <Textarea id="disc-reason" rows={2} className="resize-none" value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Sibling discount, financial hardship..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
