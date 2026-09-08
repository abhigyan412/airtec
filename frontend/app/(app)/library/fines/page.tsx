'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { IndianRupee, Loader2, Receipt, ShieldQuestion } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const FINE_TYPE_LABELS: Record<string, string> = { overdue: 'Overdue', lost: 'Lost', damage: 'Damaged' }
const STATUS_BADGE: Record<string, any> = { pending: 'warning', waived: 'secondary', billed: 'success' }

export default function LibraryFinesPage() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('library.manage_fines')
  const [waiverFor, setWaiverFor] = useState<any | null>(null)

  const { data: fines, isLoading } = useQuery({ queryKey: ['library-fines'], queryFn: () => libraryApi.fines.list().then(r => r.data) })

  const billMutation = useMutation({
    mutationFn: (id: string) => libraryApi.fines.bill(id),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['library-fines'] })
      toast.success(res.data.waived_amount > 0 ? `Billed — ₹${res.data.waived_amount} waived under RTE concession` : 'Fine billed to the fee ledger')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to bill fine'),
  })

  const requestWaiverMutation = useMutation({
    mutationFn: (id: string) => libraryApi.fines.requestWaiver(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-fines'] }); toast.success('Waiver request started') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to request waiver'),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fines"
        description="Overdue, lost and damaged-book charges — billed through the same fee ledger as every other charge."
        icon={IndianRupee}
        className="mb-0"
      />

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Book</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-56" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(fines ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No fines on record.</TableCell></TableRow>}
              {(fines ?? []).map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.library_members?.students ? `${f.library_members.students.first_name} ${f.library_members.students.last_name}` : 'Staff'}</TableCell>
                  <TableCell>{f.book_loans?.book_copies?.book_titles?.title ?? '—'}</TableCell>
                  <TableCell>{FINE_TYPE_LABELS[f.fine_type]}</TableCell>
                  <TableCell>₹{Number(f.amount).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[f.status]} className="capitalize">{f.status}</Badge></TableCell>
                  {canManage && (
                    <TableCell>
                      {f.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => billMutation.mutate(f.id)} disabled={billMutation.isPending}>
                            <Receipt className="h-3.5 w-3.5" /> Bill
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => requestWaiverMutation.mutate(f.id)} disabled={requestWaiverMutation.isPending}>
                            <ShieldQuestion className="h-3.5 w-3.5" /> Request Waiver
                          </Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setWaiverFor(f)}>Review</Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {waiverFor && <WaiverReviewDialog fine={waiverFor} onClose={() => setWaiverFor(null)} />}
    </div>
  )
}

function WaiverReviewDialog({ fine, onClose }: { fine: any; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['library-fine-workflow', fine.id],
    queryFn: () => libraryApi.fines.workflowStatus(fine.id).then(r => r.data),
  })

  const actMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => libraryApi.fines.workflowAction(fine.id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-fines'] })
      toast.success('Recorded')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record decision'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Waiver Request</DialogTitle>
          <DialogDescription>₹{Number(fine.amount).toLocaleString()} — {fine.fine_type}</DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : status?.current_step ? (
          <p className="text-sm text-muted-foreground">
            Waiting on: <span className="font-medium text-foreground">{status.current_step.roles?.name}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No waiver request has been started for this fine yet.</p>
        )}
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
