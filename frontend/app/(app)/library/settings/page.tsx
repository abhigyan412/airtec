'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpen, Loader2, Plus, Trash2, Save } from 'lucide-react'
import { libraryApi, rbacApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkflowSettingsCard } from '@/components/shared/WorkflowSettingsCard'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const TABS = ['Borrowing Policies', 'Fine Rules', 'Library Period', 'Workflows']

const CATEGORY_LABELS: Record<string, string> = {
  fiction: 'Fiction', non_fiction: 'Non-Fiction', reference: 'Reference',
  textbook: 'Textbook', periodical: 'Periodical', av_media: 'AV Media', other: 'Other',
}

// First settings surface for Library — same "school configures the
// rules" shape as Result Settings and Transport Settings: borrowing
// limits are school-defined per role/category (not a hardcoded global),
// and all four approval chains reuse the same shared workflow engine
// every other module's settings page already uses.
export default function LibrarySettingsPage() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState(TABS.includes(initialTab ?? '') ? initialTab! : 'Borrowing Policies')
  const { can } = usePermissions()
  const canManage = can('library.settings_manage')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library Settings"
        description="Configure borrowing limits, fine rules, the library period, and approval chains."
        icon={BookOpen}
        className="mb-0"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="Borrowing Policies">Borrowing Policies</TabsTrigger>
          <TabsTrigger value="Fine Rules">Fine Rules</TabsTrigger>
          <TabsTrigger value="Library Period">Library Period</TabsTrigger>
          <TabsTrigger value="Workflows">Workflows</TabsTrigger>
        </TabsList>

        <TabsContent value="Borrowing Policies" className="mt-6">
          <BorrowingPoliciesTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="Fine Rules" className="mt-6">
          <FineRulesTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="Library Period" className="mt-6">
          <LibraryPeriodTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="Workflows" className="mt-6 space-y-4">
          <WorkflowSettingsCard
            title="Library Fine Waiver Approval Workflow"
            description="Choose how many approval steps waiving an overdue fine goes through."
            queryKey="library-workflow-fine-waiver"
            apiPath="/library/settings/workflow/fine-waiver"
            canManage={canManage}
          />
          <WorkflowSettingsCard
            title="Lost Book Charge Waiver Approval Workflow"
            description="Choose how many approval steps waiving a lost-book replacement charge goes through."
            queryKey="library-workflow-lost-book-waiver"
            apiPath="/library/settings/workflow/lost-book-waiver"
            canManage={canManage}
          />
          <WorkflowSettingsCard
            title="Book Acquisition Request Approval Workflow"
            description="Choose how many approval steps a new-book purchase request goes through."
            queryKey="library-workflow-acquisition"
            apiPath="/library/settings/workflow/acquisition"
            canManage={canManage}
          />
          <WorkflowSettingsCard
            title="Book Withdrawal Approval Workflow"
            description="Choose how many approval steps discarding/withdrawing a damaged or obsolete copy goes through."
            queryKey="library-workflow-withdrawal"
            apiPath="/library/settings/workflow/withdrawal"
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function useGeneralSettings() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['library-settings-general'],
    queryFn: () => libraryApi.settings.get().then(r => r.data),
  })
  const saveMutation = useMutation({
    mutationFn: (patch: any) => libraryApi.settings.save({ ...data, ...patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-settings-general'] })
      toast.success('Settings saved')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })
  return { data, isLoading, saveMutation }
}

function FineRulesTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading, saveMutation } = useGeneralSettings()
  const [form, setForm] = useState<any>(null)
  const current = form ?? data

  if (isLoading || !current) return <Skeleton className="h-56 w-full max-w-xl rounded-xl" />
  const set = (patch: any) => setForm({ ...current, ...patch })

  return (
    <Card className="max-w-xl space-y-4 p-6">
      <div className="space-y-1.5">
        <Label htmlFor="fine-per-day">Default fine per day (₹)</Label>
        <Input id="fine-per-day" type="number" min={0} disabled={!canManage}
          value={current.default_fine_per_day} onChange={e => set({ default_fine_per_day: Number(e.target.value) })} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grace-days">Grace days before a fine starts</Label>
        <Input id="grace-days" type="number" min={0} disabled={!canManage}
          value={current.grace_days} onChange={e => set({ grace_days: Number(e.target.value) })} className="w-40" />
      </div>
      <p className="text-xs text-muted-foreground">
        A specific role or book category can override this rate on the Borrowing Policies tab. Lost-book charges are set per copy at the time of loss, not here.
      </p>
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate(form)} disabled={!form || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      )}
    </Card>
  )
}

function LibraryPeriodTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading, saveMutation } = useGeneralSettings()
  const [form, setForm] = useState<any>(null)
  const current = form ?? data

  if (isLoading || !current) return <Skeleton className="h-56 w-full max-w-xl rounded-xl" />
  const set = (patch: any) => setForm({ ...current, ...patch })

  return (
    <Card className="max-w-xl space-y-4 p-6">
      <p className="text-sm text-muted-foreground">
        Indian schools schedule a dedicated Library Period in the weekly timetable — books are meant to be issued and returned during it, not in between classes. Tell us what your school calls that period so Circulation can find it on the timetable.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="lib-period-name">Timetable period name</Label>
        <Input id="lib-period-name" disabled={!canManage} placeholder="Library"
          value={current.timetable_subject_name} onChange={e => set({ timetable_subject_name: e.target.value })} className="w-56" />
        <p className="text-xs text-muted-foreground">Matched against the subject name on your school's timetable (e.g. "Library", "Library Hour", "Reading Period").</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="default-max-books">Default max books per member</Label>
        <Input id="default-max-books" type="number" min={1} disabled={!canManage}
          value={current.default_max_books} onChange={e => set({ default_max_books: Number(e.target.value) })} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="default-loan-days">Default loan period (days)</Label>
        <Input id="default-loan-days" type="number" min={1} disabled={!canManage}
          value={current.default_loan_days} onChange={e => set({ default_loan_days: Number(e.target.value) })} className="w-40" />
      </div>
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate(form)} disabled={!form || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      )}
    </Card>
  )
}

function BorrowingPoliciesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [targetType, setTargetType] = useState<'role' | 'category'>('category')
  const [form, setForm] = useState({ applies_to_role_id: '', applies_to_category: '', max_books: '', loan_days: '', renewal_limit: '', fine_per_day: '' })

  const { data: policies, isLoading } = useQuery({
    queryKey: ['library-borrowing-policies'],
    queryFn: () => libraryApi.borrowingPolicies.list().then(r => r.data),
  })
  const { data: roles } = useQuery({ queryKey: ['rbac-roles'], queryFn: () => rbacApi.roles.list().then(r => r.data) })

  const createMutation = useMutation({
    mutationFn: () => libraryApi.borrowingPolicies.create({
      applies_to_role_id: targetType === 'role' ? form.applies_to_role_id : null,
      applies_to_category: targetType === 'category' ? form.applies_to_category : null,
      max_books: form.max_books ? Number(form.max_books) : null,
      loan_days: form.loan_days ? Number(form.loan_days) : null,
      renewal_limit: form.renewal_limit ? Number(form.renewal_limit) : null,
      fine_per_day: form.fine_per_day ? Number(form.fine_per_day) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library-borrowing-policies'] })
      setAddOpen(false)
      setForm({ applies_to_role_id: '', applies_to_category: '', max_books: '', loan_days: '', renewal_limit: '', fine_per_day: '' })
      toast.success('Policy added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add policy'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => libraryApi.borrowingPolicies.delete(deleteId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['library-borrowing-policies'] }); setDeleteId(null); toast.success('Policy removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove policy'),
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Override the defaults for a specific role (e.g. Staff get longer loans) or book category (e.g. Reference books don't circulate at all).
        </p>
        {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Policy</Button>}
      </div>

      {isLoading ? <div className="px-5 pb-5"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Applies To</TableHead>
              <TableHead>Max Books</TableHead>
              <TableHead>Loan Days</TableHead>
              <TableHead>Renewal Limit</TableHead>
              <TableHead>Fine/Day</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(policies ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No overrides configured yet — everyone uses the defaults from Library Period / Fine Rules.</TableCell></TableRow>
            )}
            {(policies ?? []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.applies_to_role_id ? `Role: ${p.roles?.name}` : `Category: ${CATEGORY_LABELS[p.applies_to_category] ?? p.applies_to_category}`}
                </TableCell>
                <TableCell>{p.max_books ?? '—'}</TableCell>
                <TableCell>{p.loan_days ?? '—'}</TableCell>
                <TableCell>{p.renewal_limit ?? '—'}</TableCell>
                <TableCell>{p.fine_per_day != null ? `₹${p.fine_per_day}` : '—'}</TableCell>
                {canManage && (
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                      <Trash2 className="h-4 w-4" />
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
          <DialogHeader><DialogTitle>Add Borrowing Policy</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={targetType} onValueChange={v => setTargetType(v as 'role' | 'category')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">A book category</SelectItem>
                  <SelectItem value="role">A role</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetType === 'category' ? (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.applies_to_category || undefined} onValueChange={v => setForm(f => ({ ...f, applies_to_category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger>
                  <SelectContent>{Object.entries(CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.applies_to_role_id || undefined} onValueChange={v => setForm(f => ({ ...f, applies_to_role_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                  <SelectContent>{(roles ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Max books</Label><Input type="number" min={0} value={form.max_books} onChange={e => setForm(f => ({ ...f, max_books: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Loan days</Label><Input type="number" min={0} value={form.loan_days} onChange={e => setForm(f => ({ ...f, loan_days: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Renewal limit</Label><Input type="number" min={0} value={form.renewal_limit} onChange={e => setForm(f => ({ ...f, renewal_limit: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Fine/day (₹)</Label><Input type="number" min={0} value={form.fine_per_day} onChange={e => setForm(f => ({ ...f, fine_per_day: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || (targetType === 'category' ? !form.applies_to_category : !form.applies_to_role_id)}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={o => !o && setDeleteId(null)}
        title="Remove this policy?"
        description="Members it applied to will fall back to the school-wide defaults."
        destructive
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Card>
  )
}
