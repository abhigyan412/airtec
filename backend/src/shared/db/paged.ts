import { supabase } from './client'

/**
 * How many rows one PostgREST response is allowed to carry.
 *
 * This is the single most consequential number in the module, because exceeding
 * it is NOT an error. PostgREST caps the response and returns 200. The rows
 * simply are not there, and every figure computed from them arrives short with
 * nothing to indicate it.
 *
 * Measured on this database: 1,760 non-cancelled invoices against a 1,000-row
 * cap meant /fees/stats reported ₹99.3 lakh billed where the truth was ₹1.83
 * crore — a 46% understatement, on screen, today. The threshold is roughly 250
 * students on quarterly billing.
 */
export const PAGE_SIZE = 1000

/**
 * The point at which "this is a big school" becomes "something is wrong with
 * this query". Reaching it throws rather than paging on forever.
 *
 * A ceiling is not a nuisance — it is the difference between a report that is
 * late and a report that is quietly wrong. 200,000 invoice rows is roughly a
 * 12,000-student school over four years; anything past it wants a database
 * aggregate, not a full scan pulled into Node.
 */
export const ROW_CEILING = 200_000

/**
 * Read EVERY row a query matches, in pages, or refuse.
 *
 * The module contained exactly one correct version of this — the slice loop in
 * recovery.ts, written for /defaulters — and roughly fifteen places that assumed
 * the cap did not exist. This is that loop, generalised, with the two flaws the
 * original had removed:
 *
 *   * It terminated on `batch.length < PAGE`, which requires the page size to
 *     exactly equal the server's cap. Lower PostgREST's max-rows to 500 and the
 *     loop stopped after one batch and silently halved the defaulters list. This
 *     version advances by however many rows actually came back and stops when it
 *     has the count the database reported, so a smaller server cap costs round
 *     trips instead of correctness.
 *
 *   * It had no upper bound at all.
 *
 * `build` receives the query so callers apply their own filters; ordering is
 * forced to a unique, stable column because paging without one can repeat and
 * skip rows between requests.
 */
export async function selectAll<T = any>(
  table: string,
  columns: string,
  build: (q: any) => any = q => q,
  opts: { orderBy?: string; pageSize?: number; ceiling?: number } = {},
): Promise<T[]> {
  const orderBy = opts.orderBy ?? 'id'
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const ceiling = opts.ceiling ?? ROW_CEILING

  const rows: T[] = []
  let offset = 0
  let total: number | null = null

  for (;;) {
    // The exact count is asked for once. It is what makes the ceiling check and
    // the termination condition honest rather than inferred from batch sizes.
    const wantCount = total === null
    let q = build(supabase.from(table).select(columns, wantCount ? { count: 'exact' } : undefined))
    q = q.order(orderBy, { ascending: true }).range(offset, offset + pageSize - 1)

    const { data, error, count } = await q
    if (error) throw new Error(`Failed to read ${table} (rows ${offset}+): ${error.message}`)

    if (wantCount) {
      total = count ?? 0
      if (total > ceiling) {
        throw new Error(
          `Refusing to read ${total} rows from ${table} — the ceiling is ${ceiling}. ` +
          `This query needs a database aggregate rather than a full scan.`,
        )
      }
    }

    const batch = (data ?? []) as T[]
    rows.push(...batch)

    // No progress means the server will not give us any more, whatever the count
    // said. Breaking here is what stops a misreported count spinning forever.
    if (batch.length === 0) break
    offset += batch.length
    if (rows.length >= (total ?? 0)) break
  }

  return rows
}
