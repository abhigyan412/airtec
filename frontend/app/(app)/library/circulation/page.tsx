'use client'
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ScanLine, Loader2, X, CalendarClock, Plus, RotateCcw } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { StudentSearch, StudentLite } from '@/components/shared/StudentSearch'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function LibraryCirculationPage() {
  const { can } = usePermissions()
  const canCirculate = can('library.circulation')
  const [recallOpen, setRecallOpen] = useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Circulation"
        description="Issue, return and renew books — scan a member once, then scan books one after another."
        icon={ScanLine}
        className="mb-0"
        actions={canCirculate && (
          <Button variant="outline" size="sm" onClick={() => setRecallOpen(true)}><RotateCcw className="h-4 w-4" /> Recall All</Button>
        )}
      />
      {recallOpen && <RecallDialog onClose={() => setRecallOpen(false)} />}
      <Tabs defaultValue="Scan Desk">
        <TabsList>
          <TabsTrigger value="Scan Desk">Scan Desk</TabsTrigger>
          <TabsTrigger value="Active Loans">Active Loans</TabsTrigger>
          <TabsTrigger value="Reservations">Reservations</TabsTrigger>
        </TabsList>
        <TabsContent value="Scan Desk" className="mt-6 space-y-6">
          <TodaysPeriodsCard />
          <ScanDeskCard canCirculate={canCirculate} />
        </TabsContent>
        <TabsContent value="Active Loans" className="mt-6">
          <ActiveLoansTab canCirculate={canCirculate} />
        </TabsContent>
        <TabsContent value="Reservations" className="mt-6">
          <ReservationsTab canCirculate={canCirculate} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TodaysPeriodsCard() {
  const { data, isLoading } = useQuery({ queryKey: ['library-today'], queryFn: () => libraryApi.circulation.today().then(r => r.data) })
  if (isLoading) return <Skeleton className="h-16 w-full rounded-xl" />
  if (!data?.length) return null

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Today's Library Periods</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.map((p: any) => (
          <Badge key={p.id} variant="secondary">
            {p.classes?.name}{p.sections?.name ? `-${p.sections.name}` : ''} · {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
          </Badge>
        ))}
      </div>
    </Card>
  )
}

function ScanDeskCard({ canCirculate }: { canCirculate: boolean }) {
  const qc = useQueryClient()
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [barcode, setBarcode] = useState('')
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: memberInfo } = useQuery({
    queryKey: ['library-member', memberId],
    queryFn: () => libraryApi.circulation.getMember(memberId!).then(r => r.data),
    enabled: !!memberId,
  })

  const ensureMemberMutation = useMutation({
    mutationFn: (s: StudentLite) => libraryApi.circulation.ensureMember({ student_id: s.id }),
    onSuccess: (res: any) => { setMemberId(res.data.id); setTimeout(() => inputRef.current?.focus(), 50) },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to look up this student'),
  })

  const scanMutation = useMutation({
    mutationFn: (code: string) => libraryApi.circulation.scan(memberId!, code),
    onSuccess: (res: any) => {
      const d = res.data
      const text = d.action === 'issued' ? `Issued "${d.copy?.title}" — due ${d.due_date}` : `Returned "${d.copy?.title}"${d.reservation_notified ? ' (reserved for next in queue)' : ''}`
      setLog(l => [{ text, ok: true }, ...l].slice(0, 20))
      setBarcode('')
      qc.invalidateQueries({ queryKey: ['library-member', memberId] })
      qc.invalidateQueries({ queryKey: ['library-loans'] })
    },
    onError: (e: any) => {
      setLog(l => [{ text: e?.response?.data?.error ?? 'Scan failed', ok: false }, ...l].slice(0, 20))
      setBarcode('')
    },
    onSettled: () => setTimeout(() => inputRef.current?.focus(), 50),
  })

  const handleStudentSelect = (s: StudentLite | null) => {
    setStudent(s)
    setLog([])
    if (s) ensureMemberMutation.mutate(s)
    else setMemberId(null)
  }

  const submitScan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!barcode.trim() || !memberId) return
    scanMutation.mutate(barcode.trim())
  }

  if (!canCirculate) return null

  return (
    <Card className="p-6 space-y-4">
      <div className="space-y-1.5">
        <Label>Member</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1"><StudentSearch value={student} onSelect={handleStudentSelect} /></div>
          {student && <Button variant="ghost" size="icon" onClick={() => handleStudentSelect(null)}><X className="h-4 w-4" /></Button>}
        </div>
      </div>

      {ensureMemberMutation.isPending && <Skeleton className="h-10 w-full rounded-xl" />}

      {memberId && memberInfo && (
        <>
          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
            <span>{memberInfo.students ? `${memberInfo.students.first_name} ${memberInfo.students.last_name}` : 'Member'}</span>
            <Badge variant="secondary">{memberInfo.active_loans.length} book(s) out</Badge>
          </div>

          <form onSubmit={submitScan} className="space-y-1.5">
            <Label htmlFor="scan-barcode">Scan or type accession no. / barcode</Label>
            <Input ref={inputRef} id="scan-barcode" autoFocus value={barcode} onChange={e => setBarcode(e.target.value)}
              placeholder="ACC-000123" disabled={scanMutation.isPending} />
          </form>

          {log.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {log.map((entry, i) => (
                <div key={i} className={`rounded-lg px-3 py-1.5 text-sm ${entry.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {entry.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

const STATUS_BADGE: Record<string, any> = { active: 'secondary', overdue: 'destructive' }

function ActiveLoansTab({ canCirculate }: { canCirculate: boolean }) {
  const qc = useQueryClient()
  const [lostFor, setLostFor] = useState<any | null>(null)
  const { data: loans, isLoading } = useQuery({ queryKey: ['library-loans'], queryFn: () => libraryApi.circulation.loans().then(r => r.data) })

  const returnMutation = useMutation({
    mutationFn: (id: string) => libraryApi.circulation.returnLoan(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-loans'] }); toast.success('Book returned') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to return'),
  })
  const renewMutation = useMutation({
    mutationFn: (id: string) => libraryApi.circulation.renewLoan(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-loans'] }); toast.success('Loan renewed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to renew'),
  })

  return (
    <Card className="overflow-hidden">
      {isLoading ? <div className="p-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Accession</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              {canCirculate && <TableHead className="w-40" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(loans ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No active loans.</TableCell></TableRow>}
            {(loans ?? []).map((l: any) => {
              const overdue = l.status === 'overdue' || (daysUntil(l.due_date) < 0)
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.library_members?.students ? `${l.library_members.students.first_name} ${l.library_members.students.last_name}` : 'Staff'}</TableCell>
                  <TableCell>{l.book_copies?.book_titles?.title}</TableCell>
                  <TableCell>{l.book_copies?.accession_no}</TableCell>
                  <TableCell>{l.due_date}</TableCell>
                  <TableCell><Badge variant={overdue ? 'destructive' : 'secondary'}>{overdue ? 'Overdue' : 'Active'}</Badge></TableCell>
                  {canCirculate && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => returnMutation.mutate(l.id)} disabled={returnMutation.isPending}>Return</Button>
                        <Button size="sm" variant="ghost" onClick={() => renewMutation.mutate(l.id)} disabled={renewMutation.isPending}>Renew</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setLostFor(l)}>Lost/Damaged</Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {lostFor && <ReportLostDialog loan={lostFor} onClose={() => setLostFor(null)} />}
    </Card>
  )
}

function ReportLostDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [fineType, setFineType] = useState<'lost' | 'damage'>('lost')
  const [pct, setPct] = useState('100')

  const mutation = useMutation({
    mutationFn: () => libraryApi.fines.create({ loan_id: loan.id, fine_type: fineType, calc_basis: 'pct_of_cost', pct: Number(pct) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-loans'] })
      toast.success(`Reported ${fineType} — a fine was logged`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to report'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Report Lost or Damaged</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>What happened?</Label>
            <Select value={fineType} onValueChange={v => setFineType(v as 'lost' | 'damage')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="lost">Lost</SelectItem><SelectItem value="damage">Damaged</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Charge (% of the book's recorded cost)</Label>
            <Input type="number" min={0} max={200} value={pct} onChange={e => setPct(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReservationsTab({ canCirculate }: { canCirculate: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [titleId, setTitleId] = useState('')

  const { data: reservations, isLoading } = useQuery({ queryKey: ['library-reservations'], queryFn: () => libraryApi.circulation.reservations().then(r => r.data) })
  const { data: titles } = useQuery({ queryKey: ['library-titles'], queryFn: () => libraryApi.titles.list().then(r => r.data) })

  const reserveMutation = useMutation({
    mutationFn: async () => {
      const memberRes = await libraryApi.circulation.ensureMember({ student_id: student!.id })
      return libraryApi.circulation.reserve(titleId, memberRes.data.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-reservations'] })
      setAddOpen(false); setStudent(null); setTitleId('')
      toast.success('Reservation added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to reserve'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => libraryApi.circulation.cancelReservation(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-reservations'] }); toast.success('Reservation cancelled') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to cancel'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Members waiting for a title with no copies currently available.</p>
        {canCirculate && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New Reservation</Button>}
      </div>
      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Member</TableHead><TableHead>Queue #</TableHead><TableHead>Status</TableHead>{canCirculate && <TableHead className="w-10" />}</TableRow></TableHeader>
          <TableBody>
            {(reservations ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No reservations.</TableCell></TableRow>}
            {(reservations ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.book_titles?.title}</TableCell>
                <TableCell>{r.library_members?.students ? `${r.library_members.students.first_name} ${r.library_members.students.last_name}` : 'Staff'}</TableCell>
                <TableCell>{r.queue_position}</TableCell>
                <TableCell><Badge variant={r.status === 'ready' ? 'success' : 'warning'}>{r.status === 'ready' ? 'Ready for pickup' : 'Waiting'}</Badge></TableCell>
                {canCirculate && (
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => cancelMutation.mutate(r.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Reservation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Student</Label><StudentSearch value={student} onSelect={setStudent} /></div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Select value={titleId || undefined} onValueChange={setTitleId}>
                <SelectTrigger><SelectValue placeholder="Choose a title" /></SelectTrigger>
                <SelectContent>{(titles ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={reserveMutation.isPending}>Cancel</Button>
            <Button onClick={() => reserveMutation.mutate()} disabled={!student || !titleId || reserveMutation.isPending}>
              {reserveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reserve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function RecallDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const { data: suggestion } = useQuery({ queryKey: ['library-recall-suggestion'], queryFn: () => libraryApi.recall.suggestion().then(r => r.data) })

  const mutation = useMutation({
    mutationFn: () => libraryApi.recall.run({ new_due_date: dueDate, reason: reason || undefined }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['library-loans'] })
      toast.success(`${res.data.recalled_count} loan(s) recalled — due dates shortened and borrowers notified`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to recall loans'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Recall All Active Loans</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {suggestion && (
            <p className="text-xs text-muted-foreground">
              Suggestion: "{suggestion.name}" starts {suggestion.start_date} — consider recalling shortly before then.
            </p>
          )}
          <div className="space-y-1.5"><Label>New due date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Reason (optional, shown to borrowers)</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Annual exams" /></div>
          <p className="text-xs text-muted-foreground">Only loans currently due after this date are affected — everything else is left alone.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!dueDate || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Recall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
