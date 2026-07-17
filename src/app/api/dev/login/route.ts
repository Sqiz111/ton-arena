import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { withErrors, jsonError } from '@/lib/api'
import { signUserSession, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/jwt'

const START_BALANCE = 100_000_000_000n // 100 TON

/**
 * DEV-ONLY login: creates (or reuses) a test user with a prefunded balance and
 * sets a real session cookie — lets you test every game without a TON wallet.
 *
 * Guarded by ENABLE_DEV_LOGIN=true. NEVER enable in a public deployment.
 */
export const GET = withErrors(async (req: NextRequest) => {
  if (process.env.ENABLE_DEV_LOGIN !== 'true') {
    return jsonError(404, 'not_found')
  }

  const name = req.nextUrl.searchParams.get('name') ?? 'tester'
  const nickname = `dev_${name}`.slice(0, 20).replace(/[^a-zA-Z0-9_]/g, '_')

  let user = await prisma.user.findUnique({ where: { nickname } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        tonAddress: `0:${randomBytes(32).toString('hex')}`,
        nickname,
        depositMemo: `TA-DEV${randomBytes(3).toString('hex').toUpperCase()}`,
        clientSeed: randomBytes(16).toString('hex'),
        stats: { create: {} },
      },
    })
    // Prefund through the ledger so the balance invariant holds.
    await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          userId: user!.id,
          type: 'ADMIN_ADJUST',
          amount: START_BALANCE,
          balanceAfter: START_BALANCE,
          refType: 'dev_login',
        },
      })
      await tx.user.update({ where: { id: user!.id }, data: { balance: START_BALANCE } })
    })
  }

  const token = await signUserSession({ userId: user.id, tonAddress: user.tonAddress })
  const res = NextResponse.redirect(new URL('/', req.nextUrl.origin))
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(24 * 3600))
  return res
})
