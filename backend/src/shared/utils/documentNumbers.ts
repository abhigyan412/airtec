import { supabase } from '../db/client'

// ── Generated document numbers ──────────────────────────────────────
//
// Every one of these used to be built as
//   PREFIX + year + (count(*) of the school's rows + 1)
// which breaks whenever numbering isn't perfectly dense — after a
// deletion, against imported or seeded history, or when two users create
// the same kind of record at the same moment and both read the same
// count. On the columns with a UNIQUE constraint (invoice, receipt,
// admission, TC, certificate numbers) that surfaces to the user as
// "duplicate key value violates unique constraint".
//
// next_document_number() increments a counter row in a single statement,
// so concurrent callers serialise and each gets a distinct number.

export type DocumentPrefix = 'INV' | 'RCP' | 'ADM' | 'TC' | 'CERT' | 'INQ' | 'APP' | 'JA' | 'CAND'

/**
 * Pad widths differ per prefix and are deliberately preserved: changing
 * them would break visual continuity with numbers already issued.
 */
const PAD: Record<DocumentPrefix, number> = {
  INV: 5, RCP: 5, ADM: 4, TC: 4, CERT: 4, INQ: 4, APP: 4, JA: 4, CAND: 4,
}

export async function nextDocumentNumber(schoolId: string, prefix: DocumentPrefix): Promise<string> {
  const year = new Date().getFullYear()
  const { data, error } = await supabase.rpc('next_document_number', {
    p_school_id: schoolId, p_year: year, p_prefix: prefix, p_pad: PAD[prefix],
  })
  if (error || !data) {
    throw new Error(`Could not generate a ${prefix} number: ${error?.message ?? 'no value returned'}`)
  }
  return data as string
}
