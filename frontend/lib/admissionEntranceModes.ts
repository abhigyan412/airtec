// Shared between the Slots page (New/Edit Slot form shows the selected
// class's configured mode as an informational hint) and the Admission
// Settings page (the actual per-class Entrance Mode & Admission Fee
// editor) — extracted 2026-08-26 when that editor moved from Slots to
// Settings, same "one vocabulary, not two copies" reasoning as
// admissionDocumentTypes.ts.
export const ADMISSION_ENTRANCE_MODES = [
  { value: 'interview', label: 'Interview' },
  { value: 'written_mcq', label: 'Written — MCQ' },
  { value: 'written_subjective', label: 'Written — Subjective' },
  { value: 'observation', label: 'Observation' },
  { value: 'previous_academic_percentage', label: 'Previous Academic Percentage' },
] as const

export function admissionEntranceModeLabel(v: string): string {
  return ADMISSION_ENTRANCE_MODES.find(m => m.value === v)?.label ?? v
}
