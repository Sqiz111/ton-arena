import { describe, it, expect } from 'vitest'

/**
 * Fee math invariants (pure math mirrored from WheelRoomManager/MatchService).
 * DB-backed BalanceService behaviour is covered by integration once Postgres is up.
 */
function computeFee(pot: bigint, feeBps: bigint): { fee: bigint; payout: bigint } {
  const fee = (pot * feeBps) / 10_000n
  return { fee, payout: pot - fee }
}

describe('platform fee math', () => {
  it('5% fee on a 100 TON pot', () => {
    const pot = 100_000_000_000n
    const { fee, payout } = computeFee(pot, 500n)
    expect(fee).toBe(5_000_000_000n)
    expect(payout).toBe(95_000_000_000n)
    expect(fee + payout).toBe(pot) // nothing is lost
  })

  it('rounds down in favour of the winner never exceeding the pot', () => {
    // Odd pot that does not divide evenly
    const pot = 333n
    const { fee, payout } = computeFee(pot, 500n)
    expect(fee).toBe(16n) // floor(333*0.05)
    expect(payout).toBe(317n)
    expect(fee + payout).toBe(pot)
  })

  it('zero fee passes the whole pot through', () => {
    const { fee, payout } = computeFee(12_345n, 0n)
    expect(fee).toBe(0n)
    expect(payout).toBe(12_345n)
  })

  it('fee is monotonic in bps', () => {
    const pot = 1_000_000_000n
    let prev = -1n
    for (const bps of [0n, 100n, 250n, 500n, 1000n, 2000n]) {
      const { fee } = computeFee(pot, bps)
      expect(fee).toBeGreaterThan(prev)
      prev = fee
    }
  })
})

describe('multiplier payout math (bigint scaling)', () => {
  function payoutFor(bet: bigint, multiplier: number): bigint {
    return (bet * BigInt(Math.round(multiplier * 10000))) / 10000n
  }

  it('scales through the 1e4 fixed point without float drift', () => {
    expect(payoutFor(1_000_000_000n, 1.2375)).toBe(1_237_500_000n)
    expect(payoutFor(1_000_000_000n, 0.5)).toBe(500_000_000n)
    expect(payoutFor(1_000_000_000n, 1000)).toBe(1_000_000_000_000n)
  })

  it('never pays more than multiplier implies', () => {
    const bet = 999_999_999n
    const payout = payoutFor(bet, 2.0001)
    expect(payout).toBeLessThanOrEqual((bet * 20001n) / 10000n)
  })
})
