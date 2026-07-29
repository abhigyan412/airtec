'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi, documentsApi } from '@/lib/api'
import { formatDate, formatCurrency, cn, STATUS_COLORS } from '@/lib/utils'
import { TransferCertificateCard } from '@/components/students/TransferCertificateCard'
import { ArrowLeft, User, BookOpen, Phone, CreditCard, FileText, Calendar, Droplets, MapPin, Mail, Hash, Camera, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card as UICard, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="font-medium text-foreground">Student not found</p>
        <Link href="/students" className="text-primary text-sm mt-2 hover:underline">Back to students</Link>
      </div>
    )
  }

  const s = data
  const parent = s.parents?.[0]
  const initials = `${s.first_name?.[0] ?? ''}${s.last_name?.[0] ?? ''}`.toUpperCase()

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-4">
        <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0" aria-label="Back to students">
          <Link href="/students"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <PhotoUpload studentId={id} currentUrl={s.photo_url} initials={initials} />
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{s.first_name} {s.last_name}</h1>
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[s.status])}>
                  {s.status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1">
                {s.admission_number && (
                  <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                    #{s.admission_number}
                  </span>
                )}
                {s.classes?.name && (
                  <span className="text-sm text-muted-foreground">
                    {s.classes.name}{s.sections?.name ? ` · ${s.sections.name}` : ''}
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
          <Button asChild variant="outline" size="sm">
            <a href={documentsApi.idCard(id)} target="_blank" rel="noreferrer">ID Card</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/students/${id}/edit`}>Edit profile</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <Card title="Personal Information" icon={User}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <Detail label="Class" value={s.classes?.name ?? '—'} />
              <Detail label="Section" value={s.sections?.name ?? '—'} />
              <Detail label="Roll Number" value={s.roll_number ?? '—'} />
              <Detail label="Stream" value={s.stream ?? '—'} />
              <Detail label="Academic Year" value={s.academic_years?.name ?? '—'} />
              <Detail label="House" value={s.houses?.name ?? '—'} />
            </div>
            {(s.is_school_captain || s.is_house_captain) && (
              <>
                <Separator className="mt-4" />
                <div className="mt-4 flex gap-2 flex-wrap">
                  {s.is_school_captain && <Badge variant="warning">School Captain</Badge>}
                  {s.is_house_captain && <Badge className="border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">House Captain</Badge>}
                </div>
              </>
            )}
          </Card>

          {parent && (
            <Card title="Parent / Guardian" icon={Phone}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {parent.father_name && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Father</p>
                    <Detail label="Name" value={parent.father_name} />
                    <Detail label="Phone" value={parent.father_phone ?? '—'} />
                    <Detail label="Email" value={parent.father_email ?? '—'} />
                  </div>
                )}
                {parent.mother_name && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mother</p>
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
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Total Billed</span>
                <span className="text-sm font-semibold text-foreground">{formatCurrency(s.fee_summary?.total_billed ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Collected</span>
                <span className="text-sm font-semibold text-success">{formatCurrency(s.fee_summary?.total_paid ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Due</span>
                <span className="text-sm font-bold text-destructive">{formatCurrency(s.fee_summary?.total_due ?? 0)}</span>
              </div>
            </div>
          </Card>

          <Card title="Quick Actions" icon={FileText}>
            <div className="space-y-2">
              <QuickAction href={`/students/${id}/fees`} label="View Fees & Invoices" />
              <QuickAction href={`/students/${id}/documents`} label="View Documents" />
              <QuickAction href={`/students/${id}/attendance`} label="View Attendance" />
              <QuickAction href={documentsApi.idCard(id)} label="Print ID Card" external />
            </div>
          </Card>

          <div className="bg-muted rounded-2xl p-4 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Record info</p>
            <p className="text-xs text-muted-foreground">Added on {formatDate(s.created_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickAction({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const className = 'flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-muted-foreground font-medium hover:bg-muted hover:text-foreground transition-colors border border-transparent hover:border-border'
  const inner = <>{label} <span className="text-muted-foreground/50">→</span></>
  if (external) {
    return <a href={href} target="_blank" rel="noreferrer" className={className}>{inner}</a>
  }
  return <Link href={href} className={className}>{inner}</Link>
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

function Card({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <UICard className="rounded-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </UICard>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}
