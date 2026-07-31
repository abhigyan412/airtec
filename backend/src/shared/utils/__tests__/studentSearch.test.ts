import { describe, it, expect } from 'vitest'
import { buildStudentSearchFilter } from '../studentSearch'

// Pure function, so these are real unit tests. It earns them: the
// original version silently returned nothing for a student's full name —
// the single most likely thing anyone types into the box.

describe('buildStudentSearchFilter', () => {
  describe('single term', () => {
    it('matches first name, last name and admission number', () => {
      const f = buildStudentSearchFilter('Aarav')
      expect(f).toBe('first_name.ilike.%Aarav%,last_name.ilike.%Aarav%,admission_number.ilike.%Aarav%')
    })

    it('trims surrounding whitespace', () => {
      expect(buildStudentSearchFilter('  Aarav  ')).toContain('first_name.ilike.%Aarav%')
    })

    it('handles an admission number', () => {
      expect(buildStudentSearchFilter('ADM20260001')).toContain('admission_number.ilike.%ADM20260001%')
    })
  })

  describe('multi-word — the case that used to return nothing', () => {
    it('pairs first word against first_name and the rest against last_name', () => {
      const f = buildStudentSearchFilter('Aarav Sharma')
      expect(f).toContain('and(first_name.ilike.%Aarav%,last_name.ilike.%Sharma%)')
    })

    it('also tries the reverse order, so "Sharma Aarav" matches', () => {
      const f = buildStudentSearchFilter('Aarav Sharma')
      expect(f).toContain('and(first_name.ilike.%Sharma%,last_name.ilike.%Aarav%)')
    })

    it('still tries the whole string as an admission number', () => {
      expect(buildStudentSearchFilter('Aarav Sharma')).toContain('admission_number.ilike.%Aarav Sharma%')
    })

    it('treats three or more words as first + remainder', () => {
      const f = buildStudentSearchFilter('Ram Kumar Verma')
      expect(f).toContain('and(first_name.ilike.%Ram%,last_name.ilike.%Kumar Verma%)')
    })

    it('collapses repeated whitespace between words', () => {
      expect(buildStudentSearchFilter('Aarav    Sharma'))
        .toContain('and(first_name.ilike.%Aarav%,last_name.ilike.%Sharma%)')
    })
  })

  describe('input that could break the query', () => {
    // Commas, parens and dots are PostgREST filter syntax. Left in, a
    // search box becomes a query-rewriting primitive.
    it.each([
      ['comma', 'a,b'],
      ['parenthesis', 'a)or(b'],
      ['dot', 'a.eq.b'],
      ['percent wildcard', 'a%b'],
      ['underscore wildcard', 'a_b'],
      ['asterisk', 'a*b'],
    ])('strips %s', (_label, input) => {
      const f = buildStudentSearchFilter(input)
      const values = f.match(/ilike\.%([^%]*)%/g) ?? []
      for (const v of values) {
        expect(v).not.toMatch(/[,()%_*]/.source.replace('%', ''))
      }
      expect(f).not.toContain('eq.b)')
    })

    it('never emits a bare .eq. operator from user input', () => {
      expect(buildStudentSearchFilter('x.eq.y')).not.toMatch(/[^i]\.eq\./)
    })
  })

  describe('empty input', () => {
    // Returning an empty filter would match the entire school.
    it.each([['empty string', ''], ['spaces', '   '], ['punctuation only', ',,,...']])(
      'matches nothing for %s', (_label, input) => {
        expect(buildStudentSearchFilter(input)).toBe('id.is.null')
      })
  })
})
