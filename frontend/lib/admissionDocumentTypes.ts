// Single source for the document-type vocabulary used across the admission
// module — the per-class checklist config (document-requirements/page.tsx),
// the staff upload modal on an application (applications/[id]/page.tsx),
// and the public parent-facing status page (apply/[schoolId]/status/...)
// all need to agree on the same values and labels, since a class's
// configured checklist has to be selectable wherever a document actually
// gets uploaded. Previously duplicated three times by hand (and had
// already drifted once — the two authenticated copies matched, but this
// consolidation is what surfaced that they were separate literals in the
// first place). Expanded 2026-08-25 from the original 7 to cover the
// documents Indian K-12 admissions commonly ask for, including the ones
// this codebase's own RTE/quota concepts (see admission/decisions.md)
// actually need proof of.
export const ADMISSION_DOC_TYPES = [
  { value: 'birth_certificate', label: 'Birth Certificate' },
  { value: 'transfer_certificate', label: 'Transfer Certificate' },
  { value: 'migration_certificate', label: 'Migration Certificate' },
  { value: 'marksheet', label: 'Previous Marksheet / Report Card' },
  { value: 'character_certificate', label: 'Character Certificate' },
  { value: 'medical_certificate', label: 'Medical / Immunization Certificate' },
  { value: 'aadhaar', label: 'Aadhaar Card (Student)' },
  { value: 'parent_aadhaar', label: 'Aadhaar Card (Parent/Guardian)' },
  { value: 'caste_certificate', label: 'Caste Certificate' },
  { value: 'income_certificate', label: 'Income Certificate' },
  { value: 'domicile_certificate', label: 'Domicile / Residence Certificate' },
  { value: 'disability_certificate', label: 'Disability Certificate (CWSN)' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'photo_id', label: 'Photo ID' },
  { value: 'other', label: 'Other' },
] as const

export const ADMISSION_DOC_LABELS: Record<string, string> = Object.fromEntries(
  ADMISSION_DOC_TYPES.map(t => [t.value, t.label]),
)
