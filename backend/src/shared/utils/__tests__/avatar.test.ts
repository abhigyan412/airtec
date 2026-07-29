import { describe, it, expect } from 'vitest'
import { avatarSvg } from '../avatar'

// Pure and deterministic by design: the same student must keep the same
// face across seed re-runs, or every photo in the demo silently changes.

const parse = (svg: string) => ({
  isSvg: svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'),
  gradientIds: [...svg.matchAll(/id="(bg[^"]+)"/g)].map(m => m[1]),
  refs: [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]),
})

describe('avatarSvg', () => {
  it('produces a well-formed svg', () => {
    const svg = avatarSvg('Aarav Sharma', 1, 'male')
    expect(parse(svg).isSvg).toBe(true)
    expect(svg).toContain('viewBox="0 0 240 240"')
  })

  it('is deterministic — same inputs, byte-identical output', () => {
    expect(avatarSvg('Aarav Sharma', 7, 'male')).toBe(avatarSvg('Aarav Sharma', 7, 'male'))
  })

  it('varies with the seed', () => {
    expect(avatarSvg('Aarav Sharma', 1, 'male')).not.toBe(avatarSvg('Aarav Sharma', 2, 'male'))
  })

  it('renders visibly different portraits per gender', () => {
    expect(avatarSvg('X', 1, 'female')).not.toBe(avatarSvg('X', 1, 'male'))
  })

  it('treats anything other than female as the masculine variant', () => {
    const male = avatarSvg('X', 3, 'male')
    expect(avatarSvg('X', 3, 'other')).toBe(male)
    expect(avatarSvg('X', 3, null)).toBe(male)
    expect(avatarSvg('X', 3, undefined)).toBe(male)
  })

  it('references a gradient id it actually defines', () => {
    const { gradientIds, refs } = parse(avatarSvg('Y', 5, 'female'))
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(gradientIds).toContain(ref)
  })

  it('gives the two genders distinct gradient ids, so one does not inherit the other on a shared page', () => {
    const m = parse(avatarSvg('Z', 4, 'male')).gradientIds[0]
    const f = parse(avatarSvg('Z', 4, 'female')).gradientIds[0]
    expect(m).not.toBe(f)
  })

  it('escapes names that would otherwise break the markup', () => {
    const svg = avatarSvg('A & B <script>"\'', 1, 'male')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toMatch(/aria-label="[^"]*<script>/)
  })

  it('handles negative and fractional seeds without producing NaN', () => {
    for (const seed of [-1, -99, 3.7, 0]) {
      const svg = avatarSvg('N', seed, 'male')
      expect(svg).not.toContain('NaN')
      expect(svg).not.toContain('undefined')
      expect(parse(svg).isSvg).toBe(true)
    }
  })

  it('never emits NaN or undefined across a wide seed sweep', () => {
    // Also walks every hairstyle/patka/glasses/bindi branch.
    for (let i = 0; i < 80; i++) {
      for (const g of ['male', 'female']) {
        const svg = avatarSvg(`Student ${i}`, i, g)
        expect(svg).not.toContain('NaN')
        expect(svg).not.toContain('undefined')
      }
    }
  })

  it('covers the optional features across a seed range', () => {
    const svgs = Array.from({ length: 40 }, (_, i) => avatarSvg('S', i, i % 2 ? 'female' : 'male'))
    // Glasses appear on some, not all.
    const withGlasses = svgs.filter(s => s.includes('stroke="#334155"')).length
    expect(withGlasses).toBeGreaterThan(0)
    expect(withGlasses).toBeLessThan(svgs.length)
    // Bindi is female-only.
    const maleWithBindi = Array.from({ length: 40 }, (_, i) => avatarSvg('S', i, 'male'))
      .filter(s => s.includes('#B91C1C')).length
    expect(maleWithBindi).toBe(0)
  })
})
