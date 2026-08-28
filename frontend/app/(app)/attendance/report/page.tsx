'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { studentsApi, admissionApi, academicYearsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, BarChart3, ShieldOff, ExternalLink, Calendar, ClipboardList } from 'lucide-react'
import { usePermissions } from '@/lib/usePermissions'
import { useAuth } from '@/lib/auth'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const todayStr = new Date().toISOString().slice(0, 10)

// Also used by app/(app)/attendance/page.tsx (Mark), duplicated rather
// than shared — small enough that two independent copies are cheaper
// than a shared-lib indirection for it.
function useCurrentAcademicYear() {
  const { data } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => academicYearsApi.list().then(r => r.data),
  })
  const current = (data ?? []).find((y: any) => y.is_current) ?? data?.[0]
  if (!current) return null
  return { ...current, effective_end: current.end_date < todayStr ? current.end_date : todayStr }
}

// theme-aware percentage pill classes — also duplicated in the Mark page.
const pctColor = (pct: number) =>
  pct >= 75 ? 'text-success bg-success/10' : pct >= 50 ? 'text-warning bg-warning/10' : 'text-destructive bg-destructive/10'

export default function AttendanceReportPage() {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSection, setSelectedSection] = useState('')

  const { can, isLoading: permLoading } = usePermissions()
  const canView = can('attendance.view')

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
        title="Attendance Report"
        icon={BarChart3}
        description="Monthly attendance report, class-wise or section-wise"
      />

      <ClassWiseAttendanceChart date={todayStr} />

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
          <EmptyState icon={BarChart3} title="Select a section" description="Pick a section above to see its attendance report." />
        </Card>
      ) : (
        <ReportTab classId={selectedClass} sectionId={selectedSection} className={selectedClassData?.name} />
      )}
    </div>
  )
}

// ── monthly rollup, class-wise / section-wise, with a link into each
// student's individual (per-day calendar) view ──────
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

// ── CLASS-WISE DAILY CHART — moved here from Mark Attendance
// (2026-08-28): a school-wide comparison across every class for one day
// is a report/comparison view, not a marking concern — same reasoning
// every other "viewing vs. doing" split got this session. Always
// anchored to today, independent of whatever class/section/period is
// selected in the report below it. Principal/School Admin only: a
// school-wide comparison isn't something a teacher or student needs.
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
