'use client'
import { useState, useEffect } from 'react'
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

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Decorative per-subject color coding for timetable cells. These are
// categorical — they identify a subject, not a state — so they deliberately sit
// outside the semantic token scale and must stay distinguishable from each
// other. Every entry uses the `bg-<hue>-500/10 + text-<hue>-600
// dark:text-<hue>-400 + inset ring` form, which reads in both themes; the old
// `bg-<hue>-50 + text-<hue>-800` form vanished on a near-black page.
// Break / Lunch / Assembly are not subjects — they're gaps in the day — so they
// take the neutral surface token instead of a hue.
const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics':       'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-inset ring-indigo-500/20',
  'English':           'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20',
  'Science':           'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20',
  'Hindi':             'bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-1 ring-inset ring-orange-500/20',
  'Social Studies':    'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20',
  'Computer':          'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 ring-1 ring-inset ring-cyan-500/20',
  'Art':               'bg-pink-500/10 text-pink-600 dark:text-pink-400 ring-1 ring-inset ring-pink-500/20',
  'Physical Ed':       'bg-lime-500/10 text-lime-600 dark:text-lime-400 ring-1 ring-inset ring-lime-500/20',
  'Sanskrit':          'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 ring-1 ring-inset ring-yellow-500/20',
  'Drawing':           'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-inset ring-rose-500/20',
  'Sports':            'bg-teal-500/10 text-teal-600 dark:text-teal-400 ring-1 ring-inset ring-teal-500/20',
  'Activity':          'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-inset ring-violet-500/20',
  'Moral Science':     'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20',
  'General Knowledge': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-inset ring-sky-500/20',
  'Break':             'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  'Lunch':             'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  'Assembly':          'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
}
const SUBJECT_FALLBACK = 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-inset ring-violet-500/20'
const getColor = (s: string) => SUBJECT_COLORS[s] ?? SUBJECT_FALLBACK

const CONFLICT_CELL = 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/40'

type ViewMode = 'class' | 'teacher' | 'free'

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

export default function TimetablePage() {
  const [selectedClass,   setSelectedClass]   = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [viewMode,        setViewMode]        = useState<ViewMode>('class')
  const [gridOrList,      setGridOrList]      = useState<'grid'|'list'>('grid')
  const [showAdd,         setShowAdd]         = useState(false)
  const [addingDay,       setAddingDay]       = useState(1)
  const [showPrint,       setShowPrint]       = useState(false)
  const qc = useQueryClient()

  // ── RBAC ──────────────────────────────────────────────────
  const { can, isLoading: permLoading } = usePermissions()
  const { isRole } = useAuth()
  const canView   = can('timetable.view')
  const canManage = can('timetable.manage')
  const canSeeFreeFaculty = isRole('principal', 'school_admin')

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: teachersData } = useQuery({
    queryKey: ['all-teachers'],
    queryFn: () => api.get('/students/timetable/teachers').then(r => r.data.data).catch(() => []),
  })

  const selectedClassObj = (classesData ?? []).find((c: any) => c.id === selectedClass)
  const sections = selectedClassObj?.sections ?? []

  const { data: timetableData, isLoading } = useQuery({
    queryKey: ['timetable', selectedClass, selectedSection, selectedTeacher, viewMode],
    queryFn: () => timetableApi.get({
      class_id: viewMode === 'class' ? selectedClass : undefined,
      section_id: viewMode === 'class' && selectedSection ? selectedSection : undefined,
      teacher_id: viewMode === 'teacher' ? selectedTeacher : undefined,
    }).then(r => r.data),
    enabled: viewMode === 'class' ? !!selectedClass : !!selectedTeacher,
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

  // Conflict detection — teacher double booked
  const conflicts: Set<string> = new Set()
  if (viewMode === 'class' && timetableData) {
    const teacherSlots: Record<string, string[]> = {}
    for (const p of timetableData) {
      if (!p.teacher_id || p.is_break) continue
      const key = `${p.teacher_id}_${p.day_of_week}_${p.period_number}`
      if (!teacherSlots[key]) teacherSlots[key] = []
      teacherSlots[key].push(p.id)
    }
    for (const ids of Object.values(teacherSlots)) {
      if (ids.length > 1) ids.forEach(id => conflicts.add(id))
    }
  }

  const stats = {
    total:    (timetableData ?? []).filter((p: any) => !p.is_break).length,
    subjects: new Set((timetableData ?? []).filter((p: any) => !p.is_break).map((p: any) => p.subject_name)).size,
    breaks:   (timetableData ?? []).filter((p: any) => p.is_break).length,
    conflicts: conflicts.size,
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
              {canSeeFreeFaculty && (
                <SegBtn active={viewMode === 'free'} onClick={() => setViewMode('free')}>
                  <UserCheck className="w-3.5 h-3.5" /> Free Faculty
                </SegBtn>
              )}
            </div>
            {/* Grid/List */}
            {viewMode !== 'free' && (
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
            {viewMode !== 'free' && timetableData && timetableData.length > 0 && (
              <Button variant="outline" onClick={() => setShowPrint(true)}>
                <Printer className="w-4 h-4" /> Print
              </Button>
            )}
          </>
        }
      />

      {viewMode === 'free' ? (
        <FreeFacultyView />
      ) : (
      <>
      {/* Selectors */}
      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        {viewMode === 'class' ? (
          <>
            <div className="flex items-center gap-2">
              <Label className="shrink-0">Class</Label>
              <Select value={selectedClass || undefined} onValueChange={v => { setSelectedClass(v); setSelectedSection('') }}>
                <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
                <SelectContent>
                  {(classesData ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {sections.length > 0 && (
              <div className="flex items-center gap-2">
                <Label className="shrink-0">Section</Label>
                <Select value={selectedSection || 'all'} onValueChange={v => setSelectedSection(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-9 min-w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sections</SelectItem>
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
                <p className="text-2xl font-bold text-destructive">{stats.conflicts}</p>
                <p className="text-xs text-destructive/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Conflicts</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Conflict banner */}
      {stats.conflicts > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Teacher conflict detected</p>
            <p className="text-xs text-destructive/80 mt-0.5">A teacher is assigned to multiple periods at the same time. Conflicting periods are highlighted in red.</p>
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
                          <button onClick={() => { setAddingDay(idx + 1); setShowAdd(true) }} aria-label={`Add period on ${day}`}
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
                      <p className="text-xs font-bold text-foreground">P{periodNum}</p>
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
                                {viewMode === 'class' && !period.is_break && canManage && (
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
                            <button onClick={() => { setAddingDay(dayNum); setShowAdd(true) }} aria-label={`Add period on ${DAY_SHORT[dayNum - 1]}, period ${periodNum}`}
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
                          <Button onClick={() => { setAddingDay(1); setShowAdd(true) }}>
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
                    <button onClick={() => { setAddingDay(dayNum); setShowAdd(true) }}
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
                            {viewMode === 'class' && !p.is_break && canManage && (
                              <button onClick={() => deleteMutation.mutate(p.id)} aria-label={`Remove ${p.subject_name}`}
                                className="-mr-1.5 -my-1 flex h-8 w-8 items-center justify-center rounded-md text-destructive/70 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <span className="opacity-70">P{p.period_number} · {p.start_time?.slice(0,5)}–{p.end_time?.slice(0,5)}</span>
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
      </>
      )}

      {showAdd && selectedClass && canManage && (
        <AddPeriodModal
          classId={selectedClass}
          sectionId={selectedSection || undefined}
          dayOfWeek={addingDay}
          existingPeriods={byDay[addingDay] ?? []}
          allPeriods={timetableData ?? []}
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

// ── ATTENTION REQUIRED — periods happening RIGHT NOW where the
// assigned teacher's check-in doesn't line up: no check-in recorded
// yet, marked absent/on leave, or checked in after the period had
// already started. Cross-references the timetable against today's
// staff check-in/out times (HR → Attendance), which otherwise never
// talk to each other. Polls every 60s since "right now" keeps moving.
function AttentionRequiredPanel({ onFindSubstitute }: { onFindSubstitute: (day: number, period: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable-attention-required'],
    queryFn: () => timetableApi.attentionRequired().then((r: any) => r.data),
    refetchInterval: 60_000,
  })

  const REASON_STYLES: Record<string, string> = {
    not_checked_in: 'bg-destructive/10 text-destructive',
    absent: 'bg-destructive/10 text-destructive',
    on_leave: 'bg-warning/10 text-warning',
    no_checkin_time: 'bg-warning/10 text-warning',
    checked_in_late: 'bg-warning/10 text-warning',
  }

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-2xl" />
  }

  // Sunday — nothing scheduled, nothing to check.
  if (!data?.day_of_week) {
    return (
      <div className="bg-muted/50 border border-border rounded-2xl px-5 py-4 flex items-center gap-3">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No school today — nothing to check.</p>
      </div>
    )
  }

  const flagged: any[] = data?.flagged ?? []
  const periodsInProgress: number = data?.periods_in_progress ?? 0

  // A school day, but no period is running this exact minute (before
  // first bell, during a gap, after the last period) — distinct from
  // "classes in session and all covered," so it needs its own message
  // rather than silently looking identical to "all good."
  if (periodsInProgress === 0) {
    return (
      <div className="bg-muted/50 border border-border rounded-2xl px-5 py-4 flex items-center gap-3">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No class is in session right now — check back once periods start.</p>
      </div>
    )
  }

  if (flagged.length === 0) {
    return (
      <div className="bg-success/10 border border-success/30 rounded-2xl px-5 py-4 flex items-center gap-3">
        <UserCheck className="w-4 h-4 text-success" />
        <p className="text-sm text-success">All {periodsInProgress} class{periodsInProgress !== 1 ? 'es' : ''} in session right now {periodsInProgress !== 1 ? 'are' : 'is'} covered.</p>
      </div>
    )
  }

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <h3 className="font-semibold text-destructive">Classes Needing Immediate Attention</h3>
        <span className="text-xs text-destructive/70">({flagged.length} right now)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {flagged.map((f: any) => (
          <div key={f.period_id} className="bg-card rounded-xl border border-destructive/20 p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {f.class_name}{f.section_name ? ` - ${f.section_name}` : ''} · {f.subject_name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                P{f.period_number} · {f.start_time?.slice(0, 5)}–{f.end_time?.slice(0, 5)} · {f.teacher_name}{f.room ? ` · ${f.room}` : ''}
              </p>
              <span className={cn('inline-block mt-2 px-2 py-0.5 rounded-full text-[11px] font-semibold', REASON_STYLES[f.reason] ?? 'bg-muted text-muted-foreground')}>
                {f.reason_label}
              </span>
            </div>
            <Button size="sm" onClick={() => onFindSubstitute(data.day_of_week, f.period_number)}>
              Find Substitute
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── FREE FACULTY VIEW — who's free at a given day + period, for
// finding a substitute. Principal/Admin only (the page already hides
// the tab for other roles, and the backend enforces the same gate).
//
// Defaults to "right now" when viewing today: once the day's periods
// load, it finds whichever period's start/end window contains the
// current time and auto-selects it — the common case is "someone's
// out RIGHT NOW, who can cover," not browsing a hypothetical slot.
function FreeFacultyView() {
  const jsDay = new Date().getDay() // 0=Sun..6=Sat; this schema's day_of_week is 1=Mon..6=Sat
  const todayDayOfWeek = jsDay === 0 ? 1 : jsDay
  const [day, setDay] = useState(todayDayOfWeek)
  const [period, setPeriod] = useState<number | ''>('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [autoPicked, setAutoPicked] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['free-faculty', day, period],
    queryFn: () => timetableApi.freeFaculty(day, period === '' ? undefined : period).then((r: any) => r.data),
  })

  useEffect(() => {
    if (autoPicked || period !== '' || !data?.available_periods?.length) return
    if (day === todayDayOfWeek) {
      const nowStr = new Date().toTimeString().slice(0, 8)
      const current = data.available_periods.find((p: any) => p.start_time <= nowStr && nowStr <= p.end_time)
      if (current) setPeriod(current.period_number)
    }
    setAutoPicked(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const availablePeriods = data?.available_periods ?? []
  const freeTeachers: any[] = data?.free ?? []
  const busyTeachers: any[] = data?.busy ?? []
  const allSubjects = Array.from(new Set(freeTeachers.flatMap((t: any) => t.subjects_today as string[]))).sort()
  const shownFree = subjectFilter ? freeTeachers.filter(t => t.subjects_today.includes(subjectFilter)) : freeTeachers
  const selectedPeriodInfo = availablePeriods.find((p: any) => p.period_number === period)

  return (
    <div className="space-y-5">
      <AttentionRequiredPanel onFindSubstitute={(d, p) => { setDay(d); setPeriod(p); setAutoPicked(true) }} />

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Day</Label>
          <Select value={String(day)} onValueChange={v => { setDay(Number(v)); setPeriod(''); setAutoPicked(false) }}>
            <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Period</Label>
          <Select value={period === '' ? 'all' : String(period)} onValueChange={v => setPeriod(v === 'all' ? '' : Number(v))}>
            <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole day (any period)</SelectItem>
              {availablePeriods.map((p: any) => (
                <SelectItem key={p.period_number} value={String(p.period_number)}>
                  P{p.period_number} · {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {allSubjects.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Subject</Label>
            <Select value={subjectFilter || 'any'} onValueChange={v => setSubjectFilter(v === 'any' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any subject</SelectItem>
                {allSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {period !== '' && (
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{shownFree.length}</p>
              <p className="text-xs text-muted-foreground">Free</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">{busyTeachers.length}</p>
              <p className="text-xs text-muted-foreground">Teaching</p>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        // Two side-by-side panels (Free / Teaching) land here.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : availablePeriods.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Clock}
            title={`No periods scheduled on ${DAYS[day - 1]} yet`}
            description="Who's free is worked out from the timetable — build this day's schedule first, then come back."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Free */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-success" />
                Free {selectedPeriodInfo ? `— P${selectedPeriodInfo.period_number} (${selectedPeriodInfo.start_time?.slice(0,5)}–${selectedPeriodInfo.end_time?.slice(0,5)})` : ''}
              </h3>
              <span className="text-xs text-muted-foreground">{shownFree.length}</span>
            </div>
            {period === '' ? (
              <EmptyState icon={Clock} title="Pick a period" description="Choose a period above to see which teachers are free at that time." className="py-10" />
            ) : shownFree.length === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="No one's free at this period"
                description={subjectFilter
                  ? `Every ${subjectFilter} teacher is already teaching. Clear the subject filter to widen the search.`
                  : 'Every teacher is already teaching this period. Try a neighbouring period.'}
                className="py-10"
              />
            ) : (
              <div className="divide-y divide-border">
                {shownFree.map((t: any) => (
                  <div key={t.id} className="px-5 py-3">
                    <p className="text-sm font-semibold text-foreground">{t.full_name}</p>
                    {t.subjects_today.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> {t.subjects_today.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Busy */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" /> Teaching Right Now
              </h3>
              <span className="text-xs text-muted-foreground">{busyTeachers.length}</span>
            </div>
            {period === '' ? (
              <EmptyState icon={Clock} title="Pick a period" description="Choose a period above to see who is teaching at that time." className="py-10" />
            ) : busyTeachers.length === 0 ? (
              <EmptyState icon={User} title="No one is teaching" description="Nothing is scheduled for this period — it's free for everyone." className="py-10" />
            ) : (
              <div className="divide-y divide-border">
                {busyTeachers.map((b: any) => (
                  <div key={b.teacher_id} className="px-5 py-3">
                    <p className="text-sm font-semibold text-foreground">{b.full_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {b.subject_name} · {b.class_name}{b.section_name ? ` - ${b.section_name}` : ''}
                      {b.room ? ` · ${b.room}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ADD PERIOD MODAL ──────────────────────────────────────────
function AddPeriodModal({ classId, sectionId, dayOfWeek, existingPeriods, allPeriods, onClose }: {
  classId: string; sectionId?: string; dayOfWeek: number; existingPeriods: any[]; allPeriods: any[]; onClose: () => void
}) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const nextPeriod = existingPeriods.length > 0 ? Math.max(...existingPeriods.map(p => p.period_number)) + 1 : 1
  const lastEnd = existingPeriods.length > 0 ? existingPeriods[existingPeriods.length-1]?.end_time?.slice(0,5) ?? '08:00' : '08:00'

  const [form, setForm] = useState({ day_of_week: dayOfWeek, period_number: nextPeriod, start_time: lastEnd, end_time: '', subject_name: '', room: '', is_break: false })
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

  const calcEnd = (start: string, mins = 45) => {
    const [h, m] = start.split(':').map(Number)
    const t = h * 60 + m + mins
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`
  }

  const checkConflict = (tid: string, day: number, period: number) => {
    if (!tid) { setConflict(null); return }
    const clash = allPeriods.find((p: any) =>
      p.teacher_id === tid && p.day_of_week === day && p.period_number === period && !p.is_break
    )
    if (clash) {
      setConflict(`${(teachersData ?? []).find((t: any) => t.id === tid)?.full_name ?? 'This teacher'} already has ${clash.subject_name} at this slot`)
    } else {
      setConflict(null)
    }
  }

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
                  onValueChange={v => setForm(f => ({ ...f, subject_name: v }))}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Select subject..." /></SelectTrigger>
                  <SelectContent>
                    {(subjectsData ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(subjectsData ?? []).length === 0 && (
                  <p className="text-xs text-warning mt-1.5">No subjects set up for this class yet — add some in Settings → Classes & Sections.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Teacher</Label>
                <Select value={teacherId || 'none'}
                  onValueChange={v => { const tid = v === 'none' ? '' : v; setTeacherId(tid); checkConflict(tid, form.day_of_week, form.period_number) }}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No teacher assigned</SelectItem>
                    {(teachersData ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <Input type="number" min="1" max="12" value={form.period_number}
                onChange={e => { const v = Number(e.target.value); setForm(f => ({ ...f, period_number: v })); checkConflict(teacherId, form.day_of_week, v) }} />
            </div>
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value, end_time: calcEnd(e.target.value, f.is_break ? 30 : 45) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>

          {/* Day picker */}
          <div className="space-y-1.5">
            <Label>Day</Label>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
              {/* Single letters repeat (Tue/Thu), so each button carries the
                  full day name for screen readers. */}
              {['M','T','W','T','F','S'].map((d, i) => (
                <button key={i} onClick={() => { setForm(f => ({ ...f, day_of_week: i+1 })); checkConflict(teacherId, i+1, form.period_number) }}
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
