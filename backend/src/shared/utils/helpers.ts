import { Request, Response, NextFunction } from 'express'

// Wraps async route handlers to catch errors automatically
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// Global error handler middleware
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err)

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: err.errors,
    })
  }

  const status = err.status || err.statusCode || 500
  const message = err.message || 'Internal server error'

  res.status(status).json({
    success: false,
    error: message,
  })
}

// 404 handler
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
  })
}

// Pagination helper
export const getPagination = (page = 1, limit = 20) => {
  const safePage = Math.max(1, page)
  const safeLimit = Math.min(100, Math.max(1, limit))
  const from = (safePage - 1) * safeLimit
  const to = from + safeLimit - 1
  return { from, to, limit: safeLimit, page: safePage }
}

// Default section names for a freshly-created class, by numeric level.
// Classes 11–12 (senior secondary) are organized by stream rather than
// arbitrary letter sections, matching how Indian CBSE/ICSE/state-board
// schools actually structure those two years — subject combinations,
// and therefore timetables, differ by stream, not by section letter.
// Used both by the demo seed script and by seedDefaultData() on new
// school signup, so both stay in sync.
export const defaultSectionNamesForClass = (numericLevel: number | null | undefined): string[] => {
  if (numericLevel === 11 || numericLevel === 12) {
    return ['PCM', 'PCB', 'Commerce', 'Humanities']
  }
  return ['A', 'B']
}
