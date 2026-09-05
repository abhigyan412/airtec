import { Request, Response, NextFunction } from 'express'
import { supabase } from '../db/client'

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
    // The flat "Validation error" string used to be the only thing any
    // caller ever saw — every frontend onError reads response.data.error,
    // none of them read .details, so a real field-level problem (wrong
    // type, out-of-range value, missing required field) was completely
    // invisible outside this server-side log line. Building a readable
    // "field: message" summary into .error itself means every existing
    // toast across the app starts saying something useful, with zero
    // frontend changes needed.
    const summary = (err.errors ?? [])
      .map((e: any) => `${(e.path ?? []).join('.') || 'body'}: ${e.message}`)
      .join('; ')
    return res.status(400).json({
      success: false,
      error: summary || 'Validation error',
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
  return ['A', 'B', 'C']
}

/**
 * The class ladder a new school starts with: pre-primary through Class 12.
 *
 * numeric_level orders the list and is what every "which class is this"
 * comparison keys on, so the three pre-primary years take the levels below
 * Class 1 rather than being appended at the end — Nursery must sort before
 * UKG, which must sort before Class 1, and `Class N` must keep numeric_level N
 * so nothing that assumes that correspondence breaks.
 *
 * Shared because two places build this list — the demo seed and the new-school
 * signup in auth/routes.ts — and a school whose class ladder depends on which
 * of the two created it is a bug waiting to happen.
 */
export const DEFAULT_CLASSES: { name: string; numeric_level: number }[] = [
  { name: 'Nursery', numeric_level: -2 },
  { name: 'LKG', numeric_level: -1 },
  { name: 'UKG', numeric_level: 0 },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `Class ${i + 1}`, numeric_level: i + 1 })),
]

// 'parent' and 'student' are the only non-staff roles in users.role —
// everyone else (including accountant/counselor, who have no business
// here either) is treated as staff for "can this person see everyone's
// data" gates.
export const NON_STAFF_ROLES = ['parent', 'student']

// Maps a logged-in parent/student user to the one student record they're
// allowed to see. Resolved via students.user_id / parents.user_id, which
// nothing currently populates (no student/parent login flow exists yet),
// so this is correct but returns null — i.e. denies access — until that
// gap is closed elsewhere. Shared so every "is this MY data" check in the
// app agrees on how ownership is resolved.
export async function resolveOwnStudentId(userId: string, role: string, schoolId: string): Promise<string | null> {
  if (role === 'student') {
    const { data } = await supabase.from('students').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle()
    return data?.id ?? null
  }
  const { data: parent } = await supabase.from('parents').select('student_id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle()
  return parent?.student_id ?? null
}

// Whether a result-facing screen may show a student/parent this exam's
// data. 'result_published' always qualifies — the exam's own full
// Freeze->Verify->Publish chain completed. A Term-member exam ALSO
// qualifies at 'result_frozen', since in practice a school almost never
// runs that full chain on an individual component exam — only on the
// composite Term itself — so requiring 'result_published' from a
// component exam left it permanently invisible. A standalone (non-member)
// exam still needs the full publish; only Term membership relaxes this.
// Shared so exam/routes.ts's GET /:id/scoresheet and sis/routes.ts's
// GET /students/:id/performance agree on the same rule.
export async function isExamResultVisibleToNonStaff(examId: string, status: string | null | undefined): Promise<boolean> {
  if (status === 'result_published') return true
  if (status !== 'result_frozen') return false
  const { data } = await supabase.from('result_group_exams').select('id').eq('exam_id', examId).limit(1).maybeSingle()
  return !!data
}

// PostgREST silently caps an unranged select at 1000 rows. Pages through
// with .range() instead. queryFn is expected to pass { count: 'exact' }
// so the first page also reports the total, and — this is not optional —
// end its chain with .order('id') before .range(). Postgres LIMIT/OFFSET
// has no guaranteed row order without an explicit ORDER BY: two separate
// .range() requests against the same unordered query can each pick a
// different arbitrary ordering, so pages can silently overlap (duplicate
// rows) or gap (missed rows) even though every page's own row count and
// the overall total stay identical. That was live and confirmed here —
// the low-attendance endpoint returned a different set of "below
// threshold" students, sometimes none, on back-to-back calls against
// completely unchanged data, with both fetch sizes (1069 students, 50400
// attendance rows) reported identically every time. Only the row
// *identities* were shuffling between pages. Adding .order('id') to
// every call site fixed it. Every caller of this helper must sort by
// something unique, or this bug comes back.
//
// Fired one page at a time (await in a loop), a 19k-row fetch took ~20
// sequential round-trips — the dashboard endpoint was taking 29s end to
// end. Pages are now requested in small concurrent batches instead —
// far faster, without needing to fire everything at once.
export async function fetchAllRows<T>(queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any; count?: number | null }>): Promise<T[]> {
  const PAGE = 1000
  const BATCH_CONCURRENCY = 6
  const first = await queryFn(0, PAGE - 1)
  if (first.error) throw new Error(first.error.message)
  const firstPage = first.data ?? []
  const total = first.count ?? null
  if (total == null || firstPage.length < PAGE) return firstPage

  const remainingPages = Math.ceil((total - PAGE) / PAGE)
  const all: T[] = [...firstPage]
  for (let batchStart = 0; batchStart < remainingPages; batchStart += BATCH_CONCURRENCY) {
    const batchLength = Math.min(BATCH_CONCURRENCY, remainingPages - batchStart)
    const batch = await Promise.all(
      Array.from({ length: batchLength }, (_, j) => {
        const pageIndex = batchStart + j
        const from = PAGE * (pageIndex + 1)
        return queryFn(from, from + PAGE - 1).then(r => {
          if (r.error) throw new Error(r.error.message)
          return r.data ?? []
        })
      }),
    )
    all.push(...batch.flat())
  }
  return all
}
