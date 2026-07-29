'use client'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { api, studentsApi } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

export default function PortalExamsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
  })

  const { data: exams, isLoading } = useQuery({
    queryKey: ['portal-exams'],
    queryFn: () => api.get('/exams', { params: { status: 'result_published', limit: 50 } }).then(r => r.data.data),
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Exam Results" description="Tap an exam to see the marks for every subject." />

      {isLoading ? (
        // Same geometry as the collapsed exam rows, so the list doesn't jump
        // when the data lands.
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[4.75rem] w-full rounded-lg" />
          ))}
        </div>
      ) : !(exams ?? []).length ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="No results published yet"
            description="Your school hasn't released any exam results so far. As soon as a result sheet is published, it'll show up here and you'll get a notification."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {(exams ?? []).map((exam: any) => (
            <ExamCard key={exam.id} exam={exam} studentId={me?.id}
              isOpen={expanded === exam.id}
              onToggle={() => setExpanded(expanded === exam.id ? null : exam.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ExamCard({ exam, studentId, isOpen, onToggle }: { exam: any, studentId?: string, isOpen: boolean, onToggle: () => void }) {
  const panelId = useId()

  const { data, isLoading } = useQuery({
    queryKey: ['portal-exam-results', exam.id],
    // :student_id in the URL is ignored server-side for a parent/
    // student account — it always resolves their own child regardless.
    queryFn: () => api.get(`/exams/${exam.id}/results/${studentId ?? 'me'}`).then(r => r.data.data),
    enabled: isOpen,
  })

  const marks: any[] = data?.marks ?? []
  const totalObtained = marks.reduce((s, m) => s + (m.marks_obtained ?? 0), 0)
  const totalMax = marks.reduce((s, m) => s + (m.exam_subjects?.max_marks ?? 0), 0)
  const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0

  return (
    <Card className="overflow-hidden">
      {/* The whole row is the target — a parent shouldn't have to hit the
          chevron. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          'pressable flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-foreground">{exam.name}</span>
          <span className="mt-0.5 block truncate text-xs capitalize text-muted-foreground">
            {exam.exam_type?.replace('_', ' ')} · {exam.start_date ? formatDate(exam.start_date) : ''}
          </span>
        </span>
        {isOpen
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {isOpen && (
        <div id={panelId} className="border-t px-5 py-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
              <div className="space-y-3">
                {[0, 1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            </div>
          ) : marks.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No marks recorded"
              description="This exam is published but no subject marks have been entered for your child yet. Your school office can tell you when to expect them."
              className="px-0 py-8"
            />
          ) : (
            <>
              {/* The total is what a parent opened this card for, so it leads
                  the panel rather than trailing it as a same-weight footer. */}
              <div className="rounded-lg bg-muted px-4 py-3">
                <p className="text-sm font-medium text-muted-foreground">Overall</p>
                <p className={cn(
                  'mt-0.5 text-2xl font-bold tabular-nums tracking-tight',
                  overallPct >= 50 ? 'text-success' : 'text-destructive',
                )}>
                  {totalObtained} / {totalMax}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {overallPct}% across {marks.length} {marks.length === 1 ? 'subject' : 'subjects'}
                </p>
              </div>

              {/* Phone: a stacked row per subject. Three columns of numbers in a
                  360px viewport wrap into each other and stop being scannable. */}
              <ul className="mt-4 divide-y divide-border sm:hidden">
                {marks.map((m: any) => (
                  <li key={m.id} className="py-3 first:pt-0">
                    <p className="text-sm font-medium text-foreground">{m.exam_subjects?.subject_name}</p>
                    <div className="mt-1 flex items-baseline justify-end gap-4 text-sm">
                      {m.is_absent ? (
                        <span className="font-medium text-destructive">Absent</span>
                      ) : (
                        <span className="tabular-nums text-muted-foreground">
                          {m.marks_obtained ?? '—'} / {m.exam_subjects?.max_marks ?? '—'}
                        </span>
                      )}
                      <span className="font-semibold tabular-nums text-foreground">
                        Grade {m.grade ?? '—'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Subject</th>
                      <th className="pb-2 text-right font-medium">Marks</th>
                      <th className="pb-2 text-right font-medium">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {marks.map((m: any) => (
                      <tr key={m.id}>
                        <td className="py-2.5 font-medium text-foreground">{m.exam_subjects?.subject_name}</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {m.is_absent ? <span className="font-medium text-destructive">Absent</span> : `${m.marks_obtained ?? '—'} / ${m.exam_subjects?.max_marks ?? '—'}`}
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums text-foreground">{m.grade ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
