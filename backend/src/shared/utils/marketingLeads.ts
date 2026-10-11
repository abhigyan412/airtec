// Lead capture for the public marketing site (docs/marketing-site/plan.md §9).
// The route in modules/public/routes.ts is a thin wrapper; the logic lives
// here so it can be tested without a database or a network: the insert and
// fetch are passed in.
import { z } from 'zod'

/** Module slugs the site offers (marketing-site content/modules.ts). */
export const LEAD_MODULES = [
  'admissions',
  'students',
  'fees',
  'certificates',
  'timetable',
  'exams',
  'attendance',
  'homework-syllabus',
  'library',
  'transport',
  'hr-payroll',
  'family-portal',
] as const

const ROLES = ['Owner/Trustee', 'Principal', 'Administrator', 'Accountant', 'Teacher', 'Other'] as const
const STRENGTHS = ['<300', '300–800', '800–1500', '1500+'] as const
const BOARDS = ['CBSE', 'ICSE', 'State', 'IB/Cambridge', 'Other'] as const

/** Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6–9. */
const INDIAN_MOBILE = /^(?:\+?91|0)?[6-9]\d{9}$/

/** Submissions faster than this after the form rendered are treated as bots. */
export const MIN_FILL_MS = 3000

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

// Stored as +91XXXXXXXXXX whatever the visitor typed (98765 43210,
// 09876543210, +91-98765-43210), so the team can search and dial one format.
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => INDIAN_MOBILE.test(v), 'Enter a 10-digit Indian mobile number')
  .transform((v) => `+91${v.slice(-10)}`)

const email = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || z.string().email().safeParse(v).success, 'Invalid email')

const moduleSlug = z.enum(LEAD_MODULES)

// Shared by every form. `website` is the honeypot: a real visitor never sees
// it, a bot that fills every input does. `rendered_at` is when the page drew
// the form (ms since epoch), for the minimum fill-time check.
const common = {
  name: text(120),
  school_name: text(200),
  phone,
  consent: z.literal(true),
  website: z.string().max(500).optional(),
  rendered_at: z.number().int().positive(),
  source_path: z.string().max(200).optional(),
  utm: z.record(z.string().max(200)).optional(),
}

export const LeadRequestSchema = z.discriminatedUnion('form', [
  z.object({
    form: z.literal('full'),
    ...common,
    role: z.enum(ROLES),
    city: text(120),
    state: optionalText(120),
    email,
    student_strength: z.enum(STRENGTHS).optional(),
    board: z.enum(BOARDS).optional(),
    modules: z.array(moduleSlug).max(LEAD_MODULES.length).default([]),
    message: optionalText(2000),
  }),
  z.object({
    form: z.literal('short'),
    ...common,
  }),
  z.object({
    form: z.literal('trial'),
    ...common,
    role: z.enum(ROLES),
    city: text(120),
    email,
    trial_module: moduleSlug,
  }),
])

export type LeadRequest = z.infer<typeof LeadRequestSchema>

/** The `marketing_leads` row (supabase/migrations/20261011000000_marketing_leads.sql). */
export type LeadRow = {
  form: LeadRequest['form']
  name: string
  role: string | null
  school_name: string
  city: string | null
  state: string | null
  phone: string
  email: string | null
  student_strength: string | null
  board: string | null
  modules: string[]
  trial_module: string | null
  message: string | null
  source_path: string | null
  utm: Record<string, string> | null
  consent_at: string
}

/**
 * Spam signals, checked before anything is written: a filled honeypot, or a
 * form submitted faster than a person could fill it (or with a render time in
 * the future, which only a script produces).
 */
export function isSpam(lead: LeadRequest, now: number): boolean {
  if (lead.website && lead.website.trim()) return true
  const elapsed = now - lead.rendered_at
  return elapsed < MIN_FILL_MS
}

export function toLeadRow(lead: LeadRequest, now: Date): LeadRow {
  const utm = lead.utm && Object.keys(lead.utm).length ? lead.utm : null
  const base = {
    form: lead.form,
    name: lead.name,
    school_name: lead.school_name,
    phone: lead.phone,
    source_path: lead.source_path || null,
    utm,
    consent_at: now.toISOString(),
    role: null,
    city: null,
    state: null,
    email: null,
    student_strength: null,
    board: null,
    modules: [] as string[],
    trial_module: null,
    message: null,
  }
  switch (lead.form) {
    case 'full':
      return {
        ...base,
        role: lead.role,
        city: lead.city,
        state: lead.state ?? null,
        email: lead.email ?? null,
        student_strength: lead.student_strength ?? null,
        board: lead.board ?? null,
        modules: lead.modules,
        message: lead.message ?? null,
      }
    case 'trial':
      return {
        ...base,
        role: lead.role,
        city: lead.city,
        email: lead.email ?? null,
        modules: [lead.trial_module],
        trial_module: lead.trial_module,
      }
    case 'short':
      return base
  }
}

/** One readable line for the team chat. */
export function leadMessage(row: LeadRow): string {
  const kind =
    row.form === 'trial' ? `New free-trial request (${row.trial_module})` : row.form === 'short' ? 'New demo request (short form)' : 'New demo request'
  const who = [row.name, row.role].filter(Boolean).join(', ')
  const where = [row.school_name, row.city, row.state].filter(Boolean).join(', ')
  const parts = [`${kind}: ${who} · ${where}`, `Phone ${row.phone}`]
  if (row.email) parts.push(row.email)
  if (row.form === 'full' && row.modules.length) parts.push(`Modules: ${row.modules.join(', ')}`)
  if (row.student_strength) parts.push(`Students ${row.student_strength}`)
  if (row.board) parts.push(row.board)
  if (row.message) parts.push(`“${row.message.length > 280 ? row.message.slice(0, 277) + '…' : row.message}”`)
  if (row.source_path) parts.push(`from ${row.source_path}`)
  return parts.join(' · ')
}

export const WEBHOOK_TIMEOUT_MS = 5000

/**
 * Posts the lead to the team chat (Slack, Google Chat or Discord incoming
 * webhook). `text` is what Slack and Google Chat read, `content` is what
 * Discord reads. Never throws: a failed ping must not fail the submission,
 * but it is always logged, because a silently discarded error is how the
 * OneSignal outage went unnoticed for two days (CLAUDE.md).
 */
export async function pingLeadWebhook(
  url: string | undefined,
  row: LeadRow,
  fetchImpl: typeof fetch = fetch,
  log: (msg: string, err?: unknown) => void = (m, e) => console.error(m, e ?? ''),
): Promise<boolean> {
  if (!url) return false
  const message = leadMessage(row)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, content: message }),
      signal: controller.signal,
    })
    if (!res.ok) {
      log(`[leads] webhook responded ${res.status}; the lead is saved but the team was not pinged`)
      return false
    }
    return true
  } catch (err) {
    log('[leads] webhook failed; the lead is saved but the team was not pinged:', err)
    return false
  } finally {
    clearTimeout(timer)
  }
}

export type CreateLeadDeps = {
  insert: (row: LeadRow) => Promise<{ error: unknown }>
  webhookUrl?: string
  fetchImpl?: typeof fetch
  log?: (msg: string, err?: unknown) => void
  now?: () => Date
}

export type CreateLeadResult =
  | { stored: false; reason: 'spam' }
  | { stored: true; ping: Promise<boolean> }

/**
 * Validates (throws ZodError on bad input), drops spam without writing
 * anything, stores the row, then starts the webhook ping without waiting for
 * it. The caller answers the visitor straight away; `ping` is returned so
 * tests can await it.
 */
export async function createLead(body: unknown, deps: CreateLeadDeps): Promise<CreateLeadResult> {
  const lead = LeadRequestSchema.parse(body)
  const now = deps.now?.() ?? new Date()
  if (isSpam(lead, now.getTime())) return { stored: false, reason: 'spam' }

  const row = toLeadRow(lead, now)
  const { error } = await deps.insert(row)
  if (error) throw new LeadInsertError(error)

  const ping = pingLeadWebhook(deps.webhookUrl, row, deps.fetchImpl, deps.log)
  return { stored: true, ping }
}

export class LeadInsertError extends Error {
  constructor(public readonly dbError: unknown) {
    super('Could not store the lead')
    this.name = 'LeadInsertError'
  }
}
