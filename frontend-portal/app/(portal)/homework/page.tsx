'use client'
import { useQuery } from '@tanstack/react-query'
import { NotebookPen, Paperclip } from 'lucide-react'
import { homeworkApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { cn, formatRelativeDue, todayLocalISO } from '@/lib/utils'

// Three buckets, in the order a parent cares about them. A flat sorted list
// made an overdue task and one due next month look identical at a glance.
// Anything without a due date lands in "Later" — it's the "no rush" bucket.
type GroupKey = 'overdue' | 'week' | 'later'

const GROUPS: { key: GroupKey; heading: string }[] = [
  { key: 'overdue', heading: 'Overdue' },
  { key: 'week', heading: 'Due this week' },
  { key: 'later', heading: 'Later' },
]

function groupOf(dueDate: string | null | undefined, today: string): GroupKey {
  if (!dueDate) return 'later'
  if (dueDate < today) return 'overdue'
  // Both sides parse as UTC midnight, so the difference is whole days either way.
  const days = Math.round((new Date(dueDate).getTime() - new Date(today).getTime()) / 86_400_000)
  return days <= 6 ? 'week' : 'later'
}

export default function PortalHomeworkPage() {
  // Local date, not UTC — through an IST morning `toISOString()` is still on
  // yesterday, which would file a task due today under "Overdue".
  const today = todayLocalISO()

  const { data, isLoading } = useQuery({
    queryKey: ['portal-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })

  const items = [...(data ?? [])].sort((a: any, b: any) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  return (
    <div className="space-y-5">
      <PageHeader title="Homework" description="Everything your child's teachers have assigned, most urgent first." />

      {isLoading ? (
        <div className="space-y-6">
          {[0, 1].map(i => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={NotebookPen}
            title="No homework assigned yet"
            description="Your child's teachers haven't posted any homework yet. You'll get a notification as soon as they do."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {GROUPS.map(group => {
            const groupItems = items.filter((h: any) => groupOf(h.due_date, today) === group.key)
            if (!groupItems.length) return null

            return (
              <section key={group.key} className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.heading}
                </h2>
                {groupItems.map((h: any) => {
                  const due = h.due_date ? formatRelativeDue(h.due_date) : null
                  return (
                    <Card
                      key={h.id}
                      // Overdue gets a tinted edge and a red pill — enough to spot
                      // while scrolling, without a slab of colour down the side.
                      className={cn('p-5', due?.overdue && 'border-destructive/40')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>{h.subject_name}</Badge>
                            <span className="text-xs capitalize text-muted-foreground">{h.type}</span>
                          </div>
                          <p className="mt-1.5 font-semibold text-foreground">{h.title}</p>
                          {h.description && (
                            <p className="mt-1 text-sm text-muted-foreground">{h.description}</p>
                          )}
                          {h.attachment_url && (
                            <a
                              href={h.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex min-h-[2.75rem] items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                              <Paperclip className="h-3.5 w-3.5" /> Attachment
                            </a>
                          )}
                        </div>
                        {due && (
                          <Badge
                            variant={due.overdue ? 'destructive' : 'neutral'}
                            className="shrink-0 whitespace-nowrap normal-case"
                          >
                            {due.label}
                          </Badge>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
