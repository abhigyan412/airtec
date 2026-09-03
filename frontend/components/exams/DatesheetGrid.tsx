'use client'
import { cn, formatDate } from '@/lib/utils'

// Categorical subject colouring for the Datesheet grid, matching Timetable's
// convention (hash the subject name to a stable hue so unanticipated
// subjects still get distinct, non-grey colours) — written out locally
// rather than importing timetable/components.tsx across module boundaries,
// since that file's helpers are scoped to the timetable feature.
const DATESHEET_TONES: Record<string, string> = {
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/20',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-inset ring-orange-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-1 ring-inset ring-purple-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/20',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 ring-1 ring-inset ring-pink-500/20',
  lime: 'bg-lime-500/10 text-lime-700 dark:text-lime-300 ring-1 ring-inset ring-lime-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 ring-1 ring-inset ring-yellow-500/20',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-500/20',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/20',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/20',
  green: 'bg-green-500/10 text-green-700 dark:text-green-300 ring-1 ring-inset ring-green-500/20',
}
const DATESHEET_HUES = Object.keys(DATESHEET_TONES)
export function subjectColor(subject: string): string {
  const key = subject.toLowerCase().trim()
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return DATESHEET_TONES[DATESHEET_HUES[hash % DATESHEET_HUES.length]]
}

export type DatesheetChip = { subject: any; suffix: string | null }
export type DatesheetRow = { key: string; label: string; byDate: Map<string, DatesheetChip[]> }

// Builds the datesheet's row/column data once, shared by the on-screen grid
// below and the print view, so the two can never disagree about which
// subjects land in which row or column.
//
// Rows are grouped by class_id, EXCEPT for an 11th/12th class, where a
// subject's `section_id` says which stream (PCM/PCB/Commerce/Humanities)
// it belongs to — those group by (class_id, section_id) instead, so each
// stream gets its own row even though they share a class_id. A subject
// with no section_id on an 11/12 class (taught to the whole class,
// regardless of stream) gets its own "All Streams" row rather than being
// silently dropped or guessed into one particular stream.
export function buildDatesheetRows(examSubjects: any[]) {
  const rowMeta = new Map<string, { label: string; sortKey: string }>()
  const rows = new Map<string, Map<string, DatesheetChip[]>>()

  const pushChip = (rowKey: string, label: string, sortKey: string, date: string, chip: DatesheetChip) => {
    if (!rows.has(rowKey)) {
      rows.set(rowKey, new Map())
      rowMeta.set(rowKey, { label, sortKey })
    }
    const byDate = rows.get(rowKey)!
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(chip)
  }

  const rowFor = (s: any) => {
    const level = s.classes?.numeric_level
    const className = s.classes?.name ?? ''
    if ((level === 11 || level === 12) ) {
      if (s.section_id) {
        return {
          key: `${s.class_id}:${s.section_id}`,
          label: `${className} — ${s.sections?.name ?? 'Stream'}`,
          sortKey: `${className}:${s.sections?.name ?? ''}`,
        }
      }
      return {
        key: `${s.class_id}:__all__`,
        label: `${className} — All Streams`,
        sortKey: `${className}:`,
      }
    }
    return { key: s.class_id, label: className, sortKey: className }
  }

  const dateSet = new Set<string>()

  for (const s of examSubjects) {
    if (!s.class_id) continue
    const { key: rowKey, label, sortKey } = rowFor(s)
    const isSplit = s.theory_max_marks != null && s.practical_max_marks != null
    if (s.exam_date) dateSet.add(s.exam_date)
    if (s.practical_exam_date) dateSet.add(s.practical_exam_date)

    if (!isSplit) {
      pushChip(rowKey, label, sortKey, s.exam_date ?? '', { subject: s, suffix: null })
      continue
    }
    const sameDay = s.exam_date && s.practical_exam_date && s.exam_date === s.practical_exam_date
    if (sameDay) {
      pushChip(rowKey, label, sortKey, s.exam_date, { subject: s, suffix: null })
      continue
    }
    if (s.exam_date) pushChip(rowKey, label, sortKey, s.exam_date, { subject: s, suffix: null })
    if (s.practical_exam_date) pushChip(rowKey, label, sortKey, s.practical_exam_date, { subject: s, suffix: 'Practical' })
    if (!s.exam_date && !s.practical_exam_date) pushChip(rowKey, label, sortKey, '', { subject: s, suffix: null })
  }

  const scheduleDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b))
  const scheduleRows: DatesheetRow[] = Array.from(rows.entries())
    .map(([key, byDate]) => ({ key, label: rowMeta.get(key)!.label, byDate }))
    .sort((a, b) => (rowMeta.get(a.key)!.sortKey).localeCompare(rowMeta.get(b.key)!.sortKey))

  return { scheduleDates, scheduleRows }
}

export function DatesheetGrid({ examSubjects, onSubjectClick }: { examSubjects: any[]; onSubjectClick?: (subject: any) => void }) {
  const { scheduleDates, scheduleRows } = buildDatesheetRows(examSubjects)

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
            <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left whitespace-nowrap">Class</th>
            {scheduleDates.map((date: string) => (
              <th key={date} className="px-4 py-3 text-left whitespace-nowrap">{formatDate(date)}</th>
            ))}
            <th className="px-4 py-3 text-left whitespace-nowrap">Not Scheduled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {scheduleRows.map((row) => (
            <tr key={row.key} className="align-top">
              <td className="sticky left-0 z-10 bg-card px-4 py-3 font-medium text-foreground whitespace-nowrap">{row.label}</td>
              {scheduleDates.map((date: string) => (
                <td key={date} className="px-4 py-3 min-w-[160px]">
                  <div className="flex flex-wrap gap-1.5">
                    {(row.byDate.get(date) ?? []).map((chip: DatesheetChip) => (
                      <button
                        key={`${chip.subject.id}-${chip.suffix ?? ''}`}
                        onClick={() => onSubjectClick?.(chip.subject)}
                        disabled={!onSubjectClick}
                        className={cn('rounded-lg px-2 py-1 text-xs font-medium transition',
                          onSubjectClick && 'hover:opacity-80', subjectColor(chip.subject.subject_name))}
                      >
                        {chip.subject.subject_name}{chip.suffix ? ` (${chip.suffix})` : ''}
                      </button>
                    ))}
                  </div>
                </td>
              ))}
              <td className="px-4 py-3 min-w-[160px]">
                <div className="flex flex-wrap gap-1.5">
                  {(row.byDate.get('') ?? []).map((chip: DatesheetChip) => (
                    <button
                      key={`${chip.subject.id}-${chip.suffix ?? ''}`}
                      onClick={() => onSubjectClick?.(chip.subject)}
                      disabled={!onSubjectClick}
                      className={cn('rounded-lg px-2 py-1 text-xs font-medium transition',
                        onSubjectClick && 'hover:opacity-80', subjectColor(chip.subject.subject_name))}
                    >
                      {chip.subject.subject_name}{chip.suffix ? ` (${chip.suffix})` : ''}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
