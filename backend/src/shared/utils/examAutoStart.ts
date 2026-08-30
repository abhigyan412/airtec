import { supabase } from '../db/client'
import { toLocalDateStr } from './academicCalendar'

// Same shape as absconded.ts/hrAlerts.ts: an unattended cross-school
// sweep plus a per-school manual trigger (POST /exams/auto-start/run).
// A Published exam with a start_date that has arrived moves itself to
// Ongoing — a school still has to explicitly Publish an exam (that's a
// real "we're committing to this datesheet" decision), but once that's
// done, waiting for someone to remember to click Start on the day itself
// is just friction, not a decision. Exams with no start_date set are
// left alone entirely — there's no date to trigger off of, so a human
// still has to click Start for those.
export async function runExamAutoStart(schoolId?: string) {
  const today = toLocalDateStr(new Date())

  let query = supabase.from('exams').select('id, school_id, name, start_date')
    .eq('status', 'published').lte('start_date', today).not('start_date', 'is', null)
  if (schoolId) query = query.eq('school_id', schoolId)
  const { data: dueExams } = await query

  let started = 0
  const startedDetail: { id: string; school_id: string; name: string }[] = []
  for (const exam of (dueExams ?? []) as any[]) {
    // Re-checks status on the write too, in case something else already
    // moved it between the select above and here.
    const { error } = await supabase.from('exams').update({ status: 'ongoing' }).eq('id', exam.id).eq('status', 'published')
    if (!error) {
      started++
      startedDetail.push({ id: exam.id, school_id: exam.school_id, name: exam.name })
    }
  }
  return { started, detail: startedDetail }
}
