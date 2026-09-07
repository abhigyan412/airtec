// Minimal RFC-4180-ish CSV parser/writer for bulk-import dialogs.
//
// No library — the format we need is one flat sheet of simple fields
// (no embedded newlines-inside-quotes edge cases beyond the basics),
// same "don't pull in a parser for a shape we can read in a few dozen
// lines" reasoning as the timetable module's own hand-rolled XLSX
// reader (backend/src/modules/timetable/import/xlsx.ts).

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
  }
  cells.push(cur)
  return cells
}

/** Parses CSV text into an array of objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

/** A downloadable template: just the header row, quoted per RFC 4180 where needed. */
export function csvTemplate(columns: string[]): string {
  return '﻿' + columns.join(',') + '\r\n'
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
