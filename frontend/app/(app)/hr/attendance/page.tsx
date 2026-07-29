'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, ClipboardList, BarChart3, ChevronLeft, ChevronRight, Users, UserCheck } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Tab = 'mark' | 'report'
type RecordState = { status: string; check_in?: string; check_out?: string }

const STATUS_OPTIONS = [
  { key: 'present',  label: 'Present',  color: 'bg-success/10 text-success ring-1 ring-inset ring-success/30' },
  { key: 'absent',   label: 'Absent',   color: 'bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30' },
  { key: 'half_day', label: 'Half Day', color: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/30' },
  { key: 'on_leave', label: 'On Leave', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/30' },
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function StaffAttendancePage() {
  const [tab, setTab] = useState<Tab>('mark')

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3 text-muted-foreground">
          <Link href="/hr/staff"><ArrowLeft className="h-4 w-4" /> Staff Directory</Link>
        </Button>
        <PageHeader
          className="mb-0"
          title="Staff Attendance"
          description={tab === 'mark' ? 'Mark daily attendance for staff members' : 'Monthly attendance report and working-day percentage'}
          icon={UserCheck}
          actions={
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList>
                <TabsTrigger value="mark"><ClipboardList className="h-4 w-4" /> Mark</TabsTrigger>
                <TabsTrigger value="report"><BarChart3 className="h-4 w-4" /> Report</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
      </div>

      {tab === 'mark' ? <MarkTab /> : <ReportTab />}
    </div>
  )
}

// ── MARK TAB — daily marking sheet (unchanged behavior) ────────
function MarkTab() {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [records, setRecords] = useState<Record<string, RecordState>>({})

  const { data: staffData } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })

  const { data: existingAttendance, isLoading } = useQuery({
    queryKey: ['staff-attendance', date],
    queryFn: () => hrmsApi.attendance.list({ date }).then(r => r.data),
  })

  useEffect(() => {
    const init: Record<string, RecordState> = {}
    for (const a of existingAttendance ?? []) {
      init[a.user_id] = { status: a.status, check_in: a.check_in?.slice(0, 5), check_out: a.check_out?.slice(0, 5) }
    }
    setRecords(init)
  }, [existingAttendance])

  const saveMutation = useMutation({
    mutationFn: () => {
      const recs = Object.entries(records).map(([user_id, r]) => ({ user_id, ...r }))
      return hrmsApi.attendance.save({ date, records: recs })
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['staff-attendance'] })
      toast.success(`Attendance saved for ${res.data?.count ?? 0} staff`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to save'),
  })

  const setStatus = (userId: string, status: string) => {
    setRecords(r => ({ ...r, [userId]: { ...r[userId], status } }))
  }

  const setTime = (userId: string, field: 'check_in' | 'check_out', value: string) => {
    setRecords(r => ({ ...r, [userId]: { ...r[userId], [field]: value, status: r[userId]?.status ?? 'present' } }))
  }

  const markAllPresent = () => {
    const all: Record<string, RecordState> = {}
    for (const s of staffData ?? []) all[s.id] = { ...records[s.id], status: 'present' }
    setRecords(all)
  }

  const stats = {
    present: Object.values(records).filter(r => r.status === 'present').length,
    absent: Object.values(records).filter(r => r.status === 'absent').length,
    marked: Object.keys(records).length,
    total: (staffData ?? []).length,
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Attendance
        </Button>
      </div>

      {/* Date selector + stats */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">Date</Label>
            <Input id="attendance-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
          </div>
          <Button variant="outline" onClick={markAllPresent}
            className="border-success/30 text-success hover:bg-success/10 hover:text-success">
            Mark All Present
          </Button>
          <div className="ml-auto flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{stats.present}</p>
              <p className="text-xs text-muted-foreground">Present</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive">{stats.absent}</p>
              <p className="text-xs text-muted-foreground">Absent</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">{stats.marked}/{stats.total}</p>
              <p className="text-xs text-muted-foreground">Marked</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff list */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (staffData ?? []).length === 0 ? (
          <EmptyState
            icon={Users}
            title="No staff to mark"
            description="Invite team members first — everyone with a staff account shows up on this sheet."
            action={
              <Button variant="outline" asChild>
                <Link href="/settings/team">Invite a team member</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staffData ?? []).map((s: any) => {
                const rec: Partial<RecordState> = records[s.id] ?? {}
                return (
                  <TableRow key={s.id} className="cursor-default">
                    <TableCell className="font-semibold text-foreground">{s.full_name}</TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">{s.role?.replace('_',' ')}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {STATUS_OPTIONS.map(opt => (
                          <button key={opt.key} onClick={() => setStatus(s.id, opt.key)}
                            aria-pressed={rec.status === opt.key}
                            aria-label={`Mark ${s.full_name} ${opt.label}`}
                            className={cn('rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-all',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              rec.status === opt.key ? opt.color : 'bg-background text-muted-foreground ring-border hover:ring-muted-foreground/40')}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input type="time" value={rec.check_in ?? ''} onChange={e => setTime(s.id, 'check_in', e.target.value)}
                        className="h-8 w-28 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="time" value={rec.check_out ?? ''} onChange={e => setTime(s.id, 'check_out', e.target.value)}
                        className="h-8 w-28 text-xs" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

// ── REPORT TAB — monthly per-staff rollup, same shape as the
// student attendance report (working days from the shared academic
// calendar: weekly-off + holidays) ──────────────────────────────
function ReportTab() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data, isLoading } = useQuery({
    queryKey: ['staff-attendance-report', month, year],
    queryFn: () => hrmsApi.attendance.report(month, year).then(r => r.data),
  })

  const staff = data?.staff ?? []
  const workingDays = data?.working_days ?? 0
  const holidaysInMonth = data?.holidays_in_month ?? 0

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m); setYear(y)
  }

  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)

  const pctColor = (pct: number) =>
    pct >= 75 ? 'text-success bg-success/10 ring-1 ring-inset ring-success/20'
    : pct >= 50 ? 'text-warning bg-warning/10 ring-1 ring-inset ring-warning/20'
    : 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/20'

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1.5">
              <Label>Month</Label>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} aria-label="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="w-36 text-center text-sm font-medium text-foreground">{MONTHS[month - 1]} {year}</span>
                <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} disabled={isFutureMonth} aria-label="Next month">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              Working days this month: <span className="font-semibold text-foreground">{workingDays}</span>
              {holidaysInMonth > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">{holidaysInMonth} holiday{holidaysInMonth > 1 ? 's' : ''} excluded</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      ) : staff.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No staff found"
            description="Nobody has a staff account for this school yet, so there's nothing to report on."
          />
        </Card>
      ) : workingDays === 0 ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title={`No working days in ${MONTHS[month - 1]} ${year}`}
            description="Every date in this month is a holiday or weekly-off on the academic calendar, so no attendance percentage can be calculated."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle>{MONTHS[month - 1]} {year}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-center">Present</TableHead>
                <TableHead className="text-center">Absent</TableHead>
                <TableHead className="text-center">Half Day</TableHead>
                <TableHead className="text-center">On Leave</TableHead>
                <TableHead className="text-center">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s: any) => (
                <TableRow key={s.user_id} className="cursor-default">
                  <TableCell>
                    <p className="font-medium text-foreground">{s.full_name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{s.role?.replace('_', ' ')}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.department ?? '—'}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.present}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.absent}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.half_day}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.on_leave}</TableCell>
                  <TableCell className="text-center">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold', pctColor(s.percentage))}>
                      {s.percentage}%
                    </span>
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
