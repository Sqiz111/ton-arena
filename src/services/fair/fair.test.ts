import { describe, it, expect } from 'vitest'
import {
  sha256Hex,
  hmacSha256,
  HmacByteStream,
  fairShuffle,
  minesPlacement,
  minesMultiplier,
  plinkoPath,
  plinkoSlot,
  plinkoMultiplier,
  PLINKO_MULTIPLIERS,
  wheelWinningTicket,
  wheelBetsHash,
  generateServerSeed,
} from './index'

const SEED = 'a'.repeat(64)

describe('primitives', () => {
  it('sha256 known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hmac is deterministic', () => {
    expect(hmacSha256(SEED, 'x').toString('hex')).toBe(hmacSha256(SEED, 'x').toString('hex'))
    expect(hmacSha256(SEED, 'x')).not.toEqual(hmacSha256(SEED, 'y'))
  })

  it('generateServerSeed hash commitment matches', () => {
    const { seed, hash } = generateServerSeed()
    expect(sha256Hex(seed)).toBe(hash)
  })

  it('byte stream is deterministic and unbounded', () => {
    const a = new HmacByteStream(SEED, 'm')
    const b = new HmacByteStream(SEED, 'm')
    for (let i = 0; i < 100; i++) expect(a.nextByte()).toBe(b.nextByte())
  })

  it('nextInt is within range', () => {
    const s = new HmacByteStream(SEED, 'range')
    for (let i = 0; i < 1000; i++) {
      const v = s.nextInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })
})

describe('fairShuffle', () => {
  it('is a permutation and deterministic', () => {
    const p1 = fairShuffle(25, SEED, 'msg')
    const p2 = fairShuffle(25, SEED, 'msg')
    expect(p1).toEqual(p2)
    expect([...p1].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i))
  })

  it('differs across messages', () => {
    expect(fairShuffle(25, SEED, 'a')).not.toEqual(fairShuffle(25, SEED, 'b'))
  })
})

describe('mines', () => {
  const cfg = { gridSize: 5, mines: 5 }

  it('places exactly N distinct mines deterministically', () => {
    const m1 = minesPlacement(cfg, SEED, 'client', 0)
    const m2 = minesPlacement(cfg, SEED, 'client', 0)
    expect(m1.size).toBe(5)
    expect([...m1]).toEqual([...m2])
    for (const cell of m1) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThan(25)
    }
  })

  it('nonce changes placement', () => {
    expect([...minesPlacement(cfg, SEED, 'client', 0)]).not.toEqual(
      [...minesPlacement(cfg, SEED, 'client', 1)],
    )
  })

  it('multiplier grows with each reveal and starts near 1', () => {
    expect(minesMultiplier(cfg, 0)).toBe(1)
    let prev = 1
    for (let k = 1; k <= 20; k++) {
      const m = minesMultiplier(cfg, k)
      expect(m).toBeGreaterThan(prev)
      prev = m
    }
    // 25 cells / 5 mines: first reveal = 0.99 * 25/20 = 1.2375
    expect(minesMultiplier(cfg, 1)).toBeCloseTo(1.2375, 4)
  })

  it('rtpBps rescales the multiplier', () => {
    // 0.95 * 25/20 = 1.1875
    expect(minesMultiplier({ ...cfg, rtpBps: 9500 }, 1)).toBeCloseTo(1.1875, 4)
    // Default matches explicit 9900
    expect(minesMultiplier({ ...cfg, rtpBps: 9900 }, 3)).toBe(minesMultiplier(cfg, 3))
  })

  it('rejects revealing more than safe cells', () => {
    expect(() => minesMultiplier(cfg, 21)).toThrow()
  })
})

describe('plinko', () => {
  it('path is deterministic, slot = sum of rights', () => {
    const cfg = { risk: 'medium' as const, rows: 12 }
    const p1 = plinkoPath(cfg, SEED, 'client', 5)
    const p2 = plinkoPath(cfg, SEED, 'client', 5)
    expect(p1).toEqual(p2)
    expect(p1).toHaveLength(12)
    expect(plinkoSlot(p1)).toBe(p1.filter((d) => d === 1).length)
  })

  it('multiplier tables are symmetric with correct length', () => {
    for (const risk of ['low', 'medium', 'high'] as const) {
      for (const rows of [8, 12, 16]) {
        const table = PLINKO_MULTIPLIERS[risk][rows]
        expect(table).toHaveLength(rows + 1)
        for (let i = 0; i < table.length; i++) {
          expect(table[i]).toBe(table[table.length - 1 - i])
        }
      }
    }
  })

  it('RTP is within sane bounds (90–101%) for every config', () => {
    // slot follows Binomial(rows, 0.5)
    for (const risk of ['low', 'medium', 'high'] as const) {
      for (const rows of [8, 12, 16]) {
        const table = PLINKO_MULTIPLIERS[risk][rows]
        let rtp = 0
        for (let k = 0; k <= rows; k++) {
          // C(rows,k) / 2^rows
          let c = 1
          for (let i = 0; i < k; i++) c = (c * (rows - i)) / (i + 1)
          rtp += (c / 2 ** rows) * table[k]
        }
        expect(rtp).toBeGreaterThan(0.9)
        expect(rtp).toBeLessThan(1.01)
      }
    }
  })

  it('multiplier lookup validates config', () => {
    expect(() => plinkoMultiplier({ risk: 'low', rows: 9 }, 0)).toThrow()
    expect(plinkoMultiplier({ risk: 'high', rows: 8 }, 0)).toBe(29)
  })

  it('rtpBps rescales the base table proportionally', () => {
    // 29 * (4950 / 9900) = 14.5
    expect(plinkoMultiplier({ risk: 'high', rows: 8, rtpBps: 4950 }, 0)).toBe(14.5)
    // Default matches explicit 9900
    expect(plinkoMultiplier({ risk: 'medium', rows: 12, rtpBps: 9900 }, 6)).toBe(
      plinkoMultiplier({ risk: 'medium', rows: 12 }, 6),
    )
  })
})

describe('wheel', () => {
  it('winning ticket is in [1, total] and deterministic', () => {
    const total = 100_000_000_000n
    const t1 = wheelWinningTicket(SEED, 'round1', 'hash1', total)
    const t2 = wheelWinningTicket(SEED, 'round1', 'hash1', total)
    expect(t1).toBe(t2)
    expect(t1).toBeGreaterThanOrEqual(1n)
    expect(t1).toBeLessThanOrEqual(total)
  })

  it('betsHash binds outcome to the bet list', () => {
    const bets = [
      { id: 'b1', userId: 'u1', amount: 1_000_000_000n },
      { id: 'b2', userId: 'u2', amount: 2_000_000_000n },
    ]
    const h1 = wheelBetsHash(bets)
    const h2 = wheelBetsHash([...bets].reverse())
    expect(h1).not.toBe(h2)
    expect(wheelWinningTicket(SEED, 'r', h1, 100n)).not.toBe(
      wheelWinningTicket(SEED, 'r', h2, 100n),
    )
  })

  it('distribution is roughly proportional to bet size', () => {
    // 1000 rounds with two players 25%/75%: winner frequency should track share.
    const total = 4n
    let smallWins = 0
    for (let i = 0; i < 1000; i++) {
      const ticket = wheelWinningTicket(SEED, `round-${i}`, 'h', total)
      if (ticket === 1n) smallWins++ // player A owns ticket 1 only (25%... of 4)
    }
    expect(smallWins).toBeGreaterThan(180)
    expect(smallWins).toBeLessThan(320)
  })
})
