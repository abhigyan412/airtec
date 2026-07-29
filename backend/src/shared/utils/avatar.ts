// Flat-illustration avatar generator.
//
// Deliberately self-hosted SVG rather than an avatar API (DiceBear,
// randomuser, pravatar): these get uploaded to Supabase Storage once at
// seed time, so a demo never depends on a third-party image host being
// reachable — and there's no licensing question about faces.
//
// Everything is derived from a numeric seed, so the same student always
// gets the same face across re-runs.

const SKIN = ['#F5D0B0', '#EDBE9A', '#DDA47B', '#C68863', '#A96A45', '#8D5524']
const HAIR = ['#1F1A17', '#2E2119', '#3D2B1F', '#4A3728', '#120D0A', '#5C4033']
const BG = ['#EEF2FF', '#ECFDF5', '#FEF3C7', '#FCE7F3', '#E0F2FE', '#F3E8FF', '#FFE4E6', '#F0FDFA']
const SHIRT_M = ['#3B82F6', '#0EA5E9', '#6366F1', '#14B8A6', '#475569', '#0F766E']
const SHIRT_F = ['#EC4899', '#8B5CF6', '#F43F5E', '#A855F7', '#DB2777', '#7C3AED']

const at = <T,>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length]

/**
 * A 240×240 head-and-shoulders portrait.
 * `gender` picks the hair silhouette and shirt palette; anything other
 * than 'female' renders the masculine variant.
 */
export function avatarSvg(name: string, seed: number, gender?: string | null): string {
  const female = gender === 'female'
  const skin = at(SKIN, seed * 3 + 1)
  const hair = at(HAIR, seed * 5 + 2)
  const bg = at(BG, seed)
  const shirt = at(female ? SHIRT_F : SHIRT_M, seed * 7)

  // Small deterministic variations so a class doesn't look cloned.
  const smile = 6 + (seed % 3)
  const browY = 96 + (seed % 3)
  const hairTuft = seed % 3

  const longHair = `
    <path d="M62 108 q-6 62 6 96 h24 q-16-44-10-96 z" fill="${hair}"/>
    <path d="M178 108 q6 62 -6 96 h-24 q16-44 10-96 z" fill="${hair}"/>`
  const bun = hairTuft === 2 ? `<circle cx="120" cy="46" r="14" fill="${hair}"/>` : ''
  const fringe = female
    ? `<path d="M60 104 q4-52 60-52 t60 52 q-10-30-60-30 t-60 30 z" fill="${hair}"/>`
    : hairTuft === 1
      ? `<path d="M64 100 q6-48 56-48 t56 48 q-14-26-56-26 t-56 26 z" fill="${hair}"/>`
      : `<path d="M64 100 q6-48 56-48 t56 48 q-12-30-56-30 t-56 30 z" fill="${hair}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="${escapeXml(name)}">
  <rect width="240" height="240" fill="${bg}"/>
  ${female ? longHair : ''}
  ${bun}
  <!-- shoulders -->
  <path d="M40 240 q6-56 80-64 q74 8 80 64 z" fill="${shirt}"/>
  <path d="M104 176 h32 v18 q-16 10-32 0 z" fill="${skin}"/>
  <!-- collar -->
  <path d="M104 176 l16 18 l16-18 l10 6 l-26 22 l-26-22 z" fill="#FFFFFF" opacity="0.85"/>
  <!-- head -->
  <ellipse cx="120" cy="118" rx="52" ry="58" fill="${skin}"/>
  <!-- ears -->
  <ellipse cx="68" cy="120" rx="8" ry="12" fill="${skin}"/>
  <ellipse cx="172" cy="120" rx="8" ry="12" fill="${skin}"/>
  ${fringe}
  <!-- brows -->
  <rect x="92" y="${browY}" width="22" height="5" rx="2.5" fill="${hair}"/>
  <rect x="126" y="${browY}" width="22" height="5" rx="2.5" fill="${hair}"/>
  <!-- eyes -->
  <circle cx="103" cy="116" r="6" fill="#FFFFFF"/>
  <circle cx="137" cy="116" r="6" fill="#FFFFFF"/>
  <circle cx="103" cy="117" r="3.4" fill="#26201C"/>
  <circle cx="137" cy="117" r="3.4" fill="#26201C"/>
  <!-- nose + mouth -->
  <path d="M120 124 q-4 12 3 13" fill="none" stroke="${shade(skin)}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M${120 - smile} 148 q${smile} ${5 + (seed % 3)} ${smile * 2} 0" fill="none" stroke="#9A4A3C" stroke-width="3" stroke-linecap="round"/>
</svg>`
}

/** Slightly darker version of a hex colour, for soft shading. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 255) - 40)
  const g = Math.max(0, ((n >> 8) & 255) - 35)
  const b = Math.max(0, (n & 255) - 30)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}
