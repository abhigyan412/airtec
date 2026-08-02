'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, NotebookPen, Users2 } from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface HomeworkItem {
  id: string
  title: string
  subject_name: string
  type: string
  assignment_type: string
  assigned_date: string
  due_date: string | null
  student_count: number
  submitted_count: number | null
  graded_count: number | null
  pending_count: number | null
}

interface Group {
  class_id: string
  class_name: string
  section_id: string
  section_name: string
  items: HomeworkItem[]
}

// Everything this teacher has assigned, grouped by class/section — the
// destination behind clicking "Homework Assigned" on the dashboard,
// which only ever shows a single rolled-up count. Scoped server-side to
// created_by = the logged-in teacher (see GET /teacher/homework-overview).
export default function HomeworkAssignedPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-homework-overview'],
    queryFn: () => teacherApi.homeworkOverview().then(r => r.data.groups as Group[]),
  })
  const groups = data ?? []
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homework Assigned"
        description={totalItems > 0 ? `${totalItems} item${totalItems > 1 ? 's' : ''} across ${groups.length} section${groups.length > 1 ? 's' : ''}` : 'Class-wise and section-wise breakdown of what you’ve assigned'}
        icon={NotebookPen}
        actions={
          <Link href="/homework" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80">
            <ArrowLeft className="h-4 w-4" /> Back to Homework
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={NotebookPen} title="You haven't assigned any homework yet" description="Homework you assign will show up here, grouped by class and section." className="py-14" />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <Card key={`${g.class_id}::${g.section_id}`}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-muted-foreground" /> {g.class_name} {g.section_name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">{g.items.length} item{g.items.length > 1 ? 's' : ''}</span>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {g.items.map(item => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{item.title}</p>
                          <Badge variant="secondary" className="font-normal">{item.subject_name}</Badge>
                          {item.type === 'classwork' && <Badge variant="info" className="font-normal">Classwork</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Assigned {formatDate(item.assigned_date)}{item.due_date ? ` · Due ${formatDate(item.due_date)}` : ''}
                        </p>
                      </div>

                      {item.assignment_type === 'individual' ? (
                        <div className="flex shrink-0 items-center gap-3 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">Submitted</p>
                            <p className="text-sm font-semibold text-foreground">{item.submitted_count}/{item.student_count}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Graded</p>
                            <p className="text-sm font-semibold text-foreground">{item.graded_count}/{item.student_count}</p>
                          </div>
                          {(item.pending_count ?? 0) > 0 && (
                            <Badge variant="warning">{item.pending_count} pending</Badge>
                          )}
                        </div>
                      ) : (
                        <p className="shrink-0 text-xs text-muted-foreground">Assigned to whole section · {item.student_count} students</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
