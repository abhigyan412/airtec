import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// The engine's portability is its main asset: it moved from a
// Prisma/Fastify monorepo into this Express/Supabase app with no change
// beyond import extensions, and it can move again. That only holds while
// it stays a pure function of its input. One convenient
// `import { supabase }` inside generate.ts to "just look up a teacher"
// would end that quietly, and nothing else in the build would complain.
describe('engine purity', () => {
  const dir = __dirname
  const sources = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(3)
  })

  for (const file of sources) {
    it(`${file} imports nothing outside the engine`, () => {
      const src = readFileSync(join(dir, file), 'utf8')
      const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1])
      const external = specifiers.filter(s => !s.startsWith('./'))
      expect(external, `${file} must only import siblings, found: ${external.join(', ')}`).toEqual([])
    })
  }

  it('contains nothing that makes generation non-reproducible', () => {
    for (const file of sources) {
      const src = readFileSync(join(dir, file), 'utf8')
      // A stray Math.random() would defeat the seeded PRNG the whole
      // local search relies on: the same input would stop producing the
      // same timetable, and "regenerate and compare" would be nonsense.
      expect(src.includes('Math.random('), `${file} uses Math.random`).toBe(false)
      expect(src.includes('process.env'), `${file} reads process.env`).toBe(false)
    }
  })
})
