import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response, NextFunction } from 'express'

// Authorization logic, mocked at the data layer. Every branch here is a
// decision about who gets in; provoking each one from live data would
// mean manufacturing role/permission rows per case with no added
// confidence in the decision itself.
const results: Record<string, any> = {}
const call = (table: string) => {
  const chain: any = {
    select: () => chain, eq: () => chain, in: () => chain,
    maybeSingle: async () => results[table] ?? { data: null, error: null },
    then: (res: any) => Promise.resolve(results[table] ?? { data: [], error: null }).then(res),
  }
  return chain
}
vi.mock('../../db/client', () => ({
  supabase: { from: (t: string) => call(t) },
  createUserClient: vi.fn(),
}))

const { requirePermission, getPermissionsForRole } = await import('../permissions')
const { getPermissionsForUser, requirePermissionV2, requireAnyPermissionV2, invalidateAllPermissions, invalidatePermissionsForUser } = await import('../permissions-v2')

const mockRes = () => {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}
const reqAs = (role: string) => ({ user: { id: 'u1', school_id: 's1', role } } as any)

// invalidateAllPermissions is load-bearing, not tidiness: resolved permissions
// are cached per user, and every case below uses the same u1/s1 pair — without
// it the first case's permission set would answer every later one.
beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  invalidateAllPermissions()
})

describe('requirePermission (legacy module/action)', () => {
  it.each(['school_admin', 'principal'])('lets %s through without consulting the table', async role => {
    const next = vi.fn()
    await requirePermission('fees', 'create')(reqAs(role), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })

  it('allows a role whose row grants the action', async () => {
    results['role_permissions'] = { data: { can_view: true, can_create: false }, error: null }
    const next = vi.fn()
    await requirePermission('fees', 'view')(reqAs('accountant'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })

  it('403s when the row denies that specific action', async () => {
    results['role_permissions'] = { data: { can_view: true, can_create: false }, error: null }
    const res = mockRes(); const next = vi.fn()
    await requirePermission('fees', 'create')(reqAs('accountant'), res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('403s when the role has no row at all — deny by default', async () => {
    results['role_permissions'] = { data: null, error: null }
    const res = mockRes()
    await requirePermission('fees', 'view')(reqAs('teacher'), res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('500s on a database error rather than silently allowing', async () => {
    results['role_permissions'] = { data: null, error: { message: 'db down' } }
    const res = mockRes()
    await requirePermission('fees', 'view')(reqAs('teacher'), res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it.each(['view', 'create', 'edit', 'delete'] as const)('maps the %s action to its column', async action => {
    const cols = { view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete' }
    results['role_permissions'] = { data: { [cols[action]]: true }, error: null }
    const next = vi.fn()
    await requirePermission('fees', action)(reqAs('accountant'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })
})

describe('getPermissionsForRole', () => {
  it('returns everything enabled for full-access roles', async () => {
    const map = await getPermissionsForRole('s1', 'school_admin')
    expect(Object.values(map).every((m: any) => m.can_view && m.can_delete)).toBe(true)
  })

  it('fills unknown modules with all-false rather than omitting them', async () => {
    results['role_permissions'] = { data: [{ module: 'fees', can_view: true, can_create: false, can_edit: false, can_delete: false }], error: null }
    const map = await getPermissionsForRole('s1', 'accountant')
    expect(map.fees.can_view).toBe(true)
    expect(map.students).toEqual({ can_view: false, can_create: false, can_edit: false, can_delete: false })
  })

  it('returns an all-false map when the role has no rows', async () => {
    results['role_permissions'] = { data: [], error: null }
    const map = await getPermissionsForRole('s1', 'teacher')
    expect(Object.values(map).every((m: any) => m.can_view === false)).toBe(true)
  })
})

describe('getPermissionsForUser (RBAC v2)', () => {
  it('returns an empty set when the user has no roles', async () => {
    results['user_roles'] = { data: [], error: null }
    const r = await getPermissionsForUser('u1', 's1')
    expect(r.permissionCodes.size).toBe(0)
    expect(r.isSuperRole).toBe(false)
  })

  it('returns an empty set when the roles query errors', async () => {
    results['user_roles'] = { data: null, error: { message: 'boom' } }
    expect((await getPermissionsForUser('u1', 's1')).roleIds).toEqual([])
  })

  it('flags School Admin as a super role', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'School Admin' } }], error: null }
    results['role_permissions_v2'] = { data: [{ permissions: { permission_code: 'fee.view' } }], error: null }
    const r = await getPermissionsForUser('u1', 's1')
    expect(r.isSuperRole).toBe(true)
    expect(r.roleNames).toContain('School Admin')
  })

  it('aggregates codes across several roles', async () => {
    results['user_roles'] = {
      data: [
        { role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } },
        { role_id: 'r2', roles: { id: 'r2', name: 'Class Teacher' } },
      ], error: null,
    }
    // Duplicate rows across roles must still collapse to a unique code set.
    results['role_permissions_v2'] = { data: [
      { permissions: { permission_code: 'student.view' } },
      { permissions: { permission_code: 'exam.marks_entry' } },
      { permissions: { permission_code: 'student.view' } },
    ], error: null }
    const r = await getPermissionsForUser('u1', 's1')
    expect(r.roleIds).toEqual(['r1', 'r2'])
    expect([...r.permissionCodes].sort()).toEqual(['exam.marks_entry', 'student.view'])
  })

  it('skips a user_roles row whose role join came back empty', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: null }], error: null }
    const r = await getPermissionsForUser('u1', 's1')
    expect(r.roleIds).toEqual([])
    expect(r.permissionCodes.size).toBe(0)
  })

  it('returns no codes when the role has no permission mappings', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } }], error: null }
    results['role_permissions_v2'] = { data: [], error: null }
    expect((await getPermissionsForUser('u1', 's1')).permissionCodes.size).toBe(0)
  })

  it('returns no codes when resolving permission ids fails', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } }], error: null }
    results['role_permissions_v2'] = { data: null, error: { message: 'boom' } }
    expect((await getPermissionsForUser('u1', 's1')).permissionCodes.size).toBe(0)
  })
})

describe('requirePermissionV2', () => {
  const teacherWith = (codes: string[]) => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } }], error: null }
    results['role_permissions_v2'] = { data: codes.map(c => ({ permissions: { permission_code: c } })), error: null }
  }

  it('allows a user holding the code', async () => {
    teacherWith(['fee.collect'])
    const next = vi.fn()
    await requirePermissionV2('fee.collect')(reqAs('teacher'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })

  it('403s a user missing the code, naming it', async () => {
    teacherWith(['student.view'])
    const res = mockRes()
    await requirePermissionV2('fee.collect')(reqAs('teacher'), res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing permission: fee.collect' }))
  })

  it('lets School Admin through even with an incomplete mapping — no accidental lockout', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'School Admin' } }], error: null }
    results['role_permissions_v2'] = { data: [], error: null }
    const next = vi.fn()
    await requirePermissionV2('anything.at.all')(reqAs('school_admin'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })
})

describe('requireAnyPermissionV2', () => {
  it('allows when the user holds any one of the codes', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } }], error: null }
    results['role_permissions_v2'] = { data: [{ permissions: { permission_code: 'exam.view' } }], error: null }
    const next = vi.fn()
    await requireAnyPermissionV2('fee.collect', 'exam.view')(reqAs('teacher'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })

  it('403s listing all acceptable codes when the user holds none', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Teacher' } }], error: null }
    results['role_permissions_v2'] = { data: [], error: null }
    const res = mockRes()
    await requireAnyPermissionV2('fee.collect', 'exam.view')(reqAs('teacher'), res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing one of: fee.collect, exam.view' }))
  })

  it('lets a super role through regardless', async () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'School Admin' } }], error: null }
    results['role_permissions_v2'] = { data: [], error: null }
    const next = vi.fn()
    await requireAnyPermissionV2('a', 'b')(reqAs('school_admin'), mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })
})

// The permission cache removes ~735ms (three sequential queries) from every
// permission-gated route and every page load. These pin the trade-off.
describe('permission cache', () => {
  const withRole = () => {
    results['user_roles'] = { data: [{ role_id: 'r1', roles: { id: 'r1', name: 'Accountant' } }], error: null }
    results['role_permissions_v2'] = { data: [{ permissions: { permission_code: 'fee.view' } }], error: null }
  }

  it('resolves once, then serves the cached set', async () => {
    withRole()
    const a = await getPermissionsForUser('u1', 's1')
    // Data yanked out from under it — a second resolve would now come back empty.
    results['user_roles'] = { data: [], error: null }
    const b = await getPermissionsForUser('u1', 's1')
    expect(a.permissionCodes.has('fee.view')).toBe(true)
    expect(b.permissionCodes.has('fee.view')).toBe(true)
  })

  it('re-resolves after invalidation, so a revoked permission actually goes away', async () => {
    withRole()
    expect((await getPermissionsForUser('u1', 's1')).permissionCodes.has('fee.view')).toBe(true)

    results['role_permissions_v2'] = { data: [], error: null }
    invalidatePermissionsForUser('u1', 's1')

    expect((await getPermissionsForUser('u1', 's1')).permissionCodes.has('fee.view')).toBe(false)
  })

  it('caches per user and school, not globally', async () => {
    withRole()
    await getPermissionsForUser('u1', 's1')

    results['role_permissions_v2'] = { data: [{ permissions: { permission_code: 'exam.view' } }], error: null }
    const other = await getPermissionsForUser('u2', 's1')
    expect(other.permissionCodes.has('exam.view')).toBe(true)
    expect(other.permissionCodes.has('fee.view')).toBe(false)
  })
})
