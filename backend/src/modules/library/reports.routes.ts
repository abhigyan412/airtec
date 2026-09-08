import { Router, Response } from 'express'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { toLocalDateStr } from '../../shared/utils/academicCalendar'

const router = Router()

// Defaulters — every loan currently overdue, with its accruing fine if
// one exists, sorted worst-first so the librarian knows who to chase.
router.get('/defaulters', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const today = toLocalDateStr(new Date())
    const { data: loans, error } = await supabase.from('book_loans')
      .select('id, due_date, book_copies!inner(school_id, accession_no, book_titles(title)), library_members(member_type, student_id, user_id, students(first_name, last_name, admission_number))')
      .eq('book_copies.school_id', school_id).in('status', ['active', 'overdue']).lt('due_date', today)
    if (error) return res.status(500).json({ success: false, error: error.message })

    const loanIds = (loans ?? []).map(l => l.id)
    const { data: fines } = loanIds.length
      ? await supabase.from('library_fines').select('loan_id, amount, status').in('loan_id', loanIds).eq('fine_type', 'overdue')
      : { data: [] as any[] }
    const fineByLoan = new Map((fines ?? []).map(f => [f.loan_id, f]))

    const data = (loans ?? []).map((l: any) => ({
      loan_id: l.id, due_date: l.due_date,
      days_overdue: Math.floor((Date.now() - new Date(`${l.due_date}T00:00:00Z`).getTime()) / 86400000),
      title: l.book_copies?.book_titles?.title, accession_no: l.book_copies?.accession_no,
      member_type: l.library_members?.member_type,
      borrower: l.library_members?.students ? `${l.library_members.students.first_name} ${l.library_members.students.last_name}` : 'Staff',
      admission_number: l.library_members?.students?.admission_number ?? null,
      fine: fineByLoan.get(l.id) ?? null,
    })).sort((a, b) => b.days_overdue - a.days_overdue)
    res.json({ success: true, data })
  })
)

// Most-borrowed titles, optionally within a date range — collection
// planning: what's actually in demand, not a guess.
router.get('/most-borrowed', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    let q = supabase.from('book_loans')
      .select('issued_at, book_copies!inner(school_id, title_id, book_titles(title, category))')
      .eq('book_copies.school_id', school_id)
    if (req.query.from) q = q.gte('issued_at', req.query.from as string)
    if (req.query.to) q = q.lte('issued_at', req.query.to as string)
    const { data, error } = await q.limit(5000)
    if (error) return res.status(500).json({ success: false, error: error.message })

    const counts = new Map<string, { title: string; category: string; count: number }>()
    for (const loan of (data ?? []) as any[]) {
      const titleId = loan.book_copies?.title_id
      if (!titleId) continue
      const existing = counts.get(titleId)
      if (existing) existing.count++
      else counts.set(titleId, { title: loan.book_copies?.book_titles?.title, category: loan.book_copies?.book_titles?.category, count: 1 })
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 50)
    res.json({ success: true, data: ranked })
  })
)

// Collection valuation — total recorded cost of the collection, broken
// down by category and by status (so "lost" surfaces as a real write-off
// figure, not just a count).
router.get('/valuation', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const school_id = req.user!.school_id
    const { data, error } = await supabase.from('book_copies')
      .select('cost, status, book_titles(category)').eq('school_id', school_id)
    if (error) return res.status(500).json({ success: false, error: error.message })

    let totalValue = 0
    let lostValue = 0
    const byCategory = new Map<string, { count: number; value: number }>()
    const byStatus = new Map<string, { count: number; value: number }>()
    for (const copy of (data ?? []) as any[]) {
      const cost = Number(copy.cost ?? 0)
      totalValue += cost
      if (copy.status === 'lost') lostValue += cost
      const category = copy.book_titles?.category ?? 'other'
      const cat = byCategory.get(category) ?? { count: 0, value: 0 }
      cat.count++; cat.value += cost
      byCategory.set(category, cat)
      const st = byStatus.get(copy.status) ?? { count: 0, value: 0 }
      st.count++; st.value += cost
      byStatus.set(copy.status, st)
    }
    res.json({
      success: true,
      data: {
        total_copies: data?.length ?? 0, total_value: totalValue, lost_value: lostValue,
        by_category: Object.fromEntries(byCategory), by_status: Object.fromEntries(byStatus),
      },
    })
  })
)

// RTE/free-textbook distribution audit export — the compliance record
// inspectors ask for: who got what, under which scheme, when.
router.get('/textbook-distribution-audit', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    let q = supabase.from('textbook_distributions')
      .select('distributed_at, book_name, quantity, scheme, students(first_name, last_name, admission_number, classes(name))')
      .eq('school_id', req.user!.school_id).order('distributed_at', { ascending: false })
    if (req.query.academic_year_id) q = q.eq('academic_year_id', req.query.academic_year_id as string)
    if (req.query.scheme) q = q.eq('scheme', req.query.scheme as string)
    const { data, error } = await q.limit(5000)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

export default router
