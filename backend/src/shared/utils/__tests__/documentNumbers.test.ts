import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../db/client'
import { nextDocumentNumber } from '../documentNumbers'

// Hits the real database on purpose. The bug this replaced —
// "duplicate key value violates unique constraint
// fee_payments_receipt_number_key" — was entirely about database state
// and concurrency, which a mocked counter cannot reproduce.

const sb = supabase as any

describe('nextDocumentNumber', () => {
  let schoolId: string
  const year = new Date().getFullYear()

  beforeAll(async () => {
    const { data, error } = await sb.from('schools')
      .insert({ name: `__vitest_docnum_${Date.now()}` }).select().single()
    if (error) throw new Error(`fixture school: ${error.message}`)
    schoolId = data.id
  })

  afterAll(async () => {
    await sb.from('document_counters').delete().eq('school_id', schoolId)
    await sb.from('schools').delete().eq('id', schoolId)
  })

  it('starts a fresh counter at 1', async () => {
    expect(await nextDocumentNumber(schoolId, 'INV')).toBe(`INV${year}00001`)
  })

  it('increments on each call', async () => {
    expect(await nextDocumentNumber(schoolId, 'INV')).toBe(`INV${year}00002`)
    expect(await nextDocumentNumber(schoolId, 'INV')).toBe(`INV${year}00003`)
  })

  it('keeps a separate series per prefix', async () => {
    expect(await nextDocumentNumber(schoolId, 'RCP')).toBe(`RCP${year}00001`)
    expect(await nextDocumentNumber(schoolId, 'ADM')).toBe(`ADM${year}0001`)
  })

  it('preserves the per-prefix pad width', async () => {
    // INV/RCP are 5 digits, everything else 4 — changing either would
    // break visual continuity with numbers already issued.
    expect(await nextDocumentNumber(schoolId, 'RCP')).toMatch(new RegExp(`^RCP${year}\\d{5}$`))
    expect(await nextDocumentNumber(schoolId, 'TC')).toMatch(new RegExp(`^TC${year}\\d{4}$`))
    expect(await nextDocumentNumber(schoolId, 'CERT')).toMatch(new RegExp(`^CERT${year}\\d{4}$`))
  })

  it('never issues the same number twice under concurrency', async () => {
    // The exact failure mode of the count(*)+1 version: N callers read
    // the same count and all generate the same number.
    const results = await Promise.all(Array.from({ length: 25 }, () => nextDocumentNumber(schoolId, 'APP')))
    expect(new Set(results).size).toBe(25)
  })

  it('produces a contiguous series under concurrency, with no gaps', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => nextDocumentNumber(schoolId, 'INQ')))
    const numbers = results.map(r => Number(r.slice(-4))).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
  })

  it('isolates counters between schools', async () => {
    const { data: other } = await sb.from('schools')
      .insert({ name: `__vitest_docnum_other_${Date.now()}` }).select().single()
    try {
      expect(await nextDocumentNumber(other.id, 'INV')).toBe(`INV${year}00001`)
    } finally {
      await sb.from('document_counters').delete().eq('school_id', other.id)
      await sb.from('schools').delete().eq('id', other.id)
    }
  })

  it('surfaces a clear error for an unknown school rather than returning a bad number', async () => {
    await expect(nextDocumentNumber('00000000-0000-0000-0000-000000000000', 'INV'))
      .rejects.toThrow(/Could not generate/)
  })

  it('resumes from a counter seeded past existing history', async () => {
    // This is what the migration does for imported/seeded data, and what
    // the seed does after a bulk load: without it the first generated
    // number collides with row #1 that already exists.
    await sb.from('document_counters')
      .upsert({ school_id: schoolId, year, prefix: 'JA', last_number: 500 },
              { onConflict: 'school_id,year,prefix' })
    expect(await nextDocumentNumber(schoolId, 'JA')).toBe(`JA${year}0501`)
  })
})
