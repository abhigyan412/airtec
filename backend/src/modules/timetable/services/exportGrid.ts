import { supabase } from '../../../shared/db/client'
import { writeWorkbook } from '../import/xlsx'
import { badRequest, must } from '../lib/core'

// ═══════════════════════════════════════════════════════════════
// Export a timetable version as the same .xlsx the import reads.
// ═══════════════════════════════════════════════════════════════
//
// The mirror image of the importer: it turns a school's spreadsheet into
// rows; this turns the rows back into that spreadsheet. One sheet per
// weekday, period numbers as Roman numerals with the break sitting in the
// middle by time, and every section two rows — subject above, teacher
// below — so the file round-trips straight back through /import.

const DAY_NAMES = ['', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const toRoman = (n: number) => ROMAN[n] ?? String(n)
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

interface Row {
  day_of_week: number
  period_number: number
  start_time: string | null
  end_time: string | null
  is_break: boolean
  subject_name: string | null
  teacher_id: string | null
  section_id: string | null
  class_id: string | null
  classes?: { name?: string; numeric_level?: number } | null
  sections?: { name?: string } | null
}

const SELECT = 'day_of_week, period_number, start_time, end_time, is_break, subject_name, teacher_id, section_id, class_id, classes(name, numeric_level), sections(name)'

/** Rows for the version to export, plus a name for the file. */
async function loadRows(schoolId: string, versionId: string | null): Promise<{ rows: Row[]; label: string }> {
  // No id, or the active version's id → the live grid (timetable_periods).
  const { data: active } = await supabase.from('timetable_versions')
    .select('id, label').eq('school_id', schoolId).eq('status', 'active').maybeSingle()

  if (!versionId || versionId === 'active' || (active && versionId === (active as any).id)) {
    const { data } = await supabase.from('timetable_periods').select(SELECT).eq('school_id', schoolId)
    return { rows: (data ?? []) as any[], label: (active as any)?.label ?? 'Live timetable' }
  }

  // Otherwise a draft — its rows live in timetable_draft_periods. (Archived
  // versions keep no rows, so they cannot be exported.)
  const version = must(await supabase.from('timetable_versions')
    .select('id, label, status').eq('id', versionId).eq('school_id', schoolId).maybeSingle(), 'timetable version')
  if (version.status === 'archived') {
    throw badRequest('archived_not_exportable', 'Archived versions keep no periods to export. Export the live timetable or a draft.')
  }
  const { data } = await supabase.from('timetable_draft_periods').select(SELECT).eq('version_id', versionId)
  return { rows: (data ?? []) as any[], label: version.label }
}

export async function exportVersionXlsx(schoolId: string, versionId: string | null): Promise<{ filename: string; buffer: Buffer }> {
  const { rows, label } = await loadRows(schoolId, versionId)
  if (!rows.length) throw badRequest('nothing_to_export', 'This timetable has no periods to export.')

  // Teacher names (rows carry only teacher_id).
  const teacherIds = [...new Set(rows.map(r => r.teacher_id).filter(Boolean))] as string[]
  const { data: users } = teacherIds.length
    ? await supabase.from('users').select('id, full_name').in('id', teacherIds)
    : { data: [] as any[] }
  const nameOf = new Map((users ?? []).map((u: any) => [u.id, u.full_name]))

  // A stable section order: class level, then section name.
  const sectionKey = (r: Row) => r.section_id ?? `${r.class_id}:_`
  const sections = new Map<string, { key: string; label: string; level: number }>()
  for (const r of rows) {
    const k = sectionKey(r)
    if (sections.has(k)) continue
    const cls = r.classes?.name ?? ''
    const sec = r.sections?.name ?? ''
    sections.set(k, { key: k, label: [cls, sec].filter(Boolean).join(' '), level: r.classes?.numeric_level ?? 999 })
  }
  const sectionList = [...sections.values()].sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))

  const days = [...new Set(rows.map(r => r.day_of_week))].sort((a, b) => a - b)

  const sheets = days.map(day => {
    const dayRows = rows.filter(r => r.day_of_week === day)

    // Columns = distinct period slots for the day, ordered by start time so
    // the break lands where it belongs. One representative start/end per slot.
    const colMap = new Map<number, { periodNumber: number; isBreak: boolean; start: string; end: string }>()
    for (const r of dayRows) {
      if (colMap.has(r.period_number)) continue
      colMap.set(r.period_number, {
        periodNumber: r.period_number, isBreak: r.is_break,
        start: r.start_time ?? '', end: r.end_time ?? '',
      })
    }
    const cols = [...colMap.values()].sort((a, b) => (a.start || '').localeCompare(b.start || ''))

    // cell lookup: section|period -> row
    const cell = new Map<string, Row>()
    for (const r of dayRows) cell.set(`${sectionKey(r)}|${r.period_number}`, r)

    const grid: string[][] = []
    // Row 0: 'TIME TABLE' with the day name at the end (the parser scans this
    // row for a weekday and also falls back to sheet order).
    const header0: string[] = ['TIME TABLE']
    while (header0.length < cols.length + 1) header0.push('')
    header0.push(DAY_NAMES[day])
    grid.push(header0)

    // Row 1: period numbers as Roman numerals, LUNCH for the break.
    grid.push(['', ...cols.map(c => (c.isBreak ? 'LUNCH' : toRoman(c.periodNumber)))])
    // Row 2: times.
    grid.push(['', ...cols.map(c => (c.start ? `${hhmm(c.start)}-${hhmm(c.end)}` : ''))])

    // Two rows per section: subjects, then teachers.
    for (const s of sectionList) {
      const subjectRow = [s.label, ...cols.map(c => {
        const r = cell.get(`${s.key}|${c.periodNumber}`)
        return r && !r.is_break ? (r.subject_name ?? '') : (r?.is_break ? '' : '')
      })]
      const teacherRow = ['', ...cols.map(c => {
        const r = cell.get(`${s.key}|${c.periodNumber}`)
        return r && !r.is_break && r.teacher_id ? (nameOf.get(r.teacher_id) ?? '') : ''
      })]
      grid.push(subjectRow, teacherRow, [])
    }

    return { name: DAY_NAMES[day].slice(0, 31), grid }
  })

  const safe = label.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'timetable'
  return { filename: `timetable-${safe}.xlsx`, buffer: writeWorkbook(sheets) }
}
