'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LabelList } from 'recharts'
import { TrendingUp, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'

// Sequential pipeline stages, in the order a real inquiry actually moves
// through. Rejected/Lost are deliberately excluded from this chart — they
// are exits from the pipeline, not a step in it, and mixing them into a
// left-to-right stage order would misread as "the pipeline gets worse at
// the end" rather than "these are the ones that left".
// Series colors are categorical (they identify a stage, not a state) so they
// sit outside the semantic token scale — recharts needs real color values here,
// not classes. They use fixed HSL values that read well in both light and dark
// mode, and mirror the hue each stage gets in the pill map on the pipeline page
// (indigo / amber / purple / orange / teal / green) so the chart and the stage
// counters below it agree.
// Phase 9 of admission/plan.md: entrance_exam, waitlisted, and
// fee_pending existed in the schema and had UI elsewhere (status pills,
// the Move-Stage picker) but were never added here — a real inquiry
// sitting at any of these three simply vanished from this chart with no
// indication it existed. Free fix while already touching this file for
// the dashboard alerts work; not otherwise part of Phase 9's scope.
const STAGE_ORDER = [
  { key: 'new', label: 'New', color: 'hsl(243 75% 62%)' },
  { key: 'follow_up', label: 'Follow Up', color: 'hsl(38 92% 55%)' },
  { key: 'interested', label: 'Interested', color: 'hsl(262 70% 62%)' },
  { key: 'documents_submitted', label: 'Docs Submitted', color: 'hsl(25 95% 58%)' },
  { key: 'entrance_exam', label: 'Entrance Exam', color: 'hsl(192 75% 48%)' },
  { key: 'approved', label: 'Approved', color: 'hsl(173 58% 45%)' },
  { key: 'waitlisted', label: 'Waitlisted', color: 'hsl(45 90% 52%)' },
  { key: 'fee_pending', label: 'Fee Pending', color: 'hsl(330 70% 60%)' },
  { key: 'admitted', label: 'Admitted', color: 'hsl(152 62% 45%)' },
]
const EXIT_STAGES = [
  { key: 'rejected', label: 'Rejected', color: 'hsl(0 84% 62%)' },
  { key: 'lost', label: 'Lost', color: 'hsl(var(--muted-foreground))' },
]

const TOOLTIP_STYLE = {
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 13,
  background: 'hsl(var(--popover))',
  color: 'hsl(var(--popover-foreground))',
  boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)',
}

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
      <Card className="lg:col-span-2">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" /> Pipeline Distribution
            </CardTitle>
            {exitTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                {exitData.map(s => `${s.count} ${s.label.toLowerCase()}`).join(' · ')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Inquiries currently sitting at each stage</p>
        </CardHeader>
        <CardContent>
          {!hasPipelineData ? (
            <EmptyState
              icon={TrendingUp}
              title="No inquiries in the pipeline yet"
              description="Once inquiries are logged, this chart shows how many are sitting at each stage."
              className="h-[220px] py-0"
            />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pipelineData} margin={{ top: 8, right: 24, left: -10 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'hsl(var(--muted))', radius: 6 }}
                  formatter={(value: any) => [value, 'Inquiries']}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {pipelineData.map((s, i) => <Cell key={i} fill={s.color} />)}
                  <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: 'hsl(var(--foreground))' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Source breakdown */}
      <Card>
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" /> Inquiries by Source
          </CardTitle>
          <p className="text-xs text-muted-foreground">Where leads are coming from</p>
        </CardHeader>
        <CardContent>
          {!hasSourceData ? (
            <EmptyState
              icon={Users}
              title="No inquiries yet"
              description="Sources appear here once inquiries record where the lead came from."
              className="h-[220px] py-0"
            />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, sourceData.length * 34)}>
              <BarChart data={sourceData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="source" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={110} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  formatter={(value: any) => [value, 'Inquiries']}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
