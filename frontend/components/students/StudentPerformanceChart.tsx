'use client'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PieChart as PieChartIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { studentsApi } from '@/lib/api'

// Fixed hue order, assigned by each subject's own alphabetical rank —
// not by score or slice size — so a subject keeps the same color across
// re-fetches and across the "average" vs "single exam" toggle.
const SLICE_COLORS = [
  'hsl(243 75% 62%)', 'hsl(210 80% 56%)', 'hsl(152 62% 45%)', 'hsl(28 90% 58%)',
  'hsl(270 65% 60%)', 'hsl(190 75% 45%)', 'hsl(340 75% 60%)', 'hsl(80 55% 45%)',
  'hsl(45 90% 52%)', 'hsl(0 72% 56%)',
]

export function StudentPerformanceChart({ studentId, examId, onExamChange }: {
  studentId: string
  examId: string | undefined
  onExamChange: (examId: string | undefined) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-performance', studentId, examId],
    queryFn: () => studentsApi.performance(studentId, examId).then(r => r.data),
    enabled: !!studentId,
  })

  const exams = data?.exams ?? []
  const subjects = [...(data?.subjects ?? [])].sort((a: any, b: any) => a.subject_name.localeCompare(b.subject_name))
  const chartData = subjects.map((s: any, i: number) => ({ ...s, color: SLICE_COLORS[i % SLICE_COLORS.length] }))

  return (
    <div className="space-y-4">
      <Select value={examId ?? 'average'} onValueChange={(v) => onExamChange(v === 'average' ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-[280px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="average">Average across all exams</SelectItem>
          {exams.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {isLoading ? (
        <Skeleton className="h-[280px] w-full rounded-xl" />
      ) : chartData.length === 0 ? (
        <EmptyState icon={PieChartIcon} title="No marks recorded yet" description="This fills in once exam marks are entered for this student." className="py-14" />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={chartData} dataKey="avg_pct" nameKey="subject_name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
              {chartData.map((d: any, i: number) => <Cell key={i} fill={d.color} stroke="hsl(var(--card))" strokeWidth={2} />)}
            </Pie>
            <Tooltip
              formatter={(value: any, name: any) => [`${value}%`, name]}
              contentStyle={{ border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 13, background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)' }}
            />
            <Legend
              layout="vertical" verticalAlign="middle" align="right"
              formatter={(value, entry: any) => <span className="text-xs text-foreground">{value} — {entry.payload.avg_pct}%</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
