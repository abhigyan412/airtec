import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { supabase } from '../../../shared/db/client'
import { DEFAULT_ROLE_PERMISSIONS, LEGACY_ROLE_TO_RBAC_ROLE } from '../seed'

// ═══════════════════════════════════════════════════════════════
// Standing regression check for the RBAC bugs fixed across this
// codebase: three separate user-creation paths (register-school,
// team/invite, recruitment "joined") independently forgot to assign
// a user_roles row, leaving new users with almost no sidebar/page
// access. This test asserts the invariant that should always hold
// against WHATEVER data currently exists in the database — it isn't
// scoped to a fixture, so it catches drift from any cause: a new
// code path that skips assignDefaultUserRole, a manual DB edit, a
// migration that didn't backfill, etc.
//
// Run with: npm test (from backend/)
// ═══════════════════════════════════════════════════════════════

describe('RBAC live-data sync invariant', () => {
  it('every school has all default roles seeded', async () => {
    const { data: schools, error: schoolsErr } = await supabase.from('schools').select('id, name')
    expect(schoolsErr).toBeNull()

    const { data: allRoles, error: rolesErr } = await supabase.from('roles').select('id, name, school_id')
    expect(rolesErr).toBeNull()

    const expectedNames = Object.keys(DEFAULT_ROLE_PERMISSIONS)
    const rolesBySchool = new Map<string, Set<string>>()
    for (const r of allRoles ?? []) {
      if (!rolesBySchool.has(r.school_id)) rolesBySchool.set(r.school_id, new Set())
      rolesBySchool.get(r.school_id)!.add(r.name)
    }

    const missingBySchool: string[] = []
    for (const s of schools ?? []) {
      const have = rolesBySchool.get(s.id) ?? new Set()
      const missing = expectedNames.filter(n => !have.has(n))
      if (missing.length) missingBySchool.push(`${s.name}: missing [${missing.join(', ')}]`)
    }

    expect(missingBySchool).toEqual([])
  })

  it('no role sits at zero permissions', async () => {
    const { data: allRoles } = await supabase.from('roles').select('id, name, school_id')
    const { data: rolePerms } = await supabase.from('role_permissions_v2').select('role_id')

    const permCount = new Map<string, number>()
    for (const rp of rolePerms ?? []) permCount.set(rp.role_id, (permCount.get(rp.role_id) ?? 0) + 1)

    const zeroPermRoles = (allRoles ?? [])
      .filter(r => !permCount.get(r.id))
      .map(r => `${r.name} (school ${r.school_id})`)

    expect(zeroPermRoles).toEqual([])
  })

  it('no user_roles row leaks across schools', async () => {
    const { data: users } = await supabase.from('users').select('id, school_id')
    const { data: allRoles } = await supabase.from('roles').select('id, school_id')
    const { data: allUserRoles } = await supabase.from('user_roles').select('id, user_id, role_id, school_id')

    const roleById = new Map((allRoles ?? []).map(r => [r.id, r]))
    const userSchoolById = new Map((users ?? []).map(u => [u.id, u.school_id]))

    const leaks = (allUserRoles ?? [])
      .filter(ur => {
        const role = roleById.get(ur.role_id)
        const userSchool = userSchoolById.get(ur.user_id)
        return !role || role.school_id !== ur.school_id || userSchool !== ur.school_id
      })
      .map(ur => `user_roles#${ur.id} (user=${ur.user_id}, role=${ur.role_id}, school=${ur.school_id})`)

    expect(leaks).toEqual([])
  })

  it('every user has exactly one correctly-matched primary role', async () => {
    const { data: users } = await supabase.from('users').select('id, full_name, email, role')
    const { data: allRoles } = await supabase.from('roles').select('id, name')
    const { data: allUserRoles } = await supabase.from('user_roles').select('user_id, role_id')

    const roleNameById = new Map((allRoles ?? []).map(r => [r.id, r.name]))
    const rolesByUser = new Map<string, string[]>()
    for (const ur of allUserRoles ?? []) {
      const name = roleNameById.get(ur.role_id)
      if (!name) continue
      if (!rolesByUser.has(ur.user_id)) rolesByUser.set(ur.user_id, [])
      rolesByUser.get(ur.user_id)!.push(name)
    }

    const problems: string[] = []
    for (const u of users ?? []) {
      const expectedName = LEGACY_ROLE_TO_RBAC_ROLE[u.role]
      const mine = rolesByUser.get(u.id) ?? []

      if (!expectedName) {
        problems.push(`${u.email}: legacy role '${u.role}' has no RBAC mapping`)
        continue
      }

      const matchCount = mine.filter(n => n === expectedName).length
      if (matchCount === 0) {
        problems.push(`${u.email}: missing primary role '${expectedName}' (has [${mine.join(', ')}])`)
      } else if (matchCount > 1) {
        problems.push(`${u.email}: duplicate '${expectedName}' role rows (x${matchCount})`)
      }
    }

    expect(problems).toEqual([])
  })
})
