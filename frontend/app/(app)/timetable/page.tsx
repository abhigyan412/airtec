'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timetableApi, admissionApi, classesApi, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Loader2, Clock, Grid3X3, List, Printer, User, AlertTriangle, ShieldOff, UserCheck, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissions } from '@/lib/usePermissions'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

import { DAYS, DAY_SHORT, getColor } from './shared'
import { TeacherTimetableView } from './TeacherTimetableView'

const CONFLICT_CELL = 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/40'

type ViewMode = 'class' | 'teacher'

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}

function viewModeFromParam(v: string | null): ViewMode {
  return v === 'teacher' ? 'teacher' : 'class'
}

export default function TimetablePage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [selectedClass,   setSelectedClass]   = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  // Driven by ?view= so the sidebar's Class View/Teacher View/Free
  // Faculty sub-items can link straight to a tab, and so switching tabs
  // in-page keeps that same URL (and the sidebar's active-highlight) in
  // sync — see components/layout/Sidebar.tsx's query-aware hrefMatches.
  const [viewMode,        setViewModeState]   = useState<ViewMode>(() => viewModeFromParam(searchParams.get('view')))
  const [gridOrList,      setGridOrList]      = useState<'grid'|'list'>('grid')
  const [showAdd,         setShowAdd]         = useState(false)
  const [addingDay,       setAddingDay]       = useState(1)
  const [lockedPeriod,    setLockedPeriod]    = useState<{ number: number; start: string; end: string } | null>(null)
  const [showBulkLunch,   setShowBulkLunch]   = useState(false)
  const [showPrint,       setShowPrint]       = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    setViewModeState(viewModeFromParam(searchParams.get('view')))
  }, [searchParams])

  const setViewMode = (v: ViewMode) => {
    setViewModeState(v)
    router.replace(v === 'class' ? '/timetable' : `/timetable?view=${v}`)
  }

  // ── RBAC ──────────────────────────────────────────────────
  const { can, isLoading: permLoading } = usePermissions()
  const { user, isRole } = useAuth()
  const isTeacher = user?.role === 'teacher'
  const canView   = can('timetable.view')
  const canSeeFreeFaculty = isRole('principal', 'school_admin')

  // The live timetable is read-only once the school manages it through the
  // versioned block view. This flat editor then only reads: showing edit
  // controls that 409 on save is worse than not showing them. So editing
  // needs BOTH the permission and an unlocked live timetable.
  const { data: lockStatus } = useQuery({
    queryKey: ['timetable-lock-status'],
    queryFn: () => timetableApi.lockStatus().then(r => r.data),
    enabled: !isTeacher,
    staleTime: 5 * 60 * 1000,
  })
  const liveLocked = !!lockStatus?.locked
  const canManage = can('timetable.manage') && !liveLocked

  // A teacher gets its own dedicated view below (own teaching schedule +
  // full homeroom timetable, nothing else) instead of this admin
  // class/teacher browser — these two queries back that browser, so
  // there's no reason to fetch them for a teacher who'll never see it.
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
    enabled: !isTeacher,
  })

  const { data: teachersData } = useQuery({
    queryKey: ['all-teachers'],
    queryFn: () => api.get('/students/timetable/teachers').then(r => r.data.data).catch(() => []),
    enabled: !isTeacher,
  })

  // Belt and braces on a cache key two dozen components share: if one of
  // them ever stores the envelope instead of the array again, this page
  // renders empty instead of throwing on .find.
  const classList: any[] = Array.isArray(classesData)
    ? classesData
    : Array.isArray((classesData as any)?.data) ? (classesData as any).data : []
  const selectedClassObj = classList.find((c: any) => c.id === selectedClass)
  // One comparator for both the dropdown order and the auto-selection
  // below, so "the first section" cannot mean two different things.
  // Numeric-aware, so 2 sorts before 10.
  const sortSections = (list: any[]) => [...list].sort((a, b) =>
    String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, { numeric: true }))
  const sections = sortSections(selectedClassObj?.sections ?? [])

  const { data: timetableData, isLoading } = useQuery({
    queryKey: ['timetable', selectedClass, selectedSection, selectedTeacher, viewMode],
    queryFn: () => timetableApi.get({
      class_id: viewMode === 'class' ? selectedClass : undefined,
      section_id: viewMode === 'class' && selectedSection ? selectedSection : undefined,
      teacher_id: viewMode === 'teacher' ? selectedTeacher : undefined,
    }).then(r => r.data),
    // Where a class has sections, wait for one. Firing on the class
    // alone would fetch the merged all-sections grid that was just
    // taken out of the dropdown — reachable again through the back
    // door. A class with no sections has nothing to wait for.
    enabled: !isTeacher && (viewMode === 'class'
      ? !!selectedClass && (sections.length === 0 || !!selectedSection)
      : !!selectedTeacher),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => timetableApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timetable'] }); toast.success('Period removed') },
  })

  // Build day map
  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of timetableData ?? []) {
    byDay[p.day_of_week] = byDay[p.day_of_week] ?? []
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  const allPeriods = Array.from(new Set<number>((timetableData ?? []).map((p: any) => p.period_number as number))).sort((a, b) => Number(a) - Number(b))
  const timeByPeriod: Record<number, string> = {}
  for (const p of timetableData ?? []) timeByPeriod[p.period_number] = `${p.start_time?.slice(0,5)}–${p.end_time?.slice(0,5)}`
  // A break (Lunch, etc.) occupies a period_number slot like any other row
  // for scheduling purposes, but it was never a taught period — labeling
  // its row "P5" implied otherwise. Rows entirely made of breaks show
  // their own name instead of a period number.
  const breakLabelByPeriod: Record<number, string> = {}
  for (const p of timetableData ?? []) {
    if (p.is_break) breakLabelByPeriod[p.period_number] = p.subject_name
  }

  // Conflict detection — teacher double booked.
  //
  // Keeps the whole clash, not just the ids of the cells to paint red.
  // "A teacher is assigned to multiple periods at the same time" tells a
  // timetable in-charge nothing they can act on: they still have to hunt
  // the grid for the red cells and work out who, when and which classes.
  // The name, the day, the time and both classes are all right here.
  interface Clash {
    teacherId: string
    teacherName: string
    day: number
    periodNumber: number
    time: string
    where: { label: string; subject: string }[]
  }
  const conflicts: Set<string> = new Set()
  const clashes: Clash[] = []

  if (viewMode === 'class' && timetableData) {
    const slots: Record<string, any[]> = {}
    for (const p of timetableData) {
      if (!p.teacher_id || p.is_break) continue
      const key = `${p.teacher_id}_${p.day_of_week}_${p.period_number}`
      if (!slots[key]) slots[key] = []
      slots[key].push(p)
    }
    for (const rows of Object.values(slots)) {
      if (rows.length < 2) continue
      for (const r of rows) conflicts.add(r.id)
      const first = rows[0]
      clashes.push({
        teacherId: first.teacher_id,
        teacherName: first.users?.full_name
          ?? (teachersData ?? []).find((t: any) => t.id === first.teacher_id)?.full_name
          ?? 'A teacher',
        day: first.day_of_week,
        periodNumber: first.period_number,
        time: timeByPeriod[first.period_number] ?? '',
        where: rows.map((r: any) => ({
          label: [r.classes?.name, r.sections?.name].filter(Boolean).join('-') || 'Unknown class',
          subject: r.subject_name,
        })),
      })
    }
    clashes.sort((a, b) =>
      a.day - b.day || a.periodNumber - b.periodNumber || a.teacherName.localeCompare(b.teacherName))
  }

  const stats = {
    total:    (timetableData ?? []).filter((p: any) => !p.is_break).length,
    subjects: new Set((timetableData ?? []).filter((p: any) => !p.is_break).map((p: any) => p.subject_name)).size,
    breaks:   (timetableData ?? []).filter((p: any) => p.is_break).length,
    conflicts: conflicts.size,
    clashes: clashes.length,
  }

  const printLabel = viewMode === 'teacher'
    ? (teachersData ?? []).find((t: any) => t.id === selectedTeacher)?.full_name ?? 'Teacher'
    : `${selectedClassObj?.name ?? ''}${selectedSection ? ' · Sec ' + sections.find((s: any) => s.id === selectedSection)?.name : ''}`

  // ── PERMISSION GUARD ──────────────────────────────────────
  if (!permLoading && !canView) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to view timetables." className="h-64" />
    )
  }

  // A teacher never gets the admin class/teacher browser above — only
  // their own teaching schedule, plus their full homeroom timetable if
  // they're a class teacher. Enforced again server-side (GET
  // /students/timetable), not just here.
  if (isTeacher) {
    return <TeacherTimetableView />
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title="Timetable"
        description="Manage class schedules and period assignments"
        icon={Clock}
        actions={
          <>
            {/* View mode */}
            <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
              <SegBtn active={viewMode === 'class'} onClick={() => setViewMode('class')}>
                <Grid3X3 className="w-3.5 h-3.5" /> Class View
              </SegBtn>
              <SegBtn active={viewMode === 'teacher'} onClick={() => setViewMode('teacher')}>
                <User className="w-3.5 h-3.5" /> Teacher View
              </SegBtn>
            </div>
            {/* Grid/List */}
            {(
              <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                <button onClick={() => setGridOrList('grid')} aria-label="Grid view"
                  className={cn('flex h-7 w-7 items-center justify-center rounded-md transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    gridOrList === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button onClick={() => setGridOrList('list')} aria-label="List view"
                  className={cn('flex h-7 w-7 items-center justify-center rounded-md transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    gridOrList === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            )}
            {/* Print — visible to anyone who can view */}
            {timetableData && timetableData.length > 0 && (
              <Button variant="outline" onClick={() => setShowPrint(true)}>
                <Printer className="w-4 h-4" /> Print
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setShowBulkLunch(true)}>
                <Clock className="w-4 h-4" /> Set Lunch Break
              </Button>
            )}
          </>
        }
      />

      {/* Live timetable is managed through the versioned block view — say so
          here, where someone with edit rights would otherwise expect to edit. */}
      {can('timetable.manage') && liveLocked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <ShieldOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-foreground">This is the live timetable and is read-only.</span>
          <span className="text-sm text-muted-foreground">Make a copy in the block view to change it.</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => router.push('/timetable/block')}>
            <Grid3X3 className="h-4 w-4" /> Open block view
          </Button>
        </div>
      )}

      {showBulkLunch && (
        <BulkLunchModal onClose={() => { setShowBulkLunch(false); qc.invalidateQueries({ queryKey: ['timetable'] }) }} />
      )}

      {/* Selectors */}
      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        {viewMode === 'class' ? (
          <>
            <div className="flex items-center gap-2">
              <Label className="shrink-0">Class</Label>
              {/* Picking a class lands on its first section, because a
                  timetable belongs to I-A, never to "Class I". Sorted so
                  "first" means A rather than whichever row the database
                  happened to return first. */}
              <Select
                value={selectedClass || undefined}
                onValueChange={v => {
                  setSelectedClass(v)
                  const secs = sortSections(classList.find((c: any) => c.id === v)?.sections ?? [])
                  setSelectedSection(secs[0]?.id ?? '')
                }}
              >
                <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
                <SelectContent>
                  {classList.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {sections.length > 0 && (
              <div className="flex items-center gap-2">
                <Label className="shrink-0">Section</Label>
                {/* Real sections only. "All sections" stacked every
                    section of the class into one grid, which shows two
                    or three different lessons in the same cell and is
                    nobody's timetable — a period belongs to I-A or to
                    I-B, never to "Class I". The block view is where the
                    whole school at once belongs. */}
                <Select value={selectedSection || undefined} onValueChange={setSelectedSection}>
                  <SelectTrigger className="h-9 min-w-[160px]">
                    <SelectValue placeholder="Select section..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Teacher</Label>
            <Select value={selectedTeacher || undefined} onValueChange={setSelectedTeacher}>
              <SelectTrigger className="h-9 min-w-[200px]"><SelectValue placeholder="Select teacher..." /></SelectTrigger>
              <SelectContent>
                {(teachersData ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Stats */}
        {timetableData && timetableData.length > 0 && (
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Periods/week</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{stats.subjects}</p>
              <p className="text-xs text-muted-foreground">Subjects</p>
            </div>
            {stats.conflicts > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold text-destructive">{stats.clashes}</p>
                <p className="text-xs text-destructive/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {stats.clashes === 1 ? 'Clash' : 'Clashes'}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* This grid only holds the class currently selected, so the scan
          above can only see clashes inside it. Narrowing to one section
          hides a teacher double-booked against the sibling section —
          which is exactly the shape of the commonest real clash — so say
          so rather than letting an empty banner read as "all clear". */}
      {viewMode === 'class' && selectedClass && selectedSection && clashes.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Checked for clashes within this section only. To catch a teacher booked against another
          section of the same class, clear the section filter.
        </p>
      )}

      {/* Conflict banner — spells out every clash rather than announcing
          that one exists somewhere in the grid. */}
      {clashes.length > 0 && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-destructive">
                {clashes.length === 1
                  ? 'One teacher is double-booked'
                  : `${clashes.length} teachers are double-booked`}
              </p>
              <p className="mt-0.5 text-xs text-destructive/80">
                Somebody is timetabled to be in two rooms at once. Until this is resolved, one of
                these classes has nobody in front of it.
              </p>

              <ul className="mt-3 space-y-2">
                {clashes.map((c, i) => (
                  <li key={i} className="rounded-lg bg-background/60 px-3 py-2 text-sm">
                    <span className="font-semibold text-foreground">{c.teacherName}</span>
                    <span className="text-muted-foreground">
                      {' '}on {DAYS[c.day - 1]}, period {c.periodNumber}
                      {c.time && <span className="tabular-nums"> ({c.time})</span>}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {c.where.map((w, j) => (
                        <span key={j} className="inline-flex items-center gap-1">
                          {j > 0 && <span className="text-destructive/70">and at the same time</span>}
                          <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            {w.label} · {w.subject}
                          </span>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-xs text-destructive/80">
                Both cells are outlined in red in the grid below. Fix it by moving one period to a
                free slot, or by giving one class a different teacher.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {((viewMode === 'class' && !selectedClass) || (viewMode === 'teacher' && !selectedTeacher)) ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Clock}
            title={viewMode === 'class' ? 'Select a class to view timetable' : 'Select a teacher to view their schedule'}
            description={viewMode === 'class'
              ? 'Pick a class above and its weekly grid of periods will load here.'
              : 'Pick a teacher above to see every period they teach this week.'}
          />
        </div>
      ) : isLoading ? (
        // Skeleton mirrors the grid that lands: a header row plus six period rows.
        <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : gridOrList === 'grid' ? (
        // ── GRID VIEW ─────────────────────────────────────────
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase border-b border-r border-border w-28 sticky left-0 bg-muted/50 z-10">
                    Period
                  </th>
                  {DAYS.map((day, idx) => (
                    <th key={day} className="px-3 py-3 border-b border-r border-border last:border-r-0 min-w-[150px]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">{DAY_SHORT[idx]}</span>
                        {viewMode === 'class' && canManage && (
                          <button onClick={() => { setAddingDay(idx + 1); setLockedPeriod(null); setShowAdd(true) }} aria-label={`Add period on ${day}`}
                            className="-my-2 flex h-9 w-9 items-center justify-center rounded-md text-primary/60 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allPeriods.map((periodNum) => (
                  <tr key={periodNum} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2 border-r border-border sticky left-0 bg-card z-10">
                      <p className="text-xs font-bold text-foreground">
                        {breakLabelByPeriod[Number(periodNum)] ?? `P${periodNum}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{timeByPeriod[Number(periodNum)]}</p>
                    </td>
                    {[1,2,3,4,5,6].map(dayNum => {
                      const period = (byDay[dayNum] ?? []).find((p: any) => p.period_number === periodNum)
                      const hasConflict = period && conflicts.has(period.id)
                      return (
                        <td key={dayNum} className="px-2 py-2 border-r border-border last:border-r-0 align-top">
                          {period ? (
                            <div className={cn(
                              'group relative rounded-xl px-3 py-2 text-xs transition-all hover:shadow-sm cursor-default',
                              hasConflict ? CONFLICT_CELL : getColor(period.subject_name)
                            )}>
                              <div className="flex items-start justify-between gap-1">
                                <p className="font-semibold leading-tight flex items-center gap-1">
                                  {hasConflict && <AlertTriangle className="w-3 h-3 text-destructive flex-shrink-0" />}
                                  {period.subject_name}
                                </p>
                                {viewMode === 'class' && canManage && (
                                  <button onClick={() => deleteMutation.mutate(period.id)} aria-label={`Remove ${period.subject_name}`}
                                    className="-mr-1.5 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-destructive/70 opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {viewMode === 'teacher' && period.classes?.name && (
                                <p className="text-xs font-medium opacity-80 mt-0.5">{period.classes.name}{period.sections?.name ? ` · ${period.sections.name}` : ''}</p>
                              )}
                              {!period.is_break && period.users?.full_name && viewMode === 'class' && (
                                <p className="text-xs opacity-60 truncate mt-0.5">{period.users.full_name.split(' ')[0]}</p>
                              )}
                              {!period.is_break && period.room && (
                                <p className="text-xs opacity-50 mt-0.5">{period.room}</p>
                              )}
                            </div>
                          ) : viewMode === 'class' && canManage ? (
                            <button onClick={() => {
                              setAddingDay(dayNum)
                              const known = (timetableData ?? []).find((p: any) => p.period_number === periodNum)
                              setLockedPeriod(known ? { number: periodNum, start: known.start_time?.slice(0, 5), end: known.end_time?.slice(0, 5) } : null)
                              setShowAdd(true)
                            }} aria-label={`Add period on ${DAY_SHORT[dayNum - 1]}, period ${periodNum}`}
                              className="w-full h-14 border-2 border-dashed border-border rounded-xl text-muted-foreground/40 hover:border-primary/40 hover:text-primary/60 transition-all flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                              <Plus className="w-4 h-4" />
                            </button>
                          ) : (
                            <div className="w-full h-14 rounded-xl bg-muted/50" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {allPeriods.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyState
                        icon={Clock}
                        title="No periods scheduled yet"
                        description={viewMode === 'class'
                          ? 'This class has no timetable for the week. Add a period to any day to start building it.'
                          : 'This teacher has no periods assigned this week.'}
                        action={viewMode === 'class' && canManage ? (
                          <Button onClick={() => { setAddingDay(1); setLockedPeriod(null); setShowAdd(true) }}>
                            <Plus className="w-4 h-4" /> Add Period
                          </Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {allPeriods.length > 0 && (
            <div className="px-5 py-3 border-t border-border bg-muted/30 flex flex-wrap gap-2">
              {Array.from(new Set((timetableData ?? []).filter((p: any) => !p.is_break).map((p: any) => p.subject_name))).map((subject: any) => (
                <span key={subject} className={cn('px-2.5 py-1 rounded-full text-xs font-medium', getColor(subject))}>
                  {subject}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ── LIST VIEW ─────────────────────────────────────────
        <div className="space-y-3">
          {DAYS.map((day, idx) => {
            const dayNum = idx + 1
            const periods = byDay[dayNum] ?? []
            return (
              <div key={day} className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-muted/50 border-b border-border">
                  <h3 className="font-semibold text-foreground text-sm">{day}</h3>
                  {viewMode === 'class' && canManage && (
                    <button onClick={() => { setAddingDay(dayNum); setLockedPeriod(null); setShowAdd(true) }}
                      className="-my-1.5 flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-accent hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <Plus className="w-3.5 h-3.5" /> Add Period
                    </button>
                  )}
                </div>
                {periods.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted-foreground">No periods scheduled</p>
                ) : (
                  <div className="flex flex-wrap gap-2 p-4">
                    {periods.map((p: any) => {
                      const hasConflict = conflicts.has(p.id)
                      return (
                        <div key={p.id} className={cn(
                          'group relative flex flex-col gap-1 px-4 py-3 rounded-xl text-xs min-w-[130px]',
                          hasConflict ? CONFLICT_CELL : getColor(p.subject_name)
                        )}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm flex items-center gap-1">
                              {hasConflict && <AlertTriangle className="w-3 h-3 text-destructive" />}
                              {p.subject_name}
                            </span>
                            {viewMode === 'class' && canManage && (
                              <button onClick={() => deleteMutation.mutate(p.id)} aria-label={`Remove ${p.subject_name}`}
                                className="-mr-1.5 -my-1 flex h-8 w-8 items-center justify-center rounded-md text-destructive/70 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <span className="opacity-70">{!p.is_break && `P${p.period_number} · `}{p.start_time?.slice(0,5)}–{p.end_time?.slice(0,5)}</span>
                          {viewMode === 'teacher' && p.classes?.name && <span className="font-medium opacity-80">{p.classes.name}</span>}
                          {p.room && <span className="opacity-50">{p.room}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && selectedClass && canManage && (
        <AddPeriodModal
          classId={selectedClass}
          sectionId={selectedSection || undefined}
          dayOfWeek={addingDay}
          existingPeriods={byDay[addingDay] ?? []}
          lockedPeriod={lockedPeriod}
          onClose={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['timetable'] }) }}
        />
      )}

      {showPrint && (
        <PrintModal
          timetableData={timetableData ?? []}
          label={printLabel}
          viewMode={viewMode}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  )
}

// ── ADD PERIOD MODAL ──────────────────────────────────────────
// lockedPeriod is set when this was opened from a specific empty grid
// cell (as opposed to the day header's generic "Add Period" button) — the
// slot is already determined by which cell was clicked, so period number
// and start/end time are pre-filled from it and shown read-only instead
// of asking the admin to re-enter values the grid already told them.
function AddPeriodModal({ classId, sectionId, dayOfWeek, existingPeriods, lockedPeriod, onClose }: {
  classId: string; sectionId?: string; dayOfWeek: number; existingPeriods: any[]
  lockedPeriod?: { number: number; start: string; end: string } | null; onClose: () => void
}) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  // Breaks are stored with a sentinel period_number (e.g. 105) so they sort
  // last — counting them here is what produced "next period = 106". The next
  // teaching period follows the real teaching periods only.
  const teachingPeriods = existingPeriods.filter(p => !p.is_break)
  const nextPeriod = teachingPeriods.length > 0 ? Math.max(...teachingPeriods.map(p => p.period_number)) + 1 : 1
  // Start the new period where the day currently ends (latest end time),
  // not at whichever row happens to be last in the array.
  const lastEnd = existingPeriods.length > 0
    ? (existingPeriods.map(p => p.end_time?.slice(0, 5)).filter(Boolean).sort().pop() ?? '08:00')
    : '08:00'

  const [form, setForm] = useState(lockedPeriod
    ? { day_of_week: dayOfWeek, period_number: lockedPeriod.number, start_time: lockedPeriod.start, end_time: lockedPeriod.end, subject_name: '', room: '', is_break: false }
    : { day_of_week: dayOfWeek, period_number: nextPeriod, start_time: lastEnd, end_time: '', subject_name: '', room: '', is_break: false })
  const [teacherId, setTeacherId] = useState('')
  const [loading, setLoading] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const { data: teachersData } = useQuery({
    queryKey: ['all-teachers'],
    queryFn: () => api.get('/students/timetable/teachers').then(r => r.data.data).catch(() => []),
  })

  // Subjects come from the school's master list (Settings -> Classes &
  // Sections), not free text — this is the same list Homework and
  // Syllabus draw from, so a teacher scheduled here for "Mathematics"
  // matches exactly what shows up on their Homework/Syllabus view.
  const { data: subjectsData } = useQuery({
    queryKey: ['subjects', classId],
    queryFn: () => classesApi.subjects.list(classId).then(r => r.data),
  })

  // The selected teacher's FULL school-wide schedule — this modal only
  // ever has this one class/section's periods loaded (existingPeriods),
  // so without a separate fetch a clash in a different class would go
  // undetected here until the save itself gets rejected by the backend.
  const { data: teacherSchedule } = useQuery({
    queryKey: ['teacher-schedule', teacherId],
    queryFn: () => timetableApi.get({ teacher_id: teacherId }).then(r => r.data),
    enabled: !!teacherId,
  })

  // Who's already teaching something else, anywhere in the school, at
  // this exact day+period — reuses the same free-faculty endpoint the
  // Free Faculty page and substitute-finder already rely on for "who's
  // busy at this slot", so this dropdown can't disagree with them.
  const { data: freeFacultyData } = useQuery({
    queryKey: ['add-period-busy', form.day_of_week, form.period_number],
    queryFn: () => timetableApi.freeFaculty(form.day_of_week, form.period_number).then(r => r.data),
    enabled: !form.is_break && !!form.day_of_week && !!form.period_number,
  })
  const busyTeacherIds = new Set((freeFacultyData?.busy ?? []).map((b: any) => b.teacher_id))

  const calcEnd = (start: string, mins = 45) => {
    const [h, m] = start.split(':').map(Number)
    const t = h * 60 + m + mins
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`
  }

  // Busy (already teaching another class this slot) is a hard exclusion —
  // never suggest a double-booking, even in the "nobody qualifies" fallback
  // below. Qualification on top of that still degrades gracefully so a
  // genuinely new subject/slot combo doesn't dead-end the picker.
  const availableTeachers = (teachersData ?? []).filter((t: any) => !busyTeacherIds.has(t.id))
  const qualifiedTeachers = form.subject_name
    ? availableTeachers.filter((t: any) => (t.subjects ?? []).includes(form.subject_name))
    : availableTeachers
  const noQualifiedTeacher = !!form.subject_name && qualifiedTeachers.length === 0 && availableTeachers.length > 0
  const teacherOptions = noQualifiedTeacher ? availableTeachers : qualifiedTeachers

  // Only offer subjects that have at least one available (qualified, not
  // busy this slot) teacher — falls back to the full list if that would
  // otherwise leave nothing selectable at all (e.g. this school's busiest
  // slot, where literally everyone is already teaching something).
  const allSubjectOptions = subjectsData ?? []
  const availableSubjectOptions = allSubjectOptions.filter((s: any) =>
    (teachersData ?? []).some((t: any) => !busyTeacherIds.has(t.id) && (t.subjects ?? []).includes(s.name)),
  )
  const noAvailableSubject = availableSubjectOptions.length === 0 && allSubjectOptions.length > 0
  const subjectOptions = noAvailableSubject ? allSubjectOptions : availableSubjectOptions

  // Re-derives whenever the teacher, day, period, or their fetched
  // schedule changes — an imperative check-on-select can't see the result
  // of a query that hasn't resolved yet.
  useEffect(() => {
    if (!teacherId) { setConflict(null); return }
    const clash = (teacherSchedule ?? []).find((p: any) =>
      p.teacher_id === teacherId && p.day_of_week === form.day_of_week && p.period_number === form.period_number && !p.is_break &&
      !(p.class_id === classId && (p.section_id ?? '') === (sectionId ?? '')),
    )
    if (clash) {
      setConflict(`${(teachersData ?? []).find((t: any) => t.id === teacherId)?.full_name ?? 'This teacher'} already teaches ${clash.classes?.name}${clash.sections?.name ? ` - ${clash.sections.name}` : ''} at this slot`)
    } else {
      setConflict(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, form.day_of_week, form.period_number, teacherSchedule])

  const handleSave = async () => {
    if (!form.subject_name && !form.is_break) return toast.error('Subject name required')
    if (!form.start_time || !form.end_time) return toast.error('Start and end time required')
    if (conflict) return toast.error('Resolve the teacher conflict first')
    setLoading(true)
    try {
      await timetableApi.save([{
        class_id: classId, section_id: sectionId || null, academic_year_id: null,
        day_of_week: form.day_of_week, period_number: form.period_number,
        start_time: form.start_time, end_time: form.end_time,
        subject_name: form.is_break ? (form.subject_name || 'Break') : form.subject_name,
        teacher_id: teacherId || null, room: form.room || null, is_break: form.is_break,
      }])
      toast.success('Period added!')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Period — {DAYS[form.day_of_week - 1]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Break toggle */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
            <span className="text-sm font-medium text-foreground">Break / Lunch</span>
            <button onClick={() => setForm(f => ({ ...f, is_break: !f.is_break, subject_name: !f.is_break ? 'Break' : '' }))}
              aria-label="Toggle break" role="switch" aria-checked={form.is_break}
              className={cn('w-12 h-6 rounded-full relative transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                form.is_break ? 'bg-primary' : 'bg-muted-foreground/30')}>
              <span className={cn('absolute top-0.5 w-5 h-5 bg-background rounded-full shadow transition-all', form.is_break ? 'left-6' : 'left-0.5')} />
            </button>
          </div>

          {!form.is_break ? (
            <>
              <div className="space-y-1.5">
                <Label>Subject *</Label>
                <Select value={form.subject_name || undefined}
                  onValueChange={v => { setForm(f => ({ ...f, subject_name: v })); setTeacherId('') }}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Select subject..." /></SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {allSubjectOptions.length === 0 ? (
                  <p className="text-xs text-warning mt-1.5">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
                ) : noAvailableSubject && (
                  <p className="text-xs text-muted-foreground mt-1.5">No subject has a free teacher for this slot — showing everyone.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Teacher</Label>
                <Select value={teacherId || 'none'}
                  onValueChange={v => setTeacherId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No teacher assigned</SelectItem>
                    {teacherOptions.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Once a subject is picked, only teachers qualified for it
                    (per staff_profiles.subjects, or derived from their
                    weekly timetable when that hasn't been set) are listed —
                    same qualification rule /timetable/substitutes uses, so
                    "who can teach this" means the same thing everywhere in
                    the app. Falls back to showing everyone when nobody
                    qualifies yet, so a brand-new subject doesn't leave the
                    dropdown empty with no way to assign anyone. */}
                {noQualifiedTeacher && (
                  <p className="text-xs text-muted-foreground mt-1.5">No teacher is set up for {form.subject_name} yet — showing everyone.</p>
                )}
                {conflict && (
                  <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {conflict}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Room</Label>
                <Input value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. Room 12, Lab 2" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Select value={form.subject_name || undefined} onValueChange={v => setForm(f => ({ ...f, subject_name: v }))}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Break">Break</SelectItem>
                  <SelectItem value="Lunch">Lunch</SelectItem>
                  <SelectItem value="Assembly">Assembly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Period No.</Label>
              <Input type="number" min="1" max="12" value={form.period_number} disabled={!!lockedPeriod}
                onChange={e => setForm(f => ({ ...f, period_number: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={form.start_time} disabled={!!lockedPeriod}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value, end_time: calcEnd(e.target.value, f.is_break ? 30 : 45) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={form.end_time} disabled={!!lockedPeriod} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>
          {lockedPeriod && (
            <p className="text-xs text-muted-foreground -mt-2">Locked to the slot you clicked — cancel and use "Add Period" in the day header instead if you meant a different period.</p>
          )}

          {/* Day picker */}
          <div className="space-y-1.5">
            <Label>Day</Label>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
              {/* Single letters repeat (Tue/Thu), so each button carries the
                  full day name for screen readers. */}
              {['M','T','W','T','F','S'].map((d, i) => (
                <button key={i} onClick={() => setForm(f => ({ ...f, day_of_week: i+1 }))}
                  aria-label={DAYS[i]} aria-pressed={form.day_of_week === i+1}
                  className={cn('h-9 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    form.day_of_week === i+1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70')}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || !!conflict}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Add Period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── PRINT MODAL ───────────────────────────────────────────────
function PrintModal({ timetableData, label, viewMode, onClose }: {
  timetableData: any[]; label: string; viewMode: string; onClose: () => void
}) {
  const byDay: Record<number, any[]> = {}
  for (let d = 1; d <= 6; d++) byDay[d] = []
  for (const p of timetableData) {
    byDay[p.day_of_week].push(p)
    byDay[p.day_of_week].sort((a: any, b: any) => a.period_number - b.period_number)
  }

  const allPeriods = Array.from(new Set(timetableData.map(p => p.period_number))).sort((a, b) => Number(a) - Number(b))
  const timeByPeriod: Record<number, string> = {}
  for (const p of timetableData) timeByPeriod[p.period_number] = `${p.start_time?.slice(0,5)}–${p.end_time?.slice(0,5)}`

  const handlePrint = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = allPeriods.map(pNum => {
      const cells = [1,2,3,4,5,6].map(dayNum => {
        const p = (byDay[dayNum] ?? []).find((x: any) => x.period_number === pNum)
        if (!p) return '<td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;"></td>'
        const bg = p.is_break ? '#f3f4f6' : '#eff6ff'
        const extraLine = viewMode === 'teacher' && p.classes?.name ? `<br/><small style="color:#6b7280">${p.classes.name}</small>` : (p.room ? `<br/><small style="color:#9ca3af">${p.room}</small>` : '')
        return `<td style="padding:8px;border:1px solid #e5e7eb;background:${bg};text-align:center;">
          <strong>${p.subject_name}</strong>${extraLine}
        </td>`
      }).join('')
      return `<tr>
        <td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;text-align:center;white-space:nowrap;">
          <strong>P${pNum}</strong><br/><small style="color:#6b7280">${timeByPeriod[Number(pNum)]}</small>
        </td>
        ${cells}
      </tr>`
    }).join('')

    win.document.write(`<!DOCTYPE html><html><head><title>Timetable — ${label}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
      h2 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 0 0 16px; color: #6b7280; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #4F46E5; color: white; padding: 10px 8px; border: 1px solid #4338ca; }
      @media print { @page { size: landscape; margin: 1cm; } }
    </style></head><body>
    <h2>Timetable — ${label}</h2>
    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}</p>
    <table>
      <thead><tr>
        <th>Period / Time</th>
        <th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`)
    win.document.close()
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <div className="text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Printer className="w-7 h-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Print Timetable</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">{label} — {timetableData.filter(p => !p.is_break).length} periods</p>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handlePrint}>Open Print Preview</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── BULK LUNCH MODAL ──────────────────────────────────────────
// Adds a break period (Lunch by default) across every selected
// class/section on every selected day in one action, instead of clicking
// through Add Period 96 times. The backend shifts every existing period
// at or after the chosen time to make room, so this can be dropped in
// mid-schedule (e.g. between Period IV and V) without overwriting
// whatever already occupies that slot number.
function BulkLunchModal({ onClose }: { onClose: () => void }) {
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [label, setLabel] = useState('Lunch')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [selectedClasses, setSelectedClasses] = useState<string[] | null>(null) // null = all classes
  const [loading, setLoading] = useState(false)

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })
  const classList: any[] = Array.isArray(classesData)
    ? classesData
    : Array.isArray((classesData as any)?.data) ? (classesData as any).data : []

  const toggleDay = (d: number) => setDays(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort())
  const toggleClass = (id: string) => setSelectedClasses(cur => {
    const base = cur ?? classList.map((c: any) => c.id)
    return base.includes(id) ? base.filter((x: string) => x !== id) : [...base, id]
  })
  const isClassChecked = (id: string) => selectedClasses === null || selectedClasses.includes(id)

  const handleSave = async () => {
    if (!startTime || !endTime) return toast.error('Start and end time required')
    if (!days.length) return toast.error('Select at least one day')
    setLoading(true)
    try {
      const r = await timetableApi.bulkLunch({
        start_time: startTime, end_time: endTime, subject_name: label, days,
        class_ids: selectedClasses ?? undefined,
      })
      toast.success(`${label} added across ${r.data.lunch_periods_created} class/day slots (${r.data.periods_shifted} existing periods shifted to make room)`)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add lunch break')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Lunch Break — Whole School</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Lunch" />
          </div>
          <div className="space-y-1.5">
            <Label>Days</Label>
            <div className="grid grid-cols-6 gap-1">
              {['M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <button key={i} onClick={() => toggleDay(i + 1)} aria-label={DAYS[i]} aria-pressed={days.includes(i + 1)}
                  className={cn('h-9 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    days.includes(i + 1) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70')}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Classes</Label>
              <button type="button" onClick={() => setSelectedClasses(selectedClasses === null ? [] : null)}
                className="text-xs font-medium text-primary hover:underline">
                {selectedClasses === null ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-border p-2 grid grid-cols-2 gap-1">
              {classList.map((c: any) => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent text-sm cursor-pointer">
                  <input type="checkbox" checked={isClassChecked(c.id)} onChange={() => toggleClass(c.id)} className="accent-primary" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Add {label || 'Break'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
