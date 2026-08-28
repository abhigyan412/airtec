'use client'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { homeworkApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassPicker } from '@/lib/useClassPicker'
import { cn, formatDate, todayLocalISO } from '@/lib/utils'
import { Plus, Trash2, Pencil, Upload, ShieldOff, BookOpen, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { MonthCalendar, toDateKey, type CalendarEvent } from '@/components/academics/MonthCalendar'
import { AddHomeworkModal } from '@/components/academics/AddHomeworkModal'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

const todayKey = toDateKey(new Date())

export default function HomeworkPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canView = can('homework.view')
  const canCreate = can('homework.create')
  const canPlanSyllabus = can('syllabus.plan')
  const canSeeSyllabus = can('syllabus.view')

  if (!permLoading && !canView) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to view homework." className="h-64" />
    )
  }

  // Students/parents (and, now, plain Teachers with no create/syllabus
  // rights at all) get a simple read-only "My Homework" list — everything
  // else (class pickers, assign/edit/delete) is a staff tool.
  if (!canCreate && !canSeeSyllabus) {
    return <MyHomeworkView />
  }

  return <AssignHomeworkView canCreate={canCreate} isSeniorManagement={canPlanSyllabus} />
}

// ── READ-ONLY VIEW (homework.view without homework.create or syllabus.view) ─
// Checked against rbac/seed.ts directly: no built-in role actually reaches
// this branch. Every built-in role holding homework.view also holds either
// homework.create (School Admin/Principal/VP/Director/Teacher/Class
// Teacher) or nothing beyond view at all (Parent/Student) — and
// Parent/Student are hard-redirected to the family portal app by
// `(app)/layout.tsx` before this page ever mounts. This view is reachable
// today only via a custom/edited RBAC grant (homework.view minus both of
// the others). Kept and polished anyway rather than deleted, since RBAC v2
// allows exactly that kind of custom role and this is its correct landing
// spot if one exists. plan.md Phase 8 originally framed this as unifying
// one component shared with the portal's own read view — not achievable as
// a literal shared import (frontend and frontend-portal are two independent
// Next.js apps with no workspace/package tooling between them), so this
// instead brings the grouping and field coverage to parity by hand,
// mirroring frontend-portal/app/(portal)/homework/page.tsx's Overdue/This
// week/Later buckets and attachment rendering — kept in sync manually,
// same as every other piece of UI these two apps don't literally share.
type HwGroupKey = 'overdue' | 'week' | 'later'
const HW_GROUPS: { key: HwGroupKey; heading: string }[] = [
  { key: 'overdue', heading: 'Overdue' },
  { key: 'week', heading: 'Due this week' },
  { key: 'later', heading: 'Later' },
]
function homeworkGroupOf(dueDate: string | null | undefined, today: string): HwGroupKey {
  if (!dueDate) return 'later'
  if (dueDate < today) return 'overdue'
  const days = Math.round((new Date(dueDate).getTime() - new Date(today).getTime()) / 86_400_000)
  return days <= 6 ? 'week' : 'later'
}

function MyHomeworkView() {
  const today = todayLocalISO()
  const { data, isLoading } = useQuery({
    queryKey: ['my-homework'],
    queryFn: () => homeworkApi.list().then(r => r.data),
  })
  const items = [...(data ?? [])].sort((a: any, b: any) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="My Homework" description="Homework and classwork for your classes" icon={BookOpen} />

      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[108px] w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={BookOpen}
            title="Nothing assigned yet"
            description="Homework and classwork your teachers assign will show up here."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {HW_GROUPS.map(group => {
            const groupItems = items.filter((hw: any) => homeworkGroupOf(hw.due_date, today) === group.key)
            if (!groupItems.length) return null
            return (
              <section key={group.key} className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.heading}</h2>
                <div className="grid gap-3">
                  {groupItems.map((hw: any) => (
                    <div key={hw.id} className={cn('bg-card rounded-2xl border border-border p-5', group.key === 'overdue' && 'border-destructive/40')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase',
                              hw.type === 'homework' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success')}>
                              {hw.type}
                            </span>
                            <span className="text-xs text-muted-foreground">{hw.subject_name}</span>
                          </div>
                          <h3 className="font-semibold text-foreground">{hw.title}</h3>
                          {hw.description && <p className="text-sm text-muted-foreground mt-1">{hw.description}</p>}
                          {hw.attachment_url && (
                            <a href={hw.attachment_url} target="_blank" rel="noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                              <Upload className="w-3.5 h-3.5" /> Attachment
                            </a>
                          )}
                        </div>
                        {hw.due_date && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-muted-foreground">Due</p>
                            <p className="text-sm font-medium text-foreground">{formatDate(hw.due_date)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ASSIGN — class/section picker + the homework/classwork calendar ────
function AssignHomeworkView({ canCreate, isSeniorManagement }: { canCreate: boolean; isSeniorManagement: boolean }) {
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections, myAllowedSubjects } = useClassPicker(isSeniorManagement)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assign Homework"
        description={isSeniorManagement ? 'Assign homework and classwork school-wide' : 'Assign homework and classwork for your classes'}
        icon={BookOpen}
      />

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Class</Label>
          <Select value={selectedClass || undefined} onValueChange={setSelectedClass}>
            <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
            <SelectContent>
              {classesData.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Section</Label>
            <Select value={selectedSection || 'all'} onValueChange={v => setSelectedSection(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isSeniorManagement ? 'All sections' : 'Select section...'}</SelectItem>
                {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!selectedClass ? (
        <div className="bg-card rounded-2xl border border-border">
          {classesData.length === 0 && !isSeniorManagement ? (
            <EmptyState
              icon={BookOpen}
              title="You're not scheduled to teach any class yet"
              description="Your classes come from the timetable — ask your school admin to schedule you, then they'll appear here."
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="Select a class to get started"
              description="Pick a class above to see its homework calendar."
            />
          )}
        </div>
      ) : (
        <HomeworkTab classId={selectedClass} sectionId={selectedSection} canCreate={canCreate} allowedSubjects={myAllowedSubjects} />
      )}
    </div>
  )
}

// ── HOMEWORK & CLASSWORK CALENDAR ────────────────────────────────
function HomeworkTab({ classId, sectionId, canCreate, allowedSubjects }: {
  classId: string; sectionId: string; canCreate: boolean; allowedSubjects?: string[]
}) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editingHomework, setEditingHomework] = useState<any>(null)
  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string>(todayKey)

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['homework', classId, sectionId],
    queryFn: () => homeworkApi.list({ class_id: classId, section_id: sectionId || undefined }).then(r => r.data),
  })
  // A teacher only sees/manages homework for subjects they're actually
  // scheduled to teach in this class+section.
  const data = allowedSubjects ? (rawData ?? []).filter((hw: any) => allowedSubjects.includes(hw.subject_name)) : rawData

  const deleteMutation = useMutation({
    mutationFn: (id: string) => homeworkApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['homework'] }); toast.success('Deleted') },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to delete'),
  })

  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const hw of data ?? []) {
      const key = hw.due_date || hw.assigned_date
      if (!key) continue
      if (!map[key]) map[key] = []
      map[key].push(hw)
    }
    return map
  }, [data])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const [key, items] of Object.entries(byDate)) {
      map[key] = items.map(hw => ({
        id: hw.id, label: hw.title,
        color: hw.type === 'homework' ? 'bg-primary/15 text-primary' : 'bg-success/15 text-success',
      }))
    }
    return map
  }, [byDate])

  const dayItems = byDate[selectedDate] ?? []

  return (
    <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[1fr_320px]">
      <MonthCalendar month={month} onMonthChange={setMonth} selectedDate={selectedDate} onSelectDate={setSelectedDate} eventsByDate={eventsByDate} />

      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {selectedDate === todayKey ? 'Today' : formatDate(selectedDate)}</p>
            <h3 className="font-semibold text-foreground text-sm mt-0.5">Due this day</h3>
          </div>
          {canCreate && (
            <Button size="icon" onClick={() => setShowAdd(true)} title="Assign for this day" aria-label="Assign for this day">
              <Plus className="w-4 h-4" />
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
            ))}
          </div>
        ) : dayItems.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing due this day"
            description={canCreate
              ? 'Pick another date on the calendar, or assign something for this one.'
              : 'Pick another date on the calendar to see what was assigned.'}
            className="py-8"
          />
        ) : (
          <div className="space-y-3">
            {dayItems.map((hw: any) => (
              <div key={hw.id} className="border border-border rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                        hw.type === 'homework' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success')}>
                        {hw.type}
                      </span>
                      {hw.assignment_type === 'individual' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-warning/10 text-warning">Individual</span>
                      )}
                      <span className="text-[10px] text-muted-foreground truncate">{hw.subject_name}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{hw.title}</p>
                    {hw.description && <p className="text-xs text-muted-foreground mt-0.5">{hw.description}</p>}
                  </div>
                  {canCreate && (
                    <div className="-mr-1.5 -mt-1.5 flex flex-shrink-0 items-center">
                      <button onClick={() => setEditingHomework(hw)} aria-label={`Edit ${hw.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteMutation.mutate(hw.id)} aria-label={`Delete ${hw.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddHomeworkModal classId={classId} sectionId={sectionId} initialDueDate={selectedDate} allowedSubjects={allowedSubjects}
          onClose={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['homework'] }) }} />
      )}
      {editingHomework && (
        <AddHomeworkModal classId={classId} sectionId={sectionId} editing={editingHomework}
          onClose={() => { setEditingHomework(null); qc.invalidateQueries({ queryKey: ['homework'] }) }} />
      )}
    </div>
  )
}
