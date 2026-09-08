'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookMarked, Loader2, Plus, Users } from 'lucide-react'
import { libraryApi, academicYearsApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { StudentSearch, StudentLite } from '@/components/shared/StudentSearch'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SCHEME_LABELS: Record<string, string> = { rte: 'RTE', state_free_textbook: 'State Free Textbook', other: 'Other' }

export default function LibraryTextbooksPage() {
  const { can } = usePermissions()
  const canManage = can('library.circulation')
  const [addOpen, setAddOpen] = useState(false)

  const { data: distributions, isLoading } = useQuery({ queryKey: ['library-textbook-distributions'], queryFn: () => libraryApi.textbooks.list().then(r => r.data) })
  const { data: years } = useQuery({ queryKey: ['academic-years'], queryFn: () => academicYearsApi.list().then(r => r.data) })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Textbook Distribution"
        description="RTE and state-scheme free textbooks — a compliance record, not a loan. These books are given, never expected back."
        icon={BookMarked}
        className="mb-0"
      />
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-sm text-muted-foreground">Every free-textbook handout on record, for audit purposes.</p>
          {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Record Distribution</Button>}
        </div>
        {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Book</TableHead><TableHead>Qty</TableHead><TableHead>Scheme</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {(distributions ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No distributions recorded yet.</TableCell></TableRow>}
              {(distributions ?? []).map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.students ? `${d.students.first_name} ${d.students.last_name}` : '—'}</TableCell>
                  <TableCell>{d.book_name}</TableCell>
                  <TableCell>{d.quantity}</TableCell>
                  <TableCell><Badge variant="secondary">{SCHEME_LABELS[d.scheme]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(d.distributed_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {addOpen && <DistributeDialog years={years ?? []} onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function DistributeDialog({ years, onClose }: { years: any[]; onClose: () => void }) {
  const qc = useQueryClient()
  const currentYear = useMemo(() => years.find(y => y.is_current) ?? years[0], [years])
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [form, setForm] = useState({ book_name: '', quantity: '1', scheme: 'rte', academic_year_id: currentYear?.id ?? '' })

  const mutation = useMutation({
    mutationFn: () => libraryApi.textbooks.create({
      student_id: student!.id, academic_year_id: form.academic_year_id, book_name: form.book_name,
      quantity: Number(form.quantity), scheme: form.scheme,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-textbook-distributions'] })
      toast.success('Distribution recorded')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to record distribution'),
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record Textbook Distribution</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Student</Label><StudentSearch value={student} onSelect={setStudent} /></div>
          <div className="space-y-1.5"><Label>Book name</Label><Input value={form.book_name} onChange={e => setForm(f => ({ ...f, book_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Scheme</Label>
              <Select value={form.scheme} onValueChange={v => setForm(f => ({ ...f, scheme: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SCHEME_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {years.length > 1 && (
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <Select value={form.academic_year_id} onValueChange={v => setForm(f => ({ ...f, academic_year_id: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!student || !form.book_name.trim() || !form.academic_year_id || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
