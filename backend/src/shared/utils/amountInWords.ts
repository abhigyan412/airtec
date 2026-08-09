// Rupees in words, Indian numbering.
//
// A fee receipt is a financial document and Indian schools print the amount in
// words on it — it is what makes a receipt hard to alter after the fact. That
// means lakh and crore, not million and billion: 150000 is "One Lakh Fifty
// Thousand", not "One Hundred Fifty Thousand".
//
// Kept out of the receipt template so it can be tested on its own; the grouping
// rule (last three digits, then pairs) is easy to get subtly wrong and hard to
// notice on a printed page.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** 0–99. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = ONES[n % 10]
  return o ? `${t} ${o}` : t
}

/** 0–999. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (!h) return twoDigits(rest)
  return rest ? `${ONES[h]} Hundred ${twoDigits(rest)}` : `${ONES[h]} Hundred`
}

/**
 * Whole rupees in words, without the currency noun.
 *
 * Groups as the Indian system does: the last three digits, then successive pairs
 * — crore, lakh, thousand, hundred.
 */
export function numberToWordsIndian(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'Zero'

  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000

  // Crores above 99 keep grouping in the same system rather than rolling into a
  // new word — 1,00,00,00,000 reads as "One Hundred Crore".
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))

  return parts.join(' ')
}

/**
 * The line printed on a receipt.
 *
 * Paise are spelled out separately because a receipt that says "Rupees Four
 * Thousand Five Hundred Only" for ₹4,500.50 is wrong in a way an auditor will
 * flag. Rounded to two places first, matching how the amount is stored.
 */
export function amountInWords(value: number): string {
  const negative = value < 0
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)

  const head = `Rupees ${numberToWordsIndian(rupees)}`
  const tail = paise > 0 ? ` and ${twoDigits(paise)} Paise` : ''
  return `${negative ? 'Minus ' : ''}${head}${tail} Only`
}
