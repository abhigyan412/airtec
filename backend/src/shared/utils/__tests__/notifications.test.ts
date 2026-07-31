import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { supabase } from '../../db/client'
import {
  createNotification, createNotifications,
  getRecipientUserIdsForStudent, getRecipientUserIdsForStudents,
} from '../notifications'

// Real database: the two bugs this module has had were both about DB
// behaviour a mock would have hidden — PostgREST returning no rows
// without .select(), and the unique dedupe index.
//
// Delivery fan-out is stubbed so these tests assert the write path only.
vi.mock('../delivery', () => ({
  enqueueDeliveries: vi.fn(async () => 0),
  kickDeliveries: vi.fn(),
}))

const sb = supabase as any

describe('notification writes', () => {
  let schoolId: string
  let userA: string
  let userB: string
  let studentId: string
  let parentUserId: string

  beforeAll(async () => {
    const { data: school, error } = await sb.from('schools')
      .insert({ name: `__vitest_notif_${Date.now()}` }).select().single()
    if (error) throw new Error(`fixture school: ${error.message}`)
    schoolId = school.id

    const mk = async (role: string) => {
      const email = `__vitest_notif_${role}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`
      const { data: au } = await sb.auth.admin.createUser({ email, password: 'Test@12345', email_confirm: true })
      await sb.from('users').insert({ id: au.user.id, school_id: schoolId, full_name: role, email, role })
      return au.user.id
    }
    userA = await mk('parent')
    userB = await mk('student')
    parentUserId = userA

    const { data: student } = await sb.from('students').insert({
      school_id: schoolId, first_name: 'Test', last_name: 'Child', status: 'active', user_id: userB,
    }).select().single()
    studentId = student.id
    await sb.from('parents').insert({ school_id: schoolId, student_id: studentId, user_id: parentUserId })
  })

  afterAll(async () => {
    await sb.from('notifications').delete().eq('school_id', schoolId)
    await sb.from('parents').delete().eq('school_id', schoolId)
    await sb.from('students').delete().eq('school_id', schoolId)
    for (const id of [userA, userB]) {
      await sb.from('users').delete().eq('id', id)
      await sb.auth.admin.deleteUser(id).catch(() => {})
    }
    await sb.from('schools').delete().eq('id', schoolId)
  })

  beforeEach(async () => { await sb.from('notifications').delete().eq('school_id', schoolId) })

  const base = { schoolId: '', type: 'fee_overdue' as const, title: 'Fee overdue', message: 'x', link: '/fees' }
  const params = (over: Record<string, any> = {}) => ({ ...base, schoolId, ...over })

  describe('createNotification', () => {
    it('writes a row and reports it created', async () => {
      const r = await createNotification({ ...params(), userId: userA })
      expect(r.count).toBe(1)
      const { data } = await sb.from('notifications').select('*').eq('user_id', userA)
      expect(data).toHaveLength(1)
      expect(data[0].link).toBe('/fees')
    })

    it('reports a real count — the guard downstream depends on it', async () => {
      // Without .select() this returned null on every call, deduped or
      // not, which silently disabled all delivery.
      const r = await createNotification({ ...params(), userId: userA, relatedEntityId: crypto.randomUUID(), relatedEntityType: 'fee_invoice' })
      expect(r.count).toBe(1)
    })

    it('dedupes a repeat for the same user/type/entity on the same day', async () => {
      const relatedEntityId = crypto.randomUUID()
      const first = await createNotification({ ...params(), userId: userA, relatedEntityId, relatedEntityType: 'fee_invoice' })
      const second = await createNotification({ ...params(), userId: userA, relatedEntityId, relatedEntityType: 'fee_invoice' })
      expect(first.count).toBe(1)
      // A deduped write must report 0, or a cron re-run re-sends push for
      // something the user already received.
      expect(second.count).toBe(0)
      const { count } = await sb.from('notifications')
        .select('id', { count: 'exact', head: true }).eq('user_id', userA)
      expect(count).toBe(1)
    })

    it('does not dedupe when there is no related entity', async () => {
      await createNotification({ ...params(), userId: userA })
      await createNotification({ ...params(), userId: userA })
      const { count } = await sb.from('notifications')
        .select('id', { count: 'exact', head: true }).eq('user_id', userA)
      expect(count).toBe(2)
    })

    it('dedupes per user, not globally', async () => {
      const relatedEntityId = crypto.randomUUID()
      const a = await createNotification({ ...params(), userId: userA, relatedEntityId, relatedEntityType: 'fee_invoice' })
      const b = await createNotification({ ...params(), userId: userB, relatedEntityId, relatedEntityType: 'fee_invoice' })
      expect(a.count).toBe(1)
      expect(b.count).toBe(1)
    })

    it('defaults link and entity fields to null rather than undefined', async () => {
      await createNotification({ schoolId, userId: userA, type: 'fee_overdue', title: 't', message: 'm' })
      const { data } = await sb.from('notifications').select('link, related_entity_id').eq('user_id', userA).single()
      expect(data.link).toBeNull()
      expect(data.related_entity_id).toBeNull()
    })
  })

  describe('createNotifications', () => {
    it('writes one row per recipient in a single call', async () => {
      const r = await createNotifications([userA, userB], params())
      expect(r.count).toBe(2)
    })

    it('collapses duplicate recipients', async () => {
      const r = await createNotifications([userA, userA, userA], params())
      expect(r.count).toBe(1)
    })

    it('ignores empty and falsy recipient lists', async () => {
      expect((await createNotifications([], params())).count).toBe(0)
      expect((await createNotifications([undefined as any, null as any], params())).count).toBe(0)
    })

    it('reports 0 when every recipient was already notified', async () => {
      const relatedEntityId = crypto.randomUUID()
      const p = { ...params(), relatedEntityId, relatedEntityType: 'fee_invoice' }
      expect((await createNotifications([userA, userB], p)).count).toBe(2)
      expect((await createNotifications([userA, userB], p)).count).toBe(0)
    })

    it('reports only the genuinely new recipients on a partial repeat', async () => {
      const relatedEntityId = crypto.randomUUID()
      const p = { ...params(), relatedEntityId, relatedEntityType: 'fee_invoice' }
      await createNotifications([userA], p)
      expect((await createNotifications([userA, userB], p)).count).toBe(1)
    })

    it('rejects a type outside the union at the database level', async () => {
      // The CHECK constraint is the backstop for the compile-time union.
      const r = await createNotifications([userA], { ...params(), type: 'not_a_real_type' as any })
      expect(r.count).toBe(0)
    })
  })

  describe('recipient resolution', () => {
    it('returns both the student and the linked parent login', async () => {
      const ids = await getRecipientUserIdsForStudent(studentId)
      expect(ids.sort()).toEqual([userA, userB].sort())
    })

    it('returns nothing for a student with no linked logins', async () => {
      const { data: orphan } = await sb.from('students').insert({
        school_id: schoolId, first_name: 'No', last_name: 'Login', status: 'active',
      }).select().single()
      try {
        expect(await getRecipientUserIdsForStudent(orphan.id)).toEqual([])
      } finally {
        await sb.from('students').delete().eq('id', orphan.id)
      }
    })

    it('returns nothing for an unknown student id', async () => {
      expect(await getRecipientUserIdsForStudent('00000000-0000-0000-0000-000000000000')).toEqual([])
    })

    it('resolves a batch without duplicating a shared parent', async () => {
      const ids = await getRecipientUserIdsForStudents([studentId, studentId])
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('returns nothing for an empty batch', async () => {
      expect(await getRecipientUserIdsForStudents([])).toEqual([])
    })
  })
})
