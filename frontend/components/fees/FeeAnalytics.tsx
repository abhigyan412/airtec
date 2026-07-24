'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { feeApi, admissionApi } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { PiggyBank, BarChart3 } from 'lucide-react'

// Collection meter: single ratio (collected ÷ billed), color-banded by the
// same severity convention used everywhere else in this app (attendance %,
// syllabus coverage) — green ≥75%, amber ≥50%, red below — so "is this
// number good or bad" reads the same way across the whole product without
// the viewer having to learn a new scale for fees specifically.
function CollectionMeter({ stats }: { stats: any }) {
  const billed = stats?.total_billed ?? 0
  const collected = stats?.total_collected ?? 0
  const due = stats?.total_due ?? 0
  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0
  const ramp = pct >= 75 ? { fill: 'bg-emerald-500', track: 'bg-emerald-100', text: 'text-emerald-700' }
    : pct >= 50 ? { fill: 'bg-amber-500', track: 'bg-amber-100', text: 'text-amber-700' }
    : { fill: 'bg-rose-500', track: 'bg-rose-100', text: 'text-rose-700' }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
        <PiggyBank className="w-4 h-4 text-gray-400" /> Collection Health
      </h3>
      <p className="text-xs text-gray-400 mb-5">Collected against total billed this year</p>

      <div className="flex items-end justify-between mb-2">
        <span className={cn('text-3xl font-bold', ramp.text)}>{pct}%</span>
        <span className="text-xs text-gray-400">of {formatCurrency(billed)} billed</span>
      </div>
      <div className={cn('h-3 rounded-full overflow-hidden', ramp.track)}>
        <div className={cn('h-full rounded-full transition-all', ramp.fill)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-400">Collected</p>
          <p className="text-lg font-bold text-emerald-600">{formatCurrency(collected)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Outstanding</p>
          <p className="text-lg font-bold text-rose-600">{formatCurrency(due)}</p>
        </div>
      </div>
    </div>
  )
}

// "All Classes" ranks every class by total outstanding — good for spotting
// where the problem is. Picking one specific class switches to a
// per-STUDENT breakdown within it — the actual actionable list for
// follow-up calls, not just a class-level total. Both modes reuse the
// same GET /fees/dues (it already accepts class_id), just grouped
// differently client-side.
function ClassWiseDues() {
  const [classId, setClassId] = useState('')

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
  })

  const { data: dues, isLoading } = useQuery({
    queryKey: ['dues', classId],
    queryFn: () => feeApi.dues(classId ? { class_id: classId } : undefined).then(r => r.data),
  })

  const byClass = new Map<string, number>()
  for (const d of dues ?? []) {
    const name = d.students?.classes?.name ?? 'Unassigned'
    byClass.set(name, (byClass.get(name) ?? 0) + Number(d.amount_due))
  }
  const classData = Array.from(byClass.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .reverse()

  const byStudent = new Map<string, number>()
  for (const d of dues ?? []) {
    const s = d.students
    const name = s ? `${s.first_name} ${s.last_name}` : 'Unknown'
    byStudent.set(name, (byStudent.get(name) ?? 0) + Number(d.amount_due))
  }
  const studentData = Array.from(byStudent.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .reverse()

  const data = classId ? studentData : classData
  const selectedClassName = (classesData ?? []).find((c: any) => c.id === classId)?.name

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-400" /> Outstanding Dues {classId ? `— ${selectedClassName}` : 'by Class'}
        </h3>
        <select value={classId} onChange={e => setClassId(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0">
          <option value="">All Classes</option>
          {(classesData ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-gray-400 mb-4">{classId ? 'Students to follow up with' : 'Where to focus follow-up'}</p>
      {isLoading ? (
        <div className="h-[220px] bg-gray-50 rounded-xl animate-pulse" />
      ) : data.length === 0 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
          <BarChart3 className="w-10 h-10 mb-2" />
          <p className="text-sm text-gray-400">No outstanding dues 🎉</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid horizontal={false} stroke="#f3f4f6" />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              tickFormatter={(v) => v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false} width={classId ? 90 : 70} />
            <Tooltip
              contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
              cursor={{ fill: '#f9fafb' }}
              formatter={(value: any) => [formatCurrency(Number(value)), 'Outstanding']}
            />
            <Bar dataKey="amount" fill="#f43f5e" radius={[0, 6, 6, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export function FeeAnalytics({ stats }: { stats: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <CollectionMeter stats={stats} />
      <ClassWiseDues />
    </div>
  )
}
