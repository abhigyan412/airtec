'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { studentsApi, admissionApi, academicYearsApi, documentsApi } from '@/lib/api'
import { formatDate, formatCurrency, cn, STATUS_COLORS } from '@/lib/utils'
import { TransferCertificateCard } from '@/components/students/TransferCertificateCard'
import { ArrowLeft, User, BookOpen, Phone, CreditCard, FileText, Calendar, Droplets, MapPin, Mail, Hash, Camera, Loader2, ArrowRightLeft, X, History, Users } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card as UICard, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [showTransferModal, setShowTransferModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  const { data: promotions } = useQuery({
    queryKey: ['student-promotions', id],
    queryFn: () => studentsApi.promotions({ student_id: id }).then(r => r.data),
    enabled: !!id,
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={Users}
        title="Student not found"
        description="This student may have been removed, or the link is out of date."
        action={
          <Button asChild>
            <Link href="/students">Back to students</Link>
          </Button>
        }
      />
    )
  }

  const s = data
  const parent = s.parents?.[0]
  const initials = `${s.first_name?.[0] ?? ''}${s.last_name?.[0] ?? ''}`.toUpperCase()
  const subtitle = [
    s.classes?.name ? `${s.classes.name}${s.sections?.name ? ` · ${s.sections.name}` : ''}` : null,
    s.admission_number ? `#${s.admission_number}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0" aria-label="Back to students">
          <Link href="/students"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PhotoUpload studentId={id} currentUrl={s.photo_url} initials={initials} />
        <PageHeader
          className="mb-0 flex-1"
          title={`${s.first_name} ${s.last_name}`}
          description={subtitle || undefined}
          actions={
            <>
              <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[s.status])}>
                {s.status}
              </span>
              {s.houses && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                  {s.houses.name}
                </span>
              )}
              <Button asChild variant="outline" size="sm">
                <a href={documentsApi.idCard(id)} target="_blank" rel="noreferrer">ID Card</a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowTransferModal(true)}>
                <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/students/${id}/edit`}>Edit profile</Link>
              </Button>
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Personal Information" icon={User}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
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

          {(promotions ?? []).length > 0 && (
            <Card title="Promotion / Transfer History" icon={History}>
              <div className="space-y-3">
                {promotions.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-sm border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize bg-primary/10 text-primary flex-shrink-0">
                        {p.promotion_type}
                      </span>
                      <span className="text-muted-foreground truncate">
                        {p.from_class?.name ?? '—'}{p.from_section?.name ? ` · ${p.from_section.name}` : ''}
                        {' → '}
                        {p.to_class?.name ?? '—'}{p.to_section?.name ? ` · ${p.to_section.name}` : ''}
                        {p.to_year?.name && ` (${p.to_year.name})`}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0 ml-3">{formatDate(p.created_at)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {parent && (
            <Card title="Parent / Guardian" icon={Phone}>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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
              <QuickAction href={`/students/${id}/documents`} label="View Documents" />
              <QuickAction href={`/students/${id}/attendance`} label="View Attendance" />
              <QuickAction href={`/students/${id}/performance`} label="View Performance" />
              <QuickAction href={documentsApi.idCard(id)} label="Print ID Card" external />
            </div>
          </Card>

          <div className="bg-muted rounded-2xl p-4 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Record info</p>
            <p className="text-xs text-muted-foreground">Added on {formatDate(s.created_at)}</p>
          </div>
        </div>
      </div>

      {showTransferModal && (
        <TransferModal
          student={s}
          onClose={() => setShowTransferModal(false)}
          onDone={() => {
            setShowTransferModal(false)
            qc.invalidateQueries({ queryKey: ['student', id] })
            qc.invalidateQueries({ queryKey: ['student-promotions', id] })
          }}
        />
      )}
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

function TransferModal({ student, onClose, onDone }: { student: any; onClose: () => void; onDone: () => void }) {
  const [toClass, setToClass] = useState(student.class_id ?? '')
  const [toSection, setToSection] = useState(student.section_id ?? '')
  const [toAcademicYear, setToAcademicYear] = useState(student.academic_year_id ?? '')
  const [promotionType, setPromotionType] = useState('transferred')
  const [notes, setNotes] = useState('')

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  const { data: academicYears } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const toClassObj = (classesData ?? []).find((c: any) => c.id === toClass)
  const toSections = toClassObj?.sections ?? []

  const transferMutation = useMutation({
    mutationFn: () => studentsApi.bulkPromote({
      student_ids: [student.id],
      to_class_id: toClass,
      to_section_id: toSection || undefined,
      to_academic_year_id: toAcademicYear,
      promotion_type: promotionType,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Student transferred')
      onDone()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to transfer'),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer — {student.first_name} {student.last_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Class *</Label>
              <Select value={toClass} onValueChange={(v) => { setToClass(v); setToSection('') }}>
                <SelectTrigger><SelectValue placeholder="Select class..." /></SelectTrigger>
                <SelectContent>
                  {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Section</Label>
              <Select value={toSection || 'none'} onValueChange={(v) => setToSection(v === 'none' ? '' : v)} disabled={!toClass}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {toSections.map((sec: any) => <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Academic Year *</Label>
              <Select value={toAcademicYear} onValueChange={setToAcademicYear}>
                <SelectTrigger><SelectValue placeholder="Select year..." /></SelectTrigger>
                <SelectContent>
                  {(academicYears ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={promotionType} onValueChange={setPromotionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROMOTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-notes">Notes (optional)</Label>
            <Input id="transfer-notes" type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for transfer..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending || !toClass || !toAcademicYear}>
            {transferMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PROMOTION_TYPES = [
  { value: 'transferred', label: 'Transferred' },
  { value: 'promoted', label: 'Promoted' },
  { value: 'detained', label: 'Detained' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

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
