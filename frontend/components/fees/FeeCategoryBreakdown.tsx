'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Tags, Users, X, Download } from 'lucide-react'
import { toast } from 'sonner'
import { feeApi, classesApi, invalidateFeeQueries, downloadFeeCsv } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { formatCurrency, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { CheckboxField } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryError } from '@/components/shared/QueryError'
import { StudentSearch, StudentLite, studentLabel } from '@/components/shared/StudentSearch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// What the school is carrying on each kind of seat.
//
// fee_category — general, RTE, staff ward, sibling, scholarship — was recorded on
// every assignment and read by nothing. It appeared as one word of grey text on a
// student's profile and drove no billing, no report and no filter.
//
// It still drives no billing: a concession is granted per student and approved
// separately, and inventing automatic RTE terms without the school's actual
// policy would be worse than the honest reporting here. What it now does is
// answer the question a trust board asks — how many seats of each kind, what has
// been billed against them, and how much of it has come in.

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'rte', label: 'RTE' },
  { value: 'staff_ward', label: 'Staff ward' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'scholarship', label: 'Scholarship' },
] as const

export function FeeCategoryBreakdown() {
  const { can } = usePermissions()
  const [changing, setChanging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const canManage = can('fee.structure_manage')

  const { data, isPending, error } = useQuery({
    queryKey: ['fee-by-category'],
    queryFn: () => feeApi.byCategory(),
  })

  const rows: any[] = data?.data ?? []
  const totals = data?.meta?.totals
  const unapplied = totals?.concession_unapplied_students ?? 0

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground" /> By fee category
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How many seats of each kind, and what has been billed against them
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Screen-only was a real limit: this table goes into a board pack and
              an RTE claim, and retyping it is where the figures stop matching.
              Fetched rather than linked, because a plain <a> carries no token. */}
          <Button size="sm" variant="outline" disabled={downloading || !rows.length}
            onClick={async () => {
              setDownloading(true)
              try {
                await downloadFeeCsv('/fees/by-category', {}, 'fee-by-category.csv')
              } catch {
                toast.error('Could not export')
              } finally {
                setDownloading(false)
              }
            }}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export
          </Button>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
              <Users className="h-3.5 w-3.5" /> Change category
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* The finding, not a footnote. Every one of these is a family holding a
            full-fee invoice for money the school has already agreed to forgo —
            and being reminded about it by the nightly sweep. */}
        {unapplied > 0 && (
          <div className="px-5 pb-4">
            <Alert
              variant="warning"
              title={`${unapplied} approved concession${unapplied === 1 ? '' : 's'} has come off no invoice`}
            >
              {totals.concession_unapplied_invoices} open invoice
              {totals.concession_unapplied_invoices === 1 ? '' : 's'} worth{' '}
              <b>{formatCurrency(totals.concession_unapplied_outstanding)}</b> still bill the full amount.
              A concession is applied when an invoice is raised; ones already issued keep what
              they were issued with. Adjust those invoices, or the concession takes effect from
              the next billing run.
            </Alert>
          </div>
        )}

        {isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : error ? (
          <QueryError error={error} title="Could not load the category breakdown" />
        ) : !rows.length ? (
          <EmptyState
            icon={Tags}
            title="Nobody is on a plan yet"
            description="Categories are recorded when students are assigned to a fee structure."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Concessions given</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.category} className="cursor-default">
                    <TableCell>
                      <p className="font-medium text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(r.avg_billed_per_student)} each on average
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{r.students}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(r.billed)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">{formatCurrency(r.collected)}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn('font-semibold tabular-nums', r.outstanding > 0 ? 'text-destructive' : 'text-success')}>
                        {formatCurrency(r.outstanding)}
                      </span>
                      {/* The rate is the comparison that makes this table worth
                          reading: one category collecting far below the others is
                          the finding, not the absolute figure. */}
                      <span className="block text-[11px] text-muted-foreground">
                        {r.collection_rate}% collected
                      </span>
                    </TableCell>
                    {/* "₹0" beside "9 students" is not two neutral facts, it is
                        a contradiction: nine concessions granted, nothing taken
                        off anybody's bill. Coloured and worded as the alarm it
                        is, or nobody reads the pair together. */}
                    <TableCell className="hidden md:table-cell text-right">
                      <span className="tabular-nums text-muted-foreground">
                        {formatCurrency(r.concession_on_invoices)}
                      </span>
                      {r.students_with_concession > 0 && (
                        r.concession_unapplied_students > 0 ? (
                          <span className="block text-[11px] font-medium text-warning">
                            {r.students_with_concession} granted ·{' '}
                            {r.concession_unapplied_students} not applied
                          </span>
                        ) : (
                          <span className="block text-[11px] text-muted-foreground">
                            {r.students_with_concession} student{r.students_with_concession === 1 ? '' : 's'}
                          </span>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold text-foreground">All</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{totals.students}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(totals.billed)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-success">{formatCurrency(totals.collected)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-destructive">{formatCurrency(totals.outstanding)}</TableCell>
                    <TableCell className="hidden md:table-cell text-right font-semibold tabular-nums">
                      {formatCurrency(totals.concession_on_invoices)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Category is for reporting. It does not change what a student is billed —
          a concession does, granted per student under Concessions, and it applies
          from the next invoice raised rather than to invoices already issued.
        </p>
      </CardContent>

      {changing && <ChangeCategoryDialog onClose={() => setChanging(false)} />}
    </Card>
  )
}

// ── Applying a category to who actually holds it ──────────────────────
//
// The category could only be set at assignment time, which made it unusable for
// what it is for: RTE seats and staff wards are identified as the year goes on,
// not known when a class is first put on a plan. Fixing one meant unassigning the
// student and starting over.
//
// Then it could only be set for WHOLE CLASSES, which is barely better. None of
// these categories is a property of a class: siblings, staff wards and RTE seats
// are a handful of children scattered across the school. Tagging Class 1-A as
// "Sibling" to reach the three siblings in it mislabels the other thirty-seven,
// and every figure on the report above is then wrong.
//
// The API has always accepted classes, sections OR an explicit student list;
// only the form was narrower. All three are offered here.

type Scope = 'class' | 'section' | 'student'

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: 'class', label: 'Classes', hint: 'Everyone in the classes you pick' },
  { value: 'section', label: 'Sections', hint: 'Everyone in the sections you pick' },
  { value: 'student', label: 'Students', hint: 'Only the children you name' },
]

function ChangeCategoryDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [category, setCategory] = useState('rte')
  const [scope, setScope] = useState<Scope>('student')
  const [classIds, setClassIds] = useState<string[]>([])
  const [sectionIds, setSectionIds] = useState<string[]>([])
  const [students, setStudents] = useState<StudentLite[]>([])
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.list().then((r: any) => r.data as any[]),
  })

  // Flattened for the section picker — classes come back with their sections
  // embedded, so this costs no extra request.
  const sections = (classes ?? []).flatMap((c: any) =>
    (c.sections ?? []).map((s: any) => ({ id: s.id, label: `${c.name}-${s.name}` })))

  const resetPreview = () => setPreview(null)

  const addStudent = (s: StudentLite | null) => {
    if (!s) return
    resetPreview()
    setStudents(v => (v.some(x => x.id === s.id) ? v : [...v, s]))
  }

  // Exactly one scope is ever sent. The server refuses an empty selection rather
  // than recategorising the school, so an unfilled tab cannot leak into a call
  // that was meant to be narrow.
  const body = (isPreview: boolean) => ({
    fee_category: category,
    class_ids: scope === 'class' ? classIds : [],
    section_ids: scope === 'section' ? sectionIds : [],
    student_ids: scope === 'student' ? students.map(s => s.id) : [],
    preview: isPreview,
  })

  const runPreview = async () => {
    setBusy(true)
    try {
      const res = await feeApi.assignments.setCategory(body(true))
      setPreview(res.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not work out what would change')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    try {
      const res = await feeApi.assignments.setCategory(body(false))
      const n = res.data.updated
      if (!n) toast.info(res.data.message ?? 'Nothing to change')
      else toast.success(`${n} student${n === 1 ? '' : 's'} moved to ${CATEGORIES.find(c => c.value === category)?.label}`,
        { description: res.meta?.note })
      invalidateFeeQueries(qc)
      qc.invalidateQueries({ queryKey: ['fee-by-category'] })
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not change the category')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount =
    scope === 'class' ? classIds.length
    : scope === 'section' ? sectionIds.length
    : students.length
  const ready = selectedCount > 0

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change fee category</DialogTitle>
          <DialogDescription>
            Applies to the students you select who are already on a fee plan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Set category to</Label>
            <Select value={category} onValueChange={v => { setPreview(null); setCategory(v) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Students first, and the default: none of these categories is a
              property of a class. Whole-class tagging is the exception, kept
              because RTE intakes sometimes are one. */}
          <div className="space-y-2">
            <Label>Apply to</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCOPES.map(s => (
                <button
                  key={s.value} type="button"
                  onClick={() => { resetPreview(); setScope(s.value) }}
                  className={cn('rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
                    scope === s.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/40')}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {SCOPES.find(s => s.value === scope)?.hint}
            </p>
          </div>

          {scope === 'student' && (
            <div className="space-y-2">
              <Label>Students *</Label>
              <StudentSearch value={null} onSelect={addStudent} autoFocus />
              {!!students.length && (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-border p-3">
                  {students.map(s => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                    >
                      {studentLabel(s)}
                      <button
                        type="button"
                        aria-label={`Remove ${s.first_name} ${s.last_name}`}
                        onClick={() => { resetPreview(); setStudents(v => v.filter(x => x.id !== s.id)) }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {scope === 'section' && (
            <div className="space-y-2">
              <Label>Sections *</Label>
              <div className="grid max-h-[180px] gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-3">
                {sections.map(s => (
                  <CheckboxField
                    key={s.id} label={s.label}
                    checked={sectionIds.includes(s.id)}
                    onChange={e => {
                      resetPreview()
                      setSectionIds(v => e.target.checked ? [...v, s.id] : v.filter(x => x !== s.id))
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {scope === 'class' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Classes *</Label>
                <button
                  type="button"
                  onClick={() => { resetPreview(); setClassIds(classIds.length === (classes ?? []).length ? [] : (classes ?? []).map(c => c.id)) }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {classIds.length === (classes ?? []).length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="grid max-h-[180px] gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-3">
                {(classes ?? []).map(c => (
                  <CheckboxField
                    key={c.id} label={c.name}
                    checked={classIds.includes(c.id)}
                    onChange={e => {
                      resetPreview()
                      setClassIds(v => e.target.checked ? [...v, c.id] : v.filter(x => x !== c.id))
                    }}
                  />
                ))}
              </div>
              <Alert variant="warning" title="This tags everyone in the class">
                A category is not a property of a class. Tagging a whole class to
                reach the three siblings in it mislabels the rest, and every figure
                on the report is then wrong. Pick Students unless the whole class
                really is on this category.
              </Alert>
            </div>
          )}

          {!ready && (
            // The server refuses an empty selection outright rather than
            // recategorising the school; this says so before the round trip.
            <p className="text-xs text-muted-foreground">
              Pick at least one — an empty selection is refused, not applied to everyone.
            </p>
          )}

          <Button variant="outline" className="w-full" onClick={runPreview} disabled={!ready || busy}>
            {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Preview
          </Button>

          {preview && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {preview.would_change} student{preview.would_change === 1 ? '' : 's'}
              </p>
              <p className="text-sm text-muted-foreground">
                of {preview.matched} in the selection
                {preview.already_set > 0 && ` · ${preview.already_set} already on this category`}
              </p>
              {preview.not_on_a_plan > 0 && (
                <Alert variant="warning" title={`${preview.not_on_a_plan} not on a fee plan`}>
                  A category lives on the assignment, so these are skipped. Assign
                  them to a structure first.
                </Alert>
              )}
            </div>
          )}

          <Alert variant="info" title="Nothing is re-billed">
            This changes how these students are reported, not what they owe.
            Invoices already raised are untouched.
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={!preview || !preview.would_change || busy}>
            {busy && preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Change {preview?.would_change ?? 0} student{preview?.would_change === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
