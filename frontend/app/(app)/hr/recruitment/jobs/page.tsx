'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ArrowLeft, Plus, Briefcase, Users, Loader2, Pause, Play, XCircle, QrCode, Copy, ExternalLink, Printer } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'warning'> = {
  open: 'success',
  closed: 'secondary',
  on_hold: 'warning',
}

export default function JobPostingsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['job-postings-all', statusFilter],
    queryFn: () => hrmsApi.jobPostings.list({ status: statusFilter || undefined }).then(r => r.data),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.jobPostings.update(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-postings-all'] })
      qc.invalidateQueries({ queryKey: ['job-postings'] })
      toast.success('Job posting updated')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/hr/recruitment" aria-label="Back to recruitment"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Job Postings"
          description="Manage open positions and vacancies"
          icon={Briefcase}
          actions={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Job Posting
            </Button>
          }
        />
      </div>

      {user?.school_id && <RecruitmentQrCard schoolId={user.school_id} />}

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {['', 'open', 'on_hold', 'closed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              statusFilter === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Jobs grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[232px] rounded-xl" />
          ))}
        </div>
      ) : (jobs ?? []).length === 0 ? (
        <Card>
          {statusFilter ? (
            <EmptyState
              icon={Briefcase}
              title={`No ${statusFilter.replace('_', ' ')} job postings`}
              description="Nothing matches this filter right now. Switch to All to see every posting."
              action={<Button variant="outline" onClick={() => setStatusFilter('')}>Show all</Button>}
            />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No job postings yet"
              description="Create your first posting so candidates can be tracked against a vacancy."
              action={
                <Button onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" /> New Job Posting
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(jobs ?? []).map((j: any) => (
            <Card key={j.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{j.title}</h3>
                  <Badge variant={STATUS_VARIANT[j.status] ?? 'secondary'} className="capitalize">{j.status.replace('_', ' ')}</Badge>
                </div>
                <div className="mb-3 space-y-1 text-sm text-muted-foreground">
                  {j.department && <p>{j.department}{j.designation ? ` · ${j.designation}` : ''}</p>}
                  {j.experience_required && <p className="text-xs">Experience: {j.experience_required}</p>}
                  {j.salary_range && <p className="text-xs">Salary: {j.salary_range}</p>}
                  <p className="text-xs capitalize">{j.employment_type?.replace('_', ' ')} · {j.vacancies} vacancy(ies)</p>
                </div>
                {j.description && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{j.description}</p>}

                <div className="flex items-center justify-between border-t border-border pt-3">
                  <Link href={`/hr/recruitment?job=${j.id}`} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80">
                    <Users className="h-3.5 w-3.5" /> {j.application_count} candidate(s)
                  </Link>
                  <div className="flex gap-1">
                    {j.status === 'open' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-warning" onClick={() => statusMutation.mutate({ id: j.id, status: 'on_hold' })} title="Put on hold" aria-label="Put on hold">
                        <Pause className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {j.status === 'on_hold' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-success" onClick={() => statusMutation.mutate({ id: j.id, status: 'open' })} title="Reopen" aria-label="Reopen">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {j.status !== 'closed' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => statusMutation.mutate({ id: j.id, status: 'closed' })} title="Close" aria-label="Close">
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateJobModal onClose={() => {
          setShowCreate(false)
          qc.invalidateQueries({ queryKey: ['job-postings-all'] })
          qc.invalidateQueries({ queryKey: ['job-postings'] })
        }} />
      )}
    </div>
  )
}

function CreateJobModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ title: '', department: '', designation: '', employment_type: 'full_time', description: '', requirements: '', experience_required: '', salary_range: '', vacancies: '1' })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.title) return toast.error('Title required')
    setLoading(true)
    try {
      await hrmsApi.jobPostings.create({ ...form, vacancies: Number(form.vacancies) || 1 })
      toast.success('Job posting created')
      onClose()
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed') } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Job Posting</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Job Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Mathematics Teacher" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Academics" />
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. PGT Mathematics" />
            </div>
            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Select value={form.employment_type} onValueChange={v => setForm(f => ({ ...f, employment_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vacancies</Label>
              <Input type="number" min="1" value={form.vacancies} onChange={e => setForm(f => ({ ...f, vacancies: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Experience Required</Label>
              <Input value={form.experience_required} onChange={e => setForm(f => ({ ...f, experience_required: e.target.value }))} placeholder="e.g. 2-5 years" />
            </div>
            <div className="space-y-1.5">
              <Label>Salary Range</Label>
              <Input value={form.salary_range} onChange={e => setForm(f => ({ ...f, salary_range: e.target.value }))} placeholder="e.g. 30k-45k" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} className="resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Requirements</Label>
            <Textarea rows={3} className="resize-none" value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} placeholder="Qualifications, skills required..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create Posting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// One QR per school, not per posting — the link never changes; whichever
// postings are currently 'open' is what actually decides what the public
// form's position dropdown offers. Same rendering approach as Admission's
// own QR card (cycles/page.tsx) — client-side from the plain URL via
// qrcode.react, no backend image generation.
function RecruitmentQrCard({ schoolId }: { schoolId: string }) {
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [printSize, setPrintSize] = useState<PrintSizeKey>('medium')
  const url = typeof window !== 'undefined' ? `${window.location.origin}/careers/${schoolId}` : ''
  const schoolName = user?.schools?.name ?? ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — copy it manually instead')
    }
  }

  return (
    <>
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><QrCode className="h-4 w-4" /> Careers QR &amp; Link</CardTitle>
        <CardDescription className="text-xs">
          Share this with candidates — scanning or opening it takes them straight to a public application form that lands right in your pipeline below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <div className="shrink-0 rounded-xl border border-border bg-white p-3">
          {url && <QRCodeSVG value={url} size={128} />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">{url}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyLink}>
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy Link'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Preview Form
              </a>
            </Button>
            <div className="ml-1 flex items-center gap-1.5 border-l border-border pl-3">
              <Select value={printSize} onValueChange={v => setPrintSize(v as PrintSizeKey)}>
                <SelectTrigger className="h-8 w-[168px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRINT_SIZES).map(([key, s]) => (
                    <SelectItem key={key} value={key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    {url && <QrPrintSheet url={url} schoolName={schoolName} size={printSize} />}
    </>
  )
}

// Same three physical sizes and print approach as Admission's QrPrintSheet
// (cycles/page.tsx) — duplicated rather than shared, since no generic QR
// component exists yet in this codebase and these two callers differ only
// in copy/URL, not structure.
const PRINT_SIZES = {
  small: { label: 'Small — sheet of stickers', mm: 40 },
  medium: { label: 'Medium — A5 flyer', mm: 80 },
  large: { label: 'Large — A4 poster', mm: 150 },
} as const
type PrintSizeKey = keyof typeof PRINT_SIZES

function QrPrintSheet({ url, schoolName, size }: { url: string; schoolName: string; size: PrintSizeKey }) {
  const qrPixelSize = 512

  if (size === 'small') {
    return (
      <div className="hidden print:block">
        <style>{`
          @media print {
            @page { size: A4 portrait; margin: 10mm; }
            body { background: #fff !important; }
            .qr-sticker-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; }
            .qr-sticker { background: #fff !important; border: 1px dashed #999; border-radius: 2mm; padding: 4mm; text-align: center; }
            .qr-sticker svg { width: 40mm; height: 40mm; }
            .qr-sticker p { font-size: 7pt; color: #000; margin-top: 2mm; }
          }
        `}</style>
        <div className="qr-sticker-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="qr-sticker">
              <QRCodeSVG value={url} size={qrPixelSize} />
              <p>{schoolName ? `${schoolName} — We're Hiring` : "We're Hiring"}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const cfg = size === 'large'
    ? { page: 'A4 portrait', qrMm: 130, heading: '18mm', sub: '10mm' }
    : { page: 'A5 portrait', qrMm: 70, heading: '14mm', sub: '8mm' }

  return (
    <div className="hidden print:block">
      <style>{`
        @media print {
          @page { size: ${cfg.page}; margin: 14mm; }
          body { background: #fff !important; }
          .qr-sheet { position: fixed; inset: 0; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
          .qr-sheet h1 { font-size: ${cfg.heading}; font-weight: 700; color: #000; margin-bottom: 6mm; }
          .qr-sheet svg { width: ${cfg.qrMm}mm; height: ${cfg.qrMm}mm; }
          .qr-sheet p { font-size: ${cfg.sub}; color: #333; margin-top: 6mm; }
          .qr-sheet .qr-link { font-size: 8pt; color: #666; margin-top: 3mm; word-break: break-all; }
        }
      `}</style>
      <div className="qr-sheet">
        <h1>{schoolName ? `${schoolName} — We're Hiring` : "We're Hiring"}</h1>
        <QRCodeSVG value={url} size={qrPixelSize} />
        <p>Scan to apply</p>
        <p className="qr-link">{url}</p>
      </div>
    </div>
  )
}
