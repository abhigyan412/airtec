import { supabase } from '../../../shared/db/client'

export interface ResolvedPolicy {
  max_books: number
  loan_days: number
  renewal_limit: number
  fine_per_day: number
}

/**
 * Borrowing policy resolution — role override beats category override
 * beats the school-wide default (a specific person's own borrowing
 * terms should win over a generic book-category rule), same
 * specific-beats-general shape as Result Settings' subject overrides.
 * Shared between circulation (issue/renew) and fines (overdue rate).
 */
export async function resolvePolicy(
  schoolId: string,
  member: { user_id: string | null; student_id: string | null },
  category: string,
): Promise<ResolvedPolicy> {
  const { data: settings } = await supabase.from('library_settings').select('*').eq('school_id', schoolId).maybeSingle()
  const base: ResolvedPolicy = {
    max_books: settings?.default_max_books ?? 3,
    loan_days: settings?.default_loan_days ?? 14,
    renewal_limit: 1,
    fine_per_day: settings?.default_fine_per_day ?? 0,
  }

  let roleId: string | null = null
  if (member.user_id) {
    const { data: user } = await supabase.from('users').select('primary_role_id').eq('id', member.user_id).maybeSingle()
    roleId = user?.primary_role_id ?? null
  }
  // A student's "role" for borrowing-policy purposes is the seeded
  // Student RBAC role, since students rarely have their own primary_role_id
  // set (no login/user_roles row at all in the common no-portal-login case).
  if (!roleId && member.student_id) {
    const { data: studentRole } = await supabase.from('roles').select('id').eq('school_id', schoolId).eq('name', 'Student').maybeSingle()
    roleId = studentRole?.id ?? null
  }

  const [{ data: roleOverride }, { data: categoryOverride }] = await Promise.all([
    roleId
      ? supabase.from('library_borrowing_policies').select('*').eq('school_id', schoolId).eq('applies_to_role_id', roleId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('library_borrowing_policies').select('*').eq('school_id', schoolId).eq('applies_to_category', category).maybeSingle(),
  ])

  const merged = { ...base }
  for (const key of ['max_books', 'loan_days', 'renewal_limit', 'fine_per_day'] as const) {
    if (categoryOverride?.[key] != null) merged[key] = categoryOverride[key]
    if (roleOverride?.[key] != null) merged[key] = roleOverride[key]
  }
  return merged
}
