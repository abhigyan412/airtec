'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { hrmsApi, documentsApi, classesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, User, Users, Calendar, IndianRupee, Loader2, Check, X, Edit3, History, LogOut, ShieldAlert, FileText, ArrowRight, Trash2, Eye, Plus, Camera, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

const TABS = ['Profile', 'Position History', 'Leave', 'Payroll', 'Documents', 'Exit'] as const

// Radix SelectItem can't hold an empty string, so an option meaning "unset"
// (e.g. Gender's blank "Select") is carried through this sentinel and mapped
// back to '' in the value written to state.
const EMPTY_OPTION = '__empty__'

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useState<typeof TABS[number]>('Profile')
  const [editMode, setEditMode] = useState(false)
  const [showPromoteModal, setShowPromoteModal] = useState(false)

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
  const probationDaysLeft = profile?.probation_end_date
    ? Math.ceil((new Date(`${profile.probation_end_date}T00:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3 text-muted-foreground">
          <Link href="/hr/staff"><ArrowLeft className="h-4 w-4" /> Staff Directory</Link>
        </Button>
        <div className="flex items-start gap-3">
        <StaffPhotoUpload staffId={id} currentUrl={profile?.photo_url} fullName={data.full_name} />
        <PageHeader
          className="mb-0 flex-1"
          title={data.full_name}
          description={[
            profile?.designation ?? 'No designation set',
            profile?.department,
            profile?.employee_id,
          ].filter(Boolean).join(' · ')}
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
              {probationDaysLeft !== null && (
                <ProbationBadge staffId={id} daysLeft={probationDaysLeft} />
              )}
              <Button size="sm" variant="outline" onClick={() => setShowPromoteModal(true)}>
                <ArrowRight className="h-3.5 w-3.5" /> Promote / Transfer
              </Button>
            </>
          }
        />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof TABS[number])}>
        <TabsList>
          {TABS.map(t => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {tab === 'Profile' && (
        <ProfileTab data={data} profile={profile} staffId={id} editMode={editMode} setEditMode={setEditMode} onPromote={() => setShowPromoteModal(true)} />
      )}

      {tab === 'Position History' && (
        <PositionHistoryTab staffId={id} />
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

      {tab === 'Documents' && (
        <DocumentsTab staffId={id} />
      )}

      {tab === 'Exit' && (
        <ExitTab staffId={id} userName={data.full_name} />
      )}

      {showPromoteModal && (
        <PromoteTransferModal staffId={id} userName={data.full_name} profile={profile} onClose={() => {
          setShowPromoteModal(false)
          qc.invalidateQueries({ queryKey: ['hr-staff-detail', id] })
          qc.invalidateQueries({ queryKey: ['position-history', id] })
        }} />
      )}
    </div>
  )
}

// ── PROBATION BADGE + Confirm/Extend ────────────────────────────
function ProbationBadge({ staffId, daysLeft }: { staffId: string; daysLeft: number }) {
  const qc = useQueryClient()
  const [showExtend, setShowExtend] = useState(false)
  const [newDate, setNewDate] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
    qc.invalidateQueries({ queryKey: ['position-history', staffId] })
  }

  const confirmMutation = useMutation({
    mutationFn: () => hrmsApi.staff.probationConfirm(staffId),
    onSuccess: () => { invalidate(); toast.success('Probation confirmed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const extendMutation = useMutation({
    mutationFn: () => hrmsApi.staff.probationExtend(staffId, newDate),
    onSuccess: () => { invalidate(); setShowExtend(false); toast.success('Probation extended') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  return (
    <>
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        daysLeft < 0 ? 'bg-destructive/10 text-destructive ring-destructive/20'
          : daysLeft <= 30 ? 'bg-warning/10 text-warning ring-warning/20' : 'bg-muted text-muted-foreground ring-border')}>
        <ShieldAlert className="h-3 w-3" />
        {daysLeft < 0 ? 'Probation overdue' : `Probation ends in ${daysLeft}d`}
      </span>
      <Button size="sm" variant="ghost" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} className="text-success hover:text-success">
        {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setShowExtend(true)}>Extend</Button>

      {showExtend && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowExtend(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Extend Probation</DialogTitle></DialogHeader>
            <div className="space-y-1.5">
              <Label>New Probation End Date</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowExtend(false)}>Cancel</Button>
              <Button onClick={() => extendMutation.mutate()} disabled={!newDate || extendMutation.isPending}>
                {extendMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ── PHOTO UPLOAD ───────────────────────────────────────────────
// Same base64-upload-then-preview shape as students' PhotoUpload
// (app/(app)/students/[id]/page.tsx) — kept as its own small component
// here rather than shared, since the two write to different tables
// (staff_profiles vs students) through different endpoints.
function StaffPhotoUpload({ staffId, currentUrl, fullName }: { staffId: string; currentUrl?: string; fullName: string }) {
  const [preview, setPreview] = useState(currentUrl)
  const [uploading, setUploading] = useState(false)
  const qc = useQueryClient()
  const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result as string
        const res = await hrmsApi.staff.uploadPhoto(staffId, {
          photo_base64: base64,
          file_name: file.name,
          mime_type: file.type,
        })
        setPreview(res.data.photo_url)
        qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
        toast.success('Photo updated!')
      } catch {
        toast.error('Upload failed')
      } finally {
        setUploading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <label className="relative mt-1 flex-shrink-0 cursor-pointer group">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center overflow-hidden">
        {preview
          ? <img src={preview} alt="" className="w-16 h-16 object-cover rounded-2xl" />
          : <span className="text-2xl font-bold text-primary">{initials}</span>
        }
        <div className="absolute inset-0 bg-black/50 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          {uploading
            ? <Loader2 className="w-5 h-5 text-white animate-spin" />
            : <Camera className="w-5 h-5 text-white" />
          }
        </div>
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
    </label>
  )
}

// Module-scope, not defined inside ProfileTab: a component defined
// inside another component's function body gets a new identity every
// render, so React remounts it (dropping input focus) after every
// keystroke that triggers a re-render. form/setForm/editMode are passed
// in explicitly instead of closed over so this can live outside.
function ProfileField({ form, setForm, editMode, label, name, type = 'text', options }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {options ? (
        <Select disabled={!editMode} value={(form[name] || EMPTY_OPTION)} onValueChange={v => setForm((f: any) => ({ ...f, [name]: v === EMPTY_OPTION ? '' : v }))}>
          <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o: any) => <SelectItem key={o.value} value={o.value === '' ? EMPTY_OPTION : o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input type={type} disabled={!editMode} value={form[name]}
          onChange={e => setForm((f: any) => ({ ...f, [name]: e.target.value }))} className="disabled:opacity-60" />
      )}
    </div>
  )
}

// ── PROFILE TAB ────────────────────────────────────────────────
function ProfileTab({ data, profile, staffId, editMode, setEditMode, onPromote }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_id: profile?.employee_id ?? '',
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
    shift_id: profile?.shift_id ?? '',
    leave_delegate_id: profile?.leave_delegate_id ?? '',
    reporting_to: profile?.reporting_to ?? '',
    subjects: profile?.subjects ?? [],
  })

  // Master subject list, school-wide (no class_id filter) — the same
  // source Add Period's subject field and Homework/Syllabus already draw
  // from. Deduped by name since the same subject exists once per class.
  const { data: allSubjects } = useQuery({
    queryKey: ['subjects', 'all'],
    queryFn: () => classesApi.subjects.list().then(r => r.data),
    enabled: data.role === 'teacher',
  })
  const subjectOptions = Array.from(new Set<string>((allSubjects ?? []).map((s: any) => s.name as string))).sort()

  const { data: shifts } = useQuery({
    queryKey: ['staff-shifts'],
    queryFn: () => hrmsApi.shifts.list().then(r => r.data),
  })

  const { data: allStaff } = useQuery({
    queryKey: ['hr-staff', 'delegate-options'],
    queryFn: () => hrmsApi.staff.list({ limit: 200 }).then(r => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.staff.updateProfile(staffId, {
      ...form,
      shift_id: form.shift_id || null,
      leave_delegate_id: form.leave_delegate_id || null,
      reporting_to: form.reporting_to || null,
      experience_years: form.experience_years ? Number(form.experience_years) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
      qc.invalidateQueries({ queryKey: ['hr-staff'] })
      // reporting_to changed here is exactly what the Org Chart page reads —
      // without this it keeps showing the pre-edit hierarchy for up to the
      // query client's 30s default staleTime after a save.
      qc.invalidateQueries({ queryKey: ['staff-org-chart'] })
      toast.success('Profile updated')
      setEditMode(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

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
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Employee ID" name="employee_id" />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Designation</Label>
              <p className="flex h-9 items-center rounded-md border border-border bg-muted px-3 text-sm text-foreground">{profile?.designation || '—'}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <p className="flex h-9 items-center rounded-md border border-border bg-muted px-3 text-sm text-foreground">{profile?.department || '—'}</p>
            </div>
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Date of Joining" name="date_of_joining" type="date" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Date of Birth" name="date_of_birth" type="date" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Gender" name="gender" options={[{value:'',label:'Select'},{value:'male',label:'Male'},{value:'female',label:'Female'},{value:'other',label:'Other'}]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Qualification" name="qualification" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Experience (years)" name="experience_years" type="number" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Employment Type" name="employment_type" options={[
              {value:'full_time',label:'Full Time'},{value:'part_time',label:'Part Time'},{value:'contract',label:'Contract'},{value:'probation',label:'Probation'}
            ]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Employment Status" name="employment_status" options={[
              {value:'active',label:'Active'},{value:'suspended',label:'Suspended'},{value:'absconded',label:'Absconded'},{value:'resigned',label:'Resigned'},{value:'terminated',label:'Terminated'}
            ]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Shift" name="shift_id" options={[
              { value: '', label: 'School default schedule' },
              ...(shifts ?? []).map((s: any) => ({ value: s.id, label: s.name })),
            ]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Leave Delegate" name="leave_delegate_id" options={[
              { value: '', label: 'None' },
              ...(allStaff ?? []).filter((s: any) => s.id !== staffId && !['resigned', 'terminated'].includes(s.staff_profile?.employment_status)).map((s: any) => ({ value: s.id, label: s.full_name })),
            ]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Reports To" name="reporting_to" options={[
              { value: '', label: 'None' },
              ...(allStaff ?? []).filter((s: any) => s.id !== staffId && !['resigned', 'terminated'].includes(s.staff_profile?.employment_status)).map((s: any) => ({ value: s.id, label: s.full_name })),
            ]} />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Phone" name="phone" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Personal Email" name="personal_email" type="email" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Designation and department are read-only here — use{' '}
            <button type="button" onClick={onPromote} className="font-medium text-primary hover:underline">Promote / Transfer</button>{' '}
            to change them, so the change is recorded in Position History.
          </p>
        </CardContent>
      </Card>

      {data.role === 'teacher' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-1 font-semibold text-foreground">Subjects Taught</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              The source of truth for what this teacher is qualified to substitute or be scheduled for — set once here rather than re-derived from whatever they happen to already be on the timetable for.
            </p>
            {subjectOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subjects defined yet — add some under Settings → Classes &amp; Sections first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {subjectOptions.map(name => {
                  const active = form.subjects.includes(name)
                  return (
                    <button key={name} type="button" disabled={!editMode}
                      onClick={() => setForm((f: any) => ({
                        ...f,
                        subjects: active ? f.subjects.filter((s: string) => s !== name) : [...f.subjects, name],
                      }))}
                      className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 text-muted-foreground border-border',
                        editMode ? 'cursor-pointer hover:border-primary/60' : 'cursor-default opacity-80')}>
                      {name}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Address</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="col-span-3"><ProfileField form={form} setForm={setForm} editMode={editMode} label="Address" name="address" /></div>
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="City" name="city" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="State" name="state" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Bank &amp; Tax Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Bank Name" name="bank_name" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Account Number" name="bank_account_number" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="IFSC Code" name="bank_ifsc" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="PAN Number" name="pan_number" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 font-semibold text-foreground">Emergency Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Contact Name" name="emergency_contact_name" />
            <ProfileField form={form} setForm={setForm} editMode={editMode} label="Contact Phone" name="emergency_contact_phone" />
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

      {/* Tax reconciliation (Form 16 source data) */}
      <TaxReconciliationSection staffId={staffId} />

      {/* Loans / advances */}
      <LoansSection staffId={staffId} userName={userName} />

      {showSalaryModal && (
        <SalaryModal staffId={staffId} userName={userName} existing={salary} onClose={() => {
          setShowSalaryModal(false)
          qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
        }} />
      )}
    </div>
  )
}

// ── Admin-side view of the same Form 16 source data staff see for
// themselves on My Payslips — total income, exemptions claimed, TDS
// withheld, shortfall/excess — so payroll doesn't have to ask someone
// to screenshot their own self-service page to answer a question about it.
function TaxReconciliationSection({ staffId }: { staffId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tax-reconciliation', staffId],
    queryFn: () => hrmsApi.taxReconciliation.get({ user_id: staffId }).then(r => r.data),
  })

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
  if (!data?.academic_year || data.months_covered === 0) return null

  const excess = data.shortfall_or_excess >= 0

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Tax Reconciliation — {data.academic_year.name}</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Gross Income (YTD)</p><p className="font-semibold text-foreground">₹{Number(data.gross_income_ytd).toLocaleString('en-IN')}</p></div>
          <div><p className="text-xs text-muted-foreground">Exemptions Applied</p><p className="font-semibold text-foreground">₹{(Number(data.section_80c_applied) + Number(data.hra_exemption) + Number(data.other_exemptions)).toLocaleString('en-IN')}</p></div>
          <div><p className="text-xs text-muted-foreground">Taxable Income (YTD)</p><p className="font-semibold text-foreground">₹{Number(data.taxable_income_ytd).toLocaleString('en-IN')}</p></div>
          <div><p className="text-xs text-muted-foreground">TDS Withheld (YTD)</p><p className="font-semibold text-foreground">₹{Number(data.tds_withheld_ytd).toLocaleString('en-IN')}</p></div>
        </div>
        <div className={cn('mt-4 flex items-center justify-between rounded-xl px-4 py-3', excess ? 'bg-success/10' : 'bg-warning/10')}>
          <span className="text-sm font-medium text-foreground">{excess ? 'Excess withheld so far' : 'Shortfall so far'}</span>
          <span className={cn('text-lg font-bold', excess ? 'text-success' : 'text-warning')}>₹{Math.abs(Number(data.shortfall_or_excess)).toLocaleString('en-IN')}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Based on {data.months_covered} payslip{data.months_covered !== 1 ? 's' : ''} so far this year — not a final figure until the year closes.</p>
      </CardContent>
    </Card>
  )
}

function LoansSection({ staffId, userName }: { staffId: string; userName: string }) {
  const qc = useQueryClient()
  const [showIssueModal, setShowIssueModal] = useState(false)

  const { data: loans, isLoading } = useQuery({
    queryKey: ['staff-loans', staffId],
    queryFn: () => hrmsApi.loans.list(staffId).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff-loans', staffId] })

  const payoffMutation = useMutation({
    mutationFn: (loanId: string) => hrmsApi.loans.payoff(loanId),
    onSuccess: () => { invalidate(); toast.success('Loan marked paid off') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const writeOffMutation = useMutation({
    mutationFn: ({ loanId, note }: { loanId: string; note: string }) => hrmsApi.loans.writeOff(loanId, note),
    onSuccess: () => { invalidate(); toast.success('Loan written off') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const cancelMutation = useMutation({
    mutationFn: (loanId: string) => hrmsApi.loans.cancel(loanId),
    onSuccess: () => { invalidate(); toast.success('Loan cancelled') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed'),
  })

  const LOAN_STATUS_COLORS: Record<string, string> = {
    active: 'bg-info/10 text-info ring-1 ring-inset ring-info/20',
    settled: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
    written_off: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
    cancelled: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-foreground"><IndianRupee className="h-4 w-4 text-muted-foreground" /> Loans &amp; Advances</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowIssueModal(true)} className="text-primary hover:text-primary/80">
            <IndianRupee className="h-3.5 w-3.5" /> Issue Loan
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (loans ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No loans or advances on record. Recovery installments are automatically deducted from future payslips once one is issued.</p>
        ) : (
          <div className="space-y-2">
            {(loans ?? []).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">₹{Number(l.principal_amount).toLocaleString('en-IN')}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', LOAN_STATUS_COLORS[l.status])}>{l.status.replace('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ₹{Number(l.installment_amount).toLocaleString('en-IN')}/month · {l.installments_paid}/{l.installments_total} installments paid
                    {l.reason && ` · ${l.reason}`}
                  </p>
                  {l.closure_note && <p className="mt-1 text-xs text-muted-foreground">{l.status === 'written_off' ? 'Write-off reason' : 'Note'}: {l.closure_note}</p>}
                </div>
                {l.status === 'active' && (
                  <div className="flex flex-shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm('Mark this loan as fully paid off (recovered outside the normal installment schedule)?')) payoffMutation.mutate(l.id) }}
                      disabled={payoffMutation.isPending} className="text-muted-foreground hover:text-success">
                      Payoff
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      const note = prompt('Reason for writing off the remaining balance:')
                      if (note && note.trim().length >= 3) writeOffMutation.mutate({ loanId: l.id, note: note.trim() })
                      else if (note !== null) toast.error('Give a reason — at least a few words')
                    }} disabled={writeOffMutation.isPending} className="text-muted-foreground hover:text-warning">
                      Write Off
                    </Button>
                    {l.installments_paid === 0 && (
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('Cancel this loan? Only use this if nothing was ever disbursed/recovered.')) cancelMutation.mutate(l.id) }}
                        disabled={cancelMutation.isPending} className="text-muted-foreground hover:text-destructive">
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {showIssueModal && (
        <IssueLoanModal staffId={staffId} userName={userName} onClose={() => {
          setShowIssueModal(false)
          qc.invalidateQueries({ queryKey: ['staff-loans', staffId] })
        }} />
      )}
    </Card>
  )
}

function IssueLoanModal({ staffId, userName, onClose }: { staffId: string; userName: string; onClose: () => void }) {
  const [form, setForm] = useState({ principal_amount: '', installment_amount: '', installments_total: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.principal_amount || !form.installment_amount || !form.installments_total) return toast.error('Amount and installment plan are required')
    setLoading(true)
    try {
      await hrmsApi.loans.create({
        user_id: staffId,
        principal_amount: Number(form.principal_amount),
        installment_amount: Number(form.installment_amount),
        installments_total: Number(form.installments_total),
        reason: form.reason || undefined,
      })
      toast.success('Loan issued')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Issue Loan — {userName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Principal Amount *</Label>
            <Input type="number" value={form.principal_amount} onChange={e => setForm(f => ({ ...f, principal_amount: e.target.value }))} placeholder="0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Monthly Installment *</Label>
              <Input type="number" value={form.installment_amount} onChange={e => setForm(f => ({ ...f, installment_amount: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label># Installments *</Label>
              <Input type="number" value={form.installments_total} onChange={e => setForm(f => ({ ...f, installments_total: e.target.value }))} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={2} className="resize-none" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Issue Loan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Module-scope, not defined inside SalaryModal — same reasoning as
// ProfileField above.
function SalaryField({ form, setForm, label, name }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" value={form[name]} onChange={e => setForm((f: any) => ({ ...f, [name]: e.target.value }))} placeholder="0" />
    </div>
  )
}

function SalaryModal({ staffId, userName, existing, onClose }: any) {
  const [type, setType] = useState<'fixed_monthly' | 'hourly' | 'per_session'>(existing?.type ?? 'fixed_monthly')
  const [hourlyRate, setHourlyRate] = useState(existing?.hourly_rate ?? '')
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
    if (type === 'fixed_monthly' && !form.basic_salary) return toast.error('Basic salary is required')
    if (type === 'hourly' && !hourlyRate) return toast.error('Hourly rate is required')
    setLoading(true)
    try {
      await hrmsApi.salaryStructure.set({
        user_id: staffId,
        type,
        hourly_rate: type === 'hourly' ? Number(hourlyRate) : null,
        // Hourly/per-session have no fixed components — zeroed rather
        // than left as whatever was on file for the PREVIOUS type, so a
        // structure switched from fixed_monthly doesn't keep contributing
        // stale basic/hra/etc through segmentation.
        ...(type === 'fixed_monthly'
          ? Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? 0 : Number(v)]))
          : { basic_salary: 0, hra: 0, da: 0, conveyance_allowance: 0, medical_allowance: 0, other_allowances: 0,
              pf_deduction: Number(form.pf_deduction) || 0, professional_tax: Number(form.professional_tax) || 0, other_deductions: Number(form.other_deductions) || 0 }),
      })
      toast.success('Salary structure saved')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Salary Structure — {userName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pay Type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_monthly">Fixed Monthly</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="per_session">Per-Session (no fixed pay)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'fixed_monthly' && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Earnings</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <SalaryField form={form} setForm={setForm} label="Basic Salary *" name="basic_salary" />
                <SalaryField form={form} setForm={setForm} label="HRA" name="hra" />
                <SalaryField form={form} setForm={setForm} label="DA" name="da" />
                <SalaryField form={form} setForm={setForm} label="Conveyance" name="conveyance_allowance" />
                <SalaryField form={form} setForm={setForm} label="Medical Allowance" name="medical_allowance" />
                <SalaryField form={form} setForm={setForm} label="Other Allowances" name="other_allowances" />
              </div>
            </div>
          )}
          {type === 'hourly' && (
            <div className="space-y-1.5">
              <Label>Hourly Rate (₹) *</Label>
              <Input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="e.g. 300" />
              <p className="text-xs text-muted-foreground">Regular pay is standard hours worked × this rate; overtime is paid at the school's overtime multiplier on top.</p>
            </div>
          )}
          {type === 'per_session' && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              No fixed pay — earnings come entirely from approved sessions logged under Payroll → Duty Log, summed each period.
            </p>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Deductions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <SalaryField form={form} setForm={setForm} label="PF" name="pf_deduction" />
              <SalaryField form={form} setForm={setForm} label="Professional Tax" name="professional_tax" />
              <SalaryField form={form} setForm={setForm} label="Other Deductions" name="other_deductions" />
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

// ── POSITION HISTORY TAB ──────────────────────────────────────
function PositionHistoryTab({ staffId }: { staffId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['position-history', staffId],
    queryFn: () => hrmsApi.staff.positionHistory(staffId).then(r => r.data),
  })

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Position History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            icon={History}
            title="No position changes recorded yet"
            description="Every promotion, transfer, or probation decision made via the Promote / Transfer action will show up here."
          />
        ) : (
          <div className="divide-y divide-border">
            {(data ?? []).map((h: any) => {
              const isCurrent = !h.effective_to
              return (
                <div key={h.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {(h.designation || h.department) ? (
                      <span className="text-sm font-semibold text-foreground">
                        {[h.designation, h.department, h.branch].filter(Boolean).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">No position change</span>
                    )}
                    {isCurrent && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success/20">Current</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(h.effective_from)} {isCurrent ? '→ present' : `→ ${formatDate(h.effective_to)}`}
                    {h.changed_by_user?.full_name && ` · by ${h.changed_by_user.full_name}`}
                  </p>
                  {h.reason && <p className="mt-1 text-xs text-muted-foreground">{h.reason}</p>}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── PROMOTE / TRANSFER MODAL ───────────────────────────────────
function PromoteTransferModal({ staffId, userName, profile, onClose }: any) {
  const [form, setForm] = useState({
    designation: profile?.designation ?? '',
    department: profile?.department ?? '',
    branch: '',
    effective_from: new Date().toISOString().split('T')[0],
    reason: '',
  })
  const [alsoUpdateSalary, setAlsoUpdateSalary] = useState(false)
  const [salary, setSalary] = useState({
    basic_salary: '', hra: '', da: '', conveyance_allowance: '', medical_allowance: '', other_allowances: '',
    pf_deduction: '', professional_tax: '', other_deductions: '',
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.effective_from) return toast.error('Effective date is required')
    if (alsoUpdateSalary && !salary.basic_salary) return toast.error('Basic salary is required to update salary')
    setLoading(true)
    try {
      const res = await hrmsApi.staff.promote(staffId, {
        ...form,
        salary: alsoUpdateSalary
          ? Object.fromEntries(Object.entries(salary).map(([k, v]) => [k, v === '' ? 0 : Number(v)]))
          : undefined,
      })
      toast.success('Position updated')
      // Stage 7: a backdated salary change auto-stages arrears for any
      // intervening month that already has a payslip on record — surface
      // it immediately rather than leaving it to be discovered later in
      // the approval queue.
      const staged = res?.auto_staged_arrears ?? []
      const gaps = res?.arrears_gaps ?? []
      if (staged.length) {
        toast.info(`${staged.length} month${staged.length !== 1 ? 's' : ''} of arrears auto-staged for review — see Payroll → Pending Arrears.`, { duration: 8000 })
      }
      if (gaps.length) {
        toast.warning(`${gaps.length} month${gaps.length !== 1 ? 's' : ''} had no payslip on record to compare against — review manually: ${gaps.map((g: any) => `${g.month}/${g.year}`).join(', ')}`, { duration: 10000 })
      }
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote / Transfer — {userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. Senior PGT" />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Science" />
            </div>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Effective From *</Label>
              <Input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={2} className="resize-none" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Annual promotion cycle, department restructuring..." />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={alsoUpdateSalary} onChange={e => setAlsoUpdateSalary(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Also update salary structure effective the same date
          </label>

          {alsoUpdateSalary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-xl border border-border bg-muted/40 p-3">
              {[
                ['basic_salary', 'Basic Salary *'], ['hra', 'HRA'], ['da', 'DA'],
                ['conveyance_allowance', 'Conveyance'], ['medical_allowance', 'Medical Allowance'], ['other_allowances', 'Other Allowances'],
                ['pf_deduction', 'PF'], ['professional_tax', 'Professional Tax'], ['other_deductions', 'Other Deductions'],
              ].map(([name, label]) => (
                <div key={name} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input type="number" value={(salary as any)[name]} onChange={e => setSalary(s => ({ ...s, [name]: e.target.value }))} placeholder="0" />
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── DOCUMENTS TAB ────────────────────────────────────────────────
const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'Contract', id_proof: 'ID Proof', certification: 'Certification',
  police_verification: 'Police Verification', offer_letter: 'Offer Letter', policy: 'Policy', other: 'Other',
}

function DocumentsTab({ staffId }: { staffId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showUpload, setShowUpload] = useState(false)
  const isSelf = user?.id === staffId
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: docs, isLoading } = useQuery({
    queryKey: ['staff-documents', staffId],
    queryFn: () => hrmsApi.staff.documents.list(staffId).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff-documents', staffId] })

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => hrmsApi.staff.documents.delete(staffId, docId),
    onSuccess: () => { toast.success('Document deleted'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (docId: string) => hrmsApi.staff.documents.acknowledge(staffId, docId),
    onSuccess: () => { toast.success('Acknowledged'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to acknowledge'),
  })

  const expiryBadge = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const cls = expiryDate < today
      ? 'bg-destructive/10 text-destructive ring-destructive/20'
      : expiryDate <= thirtyDaysOut
        ? 'bg-warning/10 text-warning ring-warning/20'
        : 'bg-muted text-muted-foreground ring-border'
    return (
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', cls)}>
        {expiryDate < today ? 'Expired ' : 'Expires '}{formatDate(expiryDate)}
      </span>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border">
        <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Documents</CardTitle>
        <Button size="sm" onClick={() => setShowUpload(true)}><Plus className="h-3.5 w-3.5" /> Upload</Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : (docs ?? []).length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" description="Upload contracts, ID proofs, certifications and more."
            action={<Button size="sm" onClick={() => setShowUpload(true)}>Upload First Document</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {(docs ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{doc.document_name}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}</span>
                    {expiryBadge(doc.expiry_date)}
                    {doc.requires_acknowledgment && (
                      doc.acknowledged_at
                        ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Acknowledged {formatDate(doc.acknowledged_at)}</span>
                        : <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Awaiting acknowledgment</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {doc.file_size} · uploaded {formatDate(doc.created_at)}{doc.uploaded_by_user?.full_name ? ` by ${doc.uploaded_by_user.full_name}` : ''}
                  </p>
                  {doc.notes && <p className="mt-1 text-xs text-muted-foreground">{doc.notes}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {doc.requires_acknowledgment && !doc.acknowledged_at && isSelf && (
                    <Button size="sm" variant="outline" onClick={() => acknowledgeMutation.mutate(doc.id)} disabled={acknowledgeMutation.isPending}>
                      <Check className="h-3.5 w-3.5" /> I've read this
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="icon" title="View">
                    <a href={doc.file_url} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" /></a>
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive" title="Delete"
                    onClick={() => { if (confirm('Delete this document?')) deleteMutation.mutate(doc.id) }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {showUpload && (
        <UploadDocumentModal staffId={staffId} onClose={() => { setShowUpload(false); invalidate() }} />
      )}
    </Card>
  )
}

function UploadDocumentModal({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const [form, setForm] = useState({ document_type: 'other', document_name: '', notes: '', expiry_date: '', requires_acknowledgment: false })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = () => {
    if (!file) return toast.error('Please select a file')
    if (!form.document_name) return toast.error('Please enter a document name')
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        await hrmsApi.staff.documents.upload(staffId, {
          file_base64: reader.result, file_name: file.name, mime_type: file.type,
          ...form, expiry_date: form.expiry_date || undefined,
        })
        toast.success('Document uploaded')
        onClose()
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Upload failed')
      } finally { setUploading(false) }
    }
    reader.readAsDataURL(file)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={form.document_type} onValueChange={v => setForm(f => ({ ...f, document_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Document Name *</Label>
            <Input value={form.document_name} onChange={e => setForm(f => ({ ...f, document_name: e.target.value }))} placeholder="e.g. Employment Contract 2026" />
          </div>
          <div className="space-y-1.5">
            <Label>File *</Label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" />
          </div>
          <div className="space-y-1.5">
            <Label>Expiry Date (optional)</Label>
            <Input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="accent-primary" checked={form.requires_acknowledgment}
              onChange={e => setForm(f => ({ ...f, requires_acknowledgment: e.target.checked }))} />
            Require the staff member to acknowledge this document
          </label>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} className="resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />} Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── EXIT TAB ───────────────────────────────────────────────────
const EXIT_STATUS_COLORS: Record<string, string> = {
  initiated: 'bg-muted text-muted-foreground ring-border',
  notice_period: 'bg-warning/10 text-warning ring-warning/20',
  cleared: 'bg-info/10 text-info ring-info/20',
  settled: 'bg-success/10 text-success ring-success/20',
}

function ExitTab({ staffId, userName }: { staffId: string; userName: string }) {
  const qc = useQueryClient()
  const [showInitiate, setShowInitiate] = useState(false)

  const { data: exit, isLoading } = useQuery({
    queryKey: ['staff-exit', staffId],
    queryFn: () => hrmsApi.exit.get(staffId).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff-exit', staffId] })

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, is_completed }: any) => hrmsApi.exit.toggleChecklistItem(exit.id, itemId, { is_completed }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const submitSettlementMutation = useMutation({
    mutationFn: () => hrmsApi.exit.submitSettlement(exit.id),
    onSuccess: () => { invalidate(); toast.success('Submitted for settlement approval') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to submit'),
  })

  const workflowActionMutation = useMutation({
    mutationFn: (status: 'approved' | 'rejected') => hrmsApi.exit.workflowAction(exit.id, { status }),
    onSuccess: (_: any, status) => { invalidate(); toast.success(status === 'approved' ? 'Settlement approved — account deactivated' : 'Settlement rejected') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record decision'),
  })

  if (isLoading) return <Card className="space-y-3 p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>

  if (!exit) {
    return (
      <Card>
        <EmptyState
          icon={LogOut}
          title="No exit in progress"
          description="If this staff member has resigned, initiate the exit process to start clearance and full & final settlement."
          action={<Button onClick={() => setShowInitiate(true)}><LogOut className="h-4 w-4" /> Initiate Exit</Button>}
        />
        {showInitiate && <InitiateExitModal staffId={staffId} userName={userName} onClose={(saved) => { setShowInitiate(false); if (saved) invalidate() }} />}
      </Card>
    )
  }

  const workflowInProgress = exit.workflow?.status === 'in_progress'

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Resignation</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset', EXIT_STATUS_COLORS[exit.status])}>{exit.status.replace('_', ' ')}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Resigned {formatDate(exit.resignation_date)} · Last working day {formatDate(exit.last_working_day)}
              {exit.notice_period_days ? ` · ${exit.notice_period_days} day notice` : ''}
            </p>
            {exit.reason && <p className="mt-1 text-xs text-muted-foreground">{exit.reason}</p>}
          </div>
          {exit.status === 'settled' && (
            <Button variant="outline" size="sm" asChild>
              <a href={documentsApi.relievingLetter(exit.id)} target="_blank" rel="noreferrer"><FileText className="h-3.5 w-3.5" /> Relieving Letter</a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">Clearance Checklist</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {(exit.checklist ?? []).map((item: any) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-3 px-6 py-3 hover:bg-muted/40">
              <input type="checkbox" checked={item.is_completed} disabled={exit.status === 'settled'}
                onChange={e => toggleMutation.mutate({ itemId: item.id, is_completed: e.target.checked })}
                className="h-4 w-4 rounded border-border" />
              <span className={cn('text-sm', item.is_completed ? 'text-muted-foreground line-through' : 'text-foreground')}>{item.item_name}</span>
              {item.completed_at && <span className="ml-auto text-xs text-muted-foreground">{formatDate(item.completed_at)}</span>}
            </label>
          ))}
        </CardContent>
      </Card>

      {(exit.status === 'cleared' || exit.status === 'settled' || exit.net_settlement != null) && (
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Full &amp; Final Settlement</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {exit.net_settlement == null ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Clearance is complete — submit to compute the payout and start approval.</p>
                <Button size="sm" onClick={() => submitSettlementMutation.mutate()} disabled={submitSettlementMutation.isPending}>
                  {submitSettlementMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit for Settlement Approval
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                  <div><p className="text-xs text-muted-foreground">Pending Leave</p><p className="font-semibold text-foreground">{exit.pending_leave_days} days</p></div>
                  <div><p className="text-xs text-muted-foreground">Leave Payout</p><p className="font-semibold text-success">₹{Number(exit.leave_payout).toLocaleString('en-IN')}</p></div>
                  <div><p className="text-xs text-muted-foreground">LOP Deduction</p><p className="font-semibold text-destructive">₹{Number(exit.lop_deduction).toLocaleString('en-IN')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Loan Recovery</p><p className="font-semibold text-destructive">₹{Number(exit.advances_deduction).toLocaleString('en-IN')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Net Settlement</p><p className={cn('text-lg font-bold', Number(exit.net_settlement) < 0 ? 'text-destructive' : 'text-primary')}>₹{Number(exit.net_settlement).toLocaleString('en-IN')}</p></div>
                </div>
                {Number(exit.net_settlement) < 0 && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <p>
                      Outstanding loan balance exceeds what's owed to {userName} — they owe the school{' '}
                      <span className="font-semibold">₹{Math.abs(Number(exit.net_settlement)).toLocaleString('en-IN')}</span>.
                      This isn't collected automatically; it needs a separate conversation and recovery arrangement.
                    </p>
                  </div>
                )}
                {workflowInProgress && (
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">Awaiting settlement approval.</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => workflowActionMutation.mutate('approved')} disabled={workflowActionMutation.isPending}
                        className="bg-success/10 text-success shadow-none hover:bg-success/20">
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" onClick={() => workflowActionMutation.mutate('rejected')} disabled={workflowActionMutation.isPending}
                        className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InitiateExitModal({ staffId, userName, onClose }: { staffId: string; userName: string; onClose: (saved: boolean) => void }) {
  const [form, setForm] = useState({ resignation_date: new Date().toISOString().split('T')[0], last_working_day: '', notice_period_days: '', reason: '' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.last_working_day) return toast.error('Last working day is required')
    setLoading(true)
    try {
      await hrmsApi.exit.initiate(staffId, {
        ...form,
        notice_period_days: form.notice_period_days ? Number(form.notice_period_days) : undefined,
      })
      toast.success('Exit initiated')
      onClose(true)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(false) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Initiate Exit — {userName}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Resignation Date *</Label>
            <Input type="date" value={form.resignation_date} onChange={e => setForm(f => ({ ...f, resignation_date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Last Working Day *</Label>
            <Input type="date" value={form.last_working_day} onChange={e => setForm(f => ({ ...f, last_working_day: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Notice Period (days)</Label>
            <Input type="number" value={form.notice_period_days} onChange={e => setForm(f => ({ ...f, notice_period_days: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={3} className="resize-none" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Initiate Exit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
