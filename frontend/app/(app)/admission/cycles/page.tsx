'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionApi, academicYearsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate } from '@/lib/utils'
import { Plus, Trash2, Loader2, ShieldOff, CalendarClock, QrCode, Copy, ExternalLink, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

export default function AdmissionCyclesPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const qc = useQueryClient()

  const [showAdd, setShowAdd] = useState(false)
  const [academicYearId, setAcademicYearId] = useState('')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [notes, setNotes] = useState('')

  const { data: years } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })

  const { data: cycles, isLoading } = useQuery({
    queryKey: ['admission-cycles'],
    queryFn: () => admissionApi.cycles.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => admissionApi.cycles.create({
      academic_year_id: academicYearId,
      opens_at: opensAt || undefined,
      closes_at: closesAt || undefined,
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-cycles'] })
      setAcademicYearId(''); setOpensAt(''); setClosesAt(''); setNotes(''); setShowAdd(false)
      toast.success('Admission cycle saved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save cycle'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => admissionApi.cycles.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admission-cycles'] })
      toast.success('Cycle removed — admission is unrestricted for that year again')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove cycle'),
  })

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only School Admin or Principal can manage admission cycles."
        className="h-64"
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* print:hidden on this page's own chrome (matching the Timetable
          module's convention — see timetable/block/page.tsx) — without it,
          this stacks above AdmissionQrCard's printable sheet instead of
          being replaced by it. AdmissionQrCard is rendered outside this
          wrapper and manages its own screen/print split internally, since
          its printable sheet needs to survive being hidden here. The
          admission tab bar (admission/layout.tsx) needed the same fix. */}
      <div className="space-y-6 print:hidden">
        <PageHeader
          title="Admission Cycles"
          description="Open/close admission per academic year. A year with no cycle configured here stays open all year."
          icon={CalendarClock}
          className="mb-0"
        />
      </div>

      <AdmissionQrCard schoolId={user!.school_id} />

      <div className="space-y-6 print:hidden">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Cycles</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAdd(v => !v)}>
              <Plus className="h-3.5 w-3.5" /> Add Cycle
            </Button>
          </div>
          <CardDescription className="text-xs">One cycle per academic year — saving again for the same year replaces it.</CardDescription>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3">
              <div className="min-w-[180px] space-y-1">
                <Label className="text-xs">Academic Year</Label>
                <Select value={academicYearId} onValueChange={setAcademicYearId}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {(years ?? []).map((y: any) => (
                      <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-opens" className="text-xs">Opens</Label>
                <Input id="cycle-opens" type="date" value={opensAt} onChange={e => setOpensAt(e.target.value)} className="w-auto" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cycle-closes" className="text-xs">Closes</Label>
                <Input id="cycle-closes" type="date" value={closesAt} onChange={e => setClosesAt(e.target.value)} className="w-auto" />
              </div>
              <div className="min-w-[180px] flex-1 space-y-1">
                <Label htmlFor="cycle-notes" className="text-xs">Notes</Label>
                <Textarea id="cycle-notes" rows={1} className="resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
              </div>
              <Button
                onClick={() => {
                  if (!academicYearId) return toast.error('Select an academic year')
                  createMutation.mutate()
                }}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : !(cycles ?? []).length ? (
            <EmptyState
              icon={CalendarClock}
              title="No cycles configured"
              description="Every academic year is currently open for admission. Add a cycle to restrict one."
              action={<Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add Cycle</Button>}
              className="py-10"
            />
          ) : (
            <div className="divide-y divide-border">
              {(cycles ?? []).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.academic_years?.name ?? 'Unknown year'}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.opens_at ? formatDate(c.opens_at) : 'No open date'} — {c.closes_at ? formatDate(c.closes_at) : 'No close date'}
                      {c.notes && <> · {c.notes}</>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(c.id)}
                    aria-label={`Remove cycle for ${c.academic_years?.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}

// One QR per school, not per cycle — the link never changes; whichever
// academic year's cycle is currently open (or not configured, meaning
// unrestricted) is what actually decides whether the public form accepts
// a submission. Rendered client-side from the plain URL via qrcode.react —
// no backend image generation, matching the original design intent ("QR
// is just that URL rendered as an image, no separate subsystem").
function AdmissionQrCard({ schoolId }: { schoolId: string }) {
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [printSize, setPrintSize] = useState<PrintSizeKey>('medium')
  const url = typeof window !== 'undefined' ? `${window.location.origin}/apply/${schoolId}` : ''
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
    {/* print:hidden here, not on the printable sheet below — this card
        needs to disappear when printing and be replaced by the sheet, the
        same on/off pair every other pairing in this file uses. */}
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><QrCode className="h-4 w-4" /> Admission QR &amp; Link</CardTitle>
        <CardDescription className="text-xs">
          Share this with prospective parents — scanning or opening it takes them straight to a public enquiry form. Whether it accepts submissions right now depends on the cycles below.
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

// Three physical sizes covering how schools actually put a QR up — a sheet
// of small stickers to hand out or paste around campus, a single A5 flyer
// for the front desk/notice board, and a full A4 poster for a standee at
// an event. Rendered client-side same as the on-screen QR (no backend
// image generation) — only what's printed differs, via the same
// `hidden print:block` + `@media print` convention already established for
// the Timetable module's print sheets (see block/PrintSheets.tsx).
const PRINT_SIZES = {
  small: { label: 'Small — sheet of stickers', mm: 40 },
  medium: { label: 'Medium — A5 flyer', mm: 80 },
  large: { label: 'Large — A4 poster', mm: 150 },
} as const
type PrintSizeKey = keyof typeof PRINT_SIZES

function QrPrintSheet({ url, schoolName, size }: { url: string; schoolName: string; size: PrintSizeKey }) {
  const qrPixelSize = 512 // rendered once at high resolution; physical size on paper is set purely by CSS mm below, losslessly since it's an SVG

  if (size === 'small') {
    // A grid of identical stickers filling one A4 sheet, each cuttable —
    // handing out one QR per parent visit or pasting several around
    // campus is the point, not a single large copy.
    return (
      <div className="hidden print:block">
        <style>{`
          @media print {
            @page { size: A4 portrait; margin: 10mm; }
            body { background: #fff !important; }
            .qr-sticker-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; }
            /* Explicit white on the sticker itself, not just the body
               selector above — this grid sits inside the app shell's own
               colored background div (only its Sidebar/Header children are
               print:hidden, not the root div itself), which paints through
               a body-only override otherwise. */
            .qr-sticker { background: #fff !important; border: 1px dashed #999; border-radius: 2mm; padding: 4mm; text-align: center; }
            .qr-sticker svg { width: 40mm; height: 40mm; }
            .qr-sticker p { font-size: 7pt; color: #000; margin-top: 2mm; }
          }
        `}</style>
        <div className="qr-sticker-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="qr-sticker">
              <QRCodeSVG value={url} size={qrPixelSize} />
              <p>{schoolName || 'Scan to Apply'}</p>
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
          /* position:fixed rather than height:100% — the latter needs an
             unbroken chain of resolved heights from html down through
             every Next.js wrapper div to this element, which isn't
             guaranteed; fixed positioning centers on the page box
             regardless of ancestor heights. */
          .qr-sheet { position: fixed; inset: 0; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
          .qr-sheet h1 { font-size: ${cfg.heading}; font-weight: 700; color: #000; margin-bottom: 6mm; }
          .qr-sheet svg { width: ${cfg.qrMm}mm; height: ${cfg.qrMm}mm; }
          .qr-sheet p { font-size: ${cfg.sub}; color: #333; margin-top: 6mm; }
          .qr-sheet .qr-link { font-size: 8pt; color: #666; margin-top: 3mm; word-break: break-all; }
        }
      `}</style>
      <div className="qr-sheet">
        <h1>{schoolName ? `${schoolName} — Admissions` : 'Admissions'}</h1>
        <QRCodeSVG value={url} size={qrPixelSize} />
        <p>Scan to apply</p>
        <p className="qr-link">{url}</p>
      </div>
    </div>
  )
}
