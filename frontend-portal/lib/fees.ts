// Naming an invoice in a way a parent recognises.
//
// The portal's own copy of frontend/lib/fees.ts — the two apps duplicate their
// lib layer deliberately (see api.ts, utils.ts), and a parent is the one person
// who has never seen an invoice number before and has no way to look one up.

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

/** The heads an invoice covers, spelled out in full — never trimmed to "+2 more". */
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
