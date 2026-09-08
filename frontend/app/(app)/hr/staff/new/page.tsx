'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, CheckCircle, UserCog, Briefcase, Phone, Copy, Check, UserPlus } from 'lucide-react'
import { teamApi, rbacApi } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input as UiInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select as UiSelect, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const SECTIONS = [
  { id: 'account', label: 'Account & Role', icon: UserCog },
  { id: 'employment', label: 'Employment', icon: Briefcase },
  { id: 'contact', label: 'Contact & Bank', icon: Phone },
]

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

// Module-scope, not defined inside the page component — a component
// defined inside another component's function body gets a new identity
// every render, so React remounts (and drops focus on) the input after
// every keystroke. Same fix already applied on students/new/page.tsx.
function Input({ form, set, label, field, type = 'text', placeholder = '', required = false }: any) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="ml-0.5 text-destructive">*</span>}</Label>
      <UiInput type={type} value={form[field]} onChange={e => set(field, e.target.value)}
        placeholder={placeholder} required={required} />
    </div>
  )
}

function Select({ form, set, label, field, options, required = false }: any) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="ml-0.5 text-destructive">*</span>}</Label>
      <UiSelect value={form[field] || undefined} onValueChange={v => set(field, v)}>
        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {options.map((o: any) => <SelectItem key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</SelectItem>)}
        </SelectContent>
      </UiSelect>
    </div>
  )
}

export default function NewStaffPage() {
  const router = useRouter()
  const [section, setSection] = useState('account')
  const [result, setResult] = useState<{ email: string; password: string; userId: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({
    full_name: '', email: '', role_id: '', phone: '', password: generatePassword(),
    designation: '', department: '', employee_id: '', date_of_joining: '', employment_type: '',
    date_of_birth: '', gender: '', blood_group: '', qualification: '', experience_years: '',
    alternate_phone: '', personal_email: '', address: '', city: '', state: '', pincode: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    bank_name: '', bank_account_number: '', bank_ifsc: '', pan_number: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const { data: allRoles } = useQuery({ queryKey: ['rbac-roles'], queryFn: () => rbacApi.roles.list().then(r => r.data as any[]) })
  const selectedRoleName = (allRoles ?? []).find((r: any) => r.id === form.role_id)?.name

  const mutation = useMutation({
    mutationFn: () => teamApi.invite({
      ...form,
      experience_years: form.experience_years ? Number(form.experience_years) : undefined,
    }),
    onSuccess: (res: any) => {
      toast.success('Staff member added')
      setResult({ email: form.email, password: form.password, userId: res.data.id })
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to add staff member'),
  })

  const copyCredentials = () => {
    navigator.clipboard.writeText(`Email: ${result!.email}\nPassword: ${result!.password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (result) {
    return (
      <div className="max-w-lg space-y-6">
        <PageHeader title="Staff Member Added" description="Share these login credentials — the password won't be shown again." icon={CheckCircle} className="mb-0" />
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
              <p><span className="text-muted-foreground">Email:</span> {result.email}</p>
              <p><span className="text-muted-foreground">Password:</span> <span className="font-mono">{result.password}</span></p>
              <button onClick={copyCredentials} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success hover:text-success/80">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied!' : 'Copy credentials'}
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => router.push('/hr/staff')}>Back to Directory</Button>
              <Button onClick={() => router.push(`/hr/staff/${result.userId}`)}>View Profile</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to staff" className="mt-1 shrink-0">
          <Link href="/hr/staff"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader className="mb-0 flex-1" title="Add Staff Member" description="Create a login and staff profile in one go" icon={UserPlus} />
      </div>

      <Tabs value={section} onValueChange={setSection} className="w-fit">
        <TabsList>
          {SECTIONS.map(s => <TabsTrigger key={s.id} value={s.id}><s.icon className="h-3.5 w-3.5" />{s.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-6 sm:p-8">
          {section === 'account' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="col-span-2"><Input form={form} set={set} label="Full Name" field="full_name" required placeholder="Priya Sharma" /></div>
              <div className="col-span-2"><Input form={form} set={set} label="Email" field="email" type="email" required placeholder="priya@school.edu" /></div>
              <Select form={form} set={set} label="Role" field="role_id" required options={(allRoles ?? []).map((r: any) => ({ value: r.id, label: r.name }))} />
              <Input form={form} set={set} label="Phone" field="phone" placeholder="+91 98765 43210" />
              <div className="col-span-2 space-y-1.5">
                <Label>Temporary Password <span className="ml-0.5 text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <UiInput className="font-mono" value={form.password} onChange={e => set('password', e.target.value)} />
                  <Button type="button" variant="outline" className="whitespace-nowrap" onClick={() => set('password', generatePassword())}>Regenerate</Button>
                </div>
                <p className="text-xs text-muted-foreground">Share this with the staff member — they can log in immediately.</p>
              </div>
            </div>
          )}

          {section === 'employment' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {selectedRoleName && selectedRoleName !== 'School Admin' ? (
                <>
                  <Input form={form} set={set} label="Designation" field="designation" placeholder="e.g. PGT Mathematics" />
                  <Input form={form} set={set} label="Department" field="department" placeholder="e.g. Academics" />
                </>
              ) : (
                <p className="col-span-2 text-sm text-muted-foreground">Designation and department don't apply to a School Admin account.</p>
              )}
              <Input form={form} set={set} label="Employee ID" field="employee_id" placeholder="EMP-0042" />
              <Input form={form} set={set} label="Date of Joining" field="date_of_joining" type="date" />
              <Select form={form} set={set} label="Employment Type" field="employment_type" options={['full_time', 'part_time', 'contract', 'probation']} />
              <Input form={form} set={set} label="Date of Birth" field="date_of_birth" type="date" />
              <Select form={form} set={set} label="Gender" field="gender" options={['male', 'female', 'other']} />
              <Select form={form} set={set} label="Blood Group" field="blood_group" options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']} />
              <Input form={form} set={set} label="Qualification" field="qualification" placeholder="M.Sc, B.Ed" />
              <Input form={form} set={set} label="Experience (years)" field="experience_years" type="number" placeholder="5" />
            </div>
          )}

          {section === 'contact' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Input form={form} set={set} label="Alternate Phone" field="alternate_phone" />
                <Input form={form} set={set} label="Personal Email" field="personal_email" type="email" />
                <div className="col-span-2"><Input form={form} set={set} label="Address" field="address" placeholder="House No, Street, Area" /></div>
                <Input form={form} set={set} label="City" field="city" placeholder="Lucknow" />
                <Input form={form} set={set} label="State" field="state" placeholder="Uttar Pradesh" />
                <Input form={form} set={set} label="Pincode" field="pincode" placeholder="226001" />
                <Input form={form} set={set} label="Emergency Contact Name" field="emergency_contact_name" />
                <Input form={form} set={set} label="Emergency Contact Phone" field="emergency_contact_phone" />
              </div>
              <div className="border-t border-border pt-6">
                <p className="mb-4 text-sm font-semibold text-foreground">Bank Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Input form={form} set={set} label="Bank Name" field="bank_name" />
                  <Input form={form} set={set} label="Account Number" field="bank_account_number" />
                  <Input form={form} set={set} label="IFSC Code" field="bank_ifsc" />
                  <Input form={form} set={set} label="PAN Number" field="pan_number" />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pb-8">
        <Button variant="outline" asChild><Link href="/hr/staff">Cancel</Link></Button>
        <div className="flex gap-3">
          {section !== 'account' && (
            <Button variant="outline" onClick={() => setSection(s => s === 'contact' ? 'employment' : 'account')}>← Back</Button>
          )}
          {section !== 'contact' ? (
            <Button onClick={() => setSection(s => s === 'account' ? 'employment' : 'contact')}
              disabled={!form.full_name || !form.email || !form.role_id || !form.password}>
              Continue →
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.full_name || !form.email || !form.role_id || !form.password}>
              {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle className="h-4 w-4" /> Add Staff Member</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
