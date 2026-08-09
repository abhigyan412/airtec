import { describe, it, expect } from 'vitest'
import { numberToWordsIndian, amountInWords } from '../amountInWords'

// This prints on a financial document, so the grouping has to be the Indian one.
// Getting it wrong is invisible in code review and obvious to the parent holding
// the receipt.

describe('numberToWordsIndian', () => {
  it('handles zero and the teens', () => {
    expect(numberToWordsIndian(0)).toBe('Zero')
    expect(numberToWordsIndian(7)).toBe('Seven')
    expect(numberToWordsIndian(13)).toBe('Thirteen')
    expect(numberToWordsIndian(19)).toBe('Nineteen')
  })

  it('handles the tens boundary', () => {
    expect(numberToWordsIndian(20)).toBe('Twenty')
    expect(numberToWordsIndian(21)).toBe('Twenty One')
    expect(numberToWordsIndian(90)).toBe('Ninety')
    expect(numberToWordsIndian(99)).toBe('Ninety Nine')
  })

  it('handles hundreds, with and without a remainder', () => {
    expect(numberToWordsIndian(100)).toBe('One Hundred')
    expect(numberToWordsIndian(101)).toBe('One Hundred One')
    expect(numberToWordsIndian(999)).toBe('Nine Hundred Ninety Nine')
  })

  it('groups by lakh, not by million', () => {
    // The whole reason this function exists rather than an off-the-shelf one.
    expect(numberToWordsIndian(100000)).toBe('One Lakh')
    expect(numberToWordsIndian(150000)).toBe('One Lakh Fifty Thousand')
    expect(numberToWordsIndian(1000000)).toBe('Ten Lakh')
    expect(numberToWordsIndian(150000)).not.toContain('Hundred Fifty Thousand')
  })

  it('groups by crore', () => {
    expect(numberToWordsIndian(10000000)).toBe('One Crore')
    expect(numberToWordsIndian(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight')
    expect(numberToWordsIndian(1000000000)).toBe('One Hundred Crore')
  })

  it('handles a realistic term fee', () => {
    expect(numberToWordsIndian(4500)).toBe('Four Thousand Five Hundred')
    expect(numberToWordsIndian(18440)).toBe('Eighteen Thousand Four Hundred Forty')
  })

  it('ignores the fractional part', () => {
    expect(numberToWordsIndian(4500.99)).toBe('Four Thousand Five Hundred')
  })
})

describe('amountInWords', () => {
  it('reads as a receipt line', () => {
    expect(amountInWords(4500)).toBe('Rupees Four Thousand Five Hundred Only')
  })

  it('spells out paise rather than dropping them', () => {
    // A receipt that says "Four Thousand Five Hundred Only" for 4500.50 is a
    // document that disagrees with its own total.
    expect(amountInWords(4500.5)).toBe('Rupees Four Thousand Five Hundred and Fifty Paise Only')
    expect(amountInWords(99.05)).toBe('Rupees Ninety Nine and Five Paise Only')
  })

  it('rounds to two places, as the amount is stored', () => {
    expect(amountInWords(100.004)).toBe('Rupees One Hundred Only')
    expect(amountInWords(100.006)).toBe('Rupees One Hundred and One Paise Only')
  })

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only')
  })

  it('marks a negative amount rather than silently dropping the sign', () => {
    expect(amountInWords(-250)).toBe('Minus Rupees Two Hundred Fifty Only')
  })
})
