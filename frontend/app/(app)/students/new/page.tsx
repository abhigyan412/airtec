'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, CheckCircle, User, BookOpen, Phone, UserPlus } from 'lucide-react'
import { studentsApi, admissionApi } from '@/lib/api'
import { toast } from 'sonner'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input as UiInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select as UiSelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

const SECTIONS = [
  { id: 'personal', label: 'Personal Info', icon: User },
  { id: 'academic', label: 'Academic', icon: BookOpen },
  { id: 'parent', label: 'Parent Info', icon: Phone },
]

// Module-scope, not defined inside the page component — see the same
// fix on students/[id]/edit/page.tsx for why: a component defined inside
// another component's function body gets a new identity every render,
// so React remounts (and drops focus on) the input after every keystroke.
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
        <SelectTrigger>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((o: any) => (
            <SelectItem key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</SelectItem>
          ))}
        </SelectContent>
      </UiSelect>
    </div>
  )
}

export default function NewStudentPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [section, setSection] = useState('personal')

  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '', gender: '',
    blood_group: '', aadhaar_number: '', permanent_address: '',
    city: '', state: '', pincode: '', phone: '', email: '',
    class_id: '', section_id: '', roll_number: '', stream: '', house_id: '',
    father_name: '', father_phone: '', father_email: '',
    mother_name: '', mother_phone: '', mother_email: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const selectedClass = classesData?.find((c: any) => c.id === form.class_id)
  const sections = selectedClass?.sections ?? []

  const mutation = useMutation({
    mutationFn: (data: any) => studentsApi.create(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['student-stats'] })
      toast.success('Student added successfully!')
      router.push(`/students/${res.data.id}`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to add student'),
  })

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to students" className="mt-1 shrink-0">
          <Link href="/students">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Add New Student"
          description="Fill in student details to enrol"
          icon={UserPlus}
        />
      </div>

      {/* Section tabs */}
      <Tabs value={section} onValueChange={setSection} className="w-fit">
        <TabsList>
          {SECTIONS.map(s => (
            <TabsTrigger key={s.id} value={s.id}>
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-6 sm:p-8">
          {section === 'personal' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Input form={form} set={set} label="First Name" field="first_name" required placeholder="Rahul" />
              <Input form={form} set={set} label="Last Name" field="last_name" required placeholder="Sharma" />
              <Input form={form} set={set} label="Date of Birth" field="date_of_birth" type="date" />
              <Select form={form} set={set} label="Gender" field="gender" options={['male','female','other']} />
              <Select form={form} set={set} label="Blood Group" field="blood_group" options={['A+','A-','B+','B-','AB+','AB-','O+','O-']} />
              <Input form={form} set={set} label="Aadhaar Number" field="aadhaar_number" placeholder="xxxx xxxx xxxx" />
              <div className="col-span-2">
                <Input form={form} set={set} label="Address" field="permanent_address" placeholder="House No, Street, Area" />
              </div>
              <Input form={form} set={set} label="City" field="city" placeholder="Lucknow" />
              <Input form={form} set={set} label="State" field="state" placeholder="Uttar Pradesh" />
              <Input form={form} set={set} label="Pincode" field="pincode" placeholder="226001" />
              <Input form={form} set={set} label="Phone" field="phone" placeholder="+91 98765 43210" />
              <div className="col-span-2">
                <Input form={form} set={set} label="Email" field="email" type="email" placeholder="student@email.com" />
              </div>
            </div>
          )}

          {section === 'academic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Select form={form} set={set} label="Class" field="class_id" required
                options={(classesData ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
              <Select form={form} set={set} label="Section" field="section_id"
                options={sections.map((s: any) => ({ value: s.id, label: s.name }))} />
              <Input form={form} set={set} label="Roll Number" field="roll_number" placeholder="01" />
              <Select form={form} set={set} label="Stream" field="stream"
                options={['Science','Commerce','Arts','General']} />
            </div>
          )}

          {section === 'parent' && (
            <div className="space-y-6">
              <div>
                <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10 text-xs text-blue-600 dark:text-blue-400">F</span>
                  Father&apos;s Details
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input form={form} set={set} label="Father's Name" field="father_name" placeholder="Mr. Rajesh Sharma" />
                  <Input form={form} set={set} label="Father's Phone" field="father_phone" placeholder="+91 98765 43210" />
                  <div className="col-span-2">
                    <Input form={form} set={set} label="Father's Email" field="father_email" type="email" />
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-6">
                <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pink-500/10 text-xs text-pink-600 dark:text-pink-400">M</span>
                  Mother&apos;s Details
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input form={form} set={set} label="Mother's Name" field="mother_name" placeholder="Mrs. Priya Sharma" />
                  <Input form={form} set={set} label="Mother's Phone" field="mother_phone" placeholder="+91 98765 43210" />
                  <div className="col-span-2">
                    <Input form={form} set={set} label="Mother's Email" field="mother_email" type="email" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pb-8">
        <Button variant="outline" asChild>
          <Link href="/students">Cancel</Link>
        </Button>
        <div className="flex gap-3">
          {section !== 'personal' && (
            <Button variant="outline" onClick={() => setSection(s => s === 'parent' ? 'academic' : 'personal')}>
              ← Back
            </Button>
          )}
          {section !== 'parent' ? (
            <Button
              onClick={() => setSection(s => s === 'personal' ? 'academic' : 'parent')}
              disabled={!form.first_name || !form.last_name}
            >
              Continue →
            </Button>
          ) : (
            <Button
              onClick={() => mutation.mutate(form)}
              disabled={mutation.isPending || !form.first_name || !form.last_name}
            >
              {mutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle className="h-4 w-4" /> Save Student</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
