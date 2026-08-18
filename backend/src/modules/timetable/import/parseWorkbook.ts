import { Sheet } from './xlsx'
import {
  NameGroup, SplitName, groupSubjects, groupTeachers, resolutionMap, tidy,
} from './canonicalize'

// ═══════════════════════════════════════════════════════════════
// Turn a school's timetable spreadsheet into structured data.
// ═══════════════════════════════════════════════════════════════
//
// The layout this reads is the one Indian schools actually produce in
// Excel, and it is a picture of a timetable rather than a table of one:
//
//     row 0                          TIME TABLE            MONDAY
//     row 1        I      II     III    IV   LUNCH    V     VI  ...
//     row 2   07:50  08:25  09:00  09:35 10:10-10:30 10:30 ...
//     row 3   I A  | Zero  | Eng  | Pres | Art |    | EVS  | GK ...
//     row 4        | Reetika| Sajida| Reetika| Aarti|  | Basu | ...
//     row 5   (blank)
//     row 6   IB   | ...
//
// So: one sheet per weekday, the day written inside the grid rather than
// in the sheet name, period numbers as Roman numerals, a break column
// sitting in the middle of them, times in 12-hour form with no meridiem,
// and every section occupying two rows — subject above, teacher below.
//
// Nothing here writes to the database. It produces a preview that a
// human confirms first; committing is a separate step.

// ── types ───────────────────────────────────────────────────────

export interface RawSlot {
  day: number
  sectionLabel: string
  periodNumber: number
  subject: string
  teacher: string
  /** Where it came from, so the review screen can point at the cell. */
  sheet: string
  row: number
  column: number
}

export interface PeriodDef {
  slotIndex: number
  kind: 'period' | 'break' | 'lunch' | 'assembly'
  periodNumber: number | null
  startTime: string
  endTime: string
  label: string
}

export interface SectionRef {
  raw: string
  className: string
  numericLevel: number
  sectionName: string
  /** Highest teaching period this section actually uses. */
  periodsPerDay: number
}

export interface DayTemplateDraft {
  name: string
  templateType: 'regular' | 'saturday'
  periods: PeriodDef[]
  sectionLabels: string[]
  days: number[]
}

export interface PlanRow {
  sectionLabel: string
  subject: string
  weeklyPeriods: number
  teachers: string[]
}

export interface CapabilityDraft {
  teacher: string
  subject: string
  periods: number
  minClassLevel: number
  maxClassLevel: number
}

export interface ConstraintDraft {
  teacher: string
  observedMaxPerDay: number
  observedPerWeek: number
  observedMaxConsecutive: number
  freePeriodsPerWeek: number
  /** Seeded limits, derived from observation rather than from a textbook. */
  maxPeriodsPerDay: number
  maxPeriodsPerWeek: number
  maxConsecutive: number
}

export interface ImportIssue {
  severity: 'block' | 'warn' | 'info'
  code: string
  message: string
  where?: { sheet?: string; row?: number; column?: number; day?: number }
}

export interface WorkbookParse {
  days: { day: number; dayName: string; sheet: string }[]
  sections: SectionRef[]
  dayTemplates: DayTemplateDraft[]
  slots: RawSlot[]
  subjectGroups: NameGroup[]
  teacherGroups: NameGroup[]
  coTaught: SplitName[]
  plan: PlanRow[]
  capabilities: CapabilityDraft[]
  constraints: ConstraintDraft[]
  issues: ImportIssue[]
  stats: {
    sheets: number
    filledSlots: number
    distinctSubjectStrings: number
    distinctTeacherStrings: number
    sectionsFound: number
  }
}

// ── small parsers ───────────────────────────────────────────────

const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
  IX: 9, X: 10, XI: 11, XII: 12,
}

/** Non-numeric class names some schools put in the same column. */
const PRE_PRIMARY: Record<string, number> = {
  NUR: -2, NURSERY: -2, PREP: -1, LKG: -1, UKG: 0, KG: 0,
}

/** Key separator for internal maps — never appears in a name. */
const SEP = '\u001f'

export function romanToNumber(s: string): number | null {
  const key = s.trim().toUpperCase().replace(/[^IVX]/g, '')
  return ROMAN[key] ?? null
}

/**
 * "I A", "IB", "III  B", "VIIIA" -> class + section.
 *
 * The spacing in these files is arbitrary — the same workbook writes
 * "I A" and "IB" three rows apart — so the split is done on the
 * Roman-numeral/letter boundary rather than on whitespace.
 */
export function parseSectionLabel(raw: string): Omit<SectionRef, 'periodsPerDay'> | null {
  const text = tidy(raw).toUpperCase()
  if (!text) return null

  const pre = text.match(/^(NURSERY|NUR|PREP|LKG|UKG|KG)\s*[-–]?\s*([A-Z])?$/)
  if (pre) {
    return {
      raw: tidy(raw),
      className: pre[1],
      numericLevel: PRE_PRIMARY[pre[1]] ?? 0,
      sectionName: pre[2] ?? 'A',
    }
  }

  const m = text.match(/^([IVX]+)\s*[-–]?\s*([A-Z])?$/)
  if (!m) return null
  const level = romanToNumber(m[1])
  if (level === null) return null

  return {
    raw: tidy(raw),
    className: m[1],
    numericLevel: level,
    sectionName: m[2] ?? 'A',
  }
}

/**
 * Read a row of times into a monotonically increasing 24-hour sequence.
 *
 * These files write "12:50-01:25" for a period that ends at 13:25 — a
 * 12-hour clock with the meridiem left off entirely, because a human
 * reading a school timetable never needs telling. Taken literally the
 * afternoon runs backwards into the small hours, so any time that would
 * land earlier than the one before it is pushed forward twelve hours.
 */
export function normalizeTimeSequence(times: string[]): string[] {
  const out: string[] = []
  let previousMinutes = -1
  let offset = 0

  for (const raw of times) {
    const m = raw.trim().match(/^(\d{1,2})[:.](\d{2})/)
    if (!m) { out.push(''); continue }

    const hours = Number(m[1])
    const minutes = Number(m[2])
    let total = hours * 60 + minutes + offset * 60

    // Strictly less-than, not less-than-or-equal: consecutive periods
    // share a boundary (period 1 ends 08:25, period 2 starts 08:25), and
    // treating that repeat as a rollover threw the whole afternoon
    // twelve hours forward — period 2 came out at 20:25.
    while (total < previousMinutes) {
      offset += 12
      total += 12 * 60
    }

    previousMinutes = total
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
    const mm = String(total % 60).padStart(2, '0')
    out.push(`${hh}:${mm}:00`)
  }

  return out
}

/** "07:50 08:25", "08:25-09:00", "10:10 – 10:30" -> ["07:50", "08:25"] */
function splitTimeCell(cell: string): [string, string] | null {
  const parts = tidy(cell).split(/\s*[-–—]\s*|\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return [parts[0], parts[1]]
}

/**
 * Trim the ends but keep the middle exactly as written.
 *
 * Deliberately not `tidy()`. A run of spaces inside a cell is the only
 * evidence that two cells were merged into one — "SST              Re" is
 * an overwritten "SST" and "Remedial-…". Collapsing that to "SST Re"
 * before the canonicaliser sees it destroys the signal, and the merged
 * cell then sails through as a subject of its own with nothing flagged
 * for review. Canonicalisation tidies for display; the raw string stays
 * the key.
 */
const cellValue = (raw: string) => (raw ?? '').replace(/^\s+|\s+$/g, '')

const BREAK_WORDS = /^(lunch|break|recess|interval|tiffin)$/i
const ASSEMBLY_WORDS = /^(assembly|prayer)$/i

// ── sheet structure ─────────────────────────────────────────────

interface SheetLayout {
  day: number
  dayName: string
  headerRow: number
  timesRow: number
  /** column index -> what that column is */
  columns: Map<number, PeriodDef>
}

function detectDay(sheet: Sheet, positional: number): { day: number; dayName: string } {
  for (const row of sheet.rows.slice(0, 5)) {
    for (const cell of row) {
      const idx = DAY_NAMES.indexOf(tidy(cell).toUpperCase())
      if (idx >= 0) return { day: idx + 1, dayName: DAY_NAMES[idx] }
    }
  }
  // Sheet names in these exports are often "Table 1".."Table 6", so
  // position is the only remaining signal. Monday-first is the
  // universal convention for a six-day week.
  const day = Math.min(positional + 1, 6)
  return { day, dayName: DAY_NAMES[day - 1] }
}

function readLayout(sheet: Sheet, positional: number, issues: ImportIssue[]): SheetLayout | null {
  const { day, dayName } = detectDay(sheet, positional)

  // The header row is the one carrying consecutive Roman numerals.
  let headerRow = -1
  for (let r = 0; r < Math.min(sheet.rows.length, 10); r++) {
    const cells = sheet.rows[r].map(c => tidy(c).toUpperCase())
    if (cells.includes('I') && cells.includes('II') && cells.includes('III')) { headerRow = r; break }
  }
  if (headerRow < 0) {
    issues.push({
      severity: 'block', code: 'NO_HEADER_ROW',
      message: `Sheet "${sheet.name}": could not find the period header row (looked for I, II and III in the first 10 rows).`,
      where: { sheet: sheet.name },
    })
    return null
  }

  const timesRow = headerRow + 1
  const header = sheet.rows[headerRow] ?? []
  const times = sheet.rows[timesRow] ?? []

  // Every time on the row is normalised together — the 12-hour rollover
  // can only be resolved by looking at the sequence, not one cell alone.
  const starts: string[] = []
  const ends: string[] = []
  for (let c = 0; c < header.length; c++) {
    const pair = splitTimeCell(times[c] ?? '')
    starts.push(pair ? pair[0] : '')
    ends.push(pair ? pair[1] : '')
  }
  const interleaved: string[] = []
  for (let i = 0; i < starts.length; i++) { interleaved.push(starts[i], ends[i]) }
  const flat = normalizeTimeSequence(interleaved)

  const columns = new Map<number, PeriodDef>()
  let slotIndex = 0

  for (let c = 0; c < header.length; c++) {
    const label = tidy(header[c] ?? '')
    if (!label) continue

    const startTime = flat[c * 2]
    const endTime = flat[c * 2 + 1]
    if (!startTime || !endTime) continue

    slotIndex++
    if (BREAK_WORDS.test(label)) {
      columns.set(c, { slotIndex, kind: 'lunch', periodNumber: null, startTime, endTime, label })
      continue
    }
    if (ASSEMBLY_WORDS.test(label)) {
      columns.set(c, { slotIndex, kind: 'assembly', periodNumber: null, startTime, endTime, label })
      continue
    }

    const periodNumber = romanToNumber(label) ?? (/^\d+$/.test(label) ? Number(label) : null)
    if (periodNumber === null) {
      slotIndex--
      continue
    }
    columns.set(c, { slotIndex, kind: 'period', periodNumber, startTime, endTime, label })
  }

  let hasPeriod = false
  for (const def of columns.values()) if (def.kind === 'period') hasPeriod = true
  if (!hasPeriod) {
    issues.push({
      severity: 'block', code: 'NO_PERIODS',
      message: `Sheet "${sheet.name}": the header row has no readable period numbers.`,
      where: { sheet: sheet.name },
    })
    return null
  }

  return { day, dayName, headerRow, timesRow, columns }
}

// ── main ────────────────────────────────────────────────────────

export function parseTimetableWorkbook(sheets: Sheet[]): WorkbookParse {
  const issues: ImportIssue[] = []
  const slots: RawSlot[] = []
  const days: WorkbookParse['days'] = []
  const layoutByDay = new Map<number, SheetLayout>()
  const sectionOrder: string[] = []
  const sectionPeriods = new Map<string, Set<number>>()

  const subjectCounts = new Map<string, number>()
  const teacherCounts = new Map<string, number>()

  sheets.forEach((sheet, index) => {
    const layout = readLayout(sheet, index, issues)
    if (!layout) return

    if (layoutByDay.has(layout.day)) {
      const already = days.find(d => d.day === layout.day)
      issues.push({
        severity: 'warn', code: 'DUPLICATE_DAY',
        message: `Sheet "${sheet.name}" also reads as ${layout.dayName}, which sheet "${already ? already.sheet : '?'}" already covers. Its rows were skipped.`,
        where: { sheet: sheet.name, day: layout.day },
      })
      return
    }
    layoutByDay.set(layout.day, layout)
    days.push({ day: layout.day, dayName: layout.dayName, sheet: sheet.name })

    // Section blocks: a label in column A, subjects on that row, the
    // teachers on the row beneath.
    for (let r = layout.timesRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r]
      const label = tidy((row && row[0]) || '')
      if (!label) continue

      const parsed = parseSectionLabel(label)
      if (!parsed) {
        issues.push({
          severity: 'warn', code: 'UNREADABLE_SECTION',
          message: `Sheet "${sheet.name}" row ${r + 1}: "${label}" is not a class/section label the importer recognises, so the row was skipped.`,
          where: { sheet: sheet.name, row: r + 1 },
        })
        continue
      }

      if (sectionOrder.indexOf(parsed.raw) < 0) sectionOrder.push(parsed.raw)
      const teacherRow = sheet.rows[r + 1] || []

      for (const entry of layout.columns) {
        const column = entry[0]
        const def = entry[1]
        if (def.kind !== 'period') continue
        const subject = cellValue(row[column] || '')
        const teacher = cellValue(teacherRow[column] || '')
        if (!subject && !teacher) continue

        if (subject && !teacher) {
          issues.push({
            severity: 'warn', code: 'SUBJECT_WITHOUT_TEACHER',
            message: `${parsed.raw} ${layout.dayName} period ${def.periodNumber}: "${subject}" has no teacher named.`,
            where: { sheet: sheet.name, row: r + 1, column: column + 1, day: layout.day },
          })
        }
        if (teacher && !subject) {
          issues.push({
            severity: 'warn', code: 'TEACHER_WITHOUT_SUBJECT',
            message: `${parsed.raw} ${layout.dayName} period ${def.periodNumber}: ${teacher} is named but no subject is.`,
            where: { sheet: sheet.name, row: r + 1, column: column + 1, day: layout.day },
          })
        }

        if (subject) subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1)
        if (teacher) teacherCounts.set(teacher, (teacherCounts.get(teacher) || 0) + 1)

        if (!sectionPeriods.has(parsed.raw)) sectionPeriods.set(parsed.raw, new Set())
        sectionPeriods.get(parsed.raw)!.add(def.periodNumber!)

        slots.push({
          day: layout.day,
          sectionLabel: parsed.raw,
          periodNumber: def.periodNumber!,
          subject, teacher,
          sheet: sheet.name, row: r + 1, column: column + 1,
        })
      }

      r++ // consume the teacher row
    }
  })

  days.sort((a, b) => a.day - b.day)

  if (!slots.length) {
    issues.push({
      severity: 'block', code: 'NO_SLOTS',
      message: 'No timetable rows were found. Check that each sheet has a period header row and section labels down the first column.',
    })
  }

  // ── sections ──────────────────────────────────────────────────
  const sections: SectionRef[] = sectionOrder.map(raw => {
    const parsed = parseSectionLabel(raw)!
    const used = sectionPeriods.get(raw) || new Set<number>()
    let highest = 0
    for (const p of used) if (p > highest) highest = p
    return Object.assign({}, parsed, { periodsPerDay: highest })
  }).sort((a, b) => a.numericLevel - b.numericLevel || a.sectionName.localeCompare(b.sectionName))

  // ── canonical names ───────────────────────────────────────────
  const subjectGroups = groupSubjects(subjectCounts)
  const teacherResult = groupTeachers(teacherCounts)
  const teacherGroups = teacherResult.groups
  const coTaught = teacherResult.coTaught
  const subjectOf = resolutionMap(subjectGroups)
  const teacherOf = resolutionMap(teacherGroups)

  const canonicalTeacher = (raw: string): string => {
    if (!raw) return ''
    // A co-taught cell records the first name as the one responsible.
    const primary = raw.indexOf('/') >= 0 ? tidy(raw.split('/')[0]) : tidy(raw)
    return teacherOf.get(primary) || primary
  }
  const canonicalSubject = (raw: string): string => (raw ? (subjectOf.get(raw) || tidy(raw)) : '')

  // ── day templates ─────────────────────────────────────────────
  // Sections are grouped by the shape of their day. In the source file
  // classes I-IV finish after period 9 and V-VIII after period 10, which
  // is two templates, not one template with holes in it.
  const templatesByShape = new Map<number, DayTemplateDraft>()
  const layouts = Array.from(layoutByDay.values())
  const anyLayout = layouts.length ? layouts[0] : null

  for (const section of sections) {
    if (!section.periodsPerDay) continue
    let template = templatesByShape.get(section.periodsPerDay)
    if (!template) {
      const allDefs = anyLayout ? Array.from(anyLayout.columns.values()) : []
      const periods = allDefs
        .filter(p => p.kind !== 'period' || (p.periodNumber || 0) <= section.periodsPerDay)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((p, i) => Object.assign({}, p, { slotIndex: i + 1 }))
      template = {
        name: `${section.periodsPerDay}-period day`,
        templateType: 'regular',
        periods,
        sectionLabels: [],
        days: days.map(d => d.day),
      }
      templatesByShape.set(section.periodsPerDay, template)
    }
    template.sectionLabels.push(section.raw)
  }
  const dayTemplates = Array.from(templatesByShape.values())
    .sort((a, b) => b.periods.length - a.periods.length)

  // ── the plan: weekly periods per section+subject, and who teaches it ──
  const planMap = new Map<string, PlanRow>()
  for (const slot of slots) {
    if (!slot.subject) continue
    const subject = canonicalSubject(slot.subject)
    const key = slot.sectionLabel + SEP + subject
    let row = planMap.get(key)
    if (!row) {
      row = { sectionLabel: slot.sectionLabel, subject, weeklyPeriods: 0, teachers: [] }
      planMap.set(key, row)
    }
    row.weeklyPeriods++
    const teacher = canonicalTeacher(slot.teacher)
    if (teacher && row.teachers.indexOf(teacher) < 0) row.teachers.push(teacher)
  }
  const plan = Array.from(planMap.values()).sort(
    (a, b) => a.sectionLabel.localeCompare(b.sectionLabel) || b.weeklyPeriods - a.weeklyPeriods,
  )

  // One teacher per subject per section is the rule these timetables are
  // built on, and the source file honours it in 360 of 362 cases. Where
  // it doesn't, say so rather than silently picking one.
  const levelOf = new Map(sections.map(s => [s.raw, s.numericLevel]))
  for (const row of plan) {
    if (row.teachers.length > 1) {
      issues.push({
        severity: 'warn', code: 'MULTIPLE_TEACHERS_FOR_SUBJECT',
        message: `${row.sectionLabel} ${row.subject} is taught by ${row.teachers.length} different people (${row.teachers.join(', ')}). Usually that means two spellings of one name, or a genuine job-share.`,
      })
    }
  }

  // ── capabilities ──────────────────────────────────────────────
  const capabilityMap = new Map<string, CapabilityDraft>()
  for (const row of plan) {
    const level = levelOf.get(row.sectionLabel) || 0
    for (const teacher of row.teachers) {
      const key = teacher + SEP + row.subject
      const existing = capabilityMap.get(key)
      if (existing) {
        existing.periods += row.weeklyPeriods
        existing.minClassLevel = Math.min(existing.minClassLevel, level)
        existing.maxClassLevel = Math.max(existing.maxClassLevel, level)
      } else {
        capabilityMap.set(key, {
          teacher, subject: row.subject, periods: row.weeklyPeriods,
          minClassLevel: level, maxClassLevel: level,
        })
      }
    }
  }
  const capabilities = Array.from(capabilityMap.values()).sort(
    (a, b) => a.teacher.localeCompare(b.teacher) || b.periods - a.periods,
  )

  // ── constraints, seeded from what the school already does ─────
  const occupancy = new Map<string, Map<number, Set<number>>>()
  for (const slot of slots) {
    const teacher = canonicalTeacher(slot.teacher)
    if (!teacher) continue
    if (!occupancy.has(teacher)) occupancy.set(teacher, new Map())
    const byDay = occupancy.get(teacher)!
    if (!byDay.has(slot.day)) byDay.set(slot.day, new Set())
    byDay.get(slot.day)!.add(slot.periodNumber)
  }

  let periodsAvailable = 0
  for (const s of sections) if (s.periodsPerDay > periodsAvailable) periodsAvailable = s.periodsPerDay
  const workingDays = days.length

  const constraints: ConstraintDraft[] = Array.from(occupancy.entries()).map(entry => {
    const teacher = entry[0]
    const byDay = entry[1]
    let perWeek = 0
    let maxPerDay = 0
    let maxConsecutive = 0

    for (const periods of byDay.values()) {
      perWeek += periods.size
      if (periods.size > maxPerDay) maxPerDay = periods.size
      const sorted = Array.from(periods).sort((a, b) => a - b)
      let run = 0
      for (let i = 0; i < sorted.length; i++) {
        run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
        if (run > maxConsecutive) maxConsecutive = run
      }
    }

    return {
      teacher,
      observedMaxPerDay: maxPerDay,
      observedPerWeek: perWeek,
      observedMaxConsecutive: maxConsecutive,
      freePeriodsPerWeek: Math.max(0, periodsAvailable * workingDays - perWeek),
      // Seeded from observation, not from a textbook. A school already
      // running eight periods back to back will switch off an app that
      // flags every teacher on the first page load, and then the alert
      // is worth nothing on the day a genuine breach happens. The
      // manager tightens these on the workload screen once they can see
      // the real distribution.
      maxPeriodsPerDay: maxPerDay,
      maxPeriodsPerWeek: perWeek,
      maxConsecutive: maxConsecutive,
    }
  }).sort((a, b) => b.observedPerWeek - a.observedPerWeek)

  // ── clashes already present in the source ─────────────────────
  const bySlot = new Map<string, RawSlot[]>()
  for (const slot of slots) {
    const teacher = canonicalTeacher(slot.teacher)
    if (!teacher) continue
    const key = slot.day + SEP + slot.periodNumber + SEP + teacher
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key)!.push(slot)
  }
  for (const entry of bySlot) {
    const clashing = entry[1]
    if (clashing.length < 2) continue
    const parts = entry[0].split(SEP)
    const dayNumber = Number(parts[0])
    issues.push({
      severity: 'warn', code: 'TEACHER_DOUBLE_BOOKED',
      message: `${parts[2]} is booked in ${clashing.length} places at once on ${DAY_NAMES[dayNumber - 1]} period ${parts[1]}: ${clashing.map(c => `${c.sectionLabel} (${c.subject})`).join(', ')}.`,
      where: { day: dayNumber, sheet: clashing[0].sheet, row: clashing[0].row },
    })
  }

  let filled = 0
  for (const s of slots) if (s.subject) filled++

  return {
    days, sections, dayTemplates, slots,
    subjectGroups, teacherGroups, coTaught,
    plan, capabilities, constraints, issues,
    stats: {
      sheets: sheets.length,
      filledSlots: filled,
      distinctSubjectStrings: subjectCounts.size,
      distinctTeacherStrings: teacherCounts.size,
      sectionsFound: sections.length,
    },
  }
}
