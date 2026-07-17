/**
 * Nanoton <-> human TON conversion. All amounts cross API boundaries as
 * strings of nanotons; BigInt never enters JSON.
 */

export const NANO = 1_000_000_000n

/** "1234567890" -> "1.23" (trims trailing zeros, keeps up to 9 decimals) */
export function formatTon(nano: string | bigint, maxDecimals = 2): string {
  const value = typeof nano === 'bigint' ? nano : BigInt(nano)
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / NANO
  const frac = abs % NANO
  let fracStr = frac.toString().padStart(9, '0').slice(0, Math.max(maxDecimals, 0))
  fracStr = fracStr.replace(/0+$/, '')
  const result = fracStr ? `${whole}.${fracStr}` : whole.toString()
  return negative ? `-${result}` : result
}

/**
 * Parse user input like "1.5" into nanotons ("1500000000").
 * Throws on invalid input or more than 9 decimals.
 */
export function parseTon(input: string): bigint {
  const trimmed = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error('Invalid TON amount')
  }
  const [whole, frac = ''] = trimmed.split('.')
  return BigInt(whole) * NANO + BigInt(frac.padEnd(9, '0'))
}

/** Convenience: TON number literal -> nanotons (for constants/config only). */
export function toNano(ton: number): bigint {
  return parseTon(ton.toString())
}
