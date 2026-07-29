import { supabase } from '../db/client'

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
  | 'exam_result_published'
  | 'fee_due_soon' | 'fee_overdue'

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
  const row = {
    school_id: params.schoolId, user_id: params.userId, type: params.type,
    title: params.title, message: params.message, link: params.link ?? null,
    related_entity_type: params.relatedEntityType ?? null, related_entity_id: params.relatedEntityId ?? null,
  }

  // When tied to a specific entity (an invoice, a homework post, ...),
  // dedupe against the same user/type/entity/day so re-running a cron
  // tick or an accidental double-submit doesn't spam the same alert.
  if (params.relatedEntityId) {
    return supabase.from('notifications')
      .upsert(row, { onConflict: 'user_id,type,related_entity_id,notification_date', ignoreDuplicates: true })
  }
  return supabase.from('notifications').insert(row)
}

export async function createNotifications(userIds: string[], params: Omit<CreateNotificationParams, 'userId'>) {
  const unique = [...new Set(userIds)]
  if (!unique.length) return { count: 0 }
  await Promise.all(unique.map(userId => createNotification({ ...params, userId })))
  return { count: unique.length }
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
