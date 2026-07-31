/**
 * PostgREST `or=` filter for the student search box.
 *
 * A single term matches first name, last name or admission number. The
 * previous version stopped there, which meant the most natural query of
 * all — a student's full name — matched nothing: "Aarav Sharma" was
 * tested against each column whole, and no single column ever contains
 * both words. Multi-word queries now pair the first word against one
 * name column and the rest against the other, in both orders, so
 * "Aarav Sharma" and "Sharma Aarav" both land.
 */
export function buildStudentSearchFilter(raw: string): string {
  // Commas, parens and dots are PostgREST filter syntax — leaving them
  // in lets a search string rewrite the query. `%` and `_` are ILIKE
  // wildcards; harmless but they make searches behave unpredictably.
  const clean = (s: string) => s.replace(/[,()%_.*]/g, ' ').trim()
  const full = clean(raw)
  if (!full) return 'id.is.null'   // matches nothing rather than everything

  const tokens = full.split(/\s+/).filter(Boolean)
  if (tokens.length === 1) {
    const t = tokens[0]
    return `first_name.ilike.%${t}%,last_name.ilike.%${t}%,admission_number.ilike.%${t}%`
  }

  const first = tokens[0]
  const rest = tokens.slice(1).join(' ')
  return [
    `and(first_name.ilike.%${first}%,last_name.ilike.%${rest}%)`,
    `and(first_name.ilike.%${rest}%,last_name.ilike.%${first}%)`,
    `admission_number.ilike.%${full}%`,
  ].join(',')
}
