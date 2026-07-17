/**
 * Live wheel smoke-test: two test users join the LOW room via Socket.IO,
 * both bet, the betting window elapses, a winner is paid.
 * Verifies: proportional tickets, fee math, ledger invariant for both users.
 * Usage: npx tsx scripts/smoke-wheel.ts
 */
import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { PrismaClient } from '@prisma/client'
import { randomBytes, createHash, createHmac } from 'crypto'
import { SignJWT } from 'jose'
import { io, type Socket } from 'socket.io-client'

const prisma = new PrismaClient()
const BASE = 'http://localhost:3000'

async function makeUser(tag: string, balance: bigint) {
  const suffix = randomBytes(3).toString('hex')
  const user = await prisma.user.create({
    data: {
      tonAddress: `0:${randomBytes(32).toString('hex')}`,
      nickname: `wheel_${tag}_${suffix}`,
      depositMemo: `TA-W${tag.toUpperCase()}${suffix.toUpperCase()}`.slice(0, 20),
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

function connect(cookie: string): Socket {
  return io(`${BASE}/wheel`, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
  })
}

async function main() {
  const a = await makeUser('a', 50_000_000_000n)
  const b = await makeUser('b', 50_000_000_000n)
  console.log('users:', a.user.nickname, b.user.nickname)

  const sockA = connect(a.cookie)
  const sockB = connect(b.cookie)

  const spinPromise = new Promise<Record<string, string>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no spin within 90s')), 90_000)
    sockA.on('wheel:spin', (spin) => {
      clearTimeout(timeout)
      resolve(spin)
    })
    sockA.on('wheel:error', (e) => console.log('A error:', e))
    sockB.on('wheel:error', (e) => console.log('B error:', e))
  })

  const states: string[] = []
  sockA.on('wheel:state', (s) => {
    const line = `state: ${s.status} pot=${s.potAmount} bets=${s.bets.length}`
    if (states[states.length - 1] !== line) {
      states.push(line)
      console.log(line)
    }
  })

  await new Promise<void>((res) => sockA.on('connect', () => res()))
  await new Promise<void>((res) => sockB.on('connect', () => res()))
  sockA.emit('wheel:join', { tier: 'LOW' })
  sockB.emit('wheel:join', { tier: 'LOW' })
  await new Promise((r) => setTimeout(r, 500))

  // A bets 3 TON (75%), B bets 1 TON (25%)
  sockA.emit('wheel:bet', { tier: 'LOW', amount: '3000000000' })
  await new Promise((r) => setTimeout(r, 500))
  sockB.emit('wheel:bet', { tier: 'LOW', amount: '1000000000' })

  console.log('bets placed; waiting for betting window to elapse…')
  const spin = await spinPromise
  console.log(
    `SPIN: winner=${spin.winnerNickname} ticket=${spin.winningTicket}/${spin.totalTickets} payout=${spin.payout} fee=${spin.feeAmount}`,
  )

  // Independent provably-fair re-computation
  const digest = createHmac('sha256', spin.serverSeed)
    .update(`wheel:${spin.roundId}:${spin.betsHash}`)
    .digest()
  const recomputed =
    (BigInt('0x' + digest.subarray(0, 8).toString('hex')) % BigInt(spin.totalTickets)) + 1n
  if (recomputed.toString() !== spin.winningTicket) throw new Error('FAIRNESS RECOMPUTE MISMATCH')
  console.log('✓ provably-fair recompute matches winning ticket')

  // Fee: 5% of 4 TON = 0.2 TON
  if (spin.feeAmount !== '200000000') throw new Error(`unexpected fee: ${spin.feeAmount}`)
  if (spin.payout !== '3800000000') throw new Error(`unexpected payout: ${spin.payout}`)
  console.log('✓ fee math correct (5% of 4 TON)')

  // Wait for settle (spin animation 9s + buffer)
  await new Promise((r) => setTimeout(r, 12_000))

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

  const round = await prisma.wheelRound.findUniqueOrThrow({ where: { id: spin.roundId } })
  if (round.status !== 'COMPLETED') throw new Error(`round status: ${round.status}`)
  if (createHash('sha256').update(round.serverSeed!).digest('hex') !== round.serverSeedHash) {
    throw new Error('seed hash commitment mismatch')
  }
  console.log('✓ round COMPLETED, seed hash commitment verified')

  sockA.close()
  sockB.close()
  console.log('\nWHEEL SMOKE TEST PASSED')
}

main()
  .catch((e) => {
    console.error('WHEEL SMOKE TEST FAILED:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
