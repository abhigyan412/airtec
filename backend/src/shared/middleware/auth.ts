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

// Same as authenticate, but also accepts the token via ?token= query
// param, not just the Authorization header. For printable documents
// (ID cards, report cards, certificates, admit cards) opened via a plain
// `<a href target="_blank">` — the browser can't attach a custom header
// to that navigation, so the frontend passes the token in the URL
// instead. Query-param tokens are inherently a bit more exposed (browser
// history, server access logs, Referer headers) than an Authorization
// header, which is the tradeoff for supporting plain-link "open in new
// tab" downloads; every route using this should be a read-only,
// low-sensitivity document view, not anything that mutates data.
export const authenticateFlexible = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null
  const headerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  const token = queryToken || headerToken

  if (!token) {
    return res.status(401).send('<h2>Unauthorized</h2>')
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return res.status(401).send('<h2>Unauthorized — invalid or expired link</h2>')

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, full_name, email, school_id, role, is_active')
      .eq('id', user.id)
      .single()
    if (profileError || !profile) return res.status(401).send('<h2>Unauthorized</h2>')
    if (!profile.is_active) return res.status(403).send('<h2>Account is deactivated</h2>')

    req.user = {
      id: profile.id,
      email: profile.email,
      school_id: profile.school_id,
      role: profile.role,
      full_name: profile.full_name,
    }
    next()
  } catch {
    return res.status(500).send('<h2>Authentication failed</h2>')
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
