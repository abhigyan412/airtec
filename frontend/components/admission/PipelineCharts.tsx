'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LabelList } from 'recharts'
import { TrendingUp, Users } from 'lucide-react'

// Sequential pipeline stages, in the order a real inquiry actually moves
// through. Rejected/Lost are deliberately excluded from this chart — they
// are exits from the pipeline, not a step in it, and mixing them into a
// left-to-right stage order would misread as "the pipeline gets worse at
// the end" rather than "these are the ones that left".
const STAGE_ORDER = [
  { key: 'new', label: 'New', color: '#3b82f6' },
  { key: 'follow_up', label: 'Follow Up', color: '#eab308' },
  { key: 'interested', label: 'Interested', color: '#a855f7' },
  { key: 'documents_submitted', label: 'Docs Submitted', color: '#f97316' },
  { key: 'approved', label: 'Approved', color: '#14b8a6' },
  { key: 'admitted', label: 'Admitted', color: '#22c55e' },
]
const EXIT_STAGES = [
  { key: 'rejected', label: 'Rejected', color: '#ef4444' },
  { key: 'lost', label: 'Lost', color: '#9ca3af' },
]

export function PipelineCharts({ stats }: { stats: any }) {
  const byStatus = stats?.by_status ?? []
  const bySource = stats?.by_source ?? []

  const countFor = (key: string) => byStatus.find((s: any) => s.status === key)?.count ?? 0
  const pipelineData = STAGE_ORDER.map(s => ({ ...s, count: countFor(s.key) }))
  const exitData = EXIT_STAGES.map(s => ({ ...s, count: countFor(s.key) })).filter(s => s.count > 0)
  const exitTotal = exitData.reduce((sum, s) => sum + s.count, 0)

  const sourceData = [...bySource].sort((a: any, b: any) => a.count - b.count)
  const hasPipelineData = pipelineData.some(s => s.count > 0)
  const hasSourceData = sourceData.length > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Pipeline distribution */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-400" /> Pipeline Distribution
          </h3>
          {exitTotal > 0 && (
            <span className="text-xs text-gray-400">
              {exitData.map(s => `${s.count} ${s.label.toLowerCase()}`).join(' · ')}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">Inquiries currently sitting at each stage</p>
        {!hasPipelineData ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
            <TrendingUp className="w-10 h-10 mb-2" />
            <p className="text-sm text-gray-400">No inquiries in the pipeline yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={pipelineData} margin={{ top: 8, right: 24, left: -10 }}>
              <CartesianGrid vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip
                contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                cursor={{ fill: '#f9fafb', radius: 6 }}
                formatter={(value: any) => [value, 'Inquiries']}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {pipelineData.map((s, i) => <Cell key={i} fill={s.color} />)}
                <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#374151' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Source breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-gray-400" /> Inquiries by Source
        </h3>
        <p className="text-xs text-gray-400 mb-4">Where leads are coming from</p>
        {!hasSourceData ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
            <Users className="w-10 h-10 mb-2" />
            <p className="text-sm text-gray-400">No inquiries yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, sourceData.length * 34)}>
            <BarChart data={sourceData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="source" tick={{ fontSize: 12, fill: '#4b5563' }} tickLine={false} axisLine={false} width={110} />
              <Tooltip
                contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
                cursor={{ fill: '#f9fafb' }}
                formatter={(value: any) => [value, 'Inquiries']}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
