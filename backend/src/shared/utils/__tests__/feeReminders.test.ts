import { describe, it, expect, vi, beforeEach } from 'vitest'

// The sweep's value is entirely in which invoices it selects and who it
// notifies, so the data layer is stubbed and those decisions asserted.
const invoiceRows: any[] = []
const assignmentRows: any[] = []
const notifyCalls: any[] = []

// Table-aware, per table rather than "everything that isn't fee_payments".
//
// The sweep reads three tables now — invoices, payments, and the assignments it
// checks fee categories on. Falling back to the invoice rows for the third made
// every invoice look like an RTE assignment, so the sweep correctly skipped
// everybody and three unrelated assertions failed. A default of "no rows" is
// also the honest default: a school with no RTE seats excludes nobody.
//
// The chain now honours .order()/.range() and reports an exact count, because
// the sweep pages through selectAll instead of issuing one capped request. The
// stub deliberately ENFORCES a server cap (SERVER_MAX_ROWS) that is smaller than
// the page size the helper asks for — that is the real PostgREST behaviour the
// production bug depended on, and a mock that hands back everything in one go
// cannot tell a paging helper from a broken one.
export const SERVER_MAX_ROWS = 3

vi.mock('../../db/client', () => {
  const make = (rows: () => any[]) => {
    let from = 0
    let to = Infinity
    let wantCount = false
    const chain: any = {
      select: (_cols?: string, opts?: any) => { wantCount = opts?.count === 'exact'; return chain },
      eq: () => chain, in: () => chain, not: () => chain, lte: () => chain,
      order: () => chain,
      range: (f: number, t: number) => { from = f; to = t; return chain },
      then: (res: any) => {
        const all = rows()
        // The server never returns more than its cap, whatever was asked for.
        const width = Math.min(to - from + 1, SERVER_MAX_ROWS)
        const page = all.slice(from, from + width)
        return Promise.resolve({
          data: page, error: null, count: wantCount ? all.length : null,
        }).then(res)
      },
    }
    return chain
  }
  const forTable = (t: string) =>
     t === 'fee_assignments' ? assignmentRows
    : invoiceRows
  return {
    supabase: { from: (t: string) => make(() => forTable(t)) },
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

// amount_paid lives ON the invoice, maintained by a trigger on fee_payments.
//
// These fixtures used to push rows into a `fee_payments` table for the sweep to
// sum, which is what fetchPaidByInvoice did before the model rewrite. It now
// reads fee_invoices.amount_paid directly, so the stubbed payments reached
// nothing and three assertions had been failing ever since — the code was right
// and the fixtures were describing a function that no longer exists.
const invoice = (over: Record<string, any> = {}) => ({
  id: crypto.randomUUID(),
  school_id: 'school-1',
  student_id: 'student-1',
  invoice_number: 'INV202600001',
  due_date: '2020-01-01',      // long past
  total_amount: 5000,
  amount_paid: 0,
  status: 'unpaid',
  ...over,
})

beforeEach(() => {
  invoiceRows.length = 0
  assignmentRows.length = 0; notifyCalls.length = 0
})

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
    invoiceRows.push(invoice({ total_amount: 5000, amount_paid: 3000, status: 'partial' }))
    await runFeeReminders('school-1')
    expect(notifyCalls[0].params.message).toContain('2,000')
  })

  it('skips an invoice already settled by payments', async () => {
    invoiceRows.push(invoice({ total_amount: 5000, amount_paid: 5000 }))
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
    invoiceRows.push(invoice({ amount_paid: 5000 }), invoice())
    const r = await runFeeReminders('school-1')
    expect(r.checked).toBe(2)
    expect(r.notified).toBe(1)
  })

  // An RTE child is admitted free under §12(1)(c) and the STATE reimburses the
  // school. Texting the parents at 7am about a balance they do not owe, cannot
  // pay and were told about at admission is the worst thing this job can do.
  describe('students whose dues are not their family\'s', () => {
    it('does not remind the parents of an RTE student', async () => {
      invoiceRows.push(invoice({ student_id: 'rte-child' }))
      assignmentRows.push({ student_id: 'rte-child' })
      const r = await runFeeReminders('school-1')
      expect(r.notified).toBe(0)
      expect(notifyCalls).toHaveLength(0)
    })

    it('counts them rather than hiding them', async () => {
      // A sweep that quietly got quieter is indistinguishable from a broken one.
      invoiceRows.push(invoice({ student_id: 'rte-child' }))
      assignmentRows.push({ student_id: 'rte-child' })
      const r = await runFeeReminders('school-1')
      expect(r.checked).toBe(1)
      expect(r.skipped_not_owed_by_family).toBe(1)
    })

    it('still reminds everyone else in the same run', async () => {
      invoiceRows.push(invoice({ student_id: 'rte-child' }), invoice({ student_id: 'paying-child' }))
      assignmentRows.push({ student_id: 'rte-child' })
      const r = await runFeeReminders('school-1')
      expect(r.notified).toBe(1)
      expect(notifyCalls).toHaveLength(1)
    })

    it('chases everyone when no student is on an excluded category', async () => {
      invoiceRows.push(invoice())
      const r = await runFeeReminders('school-1')
      expect(r.notified).toBe(1)
      expect(r.skipped_not_owed_by_family).toBe(0)
    })
  })
})
