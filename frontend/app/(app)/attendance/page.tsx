'use client'
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { studentsApi, admissionApi, academicYearsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, Save, Loader2, ChevronLeft, ChevronRight, Calendar, ShieldOff, ClipboardList, BarChart3, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissions } from '@/lib/usePermissions'
import { useAuth } from '@/lib/auth'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave'
type Tab = 'mark' | 'report'

// Present/absent/late map onto the semantic tokens. "Leave" has no semantic
// equivalent — it's a neutral category, not a good/bad state — so it keeps a
// solid blue-500 fill, which reads correctly against white text in both themes.
const STATUS_CONFIG = {
  present: { label: 'P', color: 'bg-success text-success-foreground', border: 'border-success', icon: CheckCircle },
  absent:  { label: 'A', color: 'bg-destructive text-destructive-foreground', border: 'border-destructive', icon: XCircle },
  late:    { label: 'L', color: 'bg-warning text-warning-foreground', border: 'border-warning', icon: Clock },
  leave:   { label: 'LV', color: 'bg-blue-500 text-white', border: 'border-blue-500', icon: Calendar },
}

// Bar-fill colors for the KPI cards, keyed to the semantic status tokens.
const STATUS_BAR: Record<string, string> = {
  present: 'bg-success',
  absent: 'bg-destructive',
  late: 'bg-warning',
  leave: 'bg-blue-500',
  unmarked: 'bg-muted-foreground/40',
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const todayStr = new Date().toISOString().slice(0, 10)

// Shared by the Mark-tab badge and the Report tab's "Academic Year"
// scope so both agree on what "year to date" means.
function useCurrentAcademicYear() {
  const { data } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const current = (data ?? []).find((y: any) => y.is_current) ?? data?.[0]
  if (!current) return null
  return { ...current, effective_end: current.end_date < todayStr ? current.end_date : todayStr }
}

// theme-aware percentage pill classes shared by both tabs
const pctColor = (pct: number) =>
  pct >= 75 ? 'text-success bg-success/10' : pct >= 50 ? 'text-warning bg-warning/10' : 'text-destructive bg-destructive/10'

export default function AttendancePage() {
  const [tab, setTab] = useState<Tab>('mark')
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
    <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
      <PageHeader
        title="Attendance"
        icon={ClipboardList}
        description={
          tab === 'mark'
            ? (canManage ? 'Mark daily attendance by class' : 'View daily attendance by class')
            : 'Monthly attendance report, class-wise or section-wise'
        }
        actions={
          <TabsList>
            <TabsTrigger value="mark"><ClipboardList className="h-4 w-4" /> Mark</TabsTrigger>
            <TabsTrigger value="report"><BarChart3 className="h-4 w-4" /> Report</TabsTrigger>
          </TabsList>
        }
      />

      <div className="space-y-6">
        {/* Class / Section pickers — shared between tabs */}
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
                  <Select value={selectedSection || 'all'}
                    onValueChange={v => setSelectedSection(v === 'all' ? '' : v)}>
                    <SelectTrigger className="min-w-[140px]">
                      <SelectValue placeholder="All sections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sections</SelectItem>
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

        <TabsContent value="mark" className="mt-0">
          <MarkTab classId={selectedClass} sectionId={selectedSection} className={selectedClassData?.name} canManage={canManage} />
        </TabsContent>
        <TabsContent value="report" className="mt-0">
          <ReportTab classId={selectedClass} sectionId={selectedSection} className={selectedClassData?.name} />
        </TabsContent>
      </div>
    </Tabs>
  )
}

// ── CLASS-WISE DAILY CHART — how every class is doing on the
// currently-selected date, not just the one class being marked.
// Principal/School Admin only: a school-wide comparison across every
// class isn't something a teacher or student needs on this page.
//
// Only classes that have actually been marked get a bar — a fully
// "not marked yet" class plotted as a full-width grey bar reads as
// noise next to real data, not information. Those instead collapse
// into a short chip line ("Not marked yet: Class 7, Class 9 …") —
// same fact, one glance instead of a wall of identical grey bars.
// Each bar also carries its own present/absent count as a direct
// label, so the number is visible without hovering.
function ClassWiseAttendanceChart({ date }: { date: string }) {
  const { isRole } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-class-summary', date],
    queryFn: () => studentsApi.attendanceClassSummary(date).then(r => r.data),
    enabled: isRole('principal', 'school_admin'),
  })

  if (!isRole('principal', 'school_admin')) return null

  const allClasses = data?.classes ?? []
  const markedClasses = allClasses.filter((c: any) => c.present + c.absent + c.late + c.leave > 0)
  const unmarkedClasses = allClasses.filter((c: any) => c.present + c.absent + c.late + c.leave === 0)
  const dateLabel = new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (isLoading) {
    return (
      <Card className="space-y-4 p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-[140px] w-full rounded-xl" />
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <h3 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
        <BarChart3 className="h-4 w-4 text-muted-foreground" /> Attendance by Class
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">{dateLabel}</p>

      {!data?.is_working_day ? (
        <EmptyState
          icon={Calendar}
          title="No school on this date"
          description="It's a holiday or weekly off, so there's no attendance to compare."
          className="py-8"
        />
      ) : !allClasses.length ? (
        <EmptyState
          icon={BarChart3}
          title="No students found"
          description="Add students to your classes and their attendance will show up here."
          className="py-8"
        />
      ) : !markedClasses.length ? (
        <EmptyState
          icon={ClipboardList}
          title="No class has been marked yet for this date"
          description="Once a class teacher marks attendance, the comparison appears here."
          className="py-8"
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(140, markedClasses.length * 40)}>
            <BarChart data={markedClasses} layout="vertical" margin={{ left: 8, right: 32 }} barGap={2}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="class_name" tick={{ fontSize: 13, fill: 'hsl(var(--foreground))', fontWeight: 600 }} tickLine={false} axisLine={false} width={70} />
              <Tooltip
                contentStyle={{
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 12,
                  fontSize: 13,
                  background: 'hsl(var(--popover))',
                  color: 'hsl(var(--popover-foreground))',
                  boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)',
                }}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="present" name="Present" fill="hsl(152 62% 45%)" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: 'right', fontSize: 11, fill: 'hsl(152 62% 45%)', fontWeight: 600 }} />
              <Bar dataKey="absent" name="Absent" fill="hsl(0 84% 62%)" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: 'right', fontSize: 11, fill: 'hsl(0 84% 62%)', fontWeight: 600 }} />
            </BarChart>
          </ResponsiveContainer>

          {unmarkedClasses.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium text-muted-foreground">Not marked yet:</span>
              {unmarkedClasses.map((c: any) => (
                <span key={c.class_id} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {c.class_name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
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
  // reuses the same report the Report tab shows, so the number here
  // always matches. Pulled in here so it's visible while actually
  // marking, not just on a separate tab.
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
  const stats = {
    present:  Object.values(attendance).filter(s => s === 'present').length,
    absent:   Object.values(attendance).filter(s => s === 'absent').length,
    late:     Object.values(attendance).filter(s => s === 'late').length,
    leave:    Object.values(attendance).filter(s => s === 'leave').length,
    unmarked: rosterCount - Object.keys(attendance).length,
    total:    rosterCount,
  }

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

      {classId && stats.total > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Present',  count: stats.present,  key: 'present',  pct: Math.round((stats.present/stats.total)*100) },
            { label: 'Absent',   count: stats.absent,   key: 'absent',   pct: Math.round((stats.absent/stats.total)*100) },
            { label: 'Late',     count: stats.late,     key: 'late',     pct: Math.round((stats.late/stats.total)*100) },
            { label: 'Leave',    count: stats.leave,    key: 'leave',    pct: Math.round((stats.leave/stats.total)*100) },
            { label: 'Unmarked', count: stats.unmarked, key: 'unmarked', pct: Math.round((stats.unmarked/stats.total)*100) },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span className="text-lg font-bold text-foreground">{s.count}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div className={cn('h-1.5 rounded-full transition-all', STATUS_BAR[s.key])} style={{ width: `${s.pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.pct}%</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ClassWiseAttendanceChart date={selectedDate} />

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
                  'flex items-center gap-4 px-6 py-3 transition-colors',
                  status === 'absent' ? 'bg-destructive/10' : status === 'late' ? 'bg-warning/10' : !status ? 'bg-muted/30' : 'hover:bg-muted/50'
                )}>
                  <span className="w-6 text-center font-mono text-xs text-muted-foreground">{idx + 1}</span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {student.photo_url
                      ? <img src={student.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      : `${student.first_name?.[0]}${student.last_name?.[0]}`
                    }
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{student.first_name} {student.last_name}</p>
                      {percentByStudent[student.id] !== undefined && (
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', pctColor(percentByStudent[student.id]))}>
                          {percentByStudent[student.id]}% this year
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Roll: {student.roll_number ?? '—'}
                      {student.sections?.name && ` · ${student.sections.name}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(Object.entries(STATUS_CONFIG) as [AttendanceStatus, any][]).map(([s, config]) => (
                      <button key={s}
                        onClick={() => canManage && setAttendance(a => ({ ...a, [student.id]: s }))}
                        disabled={!canManage}
                        aria-pressed={attendance[student.id] === s}
                        aria-label={`Mark ${student.first_name} ${student.last_name} ${s}`}
                        className={cn(
                          'h-9 w-9 rounded-xl border-2 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          attendance[student.id] === s
                            ? config.color + ' ' + config.border + ' scale-110 shadow-sm'
                            : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/40',
                          !canManage && 'cursor-default opacity-70 hover:border-border'
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

// ── REPORT TAB — monthly rollup, class-wise / section-wise, with a
// link into each student's individual (per-day calendar) view ──────
function ReportTab({ classId, sectionId, className }: { classId: string; sectionId: string; className?: string }) {
  const now = new Date()
  const [scope, setScope] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const academicYear = useCurrentAcademicYear()

  const monthQuery = useQuery({
    queryKey: ['attendance-report', classId, sectionId, month, year],
    queryFn: () => studentsApi.getAttendanceReport(classId, month, year, sectionId || undefined).then(r => r.data),
    enabled: !!classId && scope === 'month',
  })
  const yearQuery = useQuery({
    queryKey: ['attendance-report-range', classId, sectionId, academicYear?.start_date, academicYear?.effective_end],
    queryFn: () => studentsApi.getAttendanceReportRange(classId, academicYear!.start_date, academicYear!.effective_end, sectionId || undefined).then(r => r.data),
    enabled: !!classId && scope === 'year' && !!academicYear,
  })
  const { data, isLoading } = scope === 'month' ? monthQuery : yearQuery

  const students = data?.students ?? []
  const workingDays = data?.working_days ?? 0
  const holidaysInMonth = data?.holidays_in_month ?? 0

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)
  const periodLabel = scope === 'month' ? `${MONTHS[month - 1]} ${year}` : (academicYear ? `Academic Year ${academicYear.name}` : 'Academic Year')

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label>Period</Label>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                  <button onClick={() => setScope('month')}
                    aria-pressed={scope === 'month'}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      scope === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    Month
                  </button>
                  <button onClick={() => setScope('year')}
                    aria-pressed={scope === 'year'}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      scope === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    Academic Year
                  </button>
                </div>
              </div>
              {scope === 'month' && (
                <div className="space-y-1.5">
                  <Label>Month</Label>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} aria-label="Previous month">
                      <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <span className="w-36 text-center text-sm font-medium text-foreground">{MONTHS[month - 1]} {year}</span>
                    <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} disabled={isFutureMonth} aria-label="Next month">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {classId && (
              <div className="text-right text-sm text-muted-foreground">
                Working days: <span className="font-semibold text-foreground">{workingDays}</span>
                {holidaysInMonth > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{holidaysInMonth} holiday{holidaysInMonth > 1 ? 's' : ''} excluded</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!classId ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="Select a class to view its attendance report"
            description="Choose a class above to see each student's present, absent and leave totals."
          />
        </Card>
      ) : scope === 'year' && !academicYear ? (
        <div className="rounded-2xl border border-warning/20 bg-warning/10 px-5 py-4 text-sm text-warning">
          No academic year is configured for this school yet.
        </div>
      ) : isLoading ? (
        <Card className="space-y-3 p-6">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No students found in this class"
            description="Nobody is enrolled in this class or section yet, so there's nothing to report on."
          />
        </Card>
      ) : workingDays === 0 ? (
        <div className="rounded-2xl border border-warning/20 bg-warning/10 px-5 py-4 text-sm text-warning">
          Every day in {periodLabel} is a holiday or weekly-off, so no attendance percentage can be calculated.
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <h3 className="font-semibold text-foreground">
              {className}{sectionId ? '' : ' — all sections'} · {periodLabel}
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-6">Student</TableHead>
                {!sectionId && <TableHead>Section</TableHead>}
                <TableHead className="text-center">Present</TableHead>
                <TableHead className="text-center">Absent</TableHead>
                <TableHead className="text-center">Late</TableHead>
                <TableHead className="text-center">Leave</TableHead>
                <TableHead className="text-center">Unmarked</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead className="px-6 text-right">Individual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s: any) => (
                <TableRow key={s.student_id} className="cursor-default">
                  <TableCell className="px-6">
                    <p className="font-medium text-foreground">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-muted-foreground">Roll: {s.roll_number ?? '—'}</p>
                  </TableCell>
                  {!sectionId && <TableCell className="text-muted-foreground">{s.section_name ?? '—'}</TableCell>}
                  <TableCell className="text-center font-mono text-muted-foreground">{s.present}</TableCell>
                  <TableCell className="text-center font-mono text-muted-foreground">{s.absent}</TableCell>
                  <TableCell className="text-center font-mono text-muted-foreground">{s.late}</TableCell>
                  <TableCell className="text-center font-mono text-muted-foreground">{s.leave}</TableCell>
                  <TableCell className="text-center font-mono">
                    {s.unmarked > 0
                      ? <span className="text-warning">{s.unmarked}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', pctColor(s.percentage))}>
                      {s.percentage}%
                    </span>
                  </TableCell>
                  <TableCell className="px-6 text-right">
                    <Link href={`/students/${s.student_id}/attendance`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
