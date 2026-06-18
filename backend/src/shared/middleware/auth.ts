import { Request, Response, NextFunction } from 'express'
import { createUserClient } from '../db/client'
import { supabase } from '../db/client'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    school_id: string
    role: string
    full_name: string
  }
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)

  try {
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }

    // Fetch user profile from our users table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, full_name, email, school_id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return res.status(401).json({ success: false, error: 'User profile not found' })
    }

    if (!profile.is_active) {
      return res.status(403).json({ success: false, error: 'Account is deactivated' })
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      school_id: profile.school_id,
      role: profile.role,
      full_name: profile.full_name,
    }

    next()
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Authentication failed' })
  }
}

// Role-based access control middleware factory
export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthenticated' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required roles: ${roles.join(', ')}`,
      })
    }
    next()
  }
}
