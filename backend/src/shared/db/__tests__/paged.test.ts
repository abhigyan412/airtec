import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 1,000-row cap, pinned.
//
// This is the defect that was wrong on screen: PostgREST caps a response and
// returns 200, so /fees/stats reported ₹99.3 lakh billed where the database held
// ₹1.83 crore — a 46% understatement with no error anywhere.
//
// The stub therefore ENFORCES a server cap that is SMALLER than the page size
// the helper asks for. That is the real behaviour, and it is the only way to
// tell a correct paging helper from the previous one, which terminated on
// `batch.length < PAGE` and so silently stopped after a single short batch.

let rows: any[] = []
let serverMaxRows = 3
const requests: Array<{ from: number; to: number; wantCount: boolean }> = []

vi.mock('../client', () => {
  const make = () => {
    let from = 0
    let to = Infinity
    let wantCount = false
    const chain: any = {
      select: (_c?: string, opts?: any) => { wantCount = opts?.count === 'exact'; return chain },
      eq: () => chain, in: () => chain, not: () => chain, lte: () => chain, gte: () => chain,
      neq: () => chain, order: () => chain,
      range: (f: number, t: number) => { from = f; to = t; return chain },
      then: (res: any) => {
        requests.push({ from, to, wantCount })
        const width = Math.min(to - from + 1, serverMaxRows)
        return Promise.resolve({
          data: rows.slice(from, from + width),
          error: null,
          count: wantCount ? rows.length : null,
        }).then(res)
      },
    }
    return chain
  }
  return { supabase: { from: () => make() }, createUserClient: vi.fn() }
})

const { selectAll } = await import('../paged')

const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, amount: 100 }))

beforeEach(() => {
  rows = []
  serverMaxRows = 3
  requests.length = 0
})

describe('selectAll', () => {
  it('returns every row when the set is smaller than one page', async () => {
    rows = makeRows(2)
    expect(await selectAll('fee_invoices', 'id')).toHaveLength(2)
  })

  it('returns every row when the server cap is far below the page size', async () => {
    // The whole point. The old loop asked for 1,000, got 3, concluded "that is
    // all there is" and dropped the other 17.
    rows = makeRows(20)
    const out = await selectAll<any>('fee_invoices', 'id')
    expect(out).toHaveLength(20)
    expect(out.map(r => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('sums to the truth rather than to the first page', async () => {
    // Stated in money, because that is how the bug presented: the dashboard
    // showed the first page's total and called it the school's position.
    rows = makeRows(1760)
    serverMaxRows = 1000
    const out = await selectAll<any>('fee_invoices', 'id, amount')
    expect(out.reduce((s, r) => s + r.amount, 0)).toBe(176_000)
  })

  it('advances by rows actually received, not by the requested page size', async () => {
    rows = makeRows(7)
    await selectAll('fee_invoices', 'id')
    expect(requests.map(r => r.from)).toEqual([0, 3, 6])
  })

  it('asks for the exact count once, not on every page', async () => {
    rows = makeRows(10)
    await selectAll('fee_invoices', 'id')
    expect(requests.filter(r => r.wantCount)).toHaveLength(1)
    expect(requests[0].wantCount).toBe(true)
  })

  it('stops when the server stops returning rows, whatever the count claimed', async () => {
    // A miscounted total must not spin forever.
    rows = makeRows(5)
    serverMaxRows = 0
    await expect(selectAll('fee_invoices', 'id')).resolves.toEqual([])
  })

  it('refuses above the ceiling instead of truncating', async () => {
    // A ceiling that throws is the difference between a report that is late and
    // one that is quietly wrong.
    rows = makeRows(50)
    await expect(selectAll('fee_invoices', 'id', q => q, { ceiling: 10 }))
      .rejects.toThrow(/Refusing to read 50 rows/)
  })

  it('names the table and the offset when a page fails', async () => {
    const { supabase } = await import('../client') as any
    const original = supabase.from
    supabase.from = () => ({
      select: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
    })
    await expect(selectAll('fee_invoices', 'id')).rejects.toThrow(/Failed to read fee_invoices \(rows 0\+\): boom/)
    supabase.from = original
  })

  it('applies the caller-supplied filters to every page', async () => {
    rows = makeRows(9)
    const seen: string[] = []
    await selectAll('fee_invoices', 'id', q => { seen.push('built'); return q.eq('school_id', 'x') })
    expect(seen.length).toBe(requests.length)
    expect(requests.length).toBeGreaterThan(1)
  })
})
