'use client'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardCheck, Loader2, ScanLine, CheckCircle2 } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function LibraryAuditPage() {
  const qc = useQueryClient()
  const [completeOpen, setCompleteOpen] = useState(false)

  const { data: audits, isLoading } = useQuery({ queryKey: ['library-audits'], queryFn: () => libraryApi.audit.list().then(r => r.data) })
  const openAudit = (audits ?? []).find((a: any) => a.status === 'in_progress')

  const startMutation = useMutation({
    mutationFn: () => libraryApi.audit.start(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-audits'] }); toast.success('Audit started') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to start audit'),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Verification"
        description="Periodic physical count against the register — scan every copy on the shelf; anything unscanned when you finish shows up as missing."
        icon={ClipboardCheck}
        className="mb-0"
      />

      {!isLoading && !openAudit && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground mb-4">No audit is currently in progress.</p>
          <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
            {startMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start New Audit
          </Button>
        </Card>
      )}

      {openAudit && <ActiveAuditCard auditId={openAudit.id} onComplete={() => setCompleteOpen(true)} />}

      <Card className="overflow-hidden">
        <div className="px-5 py-4"><p className="text-sm font-medium">Audit History</p></div>
        {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-24 w-full rounded-xl" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Completed</TableHead><TableHead>Status</TableHead><TableHead>Started By</TableHead></TableRow></TableHeader>
            <TableBody>
              {(audits ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No audits run yet.</TableCell></TableRow>}
              {(audits ?? []).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell>{new Date(a.started_at).toLocaleString()}</TableCell>
                  <TableCell>{a.completed_at ? new Date(a.completed_at).toLocaleString() : '—'}</TableCell>
                  <TableCell><Badge variant={a.status === 'completed' ? 'success' : 'warning'} className="capitalize">{a.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{a.users?.full_name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {openAudit && completeOpen && <CompleteAuditDialog auditId={openAudit.id} onClose={() => setCompleteOpen(false)} />}
    </div>
  )
}

function ActiveAuditCard({ auditId, onComplete }: { auditId: string; onComplete: () => void }) {
  const qc = useQueryClient()
  const [barcode, setBarcode] = useState('')
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: audit } = useQuery({ queryKey: ['library-audit', auditId], queryFn: () => libraryApi.audit.get(auditId).then(r => r.data), refetchInterval: 5000 })

  useEffect(() => { inputRef.current?.focus() }, [])

  const scanMutation = useMutation({
    mutationFn: (code: string) => libraryApi.audit.scan(auditId, code),
    onSuccess: (res: any) => {
      const title = res.data?.book_copies?.book_titles?.title ?? 'Copy'
      const note = res.data?.discrepancy_note
      setLog(l => [{ text: note ? `${title} — found, but ${note}` : `${title} — confirmed`, ok: !note }, ...l].slice(0, 20))
      qc.invalidateQueries({ queryKey: ['library-audit', auditId] })
    },
    onError: (e: any) => {
      setLog(l => [{ text: e?.response?.data?.error ?? 'Not found', ok: false }, ...l].slice(0, 20))
    },
    onSettled: () => { setBarcode(''); inputRef.current?.focus() },
  })

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-6 text-sm">
          <span><span className="font-semibold">{audit?.summary?.total ?? 0}</span> total</span>
          <span className="text-emerald-600"><span className="font-semibold">{audit?.summary?.found ?? 0}</span> found</span>
          <span className="text-muted-foreground"><span className="font-semibold">{audit?.summary?.pending ?? 0}</span> pending</span>
        </div>
        <Button variant="outline" size="sm" onClick={onComplete}><CheckCircle2 className="h-4 w-4" /> Complete Audit</Button>
      </div>
      <form onSubmit={e => { e.preventDefault(); if (barcode.trim()) scanMutation.mutate(barcode.trim()) }} className="flex gap-2">
        <ScanLine className="h-9 w-9 text-muted-foreground shrink-0" />
        <Input ref={inputRef} autoFocus placeholder="Scan or type barcode / accession no." value={barcode} onChange={e => setBarcode(e.target.value)} />
      </form>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {log.map((l, i) => (
          <div key={i} className={`text-sm rounded-md px-2 py-1 ${l.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>{l.text}</div>
        ))}
      </div>
    </Card>
  )
}

function CompleteAuditDialog({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [markLost, setMarkLost] = useState(false)
  const mutation = useMutation({
    mutationFn: () => libraryApi.audit.complete(auditId, markLost),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['library-audits'] })
      toast.success(`Audit completed — ${res.data.missing_count} copy(ies) unscanned`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to complete audit'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Complete Audit</DialogTitle>
          <DialogDescription>Every copy not scanned will be recorded as missing.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox id="mark-lost" checked={markLost} onCheckedChange={v => setMarkLost(!!v)} />
          <Label htmlFor="mark-lost" className="font-normal">Also mark those copies "lost" in the catalog</Label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
