import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'zlib'
import { existsSync, readFileSync } from 'fs'
import { readWorkbook, columnToIndex, Sheet } from './xlsx'
import {
  groupSubjects, groupTeachers, levenshtein, looksTruncated, normalizeKey, tidy,
} from './canonicalize'
import {
  parseTimetableWorkbook, parseSectionLabel, romanToNumber, normalizeTimeSequence,
} from './parseWorkbook'

// ═══════════════════════════════════════════════════════════════
// Fixtures are synthetic on purpose.
// ═══════════════════════════════════════════════════════════════
// The workbook this importer was built against belongs to a real school
// and carries 27 real teachers' names, so it is not committed and the
// suite must pass without it. The dirt it contains is reproduced here
// deliberately instead — case drift, doubled spaces, eaten leading
// characters, merged cells, one misspelt name and one co-taught slot —
// because that dirt IS the specification. A parser that only handles
// clean input would pass a clean fixture and fail on day one.
//
// The last block opportunistically re-parses the real file when it
// happens to be present locally, and is skipped in CI.

// ── a minimal .xlsx writer, so the ZIP/XML reader is exercised too ──

function zip(files: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const raw = Buffer.from(file.content, 'utf8')
    const deflated = deflateRawSync(raw)
    // Alternate stored and deflated so both branches of the reader run.
    const stored = locals.length % 2 === 0
    const data = stored ? raw : deflated
    const method = stored ? 0 : 8

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14) // crc, unchecked by the reader
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, eocd])
}

/** Build a one-sheet-per-day workbook from grids of plain strings. */
function makeWorkbook(sheets: { name: string; grid: string[][] }[]): Buffer {
  const shared: string[] = []
  const indexOfString = (s: string) => {
    let i = shared.indexOf(s)
    if (i < 0) { shared.push(s); i = shared.length - 1 }
    return i
  }

  const colName = (n: number) => {
    let out = ''
    n += 1
    while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26) }
    return out
  }

  const sheetXml = sheets.map(({ grid }) => {
    const rows = grid.map((row, r) => {
      const cells = row.map((value, c) => {
        if (!value) return `<c r="${colName(c)}${r + 1}"/>`
        return `<c r="${colName(c)}${r + 1}" t="s"><v>${indexOfString(value)}</v></c>`
      }).join('')
      return `<row r="${r + 1}">${cells}</row>`
    }).join('')
    return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`
  })

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const files = [
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0"?><workbook><sheets>${
        sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      }</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0"?><Relationships>${
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      }</Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      content: `<?xml version="1.0"?><sst>${shared.map(s => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join('')}</sst>`,
    },
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: xml })),
  ]

  return zip(files)
}

// ── the fixture school ──────────────────────────────────────────
// Two classes, two sections each, a nine- and a ten-period day, a break
// in the middle, and the same categories of mess as the real file.

const HEADER = ['', 'I', 'II', 'III', 'LUNCH', 'IV', 'V']
const TIMES = ['', '07:50 08:25', '08:25-09:00', '09:00-09:35', '09:35-09:55', '09:55-10:30', '12:50-01:25']

function dayGrid(day: string, rows: string[][][]): string[][] {
  const grid: string[][] = [
    ['', '', '', 'TIME TABLE', '', '', day],
    HEADER,
    TIMES,
  ]
  for (const [subjects, teachers] of rows) {
    grid.push(subjects)
    grid.push(teachers)
    grid.push([])
  }
  return grid
}

// I A and IB run four periods; II A and IIB run five.
const MONDAY = dayGrid('MONDAY', [
  [['I A', 'Maths', 'English', 'GK', '', 'Art', ''], ['', 'Heena', 'Sajida', 'Neha Singh', '', 'Aarti', '']],
  [['IB', 'English', 'Maths', 'Gk', '', 'Art', ''], ['', 'Sajida', 'Heena', 'Neha Singh', '', 'Aarti', '']],
  [['II A', 'Maths', 'Remedial- English', 'Computer Lab', '', 'GK', 'Science'], ['', 'Krishna', 'Sajida', 'Pooja Rai', '', 'Neha Singh', 'Basundhara']],
  [['IIB', 'Maths', 'emedial- English', 'Computer  LAB', '', 'GK', 'Science'], ['', 'Krishana', 'Sajida', 'Pooja Rai', '', 'Neha Singh', 'Vishnu/ Preeti']],
])

const TUESDAY = dayGrid('TUESDAY', [
  [['I A', 'English', 'Maths', 'Art', '', 'GK', ''], ['', 'Sajida', 'Heena', 'Aarti', '', 'Neha Singh', '']],
  [['IB', 'Maths', 'English', 'Art', '', 'GK', ''], ['', 'Heena', 'Sajida', 'Aarti', '', 'Neha Singh', '']],
  [['II A', 'Science', 'Maths', 'GK              Re', '', 'Computer LAB', 'Maths'], ['', 'Basundhara', 'Krishna', 'Neha Singh', '', 'Pooja Rai', 'Krishna']],
  [['IIB', 'Science', 'Maths', 'English (W)', '', 'Computer Lab', 'Maths'], ['', 'Basundhara', 'Krishna', 'Sajida', '', 'Pooja Rai', 'Krishna']],
])

// ── xlsx reader ─────────────────────────────────────────────────

describe('xlsx reader', () => {
  it('maps column letters to indexes', () => {
    expect(columnToIndex('A1')).toBe(0)
    expect(columnToIndex('Z9')).toBe(25)
    expect(columnToIndex('AA1')).toBe(26)
    expect(columnToIndex('BC12')).toBe(54)
  })

  it('reads sheets in workbook order with their names', () => {
    const sheets = readWorkbook(makeWorkbook([
      { name: 'Table 1', grid: MONDAY },
      { name: 'Table 2', grid: TUESDAY },
    ]))
    expect(sheets.map(s => s.name)).toEqual(['Table 1', 'Table 2'])
  })

  it('keeps values in their own columns when a row has empty cells', () => {
    // The bug this guards: a self-closing <c r="B1"/> matched by a
    // greedy open/close pair swallows every cell up to the next </c>,
    // which shifts real values one column left. The result still looks
    // like a plausible timetable, so nothing downstream catches it.
    const sheets = readWorkbook(makeWorkbook([{
      name: 'S',
      grid: [['a', '', '', 'd', '', 'f']],
    }]))
    expect(sheets[0].rows[0]).toEqual(['a', '', '', 'd', '', 'f'])
  })

  it('preserves blank rows so later rows keep their index', () => {
    const sheets = readWorkbook(makeWorkbook([{
      name: 'S',
      grid: [['top'], [], [], ['bottom']],
    }]))
    expect(sheets[0].rows[3][0]).toBe('bottom')
  })

  it('decodes XML entities', () => {
    const sheets = readWorkbook(makeWorkbook([{ name: 'S', grid: [['Art & Craft', '<b>', '"q"']] }]))
    expect(sheets[0].rows[0]).toEqual(['Art & Craft', '<b>', '"q"'])
  })

  it('rejects a file that is not a zip', () => {
    expect(() => readWorkbook(Buffer.from('this is a csv, actually'))).toThrow(/not a valid \.xlsx/i)
  })

  it('rejects a zip that is not a workbook', () => {
    expect(() => readWorkbook(zip([{ name: 'readme.txt', content: 'hello' }])))
      .toThrow(/xl\/workbook\.xml/)
  })
})

// ── canonicalization ────────────────────────────────────────────

describe('canonicalize', () => {
  it('normalizes and tidies', () => {
    expect(normalizeKey('Remedial- English')).toBe('remedialenglish')
    expect(tidy('  Computer   LAB ')).toBe('Computer LAB')
  })

  it('measures edit distance', () => {
    expect(levenshtein('krishna', 'krishana')).toBe(1)
    expect(levenshtein('nehasingh', 'nehasri')).toBeGreaterThan(1)
  })

  it('only calls a merged cell truncated', () => {
    expect(looksTruncated('SST              Re')).toBe(true)
    // These all tripped an earlier, looser heuristic. Five false alarms
    // for one true one trains the reviewer to click straight through.
    expect(looksTruncated('Computer Lab')).toBe(false)
    expect(looksTruncated('Pooja Rai')).toBe(false)
    expect(looksTruncated('Neha sri')).toBe(false)
    expect(looksTruncated('Remedial- EVS')).toBe(false)
  })

  it('merges case, spacing and punctuation drift without asking', () => {
    const groups = groupSubjects(new Map([
      ['GK', 33], ['Gk', 7],
      ['Computer Lab', 11], ['Computer  LAB', 3], ['Computer LAB', 3],
    ]))
    const gk = groups.find(g => normalizeKey(g.canonical) === 'gk')!
    expect(gk.canonical).toBe('GK')
    expect(gk.variants).toHaveLength(2)
    expect(gk.needsReview).toBe(false)

    const lab = groups.find(g => normalizeKey(g.canonical) === 'computerlab')!
    expect(lab.variants).toHaveLength(3)
    expect(lab.needsReview).toBe(false)
  })

  it('repairs a word whose leading characters were eaten', () => {
    // "Remedial- Science" does not appear anywhere in the source; the
    // word "Remedial" does, four times, in other subjects. The repair
    // therefore has to work at word level across the whole corpus.
    const groups = groupSubjects(new Map([
      ['Remedial- English', 26], ['Remedial- Maths', 32], ['Remedial- Hindi', 16],
      ['Remedial- EVS', 10], ['emedial- Science', 6], ['medial- English', 2],
    ]))
    const science = groups.find(g => g.canonical.includes('Science'))!
    expect(science.canonical).toBe('Remedial- Science')
    expect(science.confidence).toBe('high')
    expect(science.needsReview).toBe(true)

    const english = groups.find(g => normalizeKey(g.canonical) === 'remedialenglish')!
    expect(english.variants.map(v => v.raw)).toContain('medial- English')
  })

  it('never merges a bracketed qualifier away', () => {
    // "English" and "English (W)" are one edit apart once punctuation is
    // stripped, and are two different subjects with separate weekly
    // quotas. Merging them doubles one and deletes the other.
    const groups = groupSubjects(new Map([['English', 80], ['English (W)', 16], ['Hindi', 87], ['Hindi (W)', 10]]))
    expect(groups.map(g => g.canonical).sort())
      .toEqual(['English', 'English (W)', 'Hindi', 'Hindi (W)'])
  })

  it('flags a genuinely merged cell for review instead of guessing', () => {
    const groups = groupSubjects(new Map([['SST', 44], ['SST              Re', 1]]))
    const flagged = groups.find(g => g.confidence === 'low')!
    expect(flagged).toBeDefined()
    expect(flagged.needsReview).toBe(true)
  })

  it('merges one misspelt teacher but keeps four different Nehas apart', () => {
    const { groups } = groupTeachers(new Map([
      ['Krishna', 39], ['Krishana', 10],
      ['Neha Singh', 40], ['Neha Mishra', 44], ['Neha Joshi', 44], ['Neha sri', 43],
    ]))
    const krishna = groups.find(g => g.canonical === 'Krishna')!
    expect(krishna.variants).toHaveLength(2)
    expect(krishna.confidence).toBe('high')

    const nehas = groups.filter(g => g.canonical.startsWith('Neha'))
    expect(nehas).toHaveLength(4)
  })

  it('splits a co-taught cell into two people', () => {
    const { groups, coTaught } = groupTeachers(new Map([['Vishnu/ Preeti', 3], ['Vishnu', 5], ['Preeti', 8]]))
    expect(coTaught).toEqual([{ raw: 'Vishnu/ Preeti', parts: ['Vishnu', 'Preeti'] }])
    expect(groups.find(g => g.canonical === 'Vishnu')!.variants[0].count).toBe(8)
    expect(groups.find(g => g.canonical === 'Preeti')!.variants[0].count).toBe(11)
    expect(groups.map(g => g.canonical)).not.toContain('Vishnu/ Preeti')
  })
})

// ── small parsers ───────────────────────────────────────────────

describe('label and time parsing', () => {
  it('reads Roman numerals', () => {
    expect(romanToNumber('VIII')).toBe(8)
    expect(romanToNumber('iv')).toBe(4)
    expect(romanToNumber('LUNCH')).toBe(null)
  })

  it('splits class and section however they are spaced', () => {
    for (const [raw, level, section] of [
      ['I A', 1, 'A'], ['IB', 1, 'B'], ['III  B', 3, 'B'], ['VIIIA', 8, 'A'], ['IV-B', 4, 'B'],
    ] as [string, number, string][]) {
      const parsed = parseSectionLabel(raw)!
      expect(parsed, raw).toBeTruthy()
      expect(parsed.numericLevel, raw).toBe(level)
      expect(parsed.sectionName, raw).toBe(section)
    }
    expect(parseSectionLabel('LKG')!.className).toBe('LKG')
    expect(parseSectionLabel('Total periods')).toBe(null)
  })

  it('reads an afternoon written on a 12-hour clock with no meridiem', () => {
    const out = normalizeTimeSequence(['07:50', '08:25', '12:50', '01:25', '01:25', '02:00'])
    expect(out).toEqual(['07:50:00', '08:25:00', '12:50:00', '13:25:00', '13:25:00', '14:00:00'])
  })

  it('treats a shared boundary as the same instant, not a rollover', () => {
    // Period 1 ends at 08:25 and period 2 starts at 08:25. Reading the
    // repeat as "time went backwards" threw the rest of the day twelve
    // hours forward, so period 2 came out at 20:25.
    expect(normalizeTimeSequence(['08:25', '08:25', '09:00'])).toEqual(['08:25:00', '08:25:00', '09:00:00'])
  })
})

// ── the whole workbook ──────────────────────────────────────────

describe('parseTimetableWorkbook', () => {
  const parsed = parseTimetableWorkbook(readWorkbook(makeWorkbook([
    { name: 'Table 1', grid: MONDAY },
    { name: 'Table 2', grid: TUESDAY },
  ])))

  it('reads the weekday out of the grid, not the sheet name', () => {
    expect(parsed.days).toEqual([
      { day: 1, dayName: 'MONDAY', sheet: 'Table 1' },
      { day: 2, dayName: 'TUESDAY', sheet: 'Table 2' },
    ])
  })

  it('finds every section and how long its day is', () => {
    expect(parsed.sections.map(s => s.raw)).toEqual(['I A', 'IB', 'II A', 'IIB'])
    expect(parsed.sections.map(s => s.periodsPerDay)).toEqual([4, 4, 5, 5])
  })

  it('groups sections into one day template per day-shape', () => {
    expect(parsed.dayTemplates).toHaveLength(2)
    const long = parsed.dayTemplates[0]
    expect(long.sectionLabels).toEqual(['II A', 'IIB'])
    expect(long.periods.filter(p => p.kind === 'period')).toHaveLength(5)
    expect(long.periods.some(p => p.kind === 'lunch')).toBe(true)
  })

  it('puts the break where the school put it, with real times', () => {
    const periods = parsed.dayTemplates[0].periods
    expect(periods.map(p => p.kind)).toEqual(
      ['period', 'period', 'period', 'lunch', 'period', 'period'],
    )
    expect(periods[0].startTime).toBe('07:50:00')
    expect(periods[5].startTime).toBe('12:50:00')
    expect(periods[5].endTime).toBe('13:25:00')
  })

  it('counts weekly periods per section and subject through the canonical names', () => {
    // "GK" and "Gk" are the same subject, so IB has two GK periods, not
    // one of each.
    const gk = parsed.plan.find(p => p.sectionLabel === 'IB' && p.subject === 'GK')!
    expect(gk.weeklyPeriods).toBe(2)
    expect(gk.teachers).toEqual(['Neha Singh'])
  })

  it('resolves a misspelt teacher to one person in the plan', () => {
    // "Krishna" on Monday, "Krishana" on the IIB row — one person.
    const maths = parsed.plan.find(p => p.sectionLabel === 'IIB' && p.subject === 'Maths')!
    expect(maths.teachers).toEqual(['Krishna'])
  })

  it('derives capabilities with the class range actually taught', () => {
    const heena = parsed.capabilities.filter(c => c.teacher === 'Heena')
    expect(heena.map(c => c.subject)).toEqual(['Maths'])
    expect(heena[0].minClassLevel).toBe(1)
    expect(heena[0].maxClassLevel).toBe(1)

    const krishna = parsed.capabilities.find(c => c.teacher === 'Krishna' && c.subject === 'Maths')!
    expect(krishna.minClassLevel).toBe(2)
  })

  it('seeds workload limits from what the school already does', () => {
    const sajida = parsed.constraints.find(c => c.teacher === 'Sajida')!
    expect(sajida.observedPerWeek).toBeGreaterThan(0)
    // Seeded, not invented: the limit equals the observation, so nothing
    // is in breach the moment the school first opens the page.
    expect(sajida.maxPeriodsPerWeek).toBe(sajida.observedPerWeek)
    expect(sajida.maxPeriodsPerDay).toBe(sajida.observedMaxPerDay)
    expect(sajida.maxConsecutive).toBe(sajida.observedMaxConsecutive)
  })

  it('reports a teacher standing in two rooms at once', () => {
    // Neha Singh takes GK for both I A and IB in period III on Monday.
    const clashes = parsed.issues.filter(i => i.code === 'TEACHER_DOUBLE_BOOKED')
    const nehaSingh = clashes.find(c => c.message.startsWith('Neha Singh'))!
    expect(nehaSingh, 'expected Neha Singh to be reported as double-booked').toBeTruthy()
    expect(nehaSingh.message).toContain('I A (GK)')
    expect(nehaSingh.message).toContain('IB (Gk)')
    expect(nehaSingh.where!.day).toBe(1)

    // The clash is found through the canonical name, so one teacher spelt
    // two ways in two rows still reads as one person in one place twice.
    const krishna = clashes.find(c => c.message.startsWith('Krishna'))!
    expect(krishna, 'Krishna/Krishana must be resolved before clash detection').toBeTruthy()
    expect(krishna.message).toContain('II A')
    expect(krishna.message).toContain('IIB')
  })

  it('counts what it read', () => {
    expect(parsed.stats.sheets).toBe(2)
    expect(parsed.stats.sectionsFound).toBe(4)
    expect(parsed.stats.filledSlots).toBe(parsed.slots.filter(s => s.subject).length)
  })

  it('refuses a sheet with no period header instead of importing nothing', () => {
    const broken = parseTimetableWorkbook([{ name: 'Notes', rows: [['just', 'some', 'notes']] } as Sheet])
    expect(broken.issues.some(i => i.code === 'NO_HEADER_ROW')).toBe(true)
    expect(broken.issues.some(i => i.severity === 'block')).toBe(true)
  })
})

// ── the real workbook, when it is present ───────────────────────

const REAL = `${__dirname}/../../../../../New Time table (1).xlsx`

describe.skipIf(!existsSync(REAL))('the real school workbook', () => {
  it('parses end to end', () => {
    const parsed = parseTimetableWorkbook(readWorkbook(readFileSync(REAL)))
    expect(parsed.days).toHaveLength(6)
    expect(parsed.sections).toHaveLength(16)
    expect(parsed.stats.filledSlots).toBe(912)
    // Classes I-IV go home after period 9; V-VIII after period 10.
    expect(parsed.dayTemplates.map(t => t.periods.filter(p => p.kind === 'period').length))
      .toEqual([10, 9])
    // 35 raw spellings collapse to well under 30 real subjects.
    expect(parsed.subjectGroups.length).toBeLessThan(30)
    expect(parsed.issues.every(i => i.severity !== 'block')).toBe(true)
  })
})
