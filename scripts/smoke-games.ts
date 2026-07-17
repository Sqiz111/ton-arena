/**
 * Live smoke-test: creates a test user with balance, signs a session cookie,
 * plays Mines and Plinko through the real HTTP API, then checks the ledger
 * invariant (sum of ledger == cached balance).
 * Usage: npx tsx scripts/smoke-games.ts
 */
import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { SignJWT } from 'jose'

const prisma = new PrismaClient()
const BASE = 'http://localhost:3000'

async function api(path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      Cookie: cookie,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  // 1. Test user with 100 TON starting balance (ledger-consistent via ADMIN_ADJUST)
  const suffix = randomBytes(3).toString('hex')
  const user = await prisma.user.create({
    data: {
      tonAddress: `0:${randomBytes(32).toString('hex')}`,
      nickname: `smoketest_${suffix}`,
      depositMemo: `TA-SMOKE${suffix.toUpperCase()}`,
      clientSeed: randomBytes(16).toString('hex'),
      stats: { create: {} },
    },
  })
  const START = 100_000_000_000n
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: { userId: user.id, type: 'ADMIN_ADJUST', amount: START, balanceAfter: START },
    })
    await tx.user.update({ where: { id: user.id }, data: { balance: START } })
  })

  const token = await new SignJWT({ userId: user.id, tonAddress: user.tonAddress })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!))
  const cookie = `session=${token}`

  // 2. /api/me
  const me = await api('/api/me', cookie)
  console.log('me:', me.user.nickname, 'balance:', me.user.balance)
  if (me.user.balance !== START.toString()) throw new Error('balance mismatch')

  // 3. Mines: start, reveal cells until bust or 3 safe, then cashout
  const start = await api('/api/games/solo/mines', cookie, {
    amount: '1000000000',
    gridSize: 5,
    mines: 5,
  })
  let game = start.game
  console.log('mines started:', game.id, 'hash:', game.serverSeedHash.slice(0, 16))
  for (let cell = 0; cell < 25 && game.status === 'ACTIVE' && game.revealed.length < 3; cell++) {
    if (game.revealed.includes(cell)) continue
    const r = await api(`/api/games/solo/mines/${game.id}/reveal`, cookie, { cell })
    game = r.game
    console.log(`  reveal ${cell}: status=${game.status} multiplier=${game.multiplier}`)
  }
  if (game.status === 'ACTIVE') {
    const c = await api(`/api/games/solo/mines/${game.id}/cashout`, cookie, {})
    game = c.game
    console.log('  cashed out:', game.payout, 'seed revealed:', !!game.serverSeed)
  } else {
    console.log('  busted; mines revealed:', game.mines?.length)
  }

  // 4. Plinko: 3 drops across risk levels
  for (const risk of ['low', 'medium', 'high'] as const) {
    const r = await api('/api/games/solo/plinko', cookie, {
      amount: '500000000',
      risk,
      rows: 12,
    })
    console.log(
      `plinko ${risk}: slot=${r.result.slot} multiplier=${r.result.multiplier} payout=${r.result.payout}`,
    )
  }

  // 5. Ledger invariant
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  const agg = await prisma.ledgerEntry.aggregate({
    where: { userId: user.id },
    _sum: { amount: true },
  })
  const ledgerSum = agg._sum.amount ?? 0n
  console.log('cached balance:', fresh.balance.toString(), '| ledger sum:', ledgerSum.toString())
  if (fresh.balance !== ledgerSum) throw new Error('LEDGER INVARIANT VIOLATED')
  console.log('✓ ledger invariant holds')

  // 6. History endpoints
  const hist = await api('/api/me/history', cookie)
  const games = await api('/api/me/games', cookie)
  console.log(`history entries: ${hist.entries.length}, games: ${games.games.length}`)

  console.log('\nSMOKE TEST PASSED')
}

main()
  .catch((e) => {
    console.error('SMOKE TEST FAILED:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
