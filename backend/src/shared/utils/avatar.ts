// School-portrait avatar generator.
//
// Deliberately illustrated rather than photographic. These records carry
// fabricated Aadhaar numbers, addresses, fee defaults and attendance, and
// attaching a real person's face — a real child's, in most rows — to that
// is not something a stock licence covers. Synthetic portraits also mean
// a demo never depends on a third-party image host being reachable.
//
// Styled as an Indian school ID photo: navy blazer, white collar, striped
// tie, varied skin tones and hairstyles. Everything derives from a numeric
// seed, so a given student always gets the same face across re-runs.

const SKIN = ['#F3D4B5', '#EDC29B', '#DFA97C', '#CE8F63', '#B4784F', '#96603C', '#7A4B2E']
const HAIR = ['#12100E', '#1C1613', '#24190F', '#2E2018', '#3A281B', '#0E0C0B']
const BG: [string, string][] = [
  ['#EEF2FF', '#E0E7FF'], ['#ECFDF5', '#D1FAE5'], ['#FEF3C7', '#FDE68A'],
  ['#FCE7F3', '#FBCFE8'], ['#E0F2FE', '#BAE6FD'], ['#F3E8FF', '#E9D5FF'],
  ['#FFE4E6', '#FECDD3'], ['#F0FDFA', '#CCFBF1'],
]
const TIE = ['#9F1239', '#1E3A8A', '#7F1D1D', '#065F46']
const BLAZER = ['#1E3A8A', '#1F2937', '#312E81', '#164E63']
const RIBBON = ['#DC2626', '#DB2777', '#7C3AED', '#0891B2']

const at = <T,>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length]

/**
 * A 240×240 school-ID style portrait.
 * `gender` selects the hairstyle set; anything other than 'female'
 * renders the masculine variants (including an occasional patka).
 */
export function avatarSvg(name: string, seed: number, gender?: string | null): string {
  const female = gender === 'female'
  const s = Math.abs(Math.trunc(seed))
  const skin = at(SKIN, s * 3 + 1)
  const hair = at(HAIR, s * 5 + 2)
  const [bg1, bg2] = at(BG, s)
  const tie = at(TIE, s * 7)
  const blazer = at(BLAZER, s * 11)
  const ribbon = at(RIBBON, s * 13)
  // Gradient ids must be unique per document when several avatars share
  // a page, or they all inherit the first one's background.
  const uid = `a${s % 100000}${female ? 'f' : 'm'}`

  const variant = s % 3
  const hasBindi = female && s % 4 === 0
  const hasPatka = !female && s % 9 === 0   // Sikh boys' topknot cover
  const hasGlasses = s % 7 === 0

  let hairBack = ''
  let hairFront = ''

  if (female) {
    if (variant === 0) {
      hairBack = `
    <path d="M60 112 q-8 60 4 92 h22 q-14-46-8-92 z" fill="${hair}"/>
    <path d="M180 112 q8 60 -4 92 h-22 q14-46 8-92 z" fill="${hair}"/>
    <circle cx="72" cy="198" r="7" fill="${ribbon}"/>
    <circle cx="168" cy="198" r="7" fill="${ribbon}"/>`
    } else if (variant === 1) {
      hairBack = `<path d="M58 110 q-4 66 8 104 h28 q-20-52-14-104 z M182 110 q4 66 -8 104 h-28 q20-52 14-104 z" fill="${hair}"/>`
    } else {
      hairBack = `<path d="M172 74 q30 10 26 44 q-4 30 -22 40 q10-42 -10-70 z" fill="${hair}"/>`
    }
    hairFront = `<path d="M58 106 q4-56 62-56 t62 56 q-12-32-62-32 t-62 32 z" fill="${hair}"/>`
  } else if (hasPatka) {
    const cloth = at(TIE, s * 5)
    hairFront = `<path d="M62 104 q6-54 58-54 t58 54 q-8-16-22-22 q-14 8-36 8 t-36-8 q-14 6-22 22 z" fill="${hair}"/>
    <path d="M64 98 q8-52 56-52 t56 52 q-14-34-56-34 t-56 34 z" fill="${cloth}"/>
    <ellipse cx="120" cy="46" rx="20" ry="14" fill="${cloth}"/>`
  } else if (variant === 0) {
    hairFront = `<path d="M64 100 q6-50 56-50 t56 50 q-14-28-56-28 t-56 28 z" fill="${hair}"/>`
  } else if (variant === 1) {
    hairFront = `<path d="M62 102 q8-52 58-52 t58 52 q-16-30-44-30 q-22 0-30 12 q-8 8-42 18 z" fill="${hair}"/>`
  } else {
    hairFront = `<path d="M64 100 q4-52 56-52 t56 52 q-10-18-22-16 q-6-14-18-10 q-8-12-20-6 q-12-8-20 4 q-12-2-16 12 q-10-2-16 16 z" fill="${hair}"/>`
  }

  const glasses = hasGlasses ? `
  <g fill="none" stroke="#334155" stroke-width="2.5" opacity="0.85">
    <circle cx="103" cy="117" r="13"/>
    <circle cx="137" cy="117" r="13"/>
    <path d="M116 117 h8"/><path d="M90 114 l-14-4"/><path d="M150 114 l14-4"/>
  </g>` : ''
  const bindi = hasBindi ? `<circle cx="120" cy="96" r="3.6" fill="#B91C1C"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="${escapeXml(name)}">
  <defs>
    <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="240" height="240" fill="url(#bg${uid})"/>
  ${hairBack}

  <!-- neck -->
  <path d="M104 168 h32 v22 q-16 12-32 0 z" fill="${skin}"/>
  <path d="M104 176 q16 12 32 0 v6 q-16 12-32 0 z" fill="${shade(skin, 22)}"/>

  <!-- blazer, collar, tie -->
  <path d="M36 240 q6-52 84-58 q78 6 84 58 z" fill="${blazer}"/>
  <path d="M92 186 q28 26 56 0 l10 5 -38 30 -38-30 z" fill="#FFFFFF"/>
  <path d="M120 196 l12 8 -6 34 -12 0 -6-34 z" fill="${tie}"/>
  <path d="M114 204 h12 l-2 8 h-8 z" fill="${shade(tie, 30)}"/>

  <!-- head -->
  <ellipse cx="120" cy="118" rx="51" ry="57" fill="${skin}"/>
  <ellipse cx="69" cy="122" rx="7.5" ry="11" fill="${skin}"/>
  <ellipse cx="171" cy="122" rx="7.5" ry="11" fill="${skin}"/>
  ${hairFront}
  ${bindi}

  <!-- brows -->
  <path d="M92 ${100 + (s % 3)} q11-5 22 0" fill="none" stroke="${hair}" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M126 ${100 + (s % 3)} q11-5 22 0" fill="none" stroke="${hair}" stroke-width="4.5" stroke-linecap="round"/>

  <!-- eyes -->
  <ellipse cx="103" cy="117" rx="7" ry="6" fill="#FFFFFF"/>
  <ellipse cx="137" cy="117" rx="7" ry="6" fill="#FFFFFF"/>
  <circle cx="103" cy="118" r="3.6" fill="#2A1D14"/>
  <circle cx="137" cy="118" r="3.6" fill="#2A1D14"/>
  <circle cx="104.4" cy="116.4" r="1.2" fill="#FFFFFF"/>
  <circle cx="138.4" cy="116.4" r="1.2" fill="#FFFFFF"/>
  ${glasses}

  <!-- nose + mouth -->
  <path d="M120 126 q-4 11 3 12" fill="none" stroke="${shade(skin, 28)}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M${112 - (s % 2)} 150 q${8 + (s % 3)} ${6 + (s % 2)} ${16 + (s % 3) * 2} 0" fill="none" stroke="#A05046" stroke-width="3" stroke-linecap="round"/>
</svg>`
}

/** Darker version of a hex colour, for shading. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 255) - amount)
  const g = Math.max(0, ((n >> 8) & 255) - amount)
  const b = Math.max(0, (n & 255) - amount)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
}
