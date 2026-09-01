import { inflateRawSync } from 'zlib'

// ═══════════════════════════════════════════════════════════════
// Minimal XLSX reader — no dependencies.
// ═══════════════════════════════════════════════════════════════
//
// An .xlsx is a ZIP of XML. We need exactly one thing out of it: each
// sheet as a rectangular grid of strings. SheetJS would do that, but it
// is ~7MB of parser for a format we consume in one shape, from one
// trusted upload path, and it brings its own CVE surface. This is ~200
// lines that do the same job and can be read in full.
//
// Deliberately NOT supported, each throwing rather than guessing:
//   - ZIP64 archives (a timetable is kilobytes; a 4GB one is an attack)
//   - encrypted workbooks
//   - formulas (the cached <v> value is read instead, which is what a
//     spreadsheet shows and therefore what the school means)
//   - dates as dates (returned as the raw serial; timetable times in
//     these files are text, and guessing a locale is worse than not)

export interface Sheet {
  name: string
  /** rows[r][c] — always a string, '' for empty. Ragged rows are padded. */
  rows: string[][]
}

// ── ZIP ─────────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50

function findEocd(buf: Buffer): number {
  // The EOCD is at the end, but a trailing comment can push it back up
  // to 64KB. Scan backwards from the end for the signature.
  const min = Math.max(0, buf.length - 0x10000 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('Not a valid .xlsx file (no ZIP end-of-central-directory record found)')
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buf)
  const entryCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    throw new Error('ZIP64 archives are not supported. Re-save the file as a standard .xlsx.')
  }

  const files = new Map<string, Buffer>()
  let p = cdOffset

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`Corrupt .xlsx: central directory entry ${i + 1} has a bad signature`)
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    if (flags & 0x1) throw new Error('Encrypted .xlsx files are not supported.')

    // The local header repeats the name/extra lengths and they are NOT
    // guaranteed to match the central directory's — the extra field in
    // particular often differs. Read the local ones or the data offset
    // lands mid-file.
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) files.set(name, Buffer.from(raw))
    else if (method === 8) files.set(name, inflateRawSync(raw))
    else throw new Error(`Unsupported ZIP compression method ${method} for "${name}"`)

    p += 46 + nameLen + extraLen + commentLen
  }

  return files
}

// ── XML ─────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

function decodeXml(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

/** Concatenate the text of every <t> element inside a fragment. */
/**
 * Walk every <tag> element at any depth, yielding its attribute string
 * and inner body.
 *
 * Written as an explicit scan rather than one regex because a
 * self-closing element is the trap here: `/<c\b([^>]*)>([\s\S]*?)<\/c>/`
 * happily matches `<c r="B1"/>` (the `/` is just another non-`>` char)
 * and then hunts forward for the next `</c>`, silently swallowing every
 * cell in between. That produced a grid where values landed one column
 * left of where they belong — which looks like a plausible timetable,
 * not like a parse error.
 */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  // \b after the tag name stops <c> from matching <col>.
  const open = new RegExp(`<${tag}\\b([^>]*)>`, 'g')
  const close = `</${tag}>`
  let m: RegExpExecArray | null

  while ((m = open.exec(xml))) {
    const attrs = m[1]
    if (attrs.endsWith('/')) {
      yield { attrs: attrs.slice(0, -1), body: '' }
      continue
    }
    const end = xml.indexOf(close, open.lastIndex)
    if (end === -1) {
      yield { attrs, body: xml.slice(open.lastIndex) }
      return
    }
    yield { attrs, body: xml.slice(open.lastIndex, end) }
    open.lastIndex = end + close.length
  }
}

/** Concatenate the text of every <t> element inside a fragment. */
function textOf(fragment: string): string {
  let out = ''
  for (const t of elements(fragment, 't')) out += decodeXml(t.body)
  return out
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? decodeXml(m[1]) : null
}

/** "BC" -> 54 (zero-based). */
export function columnToIndex(ref: string): number {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

// ── Workbook ────────────────────────────────────────────────────

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const out: string[] = []
  for (const si of elements(xml, 'si')) out.push(textOf(si.body))
  return out
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let maxCol = 0

  for (const row of elements(xml, 'row')) {
    // r is 1-based and skips entirely empty rows, so trust it over the
    // iteration count — otherwise a blank row between sections silently
    // shifts everything below it up one.
    const rAttr = Number(attr(row.attrs, 'r') ?? NaN)
    const rowNo = Number.isFinite(rAttr) && rAttr > 0 ? rAttr - 1 : rows.length

    const cells: string[] = []
    for (const c of elements(row.body, 'c')) {
      const ref = attr(c.attrs, 'r')
      const type = attr(c.attrs, 't')
      const col = ref ? columnToIndex(ref) : cells.length

      let value = ''
      if (type === 's') {
        const vm = c.body.match(/<v>([\s\S]*?)<\/v>/)
        const idx = vm ? Number(decodeXml(vm[1])) : NaN
        value = Number.isFinite(idx) ? (shared[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = textOf(c.body)
      } else {
        const vm = c.body.match(/<v>([\s\S]*?)<\/v>/)
        value = vm ? decodeXml(vm[1]) : ''
      }

      while (cells.length < col) cells.push('')
      cells[col] = value
      if (col + 1 > maxCol) maxCol = col + 1
    }

    while (rows.length < rowNo) rows.push([])
    rows[rowNo] = cells
  }

  for (const r of rows) while (r.length < maxCol) r.push('')
  return rows
}

/**
 * Read an .xlsx buffer into sheets, in workbook order, with sheet names.
 *
 * Sheet order matters here: the school's file uses one sheet per weekday
 * and does not always name them "Monday" — the day is written inside the
 * grid. Preserving order lets the caller fall back to position.
 */
export function readWorkbook(buf: Buffer): Sheet[] {
  const files = unzip(buf)

  const read = (name: string) => {
    const f = files.get(name)
    return f ? f.toString('utf8') : undefined
  }

  const workbookXml = read('xl/workbook.xml')
  if (!workbookXml) throw new Error('Not a valid .xlsx file (xl/workbook.xml is missing)')

  const shared = parseSharedStrings(read('xl/sharedStrings.xml'))

  // Sheet name -> target file, resolved through the rels file. Sheet
  // XML is usually xl/worksheets/sheetN.xml in order, but that is a
  // convention, not a rule; the rels mapping is the actual answer.
  const relsXml = read('xl/_rels/workbook.xml.rels') ?? ''
  const targetById = new Map<string, string>()
  for (const rel of elements(relsXml, 'Relationship')) {
    const id = attr(rel.attrs, 'Id')
    const target = attr(rel.attrs, 'Target')
    if (id && target) targetById.set(id, target.replace(/^\/?(xl\/)?/, ''))
  }

  const sheets: Sheet[] = []
  let positional = 0
  for (const sheetEl of elements(workbookXml, 'sheet')) {
    positional++
    const name = attr(sheetEl.attrs, 'name') ?? `Sheet${positional}`
    const rid = attr(sheetEl.attrs, 'r:id') ?? attr(sheetEl.attrs, 'id')
    const rel = rid ? targetById.get(rid) : undefined
    const path = rel ? `xl/${rel}` : `xl/worksheets/sheet${positional}.xml`
    const xml = read(path) ?? read(`xl/worksheets/sheet${positional}.xml`)
    if (!xml) continue
    sheets.push({ name, rows: parseSheet(xml, shared) })
  }

  if (!sheets.length) throw new Error('The workbook contains no readable sheets.')
  return sheets
}

// ── writing ─────────────────────────────────────────────────────
//
// The inverse of readWorkbook: a multi-sheet workbook of plain-string
// grids, as a real .xlsx (ZIP of XML). Deliberately minimal — no styles,
// no numbers, just shared-string cells — because its one job is to
// reproduce the picture-grid layout parseWorkbook reads, so an export
// round-trips back through the import. stdlib only (same reason the
// reader is hand-rolled): no SheetJS.

function zipStore(files: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(file.content, 'utf8')  // stored (method 0), no compression
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)      // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)   // stored
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function writeWorkbook(sheets: { name: string; grid: string[][] }[]): Buffer {
  const shared: string[] = []
  const strIndex = (s: string) => {
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
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const sheetXml = sheets.map(({ grid }) => {
    const rows = grid.map((row, r) => {
      const cells = row.map((value, c) =>
        value ? `<c r="${colName(c)}${r + 1}" t="s"><v>${strIndex(value)}</v></c>` : `<c r="${colName(c)}${r + 1}"/>`
      ).join('')
      return `<row r="${r + 1}">${cells}</row>`
    }).join('')
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
  })

  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      }</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
        sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      }</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      }<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${
        shared.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')
      }</sst>`,
    },
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: xml })),
  ]
  return zipStore(files)
}
