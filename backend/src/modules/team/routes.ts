import { Router, Response } from 'express'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../shared/db/client'
import { authenticate, requireRole, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler } from '../../shared/utils/helpers'
import { assignDefaultUserRole, setPrimaryUserRole, LEGACY_ROLE_TO_RBAC_ROLE } from '../rbac/seed'

const router = Router()
router.use(authenticate)

// Admin client - uses service role key, can create auth users
// Make sure SUPABASE_SERVICE_ROLE_KEY is set in backend/.env
import WebSocket from 'ws'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as any },
  }
)

const VALID_ROLES = ['school_admin', 'principal', 'teacher', 'accountant', 'counselor'] as const

const InviteSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(VALID_ROLES),
  phone: z.string().optional(),
  password: z.string().min(6),
  // optional staff profile fields
  designation: z.string().optional(),
  department: z.string().optional(),
})

// ── GET /team - list all staff with auth status ─────────────
router.get('/', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id

    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, phone, is_active, created_at')
      .eq('school_id', school_id)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ success: false, error: error.message })

    // Check which users have a matching auth account
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const authIds = new Set((authUsers?.users ?? []).map(u => u.id))

    const result = (users ?? []).map(u => ({
      ...u,
      has_login: authIds.has(u.id),
    }))

    res.json({ success: true, data: result })
  })
)

// ── POST /team/invite - create staff member with login ──────
router.post('/invite', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = InviteSchema.parse(req.body)
    const school_id = req.user!.school_id

    // Check if email already exists in this school
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', body.email).eq('school_id', school_id).maybeSingle()

    if (existing) {
      return res.status(400).json({ success: false, error: 'A user with this email already exists in your school' })
    }

    // 1. Create the Supabase Auth account
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true, // auto-confirm so they can log in immediately
    })

    if (authError || !authUser?.user) {
      return res.status(400).json({ success: false, error: authError?.message ?? 'Failed to create auth account' })
    }

    // 2. Create the users row with the SAME id as the auth account
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        id: authUser.user.id,
        school_id,
        full_name: body.full_name,
        email: body.email,
        phone: body.phone || null,
        role: body.role,
        is_active: true,
      })
      .select()
      .single()

    if (userError) {
      // rollback auth user if users-row insert fails
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      return res.status(400).json({ success: false, error: userError.message })
    }

    // 3. Optionally create a staff_profiles row (for non-admin roles)
    if (body.role !== 'school_admin' && (body.designation || body.department)) {
      await supabase.from('staff_profiles').insert({
        school_id,
        user_id: newUser.id,
        designation: body.designation || null,
        department: body.department || null,
        employment_type: 'full_time',
        employment_status: 'active',
        date_of_joining: new Date().toISOString().split('T')[0],
        phone: body.phone || null,
      })
    }

    // 4. Seed default RBAC roles for the school (if missing) and assign
    //    this user their primary role — this is what drives sidebar/page
    //    visibility (see usePermissions.ts). Without this the user gets
    //    zero permissions and only sees the null-gated nav items.
    await assignDefaultUserRole(newUser.id, school_id, body.role)

    res.status(201).json({
      success: true,
      data: { ...newUser, has_login: true },
      message: `Account created. Share these credentials: ${body.email} / ${body.password}`,
    })
  })
)

// ── POST /team/:id/reset-login - create/reset auth for existing users-row ──
// Useful for the 5 seeded staff that have no auth account yet.
router.post('/:id/reset-login', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { password } = req.body
    const school_id = req.user!.school_id

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' })
    }

    const { data: user, error } = await supabase
      .from('users').select('*').eq('id', id).eq('school_id', school_id).single()

    if (error || !user) return res.status(404).json({ success: false, error: 'User not found' })

    // Check if an auth user already exists with this id
    const { data: existingAuth } = await supabaseAdmin.auth.admin.getUserById(id)

    if (existingAuth?.user) {
      // Update password on existing auth account
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
      if (updateErr) return res.status(400).json({ success: false, error: updateErr.message })
      return res.json({ success: true, message: `Password reset for ${user.email}`, data: { email: user.email, password } })
    }

    // No auth account exists for this id - create one.
    // Supabase Admin API doesn't let us choose the auth user's id directly,
    // so we create a new auth user then update the users-row id to match it.
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
    })

    if (authError || !authUser?.user) {
      return res.status(400).json({ success: false, error: authError?.message ?? 'Failed to create auth account' })
    }

    // Update users row (and dependent rows) to use the new auth id
    const oldId = user.id
    const newId = authUser.user.id

    const { error: updateErr } = await supabase
      .from('users')
      .update({ id: newId })
      .eq('id', oldId)

    if (updateErr) {
      await supabaseAdmin.auth.admin.deleteUser(newId)
      return res.status(400).json({ success: false, error: `Failed to relink user: ${updateErr.message}` })
    }

    // Update staff_profiles.user_id to match (FK reference)
    await supabase.from('staff_profiles').update({ user_id: newId }).eq('user_id', oldId)
    // Relink any RBAC role assignments so the user doesn't lose access
    await supabase.from('user_roles').update({ user_id: newId }).eq('user_id', oldId)
    // Safety net for legacy users that never had a primary role assigned
    await assignDefaultUserRole(newId, school_id, user.role)

    res.json({
      success: true,
      message: `Login created for ${user.email}`,
      data: { email: user.email, password, new_id: newId },
    })
  })
)

// ── PATCH /team/:id - update role / active status ────────────
router.patch('/:id', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { role, is_active, full_name, phone } = req.body
    const school_id = req.user!.school_id

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' })
    }

    const update: any = {}
    if (role) update.role = role
    if (is_active !== undefined) update.is_active = is_active
    if (full_name) update.full_name = full_name
    if (phone !== undefined) update.phone = phone

    const { data: before } = await supabase.from('users').select('role').eq('id', id).eq('school_id', school_id).maybeSingle()

    const { data, error } = await supabase
      .from('users').update(update).eq('id', id).eq('school_id', school_id).select().single()

    if (error) return res.status(400).json({ success: false, error: error.message })

    // Keep the RBAC primary role in sync with the legacy role field —
    // otherwise sidebar/page permissions silently stay on the old role.
    if (role && before?.role && role !== before.role) {
      await setPrimaryUserRole(id, school_id, role, before.role)
    }

    res.json({ success: true, data })
  })
)

// ── DELETE /team/:id - deactivate (soft delete) ──────────────
router.delete('/:id', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id

    if (id === req.user!.id) {
      return res.status(400).json({ success: false, error: 'You cannot deactivate your own account' })
    }

    const { error } = await supabase
      .from('users').update({ is_active: false }).eq('id', id).eq('school_id', school_id)

    if (error) return res.status(400).json({ success: false, error: error.message })
    res.json({ success: true, message: 'Staff member deactivated' })
  })
)

// ═══════════════════════════════════════════════════════════════
// MULTI-ROLE SUPPORT (RBAC v2)
// ═══════════════════════════════════════════════════════════════
//
// users.role remains the single "primary" legacy role (drives the
// dropdown above and most of the app's old role checks). The
// endpoints below manage ADDITIONAL roles via user_roles/roles
// (role_permissions_v2 system) — e.g. giving a Teacher the extra
// "Exam Controller" role so they can act on workflow steps that
// require it, without changing their primary role.

// Primary-role name lookup is the same mapping assignDefaultUserRole()
// uses to seed/assign roles — imported as LEGACY_ROLE_TO_RBAC_ROLE so
// the two never drift out of sync.
const LEGACY_ROLE_TO_NEW_NAME = LEGACY_ROLE_TO_RBAC_ROLE

// ── GET /team/extra-roles - map of user_id -> additional role names ──
router.get('/extra-roles', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id

    const { data: users } = await supabase
      .from('users')
      .select('id, role')
      .eq('school_id', school_id)

    const { data: userRoles, error } = await supabase
      .from('user_roles')
      .select('user_id, roles ( name )')
      .eq('school_id', school_id)

    if (error) return res.status(500).json({ success: false, error: error.message })

    const legacyByUser = new Map((users ?? []).map(u => [u.id, u.role]))

    const result: Record<string, string[]> = {}
    for (const row of (userRoles ?? []) as any[]) {
      const roleName = row.roles?.name
      if (!roleName) continue
      const legacyRole = legacyByUser.get(row.user_id)
      const primaryName = legacyRole ? LEGACY_ROLE_TO_NEW_NAME[legacyRole] : undefined
      if (roleName === primaryName) continue // skip the role matching their primary
      if (!result[row.user_id]) result[row.user_id] = []
      result[row.user_id].push(roleName)
    }

    res.json({ success: true, data: result })
  })
)

// ── POST /team/:id/roles - assign an additional role ──────────
router.post('/:id/roles', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const { role_id } = req.body
    const school_id = req.user!.school_id

    if (!role_id) return res.status(400).json({ success: false, error: 'role_id required' })

    const { data: targetUser } = await supabase.from('users').select('id, school_id').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' })

    const { data: role } = await supabase.from('roles').select('id, name').eq('id', role_id).eq('school_id', school_id).maybeSingle()
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

    const { data, error } = await supabase
      .from('user_roles')
      .insert({ user_id: id, role_id, school_id, assigned_at: new Date().toISOString() })
      .select('id, role_id, roles(name)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: `User already has the ${role.name} role` })
      }
      return res.status(400).json({ success: false, error: error.message })
    }

    res.status(201).json({ success: true, data })
  })
)

// ── DELETE /team/:id/roles/:roleId - remove an additional role ────
router.delete('/:id/roles/:roleId', requireRole('school_admin', 'principal'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id, roleId } = req.params
    const school_id = req.user!.school_id

    const { data: targetUser } = await supabase.from('users').select('id, role').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' })

    const { data: role } = await supabase.from('roles').select('id, name').eq('id', roleId).eq('school_id', school_id).maybeSingle()
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

    // Prevent removing the user's PRIMARY role (matching their legacy
    // users.role) — they'd lose all default sidebar access.
    const primaryRoleName = LEGACY_ROLE_TO_NEW_NAME[targetUser.role]
    if (role.name === primaryRoleName) {
      return res.status(400).json({
        success: false,
        error: `Cannot remove ${role.name} — it's this user's primary role. Change their primary role in the table instead.`,
      })
    }

    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', id)
      .eq('role_id', roleId)
      .eq('school_id', school_id)

    if (error) return res.status(400).json({ success: false, error: error.message })

    res.json({ success: true, message: `${role.name} role removed` })
  })
)

export default router