'use client'
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, admissionApi, academicYearsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, Save, Loader2, ChevronLeft, ChevronRight, Calendar, ShieldOff, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissions } from '@/lib/usePermissions'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave'

// Present/absent/late map onto the semantic tokens. "Leave" has no semantic
// equivalent — it's a neutral category, not a good/bad state — so it keeps a
// solid blue-500 fill, which reads correctly against white text in both themes.
//
// `unselected` gives each button its own color tint even before it's picked
// — previously every unpicked button looked identical (grey outline, letter
// only), so telling P from A from L from LV at a glance meant actually
// reading the tiny label. Color now carries that instead, letter is the
// backup, matching how the row's own left stripe (ROW_STRIPE below) works.
const STATUS_CONFIG = {
  present: { label: 'P', color: 'bg-success text-success-foreground', border: 'border-success', unselected: 'border-success/30 text-success bg-success/5 hover:bg-success/15 hover:border-success/60', icon: CheckCircle },
  absent:  { label: 'A', color: 'bg-destructive text-destructive-foreground', border: 'border-destructive', unselected: 'border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/15 hover:border-destructive/60', icon: XCircle },
  late:    { label: 'L', color: 'bg-warning text-warning-foreground', border: 'border-warning', unselected: 'border-warning/30 text-warning bg-warning/5 hover:bg-warning/15 hover:border-warning/60', icon: Clock },
  leave:   { label: 'LV', color: 'bg-blue-500 text-white', border: 'border-blue-500', unselected: 'border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/5 hover:bg-blue-500/15 hover:border-blue-500/60', icon: Calendar },
}

// Left-edge stripe on each roster row — the fastest possible "have I done
// this one yet" signal scanning down a 30-40 student list, independent of
// reading any button. Transparent (no stripe) means unmarked.
const ROW_STRIPE: Record<AttendanceStatus, string> = {
  present: 'border-l-success',
  absent: 'border-l-destructive',
  late: 'border-l-warning',
  leave: 'border-l-blue-500',
}

const todayStr = new Date().toISOString().slice(0, 10)

// Also used by app/(app)/attendance/report/page.tsx, duplicated rather
// than shared — small enough (one query, one derived field) that two
// independent copies are cheaper than a shared-lib indirection for it.
function useCurrentAcademicYear() {
  const { data } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const current = (data ?? []).find((y: any) => y.is_current) ?? data?.[0]
  if (!current) return null
  return { ...current, effective_end: current.end_date < todayStr ? current.end_date : todayStr }
}

// theme-aware percentage pill classes — also duplicated in the Report page.
const pctColor = (pct: number) =>
  pct >= 75 ? 'text-success bg-success/10' : pct >= 50 ? 'text-warning bg-warning/10' : 'text-destructive bg-destructive/10'

export default function MarkAttendancePage() {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSection, setSelectedSection] = useState('')

  const { can, canAny, isLoading: permLoading } = usePermissions()
  const canView   = can('attendance.view')
  const canManage = canAny('attendance.mark', 'attendance.edit')

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const selectedClassData = (classesData ?? []).find((c: any) => c.id === selectedClass)
  const sections = selectedClassData?.sections ?? []

  if (!permLoading && !canView) {
    return (
      <Card>
        <EmptyState
          icon={ShieldOff}
          title="You don't have access to attendance"
          description="Your role doesn't include the attendance.view permission. Ask a school admin if you need it."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mark Attendance"
        icon={ClipboardList}
        description={canManage ? 'Mark daily attendance by class' : 'View daily attendance by class'}
      />

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={selectedClass}
                onValueChange={v => { setSelectedClass(v); setSelectedSection('') }}>
                <SelectTrigger className="min-w-[160px]">
                  <SelectValue placeholder="Select class..." />
                </SelectTrigger>
                <SelectContent>
                  {(classesData ?? []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sections.length > 0 && (
              <div className="space-y-1.5">
                <Label>Section</Label>
                <Select value={selectedSection || undefined} onValueChange={setSelectedSection}>
                  <SelectTrigger className="min-w-[140px]">
                    <SelectValue placeholder="Select section..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedClass && sections.length > 0 && !selectedSection ? (
        <Card>
          <EmptyState icon={Calendar} title="Select a section" description="Pick a section above to mark or view its attendance." />
        </Card>
      ) : (
        <MarkTab classId={selectedClass} sectionId={selectedSection} className={selectedClassData?.name} canManage={canManage} />
      )}
    </div>
  )
}

// ── MARK TAB — daily marking sheet (unchanged behavior) ────────
function MarkTab({ classId, sectionId, className, canManage }: {
  classId: string; sectionId: string; className?: string; canManage: boolean
}) {
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(today)
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({})
  const [saved, setSaved] = useState(false)
  const qc = useQueryClient()

  const { data: sheet, isLoading } = useQuery({
    queryKey: ['attendance-sheet', classId, sectionId, selectedDate],
    queryFn: () => studentsApi.getClassAttendance(classId, selectedDate, sectionId || undefined).then(r => r.data),
    enabled: !!classId && !!selectedDate,
  })

  // Each student's running attendance % for the academic year to date
  // (start of the current academic year through the selected date) —
  // reuses the same report the Attendance Report page shows, so the
  // number here always matches. Pulled in here so it's visible while
  // actually marking, not just on the report.
  const academicYear = useCurrentAcademicYear()
  const yearToDate = academicYear && selectedDate >= academicYear.start_date
    ? selectedDate : academicYear?.effective_end
  const { data: yearReport } = useQuery({
    queryKey: ['attendance-report-range', classId, sectionId, academicYear?.start_date, yearToDate],
    queryFn: () => studentsApi.getAttendanceReportRange(classId, academicYear!.start_date, yearToDate!, sectionId || undefined).then(r => r.data),
    enabled: !!classId && !!academicYear,
  })
  const percentByStudent = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of yearReport?.students ?? []) map[s.student_id] = s.percentage
    return map
  }, [yearReport])

  // useQuery dropped onSuccess in React Query v5 — seed the editable
  // attendance state from fetched data here instead. Only students with
  // an existing saved record get an entry — everyone else stays absent
  // from this map, which is what "unmarked" means throughout this page
  // (no button selected, excluded from the save payload, counted
  // separately in the stats below). Previously defaulted everyone to
  // 'present', so hitting Save without touching the sheet silently
  // marked the whole class present.
  useEffect(() => {
    if (!sheet) return
    const init: Record<string, AttendanceStatus> = {}
    for (const student of sheet.students ?? []) {
      const existing = sheet.attendance?.find((a: any) => a.student_id === student.id)
      if (existing?.status) init[student.id] = existing.status
    }
    setAttendance(init)
    setSaved(false)
  }, [sheet])

  const saveMutation = useMutation({
    mutationFn: () => studentsApi.saveAttendance({
      class_id: classId,
      section_id: sectionId || null,
      date: selectedDate,
      records: Object.entries(attendance).map(([student_id, status]) => ({ student_id, status })),
    }),
    onSuccess: () => {
      setSaved(true)
      toast.success('Attendance saved!')
      qc.invalidateQueries({ queryKey: ['attendance-sheet'] })
      qc.invalidateQueries({ queryKey: ['attendance-report'] })
      qc.invalidateQueries({ queryKey: ['attendance-report-range'] })
      qc.invalidateQueries({ queryKey: ['attendance-class-summary'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const markAll = (status: AttendanceStatus) => {
    if (!canManage) return
    const updated: Record<string, AttendanceStatus> = {}
    for (const student of sheet?.students ?? []) updated[student.id] = status
    setAttendance(updated)
  }

  const rosterCount = sheet?.students?.length ?? 0

  const changeDate = (days: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => changeDate(-1)} aria-label="Previous day">
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Input type="date" value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  max={today}
                  className="w-auto" />
                <Button variant="ghost" size="icon" onClick={() => changeDate(1)} disabled={selectedDate >= today} aria-label="Next day">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            {canManage && classId && rosterCount > 0 && (
              <div className="space-y-1.5">
                <Label>Mark All</Label>
                <div className="flex gap-2">
                  {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => (
                    <button key={s} onClick={() => markAll(s)}
                      aria-label={`Mark everyone ${s}`}
                      className={cn('rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', STATUS_CONFIG[s].color, STATUS_CONFIG[s].border)}>
                      All {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!canManage && classId && (
        <div className="flex items-center gap-3 rounded-2xl border border-warning/20 bg-warning/10 px-5 py-3">
          <ShieldOff className="h-5 w-5 shrink-0 text-warning" />
          <p className="text-sm text-warning">You have view-only access. Contact an admin to mark or edit attendance.</p>
        </div>
      )}

      {!classId ? (
        <Card>
          <EmptyState
            icon={Calendar}
            title={`Select a class to ${canManage ? 'mark' : 'view'} attendance`}
            description="Choose a class (and section, if you use them) above to load its register."
          />
        </Card>
      ) : isLoading ? (
        <Card className="space-y-3 p-6">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </Card>
      ) : !(sheet?.students ?? []).length ? (
        <Card>
          <EmptyState
            icon={Calendar}
            title="No students found in this class"
            description="Nobody is enrolled in this class or section yet, so there's nothing to mark."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="font-semibold text-foreground">
              {className} — {new Date(selectedDate).toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </h3>
            {canManage && (
              <Button onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className={cn(saved && 'bg-success/15 text-success hover:bg-success/20')}>
                {saveMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                  : saved
                  ? <><CheckCircle className="h-4 w-4" /> Saved!</>
                  : <><Save className="h-4 w-4" /> Save Attendance</>
                }
              </Button>
            )}
          </div>

          <div className="divide-y divide-border">
            {(sheet?.students ?? []).map((student: any, idx: number) => {
              const status = attendance[student.id]
              return (
                <div key={student.id} className={cn(
                  'flex flex-wrap items-center gap-3 border-l-4 px-4 py-3 transition-colors sm:flex-nowrap sm:gap-4 sm:px-5',
                  status ? ROW_STRIPE[status] : 'border-l-transparent',
                  status === 'absent' ? 'bg-destructive/10' : status === 'late' ? 'bg-warning/10' : !status ? 'bg-muted/30' : 'hover:bg-muted/50'
                )}>
                  <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">{idx + 1}</span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {student.photo_url
                      ? <img src={student.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      : `${student.first_name?.[0]}${student.last_name?.[0]}`
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{student.first_name} {student.last_name}</p>
                      {percentByStudent[student.id] !== undefined && (
                        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold', pctColor(percentByStudent[student.id]))}>
                          {percentByStudent[student.id]}% this year
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Roll: {student.roll_number ?? '—'}
                      {student.sections?.name && ` · ${student.sections.name}`}
                    </p>
                  </div>
                  {/* Own full-width row below the student's info on a
                      phone — four 40px touch targets never fit beside a
                      name and roll number on that width, and squeezing
                      them in just clipped the last one off-screen. */}
                  <div className="flex w-full justify-end gap-2 pl-[2.75rem] sm:w-auto sm:justify-start sm:pl-0">
                    {(Object.entries(STATUS_CONFIG) as [AttendanceStatus, any][]).map(([s, config]) => (
                      <button key={s}
                        onClick={() => canManage && setAttendance(a => ({ ...a, [student.id]: s }))}
                        disabled={!canManage}
                        aria-pressed={attendance[student.id] === s}
                        aria-label={`Mark ${student.first_name} ${student.last_name} ${s}`}
                        className={cn(
                          'h-10 w-10 rounded-xl border-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          attendance[student.id] === s
                            ? config.color + ' ' + config.border + ' scale-110 shadow-sm'
                            : config.unselected,
                          !canManage && 'cursor-default opacity-70 hover:bg-transparent'
                        )}>
                        {config.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
