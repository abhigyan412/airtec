'use client'
import { useState } from 'react'
import { Users2, ChevronRight, GraduationCap, ChevronDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { useTeacherDashboard, type TeacherDashboardData } from '@/lib/useTeacherDashboard'
import { SubjectPerformanceModal } from './SubjectPerformanceModal'

type Section = TeacherDashboardData['classes_performance'][number]

const barColor = (pct: number) => pct >= 75 ? 'hsl(142 71% 45%)' : pct >= 50 ? 'hsl(38 92% 50%)' : 'hsl(0 72% 51%)'

// Primary view is a bar chart of average test score per (section,
// subject) — sorted lowest-first so the sections that need the most
// help surface immediately, rather than being buried in an alphabetical
// list. The full row-by-row breakdown (with the click-through to a
// specific exam) is still here, just collapsed behind "View details" —
// useful once you already know which section you're looking for, but no
// longer the first thing the card shows.
export function ClassesPerformance() {
  const { data, isLoading } = useTeacherDashboard()
  const sections = data?.classes_performance ?? []
  const [selected, setSelected] = useState<{ sectionId: string; subjectId: string } | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const chartData = sections
    .filter(s => s.subject_id && s.overall_avg_pct != null)
    .map(s => ({ ...s, label: `${s.class_name} ${s.section_name}${sections.filter(x => x.section_id === s.section_id).length > 1 ? ` · ${s.subject_name}` : ''}` }))
    .sort((a, b) => (a.overall_avg_pct as number) - (b.overall_avg_pct as number))

  const groups = sections.reduce<{ class_name: string; sections: Section[] }[]>((acc, s) => {
    const group = acc.find(g => g.class_name === s.class_name)
    if (group) group.sections.push(s)
    else acc.push({ class_name: s.class_name, sections: [s] })
    return acc
  }, [])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-muted-foreground" /> My Classes Performance
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Average test score per section — weakest first</p>
        </div>
        {sections.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(o => !o)} className="gap-1 text-xs">
            View details <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')} />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        ) : sections.length === 0 ? (
          <EmptyState icon={Users2} title="No sections assigned yet" className="py-10" />
        ) : chartData.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No test scores recorded yet" description="The chart fills in once marks are entered for a test." className="py-10" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} unit="%" />
              <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value: any) => [`${value}%`, 'Average score']}
                contentStyle={{ border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 13, background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.2)' }}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Bar dataKey="overall_avg_pct" radius={[0, 6, 6, 0]} maxBarSize={22}
                onClick={(d: any) => setSelected({ sectionId: d.section_id, subjectId: d.subject_id })}
                className="cursor-pointer">
                {chartData.map((d, i) => <Cell key={i} fill={barColor(d.overall_avg_pct as number)} />)}
                <LabelList dataKey="overall_avg_pct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {detailsOpen && sections.length > 0 && (
          <div className={cn('mt-5 space-y-5 border-t border-border pt-5', sections.length > 6 && 'max-h-[480px] overflow-y-auto pr-1')}>
            {groups.map(g => (
              <div key={g.class_name}>
                {groups.length > 1 && (
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    {g.class_name}
                  </p>
                )}
                <div className="space-y-2">
                  {g.sections.map(s => {
                    const clickable = !!s.subject_id
                    return (
                      <div
                        key={`${s.section_id}::${s.subject_id ?? 'homeroom'}`}
                        onClick={() => clickable && setSelected({ sectionId: s.section_id, subjectId: s.subject_id! })}
                        className={cn(
                          'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors',
                          clickable && 'cursor-pointer hover:border-primary/40 hover:bg-primary/5',
                        )}
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {s.class_name} {s.section_name}{s.subject_name ? ` · ${s.subject_name}` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground">{s.student_count} students{!s.subject_name ? ' · homeroom' : ''}</p>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">Attendance (30d)</p>
                            <p className="text-sm font-semibold text-foreground">{s.attendance_pct != null ? `${s.attendance_pct}%` : '—'}</p>
                          </div>
                          {s.subject_name && (
                            <div>
                              <p className="text-xs text-muted-foreground">{s.exams_taken > 0 ? `${s.exams_taken} test${s.exams_taken > 1 ? 's' : ''}` : 'Subject avg'}</p>
                              <p className="text-sm font-semibold text-foreground">{s.overall_avg_pct != null ? `${s.overall_avg_pct}%` : '—'}</p>
                            </div>
                          )}
                          {clickable ? (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {selected && (
        <SubjectPerformanceModal
          sectionId={selected.sectionId}
          subjectId={selected.subjectId}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  )
}
