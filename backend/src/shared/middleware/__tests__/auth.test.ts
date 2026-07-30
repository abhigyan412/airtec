import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response, NextFunction } from 'express'

// The Supabase client is mocked here rather than hit for real: these are
// authorization decisions (who is let through, with what status code),
// and every branch — expired token, missing profile, deactivated account
// — is far easier to provoke with a stub than by manufacturing that
// state in a live database.
//
// The middleware verifies tokens with `auth.getClaims()`, which for this
// project's asymmetric signing keys checks the signature locally against a
// cached JWKS instead of calling the Auth server on every request. Its real
// signature/expiry/issuer/audience checks are Supabase's to test; what belongs
// here is what THIS file does with the result.
const getClaims = vi.fn()
const single = vi.fn()
vi.mock('../../db/client', () => ({
  supabase: {
    auth: { getClaims: (...a: any[]) => getClaims(...a) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
  createUserClient: vi.fn(),
}))

const { authenticate, authenticateFlexible, requireRole, clearProfileCache, invalidateUserProfile } =
  await import('../auth')

/** getClaims resolves `{ data: { claims }, error }`. */
const claimsOk = (sub = 'u1') => ({ data: { claims: { sub } }, error: null })
const claimsBad = { data: null, error: { message: 'Invalid JWT signature' } }

const mockRes = () => {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  return res
}
const PROFILE = { id: 'u1', full_name: 'Admin', email: 'a@b.c', school_id: 's1', role: 'school_admin', is_active: true }

// clearProfileCache is essential, not hygiene: every case below uses the same
// user id, so without it the first case's profile would satisfy the second and
// the deactivated/missing-profile assertions would silently pass for the wrong
// reason.
beforeEach(() => { getClaims.mockReset(); single.mockReset(); clearProfileCache() })

describe('authenticate', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: {} } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a non-Bearer scheme', async () => {
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Basic abc' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects an invalid or expired token', async () => {
    getClaims.mockResolvedValue(claimsBad)
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid or expired token' })
  })

  it('rejects a valid token with no profile row', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a deactivated account with 403, not 401', async () => {
    // The distinction matters: 401 makes the client retry auth, 403 tells
    // the user their account is disabled.
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: { ...PROFILE, is_active: false }, error: null })
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('attaches the profile and continues on success', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })
    const req: any = { headers: { authorization: 'Bearer good' } }
    const next = vi.fn()
    await authenticate(req, mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
    expect(req.user).toEqual({
      id: 'u1', email: 'a@b.c', school_id: 's1', role: 'school_admin', full_name: 'Admin',
    })
  })

  it('401s a token so malformed that verification throws', async () => {
    // getClaims throws rather than returning an error for input it cannot
    // parse at all (e.g. "abc.def.ghi"). That is a rejected credential, not a
    // server fault — letting the throw escape produced a 500 and told the
    // client to retry something that will never succeed.
    getClaims.mockRejectedValue(new Error('Invalid JWT structure'))
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer abc.def.ghi' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('turns an unexpected throw into a 500 rather than crashing the process', async () => {
    // A failure in the profile lookup, by contrast, IS a server fault.
    getClaims.mockResolvedValue(claimsOk())
    single.mockRejectedValue(new Error('database down'))
    const res = mockRes()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('authenticateFlexible', () => {
  it('accepts a token from the query string, for plain-link document opens', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })
    const req: any = { headers: {}, query: { token: 'good' } }
    const next = vi.fn()
    await authenticateFlexible(req, mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
    expect(req.user.id).toBe('u1')
  })

  it('still accepts the Authorization header', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })
    const next = vi.fn()
    await authenticateFlexible(
      { headers: { authorization: 'Bearer good' }, query: {} } as any,
      mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })

  it('responds with HTML, not JSON — these routes render in a browser tab', async () => {
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: {} } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<h2>'))
  })

  it('rejects an invalid token', async () => {
    getClaims.mockResolvedValue(claimsBad)
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'bad' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a missing profile', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: null, error: { message: 'none' } })
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a deactivated account with 403', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: { ...PROFILE, is_active: false }, error: null })
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('401s a malformed token rather than 500ing', async () => {
    getClaims.mockRejectedValue(new Error('Invalid JWT structure'))
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'a.b.c' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('turns an unexpected throw into a 500', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockRejectedValue(new Error('boom'))
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('ignores a non-string token param', async () => {
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: ['a', 'b'] } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

// The profile cache removes a ~358ms query from every request, but it also
// means a change to someone's role or active flag is not instantly visible.
// These pin down both halves of that trade.
describe('profile cache', () => {
  const call = async () => {
    const req: any = { headers: { authorization: 'Bearer good' } }
    await authenticate(req, mockRes() as Response, vi.fn() as NextFunction)
    return req
  }

  it('reads the users table once across repeated requests', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })

    await call(); await call(); await call()

    expect(single).toHaveBeenCalledTimes(1)
  })

  it('still verifies the token on every request, cached profile or not', async () => {
    // The cache must never short-circuit verification — otherwise an expired
    // or forged token would ride in on a warm entry.
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })
    await call(); await call()
    expect(getClaims).toHaveBeenCalledTimes(2)

    getClaims.mockResolvedValue(claimsBad)
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer expired' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('picks up a deactivation immediately once invalidated', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: PROFILE, error: null })
    await call()

    // Deactivated in the database, and the cache told about it — as the team
    // routes do after updating a user.
    single.mockResolvedValue({ data: { ...PROFILE, is_active: false }, error: null })
    invalidateUserProfile('u1')

    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer good' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('does not cache a missing profile as if it were a user', async () => {
    getClaims.mockResolvedValue(claimsOk())
    single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const res1 = mockRes()
    await authenticate({ headers: { authorization: 'Bearer good' } } as any, res1 as Response, vi.fn() as NextFunction)
    expect(res1.status).toHaveBeenCalledWith(401)

    // Profile now exists; the earlier miss must not be sticky.
    single.mockResolvedValue({ data: PROFILE, error: null })
    const req = await call()
    expect(req.user?.id).toBe('u1')
  })
})

describe('requireRole', () => {
  it('401s an unauthenticated request', () => {
    const res = mockRes(); const next = vi.fn()
    requireRole('school_admin')({} as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('403s a role that is not on the list', () => {
    const res = mockRes(); const next = vi.fn()
    requireRole('school_admin', 'principal')({ user: { role: 'teacher' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('school_admin, principal'),
    }))
  })

  it('allows a listed role through', () => {
    const next = vi.fn()
    requireRole('school_admin', 'principal')({ user: { role: 'principal' } } as any, mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
  })
})
