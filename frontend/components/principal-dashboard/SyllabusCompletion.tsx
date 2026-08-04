'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Circle, Clock, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { cn, formatDate } from '@/lib/utils'
import { usePrincipalDashboard, type PrincipalDashboardData } from '@/lib/usePrincipalDashboard'
import { principalApi } from '@/lib/api'

type SyllabusRow = PrincipalDashboardData['academic_performance']['syllabus_completion'][number]

// Sorted most-behind first (gap = percent_complete − percent_expected,
// so the most negative gap is furthest off pace). Same effectiveDueDate
// logic as the admin Syllabus & Homework module's /syllabus/stats.
// Chapters are planned per class, not per section, in this schema — so
// the completion % itself is class-wide; what genuinely varies by
// section is who's teaching it, shown inline and expanded on click
// alongside the actual chapter-by-chapter breakdown.
export function SyllabusCompletion() {
  const { data, isLoading } = usePrincipalDashboard()
  const allRows = data?.academic_performance.syllabus_completion ?? []
  const [selected, setSelected] = useState<SyllabusRow | null>(null)
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [teacherFilter, setTeacherFilter] = useState('')

  const classOptions = Array.from(new Set(allRows.map(r => r.class_name))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const sectionOptions = Array.from(new Set(allRows.flatMap(r => r.sections.map(s => s.section_name)))).sort()
  const teacherOptions = Array.from(new Set(allRows.flatMap(r => r.sections.map(s => s.teacher_name).filter((t): t is string => !!t)))).sort()

  const rows = allRows.filter(r =>
    (!classFilter || r.class_name === classFilter)
    && (!sectionFilter || r.sections.some(s => s.section_name === sectionFilter))
    && (!teacherFilter || r.sections.some(s => s.teacher_name === teacherFilter)),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" /> Syllabus Completion
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">Actual vs expected progress by grade &amp; subject — most behind first. Click a row for chapter-wise detail.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Select value={classFilter || 'all'} onValueChange={v => setClassFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All Classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sectionFilter || 'all'} onValueChange={v => setSectionFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All Sections" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {sectionOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={teacherFilter || 'all'} onValueChange={v => setTeacherFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="All Teachers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teachers</SelectItem>
              {teacherOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : allRows.length === 0 ? (
          <EmptyState icon={BookOpen} title="No syllabus plan recorded yet" description="This fills in once chapters are added in the Syllabus module." className="py-12" />
        ) : rows.length === 0 ? (
          <EmptyState icon={BookOpen} title="No matches for these filters" className="py-12" />
        ) : (
          <div className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <button
                key={`${r.class_id}::${r.subject_name}::${i}`}
                onClick={() => setSelected(r)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.class_name} · {r.subject_name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {r.sections.length
                      ? r.sections.map(s => `${s.section_name}: ${s.teacher_name ?? 'Unassigned'}`).join(' · ')
                      : 'No teacher timetabled'}
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', r.gap < -15 ? 'bg-destructive' : r.gap < 0 ? 'bg-warning' : 'bg-success')}
                      style={{ width: `${Math.min(100, r.percent_complete)}%` }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">{r.percent_complete}%</p>
                    <Badge variant={r.gap < -15 ? 'destructive' : r.gap < 0 ? 'warning' : 'success'} className="mt-0.5">
                      {r.gap === 0 ? 'On pace' : r.gap > 0 ? `+${r.gap}pp ahead` : `${r.gap}pp behind`}
                    </Badge>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      {selected && <ChapterDetailModal row={selected} onClose={() => setSelected(null)} />}
    </Card>
  )
}

const STATUS_ICON: Record<string, any> = { completed: CheckCircle2, in_progress: Clock, pending: Circle }
const STATUS_COLOR: Record<string, string> = { completed: 'text-success', in_progress: 'text-warning', pending: 'text-muted-foreground/50' }

function ChapterDetailModal({ row, onClose }: { row: SyllabusRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['principal-syllabus-chapters', row.class_id, row.subject_name],
    queryFn: () => principalApi.syllabusChapters(row.class_id, row.subject_name).then(r => r.data),
  })
  const chapters = data ?? []

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{row.class_name} · {row.subject_name}</DialogTitle>
        </DialogHeader>

        {row.sections.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
            {row.sections.map(s => (
              <Badge key={s.section_id} variant="secondary">
                {s.section_name}: {s.teacher_name ?? 'Unassigned'}
              </Badge>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
        ) : chapters.length === 0 ? (
          <EmptyState icon={BookOpen} title="No chapters recorded" className="py-8" />
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {chapters.map((c: any) => {
              const Icon = STATUS_ICON[c.status] ?? Circle
              return (
                <div key={c.chapter_number} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className={cn('h-4 w-4 shrink-0', STATUS_COLOR[c.status])} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">Ch {c.chapter_number}. {c.chapter_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.completed && c.actual_completion_date ? `Completed ${formatDate(c.actual_completion_date)}` : c.due_date ? `Due ${formatDate(c.due_date)}` : 'No due date'}
                      </p>
                    </div>
                  </div>
                  {c.overdue && <Badge variant="destructive" className="shrink-0">Overdue</Badge>}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
