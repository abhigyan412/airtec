'use client'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, NotebookPen, Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { homeworkApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['portal-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })

  // plan.md Phase 9: whether a graded item can be resubmitted at all is a
  // school setting, off by default — a graded card only gets a resubmit
  // action when the school has actually turned it on.
  const { data: settings } = useQuery({
    queryKey: ['portal-homework-settings'],
    queryFn: () => homeworkApi.settings.get().then(r => r.data),
  })
  const resubmissionAllowed = !!settings?.homework_resubmission_allowed

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
                  const sub = h.my_submission
                  const status = sub?.status ?? null
                  return (
                    <Card
                      key={h.id}
                      // Overdue gets a tinted edge and a red pill — enough to spot
                      // while scrolling, without a slab of colour down the side.
                      className={cn('p-5', due?.overdue && status !== 'submitted' && status !== 'graded' && 'border-destructive/40')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>{h.subject_name}</Badge>
                            <span className="text-xs capitalize text-muted-foreground">{h.type}</span>
                            {status === 'graded' && <Badge variant="success">Graded</Badge>}
                            {status === 'submitted' && <Badge variant="neutral">Submitted</Badge>}
                            {sub?.is_late && (status === 'submitted' || status === 'graded') && <Badge variant="destructive">Late</Badge>}
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
                            variant={due.overdue && status !== 'submitted' && status !== 'graded' ? 'destructive' : 'neutral'}
                            className="shrink-0 whitespace-nowrap normal-case"
                          >
                            {due.label}
                          </Badge>
                        )}
                      </div>

                      {status === 'graded' ? (
                        <div className="mt-3 space-y-2">
                          <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-success">
                              <CheckCircle2 className="h-4 w-4" />
                              {sub.marks_obtained != null && sub.max_marks != null
                                ? `${sub.marks_obtained}/${sub.max_marks}`
                                : 'Reviewed'}
                            </div>
                            {sub.feedback && <p className="mt-1 text-sm text-foreground">{sub.feedback}</p>}
                          </div>
                          {resubmissionAllowed && (
                            openId === h.id ? (
                              <SubmissionForm homeworkId={h.id} existingText="" onClose={() => setOpenId(null)} />
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setOpenId(h.id)}>Resubmit</Button>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="mt-3">
                          {openId === h.id ? (
                            <SubmissionForm
                              homeworkId={h.id}
                              existingText={sub?.submission_text ?? ''}
                              onClose={() => setOpenId(null)}
                            />
                          ) : (
                            <Button size="sm" variant={status === 'submitted' ? 'outline' : 'default'} onClick={() => setOpenId(h.id)}>
                              {status === 'submitted' ? 'Edit submission' : 'Submit'}
                            </Button>
                          )}
                        </div>
                      )}
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

function SubmissionForm({ homeworkId, existingText, onClose }: { homeworkId: string; existingText: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState(existingText)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const submitMutation = useMutation({
    mutationFn: async () => {
      let file_base64: string | undefined
      if (file) {
        file_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }
      return homeworkApi.submit(homeworkId, {
        submission_text: text || undefined,
        file_base64,
        file_name: file?.name,
        mime_type: file?.type,
      })
    },
    onSuccess: () => {
      toast.success('Submitted')
      qc.invalidateQueries({ queryKey: ['portal-homework'] })
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to submit'),
  })

  return (
    <div className="space-y-2.5">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your answer here (optional if you're attaching a file)…"
        rows={3}
      />
      <div>
        <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {file ? file.name : 'Attach a file (optional)'}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={submitMutation.isPending || (!text && !file)}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
