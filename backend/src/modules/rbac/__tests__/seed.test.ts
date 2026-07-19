import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../../shared/db/client'
import {
  seedDefaultRoles,
  assignDefaultUserRole,
  setPrimaryUserRole,
  LEGACY_ROLE_TO_RBAC_ROLE,
  DEFAULT_ROLE_PERMISSIONS,
} from '../seed'

// Exercises the actual seeding/assignment logic against a disposable
// throwaway school — created in beforeAll, torn down in afterAll — so
// these tests never touch the real demo schools' data, but still hit
// the real database (the historical bugs here were all about actual
// DB state, not logic bugs a pure mock would have caught).

describe('rbac seeding functions', () => {
  let schoolId: string
  const authUserIds: string[] = []

  beforeAll(async () => {
    const { data: school, error } = await supabase
      .from('schools')
      .insert({ name: `__vitest_rbac_${Date.now()}` })
      .select()
      .single()
    if (error || !school) throw new Error(`Failed to create test school: ${error?.message}`)
    schoolId = school.id
  })

  afterAll(async () => {
    const { data: roles } = await supabase.from('roles').select('id').eq('school_id', schoolId)
    const roleIds = (roles ?? []).map(r => r.id)

    if (roleIds.length) await supabase.from('role_permissions_v2').delete().in('role_id', roleIds)
    await supabase.from('user_roles').delete().eq('school_id', schoolId)
    await supabase.from('roles').delete().eq('school_id', schoolId)
    await supabase.from('users').delete().eq('school_id', schoolId)

    for (const id of authUserIds) {
      await supabase.auth.admin.deleteUser(id).catch(() => {})
    }

    await supabase.from('schools').delete().eq('id', schoolId)
  })

  async function createTestUser(role: string, label: string): Promise<string> {
    const email = `vitest-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    const { data: authData, error } = await supabase.auth.admin.createUser({
      email,
      password: 'Vitest@12345',
      email_confirm: true,
    })
    if (error || !authData?.user) throw new Error(`Failed to create auth user: ${error?.message}`)
    authUserIds.push(authData.user.id)

    const { error: userErr } = await supabase.from('users').insert({
      id: authData.user.id,
      school_id: schoolId,
      full_name: `Vitest ${label}`,
      email,
      role,
    })
    if (userErr) throw new Error(`Failed to create users row: ${userErr.message}`)

    return authData.user.id
  }

  it('seedDefaultRoles creates all 16 default roles with permissions attached', async () => {
    const roleIdByName = await seedDefaultRoles(schoolId)
    const expectedNames = Object.keys(DEFAULT_ROLE_PERMISSIONS)

    expect(Object.keys(roleIdByName).sort()).toEqual(expectedNames.sort())

    const { data: perms } = await supabase
      .from('role_permissions_v2')
      .select('role_id')
      .eq('role_id', roleIdByName['School Admin'])
    expect(perms?.length).toBe(DEFAULT_ROLE_PERMISSIONS['School Admin'].length)
  })

  it('seedDefaultRoles is idempotent — calling it twice does not duplicate roles or permissions', async () => {
    await seedDefaultRoles(schoolId)
    const roleIdByName = await seedDefaultRoles(schoolId)

    const { data: roles } = await supabase.from('roles').select('id').eq('school_id', schoolId).eq('name', 'Teacher')
    expect(roles?.length).toBe(1)

    const { data: perms } = await supabase
      .from('role_permissions_v2')
      .select('id')
      .eq('role_id', roleIdByName['Teacher'])
    expect(perms?.length).toBe(DEFAULT_ROLE_PERMISSIONS['Teacher'].length)
  })

  it('assignDefaultUserRole gives a fresh user their matching primary role', async () => {
    const userId = await createTestUser('teacher', 'fresh-teacher')
    await assignDefaultUserRole(userId, schoolId, 'teacher')

    const { data } = await supabase
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId)

    expect((data ?? []).map((r: any) => r.roles?.name)).toEqual(['Teacher'])
  })

  it('assignDefaultUserRole is idempotent — no duplicate row on repeat calls', async () => {
    const userId = await createTestUser('accountant', 'dup-check')
    await assignDefaultUserRole(userId, schoolId, 'accountant')
    await assignDefaultUserRole(userId, schoolId, 'accountant')

    const { data } = await supabase.from('user_roles').select('id').eq('user_id', userId)
    expect(data?.length).toBe(1)
  })

  it('assignDefaultUserRole no-ops silently for a legacy role with no RBAC mapping', async () => {
    // users.role has a DB check constraint, so an unmapped value can
    // never actually exist on a real row — this only verifies the
    // function's early-return guard, which is why it doesn't need a
    // real users row (the guard fires before any DB write).
    const fakeUserId = crypto.randomUUID()
    await expect(assignDefaultUserRole(fakeUserId, schoolId, 'not_a_real_role')).resolves.toBeUndefined()

    const { data } = await supabase.from('user_roles').select('id').eq('user_id', fakeUserId)
    expect(data?.length ?? 0).toBe(0)
  })

  it('setPrimaryUserRole moves a user from their old primary role to a new one', async () => {
    const userId = await createTestUser('teacher', 'role-switch')
    await assignDefaultUserRole(userId, schoolId, 'teacher')
    await setPrimaryUserRole(userId, schoolId, 'principal', 'teacher')

    const { data } = await supabase.from('user_roles').select('roles(name)').eq('user_id', userId)
    const names = (data ?? []).map((r: any) => r.roles?.name)

    expect(names).toContain('Principal')
    expect(names).not.toContain('Teacher')
    expect(names.length).toBe(1)
  })

  it('setPrimaryUserRole leaves extra (non-primary) roles untouched', async () => {
    const userId = await createTestUser('teacher', 'extra-role-keep')
    await assignDefaultUserRole(userId, schoolId, 'teacher')

    const roleIdByName = await seedDefaultRoles(schoolId)
    await supabase.from('user_roles').insert({ user_id: userId, role_id: roleIdByName['Exam Controller'], school_id: schoolId })

    await setPrimaryUserRole(userId, schoolId, 'principal', 'teacher')

    const { data } = await supabase.from('user_roles').select('roles(name)').eq('user_id', userId)
    const names = (data ?? []).map((r: any) => r.roles?.name).sort()

    expect(names).toEqual(['Exam Controller', 'Principal'])
  })

  it('LEGACY_ROLE_TO_RBAC_ROLE covers every value the users.role column accepts', () => {
    // Mirrors the check constraint in supabase/migrations/001_core_schema.sql
    const constraintValues = ['super_admin', 'school_admin', 'principal', 'teacher', 'accountant', 'counselor', 'parent', 'student']
    for (const v of constraintValues) {
      expect(LEGACY_ROLE_TO_RBAC_ROLE[v], `no RBAC mapping for legacy role '${v}'`).toBeDefined()
    }
  })
})
