'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Loader2, ShieldOff, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

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
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <ShieldOff className="w-12 h-12 mb-3 text-gray-200" />
        <p className="font-semibold text-gray-500">Access Denied</p>
        <p className="text-sm mt-1">Only School Admin or Principal can manage the academic calendar.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Settings</p>
        <h1 className="text-2xl font-bold text-gray-900">Academic Calendar</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Holidays and weekly off days — attendance % is calculated against these as the real working days
        </p>
      </div>

      {/* Weekly off */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-1">Weekly Off Days</h3>
        <p className="text-xs text-gray-400 mb-4">These weekdays never count toward attendance working days, every month.</p>
        <div className="flex gap-2 flex-wrap">
          {WEEKDAYS.map(d => (
            <button key={d.value} onClick={() => toggleOffDay(d.value)}
              disabled={weeklyOffMutation.isPending}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all disabled:opacity-60',
                offDays.includes(d.value)
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              )}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Holidays */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-900 text-sm">Holidays</h3>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            <Plus className="w-3.5 h-3.5" /> Add Holiday
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Declared non-working dates — excluded from attendance working days.</p>

        {showAdd && (
          <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-gray-50 rounded-xl">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Diwali"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <button
              onClick={() => {
                if (!newDate || !newName.trim()) return toast.error('Date and name are required')
                addHolidayMutation.mutate()
              }}
              disabled={addHolidayMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
              {addHolidayMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mb-3">
          <button onClick={() => setYear(y => y - 1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <span className="text-sm font-semibold text-gray-900 w-16 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : (holidays ?? []).length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <CalendarDays className="w-10 h-10 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No holidays declared for {year}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(holidays ?? []).map((h: any) => (
              <div key={h.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 w-24">
                    {new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{h.name}</span>
                </div>
                <button onClick={() => deleteHolidayMutation.mutate(h.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
