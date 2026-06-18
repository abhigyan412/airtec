'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi } from '@/lib/api'
import { formatDate, formatCurrency, cn, STATUS_COLORS } from '@/lib/utils'
import { TransferCertificateCard } from '@/components/students/TransferCertificateCard'
import { ArrowLeft, User, BookOpen, Phone, CreditCard, FileText, Calendar, Droplets, MapPin, Mail, Hash, Camera, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { API_BASE } from '@/lib/api'

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading student profile...</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <p className="font-medium">Student not found</p>
        <Link href="/students" className="text-indigo-600 text-sm mt-2 hover:underline">Back to students</Link>
      </div>
    )
  }

  const s = data
  const parent = s.parents?.[0]
  const initials = `${s.first_name?.[0] ?? ''}${s.last_name?.[0] ?? ''}`.toUpperCase()

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/students" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <PhotoUpload studentId={id} currentUrl={s.photo_url} initials={initials} />
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{s.first_name} {s.last_name}</h1>
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', STATUS_COLORS[s.status])}>
                  {s.status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1">
                {s.admission_number && (
                  <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
                    #{s.admission_number}
                  </span>
                )}
                {s.classes?.name && (
                  <span className="text-sm text-gray-500">
                    {s.classes.name}{s.sections?.name ? ` · Section ${s.sections.name}` : ''}
                  </span>
                )}
                {s.houses && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                    {s.houses.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
         <a href={`${API_BASE}/documents/id-card/${id}`} target="_blank" rel="noreferrer"
            className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            ID Card
          </a>
          <Link href={`/students/${id}/edit`}
            className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Edit profile
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <Card title="Personal Information" icon={User}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Detail label="Date of Birth" value={s.date_of_birth ? formatDate(s.date_of_birth) : '—'} />
              <Detail label="Gender" value={s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : '—'} />
              <Detail label="Blood Group" value={s.blood_group ?? '—'} />
              <Detail label="Aadhaar" value={s.aadhaar_number ?? '—'} />
              <Detail label="Email" value={s.email ?? '—'} />
              <Detail label="Phone" value={s.phone ?? '—'} />
              <div className="col-span-2">
                <Detail label="Address" value={[s.permanent_address, s.city, s.state, s.pincode].filter(Boolean).join(', ') || '—'} />
              </div>
            </div>
          </Card>

          <Card title="Academic Details" icon={BookOpen}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Detail label="Class" value={s.classes?.name ?? '—'} />
              <Detail label="Section" value={s.sections?.name ? `Section ${s.sections.name}` : '—'} />
              <Detail label="Roll Number" value={s.roll_number ?? '—'} />
              <Detail label="Stream" value={s.stream ?? '—'} />
              <Detail label="Academic Year" value={s.academic_years?.name ?? '—'} />
              <Detail label="House" value={s.houses?.name ?? '—'} />
            </div>
            {(s.is_school_captain || s.is_house_captain) && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex gap-2 flex-wrap">
                {s.is_school_captain && <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">School Captain</span>}
                {s.is_house_captain && <span className="px-3 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">House Captain</span>}
              </div>
            )}
          </Card>

          {parent && (
            <Card title="Parent / Guardian" icon={Phone}>
              <div className="grid grid-cols-2 gap-6">
                {parent.father_name && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Father</p>
                    <Detail label="Name" value={parent.father_name} />
                    <Detail label="Phone" value={parent.father_phone ?? '—'} />
                    <Detail label="Email" value={parent.father_email ?? '—'} />
                  </div>
                )}
                {parent.mother_name && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Mother</p>
                    <Detail label="Name" value={parent.mother_name} />
                    <Detail label="Phone" value={parent.mother_phone ?? '—'} />
                    <Detail label="Email" value={parent.mother_email ?? '—'} />
                  </div>
                )}
              </div>
            </Card>
          )}

          <TransferCertificateCard studentId={id} studentStatus={s.status} />
        </div>

        <div className="space-y-5">
          <Card title="Fee Summary" icon={CreditCard}>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-500">Total Billed</span>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(s.fee_summary?.total_billed ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-sm text-gray-500">Collected</span>
                <span className="text-sm font-semibold text-emerald-600">{formatCurrency(s.fee_summary?.total_paid ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-500">Due</span>
                <span className="text-sm font-bold text-rose-600">{formatCurrency(s.fee_summary?.total_due ?? 0)}</span>
              </div>
            </div>
          </Card>

          <Card title="Quick Actions" icon={FileText}>
            <div className="space-y-2">
              <Link href={`/students/${id}/fees`}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-emerald-50 hover:text-emerald-700 transition-colors border border-transparent hover:border-gray-100">
                View Fees & Invoices <span className="text-gray-300">→</span>
              </Link>
              <Link href={`/students/${id}/documents`}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-purple-50 hover:text-purple-700 transition-colors border border-transparent hover:border-gray-100">
                View Documents <span className="text-gray-300">→</span>
              </Link>
              <Link href={`/students/${id}/attendance`}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-yellow-50 hover:text-yellow-700 transition-colors border border-transparent hover:border-gray-100">
                View Attendance <span className="text-gray-300">→</span>
              </Link>
              <a href={`http://localhost:4000/api/documents/id-card/${id}`} target="_blank" rel="noreferrer"
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-600 font-medium hover:bg-emerald-50 hover:text-emerald-700 transition-colors border border-transparent hover:border-gray-100">
                Print ID Card <span className="text-gray-300">→</span>
              </a>
            </div>
          </Card>

          <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Record info</p>
            <p className="text-xs text-gray-500">Added on {formatDate(s.created_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function PhotoUpload({ studentId, currentUrl, initials }: { studentId: string, currentUrl?: string, initials: string }) {
  const [preview, setPreview] = useState(currentUrl)
  const [uploading, setUploading] = useState(false)
  const qc = useQueryClient()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result as string
        const res = await studentsApi.uploadPhoto(studentId, {
          photo_base64: base64,
          file_name: file.name,
          mime_type: file.type,
        })
        setPreview(res.data.photo_url)
        qc.invalidateQueries({ queryKey: ['student', studentId] })
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
    <label className="relative cursor-pointer group flex-shrink-0">
      <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center overflow-hidden">
        {preview
          ? <img src={preview} alt="" className="w-16 h-16 object-cover rounded-2xl" />
          : <span className="text-2xl font-bold text-indigo-700">{initials}</span>
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

function Card({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-5">
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  )
}
