import { formatCurrency } from '@/lib/utils'

// The printed receipt.
//
// A school gives the parent a piece of paper. This builds it as a self-contained
// document and opens it in a print window — no dependency on the app's stylesheet,
// because a print view that inherits the dashboard's CSS comes out looking like a
// screenshot of a web page rather than a receipt.
//
// Three things on here are not decoration:
//
//   * Amount in words — what makes the figure hard to alter after the fact.
//   * A part-payment banner, printed only when the payment did not clear the
//     invoice. A receipt that looks like a full settlement when it isn't is the
//     single most common fee dispute.
//   * "Balance due now" separated from "not yet due". Telling a family they owe
//     the whole year's fee this afternoon is both wrong and alarming.

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const rs = (n: unknown) => formatCurrency(Number(n ?? 0))

export function buildReceiptHtml(r: any): string {
  const issued = new Date(r.issued_at)
  const date = issued.toLocaleDateString('en-GB').replace(/\//g, '-')
  const time = issued.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const cancelled = r.status === 'cancelled'
  const refunded = Number(r.refunded_amount ?? 0) > 0

  // Each line says WHAT was paid for, then the filing detail underneath in
  // smaller type — invoice number, period, due date, and what is still owed on
  // it. The number alone was the whole description before, which told a parent
  // nothing.
  const todayISO = new Date().toISOString().slice(0, 10)
  const fmtDate = (d?: string | null) =>
    d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) : null

  const rows = (r.lines ?? [])
    .map((l: any) => {
      const detail = [
        l.invoice_number ? `Invoice ${esc(l.invoice_number)}` : null,
        l.period ? esc(l.period) : null,
        fmtDate(l.due_date) ? `due ${fmtDate(l.due_date)}` : null,
      ].filter(Boolean).join(' &middot; ')

      // "unpaid", not "still due". The summary below distinguishes what is
      // payable TODAY from what falls due later, and a line saying "still due"
      // beside "Balance due now: ₹0" reads as the document contradicting itself.
      const future = l.due_date ? String(l.due_date).slice(0, 10) > todayISO : false
      const owed = Number(l.still_due ?? 0) > 0
        ? `<div class="${future ? 'later' : 'sub'}">${rs(l.still_due)} unpaid` +
          (future && fmtDate(l.due_date) ? ` &mdash; payable by ${fmtDate(l.due_date)}` : ' &mdash; payable now') +
          `</div>`
        : (l.invoice_total ? `<div class="paidfull">Paid in full</div>` : '')

      // Why the bill was reduced, if it was. A parent can see a lower figure and
      // not know whether it is a concession they were promised or an error.
      const conc = (l.concessions ?? []).length
        ? `<div class="conc">Concession applied: ${(l.concessions as string[]).map(esc).join(', ')}</div>`
        : ''

      return `<tr><td>${l.seq}</td><td><b>${esc(l.description)}</b>` +
             (detail ? `<div class="meta2">${detail}</div>` : '') +
             `${conc}${owed}</td><td class="r">${rs(l.amount)}</td></tr>`
    })
    .join('')

  const s = r.summary ?? {}

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.receipt_number)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#111;padding:28px;max-width:540px;margin:auto}
  .hd{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
  .hd h1{font-size:20px;margin:0 0 2px}
  .hd .a{font-size:12px;color:#444}
  .stamp{border:2px solid #b91c1c;color:#b91c1c;text-align:center;font-weight:800;
         letter-spacing:.2em;padding:6px;margin-bottom:12px;font-size:16px}
  .meta{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px;margin-bottom:14px}
  .meta .k{color:#555}
  .meta .v{font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}
  th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}
  th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  td.r,th.r{text-align:right}
  tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:none;font-size:14px}
  .words{font-size:12px;font-style:italic;margin:8px 0 14px}
  .meta2{font-size:11px;color:#555;margin-top:2px}
  .sub{font-size:11px;color:#b45309;margin-top:2px}
  .paidfull{font-size:11px;color:#15803d;margin-top:2px}
  .conc{font-size:11px;color:#15803d;margin-top:2px}
  .later{font-size:11px;color:#555;margin-top:2px}
  .banner{background:#fffbeb;border:1px solid #f59e0b;color:#92400e;font-size:12px;
          padding:7px 9px;border-radius:4px;margin:10px 0;line-height:1.45}
  .sum{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
  .sum td{border:none;padding:3px 0}
  .sum td.r{text-align:right;font-weight:600}
  .sum tr.hi td{border-top:1px solid #ddd;padding-top:6px;font-weight:800;color:#b45309;font-size:13px}
  .foot{display:flex;justify-content:space-between;font-size:12px;margin-top:12px}
  .note{text-align:center;font-size:11px;color:#666;margin-top:22px;
        border-top:1px dashed #bbb;padding-top:8px}
  @media print{body{padding:0} .noprint{display:none}}
</style></head><body>
${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
<div class="hd">
  <h1>${esc(r.school?.name)}</h1>
  <div class="a">${esc(r.school?.address)}${r.school?.phone ? ` &nbsp;Ph: ${esc(r.school.phone)}` : ''}</div>
</div>

<div class="meta">
  <span class="k">Receipt No.</span><span class="v">${esc(r.receipt_number)}</span>
  <span class="k">Date</span><span class="v">${date} ${time}</span>
  ${r.invoice?.session ? `<span class="k">Session</span><span class="v">${esc(r.invoice.session)}</span>` : ''}
  <span class="k">Student</span><span class="v">${esc(r.student?.name)}</span>
  ${r.student?.father_name ? `<span class="k">Father's Name</span><span class="v">${esc(r.student.father_name)}</span>` : ''}
  <span class="k">Class</span><span class="v">${esc(r.student?.class_section ?? '—')}</span>
  <span class="k">Admission No.</span><span class="v">${esc(r.student?.admission_number ?? '—')}</span>
  ${(r.lines ?? []).length === 1 && r.invoice?.invoice_number
      ? `<span class="k">Against Invoice</span><span class="v">${esc(r.invoice.invoice_number)}</span>`
      : (r.lines ?? []).length > 1
        ? `<span class="k">Settles</span><span class="v">${(r.lines ?? []).length} invoices</span>`
        : ''}
</div>

${r.partial ? `<div class="banner"><b>This is a PART PAYMENT.</b> The amount below is what was
   paid today — it does not clear the full fee. ${rs(r.invoice?.outstanding_after)} remains unpaid;
   see each line for when it becomes payable.</div>` : ''}
${refunded ? `<div class="banner"><b>${rs(r.refunded_amount)} of this payment has been refunded.</b>
   The net amount retained is ${rs(r.effective_amount)}.</div>` : ''}

<table>
  <thead><tr><th style="width:38px">Sr.</th><th>Description</th><th class="r">Amount</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:#888">No line items</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2" class="r">Amount Paid</td><td class="r">${rs(r.amount)}</td></tr></tfoot>
</table>

<div class="words">${esc(r.amount_in_words)}</div>

<table class="sum">
  <tr><td>Total billed to date</td><td class="r">${rs(s.total_billed)}</td></tr>
  <tr><td>Paid so far (including this payment)</td><td class="r">${rs(s.paid_to_date)}</td></tr>
  <tr class="hi"><td>Payable today</td><td class="r">${rs(s.balance_due_now)}</td></tr>
  ${Number(s.not_yet_due ?? 0) > 0
    ? `<tr><td style="color:#666">Falls due later</td>
         <td class="r" style="color:#666">${rs(s.not_yet_due)}</td></tr>`
    : ''}
</table>
<div style="font-size:11px;color:#666;margin-top:4px">
  ${Number(s.balance_due_now ?? 0) <= 0 && Number(s.not_yet_due ?? 0) > 0
    ? `Nothing is payable today. ${rs(s.not_yet_due)} remains unpaid and becomes payable on the due dates shown above.`
    : `&ldquo;Payable today&rdquo; is what is owed as of ${fmtDate(todayISO)}. Anything falling due later is listed separately.`}
</div>

<div class="foot">
  <span>Mode: <b style="text-transform:capitalize">${esc(r.method)}</b>${r.reference ? ` · ${esc(r.reference)}` : ''}</span>
  <span>${r.collected_by ? `Collected by: ${esc(r.collected_by)}` : ''}</span>
</div>

<div class="note">This is a computer-generated receipt.${cancelled ? ' THIS RECEIPT HAS BEEN CANCELLED AND IS NOT VALID.' : ''}</div>
</body></html>`
}

/**
 * Open the receipt in its own window and trigger the print dialog.
 *
 * Waits for load before printing — Safari and Firefox will otherwise print an
 * empty document because the window has no content yet.
 */
export function printReceipt(receipt: any): boolean {
  const win = window.open('', '_blank', 'width=620,height=800')
  if (!win) return false // popup blocked; caller tells the user

  win.document.write(buildReceiptHtml(receipt))
  win.document.close()
  win.addEventListener('load', () => {
    win.focus()
    win.print()
  })
  // Already-complete documents never fire load in some browsers.
  if (win.document.readyState === 'complete') {
    win.focus()
    win.print()
  }
  return true
}
