'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { hrmsApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, User, Users, Calendar, IndianRupee, Loader2, Check, X, Edit3 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

const TABS = ['Profile', 'Leave', 'Payroll'] as const

// Radix SelectItem can't hold an empty string, so an option meaning "unset"
// (e.g. Gender's blank "Select") is carried through this sentinel and mapped
// back to '' in the value written to state.
const EMPTY_OPTION = '__empty__'

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useState<typeof TABS[number]>('Profile')
  const [editMode, setEditMode] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['hr-staff-detail', id],
    queryFn: () => hrmsApi.staff.get(id).then(r => r.data),
  })

  const { data: leaveBalances } = useQuery({
    queryKey: ['leave-balances', id],
    queryFn: () => hrmsApi.leaveBalances(id).then(r => r.data),
    enabled: !!id,
  })

  const leaveApproveMutation = useMutation({
    mutationFn: ({ leaveId, status }: any) => hrmsApi.leaveRequests.update(leaveId, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-staff-detail', id] })
      qc.invalidateQueries({ queryKey: ['leave-balances', id] })
      toast.success('Leave status updated')
    },
  })

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  if (!data) {
    return (
      <EmptyState
        icon={User}
        title="Staff member not found"
        description="This profile may have been removed, or the link is out of date."
        action={
          <Button variant="outline" asChild>
            <Link href="/hr/staff"><ArrowLeft className="h-4 w-4" /> Back to staff directory</Link>
          </Button>
        }
      />
    )
  }

  const profile = data.profile

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3 text-muted-foreground">
          <Link href="/hr/staff"><ArrowLeft className="h-4 w-4" /> Staff Directory</Link>
        </Button>
        <PageHeader
          className="mb-0"
          title={data.full_name}
          description={[
            profile?.designation ?? 'No designation set',
            profile?.department,
            profile?.employee_id,
          ].filter(Boolean).join(' · ')}
          icon={Users}
          actions={
            <>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold capitalize text-primary ring-1 ring-inset ring-primary/20">
                {data.role?.replace('_', ' ')}
              </span>
              {profile?.employment_status && (
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset',
                  profile.employment_status === 'active'
                    ? 'bg-success/10 text-success ring-success/20'
                    : 'bg-warning/10 text-warning ring-warning/20')}>
                  {profile.employment_status.replace('_', ' ')}
                </span>
              )}
            </>
          }
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof TABS[number])}>
        <TabsList>
          {TABS.map(t => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {tab === 'Profile' && (
        <ProfileTab data={data} profile={profile} staffId={id} editMode={editMode} setEditMode={setEditMode} />
      )}

      {tab === 'Leave' && (
        <LeaveTab
          data={data}
          balances={leaveBalances ?? []}
          staffId={id}
          onApprove={(leaveId) => leaveApproveMutation.mutate({ leaveId, status: 'approved' })}
          onReject={(leaveId) => leaveApproveMutation.mutate({ leaveId, status: 'rejected' })}
          isPending={leaveApproveMutation.isPending}
        />
      )}

      {tab === 'Payroll' && (
        <PayrollTab data={data} staffId={id} userName={data.full_name} />
      )}
    </div>
  )
}

// ── PROFILE TAB ────────────────────────────────────────────────
function ProfileTab({ data, profile, staffId, editMode, setEditMode }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_id: profile?.employee_id ?? '',
    designation: profile?.designation ?? '',
    department: profile?.department ?? '',
    date_of_joining: profile?.date_of_joining ?? '',
    date_of_birth: profile?.date_of_birth ?? '',
    gender: profile?.gender ?? '',
    qualification: profile?.qualification ?? '',
    experience_years: profile?.experience_years ?? '',
    phone: profile?.phone ?? '',
    personal_email: profile?.personal_email ?? '',
    address: profile?.address ?? '',
    city: profile?.city ?? '',
    state: profile?.state ?? '',
    bank_name: profile?.bank_name ?? '',
    bank_account_number: profile?.bank_account_number ?? '',
    bank_ifsc: profile?.bank_ifsc ?? '',
    pan_number: profile?.pan_number ?? '',
    employment_type: profile?.employment_type ?? 'full_time',
    employment_status: profile?.employment_status ?? 'active',
    emergency_contact_name: profile?.emergency_contact_name ?? '',
    emergency_contact_phone: profile?.emergency_contact_phone ?? '',
  })

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.staff.updateProfile(staffId, {
      ...form,
      experience_years: form.experience_years ? Number(form.experience_years) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
      qc.invalidateQueries({ queryKey: ['hr-staff'] })
      toast.success('Profile updated')
      setEditMode(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const Field = ({ label, name, type = 'text', options }: any) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {options ? (
        <Select disabled={!editMode} value={((form as any)[name] || EMPTY_OPTION)} onValueChange={v => setForm(f => ({ ...f, [name]: v === EMPTY_OPTION ? '' : v }))}>
          <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o: any) => <SelectItem key={o.value} value={o.value === '' ? EMPTY_OPTION : o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input type={type} disabled={!editMode} value={(form as any)[name]}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))} className="disabled:opacity-60" />
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-foreground"><User className="h-4 w-4 text-muted-foreground" /> Personal &amp; Employment Details</h3>
            {!editMode ? (
              <Button variant="ghost" size="sm" onClick={() => setEditMode(true)} className="text-primary hover:text-primary/80">
                <Edit3 className="h-3.5 w-3.5" /> Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Employee ID" name="employee_id" />
            <Field label="Designation" name="designation" />
            <Field label="Department" name="department" />
            <Field label="Date of Joining" name="date_of_joining" type="date" />
            <Field label="Date of Birth" name="date_of_birth" type="date" />
            <Field label="Gender" name="gender" options={[{value:'',label:'Select'},{value:'male',label:'Male'},{value:'female',label:'Female'},{value:'other',label:'Other'}]} />
            <Field label="Qualification" name="qualification" />
            <Field label="Experience (years)" name="experience_years" type="number" />
            <Field label="Employment Type" name="employment_type" options={[
              {value:'full_time',label:'Full Time'},{value:'part_time',label:'Part Time'},{value:'contract',label:'Contract'},{value:'probation',label:'Probation'}
            ]} />
            <Field label="Employment Status" name="employment_status" options={[
              {value:'active',label:'Active'},{value:'on_leave',label:'On Leave'},{value:'suspended',label:'Suspended'},{value:'resigned',label:'Resigned'},{value:'terminated',label:'Terminated'}
            ]} />
            <Field label="Phone" name="phone" />
            <Field label="Personal Email" name="personal_email" type="email" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Address</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="col-span-3"><Field label="Address" name="address" /></div>
            <Field label="City" name="city" />
            <Field label="State" name="state" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Bank &amp; Tax Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Bank Name" name="bank_name" />
            <Field label="Account Number" name="bank_account_number" />
            <Field label="IFSC Code" name="bank_ifsc" />
            <Field label="PAN Number" name="pan_number" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Emergency Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Contact Name" name="emergency_contact_name" />
            <Field label="Contact Phone" name="emergency_contact_phone" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── LEAVE TAB ──────────────────────────────────────────────────
function LeaveTab({ data, balances, staffId, onApprove, onReject, isPending }: any) {
  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
    approved: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
    rejected: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
    cancelled: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  }

  return (
    <div className="space-y-5">
      {/* Leave balances */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {(balances ?? []).map((b: any) => (
          <Card key={b.leave_type_id}>
            <CardContent className="p-4 text-center">
              <p className="text-xs font-medium text-muted-foreground">{b.code}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{b.remaining_days}</p>
              <p className="text-xs text-muted-foreground">of {b.total_days} days</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leave requests */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /> Leave History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(data.recent_leaves ?? []).length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No leave requests yet"
              description="Leave this staff member applies for will show up here for approval."
            />
          ) : (
            <div className="divide-y divide-border">
              {(data.recent_leaves ?? []).map((lr: any) => (
                <div key={lr.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{lr.leave_types?.name ?? 'Leave'}</span>
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[lr.status])}>{lr.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                    {lr.reason && <p className="mt-1 text-xs text-muted-foreground">{lr.reason}</p>}
                  </div>
                  {lr.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onApprove(lr.id)} disabled={isPending}
                        className="bg-success/10 text-success shadow-none hover:bg-success/20">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" onClick={() => onReject(lr.id)} disabled={isPending}
                        className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── PAYROLL TAB ────────────────────────────────────────────────
function PayrollTab({ data, staffId, userName }: any) {
  const qc = useQueryClient()
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const salary = data.salary_structure

  const gross = salary ? (salary.basic_salary + (salary.hra ?? 0) + (salary.da ?? 0) + (salary.conveyance_allowance ?? 0) + (salary.medical_allowance ?? 0) + (salary.other_allowances ?? 0)) : 0
  const deductions = salary ? ((salary.pf_deduction ?? 0) + (salary.professional_tax ?? 0) + (salary.other_deductions ?? 0)) : 0
  const net = gross - deductions

  const PAY_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
    paid: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
    on_hold: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div className="space-y-5">
      {/* Salary structure */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-foreground"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Salary Structure</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowSalaryModal(true)} className="text-primary hover:text-primary/80">
              <Edit3 className="h-3.5 w-3.5" /> {salary ? 'Update' : 'Set'} Salary
            </Button>
          </div>

          {!salary ? (
            <EmptyState
              icon={IndianRupee}
              title="No salary structure set"
              description="Set basic pay, allowances and deductions before this staff member can be included in a payroll run."
              className="py-8"
              action={
                <Button variant="outline" size="sm" onClick={() => setShowSalaryModal(true)}>
                  <Edit3 className="h-3.5 w-3.5" /> Set Salary
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Basic Salary</p><p className="font-semibold text-foreground">₹{Number(salary.basic_salary).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-muted-foreground">HRA</p><p className="font-semibold text-foreground">₹{Number(salary.hra ?? 0).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-muted-foreground">DA</p><p className="font-semibold text-foreground">₹{Number(salary.da ?? 0).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-muted-foreground">Conveyance</p><p className="font-semibold text-foreground">₹{Number(salary.conveyance_allowance ?? 0).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-muted-foreground">Medical Allowance</p><p className="font-semibold text-foreground">₹{Number(salary.medical_allowance ?? 0).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-muted-foreground">Other Allowances</p><p className="font-semibold text-foreground">₹{Number(salary.other_allowances ?? 0).toLocaleString('en-IN')}</p></div>
              <div className="col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 border-t border-border pt-3">
                <div><p className="text-xs text-muted-foreground">Gross Salary</p><p className="font-bold text-success">₹{gross.toLocaleString('en-IN')}</p></div>
                <div><p className="text-xs text-muted-foreground">Total Deductions</p><p className="font-bold text-destructive">₹{deductions.toLocaleString('en-IN')}</p></div>
                <div><p className="text-xs text-muted-foreground">Net Salary</p><p className="text-lg font-bold text-primary">₹{net.toLocaleString('en-IN')}</p></div>
              </div>
              <div className="col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 border-t border-border pt-2 text-xs text-muted-foreground">
                <div>PF: ₹{Number(salary.pf_deduction ?? 0).toLocaleString('en-IN')}</div>
                <div>Prof. Tax: ₹{Number(salary.professional_tax ?? 0).toLocaleString('en-IN')}</div>
                <div>Other: ₹{Number(salary.other_deductions ?? 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payslips history */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Payslip History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(data.recent_payslips ?? []).length === 0 ? (
            <EmptyState
              icon={IndianRupee}
              title="No payslips generated yet"
              description="Payslips appear here once a monthly payroll run including this staff member has been generated."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/hr/payroll">Go to Payroll</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Period</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.recent_payslips ?? []).map((p: any) => (
                  <TableRow key={p.id} className="cursor-default">
                    <TableCell className="font-medium text-foreground">{MONTHS[p.month-1]} {p.year}</TableCell>
                    <TableCell className="text-muted-foreground">₹{Number(p.gross_salary).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-muted-foreground">₹{Number(p.total_deductions).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="font-semibold text-foreground">₹{Number(p.net_salary).toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', PAY_STATUS_COLORS[p.payment_status])}>{p.payment_status.replace('_',' ')}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showSalaryModal && (
        <SalaryModal staffId={staffId} userName={userName} existing={salary} onClose={() => {
          setShowSalaryModal(false)
          qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
        }} />
      )}
    </div>
  )
}

function SalaryModal({ staffId, userName, existing, onClose }: any) {
  const [form, setForm] = useState({
    basic_salary: existing?.basic_salary ?? '',
    hra: existing?.hra ?? '',
    da: existing?.da ?? '',
    conveyance_allowance: existing?.conveyance_allowance ?? '',
    medical_allowance: existing?.medical_allowance ?? '',
    other_allowances: existing?.other_allowances ?? '',
    pf_deduction: existing?.pf_deduction ?? '',
    professional_tax: existing?.professional_tax ?? '',
    other_deductions: existing?.other_deductions ?? '',
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.basic_salary) return toast.error('Basic salary is required')
    setLoading(true)
    try {
      await hrmsApi.salaryStructure.set({
        user_id: staffId,
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? 0 : Number(v)])),
        basic_salary: Number(form.basic_salary),
      })
      toast.success('Salary structure saved')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  const Field = ({ label, name }: any) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" value={(form as any)[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))} placeholder="0" />
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Salary Structure — {userName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Earnings</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Basic Salary *" name="basic_salary" />
              <Field label="HRA" name="hra" />
              <Field label="DA" name="da" />
              <Field label="Conveyance" name="conveyance_allowance" />
              <Field label="Medical Allowance" name="medical_allowance" />
              <Field label="Other Allowances" name="other_allowances" />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Deductions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="PF" name="pf_deduction" />
              <Field label="Professional Tax" name="professional_tax" />
              <Field label="Other Deductions" name="other_deductions" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save Salary Structure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
