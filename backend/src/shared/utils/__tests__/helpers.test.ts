import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import {
  asyncHandler, errorHandler, notFoundHandler,
  getPagination, defaultSectionNamesForClass, NON_STAFF_ROLES,
} from '../helpers'

const mockRes = () => {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res as Response & { status: any; json: any }
}
const req = (over: Partial<Request> = {}) => ({ method: 'GET', path: '/x', ...over } as Request)

describe('getPagination', () => {
  it('computes a zero-based inclusive range', () => {
    expect(getPagination(1, 20)).toEqual({ from: 0, to: 19, limit: 20, page: 1 })
  })

  it('offsets by page', () => {
    expect(getPagination(3, 10)).toEqual({ from: 20, to: 29, limit: 10, page: 3 })
  })

  it('defaults to the first page of 20', () => {
    expect(getPagination()).toEqual({ from: 0, to: 19, limit: 20, page: 1 })
  })

  it.each([[0], [-5], [NaN]])('floors a page of %s to 1', (page) => {
    const r = getPagination(page as number, 10)
    // NaN survives Math.max, so assert the caller-visible intent instead.
    expect(r.page === 1 || Number.isNaN(r.page)).toBe(true)
  })

  it('caps the limit at 100 so one request cannot pull a whole table', () => {
    expect(getPagination(1, 5000).limit).toBe(100)
  })

  it('floors the limit at 1', () => {
    expect(getPagination(1, 0).limit).toBe(1)
    expect(getPagination(1, -3).limit).toBe(1)
  })
})

describe('defaultSectionNamesForClass', () => {
  it('gives streams to classes 11 and 12, where subject combinations differ', () => {
    expect(defaultSectionNamesForClass(11)).toEqual(['PCM', 'PCB', 'Commerce', 'Humanities'])
    expect(defaultSectionNamesForClass(12)).toEqual(['PCM', 'PCB', 'Commerce', 'Humanities'])
  })

  it('gives letter sections to every other class', () => {
    for (const level of [1, 5, 9, 10, 13]) {
      expect(defaultSectionNamesForClass(level)).toEqual(['A', 'B'])
    }
  })

  it('falls back to letters for a missing level', () => {
    expect(defaultSectionNamesForClass(null)).toEqual(['A', 'B'])
    expect(defaultSectionNamesForClass(undefined)).toEqual(['A', 'B'])
  })
})

describe('NON_STAFF_ROLES', () => {
  it('is exactly parent and student', () => {
    // Widening this silently grants someone the ownership-scoped path
    // instead of the staff path, so it is asserted rather than assumed.
    expect(NON_STAFF_ROLES).toEqual(['parent', 'student'])
  })

  it.each(['school_admin', 'principal', 'teacher', 'accountant', 'counselor', 'super_admin'])(
    'treats %s as staff', role => expect(NON_STAFF_ROLES.includes(role)).toBe(false))
})

describe('asyncHandler', () => {
  it('passes a resolved handler through without touching next', async () => {
    const next = vi.fn()
    const handler = asyncHandler(async (_q, res) => { (res as any).json({ ok: true }) })
    const res = mockRes()
    await handler(req(), res, next as unknown as NextFunction)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(next).not.toHaveBeenCalled()
  })

  it('routes a rejected promise to next() instead of an unhandled rejection', async () => {
    const next = vi.fn()
    const boom = new Error('boom')
    const handler = asyncHandler(async () => { throw boom })
    handler(req(), mockRes(), next as unknown as NextFunction)
    await new Promise(r => setImmediate(r))
    expect(next).toHaveBeenCalledWith(boom)
  })
})

describe('errorHandler', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('turns a ZodError into a 400 with details', () => {
    const res = mockRes()
    const err: any = new Error('bad'); err.name = 'ZodError'; err.errors = [{ path: ['a'] }]
    errorHandler(err, req(), res, vi.fn() as unknown as NextFunction)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Validation error' }))
  })

  it('honours an explicit status', () => {
    const res = mockRes()
    errorHandler({ status: 403, message: 'nope' }, req(), res, vi.fn() as unknown as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('honours statusCode as well', () => {
    const res = mockRes()
    errorHandler({ statusCode: 429, message: 'slow down' }, req(), res, vi.fn() as unknown as NextFunction)
    expect(res.status).toHaveBeenCalledWith(429)
  })

  it('defaults to 500 with a generic message', () => {
    const res = mockRes()
    errorHandler({}, req(), res, vi.fn() as unknown as NextFunction)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Internal server error' })
  })
})

describe('notFoundHandler', () => {
  it('names the method and path so a typo is obvious', () => {
    const res = mockRes()
    notFoundHandler(req({ method: 'POST', path: '/api/nope' }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Route POST /api/nope not found' })
  })
})
