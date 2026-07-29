import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ownership resolution: this is what stops a parent or student from
// reading another family's records, so each branch is asserted
// explicitly rather than inferred from the routes that call it.
const results: Record<string, any> = {}
vi.mock('../../db/client', () => {
  const chain = (table: string): any => ({
    select: () => chain(table),
    eq: () => chain(table),
    maybeSingle: async () => results[table] ?? { data: null },
  })
  return { supabase: { from: (t: string) => chain(t) }, createUserClient: vi.fn() }
})

const { resolveOwnStudentId } = await import('../helpers')

beforeEach(() => { for (const k of Object.keys(results)) delete results[k] })

describe('resolveOwnStudentId', () => {
  it('resolves a student to their own record via students.user_id', async () => {
    results['students'] = { data: { id: 'student-1' } }
    expect(await resolveOwnStudentId('user-1', 'student', 'school-1')).toBe('student-1')
  })

  it('resolves a parent to their child via parents.student_id', async () => {
    results['parents'] = { data: { student_id: 'student-2' } }
    expect(await resolveOwnStudentId('user-2', 'parent', 'school-1')).toBe('student-2')
  })

  it('returns null for a student with no linked record, rather than falling through', async () => {
    results['students'] = { data: null }
    expect(await resolveOwnStudentId('user-3', 'student', 'school-1')).toBeNull()
  })

  it('returns null for a parent with no linked child', async () => {
    results['parents'] = { data: null }
    expect(await resolveOwnStudentId('user-4', 'parent', 'school-1')).toBeNull()
  })

  it('treats any non-student role as the parent path', async () => {
    // The callers gate on NON_STAFF_ROLES before reaching here, so
    // "not student" means parent.
    results['parents'] = { data: { student_id: 'student-5' } }
    expect(await resolveOwnStudentId('user-5', 'parent', 'school-1')).toBe('student-5')
  })

  it('returns null when the parent row exists but has no student attached', async () => {
    results['parents'] = { data: { student_id: null } }
    expect(await resolveOwnStudentId('user-6', 'parent', 'school-1')).toBeNull()
  })
})
