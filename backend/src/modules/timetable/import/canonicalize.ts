// ═══════════════════════════════════════════════════════════════
// Name canonicalization for spreadsheet imports.
// ═══════════════════════════════════════════════════════════════
//
// A real school's timetable spreadsheet is not clean data. The one this
// was built against holds 35 distinct subject strings for ~20 actual
// subjects and 28 teacher strings for 27 actual people:
//
//   GK / Gk                          — case drift
//   SST / SSt                        — case drift
//   Computer Lab / LAB / "  LAB"     — case + doubled space
//   Remedial- English / Remedial-English
//   emedial- Science, medial- English — first characters eaten by a
//                                       merged-cell overwrite
//   "SST              Re"            — two cells collapsed into one
//   Krishna / Krishana               — one person, spelt two ways
//   "Vishnu/ Preeti"                 — two people in one cell
//
// Auto-merging all of that would be wrong: "Neha Singh", "Neha Mishra",
// "Neha Joshi" and "Neha sri" are four different people and no fuzzy
// matcher should be trusted to know that. So nothing here decides
// anything. It PROPOSES groups with a confidence, and everything below
// `exact` requires a human to confirm on the import review screen.
//
// Pure functions only — no DB, no I/O. Tested directly.

export type Confidence = 'exact' | 'high' | 'low'

export interface Variant {
  raw: string
  count: number
}

export interface NameGroup {
  /** The spelling proposed as the real one. */
  canonical: string
  variants: Variant[]
  confidence: Confidence
  /** Why this grouping was proposed, shown verbatim in the review UI. */
  reason: string
  /** True when a human must look at this before it can be committed. */
  needsReview: boolean
}

export interface SplitName {
  raw: string
  parts: string[]
}

// ── string helpers ──────────────────────────────────────────────

/** Case-folded, whitespace-collapsed, punctuation-stripped. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Trim and collapse internal runs of whitespace, preserving the school's own spelling. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1)
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/** 1.0 = identical, 0.0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest
}

// ── word-level repair ───────────────────────────────────────────

/**
 * Repair words whose leading characters were eaten.
 *
 * `emedial- Science` and `medial- English` are both the word "Remedial"
 * with the front chewed off by a merged-cell overwrite, and neither has
 * a correctly-spelt sibling to fuzzy-match against ("Remedial- Science"
 * does not appear anywhere in the file). What DOES exist is the word
 * itself, spelt correctly, in four other subjects — so the repair works
 * at word level against the whole corpus rather than at name level.
 *
 * The rule: a word is suspect if it is a proper suffix of a strictly
 * more common word elsewhere in the same corpus. Minimum length 3, so
 * that a genuine short word ("Re", "Ed", "PT") is never rewritten into
 * something longer on the strength of two characters.
 */
export function buildWordRepairs(names: string[]): Map<string, string> {
  const freq = new Map<string, { display: string; count: number }>()

  for (const name of names) {
    for (const word of tidy(name).split(/[\s\-/]+/)) {
      const key = normalizeKey(word)
      if (key.length < 3) continue
      const hit = freq.get(key)
      if (hit) hit.count++
      else freq.set(key, { display: word, count: 1 })
    }
  }

  const repairs = new Map<string, string>()
  const words = [...freq.entries()]

  for (const [key, entry] of words) {
    let best: { display: string; count: number } | null = null
    for (const [otherKey, other] of words) {
      if (otherKey === key) continue
      // Strictly more common, and this word is what's left after
      // chopping characters off its front.
      if (other.count <= entry.count) continue
      if (!otherKey.endsWith(key)) continue
      if (otherKey.length - key.length > 3) continue
      if (!best || other.count > best.count) best = other
    }
    if (best) repairs.set(key, best.display)
  }

  return repairs
}

function applyWordRepairs(name: string, repairs: Map<string, string>): string {
  if (!repairs.size) return tidy(name)
  return tidy(name)
    .split(/(\s+|[-/])/)
    .map(token => {
      const key = normalizeKey(token)
      const fixed = key.length >= 3 ? repairs.get(key) : undefined
      return fixed ?? token
    })
    .join('')
}

// ── grouping ────────────────────────────────────────────────────

interface GroupOptions {
  /** Levenshtein distance at which two names are proposed as one. */
  fuzzyDistance: number
  /** Both names must be at least this long before fuzzy matching applies. */
  minFuzzyLength: number
  /** Try the leading-characters-eaten repair pass. */
  repairTruncations: boolean
  /** Treat "A/ B" as two people sharing a slot rather than one name. */
  splitOnSlash: boolean
}

const SUBJECT_OPTS: GroupOptions = {
  fuzzyDistance: 1, minFuzzyLength: 4, repairTruncations: true, splitOnSlash: false,
}

// Teachers get a tighter net than subjects. "Neha Singh" / "Neha Mishra"
// / "Neha Joshi" / "Neha sri" are four people in this one school, and a
// loose threshold would quietly merge somebody's timetable into somebody
// else's. Distance 1 catches Krishna/Krishana and nothing else.
const TEACHER_OPTS: GroupOptions = {
  fuzzyDistance: 1, minFuzzyLength: 5, repairTruncations: false, splitOnSlash: true,
}

function groupNames(counts: Map<string, number>, opts: GroupOptions): NameGroup[] {
  const raws = [...counts.keys()]
  const repairs = opts.repairTruncations ? buildWordRepairs(raws) : new Map<string, string>()

  // Pass 1: exact match after normalisation. Case drift, doubled spaces
  // and stray punctuation all collapse here with no judgement involved.
  interface Bucket { key: string; variants: Variant[]; repaired: boolean; quals: Set<string> }
  const buckets = new Map<string, Bucket>()

  for (const raw of raws) {
    const repairedName = opts.repairTruncations ? applyWordRepairs(raw, repairs) : tidy(raw)
    const key = normalizeKey(repairedName)
    if (!key) continue
    const bucket = buckets.get(key) ?? { key, variants: [], repaired: false, quals: qualifiers(raw) }
    bucket.variants.push({ raw, count: counts.get(raw) ?? 0 })
    if (normalizeKey(raw) !== key) bucket.repaired = true
    buckets.set(key, bucket)
  }

  // Pass 2: fuzzy. Walk buckets from most to least common so a rare
  // misspelling attaches to the common spelling, never the reverse.
  const ordered = [...buckets.values()].sort(
    (a, b) => total(b.variants) - total(a.variants) || a.key.localeCompare(b.key),
  )

  const absorbedInto = new Map<string, string>()
  for (let i = 0; i < ordered.length; i++) {
    const candidate = ordered[i]
    if (absorbedInto.has(candidate.key)) continue
    for (let j = i + 1; j < ordered.length; j++) {
      const other = ordered[j]
      if (absorbedInto.has(other.key)) continue
      if (candidate.key.length < opts.minFuzzyLength || other.key.length < opts.minFuzzyLength) continue
      // "English" and "English (W)" are one edit apart and are not the
      // same subject. A differing bracketed qualifier vetoes the merge.
      if (!sameQualifiers(candidate.quals, other.quals)) continue
      if (levenshtein(candidate.key, other.key) > opts.fuzzyDistance) continue
      absorbedInto.set(other.key, candidate.key)
    }
  }

  const merged = new Map<string, Bucket>()
  for (const bucket of ordered) {
    const targetKey = absorbedInto.get(bucket.key) ?? bucket.key
    const target = merged.get(targetKey)
    if (target && target !== bucket) {
      target.variants.push(...bucket.variants)
    } else if (!target) {
      merged.set(targetKey, { ...bucket, variants: [...bucket.variants] })
    }
  }

  return [...merged.values()].map(bucket => {
    const variants = bucket.variants.sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw))
    const winner = variants[0]
    const wasFuzzed = [...absorbedInto.values()].includes(bucket.key)
    const repairedName = opts.repairTruncations ? applyWordRepairs(winner.raw, repairs) : tidy(winner.raw)
    const canonical = repairedName

    let confidence: Confidence = 'exact'
    let reason = 'Single spelling'

    if (variants.length > 1 && !wasFuzzed && !bucket.repaired) {
      confidence = 'exact'
      reason = `${variants.length} spellings that differ only in case, spacing or punctuation`
    }
    if (bucket.repaired) {
      confidence = 'high'
      reason = `Looks like characters were lost from the front of a word — reading it as "${canonical}"`
    }
    if (wasFuzzed) {
      confidence = 'high'
      reason = `${variants.length} spellings within one character of each other — likely one and the same`
    }
    // A name that still contains a run of whitespace after tidying, or a
    // stray fragment, is two cells that got collapsed into one. Nothing
    // automatic should touch that.
    if (looksTruncated(winner.raw)) {
      confidence = 'low'
      reason = 'Looks like two cells merged into one — needs a human to say what it should be'
    }

    return {
      canonical,
      variants,
      confidence,
      reason,
      needsReview: confidence !== 'exact',
    }
  }).sort((a, b) => total(b.variants) - total(a.variants) || a.canonical.localeCompare(b.canonical))
}

const total = (v: Variant[]) => v.reduce((sum, x) => sum + x.count, 0)

/**
 * Bracketed qualifiers, lower-cased: "English (W)" -> {"w"}.
 *
 * These are load-bearing and must never be fuzzed away. This school
 * runs both "English" and "English (W)" — written English is a separate
 * subject with its own weekly quota — and their normalised keys differ
 * by exactly one character, so plain edit distance merges them and
 * silently doubles one subject's period count while deleting another.
 */
function qualifiers(raw: string): Set<string> {
  const out = new Set<string>()
  for (const m of raw.matchAll(/[([{]([^)\]}]*)[)\]}]/g)) {
    const q = normalizeKey(m[1])
    if (q) out.add(q)
  }
  return out
}

function sameQualifiers(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const q of a) if (!b.has(q)) return false
  return true
}

/**
 * A cell holding two collapsed values. In the source file these show up
 * as a long run of spaces between fragments ("SST              Re",
 * "Sanskrit           Re"), which no real name contains.
 *
 * An earlier version also flagged any name ending in a short word, on
 * the theory that "…  Re" was a leftover fragment. That fired on
 * "Computer Lab", "Arti Pal", "Pooja Rai", "Neha sri" and "Remedial-
 * EVS" — five false alarms for one true one. A review screen that cries
 * wolf gets click-throughed, and then the real merged cell goes in
 * unnoticed, so the whitespace run is the only rule left.
 */
export function looksTruncated(raw: string): boolean {
  return /\s{4,}/.test(raw)
}

export function groupSubjects(counts: Map<string, number>): NameGroup[] {
  return groupNames(counts, SUBJECT_OPTS)
}

/**
 * Teacher names, with co-taught cells split out.
 *
 * "Vishnu/ Preeti" is one slot taught by two people. v1 records the
 * first as the assigned teacher and surfaces the pairing for review
 * rather than inventing a person called "Vishnu/ Preeti" who then shows
 * up in the staff list with three periods a week.
 */
export function groupTeachers(counts: Map<string, number>): {
  groups: NameGroup[]
  coTaught: SplitName[]
} {
  const singles = new Map<string, number>()
  const coTaught: SplitName[] = []

  for (const [raw, count] of counts) {
    if (TEACHER_OPTS.splitOnSlash && raw.includes('/')) {
      const parts = raw.split('/').map(tidy).filter(Boolean)
      if (parts.length > 1) {
        coTaught.push({ raw, parts })
        for (const part of parts) singles.set(part, (singles.get(part) ?? 0) + count)
        continue
      }
    }
    singles.set(tidy(raw), (singles.get(tidy(raw)) ?? 0) + count)
  }

  return { groups: groupNames(singles, TEACHER_OPTS), coTaught }
}

/** raw spelling -> canonical, for every variant in every group. */
export function resolutionMap(groups: NameGroup[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const group of groups) {
    for (const variant of group.variants) out.set(variant.raw, group.canonical)
  }
  return out
}
