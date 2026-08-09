// Naming an invoice in a way a parent recognises.
//
// A row that says only "INV202600101" is a filing reference, not a description —
// at a counter the question is always "what is this ₹5,000 for", and the answer
// is the period and the heads it covers. Both live on the invoice already
// (period_key, line_items); this turns them into words.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "quarterly:Q2" -> "Quarter 2"; "monthly:2026-07" -> "Jul 2026". */
export function periodLabel(key?: string | null): string | null {
  if (!key) return null
  const [freq, token] = String(key).split(':')
  if (!token) return null
  if (freq === 'monthly') {
    const [y, m] = token.split('-').map(Number)
    return m ? `${MONTHS[m - 1]} ${y}` : token
  }
  if (freq === 'annually' || freq === 'one_time') return 'Full year'
  const n = token.replace(/^[A-Za-z]+/, '')
  return freq === 'quarterly' ? `Quarter ${n}` : freq === 'half_yearly' ? `Half ${n}` : token
}

/**
 * The heads an invoice covers, spelled out in full.
 *
 * Never truncated to "+2 more": the two hidden ones are exactly the lines a
 * family queries — transport they stopped taking, a lab fee they don't
 * recognise — and a receipt that won't name them is a receipt that can't
 * answer the question.
 */
export function invoiceHeads(lineItems: any): string | null {
  const names = (Array.isArray(lineItems) ? lineItems : [])
    .map((l: any) => l?.name)
    .filter(Boolean)
  return names.length ? names.join(', ') : null
}

/** What this invoice IS, in one phrase: "Quarter 2 fees", falling back to the number. */
export function invoiceTitle(inv: any): string {
  const period = periodLabel(inv?.period_key)
  return period ? `${period} fees` : (inv?.invoice_number ?? 'School fee')
}
