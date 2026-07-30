import { supabase } from '../db/client'

/**
 * PostgREST sends `.in()` lists as a URL query string, so a large ID array
 * becomes a very long URL and the request fails. Measured against this
 * project's Supabase instance:
 *
 *     100 ids   ~3.6KB    ok
 *     300 ids  ~10.8KB    ok
 *     400 ids  ~14.5KB    FAIL  (hung 9.5s, then `TypeError: fetch failed`)
 *     695 ids  ~25.1KB    FAIL  (`Bad Request`)
 *
 * 150 keeps each URL near 5KB, comfortably inside the working range, and the
 * extra round-trips cost far less than the 9.5s stall a too-large batch causes.
 */
const CHUNK = 150

/**
 * Sum payments per invoice, returned as `invoice_id -> total paid`.
 *
 * Every caller needs this to compute what is actually still owed:
 * `fee_invoices.total_amount` is the ORIGINAL bill, not the remaining balance.
 *
 * Two things this fixes over the inline version it replaces, both of which
 * caused the endpoint to over-report what a family owes:
 *
 *  1. The old code did `const { data: payments } = await supabase...` and never
 *     looked at `error`. Past ~300 invoices the query failed, `payments` came
 *     back undefined, the paid-per-invoice map stayed empty, and every invoice
 *     reported `amount_due === total_amount`. A parent who had paid 80% of
 *     their fees was shown the full amount as outstanding, and the carry-forward
 *     job would have written that inflated figure into next year's invoices.
 *     This throws instead, so the route 500s loudly rather than quietly lying
 *     about money.
 *
 *  2. Chunking keeps it working as a school's invoice count grows, instead of
 *     breaking silently the month it crosses the threshold.
 */
export async function fetchPaidByInvoice(invoiceIds: string[]): Promise<Map<string, number>> {
  const paidByInvoice = new Map<string, number>()
  if (!invoiceIds.length) return paidByInvoice

  const batches: string[][] = []
  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    batches.push(invoiceIds.slice(i, i + CHUNK))
  }

  // In parallel, not sequentially. Supabase is remote here (~245ms round-trip
  // measured), so 5 serial batches cost ~1.2s of pure waiting while 5 concurrent
  // ones cost roughly one round-trip. The batches are independent reads, so
  // there is no ordering requirement between them.
  const results = await Promise.all(
    batches.map(async (batch, idx) => {
      const { data, error } = await supabase
        .from('fee_payments')
        .select('invoice_id, amount_paid')
        .in('invoice_id', batch)

      // Loud, not silent: a partial result here understates payments, which
      // overstates dues. Telling a family they owe more than they do is worse
      // than returning an error.
      if (error) {
        throw new Error(
          `Failed to load payments for ${batch.length} invoices ` +
            `(batch ${idx + 1} of ${batches.length}): ${error.message}`,
        )
      }
      return data ?? []
    }),
  )

  for (const rows of results) {
    for (const p of rows) {
      paidByInvoice.set(
        p.invoice_id,
        (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_paid),
      )
    }
  }

  return paidByInvoice
}

/** Remaining balance on an invoice: the original bill minus everything paid. */
export function amountDue(
  invoice: { id: string; total_amount: number | string },
  paidByInvoice: Map<string, number>,
): number {
  return Number(invoice.total_amount) - (paidByInvoice.get(invoice.id) ?? 0)
}
