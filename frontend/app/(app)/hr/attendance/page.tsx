'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi, calendarApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Loader2, ClipboardList, BarChart3, ChevronLeft, ChevronRight, Users, UserCheck, Inbox, Clock3, Plus, Trash2, Check, X, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { HrQuickNav } from '@/components/hr/HrQuickNav'
import { StaffAvatar, staffPhotoUrl } from '@/components/hr/StaffAvatar'
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

type Tab = 'mark' | 'report' | 'requests' | 'shifts'
type RecordState = { status: string; check_in?: string; check_out?: string; overtime_hours?: string }

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
          description={
            tab === 'mark' ? 'Mark daily attendance for staff members'
            : tab === 'report' ? 'Monthly attendance report and working-day percentage'
            : tab === 'requests' ? 'Review staff-submitted attendance correction requests'
            : 'Manage shift schedules for staff with a non-standard weekly-off pattern'
          }
          icon={UserCheck}
          actions={
            <>
              <HrQuickNav current="attendance" />
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList>
                  <TabsTrigger value="mark"><ClipboardList className="h-4 w-4" /> Mark</TabsTrigger>
                  <TabsTrigger value="report"><BarChart3 className="h-4 w-4" /> Report</TabsTrigger>
                  <TabsTrigger value="requests"><Inbox className="h-4 w-4" /> Requests</TabsTrigger>
                  <TabsTrigger value="shifts"><Clock3 className="h-4 w-4" /> Shifts</TabsTrigger>
                </TabsList>
              </Tabs>
            </>
          }
        />
      </div>

      {tab === 'mark' ? <MarkTab /> : tab === 'report' ? <ReportTab /> : tab === 'requests' ? <RequestsTab /> : <ShiftsTab />}
    </div>
  )
}

// ── MARK TAB — daily marking sheet (unchanged behavior) ────────
function MarkTab() {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [records, setRecords] = useState<Record<string, RecordState>>({})

  const { data: staffDataRaw } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })
  // Resigned/terminated staff aren't part of ongoing operations — nobody
  // should be marking attendance for someone no longer employed.
  const staffData = (staffDataRaw ?? []).filter((s: any) => !['resigned', 'terminated'].includes(s.staff_profile?.employment_status))

  const { data: existingAttendance, isLoading } = useQuery({
    queryKey: ['staff-attendance', date],
    queryFn: () => hrmsApi.attendance.list({ date }).then(r => r.data),
  })

  // Same academic calendar (holidays + weekly-off) the backend rollup
  // already excludes from working-day counts — surfaced here too so the
  // marking sheet doesn't read as "nobody's attendance is marked" on a
  // day nobody was expected to mark in the first place.
  const dateYear = Number(date.slice(0, 4))
  const { data: holidaysInYear } = useQuery({
    queryKey: ['calendar-holidays', dateYear],
    queryFn: () => calendarApi.holidays.list(dateYear).then(r => r.data),
  })
  const { data: weeklyOff } = useQuery({
    queryKey: ['calendar-weekly-off'],
    queryFn: () => calendarApi.weeklyOff.get().then(r => r.data),
    staleTime: 60 * 60 * 1000,
  })
  const holidayToday = (holidaysInYear ?? []).find((h: any) => h.date === date)
  const isWeeklyOffToday = (weeklyOff?.weekly_off_days ?? []).includes(new Date(`${date}T00:00:00`).getDay())
  const isNonWorkingDay = !!holidayToday || isWeeklyOffToday

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

  const setOvertime = (userId: string, value: string) => {
    setRecords(r => ({ ...r, [userId]: { ...r[userId], overtime_hours: value, status: r[userId]?.status ?? 'present' } }))
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
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isNonWorkingDay}>
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
          {!isNonWorkingDay && (
            <Button variant="outline" onClick={markAllPresent}
              className="border-success/30 text-success hover:bg-success/10 hover:text-success">
              Mark All Present
            </Button>
          )}
          {isNonWorkingDay ? (
            <div className="ml-auto flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
              <PartyPopper className="h-4 w-4" />
              {holidayToday ? holidayToday.name : 'Weekly off'}
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>

      {/* Staff list */}
      {isNonWorkingDay ? (
        <Card>
          <EmptyState
            icon={PartyPopper}
            title={holidayToday ? `${holidayToday.name} — no attendance needed` : 'Weekly off — no attendance needed'}
            description="This date is off on the academic calendar, so it isn't counted as a working day and won't show up as unmarked for any staff member."
          />
        </Card>
      ) : (
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
                <TableHead>OT (hrs)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staffData ?? []).map((s: any) => {
                const rec: Partial<RecordState> = records[s.id] ?? {}
                return (
                  <TableRow key={s.id} className="cursor-default">
                    <TableCell className="font-semibold text-foreground">
                      <div className="flex items-center gap-2.5">
                        <StaffAvatar photoUrl={s.staff_profile?.photo_url} fullName={s.full_name} className="h-8 w-8 text-xs" />
                        {s.full_name}
                      </div>
                    </TableCell>
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
                    <TableCell>
                      <Input type="number" min="0" step="0.5" value={rec.overtime_hours ?? ''} onChange={e => setOvertime(s.id, e.target.value)}
                        className="h-8 w-20 text-xs" placeholder="0" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      )}
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
                <TableHead className="text-center">Unmarked</TableHead>
                <TableHead className="text-center">OT (hrs)</TableHead>
                <TableHead className="text-center">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s: any) => (
                <TableRow key={s.user_id} className="cursor-default">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <StaffAvatar photoUrl={s.photo_url} fullName={s.full_name} className="h-8 w-8 text-xs" />
                      <div>
                        <p className="font-medium text-foreground">{s.full_name}</p>
                        <p className="text-xs capitalize text-muted-foreground">{s.role?.replace('_', ' ')}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.department ?? '—'}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.present}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.absent}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.half_day}</TableCell>
                  <TableCell className="text-center font-mono text-foreground">{s.on_leave}</TableCell>
                  <TableCell className="text-center font-mono">
                    {s.unmarked > 0
                      ? <span className="text-warning">{s.unmarked}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-center font-mono text-muted-foreground">{Number(s.overtime_hours ?? 0) || '—'}</TableCell>
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

// ── REQUESTS TAB — pending regularization approvals ─────────────
function RequestsTab() {
  const qc = useQueryClient()
  const { data: requests, isLoading } = useQuery({
    queryKey: ['attendance-regularizations', 'pending'],
    queryFn: () => hrmsApi.regularizations.list({ status: 'pending' }).then(r => r.data),
  })

  const actionMutation = useMutation({
    mutationFn: ({ id, status }: any) => hrmsApi.regularizations.workflowAction(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-regularizations'] })
      toast.success('Request updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const STATUS_LABELS: Record<string, string> = { present: 'Present', absent: 'Absent', half_day: 'Half Day', on_leave: 'On Leave' }

  return (
    <Card className="overflow-hidden">
      {isLoading ? (
        <div className="space-y-3 p-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (requests ?? []).length === 0 ? (
        <EmptyState icon={Inbox} title="No pending requests" description="Attendance correction requests submitted by staff will show up here for approval." />
      ) : (
        <div className="divide-y divide-border">
          {(requests ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between px-6 py-4">
              <div className="flex items-start gap-3">
                <StaffAvatar photoUrl={staffPhotoUrl(r.users?.staff_profiles)} fullName={r.users?.full_name} className="mt-0.5 h-8 w-8 text-xs" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.users?.full_name}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-sm text-muted-foreground">{r.date} → requesting {STATUS_LABELS[r.requested_status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => actionMutation.mutate({ id: r.id, status: 'approved' })} disabled={actionMutation.isPending}
                  className="bg-success/10 text-success shadow-none hover:bg-success/20">
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" onClick={() => actionMutation.mutate({ id: r.id, status: 'rejected' })} disabled={actionMutation.isPending}
                  className="bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20">
                  <X className="h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── SHIFTS TAB — simple CRUD for shift schedules ─────────────────
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ShiftsTab() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['staff-shifts'],
    queryFn: () => hrmsApi.shifts.list().then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.shifts.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-shifts'] }); toast.success('Shift deleted') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowModal(true)}><Plus className="h-4 w-4" /> New Shift</Button>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : (shifts ?? []).length === 0 ? (
          <EmptyState icon={Clock3} title="No shifts defined" description="Every staff member follows the school-wide weekly-off schedule until a shift with a different pattern is assigned to them on their profile." />
        ) : (
          <div className="divide-y divide-border">
            {(shifts ?? []).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">{s.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.start_time && s.end_time ? `${s.start_time} – ${s.end_time} · ` : ''}
                    Off: {(s.off_days ?? []).map((d: number) => DAY_LABELS[d]).join(', ') || 'None'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(s.id)} disabled={deleteMutation.isPending} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {showModal && (
        <ShiftModal onClose={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['staff-shifts'] }) }} />
      )}
    </div>
  )
}

function ShiftModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', start_time: '', end_time: '' })
  const [offDays, setOffDays] = useState<number[]>([0])
  const [loading, setLoading] = useState(false)

  const toggleDay = (d: number) => setOffDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())

  const handleSave = async () => {
    if (!form.name) return toast.error('Name is required')
    setLoading(true)
    try {
      await hrmsApi.shifts.create({ ...form, off_days: offDays })
      toast.success('Shift created')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm p-5">
        <h3 className="mb-4 font-semibold text-foreground">New Shift</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning Shift" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Weekly Off Days</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, d) => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={cn('rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-all',
                    offDays.includes(d) ? 'bg-primary/10 text-primary ring-primary/30' : 'bg-background text-muted-foreground ring-border')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Create Shift
          </Button>
        </div>
      </Card>
    </div>
  )
}
