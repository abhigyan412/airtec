'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { studentsApi, admissionApi, academicYearsApi } from '@/lib/api'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'
import { ArrowLeft, Search, CheckSquare, Square, Users, ArrowRight, Loader2, GraduationCap, AlertTriangle, History, ArrowRightLeft, ArrowUpNarrowWide } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

const PROMOTION_TYPES = [
  { value: 'promoted', label: 'Promoted', hint: 'Moving up to the next class for a new academic year' },
  { value: 'transferred', label: 'Transferred', hint: 'Moving section/class within the same academic year' },
  { value: 'detained', label: 'Detained', hint: 'Repeating the same class in the new academic year' },
  { value: 'withdrawn', label: 'Withdrawn', hint: 'Leaving — recorded here, handle TC separately' },
]

export default function PromoteStudentsPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<'tool' | 'history'>('tool')

  // Source filters
  const [fromClass, setFromClass] = useState('')
  const [fromSection, setFromSection] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Destination
  const [toAcademicYear, setToAcademicYear] = useState('')
  const [toClass, setToClass] = useState('')
  const [toSection, setToSection] = useState('')
  const [promotionType, setPromotionType] = useState('promoted')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  const { data: academicYears } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })

  const fromClassObj = (classesData ?? []).find((c: any) => c.id === fromClass)
  const fromSections = fromClassObj?.sections ?? []
  const toClassObj = (classesData ?? []).find((c: any) => c.id === toClass)
  const toSections = toClassObj?.sections ?? []

  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students-promote', fromClass, fromSection, search],
    queryFn: () => studentsApi.list({
      class_id: fromClass || undefined,
      section_id: fromSection || undefined,
      search: search || undefined,
      status: 'active',
      limit: 200,
    }).then(r => r),
    enabled: !!fromClass,
  })
  const students = studentsData?.data ?? []

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelected(selected.size === students.length ? new Set() : new Set(students.map((s: any) => s.id)))
  }

  const promoteMutation = useMutation({
    mutationFn: () => studentsApi.bulkPromote({
      student_ids: Array.from(selected),
      to_class_id: toClass,
      to_section_id: toSection || undefined,
      to_academic_year_id: toAcademicYear,
      promotion_type: promotionType,
      notes: notes || undefined,
    }),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? 'Students promoted')
      setSelected(new Set())
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['students-promote'] })
      qc.invalidateQueries({ queryKey: ['student-stats'] })
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to promote')
      setConfirming(false)
    },
  })

  const canReview = selected.size > 0 && toClass && toAcademicYear
  const toClassName = toClassObj?.name ?? '—'
  const toSectionName = toSections.find((s: any) => s.id === toSection)?.name
  const toYearName = (academicYears ?? []).find((y: any) => y.id === toAcademicYear)?.name ?? '—'

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to students" className="mt-1 shrink-0">
          <Link href="/students">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title="Promote / Transfer Students"
          icon={ArrowUpNarrowWide}
          description={
            view === 'tool'
              ? "Move students to a new class, section, or academic year — tracked in each student's promotion history"
              : 'Every promotion, transfer, detention, and withdrawal recorded so far'
          }
          actions={
            <Tabs value={view} onValueChange={(v) => setView(v as 'tool' | 'history')}>
              <TabsList>
                <TabsTrigger value="tool">
                  <ArrowRightLeft className="h-4 w-4" /> Promote / Transfer
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="h-4 w-4" /> History
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
      </div>

      {view === 'history' && <PromotionHistory classesData={classesData} />}

      {/* Step 1: source */}
      {view === 'tool' && (<>
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">1. Select students</p>
          <div className="flex flex-wrap gap-3">
            <Select value={fromClass || undefined}
              onValueChange={v => { setFromClass(v); setFromSection(''); setSelected(new Set()) }}>
              <SelectTrigger className="min-w-[160px] sm:w-[200px]">
                <SelectValue placeholder="Select current class..." />
              </SelectTrigger>
              <SelectContent>
                {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {fromSections.length > 0 && (
              <Select value={fromSection || 'all'}
                onValueChange={v => { setFromSection(v === 'all' ? '' : v); setSelected(new Set()) }}>
                <SelectTrigger className="min-w-[140px]">
                  <SelectValue placeholder="All sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {fromSections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="text" placeholder="Search within selected class..." value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Student list */}
      {fromClass && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAll}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Toggle all students"
              >
                {selected.size === students.length && students.length > 0
                  ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
              </button>
              <span className="text-sm text-muted-foreground">
                {students.length} active students
                {selected.size > 0 && <span className="font-semibold text-primary"> · {selected.size} selected</span>}
              </span>
            </div>
            {students.length > 0 && (
              <Button variant="link" size="sm" onClick={toggleAll} className="h-auto p-0">
                {selected.size === students.length ? 'Deselect all' : 'Select all'}
              </Button>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No active students here"
              description="Nothing matched this class, section, or search. Try another section or clear the search box."
              className="py-12"
            />
          ) : (
            <div className="max-h-[360px] divide-y divide-border overflow-y-auto">
              {students.map((s: any) => {
                const isSelected = selected.has(s.id)
                return (
                  <button key={s.id} type="button" onClick={() => toggleOne(s.id)}
                    aria-pressed={isSelected}
                    className={cn('flex w-full items-center gap-4 px-6 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', isSelected ? 'bg-primary/10' : 'hover:bg-muted/50')}>
                    <span className="shrink-0 text-muted-foreground">
                      {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{s.first_name} {s.last_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.admission_number && `#${s.admission_number} · `}Roll: {s.roll_number ?? '—'}
                        {s.sections?.name && ` · ${s.sections.name}`}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[s.status])}>{s.status}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Step 2: destination */}
      {selected.size > 0 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="text-sm font-semibold text-foreground">2. Move {selected.size} selected student{selected.size !== 1 ? 's' : ''} to</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Academic Year *</Label>
                <Select value={toAcademicYear || undefined} onValueChange={v => setToAcademicYear(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select year..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(academicYears ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Class *</Label>
                <Select value={toClass || undefined} onValueChange={v => { setToClass(v); setToSection('') }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select class..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Section</Label>
                <Select value={toSection || 'unassigned'} onValueChange={v => setToSection(v === 'unassigned' ? '' : v)} disabled={!toClass}>
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {toSections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type *</Label>
                <Select value={promotionType} onValueChange={v => setPromotionType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMOTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{PROMOTION_TYPES.find(t => t.value === promotionType)?.hint}</p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Promoted after Annual Exam 2026" />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setConfirming(true)} disabled={!canReview}>
                <GraduationCap className="h-4 w-4" /> Review &amp; Confirm
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Confirm {PROMOTION_TYPES.find(t => t.value === promotionType)?.label.toLowerCase()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{selected.size}</span> student{selected.size !== 1 ? 's' : ''} will move to:
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{fromClassObj?.name ?? 'Current class'}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-primary">{toClassName}{toSectionName ? ` · ${toSectionName}` : ''} · {toYearName}</span>
            </div>
            <p className="text-xs text-muted-foreground">This updates each student&apos;s record immediately and is logged in their promotion history. It isn&apos;t automatically reversible — you&apos;d need to promote them back manually.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending}>
              {promoteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>)}
    </div>
  )
}

// ── HISTORY VIEW ───────────────────────────────────────────────
function PromotionHistory({ classesData }: { classesData: any }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['promotion-history', typeFilter, classFilter],
    queryFn: () => studentsApi.promotions({
      promotion_type: typeFilter || undefined,
      class_id: classFilter || undefined,
      limit: 100,
    }).then(r => r.data),
  })
  const records = data ?? []
  const isFiltered = !!(typeFilter || classFilter)

  const TYPE_STYLES: Record<string, string> = {
    promoted: 'bg-success/10 text-success',
    transferred: 'bg-primary/10 text-primary',
    detained: 'bg-warning/10 text-warning',
    withdrawn: 'bg-destructive/10 text-destructive',
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-5">
          <Select value={typeFilter || 'all'} onValueChange={v => setTypeFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="min-w-[160px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {PROMOTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={classFilter || 'all'} onValueChange={v => setClassFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="min-w-[160px]">
              <SelectValue placeholder="All classes (from or to)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes (from or to)</SelectItem>
              {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            icon={History}
            title={isFiltered ? 'No records match these filters' : 'No promotions or transfers recorded yet'}
            description={isFiltered
              ? 'Try a different type or class, or clear the filters to see every record.'
              : 'Once you move students from the Promote / Transfer tab, every promotion, transfer, detention and withdrawal is logged here.'}
            className="py-12"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Student</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r: any) => (
                <TableRow key={r.id} className="cursor-default">
                  <TableCell>
                    <p className="font-medium text-foreground">{r.students?.first_name} {r.students?.last_name}</p>
                    <p className="text-xs text-muted-foreground">#{r.students?.admission_number ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', TYPE_STYLES[r.promotion_type] ?? 'bg-muted text-muted-foreground')}>
                      {r.promotion_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.from_class?.name ?? '—'}{r.from_section?.name ? ` · ${r.from_section.name}` : ''}
                    {r.from_year?.name && <span className="text-muted-foreground/60"> ({r.from_year.name})</span>}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {r.to_class?.name ?? '—'}{r.to_section?.name ? ` · ${r.to_section.name}` : ''}
                    {r.to_year?.name && <span className="font-normal text-muted-foreground"> ({r.to_year.name})</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.promoter?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
