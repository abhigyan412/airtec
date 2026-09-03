'use client'
import { formatDate } from '@/lib/utils'
import { buildDatesheetRows, type DatesheetChip } from './DatesheetGrid'

// The printable artefact for the Datesheet Viewer — mirrors
// Timetable Block View's PrintSheets.tsx exactly: hidden on screen, shown
// only to the printer, plain black-on-white and ruled rather than tinted
// (tinted cells cost a fortune in toner and come out as indistinguishable
// greys on an office laser printer). Reuses buildDatesheetRows so the
// printed table can never disagree with the on-screen DatesheetGrid about
// which subjects land in which row or column.

export function DatesheetPrintSheet({ examSubjects, examName }: { examSubjects: any[]; examName?: string }) {
  const { scheduleDates, scheduleRows } = buildDatesheetRows(examSubjects)

  return (
    <div className="hidden print:block">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body { background: #fff !important; }
          .ds-table { width: 100%; border-collapse: collapse; }
          .ds-table th, .ds-table td {
            border: 1px solid #999; padding: 4px 6px; vertical-align: top;
            font-size: 10pt; color: #000;
          }
          .ds-table th { background: #eee !important; -webkit-print-color-adjust: exact; }
          .ds-sub { font-weight: 600; }
          .ds-suffix { font-size: 8.5pt; color: #333; }
        }
      `}</style>

      <section>
        <header style={{ marginBottom: '6mm' }}>
          <h1 style={{ fontSize: '16pt', fontWeight: 700, color: '#000' }}>{examName ?? 'Datesheet'}</h1>
          <p style={{ fontSize: '9pt', color: '#444' }}>Exam Schedule</p>
        </header>

        <table className="ds-table">
          <thead>
            <tr>
              <th style={{ width: '32mm' }}>Class</th>
              {scheduleDates.map((date: string) => <th key={date}>{formatDate(date)}</th>)}
              <th>Not Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {scheduleRows.map((row) => (
              <tr key={row.key}>
                <td className="ds-sub">{row.label}</td>
                {scheduleDates.map((date: string) => {
                  const chips = row.byDate.get(date) ?? []
                  if (!chips.length) return <td key={date} />
                  return (
                    <td key={date}>
                      {chips.map((chip: DatesheetChip) => (
                        <div key={`${chip.subject.id}-${chip.suffix ?? ''}`}>
                          <div className="ds-sub">{chip.subject.subject_name}</div>
                          {chip.suffix && <div className="ds-suffix">{chip.suffix}</div>}
                        </div>
                      ))}
                    </td>
                  )
                })}
                <td>
                  {(row.byDate.get('') ?? []).map((chip: DatesheetChip) => (
                    <div key={`${chip.subject.id}-${chip.suffix ?? ''}`}>
                      <div className="ds-sub">{chip.subject.subject_name}</div>
                      {chip.suffix && <div className="ds-suffix">{chip.suffix}</div>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
