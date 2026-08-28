'use client'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { syllabusApi, classesApi } from '@/lib/api'
import { usePermissions } from '@/lib/usePermissions'
import { useClassPicker } from '@/lib/useClassPicker'
import { cn, formatDate } from '@/lib/utils'
import { Plus, ShieldOff, BookOpen, ClipboardList, CheckCircle2, Clock, Circle } from 'lucide-react'
import { SyllabusMeter } from '@/components/academics/SyllabusMeter'
import { AddHomeworkModal } from '@/components/academics/AddHomeworkModal'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

const todayKey = new Date().toISOString().slice(0, 10)

// This is the "Progress" tab of the Syllabus module — the "Log Progress"
// and "Due Dates" tabs (app/(app)/syllabus/log and .../due-dates) used to
// live here too, behind two buttons and a shared calendar. Split 2026-08-28:
// viewing progress is a read-only job filtered by class/section/subject,
// logging and planning are write jobs done by different people at
// different times — see app/(app)/syllabus/layout.tsx.
export default function SyllabusPage() {
  const { can, isLoading: permLoading } = usePermissions()
  const canSeeSyllabus = can('syllabus.view')
  const canPlanSyllabus = can('syllabus.plan')
  const canCreateHomework = can('homework.create')

  if (!permLoading && !canSeeSyllabus) {
    return (
      <EmptyState icon={ShieldOff} title="Access Denied" description="You don't have permission to view syllabus progress." className="h-64" />
    )
  }

  return <SyllabusView isSeniorManagement={canPlanSyllabus} canCreateHomework={canCreateHomework} />
}

function SyllabusView({ isSeniorManagement, canCreateHomework }: { isSeniorManagement: boolean; canCreateHomework: boolean }) {
  const { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections, myAllowedSubjects } = useClassPicker(isSeniorManagement)
  const [selectedSubject, setSelectedSubjectRaw] = useState('')
  const setSelectedClassAndReset = (v: string) => { setSelectedClass(v); setSelectedSubjectRaw('') }

  // Subject options come from the school's master subject list (Settings ->
  // Classes & Sections), same source AddChaptersModal already used — not
  // derived from whatever chapters happen to already exist, which would
  // show nothing for a subject with no chapters planned yet.
  const { data: masterSubjects } = useQuery({
    queryKey: ['subjects', selectedClass],
    queryFn: () => classesApi.subjects.list(selectedClass).then(r => r.data),
    enabled: !!selectedClass,
  })
  const subjectOptions = useMemo(() => {
    const names = (masterSubjects ?? []).map((s: any) => s.name as string)
    return myAllowedSubjects ? names.filter(n => myAllowedSubjects.includes(n)) : names
  }, [masterSubjects, myAllowedSubjects])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Syllabus Progress"
        description={isSeniorManagement ? 'Track curriculum pacing school-wide' : 'Track curriculum pacing for your classes'}
        icon={ClipboardList}
      />

      <div className="bg-card rounded-2xl border border-border p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Class</Label>
          <Select value={selectedClass || undefined} onValueChange={setSelectedClassAndReset}>
            <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select class..." /></SelectTrigger>
            <SelectContent>
              {classesData.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Section</Label>
            <Select value={selectedSection || undefined} onValueChange={setSelectedSection}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue placeholder="Select section..." /></SelectTrigger>
              <SelectContent>
                {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selectedClass && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Subject</Label>
            <Select value={selectedSubject || 'all'} onValueChange={v => setSelectedSubjectRaw(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjectOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!selectedClass ? (
        <div className="bg-card rounded-2xl border border-border">
          {classesData.length === 0 && !isSeniorManagement ? (
            <EmptyState
              icon={ClipboardList}
              title="You're not scheduled to teach any class yet"
              description="Your classes come from the timetable — ask your school admin to schedule you, then they'll appear here."
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Select a class to get started"
              description="Pick a class (and section) above to see its syllabus progress."
            />
          )}
        </div>
      ) : sections.length > 0 && !selectedSection ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState icon={ClipboardList} title="Select a section" description="Pick a section above to see its syllabus progress." />
        </div>
      ) : selectedSubject ? (
        <FilteredChapterList
          classId={selectedClass}
          sectionId={selectedSection}
          subjectName={selectedSubject}
          allowedSubjects={myAllowedSubjects}
          canCreate={canCreateHomework}
        />
      ) : (
        <SyllabusOverview classId={selectedClass} sectionId={selectedSection} allowedSubjects={myAllowedSubjects} canCreate={canCreateHomework} />
      )}
    </div>
  )
}

// ── SYLLABUS OVERVIEW — per-subject progress bars for exactly the class
// (and section, if picked) selected above — never every class in the
// school at once. A Teacher/Class Teacher's cards are further narrowed,
// client-side, to the subjects they're actually scheduled to teach (per
// the timetable) — a Maths teacher for Class 1-A must not see Class 1-A's
// English progress just because they share a section.
function SyllabusOverview({ classId, sectionId, allowedSubjects, canCreate }: {
  classId: string; sectionId: string; allowedSubjects?: string[]; canCreate: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['syllabus-stats', classId, sectionId],
    queryFn: () => syllabusApi.stats({ class_id: classId, section_id: sectionId || undefined }).then(r => r.data),
  })
  const cards = useMemo(() => {
    const rows = data ?? []
    return allowedSubjects ? rows.filter((s: any) => allowedSubjects.includes(s.subject_name)) : rows
  }, [data, allowedSubjects])

  const [selected, setSelected] = useState<any | null>(null)

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Progress by subject</h3>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState icon={BookOpen} title="No chapters planned yet" description="Chapter due dates are set up on the Due Dates page." className="py-8" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((s: any) => (
            <button
              key={`${s.class_id}-${s.section_id ?? 'all'}-${s.subject_name}`}
              onClick={() => setSelected(s)}
              className="rounded-lg p-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <SyllabusMeter
                label={s.section_name ? `${s.section_name} · ${s.subject_name}` : s.subject_name}
                percentComplete={s.percent_complete}
                percentExpected={s.percent_expected}
                completed={s.completed}
                total={s.total}
              />
            </button>
          ))}
        </div>
      )}

      {selected && <SyllabusChapterModal card={selected} canCreate={canCreate} onClose={() => setSelected(null)} />}
    </div>
  )
}

const CHAPTER_STATUS_ICON: Record<string, any> = { completed: CheckCircle2, in_progress: Clock, pending: Circle }
const CHAPTER_STATUS_COLOR: Record<string, string> = { completed: 'text-success', in_progress: 'text-warning', pending: 'text-muted-foreground/50' }

// Single chapter row — status, due/completed date, overdue badge, homework
// summary (plan.md Phase 10) and the "assign homework" action. Shared
// between the overview card's drill-down dialog below and the filtered
// list further down, so the two views of the same data stay identical.
function ChapterRow({ c, showSubject, classId, sectionId, canCreate, onAssigned }: {
  c: any; showSubject: boolean; classId: string; sectionId: string; canCreate: boolean; onAssigned: () => void
}) {
  const [assigning, setAssigning] = useState(false)
  const Icon = CHAPTER_STATUS_ICON[c.status] ?? Circle
  const overdue = c.status !== 'completed' && c.due_date && c.due_date < todayKey
  const hw = c.homework_summary

  return (
    <div className="rounded-lg px-2 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className={cn('h-4 w-4 shrink-0', CHAPTER_STATUS_COLOR[c.status])} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {c.chapter_number ? `Ch ${c.chapter_number}. ` : ''}{c.chapter_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {showSubject ? `${c.subject_name} · ` : ''}
              {c.status === 'completed' && c.actual_completion_date
                ? `Completed ${formatDate(c.actual_completion_date)}`
                : c.due_date ? `Due ${formatDate(c.due_date)}` : 'No due date'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {overdue && <Badge variant="destructive">Overdue</Badge>}
          {canCreate && (
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Assign homework for this chapter"
              aria-label="Assign homework for this chapter" onClick={() => setAssigning(true)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {hw && (
        <p className="ml-[26px] mt-0.5 text-xs text-muted-foreground">
          {hw.items} homework item{hw.items > 1 ? 's' : ''} · {hw.graded} graded · {hw.submitted} submitted · {hw.pending} pending
        </p>
      )}
      {assigning && (
        <AddHomeworkModal
          classId={classId}
          sectionId={sectionId}
          fromChapter={{
            id: c.id,
            subject_name: c.subject_name,
            chapter_label: `${c.chapter_number ? `Ch ${c.chapter_number}. ` : ''}${c.chapter_name}`,
          }}
          onClose={() => { setAssigning(false); onAssigned() }}
        />
      )}
    </div>
  )
}

// Chapter-by-chapter drill-down behind a syllabus progress card — same
// endpoint the filtered list below already uses, just parameterized by
// whichever card was clicked instead of the page's own picker.
function SyllabusChapterModal({ card, canCreate, onClose }: { card: any; canCreate: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const queryKey = ['syllabus-chapter-detail', card.class_id, card.section_id, card.subject_name]
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => syllabusApi.list({ class_id: card.class_id, section_id: card.section_id ?? undefined, subject_name: card.subject_name }).then(r => r.data),
  })
  const chapters = data ?? []

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{card.class_name}{card.section_name ? ` · ${card.section_name}` : ''} · {card.subject_name}</DialogTitle>
          <DialogDescription>{card.completed} of {card.total} chapters covered</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
        ) : chapters.length === 0 ? (
          <EmptyState icon={BookOpen} title="No chapters planned yet" className="py-8" />
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {chapters.map((c: any) => (
              <ChapterRow
                key={c.id} c={c} showSubject={false}
                classId={card.class_id} sectionId={card.section_id ?? ''} canCreate={canCreate}
                onAssigned={() => qc.invalidateQueries({ queryKey })}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The "viewed based on a filter" list — Class -> Section -> Subject, all
// three cascading and Subject sourced from the master subjects list (see
// SyllabusView above), not free text.
function FilteredChapterList({ classId, sectionId, subjectName, allowedSubjects, canCreate }: {
  classId: string; sectionId: string; subjectName: string; allowedSubjects?: string[]; canCreate: boolean
}) {
  const qc = useQueryClient()
  const queryKey = ['syllabus', classId, sectionId, subjectName]
  const { data: rawChapters, isLoading } = useQuery({
    queryKey,
    queryFn: () => syllabusApi.list({ class_id: classId, section_id: sectionId || undefined, subject_name: subjectName || undefined }).then(r => r.data),
  })
  const chapters = allowedSubjects ? (rawChapters ?? []).filter((c: any) => allowedSubjects.includes(c.subject_name)) : (rawChapters ?? [])

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : chapters.length === 0 ? (
        <EmptyState icon={BookOpen} title="No chapters planned yet" description="Chapter due dates are set up on the Due Dates page." className="py-10" />
      ) : (
        <div className="space-y-1.5">
          {chapters.map((c: any) => (
            <ChapterRow
              key={c.id} c={c} showSubject={!subjectName}
              classId={classId} sectionId={sectionId} canCreate={canCreate}
              onAssigned={() => qc.invalidateQueries({ queryKey })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
