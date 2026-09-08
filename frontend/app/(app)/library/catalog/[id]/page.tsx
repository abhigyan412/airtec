'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const STATUS_BADGE: Record<string, any> = {
  available: 'success', issued: 'info', reserved: 'warning',
  lost: 'destructive', withdrawn: 'secondary', under_repair: 'secondary',
}
const SOURCE_LABELS: Record<string, string> = { purchased: 'Purchased', donated: 'Donated', book_bank: 'Book Bank' }

export default function TitleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('library.manage_catalog')

  const { data: title, isLoading } = useQuery({
    queryKey: ['library-title', id],
    queryFn: () => libraryApi.titles.get(id).then(r => r.data),
  })

  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ accession_no: '', shelf_location: '', condition: 'good', cost: '' })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['library-title', id] }); qc.invalidateQueries({ queryKey: ['library-titles'] }) }

  const addCopyMutation = useMutation({
    mutationFn: () => libraryApi.titles.addCopy(id, { ...form, cost: form.cost ? Number(form.cost) : null, accession_no: form.accession_no || undefined }),
    onSuccess: () => {
      invalidate()
      setAddOpen(false)
      setForm({ accession_no: '', shelf_location: '', condition: 'good', cost: '' })
      toast.success('Copy added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add copy'),
  })

  const deleteCopyMutation = useMutation({
    mutationFn: () => libraryApi.copies.delete(deleteId!),
    onSuccess: () => { invalidate(); setDeleteId(null); toast.success('Copy removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove copy'),
  })

  const conditionMutation = useMutation({
    mutationFn: ({ copyId, condition }: { copyId: string; condition: string }) => libraryApi.copies.update(copyId, { condition }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update condition'),
  })

  if (isLoading || !title) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/library/catalog" aria-label="Back to catalog"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title={title.title}
          description={[
            (title.authors ?? []).join(', '),
            title.publisher,
            title.isbn ? `ISBN ${title.isbn}` : null,
          ].filter(Boolean).join(' · ') || 'No author/publisher recorded'}
        />
      </div>

      {!title.is_circulating && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2 text-sm text-warning">
          This title is room-only — its copies can't be issued for home use (Reference/periodical convention).
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Copies ({title.copies.length})</h3>
          {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Copy</Button>}
        </div>

        {title.copies.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No copies added yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Accession No.</TableHead>
                <TableHead>Shelf</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                {canManage && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {title.copies.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.accession_no}</TableCell>
                  <TableCell>{c.shelf_location ?? '—'}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select value={c.condition} onValueChange={v => conditionMutation.mutate({ copyId: c.id, condition: v })}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['new', 'good', 'worn', 'damaged', 'lost'].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <span className="capitalize">{c.condition}</span>}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[c.status]} className="capitalize">{c.status.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>{SOURCE_LABELS[c.source] ?? c.source}</TableCell>
                  {canManage && (
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Copy</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Accession number (optional — auto-generated if left blank)</Label>
              <Input value={form.accession_no} onChange={e => setForm(f => ({ ...f, accession_no: e.target.value }))} placeholder="ACC-000123" />
            </div>
            <div className="space-y-1.5"><Label>Shelf location</Label><Input value={form.shelf_location} onChange={e => setForm(f => ({ ...f, shelf_location: e.target.value }))} placeholder="e.g. Rack B-3" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['new', 'good', 'worn', 'damaged'].map(v => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Cost (optional)</Label><Input type="number" min={0} value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addCopyMutation.isPending}>Cancel</Button>
            <Button onClick={() => addCopyMutation.mutate()} disabled={addCopyMutation.isPending}>
              {addCopyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={o => !o && setDeleteId(null)}
        title="Remove this copy?"
        description="This cannot be undone. A copy currently issued or reserved can't be removed."
        destructive
        confirmLabel="Remove"
        loading={deleteCopyMutation.isPending}
        onConfirm={() => deleteCopyMutation.mutate()}
      />
    </div>
  )
}
