import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler } from '../../shared/utils/helpers'
import { getPermissionsForUser } from '../../shared/middleware/permissions-v2'

const router = Router()
router.use(authenticate)

// ═══════════════════════════════════════════════════════════════
// GET /api/rbac/permissions/me
// New multi-role permission endpoint (Phase 3c)
// ═══════════════════════════════════════════════════════════════
router.get('/permissions/me', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { permissionCodes, roleNames, roleIds, isSuperRole } = await getPermissionsForUser(req.user!.id, req.user!.school_id)

  res.json({
    success: true,
    data: {
      roles: roleNames,
      role_ids: roleIds,
      is_super_role: isSuperRole,
      permissions: Array.from(permissionCodes),
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
router.put('/roles/:id/permissions', requireRole('school_admin', 'principal'),
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

    res.json({ success: true, data: { role, permission_count: perms?.length ?? 0 } })
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
router.get('/users/:user_id/roles', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id } = req.params
    const school_id = req.user!.school_id

    const { data, error } = await supabase
      .from('user_roles')
      .select('id, role_id, assigned_at, roles ( id, name, description, is_system_role )')
      .eq('user_id', user_id)
      .eq('school_id', school_id)

    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

export default router