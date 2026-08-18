import { supabase } from '../db/client'
import { enqueueDeliveries, kickDeliveries } from './delivery'

// ── In-app notification service ─────────────────────────────────
//
// Deliberately provider-agnostic: every trigger site in the app calls
// createNotification()/createNotifications() to write an in-app row.
// Email/SMS/WhatsApp delivery can be added later as an extra step
// inside these two functions (fan out to a provider once one is
// configured) without touching any of the ~10 call sites that produce
// notifications — they only need to know "notify this user about this
// thing," not how it's delivered.

export type NotificationType =
  | 'attendance_absent'
  | 'leave_approved' | 'leave_rejected'
  | 'tc_approved' | 'tc_rejected'
  | 'discount_approved' | 'discount_rejected'
  | 'homework_assigned'
  | 'timetable_assigned'
  | 'exam_result_published'
  | 'fee_due_soon' | 'fee_overdue'
  | 'payslip_generated'
  | 'probation_ending' | 'document_expiring' | 'contract_review_due' | 'work_anniversary'
  | 'payslip_regen_needed' | 'absconded_review_needed'

interface CreateNotificationParams {
  schoolId: string
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
  relatedEntityType?: string
  relatedEntityId?: string
}

export async function createNotification(params: CreateNotificationParams) {
  const { created } = await writeNotifications([params.userId], params)
  return { count: created.length }
}

export async function createNotifications(userIds: string[], params: Omit<CreateNotificationParams, 'userId'>) {
  const { created } = await writeNotifications(userIds, params)
  return { count: created.length }
}

/**
 * Writes the in-app rows and enqueues delivery for whoever hasn't muted
 * the type. One bulk statement for the whole recipient set: a homework
 * post to a 40-student class resolves to ~80 recipients, and the previous
 * per-recipient loop made that 80 round trips.
 *
 * `.select()` is load-bearing. Without it PostgREST returns no
 * representation and `data` is null on every call — including successful
 * inserts — so anything downstream that keys off the returned rows
 * silently never runs. With `ignoreDuplicates`, a fully-deduped write
 * returns `[]`, which is truthy; callers must check length, not truthiness.
 */
async function writeNotifications(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>,
): Promise<{ created: any[] }> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (!unique.length) return { created: [] }

  const rows = unique.map(userId => ({
    school_id: params.schoolId, user_id: userId, type: params.type,
    title: params.title, message: params.message, link: params.link ?? null,
    related_entity_type: params.relatedEntityType ?? null,
    related_entity_id: params.relatedEntityId ?? null,
  }))

  // When tied to a specific entity (an invoice, a homework post, ...),
  // dedupe against the same user/type/entity/day so re-running a cron
  // tick or an accidental double-submit doesn't spam the same alert.
  const { data, error } = params.relatedEntityId
    ? await supabase.from('notifications')
        .upsert(rows, { onConflict: 'user_id,type,related_entity_id,notification_date', ignoreDuplicates: true })
        .select()
    : await supabase.from('notifications').insert(rows).select()

  if (error) { console.error('[notifications] insert failed:', error.message); return { created: [] } }

  const created = data ?? []
  // Deduped rows return nothing, which is the point: without this the
  // notification-level dedupe would hold while push re-sent anyway.
  if (created.length) {
    await enqueueDeliveries(created)
    kickDeliveries()
  }
  return { created }
}

// ── Recipient resolution ────────────────────────────────────────
//
// There's no separate "notification preferences" table — a student's
// household is reached via whichever login accounts actually exist for
// them: the student's own account (students.user_id) if they have one,
// and/or the linked parent account (parents.user_id). Both are
// nullable in this schema (not every student/parent has a login yet),
// so a student with neither simply gets no in-app notification — there's
// nowhere to put it.

export async function getRecipientUserIdsForStudent(studentId: string): Promise<string[]> {
  const [{ data: student }, { data: parent }] = await Promise.all([
    supabase.from('students').select('user_id').eq('id', studentId).maybeSingle(),
    supabase.from('parents').select('user_id').eq('student_id', studentId).maybeSingle(),
  ])
  return [student?.user_id, parent?.user_id].filter((id): id is string => !!id)
}

export async function getRecipientUserIdsForStudents(studentIds: string[]): Promise<string[]> {
  const unique = [...new Set(studentIds)]
  if (!unique.length) return []
  const [{ data: students }, { data: parents }] = await Promise.all([
    supabase.from('students').select('user_id').in('id', unique),
    supabase.from('parents').select('user_id').in('student_id', unique),
  ])
  const ids = [...(students ?? []).map(s => s.user_id), ...(parents ?? []).map(p => p.user_id)]
  return [...new Set(ids.filter((id): id is string => !!id))]
}
