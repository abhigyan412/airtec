import { supabase } from '../../../shared/db/client'
import { createNotifications, NotificationType } from '../../../shared/utils/notifications'
import { getUserIdsWithPermission } from '../../../shared/middleware/permissions-v2'

// ═══════════════════════════════════════════════════════════════
// Shared plumbing for the timetable module.
// ═══════════════════════════════════════════════════════════════

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Monday = 1 .. Saturday = 6, matching the schema. Sunday returns 7. */
export function dayOfWeekFor(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

export function isSchoolDay(dateStr: string, workingDays: number[]): boolean {
  return workingDays.includes(dayOfWeekFor(dateStr))
}

/** "13:25:00" -> "1:25 PM". Indian schools read their timetable in 12-hour. */
export function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export function minutesOf(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ── settings ────────────────────────────────────────────────────

export interface TimetableSettings {
  school_id: string
  ack_reminder_minutes: number
  ack_escalate_minutes: number
  booking_lead_hours: number
  booking_weekly_cap: number
  working_days: number[]
  enforce_max_consecutive: boolean
  auto_detect_absence: boolean
  auto_detect_after_period: number
  long_absence_threshold_days: number
}

const SETTINGS_DEFAULTS: Omit<TimetableSettings, 'school_id'> = {
  ack_reminder_minutes: 15,
  ack_escalate_minutes: 30,
  booking_lead_hours: 12,
  booking_weekly_cap: 4,
  working_days: [1, 2, 3, 4, 5, 6],
  enforce_max_consecutive: false,
  auto_detect_absence: true,
  auto_detect_after_period: 1,
  long_absence_threshold_days: 10,
}

/**
 * Settings for a school, creating the row on first read.
 *
 * Every caller needs these and none of them should have to care whether
 * the row exists — a school created before this module shipped has no
 * row, and returning nulls would push the defaults into a dozen call
 * sites where they would drift apart.
 */
export async function getSettings(schoolId: string): Promise<TimetableSettings> {
  const { data } = await supabase
    .from('timetable_settings').select('*').eq('school_id', schoolId).maybeSingle()

  if (data) return data as TimetableSettings

  const row = { school_id: schoolId, ...SETTINGS_DEFAULTS }
  await supabase.from('timetable_settings').upsert(row, { onConflict: 'school_id' })
  return row
}

// ── audit ───────────────────────────────────────────────────────

/**
 * Record who did what.
 *
 * Arrangements are the most disputed thing in a staffroom — "nobody told
 * me I was covering 8B" — and the register is what protects the
 * timetable manager. Deliberately fire-and-forget: an audit write that
 * fails must never be the reason a substitute doesn't get assigned, but
 * it must be loud in the logs when it happens.
 */
export async function audit(
  schoolId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('timetable_audit_log').insert({
    school_id: schoolId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    detail: detail ?? null,
  })
  if (error) console.error(`[timetable-audit] ${action} ${entityType} failed:`, error.message)
}

// ── notifications ───────────────────────────────────────────────

interface NotifyParams {
  schoolId: string
  userIds: string[]
  type: NotificationType
  title: string
  message: string
  link?: string
  relatedEntityType?: string
  relatedEntityId?: string
}

export async function notify(params: NotifyParams): Promise<number> {
  const recipients = params.userIds.filter(Boolean)
  if (!recipients.length) return 0
  const { count } = await createNotifications(recipients, {
    schoolId: params.schoolId,
    type: params.type,
    title: params.title,
    message: params.message,
    link: params.link,
    relatedEntityType: params.relatedEntityType,
    relatedEntityId: params.relatedEntityId,
  })
  return count
}

/**
 * Whoever runs the arrangement queue for this school.
 *
 * Resolved from the permission rather than from a role name, so a school
 * that renames "Timetable Manager" to "Academic Coordinator", or splits
 * the job across two people, still gets its escalations. Principals are
 * included because an escalation that only reaches the person who failed
 * to act on it is not an escalation.
 */
export async function arrangementManagers(schoolId: string): Promise<string[]> {
  return getUserIdsWithPermission(schoolId, 'arrangement.manage')
}

// ── errors ──────────────────────────────────────────────────────

export class TimetableError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'TimetableError'
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new TimetableError(400, code, message, details)
export const notFound = (message: string) =>
  new TimetableError(404, 'not_found', message)
export const conflict = (code: string, message: string, details?: unknown) =>
  new TimetableError(409, code, message, details)

/** Express error shape used by every route in this module. */
export function sendError(res: any, err: unknown) {
  if (err instanceof TimetableError) {
    return res.status(err.statusCode).json({
      success: false, error: err.message, code: err.code, details: err.details ?? undefined,
    })
  }
  console.error('[timetable] unhandled:', err)
  const message = err instanceof Error ? err.message : 'Unexpected error'
  return res.status(500).json({ success: false, error: message })
}

/**
 * Read every row, not the first thousand.
 *
 * PostgREST caps a response at 1,000 rows and says nothing about it —
 * no error, no flag, just a short array. A school with 47 sections has
 * 2,867 timetable periods, so every unbounded read in this module was
 * quietly seeing about a third of the timetable: the workload report
 * under-counted everyone's load, generation planned around a fictional
 * third of the existing grid, and the setup checklist thought half the
 * staff had no periods.
 *
 * Nothing about that failure is visible in the response, which is why
 * every query here that can exceed a thousand rows goes through this.
 */
export async function fetchAll<T = any>(
  build: (from: number, to: number) => any,
  what = 'rows',
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new TimetableError(500, 'db_error', `${what}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
    // A pathological loop guard: 200k rows is far beyond any school.
    if (out.length > 200_000) break
  }
  return out
}

/**
 * Throw on a Supabase error rather than returning silently-empty data.
 *
 * The single most common bug shape against this client is a query whose
 * `error` nobody reads: `data` comes back null, the code carries on with
 * undefined, and the failure surfaces three screens later as a blank
 * page. Every read in this module goes through here instead.
 *
 * Returns `any` deliberately. PostgREST's inferred row type is a union
 * that includes SelectQueryError, so a precise return type makes every
 * downstream property access an error under this project's compiler
 * settings — the same reason the rest of the codebase is littered with
 * `(row as any).classes?.name`. The runtime guarantee (non-null, or it
 * threw) is what actually matters here.
 */
export function must(result: { data: any; error: { message: string } | null }, what: string): any {
  if (result.error) throw new TimetableError(500, 'db_error', `${what}: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw notFound(what)
  return result.data
}
