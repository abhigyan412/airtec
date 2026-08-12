import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { supabase } from '../../db/client'
import { postInvoice } from '../../../modules/fee/lib/ledger'

// Money movement, against the real database, on purpose.
//
// Every defect this file pins was invisible to a mock:
//
//   * the overpayment guard aggregated BEFORE it took the row lock, so two
//     cashiers taking the same fee both passed it;
//   * a re-delivered webhook produced a second receipt for one charge;
//   * the bounce path deleted allocations and updated status as two separate
//     writes, with no error check between them;
//   * carry-forward could strand invoices as unpaid while their arrears
//     existed, and no re-run could repair it.
//
// All four now live inside Postgres functions, and the only honest way to test a
// transaction boundary is to cross it.
//
// The fixture school is disposable and torn down in reverse dependency order.
// Note fee_invoices.student_id and fee_payments.student_id are ON DELETE
// RESTRICT now — deliberately, so a student's financial history cannot be
// deleted with them — which is why teardown removes the money rows first.

const sb = supabase as any
const stamp = Date.now()

let schoolId: string
let yearId: string
let nextYearId: string
let studentId: string
let invoiceSeq = 0

/** An unpaid invoice for the fixture student. */
async function makeInvoice(total: number, dueDate = '2020-01-01', yearOverride?: string) {
  const { data, error } = await sb.from('fee_invoices').insert({
    school_id: schoolId,
    student_id: studentId,
    academic_year_id: yearOverride ?? yearId,
    invoice_number: `__VT${stamp}_${++invoiceSeq}`,
    invoice_date: dueDate,
    due_date: dueDate,
    line_items: [],
    subtotal: total,
    discount_total: 0,
    late_fee: 0,
    total_amount: total,
    status: 'unpaid',
  }).select().single()
  if (error) throw new Error(`fixture invoice: ${error.message}`)

  // Post the receivable, exactly as billing.ts and adhoc.ts do when they raise
  // one. A fixture that skips this is not modelling the product — and the
  // reconciliation assertions below would be checking a state the app never
  // produces.
  await postInvoice({
    schoolId, invoiceId: data.id, studentId, netAmount: total,
    memo: `Invoice ${data.invoice_number}`,
  })
  return data
}

const collect = (args: Record<string, any>) =>
  sb.rpc('fee_collect_payment', {
    p_school_id: schoolId, p_student_id: studentId, p_method: 'cash', ...args,
  })

async function invoiceRow(id: string) {
  const { data } = await sb.from('fee_invoices')
    .select('amount_paid, status, total_amount').eq('id', id).single()
  return data
}

async function ledgerImbalance() {
  const { data } = await sb.from('fee_ledger_entries').select('debit, credit').eq('school_id', schoolId)
  const dr = (data ?? []).reduce((s: number, e: any) => s + Number(e.debit), 0)
  const cr = (data ?? []).reduce((s: number, e: any) => s + Number(e.credit), 0)
  return Math.round((dr - cr) * 100) / 100
}

beforeAll(async () => {
  const { data: school, error: sErr } = await sb.from('schools')
    .insert({ name: `__vitest_money_${stamp}` }).select().single()
  if (sErr) throw new Error(`fixture school: ${sErr.message}`)
  schoolId = school.id

  const years = await sb.from('academic_years').insert([
    { school_id: schoolId, name: `__vt${stamp}-A`, start_date: '2025-04-01', end_date: '2026-03-31' },
    { school_id: schoolId, name: `__vt${stamp}-B`, start_date: '2026-04-01', end_date: '2027-03-31' },
  ]).select()
  if (years.error) throw new Error(`fixture years: ${years.error.message}`)
  yearId = years.data[0].id
  nextYearId = years.data[1].id

  const { data: student, error: stErr } = await sb.from('students')
    .insert({ school_id: schoolId, first_name: '__vitest', last_name: 'Money' }).select().single()
  if (stErr) throw new Error(`fixture student: ${stErr.message}`)
  studentId = student.id
})

afterAll(async () => {
  // Children first: allocations and ledger rows, then payments, then arrears,
  // then invoices, then the student, then the years, then the school.
  const { data: payments } = await sb.from('fee_payments').select('id').eq('school_id', schoolId)
  for (const p of payments ?? []) {
    await sb.from('fee_payment_allocations').delete().eq('payment_id', p.id)
  }
  // fee_ledger_entries refuses DELETE by trigger (it is append-only), so the
  // school row is what carries them away via ON DELETE CASCADE.
  await sb.from('fee_payments').delete().eq('school_id', schoolId)
  await sb.from('fee_arrears').delete().eq('school_id', schoolId)
  await sb.from('fee_invoices').delete().eq('school_id', schoolId)
  await sb.from('students').delete().eq('id', studentId)
  await sb.from('document_counters').delete().eq('school_id', schoolId)
  await sb.from('academic_years').delete().eq('school_id', schoolId)
  await sb.from('schools').delete().eq('id', schoolId)
})

beforeEach(async () => {
  const { data: payments } = await sb.from('fee_payments').select('id').eq('school_id', schoolId)
  for (const p of payments ?? []) {
    await sb.from('fee_payment_allocations').delete().eq('payment_id', p.id)
  }
  await sb.from('fee_payments').delete().eq('school_id', schoolId)
  await sb.from('fee_arrears').delete().eq('school_id', schoolId)
  await sb.from('fee_invoices').delete().eq('school_id', schoolId)
})

describe('fee_collect_payment', () => {
  it('issues one receipt for a payment that settles three invoices', async () => {
    // The shape the whole allocation model exists for. Under the old model this
    // produced three payment rows and three receipt numbers for one handover.
    const a = await makeInvoice(1000, '2020-01-01')
    const b = await makeInvoice(2000, '2020-02-01')
    const c = await makeInvoice(200, '2020-03-01')

    const { data, error } = await collect({ p_amount: 3200 })
    expect(error).toBeNull()
    expect(data.settled_invoices).toHaveLength(3)
    expect(Number(data.amount)).toBe(3200)
    expect(Number(data.advance)).toBe(0)

    for (const inv of [a, b, c]) {
      expect(Number((await invoiceRow(inv.id))!.amount_paid)).toBe(Number(inv.total_amount))
      expect((await invoiceRow(inv.id))!.status).toBe('paid')
    }
  })

  it('allocates oldest first, so the debt accruing fines clears first', async () => {
    const older = await makeInvoice(1000, '2020-01-01')
    await makeInvoice(1000, '2021-01-01')

    const { data } = await collect({ p_amount: 600 })
    expect(data.settled_invoices).toHaveLength(1)
    expect(data.settled_invoices[0].invoice_id).toBe(older.id)
    expect(Number((await invoiceRow(older.id))!.amount_paid)).toBe(600)
  })

  it('holds the excess as advance rather than turning a family away', async () => {
    await makeInvoice(500)
    const { data } = await collect({ p_amount: 800 })
    expect(Number(data.advance)).toBe(300)
  })

  it('refuses an overpayment when advance is not allowed', async () => {
    await makeInvoice(500)
    const { error } = await collect({ p_amount: 800, p_allow_advance: false })
    expect(error?.message).toMatch(/more than the/)
  })

  it('refuses to take a second payment once the invoice is settled', async () => {
    // The lock-ordering defect in one assertion. The guard used to aggregate
    // before taking the row lock, so a second full payment read a stale balance
    // and was accepted — ₹5,000 receipted into no invoice and no advance.
    const inv = await makeInvoice(5000)
    await collect({ p_amount: 5000, p_invoice_ids: [inv.id], p_allow_advance: false })
    const { error } = await collect({ p_amount: 5000, p_invoice_ids: [inv.id], p_allow_advance: false })
    expect(error?.message).toMatch(/more than the 0/)
    expect(Number((await invoiceRow(inv.id))!.amount_paid)).toBe(5000)
  })

  it('never writes a payment when it refuses', async () => {
    await makeInvoice(500)
    await collect({ p_amount: 800, p_allow_advance: false })
    const { count } = await sb.from('fee_payments')
      .select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
    expect(count).toBe(0)
  })

  it('rejects a zero or negative amount', async () => {
    await makeInvoice(500)
    expect((await collect({ p_amount: 0 })).error?.message).toMatch(/more than zero/)
    expect((await collect({ p_amount: -100 })).error?.message).toMatch(/more than zero/)
  })

  it('replays an idempotency key instead of taking the money twice', async () => {
    // A cashier double-clicking on a slow connection.
    await makeInvoice(1000)
    const first = await collect({ p_amount: 400, p_idempotency_key: `k-${stamp}` })
    const second = await collect({ p_amount: 400, p_idempotency_key: `k-${stamp}` })

    expect(first.data.replayed).toBe(false)
    expect(second.data.replayed).toBe(true)
    expect(second.data.receipt_number).toBe(first.data.receipt_number)

    const { count } = await sb.from('fee_payments')
      .select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
    expect(count).toBe(1)
  })

  it('settles only the invoices it was pointed at', async () => {
    const target = await makeInvoice(1000, '2021-01-01')
    const other = await makeInvoice(1000, '2020-01-01')  // older, would win by default

    await collect({ p_amount: 1000, p_invoice_ids: [target.id] })
    expect(Number((await invoiceRow(target.id))!.amount_paid)).toBe(1000)
    expect(Number((await invoiceRow(other.id))!.amount_paid)).toBe(0)
  })

  it('posts a balanced ledger pair for every payment', async () => {
    await makeInvoice(1000)
    await collect({ p_amount: 1000 })
    expect(await ledgerImbalance()).toBe(0)
  })

  it('credits receivable, not income — the invoice already recognised that', async () => {
    const inv = await makeInvoice(1000)
    await sb.rpc('fee_stats', { p_school_id: schoolId, p_academic_year_id: null })
    await collect({ p_amount: 1000, p_invoice_ids: [inv.id] })

    const { data } = await sb.from('fee_ledger_entries')
      .select('account_code, credit').eq('school_id', schoolId).eq('source_type', 'payment').gt('credit', 0)
    expect(data.map((e: any) => e.account_code)).toContain('receivable')
    expect(data.map((e: any) => e.account_code)).not.toContain('fee_income')
  })
})

describe('fee_bounce_payment', () => {
  it('restores the invoice without erasing what the cheque was meant to settle', async () => {
    const inv = await makeInvoice(2000)
    const { data: paid } = await collect({ p_amount: 2000, p_method: 'cheque', p_invoice_ids: [inv.id] })
    expect(Number((await invoiceRow(inv.id))!.amount_paid)).toBe(2000)

    const { error } = await sb.rpc('fee_bounce_payment', {
      p_payment_id: paid.payment_id, p_school_id: schoolId, p_reason: 'Insufficient funds',
    })
    expect(error).toBeNull()

    const after = await invoiceRow(inv.id)
    expect(Number(after!.amount_paid)).toBe(0)
    expect(after!.status).toBe('unpaid')

    // The allocation survives. A bounce makes it worth nothing; it does not
    // pretend the cheque was never applied.
    const { count } = await sb.from('fee_payment_allocations')
      .select('id', { count: 'exact', head: true }).eq('payment_id', paid.payment_id)
    expect(count).toBe(1)
  })

  it('does not leave a phantom advance credit behind', async () => {
    const inv = await makeInvoice(2000)
    const { data: paid } = await collect({ p_amount: 2000, p_method: 'cheque', p_invoice_ids: [inv.id] })
    await sb.rpc('fee_bounce_payment', { p_payment_id: paid.payment_id, p_school_id: schoolId })

    const { data } = await sb.from('fee_payments')
      .select('unallocated_amount, status').eq('id', paid.payment_id).single()
    expect(Number(data.unallocated_amount)).toBe(0)
    expect(data.status).toBe('bounced')
  })

  it('keeps the ledger balanced through a bounce', async () => {
    const inv = await makeInvoice(2000)
    const { data: paid } = await collect({ p_amount: 2000, p_method: 'cheque', p_invoice_ids: [inv.id] })
    await sb.rpc('fee_bounce_payment', { p_payment_id: paid.payment_id, p_school_id: schoolId })
    expect(await ledgerImbalance()).toBe(0)
  })

  it('refuses to bounce the same payment twice', async () => {
    const inv = await makeInvoice(1000)
    const { data: paid } = await collect({ p_amount: 1000, p_method: 'cheque', p_invoice_ids: [inv.id] })
    await sb.rpc('fee_bounce_payment', { p_payment_id: paid.payment_id, p_school_id: schoolId })
    const { error } = await sb.rpc('fee_bounce_payment', { p_payment_id: paid.payment_id, p_school_id: schoolId })
    expect(error?.message).toMatch(/Already marked bounced/)
  })

  it('will not bounce a payment belonging to another school', async () => {
    const inv = await makeInvoice(1000)
    const { data: paid } = await collect({ p_amount: 1000, p_invoice_ids: [inv.id] })
    const { error } = await sb.rpc('fee_bounce_payment', {
      p_payment_id: paid.payment_id, p_school_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(error?.message).toMatch(/not found/i)
  })
})

describe('fee_carry_forward_arrears', () => {
  it('moves the balance and retires the source invoice in one transaction', async () => {
    const inv = await makeInvoice(3000)
    await collect({ p_amount: 1000, p_invoice_ids: [inv.id] })

    const { data, error } = await sb.rpc('fee_carry_forward_arrears', {
      p_school_id: schoolId, p_from_year: yearId, p_to_year: nextYearId,
    })
    expect(error).toBeNull()
    expect(data.carried_forward).toBe(1)
    expect(Number(data.total_amount)).toBe(2000)
    expect((await invoiceRow(inv.id))!.status).toBe('carried_forward')

    const { data: arrears } = await sb.from('fee_arrears').select('amount').eq('school_id', schoolId)
    expect(Number(arrears[0].amount)).toBe(2000)
  })

  it('is idempotent — a re-run doubles nobody', async () => {
    await makeInvoice(3000)
    const args = { p_school_id: schoolId, p_from_year: yearId, p_to_year: nextYearId }
    await sb.rpc('fee_carry_forward_arrears', args)
    const { data: second } = await sb.rpc('fee_carry_forward_arrears', args)

    expect(second.carried_forward).toBe(0)
    const { count } = await sb.from('fee_arrears')
      .select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
    expect(count).toBe(1)
  })

  it('closes an invoice a previous half-run stranded', async () => {
    // The defect that could not self-heal: arrears existed, the invoice stayed
    // unpaid, and because the old code derived what to close from the INSERT's
    // return value, no retry ever closed it.
    const inv = await makeInvoice(3000)
    const args = { p_school_id: schoolId, p_from_year: yearId, p_to_year: nextYearId }
    await sb.rpc('fee_carry_forward_arrears', args)

    // Recreate the stranded state by hand.
    await sb.from('fee_invoices').update({ status: 'unpaid' }).eq('id', inv.id)
    expect((await invoiceRow(inv.id))!.status).toBe('unpaid')

    const { data } = await sb.rpc('fee_carry_forward_arrears', args)
    expect(data.carried_forward).toBe(0)   // nothing new to insert
    expect(data.invoices_closed).toBe(1)   // but the stranded one is repaired
    expect((await invoiceRow(inv.id))!.status).toBe('carried_forward')
  })

  it('refuses to carry a year into itself', async () => {
    const { error } = await sb.rpc('fee_carry_forward_arrears', {
      p_school_id: schoolId, p_from_year: yearId, p_to_year: yearId,
    })
    expect(error?.message).toMatch(/must be different/)
  })
})

describe('the ledger', () => {
  it('refuses to be edited', async () => {
    await makeInvoice(1000)
    await collect({ p_amount: 1000 })
    const { data: entry } = await sb.from('fee_ledger_entries')
      .select('id').eq('school_id', schoolId).limit(1).single()

    const { error } = await sb.from('fee_ledger_entries').update({ debit: 99999 }).eq('id', entry.id)
    expect(error?.message).toMatch(/append-only/)
  })

  // Its own school, because the ledger is append-only: the shared fixture's
  // beforeEach can delete invoices and payments but CANNOT delete the entries
  // they posted, so receivable there accumulates across tests by design. That is
  // the immutability working, not a fault — reconciliation just has to be
  // measured somewhere nothing has been deleted out from under it.
  it('reconciles against the invoices and the payments', async () => {
    const { data: school } = await sb.from('schools')
      .insert({ name: `__vitest_recon_${Date.now()}` }).select().single()
    const { data: year } = await sb.from('academic_years').insert({
      school_id: school.id, name: '__vt-recon', start_date: '2025-04-01', end_date: '2026-03-31',
    }).select().single()
    const { data: student } = await sb.from('students')
      .insert({ school_id: school.id, first_name: '__vitest', last_name: 'Recon' }).select().single()

    try {
      const { data: inv } = await sb.from('fee_invoices').insert({
        school_id: school.id, student_id: student.id, academic_year_id: year.id,
        invoice_number: `__VTR${Date.now()}`, invoice_date: '2020-01-01', due_date: '2020-01-01',
        line_items: [], subtotal: 4000, discount_total: 0, late_fee: 0,
        total_amount: 4000, status: 'unpaid',
      }).select().single()

      await postInvoice({
        schoolId: school.id, invoiceId: inv.id, studentId: student.id, netAmount: 4000,
      })
      await sb.rpc('fee_collect_payment', {
        p_school_id: school.id, p_student_id: student.id, p_amount: 1500,
        p_method: 'cash', p_invoice_ids: [inv.id],
      })

      const { data } = await sb.rpc('fee_reconciliation', { p_school_id: school.id })
      expect(data.balanced.ok).toBe(true)
      expect(data.receivable_vs_invoices.ok).toBe(true)
      expect(data.cash_vs_payments.ok).toBe(true)
      expect(Number(data.receivable_vs_invoices.invoices)).toBe(2500)
      expect(Number(data.cash_vs_payments.payments)).toBe(1500)
    } finally {
      const { data: pays } = await sb.from('fee_payments').select('id').eq('school_id', school.id)
      for (const p of pays ?? []) await sb.from('fee_payment_allocations').delete().eq('payment_id', p.id)
      await sb.from('fee_payments').delete().eq('school_id', school.id)
      await sb.from('fee_invoices').delete().eq('school_id', school.id)
      await sb.from('students').delete().eq('id', student.id)
      await sb.from('document_counters').delete().eq('school_id', school.id)
      await sb.from('academic_years').delete().eq('school_id', school.id)
      await sb.from('schools').delete().eq('id', school.id)
    }
  })
})

describe('fee_stats', () => {
  it('reports the whole school, not the first page of it', async () => {
    // The C0 assertion in miniature: the figures come from an aggregate in
    // Postgres, so there is no response size for them to be capped by.
    await makeInvoice(1000)
    await makeInvoice(2000)
    await makeInvoice(3000)
    await collect({ p_amount: 1500 })

    const { data } = await sb.rpc('fee_stats', { p_school_id: schoolId, p_academic_year_id: null })
    expect(Number(data.total_billed)).toBe(6000)
    expect(Number(data.total_collected)).toBe(1500)
    expect(Number(data.total_outstanding)).toBe(4500)
    expect(data.collection_rate).toBe(25)
  })

  it('excludes cancelled invoices from what was billed', async () => {
    const inv = await makeInvoice(1000)
    await makeInvoice(500)
    await sb.from('fee_invoices').update({ status: 'cancelled' }).eq('id', inv.id)

    const { data } = await sb.rpc('fee_stats', { p_school_id: schoolId, p_academic_year_id: null })
    expect(Number(data.total_billed)).toBe(500)
  })
})
