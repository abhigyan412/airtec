import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler } from '../../shared/utils/helpers'
import { getPermissionsForUser, invalidateAllPermissions, requirePermissionV2 } from '../../shared/middleware/permissions-v2'

const router = Router()
router.use(authenticate)

// ═══════════════════════════════════════════════════════════════
// GET /api/rbac/permissions/me
// New multi-role permission endpoint (Phase 3c)
// ═══════════════════════════════════════════════════════════════
router.get('/permissions/me', asyncHandler(async (req: AuthRequest, res: Response) => {
  const [{ permissionCodes, roleNames, roleIds, isSuperRole }, { data: school }] = await Promise.all([
    getPermissionsForUser(req.user!.id, req.user!.school_id),
    supabase.from('schools').select('enabled_modules').eq('id', req.user!.school_id).maybeSingle(),
  ])

  res.json({
    success: true,
    data: {
      roles: roleNames,
      role_ids: roleIds,
      is_super_role: isSuperRole,
      permissions: Array.from(permissionCodes),
      // Which modules this school bought. Null means all of them, which
      // is every school that predates the column. This shapes what the
      // sidebar OFFERS; what a user is ALLOWED to do is still decided
      // per-route by requirePermissionV2, and deliberately so — a client
      // that ignored this would gain nothing.
      enabled_modules: school?.enabled_modules ?? null,
    },
  })
}))

// ═══════════════════════════════════════════════════════════════
// ROLES — list / view
// ═══════════════════════════════════════════════════════════════
router.get('/roles', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('roles')
    .select('id, name, description, is_system_role, created_at')
    .eq('school_id', req.user!.school_id)
    .order('name')

  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// GET /api/rbac/roles/:id/permissions — permission codes assigned to a role
router.get('/roles/:id/permissions', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const school_id = req.user!.school_id

  // verify role belongs to this school
  const { data: role } = await supabase.from('roles').select('id, name').eq('id', id).eq('school_id', school_id).maybeSingle()
  if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

  const { data, error } = await supabase
    .from('role_permissions_v2')
    .select('permission_id, permissions ( permission_code, module, action, description )')
    .eq('role_id', id)

  if (error) return res.status(500).json({ success: false, error: error.message })

  res.json({
    success: true,
    data: {
      role,
      permissions: (data ?? []).map((r: any) => r.permissions),
    },
  })
}))

// ═══════════════════════════════════════════════════════════════
// PUT /api/rbac/roles/:id/permissions
// Body: { permission_codes: string[] } — full replacement set
//
// Replaces ALL role_permissions_v2 rows for this role with the
// given permission codes. Admin/Principal only.
// ═══════════════════════════════════════════════════════════════
router.put('/roles/:id/permissions', requirePermissionV2('role.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { permission_codes } = req.body
    const school_id = req.user!.school_id

    if (!Array.isArray(permission_codes)) {
      return res.status(400).json({ success: false, error: 'permission_codes must be an array' })
    }

    // Verify role belongs to this school
    const { data: role } = await supabase.from('roles').select('id, name, is_system_role').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

    // Resolve permission codes -> permission ids
    const { data: perms, error: permErr } = await supabase
      .from('permissions')
      .select('id, permission_code')
      .in('permission_code', permission_codes)

    if (permErr) return res.status(500).json({ success: false, error: permErr.message })

    const foundCodes = new Set((perms ?? []).map(p => p.permission_code))
    const invalidCodes = permission_codes.filter((c: string) => !foundCodes.has(c))
    if (invalidCodes.length > 0) {
      return res.status(400).json({ success: false, error: `Unknown permission codes: ${invalidCodes.join(', ')}` })
    }

    // Replace: delete existing mappings for this role, insert new set
    const { error: delErr } = await supabase.from('role_permissions_v2').delete().eq('role_id', id)
    if (delErr) return res.status(500).json({ success: false, error: delErr.message })

    if (perms && perms.length > 0) {
      const rows = perms.map(p => ({ role_id: id, permission_id: p.id }))
      const { error: insErr } = await supabase.from('role_permissions_v2').insert(rows)
      if (insErr) return res.status(500).json({ success: false, error: insErr.message })
    }

    // This role's permissions just changed, which affects every user holding
    // it. Finding them costs more than simply re-resolving on next request.
    invalidateAllPermissions()

    res.json({ success: true, data: { role, permission_count: perms?.length ?? 0 } })
  })
)

// ═══════════════════════════════════════════════════════════════
// POST /api/rbac/roles
// Body: { name: string, clone_from_role_id?: string }
//
// Custom role creation, "duplicate + tweak": always starts from a
// blank permission set unless clone_from_role_id is given, in which
// case the new role's role_permissions_v2 rows are copied from the
// source role so the admin can tweak from there instead of from zero.
// ═══════════════════════════════════════════════════════════════
const CreateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  clone_from_role_id: z.string().uuid().optional(),
})

router.post('/roles', requirePermissionV2('role.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = CreateRoleSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    }
    const { name, clone_from_role_id } = parsed.data
    const school_id = req.user!.school_id

    const { data: existing } = await supabase
      .from('roles')
      .select('id')
      .eq('school_id', school_id)
      .ilike('name', name)
      .maybeSingle()
    if (existing) {
      return res.status(400).json({ success: false, error: `A role named "${name}" already exists.` })
    }

    let sourcePermissionIds: string[] = []
    if (clone_from_role_id) {
      const { data: sourceRole } = await supabase
        .from('roles')
        .select('id')
        .eq('id', clone_from_role_id)
        .eq('school_id', school_id)
        .maybeSingle()
      if (!sourceRole) {
        return res.status(404).json({ success: false, error: 'Role to duplicate from was not found.' })
      }
      const { data: sourcePerms, error: sourcePermsErr } = await supabase
        .from('role_permissions_v2')
        .select('permission_id')
        .eq('role_id', clone_from_role_id)
      if (sourcePermsErr) return res.status(500).json({ success: false, error: sourcePermsErr.message })
      sourcePermissionIds = (sourcePerms ?? []).map(p => p.permission_id)
    }

    const { data: newRole, error: insErr } = await supabase
      .from('roles')
      .insert({ school_id, name, is_system_role: false })
      .select('id, name, description, is_system_role, created_at')
      .single()
    if (insErr) return res.status(500).json({ success: false, error: insErr.message })

    if (sourcePermissionIds.length > 0) {
      const rows = sourcePermissionIds.map(permission_id => ({ role_id: newRole.id, permission_id }))
      const { error: cloneErr } = await supabase.from('role_permissions_v2').insert(rows)
      if (cloneErr) return res.status(500).json({ success: false, error: cloneErr.message })
    }

    res.json({ success: true, data: { role: newRole, permission_count: sourcePermissionIds.length } })
  })
)

// ═══════════════════════════════════════════════════════════════
// DELETE /api/rbac/roles/:id
//
// Blocked for system roles, and blocked whenever anything still
// depends on this role — user_roles.role_id and workflow_steps.role_id
// both cascade-delete on roles.id, and users.primary_role_id would
// silently go null, so an unguarded delete would either wipe a live
// approval chain or quietly unassign staff. Precise, count-based
// refusal instead, so the admin knows exactly what to unwind first.
// ═══════════════════════════════════════════════════════════════
router.delete('/roles/:id', requirePermissionV2('role.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    const { data: role } = await supabase.from('roles').select('id, name, is_system_role').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' })
    if (role.is_system_role) {
      return res.status(400).json({ success: false, error: 'System roles cannot be deleted.' })
    }

    const [{ count: userRoleCount }, { count: workflowStepCount }, { count: primaryCount }] = await Promise.all([
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role_id', id),
      supabase.from('workflow_steps').select('id', { count: 'exact', head: true }).eq('role_id', id),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('primary_role_id', id),
    ])

    const blockers: string[] = []
    if (userRoleCount) blockers.push(`${userRoleCount} user${userRoleCount === 1 ? '' : 's'} assigned to it`)
    if (primaryCount) blockers.push(`${primaryCount} user${primaryCount === 1 ? '' : 's'} with it as their primary role`)
    if (workflowStepCount) blockers.push(`${workflowStepCount} approval workflow step${workflowStepCount === 1 ? '' : 's'} referencing it`)

    if (blockers.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete "${role.name}" — it still has ${blockers.join(' and ')}. Reassign these first.`,
      })
    }

    const { error: delErr } = await supabase.from('roles').delete().eq('id', id)
    if (delErr) return res.status(500).json({ success: false, error: delErr.message })

    res.json({ success: true, data: { id } })
  })
)

// GET /api/rbac/permissions — full master registry (for building role-edit UI)
router.get('/permissions', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('permissions')
    .select('id, module, action, permission_code, description')
    .order('module')
    .order('action')

  if (error) return res.status(500).json({ success: false, error: error.message })
  res.json({ success: true, data })
}))

// ═══════════════════════════════════════════════════════════════
// USER ROLES — view a user's assigned roles (multi-role)
// ═══════════════════════════════════════════════════════════════
router.get('/users/:user_id/roles', requirePermissionV2('role.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id

    const { data, error } = await supabase
      .from('user_roles')
      .select('id, role_id, assigned_at, stipend_amount, roles ( id, name, description, is_system_role )')
      .eq('user_id', user_id)
      .eq('school_id', school_id)

    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

export default router