'use client'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrmsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowLeft, Check, X, Clock, Loader2, Calendar } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_OPTIONS = [
  { key: 'present',  label: 'Present',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'absent',   label: 'Absent',   color: 'bg-red-100 text-red-700 border-red-200' },
  { key: 'half_day', label: 'Half Day', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'on_leave', label: 'On Leave', color: 'bg-purple-100 text-purple-700 border-purple-200' },
]

export default function StaffAttendancePage() {
  const qc = useQueryClient()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [records, setRecords] = useState<Record<string, { status: string; check_in?: string; check_out?: string }>>({})

  const { data: staffData } = useQuery({
    queryKey: ['hr-staff-all'],
    queryFn: () => hrmsApi.staff.list({ limit: 100 }).then(r => r.data),
  })

  const { data: existingAttendance, isLoading } = useQuery({
    queryKey: ['staff-attendance', date],
    queryFn: () => hrmsApi.attendance.list({ date }).then(r => r.data),
  })

  // Initialize records from existing attendance
  useMemo(() => {
    const init: Record<string, any> = {}
    for (const a of existingAttendance ?? []) {
      init[a.user_id] = { status: a.status, check_in: a.check_in?.slice(0,5), check_out: a.check_out?.slice(0,5) }
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
    const all: Record<string, any> = {}
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
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Staff Attendance</h1>
            <p className="text-gray-500 text-sm mt-0.5">Mark daily attendance for staff members</p>
          </div>
        </div>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 shadow-sm shadow-indigo-200">
          {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save Attendance
        </button>
      </div>

      {/* Date selector + stats */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none" />
        </div>
        <button onClick={markAllPresent}
          className="px-4 py-2.5 border border-emerald-200 text-emerald-700 text-sm font-medium rounded-xl hover:bg-emerald-50">
          Mark All Present
        </button>
        <div className="ml-auto flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.present}</p>
            <p className="text-xs text-gray-500">Present</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{stats.absent}</p>
            <p className="text-xs text-gray-500">Absent</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-400">{stats.marked}/{stats.total}</p>
            <p className="text-xs text-gray-500">Marked</p>
          </div>
        </div>
      </div>

      {/* Staff list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Staff</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Check In</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Check Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(staffData ?? []).map((s: any) => {
                const rec = records[s.id] ?? {}
                return (
                  <tr key={s.id} className="hover:bg-gray-50/80">
                    <td className="px-5 py-3 font-semibold text-gray-900">{s.full_name}</td>
                    <td className="px-5 py-3 text-gray-500 capitalize text-xs">{s.role?.replace('_',' ')}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {STATUS_OPTIONS.map(opt => (
                          <button key={opt.key} onClick={() => setStatus(s.id, opt.key)}
                            className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border transition-all',
                              rec.status === opt.key ? opt.color : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300')}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <input type="time" value={rec.check_in ?? ''} onChange={e => setTime(s.id, 'check_in', e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-28" />
                    </td>
                    <td className="px-5 py-3">
                      <input type="time" value={rec.check_out ?? ''} onChange={e => setTime(s.id, 'check_out', e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none w-28" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
