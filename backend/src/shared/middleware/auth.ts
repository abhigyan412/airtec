import { Request, Response, NextFunction } from 'express'
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

type Profile = {
  id: string
  full_name: string
  email: string
  school_id: string
  role: string
  is_active: boolean
}

// ── Why this file changed ───────────────────────────────────────────
//
// Authentication used to cost two SERIAL network round-trips on every single
// request, before any route code ran. Measured against this project's Supabase:
//
//     supabase.auth.getUser(token)   210ms
//     select ... from users          358ms
//                                    -----
//     paid by every request          568ms
//
// That was ~67% of the 853ms median across all 60 GET routes, and it is why
// endpoints returning 35 bytes still took ~1s.
//
// Both are avoidable:
//
//   1. `getUser()` is documented as always calling the Auth server. This
//      project signs tokens ES256 (asymmetric), so `getClaims()` verifies them
//      locally with WebCrypto against the cached JWKS instead — Supabase's own
//      recommended replacement for exactly this reason. Measured here: 173ms
//      on the first call (fetching the key set), 0ms warm.
//
//      This is deliberately the library's implementation rather than
//      hand-rolled crypto: it handles signing-key rotation, the legacy HS256
//      fallback for projects still on a shared secret, and the JWKS cache
//      lifetime, none of which is worth owning locally. Verified here that it
//      rejects a tampered payload ("Invalid JWT signature") and malformed
//      tokens.
//
//   2. The user profile changes rarely, so it is cached briefly per process.
//
// Neither weakens the checks: signature, expiry, issuer and audience are still
// enforced on every request by getClaims, and is_active / profile-exists are
// still enforced here.
//
// Ref: https://supabase.com/docs/reference/javascript/auth-getclaims

/**
 * Short-lived per-process profile cache.
 *
 * TTL is the deliberate tradeoff: deactivating a user, or changing their role
 * or school, takes effect within this window rather than instantly. 30s keeps
 * that lag smaller than the 60-minute access-token lifetime already in play
 * (a revoked user's token stays valid until it expires regardless), while
 * removing a 358ms query from every request.
 *
 * Call `invalidateUserProfile(id)` after any write that changes a user's role,
 * school or active flag to make it immediate.
 */
const PROFILE_TTL_MS = 30_000
const profileCache = new Map<string, { profile: Profile; expires: number }>()

export function invalidateUserProfile(userId: string): void {
  profileCache.delete(userId)
}

/**
 * Drop every cached profile. Intended for tests, which reuse the same user id
 * across cases — without this, one case's profile would leak into the next and
 * quietly mask the behaviour being asserted.
 */
export function clearProfileCache(): void {
  profileCache.clear()
}

/** Cheap bound so a large tenant can't grow this without limit. */
function pruneCache(): void {
  if (profileCache.size < 5000) return
  const now = Date.now()
  for (const [k, v] of profileCache) if (v.expires <= now) profileCache.delete(k)
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const hit = profileCache.get(userId)
  if (hit && hit.expires > Date.now()) return hit.profile

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, school_id, role, is_active')
    .eq('id', userId)
    .single()

  if (error || !data) return null

  const profile = data as unknown as Profile
  pruneCache()
  profileCache.set(userId, { profile, expires: Date.now() + PROFILE_TTL_MS })
  return profile
}

/**
 * Resolve a bearer token to a user profile, or null if the token isn't valid.
 *
 * `getClaims` self-selects the right strategy: local WebCrypto verification for
 * asymmetric signing keys, a call to the Auth server for projects still on a
 * shared secret. Either way an error here is an authoritative rejection, so
 * there is nothing to retry — a second attempt would be a slow route to the
 * same answer.
 */
async function resolveUser(token: string): Promise<Profile | null> {
  let sub: string | undefined
  try {
    const { data, error } = await supabase.auth.getClaims(token)
    if (error) return null
    sub = data?.claims?.sub
  } catch {
    // getClaims THROWS (rather than returning an error) on a token it cannot
    // even parse — e.g. "abc.def.ghi". Letting that escape turned a malformed
    // token into a 500; it is a rejected credential, so it must be a 401.
    return null
  }
  if (typeof sub !== 'string' || !sub) return null

  return loadProfile(sub)
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing authorization header' })
  }

  try {
    const profile = await resolveUser(authHeader.slice(7))
    if (!profile) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
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
  } catch {
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
    const profile = await resolveUser(token)
    if (!profile) return res.status(401).send('<h2>Unauthorized — invalid or expired link</h2>')
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
