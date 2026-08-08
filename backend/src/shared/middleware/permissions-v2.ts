import { Response, NextFunction } from 'express'
import { supabase } from '../db/client'
import { AuthRequest } from './auth'

/**
 * ═══════════════════════════════════════════════════════════════
 * New RBAC permission system (multi-role aware)
 * ═══════════════════════════════════════════════════════════════
 *
 * This sits ALONGSIDE the old role_permissions/users.role system.
 * Nothing here removes or breaks the old requirePermission(module, action).
 */

// Roles that bypass all permission checks (defense in depth — even if
// role_permissions_v2 mapping is incomplete, these never get locked out)
const SUPER_ROLES = ['School Admin']

export interface UserPermissions {
  permissionCodes: Set<string>
  roleNames: string[]
  roleIds: string[]
  isSuperRole: boolean
  // Optional per-role-assignment restriction (user_roles.department_scope).
  // null means unrestricted — either no assignment set a scope, or at
  // least one did and was unrestricted ("most permissive wins" across a
  // user's multiple role assignments). Only enforced by the specific
  // staff.view/staff.edit routes that opt into checking it; unrelated
  // routes that happen to reuse those codes for a different resource
  // (shifts, documents, leave types, ...) ignore it entirely.
  departmentScope: string | null
}

/**
 * Per-process cache of resolved permissions.
 *
 * This function runs on every `requirePermissionV2` route AND on
 * GET /rbac/permissions/me, which both frontends call on every page load. It
 * was three sequential queries (~735ms measured); it is now one round-trip
 * uncached and free once warm.
 *
 * Same trade as the profile cache in auth.ts: a role assignment or a change to
 * a role's permissions takes up to TTL to apply. Both mutation paths call
 * `invalidatePermissions*` below, so in practice it is immediate; the TTL is
 * the backstop for changes made directly in the database.
 */
const PERMISSIONS_TTL_MS = 30_000
const permCache = new Map<string, { value: UserPermissions; expires: number }>()

const permKey = (userId: string, schoolId: string) => `${userId}:${schoolId}`

/** Drop one user's cached permissions — call after changing their roles. */
export function invalidatePermissionsForUser(userId: string, schoolId: string): void {
  permCache.delete(permKey(userId, schoolId))
}

/**
 * Drop everything. Call when a ROLE's permissions change: that affects every
 * user holding it, and finding them would cost more than simply re-resolving.
 */
export function invalidateAllPermissions(): void {
  permCache.clear()
}

export async function getPermissionsForUser(
  userId: string,
  schoolId: string,
): Promise<UserPermissions> {
  const key = permKey(userId, schoolId)
  const hit = permCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const value = await resolvePermissionsForUser(userId, schoolId)
  if (permCache.size > 5000) {
    const now = Date.now()
    for (const [k, v] of permCache) if (v.expires <= now) permCache.delete(k)
  }
  permCache.set(key, { value, expires: Date.now() + PERMISSIONS_TTL_MS })
  return value
}

/**
 * Returns the set of permission_codes the user has, aggregated across
 * ALL roles assigned to them via user_roles -> role_permissions_v2 -> permissions.
 *
 * Two flat queries rather than one three-level embed
 * (roles -> role_permissions_v2 -> permissions), which did not resolve
 * correctly through the Supabase JS client. The two-level embed used in step 2
 * does work — verified it returns a permission set identical to the previous
 * three-query version.
 */
async function resolvePermissionsForUser(userId: string, schoolId: string): Promise<UserPermissions> {
  // 1. Get the user's roles
  const { data: userRoles, error: urErr } = await supabase
    .from('user_roles')
    .select('role_id, department_scope, roles ( id, name )')
    .eq('user_id', userId)
    .eq('school_id', schoolId)

  if (urErr || !userRoles || userRoles.length === 0) {
    return { permissionCodes: new Set(), roleNames: [], roleIds: [], isSuperRole: false, departmentScope: null }
  }

  const roleIds: string[] = []
  const roleNames: string[] = []
  let isSuperRole = false
  const scopes = new Set<string>()
  let hasUnrestrictedAssignment = false

  for (const row of userRoles as any[]) {
    const role = row.roles
    if (!role) continue
    roleIds.push(role.id)
    roleNames.push(role.name)
    if (SUPER_ROLES.includes(role.name)) isSuperRole = true
    if (row.department_scope) scopes.add(row.department_scope)
    else hasUnrestrictedAssignment = true
  }

  // Most-permissive-wins: any unrestricted assignment (or none set at
  // all) means unrestricted overall. If every assignment is scoped but
  // to DIFFERENT departments, that's a genuine multi-department grant
  // this single-string model can't represent precisely — fail open
  // (unrestricted) rather than silently blocking one of the granted
  // departments.
  const departmentScope = hasUnrestrictedAssignment || scopes.size !== 1 ? null : [...scopes][0]

  if (roleIds.length === 0) {
    return { permissionCodes: new Set(), roleNames, roleIds, isSuperRole, departmentScope }
  }

  // 2. Resolve those roles straight to permission codes.
  //
  // This used to be two queries: role_permissions_v2 -> permission_ids, then
  // permissions -> permission_code. They were strictly sequential (the second
  // needs the first's ids), and against a remote Supabase each round-trip is
  // ~245ms. Embedding the FK collapses them into one, since
  // role_permissions_v2.permission_id already references permissions.
  const { data: rolePerms, error: rpErr } = await supabase
    .from('role_permissions_v2')
    .select('permissions(permission_code)')
    .in('role_id', roleIds)

  if (rpErr || !rolePerms) {
    return { permissionCodes: new Set(), roleNames, roleIds, isSuperRole, departmentScope }
  }

  const permissionCodes = new Set(
    rolePerms
      .map((rp: any) => rp.permissions?.permission_code)
      .filter((c: unknown): c is string => typeof c === 'string'),
  )

  return { permissionCodes, roleNames, roleIds, isSuperRole, departmentScope }
}

/**
 * Reverse-resolves which users hold a given permission code in a school
 * — the inverse of getPermissionsForUser. Used by background jobs that
 * need "notify whoever can manage X" rather than checking one user's
 * access. Includes School Admin holders (SUPER_ROLES bypass everything).
 */
export async function getUserIdsWithPermission(schoolId: string, permissionCode: string): Promise<string[]> {
  const { data: rolesInSchool } = await supabase.from('roles').select('id, name').eq('school_id', schoolId)
  const roleIds = (rolesInSchool ?? []).map(r => r.id)
  if (!roleIds.length) return []
  const superRoleIds = (rolesInSchool ?? []).filter(r => SUPER_ROLES.includes(r.name)).map(r => r.id)

  const { data: rolePerms } = await supabase
    .from('role_permissions_v2')
    .select('role_id, permissions!inner(permission_code)')
    .in('role_id', roleIds)
    .eq('permissions.permission_code', permissionCode)

  const grantedRoleIds = new Set([...(rolePerms ?? []).map((rp: any) => rp.role_id), ...superRoleIds])
  if (!grantedRoleIds.size) return []

  const { data: userRoles } = await supabase.from('user_roles').select('user_id').eq('school_id', schoolId).in('role_id', [...grantedRoleIds])
  return [...new Set((userRoles ?? []).map(u => u.user_id))]
}

/**
 * Middleware factory for the new permission_code system.
 * Usage: router.post('/invoices', requirePermissionV2('fee.collect'), handler)
 *
 * School Admin (SUPER_ROLES) always passes, regardless of mapping —
 * this prevents accidental lockout if a school's role_permissions_v2
 * mapping is incomplete or misconfigured.
 */
export function requirePermissionV2(permissionCode: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { permissionCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, req.user!.school_id)

    if (isSuperRole || permissionCodes.has(permissionCode)) return next()

    return res.status(403).json({
      success: false,
      error: `Missing permission: ${permissionCode}`,
    })
  }
}

/**
 * Middleware factory requiring ANY of the given permission codes.
 * Useful when multiple roles can perform an action via different permissions.
 */
export function requireAnyPermissionV2(...permissionCodes: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { permissionCodes: userCodes, isSuperRole } = await getPermissionsForUser(req.user!.id, req.user!.school_id)

    if (isSuperRole) return next()
    if (permissionCodes.some(code => userCodes.has(code))) return next()

    return res.status(403).json({
      success: false,
      error: `Missing one of: ${permissionCodes.join(', ')}`,
    })
  }
}