'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpen, Loader2, Plus, Upload, Gift, Check, X } from 'lucide-react'
import { libraryApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { StudentSearch, StudentLite } from '@/components/shared/StudentSearch'
import { ImportCsvDialog } from '@/components/shared/ImportCsvDialog'
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const CATEGORY_LABELS: Record<string, string> = {
  fiction: 'Fiction', non_fiction: 'Non-Fiction', reference: 'Reference',
  textbook: 'Textbook', periodical: 'Periodical', av_media: 'AV Media', other: 'Other',
}

export default function LibraryCatalogPage() {
  const { can } = usePermissions()
  const canManage = can('library.manage_catalog')
  const canAcquire = can('library.manage_acquisition')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog"
        description="Book titles, copies, and the second-hand book-bank donation queue."
        icon={BookOpen}
        className="mb-0"
      />
      <Tabs defaultValue="Titles">
        <TabsList>
          <TabsTrigger value="Titles">Titles</TabsTrigger>
          <TabsTrigger value="Donations">Donations</TabsTrigger>
        </TabsList>
        <TabsContent value="Titles" className="mt-6">
          <TitlesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="Donations" className="mt-6">
          <DonationsTab canManage={canAcquire} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TitlesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState({ title: '', authors: '', category: 'fiction', publisher: '', isbn: '', subject_name: '' })

  const { data: titles, isLoading } = useQuery({
    queryKey: ['library-titles'],
    queryFn: () => libraryApi.titles.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.titles.create({
      ...form,
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-titles'] })
      setAddOpen(false)
      setForm({ title: '', authors: '', category: 'fiction', publisher: '', isbn: '', subject_name: '' })
      toast.success('Title added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add title'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Every book/media title in your library, with how many copies are available.</p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Title</Button>
          </div>
        )}
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Author(s)</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Copies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(titles ?? []).length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No titles catalogued yet.</TableCell></TableRow>
            )}
            {(titles ?? []).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  <Link href={`/library/catalog/${t.id}`} className="hover:underline">{t.title}</Link>
                  {!t.is_circulating && <Badge variant="secondary" className="ml-2">Room only</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground">{(t.authors ?? []).join(', ') || '—'}</TableCell>
                <TableCell>{CATEGORY_LABELS[t.category] ?? t.category}</TableCell>
                <TableCell>{t.available_count} / {t.copy_count} available</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Title</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Author(s), comma-separated</Label><Input value={form.authors} onChange={e => setForm(f => ({ ...f, authors: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>ISBN (optional)</Label><Input value={form.isbn} onChange={e => setForm(f => ({ ...f, isbn: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Publisher (optional)</Label><Input value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Subject (optional)</Label><Input value={form.subject_name} onChange={e => setForm(f => ({ ...f, subject_name: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Titles"
        columns={['title', 'authors', 'publisher', 'isbn', 'category', 'subject_name']}
        sampleRow={['Panchatantra Tales', 'Vishnu Sharma', 'NCERT', '9788172343381', 'fiction', 'Hindi']}
        invalidateQueryKey={['library-titles']}
        onImport={rows => libraryApi.titles.import(rows).then((r: any) => r.data)}
      />
    </Card>
  )
}

const CONDITION_LABELS: Record<string, string> = { new: 'New', good: 'Good', worn: 'Worn', damaged: 'Damaged' }

function DonationsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [acceptFor, setAcceptFor] = useState<any | null>(null)
  const [student, setStudent] = useState<StudentLite | null>(null)
  const [form, setForm] = useState({ title: '', condition: 'good' })

  const { data: donations, isLoading } = useQuery({
    queryKey: ['library-donations'],
    queryFn: () => libraryApi.donations.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.donations.create({ ...form, donated_by_student_id: student?.id ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-donations'] })
      setAddOpen(false); setForm({ title: '', condition: 'good' }); setStudent(null)
      toast.success('Donation logged')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to log donation'),
  })

  const acceptMutation = useMutation({
    mutationFn: () => libraryApi.donations.accept(acceptFor.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-donations'] })
      qc.invalidateQueries({ queryKey: ['library-titles'] })
      setAcceptFor(null)
      toast.success('Donation accepted into the catalog')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to accept donation'),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => libraryApi.donations.reject(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-donations'] }); toast.success('Donation rejected') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to reject donation'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">Second-hand textbooks students donate back for next year's students — review and accept into the catalog.</p>
        {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Gift className="h-4 w-4" /> Log Donation</Button>}
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Donated By</TableHead><TableHead>Condition</TableHead><TableHead>Status</TableHead>{canManage && <TableHead className="w-40" />}</TableRow></TableHeader>
          <TableBody>
            {(donations ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No donations logged yet.</TableCell></TableRow>}
            {(donations ?? []).map((d: any) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.title}</TableCell>
                <TableCell>{d.students ? `${d.students.first_name} ${d.students.last_name}` : 'Anonymous'}</TableCell>
                <TableCell>{CONDITION_LABELS[d.condition] ?? '—'}</TableCell>
                <TableCell>
                  {d.accepted === null && <Badge variant="warning">Pending</Badge>}
                  {d.accepted === true && <Badge variant="success">Accepted</Badge>}
                  {d.accepted === false && <Badge variant="destructive">Rejected</Badge>}
                </TableCell>
                {canManage && (
                  <TableCell>
                    {d.accepted === null && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setAcceptFor(d)}><Check className="h-3.5 w-3.5" /> Accept</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => rejectMutation.mutate(d.id)}><X className="h-3.5 w-3.5" /> Reject</Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log a Book Donation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Donated by (optional)</Label>
              <StudentSearch value={student} onSelect={setStudent} />
            </div>
            <div className="space-y-1.5"><Label>Book title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Condition</Label>
              <Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CONDITION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmAcceptDialog acceptFor={acceptFor} onCancel={() => setAcceptFor(null)} onConfirm={() => acceptMutation.mutate()} loading={acceptMutation.isPending} />
    </Card>
  )
}

function ConfirmAcceptDialog({ acceptFor, onCancel, onConfirm, loading }: { acceptFor: any; onCancel: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <Dialog open={!!acceptFor} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Accept "{acceptFor?.title}"?</DialogTitle>
          <DialogDescription>This creates a new catalog copy (source: Book Bank) ready to be issued.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
