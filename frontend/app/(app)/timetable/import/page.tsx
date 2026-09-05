'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, Upload, Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

import { timetableApi, timetableError, DAY_NAMES } from '@/lib/timetableApi'
import { Banner, Chip, TableSkeleton, subjectClasses } from '../components'

// ═══════════════════════════════════════════════════════════════
// Bringing a school's existing spreadsheet in.
// ═══════════════════════════════════════════════════════════════
//
// The single most important screen for go-live, and the one that has to
// earn trust: a school is handing over a timetable that took somebody
// weeks, and if the import silently mangles it they will never use the
// product again.
//
// So nothing is decided automatically that a human would want a say in.
// Case drift ("GK" / "Gk") is merged without asking because there is no
// judgement in it. A name one character away from another, a cell where
// two values collapsed into one, a teacher who may or may not already
// exist in the staff list — those are all shown, with what the importer
// thinks and why, and the school confirms.

type Step = 'upload' | 'review' | 'done'

export default function ImportPage() {
  const router = useRouter()
  const { can, isLoading: permsLoading } = usePermissions()
  const [step, setStep] = useState<Step>('upload')
  const [fileBase64, setFileBase64] = useState('')
  const [filename, setFilename] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)

  // Decisions the reviewer makes, keyed by the canonical name.
  const [subjectDecisions, setSubjectDecisions] = useState<Record<string, any>>({})
  const [teacherDecisions, setTeacherDecisions] = useState<Record<string, any>>({})
  const [applyPlan, setApplyPlan] = useState(true)
  const [applyCapabilities, setApplyCapabilities] = useState(true)
  const [applyConstraints, setApplyConstraints] = useState(true)

  const inputRef = useRef<HTMLInputElement>(null)

  const analyse = useMutation({
    mutationFn: (input: { file: string; name: string }) => timetableApi.importPreview(input.file, input.name),
    onSuccess: (data) => {
      setPreview(data)
      // Seed the decision state from what the server proposed, so the
      // reviewer is adjusting a filled-in form rather than an empty one.
      const subjects: Record<string, any> = {}
      for (const s of data.resolved.subjects) {
        subjects[s.canonical] = { subjectId: s.subjectId, renameTo: s.canonical, skip: false }
      }
      const teachers: Record<string, any> = {}
      for (const t of data.resolved.teachers) {
        teachers[t.canonical] = {
          action: t.action, userId: t.suggestedUserId, fullName: t.canonical,
        }
      }
      setSubjectDecisions(subjects)
      setTeacherDecisions(teachers)
      setStep('review')
    },
    onError: (e) => toast.error(timetableError(e)),
  })

  const commit = useMutation({
    mutationFn: () => timetableApi.importCommit({
      file: fileBase64,
      filename,
      subjects: Object.entries(subjectDecisions).map(([canonical, d]: [string, any]) => ({
        canonical, subjectId: d.subjectId ?? null, renameTo: d.renameTo, skip: !!d.skip,
      })),
      teachers: Object.entries(teacherDecisions).map(([canonical, d]: [string, any]) => ({
        canonical, action: d.action, userId: d.userId ?? null, fullName: d.fullName,
      })),
      sections: (preview?.resolved.sections ?? []).map((s: any) => ({
        raw: s.raw, action: 'link', classId: s.classId, sectionId: s.sectionId,
      })),
      applyPlan, applyCapabilities, applyConstraints, applyDayTemplates: true,
      versionLabel: `Imported from ${filename || 'spreadsheet'}`,
    }),
    onSuccess: (data) => { setResult(data); setStep('done') },
    onError: (e) => toast.error(timetableError(e)),
  })

  const onFile = async (file: File) => {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    // Chunked rather than one fromCharCode.apply over the whole array:
    // a 33KB workbook would be fine, but the argument limit is a few tens
    // of thousands and a bigger file would throw RangeError here rather
    // than anywhere informative.
    const CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    }
    const base64 = btoa(binary)
    setFileBase64(base64)
    setFilename(file.name)
    analyse.mutate({ file: base64, name: file.name })
  }

  if (permsLoading) return <div className="p-6"><TableSkeleton /></div>

  if (!can('timetable.import')) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="You don't have access to import"
          description="Ask an administrator for the Import Timetable permission."
        />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Import a timetable"
        description="Read an existing Excel timetable into the system."
        icon={FileSpreadsheet}
        centered
      />

      <Steps current={step} />

      {step === 'upload' && (
        <UploadStep
          pending={analyse.isPending}
          inputRef={inputRef}
          onFile={onFile}
        />
      )}

      {step === 'review' && preview && (
        <ReviewStep
          preview={preview}
          subjectDecisions={subjectDecisions}
          setSubjectDecisions={setSubjectDecisions}
          teacherDecisions={teacherDecisions}
          setTeacherDecisions={setTeacherDecisions}
          applyPlan={applyPlan} setApplyPlan={setApplyPlan}
          applyCapabilities={applyCapabilities} setApplyCapabilities={setApplyCapabilities}
          applyConstraints={applyConstraints} setApplyConstraints={setApplyConstraints}
          committing={commit.isPending}
          onBack={() => { setStep('upload'); setPreview(null) }}
          onCommit={() => commit.mutate()}
        />
      )}

      {step === 'done' && result && (
        <DoneStep result={result} onGoToTimetable={() => router.push('/timetable')} />
      )}
    </div>
  )
}

// ── steps ───────────────────────────────────────────────────────

function Steps({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Choose file' },
    { key: 'review', label: 'Check what we read' },
    { key: 'done', label: 'Imported' },
  ]
  const index = steps.findIndex(s => s.key === current)
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2">
          <span className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
            i < index ? 'bg-success text-success-foreground'
              : i === index ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}>
            {i < index ? '✓' : i + 1}
          </span>
          <span className={cn(i === index ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {step.label}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        </li>
      ))}
    </ol>
  )
}

function UploadStep({ pending, inputRef, onFile }: {
  pending: boolean
  inputRef: React.RefObject<HTMLInputElement>
  onFile: (f: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <Card>
      <CardContent className="p-6">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) onFile(file)
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          {pending ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">Reading the spreadsheet…</p>
            </>
          ) : (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Upload className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">Drop your .xlsx here</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                One sheet per day, sections down the first column, and each section on two rows —
                subjects on top, teachers underneath. That is the layout most schools already use.
              </p>
              <Button className="mt-4" onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
              />
            </>
          )}
        </div>

        <div className="mt-5 rounded-lg bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">Nothing is saved until you confirm</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The next screen shows exactly what was read — every subject, every teacher, every clash
            already in the file — and you decide what to keep before anything is written.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ── review ──────────────────────────────────────────────────────

function ReviewStep({
  preview, subjectDecisions, setSubjectDecisions, teacherDecisions, setTeacherDecisions,
  applyPlan, setApplyPlan, applyCapabilities, setApplyCapabilities,
  applyConstraints, setApplyConstraints, committing, onBack, onCommit,
}: any) {
  const stats = preview.stats
  const blocking = preview.issues.filter((i: any) => i.severity === 'block')
  const warnings = preview.issues.filter((i: any) => i.severity === 'warn')
  const needsReviewSubjects = preview.subjectGroups.filter((g: any) => g.needsReview)
  const needsReviewTeachers = preview.teacherGroups.filter((g: any) => g.needsReview)

  return (
    <div className="space-y-5">
      {/* What was read. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Days" value={preview.days.length} hint={preview.days.map((d: any) => d.dayName.slice(0, 3)).join(' ')} />
        <Tile label="Sections" value={stats.sectionsFound} hint={`${preview.dayTemplates.length} day shape(s)`} />
        <Tile label="Periods read" value={stats.filledSlots} hint="Filled slots" />
        <Tile label="Subjects" value={preview.subjectGroups.length} hint={`from ${stats.distinctSubjectStrings} spellings`} />
        <Tile label="Teachers" value={preview.teacherGroups.length} hint={`from ${stats.distinctTeacherStrings} spellings`} />
      </div>

      {blocking.length > 0 && (
        <Banner tone="bad" title="This file cannot be imported yet">
          <ul className="mt-1 list-disc pl-4">
            {blocking.map((i: any, n: number) => <li key={n}>{i.message}</li>)}
          </ul>
        </Banner>
      )}

      {/* Day shapes. */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="text-sm font-semibold text-foreground">The school day</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Read from the times row. Sections are grouped by how long their day is.
          </p>
          <div className="mt-3 space-y-3">
            {preview.dayTemplates.map((template: any) => (
              <div key={template.name} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{template.name}</span>
                  <Chip tone="info">{template.teachingPeriods} teaching periods</Chip>
                  <span className="text-xs text-muted-foreground">{template.sectionLabels.join(', ')}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {template.periods.map((p: any, i: number) => (
                    <span
                      key={i}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
                        p.kind === 'period'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                      title={`${p.startTime.slice(0, 5)}–${p.endTime.slice(0, 5)}`}
                    >
                      {p.kind === 'period' ? `P${p.periodNumber}` : (p.label || p.kind)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Problems already in the file. */}
      {warnings.length > 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <h3 className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {warnings.length} thing{warnings.length === 1 ? '' : 's'} to look at in the file itself
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              These are problems in the spreadsheet, not with reading it. You can import anyway and
              fix them afterwards.
            </p>
            <ul className="mt-3 space-y-1.5">
              {warnings.slice(0, 12).map((issue: any, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  <span className="text-muted-foreground">{issue.message}</span>
                </li>
              ))}
              {warnings.length > 12 && (
                <li className="text-sm text-muted-foreground">…and {warnings.length - 12} more</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Subjects. */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="text-sm font-semibold text-foreground">Subjects</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {stats.distinctSubjectStrings} different spellings resolved to {preview.subjectGroups.length} subjects.
            {needsReviewSubjects.length > 0 && ` ${needsReviewSubjects.length} need a look.`}
          </p>

          <div className="mt-3 space-y-2">
            {preview.subjectGroups.map((group: any) => (
              <SubjectRow
                key={group.canonical}
                group={group}
                resolved={preview.resolved.subjects.find((s: any) => s.canonical === group.canonical)}
                decision={subjectDecisions[group.canonical] ?? {}}
                onChange={(next: any) => setSubjectDecisions((prev: any) => ({ ...prev, [group.canonical]: { ...prev[group.canonical], ...next } }))}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Teachers. */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4" /> Teachers
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Matching the names in the spreadsheet against your staff list.
            {preview.resolved.summary.teachersToCreate > 0 && (
              <> {preview.resolved.summary.teachersToCreate} will be created as new staff records.
              Their accounts exist so the timetable can point at them, but no password is set —
              you issue those separately from Staff &amp; HR.</>
            )}
          </p>

          {needsReviewTeachers.length > 0 && (
            <div className="mt-3">
              <Banner tone="warn" title={`${needsReviewTeachers.length} name${needsReviewTeachers.length === 1 ? '' : 's'} may be the same person spelt two ways`}>
                {needsReviewTeachers.map((g: any) => (
                  <div key={g.canonical} className="mt-1">
                    <span className="font-medium text-foreground">{g.canonical}</span>
                    {' — '}{g.variants.map((v: any) => `"${v.raw}" (${v.count})`).join(', ')}
                  </div>
                ))}
              </Banner>
            </div>
          )}

          {preview.coTaught.length > 0 && (
            <div className="mt-3">
              <Banner tone="info" title="Some periods name two teachers">
                {preview.coTaught.map((c: any) => (
                  <div key={c.raw}>
                    "{c.raw}" — recorded as {c.parts[0]}, with {c.parts.slice(1).join(', ')} noted alongside.
                  </div>
                ))}
              </Banner>
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            {preview.resolved.teachers.map((match: any) => (
              <TeacherRow
                key={match.canonical}
                match={match}
                decision={teacherDecisions[match.canonical] ?? {}}
                onChange={(next: any) => setTeacherDecisions((prev: any) => ({ ...prev, [match.canonical]: { ...prev[match.canonical], ...next } }))}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* What else to bring across. */}
      <Card>
        <CardContent className="p-4 text-center">
          <h3 className="text-sm font-semibold text-foreground">Also set up from this file</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everything below is worked out from the timetable itself, so the setup screens arrive
            filled in rather than blank.
          </p>
          <div className="mt-3 space-y-3">
            <Toggle
              checked={applyPlan} onChange={setApplyPlan}
              label={`Weekly periods per subject (${preview.plan.length} rows)`}
              hint="How many periods of each subject a section gets, and who teaches it. Needed to generate a timetable later."
            />
            <Toggle
              checked={applyCapabilities} onChange={setApplyCapabilities}
              label={`What each teacher teaches (${preview.capabilities.length} entries)`}
              hint="Recorded as their main subject, with the class range they actually cover. Drives substitute matching."
            />
            <Toggle
              checked={applyConstraints} onChange={setApplyConstraints}
              label={`Teaching limits (${preview.constraints.length} teachers)`}
              hint="Seeded from what the timetable already does, so nobody is flagged as over their limit on day one. You can tighten them afterwards."
            />
          </div>

          {applyConstraints && preview.constraints.length > 0 && (
            <div className="mt-3 rounded-lg bg-muted/40 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Heaviest loads in this file</p>
              <div className="mt-2 space-y-1">
                {preview.constraints.slice(0, 5).map((c: any) => (
                  <div key={c.teacher} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.teacher}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.observedPerWeek}/week · up to {c.observedMaxPerDay}/day · {c.observedMaxConsecutive} back to back
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={committing}>Choose a different file</Button>
        <Button onClick={onCommit} disabled={committing || blocking.length > 0}>
          {committing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Import {stats.filledSlots} periods
        </Button>
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>{hint}</p>
      </CardContent>
    </Card>
  )
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

function SubjectRow({ group, resolved, decision, onChange }: any) {
  const [editing, setEditing] = useState(false)
  const name = decision.renameTo ?? group.canonical

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2',
      group.needsReview ? 'border-warning/40 bg-warning/[0.03]' : 'border-border',
      decision.skip && 'opacity-50',
    )}>
      {editing ? (
        <Input
          autoFocus
          value={name}
          onChange={e => onChange({ renameTo: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') setEditing(false) }}
          className="h-8 w-52"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={cn('rounded-md px-2 py-1 text-sm font-medium hover:ring-2 hover:ring-ring', subjectClasses(name))}
          title="Click to rename"
        >
          {name}
        </button>
      )}

      <span className="text-xs tabular-nums text-muted-foreground">
        {group.variants.reduce((a: number, v: any) => a + v.count, 0)} periods
      </span>

      {resolved?.subjectId ? <Chip tone="good">Already in your subject list</Chip> : <Chip>Will be created</Chip>}

      {group.variants.length > 1 && (
        <span className="text-xs text-muted-foreground">
          {group.variants.map((v: any) => `"${v.raw}"`).join(' = ')}
        </span>
      )}

      {group.needsReview && (
        <Chip tone="warn" title={group.reason}>{group.reason}</Chip>
      )}

      <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox checked={!!decision.skip} onChange={e => onChange({ skip: e.target.checked })} />
        Skip
      </label>
    </div>
  )
}

function TeacherRow({ match, decision, onChange }: any) {
  const action = decision.action ?? match.action

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2',
      match.confidence === 'exact' ? 'border-border'
        : match.confidence === 'none' ? 'border-border'
        : 'border-warning/40 bg-warning/[0.03]',
    )}>
      <span className="min-w-[8rem] text-sm font-medium text-foreground">{match.canonical}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{match.periods} periods/week</span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {match.candidates.length > 0 ? (
          <Select
            value={action === 'create' ? '__create__' : (decision.userId ?? match.suggestedUserId ?? '__create__')}
            onValueChange={v => {
              if (v === '__create__') onChange({ action: 'create', userId: null })
              else onChange({ action: 'link', userId: v })
            }}
          >
            <SelectTrigger className="h-8 w-64 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {match.candidates.map((c: any) => (
                <SelectItem key={c.userId} value={c.userId}>
                  {c.fullName} {c.score >= 0.999 ? '· exact match' : `· ${Math.round(c.score * 100)}% match`}
                </SelectItem>
              ))}
              <SelectItem value="__create__">Create a new staff record</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Chip>New staff record</Chip>
        )}

        {match.confidence === 'exact' && action === 'link' && <Chip tone="good">Exact name match</Chip>}
        {match.confidence === 'likely' && action === 'link' && <Chip tone="warn">Close match — check</Chip>}
        {match.confidence === 'unsure' && action === 'link' && <Chip tone="warn">Unsure — check</Chip>}
      </div>
    </div>
  )
}

// ── done ────────────────────────────────────────────────────────

function DoneStep({ result, onGoToTimetable }: { result: any; onGoToTimetable: () => void }) {
  return (
    <div className="space-y-5">
      <Card className="border-success/40">
        <CardContent className="flex items-start gap-4 p-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Timetable imported</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.periodsWritten} periods are live. It is the school's active timetable from now on.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Periods" value={result.periodsWritten} hint="Written to the live timetable" />
        <Tile label="Classes created" value={result.classesCreated} hint={`${result.sectionsCreated} sections`} />
        <Tile label="Subjects created" value={result.subjectsCreated} hint="Added to your subject list" />
        <Tile label="Staff created" value={result.teachersCreated} hint="No password issued yet" />
      </div>

      {result.createdLogins?.length > 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {result.createdLogins.length} new staff record{result.createdLogins.length === 1 ? '' : 's'}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              These teachers are on the timetable but cannot sign in yet: their accounts exist,
              with no password anyone has been told. Issue credentials from Staff &amp; HR when you
              are ready — importing a timetable should not hand out working logins as a side effect.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.createdLogins.map((l: any) => <Chip key={l.email}>{l.fullName}</Chip>)}
            </div>
          </CardContent>
        </Card>
      )}

      {result.skipped?.slots > 0 && (
        <Banner tone="warn" title={`${result.skipped.slots} periods were skipped`}>
          <ul className="mt-1 list-disc pl-4">
            {result.skipped.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ul>
        </Banner>
      )}

      <Card>
        <CardContent className="p-4">
          <h3 className="text-center text-sm font-semibold text-foreground">What to do next</h3>
          <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">1.</span>
              <span>
                <strong className="text-foreground">Add second and third subjects</strong> teachers can cover.
                This is the one thing a spreadsheet cannot tell us, and it is what turns substitute
                suggestions from "whoever is free" into something a head of department would agree with.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">2.</span>
              <span><strong className="text-foreground">Review teaching limits</strong> on the workload page, now that you can see the real distribution.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">3.</span>
              <span><strong className="text-foreground">Give the teachers logins</strong> so they can see their week and confirm cover.</span>
            </li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onGoToTimetable}>View the timetable</Button>
            <Button variant="outline" asChild>
              <a href="/timetable/setup">Finish setting up</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
