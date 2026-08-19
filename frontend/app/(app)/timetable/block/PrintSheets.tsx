'use client'

import { DAYS } from '../shared'

// ═══════════════════════════════════════════════════════════════
// The printable artefact: every class's week, one per page
// ═══════════════════════════════════════════════════════════════
//
// Hidden on screen and shown only to the printer, so "print all classes"
// is the browser's own print dialog rather than a generated file the
// server has to build, hold and hand back. A school printing sixteen
// class timetables wants sixteen sheets to pin up, not a PDF to open.
//
// Deliberately plain: black on white, ruled, no subject tints. Tinted
// cells cost a fortune in toner and come out as indistinguishable greys
// on the office laser printer, which is what these are printed on.

const fmt = (t?: string | null) => (t ? t.slice(0, 5) : '')

export function PrintSheets({ data, mode }: { data: any; mode: 'class' | 'teacher' }) {
  const teaching = (data.slots ?? []).filter((s: any) => !s.isBreak)

  // Pivoted the same way the teacher view on screen is, from the same
  // cells, so the sheet handed to a teacher and the grid the office is
  // looking at cannot disagree.
  const teachers = (() => {
    const names = new Map<string, string>()
    const index = new Map<string, any[]>()
    for (const cell of Object.values(data.cells) as any[]) {
      if (cell.isBreak || !cell.teacherId) continue
      names.set(cell.teacherId, cell.teacherName ?? 'Unknown')
      const key = `${cell.teacherId}:${cell.dayOfWeek}:${cell.periodNumber}`
      index.set(key, [...(index.get(key) ?? []), cell])
    }
    return {
      list: Array.from(names.entries()).map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      index,
    }
  })()

  return (
    <div className="hidden print:block">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body { background: #fff !important; }
          .tt-sheet { page-break-after: always; break-after: page; }
          .tt-sheet:last-child { page-break-after: auto; break-after: auto; }
          .tt-table { width: 100%; border-collapse: collapse; }
          .tt-table th, .tt-table td {
            border: 1px solid #999; padding: 4px 6px; vertical-align: top;
            font-size: 10pt; color: #000;
          }
          .tt-table th { background: #eee !important; -webkit-print-color-adjust: exact; }
          .tt-sub { font-weight: 600; }
          .tt-teacher { font-size: 8.5pt; color: #333; }
          .tt-room { font-size: 8pt; color: #666; }
        }
      `}</style>

      {mode === 'teacher' ? teachers.list.map(teacher => (
        <section key={teacher.id} className="tt-sheet">
          <header style={{ marginBottom: '6mm' }}>
            <h1 style={{ fontSize: '16pt', fontWeight: 700, color: '#000' }}>{teacher.name}</h1>
            <p style={{ fontSize: '9pt', color: '#444' }}>
              {data.version?.label ?? 'Timetable'}
              {data.source === 'draft' ? ' — DRAFT, not yet published' : ''}
            </p>
          </header>

          <table className="tt-table">
            <thead>
              <tr>
                <th style={{ width: '18mm' }}>Period</th>
                {data.days.map((d: number) => <th key={d}>{DAYS[d - 1] ?? `Day ${d}`}</th>)}
              </tr>
            </thead>
            <tbody>
              {teaching.map((slot: any) => (
                <tr key={slot.periodNumber}>
                  <td>
                    <div className="tt-sub">{slot.periodNumber}</div>
                    <div className="tt-room">{fmt(slot.startTime)}–{fmt(slot.endTime)}</div>
                  </td>
                  {data.days.map((d: number) => {
                    const here = teachers.index.get(`${teacher.id}:${d}:${slot.periodNumber}`) ?? []
                    if (!here.length) return <td key={d} />
                    return (
                      <td key={d}>
                        {here.map((cell: any) => (
                          <div key={cell.id}>
                            <div className="tt-sub">{cell.sectionLabel}</div>
                            <div className="tt-teacher">{cell.subjectName}</div>
                            {cell.roomName && <div className="tt-room">{cell.roomName}</div>}
                          </div>
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )) : data.sections.map((section: any) => (
        <section key={section.sectionId} className="tt-sheet">
          <header style={{ marginBottom: '6mm' }}>
            <h1 style={{ fontSize: '16pt', fontWeight: 700, color: '#000' }}>{section.label}</h1>
            <p style={{ fontSize: '9pt', color: '#444' }}>
              {data.version?.label ?? 'Timetable'}
              {data.source === 'draft' ? ' — DRAFT, not yet published' : ''}
            </p>
          </header>

          <table className="tt-table">
            <thead>
              <tr>
                <th style={{ width: '18mm' }}>Period</th>
                {data.days.map((d: number) => <th key={d}>{DAYS[d - 1] ?? `Day ${d}`}</th>)}
              </tr>
            </thead>
            <tbody>
              {teaching.map((slot: any) => (
                <tr key={slot.periodNumber}>
                  <td>
                    <div className="tt-sub">{slot.periodNumber}</div>
                    <div className="tt-room">{fmt(slot.startTime)}–{fmt(slot.endTime)}</div>
                  </td>
                  {data.days.map((d: number) => {
                    const cell = data.cells[`${section.sectionId}:${d}:${slot.periodNumber}`]
                    if (!cell) return <td key={d} />
                    return (
                      <td key={d}>
                        <div className="tt-sub">{cell.subjectName || ''}</div>
                        {cell.teacherName && <div className="tt-teacher">{cell.teacherName}</div>}
                        {cell.roomName && <div className="tt-room">{cell.roomName}</div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
