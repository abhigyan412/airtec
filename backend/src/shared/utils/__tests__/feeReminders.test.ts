import { describe, it, expect, vi, beforeEach } from 'vitest'

// The sweep's value is entirely in which invoices it selects and who it
// notifies, so the data layer is stubbed and those decisions asserted.
const invoiceRows: any[] = []
const paymentRows: any[] = []
const notifyCalls: any[] = []

// Table-aware: the sweep queries fee_invoices and then fee_payments, and
// handing the same rows to both makes every payment invisible.
vi.mock('../../db/client', () => {
  const make = (rows: () => any[]) => {
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, not: () => chain, lte: () => chain,
      then: (res: any) => Promise.resolve({ data: rows(), error: null }).then(res),
    }
    return chain
  }
  return {
    supabase: { from: (t: string) => make(() => (t === 'fee_payments' ? paymentRows : invoiceRows)) },
    createUserClient: vi.fn(),
  }
})
vi.mock('../notifications', () => ({
  createNotifications: vi.fn(async (ids: string[], params: any) => {
    notifyCalls.push({ ids, params })
    return { count: ids.length }
  }),
  getRecipientUserIdsForStudent: vi.fn(async () => ['parent-1']),
  getRecipientUserIdsForStudents: vi.fn(async () => ['parent-1']),
}))

const { runFeeReminders } = await import('../feeReminders')

const invoice = (over: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  school_id: 'school-1',
  student_id: 'student-1',
  invoice_number: 'INV202600001',
  due_date: '2020-01-01',      // long past
  total_amount: 5000,
  status: 'unpaid',
  fee_payments: [],
  ...over,
})

beforeEach(() => { invoiceRows.length = 0; paymentRows.length = 0; notifyCalls.length = 0 })

describe('runFeeReminders', () => {
  it('reports zero when there is nothing outstanding', async () => {
    const r = await runFeeReminders('school-1')
    expect(r.checked).toBe(0)
    expect(r.notified).toBe(0)
    expect(notifyCalls).toHaveLength(0)
  })

  it('notifies for an overdue invoice', async () => {
    invoiceRows.push(invoice())
    const r = await runFeeReminders('school-1')
    expect(r.notified).toBeGreaterThan(0)
    expect(notifyCalls[0].params.type).toBe('fee_overdue')
  })

  it('links overdue notifications into the family app, not /portal', async () => {
    // /portal is a Next route group and contributes no URL segment — the
    // old value 404'd for every recipient.
    invoiceRows.push(invoice())
    await runFeeReminders('school-1')
    expect(notifyCalls[0].params.link).toBe('/fees')
    expect(notifyCalls[0].params.link).not.toContain('/portal')
  })

  it('ties the notification to the invoice so the daily dedupe index applies', async () => {
    const inv = invoice()
    invoiceRows.push(inv)
    await runFeeReminders('school-1')
    expect(notifyCalls[0].params.relatedEntityType).toBe('fee_invoice')
    expect(notifyCalls[0].params.relatedEntityId).toBe(inv.id)
  })

  it('names the amount still outstanding, not the invoice total', async () => {
    const inv = invoice({ total_amount: 5000, status: 'partial' })
    invoiceRows.push(inv)
    paymentRows.push({ invoice_id: inv.id, amount_paid: 3000 })
    await runFeeReminders('school-1')
    expect(notifyCalls[0].params.message).toContain('2,000')
  })

  it('skips an invoice already settled by payments', async () => {
    const inv = invoice({ total_amount: 5000 })
    invoiceRows.push(inv)
    paymentRows.push({ invoice_id: inv.id, amount_paid: 5000 })
    const r = await runFeeReminders('school-1')
    expect(r.notified).toBe(0)
  })

  it('uses the due-soon wording for an invoice not yet overdue', async () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 2)
    invoiceRows.push(invoice({ due_date: soon.toISOString().slice(0, 10) }))
    await runFeeReminders('school-1')
    expect(notifyCalls[0].params.type).toBe('fee_due_soon')
  })

  it('runs school-wide when no school is given', async () => {
    invoiceRows.push(invoice())
    const r = await runFeeReminders()
    expect(r.checked).toBeGreaterThan(0)
  })

  it('counts every invoice it examined, not just the ones it notified for', async () => {
    const settled = invoice()
    invoiceRows.push(settled, invoice())
    paymentRows.push({ invoice_id: settled.id, amount_paid: 99999 })
    const r = await runFeeReminders('school-1')
    expect(r.checked).toBe(2)
    expect(r.notified).toBe(1)
  })
})
