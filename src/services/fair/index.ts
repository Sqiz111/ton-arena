/**
 * Provably-fair primitives. Pure and isomorphic — used by the server for
 * outcome generation and by the /fair verifier page in the browser.
 *
 * Derivations:
 *   stream(serverSeed, message) = HMAC_SHA256(serverSeed, `${message}:0`) ||
 *                                 HMAC_SHA256(serverSeed, `${message}:1`) || …
 */
import { createHash, createHmac, randomBytes } from 'crypto'
import { BASE_RTP_BPS } from '@/shared/constants'

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacSha256(serverSeed: string, message: string): Buffer {
  return createHmac('sha256', serverSeed).update(message).digest()
}

export function generateServerSeed(): { seed: string; hash: string } {
  const seed = randomBytes(32).toString('hex')
  return { seed, hash: sha256Hex(seed) }
}

/** Infinite deterministic byte stream keyed by (serverSeed, message). */
export class HmacByteStream {
  private counter = 0
  private buffer: Buffer = Buffer.alloc(0)
  private offset = 0

  constructor(
    private serverSeed: string,
    private message: string,
  ) {}

  nextByte(): number {
    if (this.offset >= this.buffer.length) {
      this.buffer = hmacSha256(this.serverSeed, `${this.message}:${this.counter++}`)
      this.offset = 0
    }
    return this.buffer[this.offset++]
  }

  /** Uniform integer in [0, maxExclusive) via 4-byte rejection sampling. */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0 || maxExclusive > 0x7fffffff) throw new Error('bad range')
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
    for (;;) {
      let v = 0
      for (let i = 0; i < 4; i++) v = v * 256 + this.nextByte()
      if (v < limit) return v % maxExclusive
    }
  }
}

/** Fisher–Yates shuffle of [0..n-1] driven by the HMAC stream. */
export function fairShuffle(n: number, serverSeed: string, message: string): number[] {
  const arr = Array.from({ length: n }, (_, i) => i)
  const stream = new HmacByteStream(serverSeed, message)
  for (let i = n - 1; i > 0; i--) {
    const j = stream.nextInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ───────────────────────── Mines ─────────────────────────

export interface MinesConfig {
  gridSize: number // cells per side (5 => 25 cells)
  mines: number
  /** RTP in basis points, snapshotted at game start; defaults to BASE_RTP_BPS. */
  rtpBps?: number
}

/** Positions of mines for a game — first `mines` cells of the fair shuffle. */
export function minesPlacement(
  cfg: MinesConfig,
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Set<number> {
  const cells = cfg.gridSize * cfg.gridSize
  const order = fairShuffle(cells, serverSeed, `mines:${clientSeed}:${nonce}`)
  return new Set(order.slice(0, cfg.mines))
}

/** Multiplier after `revealed` safe cells. */
export function minesMultiplier(cfg: MinesConfig, revealed: number): number {
  const cells = cfg.gridSize * cfg.gridSize
  const safe = cells - cfg.mines
  if (revealed <= 0) return 1
  if (revealed > safe) throw new Error('too many reveals')
  let m = (cfg.rtpBps ?? BASE_RTP_BPS) / 10000
  for (let i = 0; i < revealed; i++) {
    m *= (cells - i) / (safe - i)
  }
  return Math.round(m * 10000) / 10000
}

// ───────────────────────── Plinko ─────────────────────────

/**
 * Multiplier tables live in shared/ so the client UI can import them without
 * pulling node:crypto into the bundle.
 */
export { PLINKO_MULTIPLIERS, type PlinkoRisk } from '@/shared/plinko-tables'
import { PLINKO_MULTIPLIERS as TABLES, type PlinkoRisk as Risk } from '@/shared/plinko-tables'

export interface PlinkoConfig {
  risk: Risk
  rows: number // 8 | 12 | 16
  /** RTP in basis points, snapshotted at play time; defaults to BASE_RTP_BPS. */
  rtpBps?: number
}

/** Deterministic ball path: array of 0 (left) / 1 (right) per row. */
export function plinkoPath(
  cfg: PlinkoConfig,
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number[] {
  const stream = new HmacByteStream(serverSeed, `plinko:${clientSeed}:${nonce}`)
  return Array.from({ length: cfg.rows }, () => stream.nextByte() & 1)
}

export function plinkoSlot(path: number[]): number {
  return path.reduce<number>((acc, d) => acc + d, 0)
}

/**
 * Multiplier tables (base ~99% RTP) per risk level and row count.
 * Symmetric; index = slot (0..rows). A non-default cfg.rtpBps rescales the
 * base table proportionally (e.g. 9500 => ~95% RTP).
 */
export function plinkoMultiplier(cfg: PlinkoConfig, slot: number): number {
  const table = TABLES[cfg.risk]?.[cfg.rows]
  if (!table) throw new Error('unsupported plinko config')
  const m = table[slot]
  if (m === undefined) throw new Error('slot out of range')
  const scaled = m * ((cfg.rtpBps ?? BASE_RTP_BPS) / BASE_RTP_BPS)
  return Math.round(scaled * 10000) / 10000
}

// ───────────────────────── Wheel ─────────────────────────

/**
 * Winning ticket in [1, totalTickets]. The message binds the outcome to the
 * final bet list (betsHash), so it is unknowable before betting closes.
 */
export function wheelWinningTicket(
  serverSeed: string,
  roundId: string,
  betsHash: string,
  totalTickets: bigint,
): bigint {
  if (totalTickets <= 0n) throw new Error('empty pot')
  const digest = hmacSha256(serverSeed, `wheel:${roundId}:${betsHash}`)
  const num = BigInt('0x' + digest.subarray(0, 8).toString('hex'))
  return (num % totalTickets) + 1n
}

/** Deterministic hash of the ordered bet list, published at lock time. */
export function wheelBetsHash(bets: Array<{ id: string; userId: string; amount: bigint }>): string {
  const canonical = bets.map((b) => `${b.id}:${b.userId}:${b.amount}`).join('|')
  return sha256Hex(canonical)
}

/** First-turn coin flip for PvP matches. */
export function fairCoinFlip(serverSeed: string, message: string): 0 | 1 {
  return (hmacSha256(serverSeed, message)[0] & 1) as 0 | 1
}
