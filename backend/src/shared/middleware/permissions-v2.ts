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

/**
 * Returns the set of permission_codes the user has, aggregated across
 * ALL roles assigned to them via user_roles -> role_permissions_v2 -> permissions.
 *
 * Implemented as separate, flat queries (rather than one deeply nested
 * PostgREST embed) for reliability — nested embeds 3 levels deep
 * (roles -> role_permissions_v2 -> permissions) were not resolving
 * correctly via the Supabase JS client.
 */
export async function getPermissionsForUser(userId: string, schoolId: string): Promise<{
  permissionCodes: Set<string>
  roleNames: string[]
  roleIds: string[]
  isSuperRole: boolean
}> {
  // 1. Get the user's roles
  const { data: userRoles, error: urErr } = await supabase
    .from('user_roles')
    .select('role_id, roles ( id, name )')
    .eq('user_id', userId)
    .eq('school_id', schoolId)

  if (urErr || !userRoles || userRoles.length === 0) {
    return { permissionCodes: new Set(), roleNames: [], roleIds: [], isSuperRole: false }
  }

  const roleIds: string[] = []
  const roleNames: string[] = []
  let isSuperRole = false

  for (const row of userRoles as any[]) {
    const role = row.roles
    if (!role) continue
    roleIds.push(role.id)
    roleNames.push(role.name)
    if (SUPER_ROLES.includes(role.name)) isSuperRole = true
  }

  if (roleIds.length === 0) {
    return { permissionCodes: new Set(), roleNames, roleIds, isSuperRole }
  }

  // 2. Get all permission_ids mapped to these roles
  const { data: rolePerms, error: rpErr } = await supabase
    .from('role_permissions_v2')
    .select('permission_id')
    .in('role_id', roleIds)

  if (rpErr || !rolePerms || rolePerms.length === 0) {
    return { permissionCodes: new Set(), roleNames, roleIds, isSuperRole }
  }

  const permissionIds = Array.from(new Set(rolePerms.map((rp: any) => rp.permission_id)))

  // 3. Resolve permission_ids -> permission_codes
  const { data: perms, error: permErr } = await supabase
    .from('permissions')
    .select('permission_code')
    .in('id', permissionIds)

  if (permErr || !perms) {
    return { permissionCodes: new Set(), roleNames, roleIds, isSuperRole }
  }

  const permissionCodes = new Set(perms.map((p: any) => p.permission_code))

  return { permissionCodes, roleNames, roleIds, isSuperRole }
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