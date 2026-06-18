'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, CheckCircle, User, BookOpen, Phone } from 'lucide-react'
import { studentsApi, admissionApi } from '@/lib/api'
import { toast } from 'sonner'
import Link from 'next/link'

const SECTIONS = [
  { id: 'personal', label: 'Personal Info', icon: User },
  { id: 'academic', label: 'Academic', icon: BookOpen },
  { id: 'parent', label: 'Parent Info', icon: Phone },
]

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

  const Input = ({ label, field, type = 'text', placeholder = '', required = false }: any) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</label>
      <input type={type} value={(form as any)[field]} onChange={e => set(field, e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
    </div>
  )

  const Select = ({ label, field, options, required = false }: any) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</label>
      <select value={(form as any)[field]} onChange={e => set(field, e.target.value)}
        className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all">
        <option value="">Select...</option>
        {options.map((o: any) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/students" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Student</h1>
          <p className="text-gray-400 text-sm">Fill in student details to enrol</p>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              section === s.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-8">
        {section === 'personal' && (
          <div className="grid grid-cols-2 gap-5">
            <Input label="First Name" field="first_name" required placeholder="Rahul" />
            <Input label="Last Name" field="last_name" required placeholder="Sharma" />
            <Input label="Date of Birth" field="date_of_birth" type="date" />
            <Select label="Gender" field="gender" options={['male','female','other']} />
            <Select label="Blood Group" field="blood_group" options={['A+','A-','B+','B-','AB+','AB-','O+','O-']} />
            <Input label="Aadhaar Number" field="aadhaar_number" placeholder="xxxx xxxx xxxx" />
            <div className="col-span-2">
              <Input label="Address" field="permanent_address" placeholder="House No, Street, Area" />
            </div>
            <Input label="City" field="city" placeholder="Lucknow" />
            <Input label="State" field="state" placeholder="Uttar Pradesh" />
            <Input label="Pincode" field="pincode" placeholder="226001" />
            <Input label="Phone" field="phone" placeholder="+91 98765 43210" />
            <div className="col-span-2">
              <Input label="Email" field="email" type="email" placeholder="student@email.com" />
            </div>
          </div>
        )}

        {section === 'academic' && (
          <div className="grid grid-cols-2 gap-5">
            <Select label="Class" field="class_id" required
              options={(classesData ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
            <Select label="Section" field="section_id"
              options={sections.map((s: any) => ({ value: s.id, label: `Section ${s.name}` }))} />
            <Input label="Roll Number" field="roll_number" placeholder="01" />
            <Select label="Stream" field="stream"
              options={['Science','Commerce','Arts','General']} />
          </div>
        )}

        {section === 'parent' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs">F</span>
                Father's Details
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Father's Name" field="father_name" placeholder="Mr. Rajesh Sharma" />
                <Input label="Father's Phone" field="father_phone" placeholder="+91 98765 43210" />
                <div className="col-span-2">
                  <Input label="Father's Email" field="father_email" type="email" />
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-6">
              <p className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 bg-pink-100 text-pink-700 rounded-full flex items-center justify-center text-xs">M</span>
                Mother's Details
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Mother's Name" field="mother_name" placeholder="Mrs. Priya Sharma" />
                <Input label="Mother's Phone" field="mother_phone" placeholder="+91 98765 43210" />
                <div className="col-span-2">
                  <Input label="Mother's Email" field="mother_email" type="email" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pb-8">
        <Link href="/students" className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all">
          Cancel
        </Link>
        <div className="flex gap-3">
          {section !== 'personal' && (
            <button onClick={() => setSection(s => s === 'parent' ? 'academic' : 'personal')}
              className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-all">
              ← Back
            </button>
          )}
          {section !== 'parent' ? (
            <button onClick={() => setSection(s => s === 'personal' ? 'academic' : 'parent')}
              disabled={!form.first_name || !form.last_name}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all">
              Continue →
            </button>
          ) : (
            <button
              onClick={() => mutation.mutate(form)}
              disabled={mutation.isPending || !form.first_name || !form.last_name}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm shadow-indigo-200">
              {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><CheckCircle className="w-4 h-4" /> Save Student</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
