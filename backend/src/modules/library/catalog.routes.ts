import { Router, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../../shared/db/client'
import { AuthRequest } from '../../shared/middleware/auth'
import { requirePermissionV2 } from '../../shared/middleware/permissions-v2'
import { asyncHandler } from '../../shared/utils/helpers'
import { bulkImport } from '../../shared/utils/bulkImport'

const router = Router()

const CATEGORIES = ['fiction', 'non_fiction', 'reference', 'textbook', 'periodical', 'av_media', 'other'] as const
// Reference and periodical items don't circulate by convention (a real,
// quoted Indian school library rule: "reference books and current
// periodicals will not be issued... can be read only in the library
// room") — this is only the DEFAULT a librarian starts from; is_circulating
// stays editable per title for the rare exception.
const NON_CIRCULATING_BY_DEFAULT = new Set(['reference', 'periodical'])

// ═══════════════════════════════════════════════════════════════
// TITLES
// ═══════════════════════════════════════════════════════════════
router.get('/titles', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, error } = await supabase
      .from('book_titles')
      .select('*, book_copies(id, status)')
      .eq('school_id', req.user!.school_id)
      .order('title')
    if (error) return res.status(500).json({ success: false, error: error.message })
    const withCounts = (data ?? []).map((t: any) => ({
      ...t,
      copy_count: t.book_copies.length,
      available_count: t.book_copies.filter((c: any) => c.status === 'available').length,
      book_copies: undefined,
    }))
    res.json({ success: true, data: withCounts })
  })
)

router.get('/titles/:id', requirePermissionV2('library.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: title } = await supabase.from('book_titles').select('*').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!title) return res.status(404).json({ success: false, error: 'Title not found' })
    const { data: copies } = await supabase.from('book_copies').select('*').eq('title_id', title.id).order('accession_no')
    res.json({ success: true, data: { ...title, copies: copies ?? [] } })
  })
)

const TitleSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).optional(),
  authors: z.array(z.string().trim().min(1)).optional(),
  publisher: z.string().trim().max(200).optional(),
  isbn: z.string().trim().max(30).optional(),
  edition: z.string().trim().max(50).optional(),
  language: z.string().trim().max(50).optional(),
  category: z.enum(CATEGORIES).optional(),
  is_circulating: z.boolean().optional(),
  subject_name: z.string().trim().max(100).optional(),
  class_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  classification_code: z.string().trim().max(50).optional(),
})

router.post('/titles', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = TitleSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })

    const category = parsed.data.category ?? 'fiction'
    const is_circulating = parsed.data.is_circulating ?? !NON_CIRCULATING_BY_DEFAULT.has(category)

    const { data, error } = await supabase
      .from('book_titles')
      .insert({ school_id: req.user!.school_id, ...parsed.data, category, is_circulating })
      .select('*').single()
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true, data })
  })
)

router.patch('/titles/:id', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = TitleSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('book_titles').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Title not found' })
    res.json({ success: true, data })
  })
)

router.delete('/titles/:id', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const school_id = req.user!.school_id
    const { data: title } = await supabase.from('book_titles').select('id, title').eq('id', id).eq('school_id', school_id).maybeSingle()
    if (!title) return res.status(404).json({ success: false, error: 'Title not found' })

    const { count } = await supabase.from('book_copies').select('id', { count: 'exact', head: true }).eq('title_id', id)
    if (count) {
      return res.status(400).json({ success: false, error: `Cannot delete "${title.title}" — it still has ${count} cop${count === 1 ? 'y' : 'ies'}. Remove those first.` })
    }

    const { error } = await supabase.from('book_titles').delete().eq('id', id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// COPIES — accession numbers are a school-wide sequence that never
// reuses a number, even after a copy is deleted (real library-register
// convention). A durable counter on library_settings, incremented
// atomically inside Postgres (see library_next_accession_no) —
// deriving "next" from existing rows' max would hand out a deleted
// copy's old number again, which a real accession register never does.
async function nextAccessionNo(schoolId: string): Promise<string> {
  const { data, error } = await supabase.rpc('library_next_accession_no', { p_school_id: schoolId })
  if (error) throw new Error(error.message)
  return data as string
}

const CopySchema = z.object({
  accession_no: z.string().trim().max(50).optional(),
  barcode: z.string().trim().max(50).optional(),
  shelf_location: z.string().trim().max(100).optional(),
  condition: z.enum(['new', 'good', 'worn', 'damaged', 'lost']).optional(),
  acquired_date: z.string().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  source: z.enum(['purchased', 'donated', 'book_bank']).optional(),
})

router.post('/titles/:id/copies', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = CopySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const school_id = req.user!.school_id

    const { data: title } = await supabase.from('book_titles').select('id').eq('id', req.params.id).eq('school_id', school_id).maybeSingle()
    if (!title) return res.status(404).json({ success: false, error: 'Title not found' })

    const accession_no = parsed.data.accession_no || await nextAccessionNo(school_id)
    const { data, error } = await supabase
      .from('book_copies')
      .insert({ title_id: title.id, school_id, ...parsed.data, accession_no, barcode: parsed.data.barcode || accession_no })
      .select('*').single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: `Accession number "${accession_no}" already exists.` })
      return res.status(500).json({ success: false, error: error.message })
    }
    res.json({ success: true, data })
  })
)

const CopyUpdateSchema = z.object({
  shelf_location: z.string().trim().max(100).optional(),
  condition: z.enum(['new', 'good', 'worn', 'damaged', 'lost']).optional(),
  status: z.enum(['available', 'issued', 'reserved', 'lost', 'withdrawn', 'under_repair']).optional(),
  cost: z.number().nonnegative().nullable().optional(),
})

router.patch('/copies/:id', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = CopyUpdateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    const { data, error } = await supabase
      .from('book_copies').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('school_id', req.user!.school_id)
      .select('*').maybeSingle()
    if (error) return res.status(500).json({ success: false, error: error.message })
    if (!data) return res.status(404).json({ success: false, error: 'Copy not found' })
    res.json({ success: true, data })
  })
)

router.delete('/copies/:id', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data: copy } = await supabase.from('book_copies').select('id, status, accession_no').eq('id', req.params.id).eq('school_id', req.user!.school_id).maybeSingle()
    if (!copy) return res.status(404).json({ success: false, error: 'Copy not found' })
    if (copy.status === 'issued' || copy.status === 'reserved') {
      return res.status(400).json({ success: false, error: `Cannot delete accession "${copy.accession_no}" — it is currently ${copy.status}.` })
    }
    const { error } = await supabase.from('book_copies').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    res.json({ success: true })
  })
)

// ═══════════════════════════════════════════════════════════════
// CSV IMPORT — titles only (one row per title; add copies separately,
// since a title-CSV row and a copy-CSV row are different shapes and a
// school importing an existing catalogue almost always has one row per
// title, not per physical copy).
// ═══════════════════════════════════════════════════════════════
const lowerTrim = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v)

const TitleImportRowSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(300),
  authors: z.preprocess(v => v || undefined, z.string().trim().optional()),
  publisher: z.preprocess(v => v || undefined, z.string().trim().max(200).optional()),
  isbn: z.preprocess(v => v || undefined, z.string().trim().max(30).optional()),
  category: z.preprocess(v => (v ? lowerTrim(String(v).replace(/[\s-]+/g, '_')) : undefined), z.enum(CATEGORIES).optional()),
  subject_name: z.preprocess(v => v || undefined, z.string().trim().max(100).optional()),
})

router.post('/titles/import', requirePermissionV2('library.manage_catalog'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = z.array(z.record(z.string())).parse(req.body.rows ?? [])
    const school_id = req.user!.school_id
    const result = await bulkImport(
      rows, TitleImportRowSchema,
      async row => {
        const category = row.category ?? 'fiction'
        const authors = row.authors ? row.authors.split(/[,;]/).map(a => a.trim()).filter(Boolean) : []
        return { school_id, ...row, category, authors, is_circulating: !NON_CIRCULATING_BY_DEFAULT.has(category) }
      },
      async row => {
        const { error } = await supabase.from('book_titles').insert(row)
        return { error: error?.message }
      },
    )
    res.json({ success: true, data: result })
  })
)

export default router
