'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Loader2, ShieldOff, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

const WEEKDAYS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
]

export default function AcademicCalendarPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'school_admin' || user?.role === 'principal'
  const qc = useQueryClient()

  const [year, setYear] = useState(new Date().getFullYear())
  const [showAdd, setShowAdd] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')

  const { data: weeklyOffData } = useQuery({
    queryKey: ['weekly-off'],
    queryFn: () => calendarApi.weeklyOff.get().then(r => r.data),
  })
  const [pendingOffDays, setPendingOffDays] = useState<number[] | null>(null)
  const offDays = pendingOffDays ?? weeklyOffData?.weekly_off_days ?? [0]

  const { data: holidays, isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => calendarApi.holidays.list(year).then(r => r.data),
  })

  const weeklyOffMutation = useMutation({
    mutationFn: (days: number[]) => calendarApi.weeklyOff.update(days),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['weekly-off'] }); toast.success('Weekly off updated') },
    onError: (e: any) => { toast.error(e?.response?.data?.error ?? 'Failed to update'); setPendingOffDays(null) },
  })

  const toggleOffDay = (day: number) => {
    if (!canManage) return
    const current = offDays.includes(day) ? offDays.filter((d: number) => d !== day) : [...offDays, day].sort()
    setPendingOffDays(current)
    weeklyOffMutation.mutate(current)
  }

  const addHolidayMutation = useMutation({
    mutationFn: () => calendarApi.holidays.create({ date: newDate, name: newName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holidays'] })
      setNewDate(''); setNewName(''); setShowAdd(false)
      toast.success('Holiday added')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to add holiday'),
  })

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => calendarApi.holidays.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); toast.success('Holiday removed') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to remove holiday'),
  })

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Access Denied"
        description="Only School Admin or Principal can manage the academic calendar."
        className="h-64"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Calendar"
        description="Holidays and weekly off days — attendance % is calculated against these as the real working days"
        icon={CalendarDays}
        className="mb-0"
      />

      {/* Weekly off */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Weekly Off Days</CardTitle>
          <CardDescription className="text-xs">These weekdays never count toward attendance working days, every month.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(d => (
              <Button
                key={d.value}
                type="button"
                variant={offDays.includes(d.value) ? 'default' : 'outline'}
                onClick={() => toggleOffDay(d.value)}
                disabled={weeklyOffMutation.isPending}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Holidays */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Holidays</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAdd(v => !v)}>
              <Plus className="h-3.5 w-3.5" /> Add Holiday
            </Button>
          </div>
          <CardDescription className="text-xs">Declared non-working dates — excluded from attendance working days.</CardDescription>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 p-3">
              <div className="space-y-1">
                <Label htmlFor="holiday-date" className="text-xs">Date</Label>
                <Input id="holiday-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-auto" />
              </div>
              <div className="min-w-[160px] flex-1 space-y-1">
                <Label htmlFor="holiday-name" className="text-xs">Name</Label>
                <Input id="holiday-name" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Diwali" />
              </div>
              <Button
                onClick={() => {
                  if (!newDate || !newName.trim()) return toast.error('Date and name are required')
                  addHolidayMutation.mutate()
                }}
                disabled={addHolidayMutation.isPending}
              >
                {addHolidayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          <div className="mb-3 flex items-center justify-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(y => y - 1)} aria-label="Previous year">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-16 text-center text-sm font-semibold text-foreground">{year}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(y => y + 1)} aria-label="Next year">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : (holidays ?? []).length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={`No holidays declared for ${year}`}
              description="Until a date is listed here it counts as a working day for attendance. Add the ones your school observes."
              action={<Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add Holiday</Button>}
              className="py-10"
            />
          ) : (
            <div className="divide-y divide-border">
              {(holidays ?? []).map((h: any) => (
                <div key={h.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-24 font-mono text-xs text-muted-foreground">
                      {new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="text-sm font-medium text-foreground">{h.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteHolidayMutation.mutate(h.id)}
                    aria-label={`Remove holiday ${h.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
