import { describe, it, expect } from 'vitest'
import { formatTon, parseTon, toNano, NANO } from './ton-format'

describe('formatTon', () => {
  it('formats whole TON', () => {
    expect(formatTon(1_000_000_000n)).toBe('1')
    expect(formatTon('5000000000')).toBe('5')
  })

  it('formats fractions and trims zeros', () => {
    expect(formatTon(1_500_000_000n)).toBe('1.5')
    expect(formatTon(1_230_000_000n)).toBe('1.23')
    expect(formatTon(1_234_567_890n, 9)).toBe('1.23456789')
    expect(formatTon(1_234_567_890n, 2)).toBe('1.23')
  })

  it('handles zero and negatives', () => {
    expect(formatTon(0n)).toBe('0')
    expect(formatTon(-1_500_000_000n)).toBe('-1.5')
  })
})

describe('parseTon', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseTon('1')).toBe(NANO)
    expect(parseTon('1.5')).toBe(1_500_000_000n)
    expect(parseTon('0.000000001')).toBe(1n)
    expect(parseTon('1,5')).toBe(1_500_000_000n) // comma tolerance
  })

  it('rejects invalid input', () => {
    expect(() => parseTon('abc')).toThrow()
    expect(() => parseTon('-1')).toThrow()
    expect(() => parseTon('1.0000000001')).toThrow() // >9 decimals
    expect(() => parseTon('')).toThrow()
  })

  it('round-trips with formatTon', () => {
    for (const s of ['0.1', '12.345678901'.slice(0, 10), '999999']) {
      expect(formatTon(parseTon(s), 9)).toBe(s.replace(/\.?0+$/, '') || '0')
    }
  })
})

describe('toNano', () => {
  it('converts number literals', () => {
    expect(toNano(10)).toBe(10n * NANO)
    expect(toNano(0.5)).toBe(500_000_000n)
  })
})
