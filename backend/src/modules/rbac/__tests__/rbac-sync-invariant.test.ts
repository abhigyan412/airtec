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

// Fixture rows created by the other suites are deliberately excluded:
// they are scaffolding, not real data, and an interrupted run can leave
// them behind. Counting them made this suite fail for reasons that say
// nothing about the state these invariants exist to protect.
const FIXTURE_PREFIX = '__vitest'
const isFixtureName = (v?: string | null) => !!v?.startsWith(FIXTURE_PREFIX)

// A school that has bought only part of the product does not get the
// whole role list. schools.enabled_modules NULL means "everything",
// which is the norm; a restricted school deliberately drops the roles it
// will never use (see rbac/timetableSchoolRoles.ts) so its Permissions
// screen isn't a list of empty roles nobody can explain. Such a school is
// exempt from "has every default role" — but not from anything else
// below, which is where the bugs this suite exists for actually live.
const isModuleRestricted = (school: any) => Array.isArray(school?.enabled_modules)

const LEGACY_ROLE_NAMES = new Set(Object.values(LEGACY_ROLE_TO_RBAC_ROLE))

describe('RBAC live-data sync invariant', () => {
  it('every school has all default roles seeded', async () => {
    const { data: allSchools, error: schoolsErr } = await supabase.from('schools').select('id, name, enabled_modules')
    const schools = (allSchools ?? [])
      .filter(s => !isFixtureName((s as any).name))
      .filter(s => !isModuleRestricted(s))
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
    const { data: allSchoolUsers } = await supabase.from('users').select('id, school_id, email')
    const users = (allSchoolUsers ?? []).filter(u => !isFixtureName((u as any).email))
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
    const { data: allUsers } = await supabase.from('users').select('id, full_name, email, role')
    const users = (allUsers ?? []).filter(u => !isFixtureName((u as any).email))
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
        // Roles like Timetable Manager exist only in RBAC — there is no
        // legacy users.role value that maps to them, so such an account
        // necessarily carries some other legacy role. What the invariant
        // is really protecting against is a user with NO role at all,
        // which is the bug that produced an empty sidebar. Holding a
        // real specialist role instead of the legacy default is fine.
        const specialist = mine.filter(n => !LEGACY_ROLE_NAMES.has(n))
        if (!mine.length) {
          problems.push(`${u.email}: has no RBAC role at all`)
        } else if (!specialist.length) {
          problems.push(`${u.email}: missing primary role '${expectedName}' (has [${mine.join(', ')}])`)
        }
      } else if (matchCount > 1) {
        problems.push(`${u.email}: duplicate '${expectedName}' role rows (x${matchCount})`)
      }
    }

    expect(problems).toEqual([])
  })
})
