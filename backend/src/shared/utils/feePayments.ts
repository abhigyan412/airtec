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
 * How much has been paid against each invoice, as `invoice_id -> total paid`.
 *
 * WAS BROKEN. This selected `fee_payments.invoice_id`, a column the fee model
 * rewrite removed: a payment no longer belongs to one invoice, it has allocation
 * rows saying which invoices it settled and for how much. Every caller therefore
 * threw — the nightly fee-reminder sweep and both homeroom dues endpoints have
 * been failing outright since that migration landed, which is why no family had
 * received a due or overdue reminder since.
 *
 * The fix is not to re-sum the allocations. `fee_invoices.amount_paid` is now a
 * maintained column, kept in step with the allocation rows by trigger, and it is
 * what every other read in the fee module already trusts — the invoice list, the
 * student summary, recovery. Summing a second time from a different table is how
 * two numbers for one fact start to disagree.
 *
 * Kept as a helper with its original signature so the three call sites are fixed
 * without touching them. A caller that ALREADY has the invoice row does not need
 * this at all — read `amount_paid` off it directly.
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
        .from('fee_invoices')
        .select('id, amount_paid')
        .in('id', batch)

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
    for (const inv of rows) {
      paidByInvoice.set(inv.id, Number(inv.amount_paid ?? 0))
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
