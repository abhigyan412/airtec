import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { authenticate, AuthRequest } from '../../shared/middleware/auth'
import { asyncHandler, defaultSectionNamesForClass } from '../../shared/utils/helpers'
import { assignDefaultUserRole } from '../rbac/seed'

const router = Router()

const RegisterSchoolSchema = z.object({
  // School info
  school_name: z.string().min(2),
  school_city: z.string().optional(),
  school_state: z.string().optional(),
  school_phone: z.string().optional(),
  affiliation_board: z.string().optional(),
  // Admin user
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// ── POST /auth/register-school ──────────────────────────────
// Onboards a new school + creates school_admin user
router.post('/register-school', asyncHandler(async (req: Request, res: Response) => {
  const body = RegisterSchoolSchema.parse(req.body)

  // 1. Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  })
  if (authError) return res.status(400).json({ success: false, error: authError.message })

  // 2. Create school record
  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .insert({
      name: body.school_name,
      city: body.school_city,
      state: body.school_state,
      phone: body.school_phone,
      affiliation_board: body.affiliation_board,
    })
    .select()
    .single()

  if (schoolError) {
    await supabase.auth.admin.deleteUser(authData.user.id)
    return res.status(400).json({ success: false, error: schoolError.message })
  }

  // 3. Create user profile
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      id: authData.user.id,
      school_id: school.id,
      full_name: body.full_name,
      email: body.email,
      role: 'school_admin',
    })
    .select()
    .single()

  if (userError) {
    return res.status(400).json({ success: false, error: userError.message })
  }

  // 4. Seed default data for the school
  await seedDefaultData(school.id)

  // 5. Seed default RBAC roles for the school and assign the admin their role
  await assignDefaultUserRole(user.id, school.id, 'school_admin')

  res.status(201).json({
    success: true,
    data: {
      school,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
      message: 'School registered successfully. Please login to continue.',
    },
  })
}))

// ── POST /auth/login ─────────────────────────────────────────
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = LoginSchema.parse(req.body)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ success: false, error: 'Invalid email or password' })

  // Get user profile
  // Get user profile
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, full_name, email, role, school_id, is_active, schools(id, name, logo_url)')
    .eq('id', data.user.id)
    .single()

  if (profileErr || !profile) {
    return res.status(403).json({ success: false, error: `Profile error: ${profileErr?.message ?? 'not found'}` })
  }

  if (!profile.is_active) {
    return res.status(403).json({ success: false, error: 'Account is deactivated' })
  }
  res.json({
    success: true,
    data: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: profile,
    },
  })
}))

// ── POST /auth/refresh ───────────────────────────────────────
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { refresh_token } = req.body
  if (!refresh_token) return res.status(400).json({ success: false, error: 'refresh_token required' })

  const { data, error } = await supabase.auth.refreshSession({ refresh_token })
  if (error) return res.status(401).json({ success: false, error: 'Invalid refresh token' })

  res.json({
    success: true,
    data: {
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
      expires_in: data.session!.expires_in,
    },
  })
}))

// ── GET /auth/me ─────────────────────────────────────────────
router.get('/me', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select('*, schools(id, name, logo_url, affiliation_board, city, state)')
    .eq('id', req.user!.id)
    .single()

  if (error) return res.status(404).json({ success: false, error: 'Profile not found' })

  res.json({ success: true, data })
}))

// ── POST /auth/invite-user ───────────────────────────────────
router.post('/invite-user', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { full_name, email, role, password } = req.body

  const validRoles = ['principal', 'teacher', 'accountant', 'counselor']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role for invitation' })
  }
  if (!['school_admin', 'principal'].includes(req.user!.role)) {
    return res.status(403).json({ success: false, error: 'Not authorized to invite users' })
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: password || Math.random().toString(36).slice(-10),
    email_confirm: true,
  })
  if (authError) return res.status(400).json({ success: false, error: authError.message })

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      id: authData.user.id,
      school_id: req.user!.school_id,
      full_name,
      email,
      role,
    })
    .select()
    .single()

  if (error) return res.status(400).json({ success: false, error: error.message })

  await assignDefaultUserRole(user.id, req.user!.school_id, role)

  res.status(201).json({ success: true, data: user })
}))

// ── Seed default data for new school ────────────────────────
async function seedDefaultData(schoolId: string) {
  // Default academic year
  const currentYear = new Date().getFullYear()
  const { data: academicYear } = await supabase
    .from('academic_years')
    .insert({
      school_id: schoolId,
      name: `${currentYear}-${String(currentYear + 1).slice(-2)}`,
      start_date: `${currentYear}-04-01`,
      end_date: `${currentYear + 1}-03-31`,
      is_current: true,
    })
    .select()
    .single()

  // Default classes 1-12, each with default sections (streams for 11 & 12)
  const classRows = Array.from({ length: 12 }, (_, i) => ({
    school_id: schoolId,
    name: `Class ${i + 1}`,
    numeric_level: i + 1,
  }))
  const { data: classes } = await supabase.from('classes').insert(classRows).select()

  const sectionRows = (classes ?? []).flatMap(c =>
    defaultSectionNamesForClass(c.numeric_level).map(name => ({
      school_id: schoolId, class_id: c.id, name, max_strength: 40,
    }))
  )
  if (sectionRows.length) await supabase.from('sections').insert(sectionRows)

  // Default houses
  await supabase.from('houses').insert([
    { school_id: schoolId, name: 'Red House', color: '#EF4444' },
    { school_id: schoolId, name: 'Blue House', color: '#3B82F6' },
    { school_id: schoolId, name: 'Green House', color: '#22C55E' },
    { school_id: schoolId, name: 'Yellow House', color: '#EAB308' },
  ])

  // Default subjects (school-wide — class_id null) — a starting point;
  // admins add/remove their own from Settings -> Classes & Sections.
  await supabase.from('subjects').insert([
    'Mathematics', 'English', 'Science', 'Hindi', 'Social Studies', 'Computer',
    'Art', 'Physical Education', 'Sanskrit', 'Moral Science', 'General Knowledge',
  ].map(name => ({ school_id: schoolId, name })))

  // Default fee heads
  await supabase.from('fee_heads').insert([
    { school_id: schoolId, name: 'Tuition Fee', description: 'Monthly tuition charges' },
    { school_id: schoolId, name: 'Exam Fee', description: 'Examination charges' },
    { school_id: schoolId, name: 'Annual Fund', description: 'Annual development charges' },
    { school_id: schoolId, name: 'Computer Fee', description: 'Computer lab charges' },
  ])

  // Default inquiry sources
  await supabase.from('inquiry_sources').insert([
    { school_id: schoolId, name: 'Walk-in' },
    { school_id: schoolId, name: 'Website' },
    { school_id: schoolId, name: 'Facebook / Social Media' },
    { school_id: schoolId, name: 'Referral' },
    { school_id: schoolId, name: 'Event' },
  ])
}

export default router
