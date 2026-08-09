import { supabase } from '../../../shared/db/client'

/**
 * PostgREST puts `.in()` lists in the URL, so a large id array becomes a very
 * long query string and the request fails — measured on this project's instance
 * at ~400 ids (see shared/utils/feePayments.ts for the numbers). 150 keeps each
 * URL near 5KB.
 *
 * A billing run over a whole school passes ~1,200 student ids to three separate
 * lookups, so this is not a theoretical limit here.
 */
export const IN_CHUNK = 150

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Run one `.in(column, ids)` select per chunk, concurrently, and concatenate.
 *
 * Errors throw rather than resolving to a partial set. A short read here would
 * silently drop a student's discount or a class's fee structure, and the caller
 * would bill the wrong amount without anything looking wrong.
 */
export async function selectIn<T = any>(
  table: string,
  columns: string,
  column: string,
  ids: string[],
  refine?: (q: any) => any,
): Promise<T[]> {
  if (!ids.length) return []

  const results = await Promise.all(
    chunk(ids).map(async (batch, idx) => {
      let q = supabase.from(table).select(columns).in(column, batch)
      if (refine) q = refine(q)
      const { data, error } = await q
      if (error) {
        throw new Error(`Failed to read ${table} (batch ${idx + 1}): ${error.message}`)
      }
      return (data ?? []) as T[]
    }),
  )

  return results.flat()
}

/**
 * Insert rows in chunks with bounded concurrency.
 *
 * A school-wide billing run inserts over a thousand invoices; one statement is
 * too large for the same URL/body reasons above, and one-at-a-time takes long
 * enough that the caller's proxy times out — the exact failure the late-fine
 * sweep was rewritten to avoid.
 */
export async function insertChunked<T = any>(
  table: string,
  rows: any[],
  columns = '*',
  concurrency = 4,
): Promise<T[]> {
  if (!rows.length) return []

  const batches = chunk(rows, 100)
  const out: T[][] = new Array(batches.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (cursor < batches.length) {
        const i = cursor++
        const { data, error } = await supabase.from(table).insert(batches[i]).select(columns)
        if (error) throw new Error(`Failed to insert into ${table} (batch ${i + 1}): ${error.message}`)
        out[i] = (data ?? []) as T[]
      }
    }),
  )

  return out.flat()
}
