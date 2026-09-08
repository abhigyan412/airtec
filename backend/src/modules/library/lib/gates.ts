import { supabase } from '../../../shared/db/client'

// Preconditions other modules gate on before letting a student or staff
// member leave the school (TC, promotion, exit settlement) — a book on
// loan is exactly the same kind of "must be cleared first" fact as an
// outstanding fee balance, just tracked in a different table.

export interface ActiveLoanSummary {
  id: string
  due_date: string
  title: string | null
  accession_no: string | null
}

async function loansForMember(memberId: string): Promise<ActiveLoanSummary[]> {
  const { data } = await supabase.from('book_loans')
    .select('id, due_date, book_copies(accession_no, book_titles(title))')
    .eq('member_id', memberId).in('status', ['active', 'overdue'])
  return ((data ?? []) as any[]).map(l => ({
    id: l.id, due_date: l.due_date,
    title: l.book_copies?.book_titles?.title ?? null, accession_no: l.book_copies?.accession_no ?? null,
  }))
}

export async function activeLoansForStudent(schoolId: string, studentId: string): Promise<ActiveLoanSummary[]> {
  const { data: member } = await supabase.from('library_members').select('id').eq('school_id', schoolId).eq('student_id', studentId).maybeSingle()
  if (!member) return []
  return loansForMember(member.id)
}

export async function activeLoansForStaffUser(schoolId: string, userId: string): Promise<ActiveLoanSummary[]> {
  const { data: member } = await supabase.from('library_members').select('id').eq('school_id', schoolId).eq('user_id', userId).maybeSingle()
  if (!member) return []
  return loansForMember(member.id)
}

/** Batched for bulk operations (e.g. whole-class promotion) — one pair of
 * queries for the whole list instead of two round trips per student. */
export async function activeLoanCountsForStudents(schoolId: string, studentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!studentIds.length) return counts
  const { data: members } = await supabase.from('library_members').select('id, student_id').eq('school_id', schoolId).in('student_id', studentIds)
  if (!members?.length) return counts
  const memberByStudent = new Map(members.map(m => [m.id, m.student_id as string]))
  const { data: loans } = await supabase.from('book_loans').select('member_id').in('member_id', members.map(m => m.id)).in('status', ['active', 'overdue'])
  for (const loan of (loans ?? []) as any[]) {
    const studentId = memberByStudent.get(loan.member_id)
    if (studentId) counts.set(studentId, (counts.get(studentId) ?? 0) + 1)
  }
  return counts
}
