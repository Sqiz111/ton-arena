import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withErrors, parseBody, assertSameOrigin, clientIp, ApiError } from '@/lib/api'
import { requireAdmin, auditAdmin } from '@/lib/admin'
import { BalanceService } from '@/services/balance.service'

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { nickname: { contains: q, mode: 'insensitive' } },
            { tonAddress: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {},
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { stats: true },
  })
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      tonAddress: u.tonAddress,
      balance: u.balance.toString(),
      isBlocked: u.isBlocked,
      level: u.level,
      gamesPlayed: u.stats?.gamesPlayed ?? 0,
      totalWagered: u.stats?.totalWagered.toString() ?? '0',
      createdAt: u.createdAt.toISOString(),
    })),
  })
})

const patchSchema = z.object({
  userId: z.string(),
  action: z.enum(['block', 'unblock', 'adjust_balance']),
  amount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
})

export const PATCH = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireAdmin(req)
  const body = await parseBody(req, patchSchema)

  switch (body.action) {
    case 'block':
    case 'unblock': {
      await prisma.user.update({
        where: { id: body.userId },
        data: { isBlocked: body.action === 'block' },
      })
      break
    }
    case 'adjust_balance': {
      if (!body.amount) throw new ApiError(400, 'amount_required')
      await BalanceService.apply(body.userId, 'ADMIN_ADJUST', BigInt(body.amount), {
        refType: 'admin',
        refId: session.adminId,
      })
      break
    }
  }

  await auditAdmin(
    session.adminId,
    `user.${body.action}`,
    { userId: body.userId, amount: body.amount },
    clientIp(req),
  )
  return NextResponse.json({ ok: true })
})
