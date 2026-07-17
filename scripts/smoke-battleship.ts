/**
 * Live battleship smoke-test: queue two users, place fleets, player whose turn
 * it is shoots every cell methodically until someone wins. Verifies payout+ledger.
 * Usage: npx tsx scripts/smoke-battleship.ts
 */
import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { SignJWT } from 'jose'
import { io, type Socket } from 'socket.io-client'

const prisma = new PrismaClient()
const BASE = 'http://localhost:3000'

const FLEET = [
  { x: 0, y: 0, length: 4, horizontal: true },
  { x: 0, y: 2, length: 3, horizontal: true },
  { x: 5, y: 2, length: 3, horizontal: true },
  { x: 0, y: 4, length: 2, horizontal: true },
  { x: 4, y: 4, length: 2, horizontal: true },
  { x: 7, y: 4, length: 2, horizontal: true },
  { x: 0, y: 6, length: 1, horizontal: true },
  { x: 3, y: 6, length: 1, horizontal: true },
  { x: 6, y: 6, length: 1, horizontal: true },
  { x: 9, y: 6, length: 1, horizontal: true },
]

async function makeUser(tag: string, balance: bigint) {
  const suffix = randomBytes(3).toString('hex')
  const user = await prisma.user.create({
    data: {
      tonAddress: `0:${randomBytes(32).toString('hex')}`,
      nickname: `bs_${tag}_${suffix}`,
      depositMemo: `TA-B${tag.toUpperCase()}${suffix.toUpperCase()}`.slice(0, 20),
      clientSeed: randomBytes(16).toString('hex'),
      stats: { create: {} },
    },
  })
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: { userId: user.id, type: 'ADMIN_ADJUST', amount: balance, balanceAfter: balance },
    })
    await tx.user.update({ where: { id: user.id }, data: { balance } })
  })
  const token = await new SignJWT({ userId: user.id, tonAddress: user.tonAddress })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
  return { user, cookie: `session=${token}` }
}

interface BsState {
  matchId: string
  phase: string
  turnUserId: string | null
  yourShots: Array<{ x: number; y: number; hit: boolean }>
  youPlaced: boolean
}

async function main() {
  const a = await makeUser('a', 10_000_000_000n)
  const b = await makeUser('b', 10_000_000_000n)
  console.log('users:', a.user.nickname, b.user.nickname)

  const socks: Record<string, Socket> = {
    [a.user.id]: io(`${BASE}/battleship`, { transports: ['websocket'], extraHeaders: { Cookie: a.cookie } }),
    [b.user.id]: io(`${BASE}/battleship`, { transports: ['websocket'], extraHeaders: { Cookie: b.cookie } }),
  }

  let gameOver: { winnerUserId: string | null; payout: string } | null = null
  const placed = new Set<string>()

  function shoot(userId: string, s: BsState) {
    if (gameOver || s.phase !== 'IN_PROGRESS' || s.turnUserId !== userId) return
    // Shoot cells in fixed order, skipping already-shot ones.
    const done = new Set(s.yourShots.map((sh) => `${sh.x},${sh.y}`))
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (!done.has(`${x},${y}`)) {
          socks[userId].emit('bs:shoot', { matchId: s.matchId, x, y })
          return
        }
      }
    }
  }

  const finished = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no game_over within 120s')), 120_000)
    for (const [userId, sock] of Object.entries(socks)) {
      sock.on('bs:state', (s: BsState) => {
        if (s.phase === 'PLACING' && !s.youPlaced && !placed.has(userId)) {
          placed.add(userId)
          sock.emit('bs:place_ships', { matchId: s.matchId, ships: FLEET })
        }
        setTimeout(() => shoot(userId, s), 50)
      })
      sock.on('bs:game_over', (g: { winnerUserId: string | null; payout: string }) => {
        if (!gameOver) {
          gameOver = g
          clearTimeout(timeout)
          resolve()
        }
      })
      sock.on('bs:error', (e: { code: string }) => console.log(`error(${userId.slice(0, 6)}):`, e.code))
    }
  })

  await Promise.all(
    Object.values(socks).map((s) => new Promise<void>((res) => s.on('connect', () => res()))),
  )

  socks[a.user.id].emit('bs:queue', { betAmount: '1000000000' })
  await new Promise((r) => setTimeout(r, 300))
  socks[b.user.id].emit('bs:queue', { betAmount: '1000000000' })
  console.log('both queued; placing fleets and playing…')

  await finished
  const g = gameOver!
  console.log(`GAME OVER: winner=${g.winnerUserId?.slice(0, 8)} payout=${g.payout}`)
  if (g.payout !== '1900000000') throw new Error(`unexpected payout ${g.payout}`)
  console.log('✓ payout = pot − 5% fee')

  await new Promise((r) => setTimeout(r, 1000))
  for (const { user } of [a, b]) {
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const agg = await prisma.ledgerEntry.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    })
    if (fresh.balance !== (agg._sum.amount ?? 0n)) {
      throw new Error(`LEDGER INVARIANT VIOLATED for ${fresh.nickname}`)
    }
    console.log(`${fresh.nickname}: balance=${fresh.balance} (ledger OK)`)
  }

  Object.values(socks).forEach((s) => s.close())
  console.log('\nBATTLESHIP SMOKE TEST PASSED')
}

main()
  .catch((e) => {
    console.error('BATTLESHIP SMOKE TEST FAILED:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
