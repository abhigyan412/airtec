'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShoppingCart, Loader2, Plus, Newspaper, PackageCheck, Truck } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const STATUS_BADGE: Record<string, any> = { pending: 'warning', approved: 'secondary', rejected: 'destructive', ordered: 'secondary', received: 'success' }

export default function LibraryAcquisitionPage() {
  const { can } = usePermissions()
  const canManage = can('library.manage_acquisition')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acquisition"
        description="New book purchase requests and periodical subscriptions."
        icon={ShoppingCart}
        className="mb-0"
      />
      <Tabs defaultValue="Requests">
        <TabsList>
          <TabsTrigger value="Requests">Purchase Requests</TabsTrigger>
          <TabsTrigger value="Periodicals">Periodicals</TabsTrigger>
        </TabsList>
        <TabsContent value="Requests" className="mt-6"><RequestsTab canManage={canManage} /></TabsContent>
        <TabsContent value="Periodicals" className="mt-6"><PeriodicalsTab canManage={canManage} /></TabsContent>
      </Tabs>
    </div>
  )
}

function RequestsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [reviewFor, setReviewFor] = useState<any | null>(null)
  const [receiveFor, setReceiveFor] = useState<any | null>(null)
  const [form, setForm] = useState({ title: '', author: '', reason: '', estimated_cost: '' })

  const { data: requests, isLoading } = useQuery({ queryKey: ['library-acquisition-requests'], queryFn: () => libraryApi.acquisitionRequests.list().then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.acquisitionRequests.create({
      title: form.title, author: form.author || undefined, reason: form.reason || undefined,
      estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-acquisition-requests'] })
      setAddOpen(false); setForm({ title: '', author: '', reason: '', estimated_cost: '' })
      toast.success('Request submitted for approval')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to submit request'),
  })

  const orderMutation = useMutation({
    mutationFn: (id: string) => libraryApi.acquisitionRequests.order(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-acquisition-requests'] }); toast.success('Marked as ordered') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to mark ordered'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">A purchase decision goes through Librarian review, then Principal approval — same tier as a vehicle purchase.</p>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Request a Book</Button>
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead><TableHead>Author</TableHead><TableHead>Est. Cost</TableHead><TableHead>Status</TableHead>
              {canManage && <TableHead className="w-56" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No requests yet.</TableCell></TableRow>}
            {(requests ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell className="text-muted-foreground">{r.author ?? '—'}</TableCell>
                <TableCell>{r.estimated_cost != null ? `₹${Number(r.estimated_cost).toLocaleString()}` : '—'}</TableCell>
                <TableCell><Badge variant={STATUS_BADGE[r.status]} className="capitalize">{r.status}</Badge></TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex gap-1">
                      {r.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => setReviewFor(r)}>Review</Button>}
                      {r.status === 'approved' && <Button size="sm" variant="outline" onClick={() => orderMutation.mutate(r.id)} disabled={orderMutation.isPending}><Truck className="h-3.5 w-3.5" /> Mark Ordered</Button>}
                      {r.status === 'ordered' && <Button size="sm" variant="outline" onClick={() => setReceiveFor(r)}><PackageCheck className="h-3.5 w-3.5" /> Mark Received</Button>}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request a Book</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Author (optional)</Label><Input value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Estimated cost (optional)</Label><Input type="number" value={form.estimated_cost} onChange={e => setForm(f => ({ ...f, estimated_cost: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Reason (optional)</Label><Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reviewFor && <RequestReviewDialog request={reviewFor} onClose={() => setReviewFor(null)} />}
      {receiveFor && <ReceiveDialog request={receiveFor} onClose={() => setReceiveFor(null)} />}
    </Card>
  )
}

function RequestReviewDialog({ request, onClose }: { request: any; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['library-acquisition-workflow', request.id],
    queryFn: () => libraryApi.acquisitionRequests.workflowStatus(request.id).then(r => r.data),
  })

  const actMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => libraryApi.acquisitionRequests.workflowAction(request.id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-acquisition-requests'] })
      toast.success('Recorded')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record decision'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          {request.reason && <DialogDescription>{request.reason}</DialogDescription>}
        </DialogHeader>
        {isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : status?.current_step ? (
          <p className="text-sm text-muted-foreground">
            Waiting on: <span className="font-medium text-foreground">{status.current_step.roles?.name}</span>
          </p>
        ) : <p className="text-sm text-muted-foreground">No approval step is pending.</p>}
        {status?.current_step && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => actMutation.mutate('rejected')} disabled={actMutation.isPending}>Reject</Button>
            <Button onClick={() => actMutation.mutate('approved')} disabled={actMutation.isPending}>
              {actMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Approve
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReceiveDialog({ request, onClose }: { request: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [cost, setCost] = useState(request.estimated_cost ? String(request.estimated_cost) : '')

  const mutation = useMutation({
    mutationFn: () => libraryApi.acquisitionRequests.receive(request.id, { cost: cost ? Number(cost) : undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-acquisition-requests'] })
      qc.invalidateQueries({ queryKey: ['library-titles'] })
      toast.success('Received — a new catalog copy was created')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to mark received'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark "{request.title}" Received</DialogTitle>
          <DialogDescription>Creates a new catalog copy, ready to be issued.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5"><Label>Actual cost (optional)</Label><Input type="number" value={cost} onChange={e => setCost(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const FREQUENCY_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' }

function PeriodicalsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [issuesFor, setIssuesFor] = useState<any | null>(null)
  const [form, setForm] = useState({ title: '', frequency: 'monthly', vendor: '' })

  const { data: periodicals, isLoading } = useQuery({ queryKey: ['library-periodicals'], queryFn: () => libraryApi.periodicals.list().then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.periodicals.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-periodicals'] })
      setAddOpen(false); setForm({ title: '', frequency: 'monthly', vendor: '' })
      toast.success('Periodical added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add periodical'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Newspaper and magazine subscriptions, with the issues expected under each.</p>
        {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Newspaper className="h-4 w-4" /> Add Periodical</Button>}
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Frequency</TableHead><TableHead>Vendor</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
          <TableBody>
            {(periodicals ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No periodicals yet.</TableCell></TableRow>}
            {(periodicals ?? []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.title}</TableCell>
                <TableCell>{FREQUENCY_LABELS[p.frequency]}</TableCell>
                <TableCell className="text-muted-foreground">{p.vendor ?? '—'}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setIssuesFor(p)}>Issues</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Periodical</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQUENCY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Vendor (optional)</Label><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {issuesFor && <IssuesDialog periodical={issuesFor} canManage={canManage} onClose={() => setIssuesFor(null)} />}
    </Card>
  )
}

function IssuesDialog({ periodical, canManage, onClose }: { periodical: any; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [issueDate, setIssueDate] = useState('')
  const { data: issues, isLoading } = useQuery({ queryKey: ['library-periodical-issues', periodical.id], queryFn: () => libraryApi.periodicals.issues(periodical.id).then(r => r.data) })

  const addMutation = useMutation({
    mutationFn: () => libraryApi.periodicals.addIssue(periodical.id, issueDate),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-periodical-issues', periodical.id] }); setIssueDate('') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to log issue'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'received' | 'missing' }) => libraryApi.periodicals.updateIssue(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library-periodical-issues', periodical.id] }),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{periodical.title} — Issues</DialogTitle></DialogHeader>
        {canManage && (
          <div className="flex gap-2">
            <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={!issueDate || addMutation.isPending}>Log Issue</Button>
          </div>
        )}
        {isLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : (
          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {(issues ?? []).length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No issues logged.</p>}
            {(issues ?? []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{i.issue_date}</span>
                {i.status === 'expected' && canManage ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: i.id, status: 'received' })}>Received</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateMutation.mutate({ id: i.id, status: 'missing' })}>Missing</Button>
                  </div>
                ) : <Badge variant={i.status === 'received' ? 'success' : i.status === 'missing' ? 'destructive' : 'secondary'} className="capitalize">{i.status}</Badge>}
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
