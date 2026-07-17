/**
 * Live tic-tac-toe smoke-test: two users queue at the same bet, play a full
 * match to a win, verify payout minus fee and ledger invariant.
 * Usage: npx tsx scripts/smoke-ttt.ts
 */
import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { SignJWT } from 'jose'
import { io, type Socket } from 'socket.io-client'

const prisma = new PrismaClient()
const BASE = 'http://localhost:3000'

async function makeUser(tag: string, balance: bigint) {
  const suffix = randomBytes(3).toString('hex')
  const user = await prisma.user.create({
    data: {
      tonAddress: `0:${randomBytes(32).toString('hex')}`,
      nickname: `ttt_${tag}_${suffix}`,
      depositMemo: `TA-T${tag.toUpperCase()}${suffix.toUpperCase()}`.slice(0, 20),
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

interface TttState {
  matchId: string
  board: (0 | 1 | 2)[]
  yourMark: 1 | 2
  turnUserId: string
  status: string
}

async function main() {
  const a = await makeUser('a', 10_000_000_000n)
  const b = await makeUser('b', 10_000_000_000n)
  console.log('users:', a.user.nickname, b.user.nickname)

  const socks: Record<string, Socket> = {
    [a.user.id]: io(`${BASE}/tictactoe`, { transports: ['websocket'], extraHeaders: { Cookie: a.cookie } }),
    [b.user.id]: io(`${BASE}/tictactoe`, { transports: ['websocket'], extraHeaders: { Cookie: b.cookie } }),
  }

  let gameOver: { winnerUserId: string | null; payout: string } | null = null
  const states = new Map<string, TttState>()

  // Deterministic strategy: current player takes the lowest free cell EXCEPT
  // player with mark 1 aims for the top row (0,1,2) — guarantees a win, no draw.
  function play(userId: string) {
    const s = states.get(userId)
    if (!s || gameOver) return
    if (s.turnUserId !== userId) return
    const mine = s.yourMark
    const free = s.board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0)
    let cell: number
    if (mine === 1) {
      // prefer top row, then anything
      cell = [0, 1, 2].find((c) => s.board[c] === 0) ?? free[0]
    } else {
      // avoid blocking the top row: prefer bottom cells
      cell = [8, 7, 6, 5, 4, 3].find((c) => s.board[c] === 0) ?? free[0]
    }
    socks[userId].emit('ttt:move', { matchId: s.matchId, cell })
  }

  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no game_over within 60s')), 60_000)
    for (const [userId, sock] of Object.entries(socks)) {
      sock.on('ttt:state', (s: TttState) => {
        states.set(userId, s)
        setTimeout(() => play(userId), 100)
      })
      sock.on('ttt:game_over', (g: { winnerUserId: string | null; payout: string }) => {
        if (!gameOver) {
          gameOver = g
          clearTimeout(timeout)
          resolve()
        }
      })
      sock.on('ttt:error', (e: { code: string }) => console.log(`error(${userId.slice(0, 6)}):`, e.code))
    }
  })

  await Promise.all(
    Object.values(socks).map((s) => new Promise<void>((res) => s.on('connect', () => res()))),
  )

  socks[a.user.id].emit('ttt:queue', { betAmount: '1000000000' })
  await new Promise((r) => setTimeout(r, 300))
  socks[b.user.id].emit('ttt:queue', { betAmount: '1000000000' })
  console.log('both queued at 1 TON…')

  await done
  const g = gameOver!
  console.log(`GAME OVER: winner=${g.winnerUserId?.slice(0, 8) ?? 'DRAW'} payout=${g.payout}`)

  // Winner takes 2 TON minus 5% = 1.9 TON
  if (g.winnerUserId) {
    if (g.payout !== '1900000000') throw new Error(`unexpected payout ${g.payout}`)
    console.log('✓ payout = pot − 5% fee')
  }

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
  console.log('\nTTT SMOKE TEST PASSED')
}

main()
  .catch((e) => {
    console.error('TTT SMOKE TEST FAILED:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
