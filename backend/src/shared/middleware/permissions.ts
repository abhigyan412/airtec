import { Response, NextFunction } from 'express'
import { supabase } from '../db/client'
import { AuthRequest } from './auth'

// Roles that always have full access, regardless of role_permissions table
const FULL_ACCESS_ROLES = ['school_admin', 'principal']

type Action = 'view' | 'create' | 'edit' | 'delete'

/**
 * Middleware factory: checks if req.user's role has the given permission
 * for the given module. school_admin & principal always pass.
 *
 * Usage: router.post('/fees', requirePermission('fees', 'create'), handler)
 */
export function requirePermission(module: string, action: Action) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user!.role

    if (FULL_ACCESS_ROLES.includes(role)) return next()

    const { data, error } = await supabase
      .from('role_permissions')
      .select('can_view, can_create, can_edit, can_delete')
      .eq('school_id', req.user!.school_id)
      .eq('role', role)
      .eq('module', module)
      .maybeSingle()

    if (error) return res.status(500).json({ success: false, error: error.message })

    const fieldMap: Record<Action, string> = {
      view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete',
    }

    const allowed = data ? (data as any)[fieldMap[action]] === true : false

    if (!allowed) {
      return res.status(403).json({ success: false, error: `You don't have permission to ${action} ${module}` })
    }

    next()
  }
}

/**
 * Fetches the full permission map for a role (used by the /permissions/me endpoint).
 * Returns { [module]: { can_view, can_create, can_edit, can_delete } }
 * For school_admin/principal, returns all-true for every known module.
 */
const ALL_MODULES = ['students','admission','fees','examinations','attendance','complaints','certificates','timetable','resources','hr']

export async function getPermissionsForRole(school_id: string, role: string) {
  if (FULL_ACCESS_ROLES.includes(role)) {
    const full: Record<string, any> = {}
    for (const m of ALL_MODULES) full[m] = { can_view: true, can_create: true, can_edit: true, can_delete: true }
    return full
  }

  const { data } = await supabase
    .from('role_permissions')
    .select('module, can_view, can_create, can_edit, can_delete')
    .eq('school_id', school_id)
    .eq('role', role)

  const map: Record<string, any> = {}
  for (const m of ALL_MODULES) {
    const row = (data ?? []).find(d => d.module === m)
    map[m] = row
      ? { can_view: row.can_view, can_create: row.can_create, can_edit: row.can_edit, can_delete: row.can_delete }
      : { can_view: false, can_create: false, can_edit: false, can_delete: false }
  }
  return map
}
