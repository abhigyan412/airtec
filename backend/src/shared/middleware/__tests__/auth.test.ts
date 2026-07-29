import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response, NextFunction } from 'express'

// The Supabase client is mocked here rather than hit for real: these are
// authorization decisions (who is let through, with what status code),
// and every branch — expired token, missing profile, deactivated account
// — is far easier to provoke with a stub than by manufacturing that
// state in a live database.
const getUser = vi.fn()
const single = vi.fn()
vi.mock('../../db/client', () => ({
  supabase: {
    auth: { getUser: (...a: any[]) => getUser(...a) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
  createUserClient: vi.fn(),
}))

const { authenticate, authenticateFlexible, requireRole } = await import('../auth')

const mockRes = () => {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  return res
}
const PROFILE = { id: 'u1', full_name: 'Admin', email: 'a@b.c', school_id: 's1', role: 'school_admin', is_active: true }

beforeEach(() => { getUser.mockReset(); single.mockReset() })

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
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid or expired token' })
  })

  it('rejects a valid token with no profile row', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a deactivated account with 403, not 401', async () => {
    // The distinction matters: 401 makes the client retry auth, 403 tells
    // the user their account is disabled.
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: { ...PROFILE, is_active: false }, error: null })
    const res = mockRes(); const next = vi.fn()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, next as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('attaches the profile and continues on success', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: PROFILE, error: null })
    const req: any = { headers: { authorization: 'Bearer good' } }
    const next = vi.fn()
    await authenticate(req, mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
    expect(req.user).toEqual({
      id: 'u1', email: 'a@b.c', school_id: 's1', role: 'school_admin', full_name: 'Admin',
    })
  })

  it('turns an unexpected throw into a 500 rather than crashing the process', async () => {
    getUser.mockRejectedValue(new Error('network down'))
    const res = mockRes()
    await authenticate({ headers: { authorization: 'Bearer x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('authenticateFlexible', () => {
  it('accepts a token from the query string, for plain-link document opens', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: PROFILE, error: null })
    const req: any = { headers: {}, query: { token: 'good' } }
    const next = vi.fn()
    await authenticateFlexible(req, mockRes() as Response, next as NextFunction)
    expect(next).toHaveBeenCalled()
    expect(req.user.id).toBe('u1')
  })

  it('still accepts the Authorization header', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
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
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'bad' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a missing profile', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: null, error: { message: 'none' } })
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a deactivated account with 403', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    single.mockResolvedValue({ data: { ...PROFILE, is_active: false }, error: null })
    const res = mockRes()
    await authenticateFlexible({ headers: {}, query: { token: 'x' } } as any, res as Response, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('turns an unexpected throw into a 500', async () => {
    getUser.mockRejectedValue(new Error('boom'))
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
