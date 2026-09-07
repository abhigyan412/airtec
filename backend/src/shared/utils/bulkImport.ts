import { z } from 'zod'

export interface BulkImportResult { inserted: number; errors: { row: number; error: string }[] }

/**
 * Validates and inserts CSV-parsed rows one at a time, collecting a
 * per-row outcome instead of failing the whole batch on the first bad
 * row (a typo in row 40 of 200 must not block the other 199) or
 * silently dropping rows that fail (every skip is reported by its
 * spreadsheet row number — index 0 is row 2, since row 1 is the
 * header).
 *
 * Sequential, not a single bulk `.insert(array)`: a DB-level failure
 * (duplicate registration number, invalid foreign key) fails an entire
 * batch insert in Postgres, which would either lose every valid row's
 * error detail or force an all-or-nothing outcome. Import sizes here
 * are tens to hundreds of rows, not thousands, so the sequential cost
 * is worth the precise feedback.
 */
export async function bulkImport<Row, Insert>(
  rawRows: unknown[],
  schema: z.ZodType<Row>,
  toInsert: (row: Row) => Promise<Insert | { error: string }>,
  insertOne: (row: Insert) => Promise<{ error?: string }>,
): Promise<BulkImportResult> {
  const errors: { row: number; error: string }[] = []
  let inserted = 0

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2
    const parsed = schema.safeParse(rawRows[i])
    if (!parsed.success) {
      errors.push({ row: rowNumber, error: parsed.error.errors[0]?.message ?? 'Invalid row' })
      continue
    }

    const resolved = await toInsert(parsed.data)
    if ('error' in resolved) {
      errors.push({ row: rowNumber, error: resolved.error })
      continue
    }

    const { error } = await insertOne(resolved)
    if (error) {
      errors.push({ row: rowNumber, error })
      continue
    }
    inserted++
  }

  return { inserted, errors }
}
