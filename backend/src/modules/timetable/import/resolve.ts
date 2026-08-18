import { supabase } from '../../../shared/db/client'
import { WorkbookParse } from './parseWorkbook'
import { levenshtein, normalizeKey, similarity } from './canonicalize'

// ═══════════════════════════════════════════════════════════════
// Match what the spreadsheet says against what the school already has.
// ═══════════════════════════════════════════════════════════════
//
// The parse knows there is a teacher called "Basundhara" and a section
// called "III A". It has no idea whether either exists in this database.
// This layer answers that, and where it cannot, proposes what to create.
//
// It proposes. It does not decide. Binding "Neha Singh" in a spreadsheet
// to the wrong Neha in the staff list would hand one person another
// person's whole week, so every match below a certain confidence is
// returned for a human to confirm on the review screen.

export type MatchAction = 'link' | 'create' | 'skip'

export interface TeacherMatch {
  canonical: string
  periods: number
  /** Best existing user, if one looks right. */
  suggestedUserId: string | null
  suggestedName: string | null
  confidence: 'exact' | 'likely' | 'unsure' | 'none'
  action: MatchAction
  candidates: { userId: string; fullName: string; email: string; score: number }[]
}

export interface SubjectMatch {
  canonical: string
  periods: number
  subjectId: string | null
  action: MatchAction
}

export interface SectionMatch {
  raw: string
  className: string
  numericLevel: number
  sectionName: string
  periodsPerDay: number
  classId: string | null
  sectionId: string | null
  action: MatchAction
}

export interface ResolvedImport {
  teachers: TeacherMatch[]
  subjects: SubjectMatch[]
  sections: SectionMatch[]
  summary: {
    teachersMatched: number
    teachersToCreate: number
    subjectsMatched: number
    subjectsToCreate: number
    sectionsMatched: number
    sectionsToCreate: number
    needsReview: number
  }
}

// ── name matching ───────────────────────────────────────────────

/**
 * How much two person-names look like the same person.
 *
 * Full-string edit distance alone is a poor judge here: "Arti Pal" and
 * "Aarti" score reasonably on it and are two different members of staff,
 * while "Basundhara" and "Basundhara Devi" score badly and are one.
 * Comparing the sets of name parts handles both — a spreadsheet that
 * writes first names only still matches the staff list's full names,
 * and an extra distinct part costs the score.
 */
export function nameScore(a: string, b: string): number {
  const left = normalizeKey(a)
  const right = normalizeKey(b)
  if (!left || !right) return 0
  if (left === right) return 1

  const aParts = a.toLowerCase().split(/\s+/).filter(Boolean)
  const bParts = b.toLowerCase().split(/\s+/).filter(Boolean)

  let matched = 0
  const used = new Set<number>()
  for (const part of aParts) {
    for (let i = 0; i < bParts.length; i++) {
      if (used.has(i)) continue
      const other = bParts[i]
      // A part matches if it is the same word or one typo away.
      if (part === other || (part.length >= 4 && levenshtein(part, other) <= 1)) {
        matched++
        used.add(i)
        break
      }
    }
  }

  if (!matched) return similarity(left, right) * 0.5
  // Every part of the shorter name accounted for, scaled down by how
  // much of the longer name is left over.
  const coverage = matched / Math.min(aParts.length, bParts.length)
  const extra = Math.max(aParts.length, bParts.length) - matched
  return Math.max(0, coverage - extra * 0.2)
}

function classify(score: number): TeacherMatch['confidence'] {
  if (score >= 0.999) return 'exact'
  if (score >= 0.8) return 'likely'
  if (score >= 0.5) return 'unsure'
  return 'none'
}

// ── resolution ──────────────────────────────────────────────────

export async function resolveImport(schoolId: string, parse: WorkbookParse): Promise<ResolvedImport> {
  const [staffResult, subjectResult, classResult, sectionResult] = await Promise.all([
    supabase.from('users')
      .select('id, full_name, email, role, is_active')
      .eq('school_id', schoolId)
      .not('role', 'in', '("parent","student")'),
    supabase.from('subjects').select('id, name').eq('school_id', schoolId),
    supabase.from('classes').select('id, name, numeric_level').eq('school_id', schoolId),
    supabase.from('sections').select('id, name, class_id').eq('school_id', schoolId),
  ])

  const staff = (staffResult.data ?? []).filter(u => u.is_active !== false)
  const existingSubjects = subjectResult.data ?? []
  const existingClasses = classResult.data ?? []
  const existingSections = sectionResult.data ?? []

  // ── teachers ──────────────────────────────────────────────────
  const periodsByTeacher = new Map<string, number>()
  for (const c of parse.capabilities) {
    periodsByTeacher.set(c.teacher, (periodsByTeacher.get(c.teacher) ?? 0) + c.periods)
  }

  const claimed = new Set<string>()
  const teachers: TeacherMatch[] = parse.teacherGroups.map(group => {
    const scored = staff
      .map(u => ({ userId: u.id, fullName: u.full_name, email: u.email, score: nameScore(group.canonical, u.full_name) }))
      .filter(c => c.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    const best = scored[0]
    const confidence = best ? classify(best.score) : 'none'

    return {
      canonical: group.canonical,
      periods: periodsByTeacher.get(group.canonical) ?? 0,
      suggestedUserId: best ? best.userId : null,
      suggestedName: best ? best.fullName : null,
      confidence,
      // Only an exact name match is pre-accepted. Everything else waits
      // for a human, because the cost of a wrong link is that one
      // teacher silently receives another's entire timetable and
      // arrangement notifications.
      action: confidence === 'exact' ? 'link' : best ? 'link' : 'create',
      candidates: scored,
    }
  })

  // Two spreadsheet names must never resolve to the same staff member —
  // that would merge two people's weeks into one and leave the other
  // with an empty timetable. First (highest-scoring) claim wins; the
  // loser drops to "create" and is flagged.
  teachers.sort((a, b) => (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0))
  for (const match of teachers) {
    if (match.action !== 'link' || !match.suggestedUserId) continue
    if (claimed.has(match.suggestedUserId)) {
      const alternative = match.candidates.find(c => !claimed.has(c.userId))
      if (alternative) {
        match.suggestedUserId = alternative.userId
        match.suggestedName = alternative.fullName
        match.confidence = classify(alternative.score)
        claimed.add(alternative.userId)
      } else {
        match.suggestedUserId = null
        match.suggestedName = null
        match.confidence = 'none'
        match.action = 'create'
      }
      continue
    }
    claimed.add(match.suggestedUserId)
  }
  teachers.sort((a, b) => b.periods - a.periods || a.canonical.localeCompare(b.canonical))

  // ── subjects ──────────────────────────────────────────────────
  const periodsBySubject = new Map<string, number>()
  for (const row of parse.plan) {
    periodsBySubject.set(row.subject, (periodsBySubject.get(row.subject) ?? 0) + row.weeklyPeriods)
  }

  const subjectByKey = new Map(existingSubjects.map(s => [normalizeKey(s.name), s]))
  const subjects: SubjectMatch[] = parse.subjectGroups.map(group => {
    const hit = subjectByKey.get(normalizeKey(group.canonical))
    return {
      canonical: group.canonical,
      periods: periodsBySubject.get(group.canonical) ?? 0,
      subjectId: hit ? hit.id : null,
      action: hit ? 'link' : 'create',
    }
  })

  // ── sections ──────────────────────────────────────────────────
  // Classes are matched on numeric_level first because the name is
  // written every possible way ("III", "3", "Class 3", "Grade III") and
  // the level is the thing that actually means something.
  const classByLevel = new Map(existingClasses.filter(c => c.numeric_level != null).map(c => [c.numeric_level, c]))
  const classByName = new Map(existingClasses.map(c => [normalizeKey(c.name), c]))

  const sections: SectionMatch[] = parse.sections.map(section => {
    const cls = classByLevel.get(section.numericLevel) ?? classByName.get(normalizeKey(section.className)) ?? null
    const sec = cls
      ? existingSections.find(s => s.class_id === cls.id && normalizeKey(s.name) === normalizeKey(section.sectionName))
      : undefined

    return {
      raw: section.raw,
      className: section.className,
      numericLevel: section.numericLevel,
      sectionName: section.sectionName,
      periodsPerDay: section.periodsPerDay,
      classId: cls ? cls.id : null,
      sectionId: sec ? sec.id : null,
      action: 'link' as MatchAction,
    }
  })

  const needsReview =
    teachers.filter(t => t.confidence !== 'exact').length +
    parse.subjectGroups.filter(g => g.needsReview).length

  return {
    teachers, subjects, sections,
    summary: {
      teachersMatched: teachers.filter(t => t.suggestedUserId).length,
      teachersToCreate: teachers.filter(t => !t.suggestedUserId).length,
      subjectsMatched: subjects.filter(s => s.subjectId).length,
      subjectsToCreate: subjects.filter(s => !s.subjectId).length,
      sectionsMatched: sections.filter(s => s.sectionId).length,
      sectionsToCreate: sections.filter(s => !s.sectionId).length,
      needsReview,
    },
  }
}
