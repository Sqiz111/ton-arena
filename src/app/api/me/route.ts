import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser, parseBody, assertSameOrigin, ApiError } from '@/lib/api'

function userDto(user: {
  id: string
  nickname: string
  avatarUrl: string | null
  tonAddress: string
  depositMemo: string
  balance: bigint
  xp: number
  level: number
  locale: string
  createdAt: Date
  stats: {
    gamesPlayed: number
    gamesWon: number
    totalWagered: bigint
    totalWon: bigint
    totalLost: bigint
    biggestWin: bigint
  } | null
}) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    tonAddress: user.tonAddress,
    depositMemo: user.depositMemo,
    balance: user.balance.toString(),
    xp: user.xp,
    level: user.level,
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
    stats: user.stats
      ? {
          gamesPlayed: user.stats.gamesPlayed,
          gamesWon: user.stats.gamesWon,
          winRate:
            user.stats.gamesPlayed > 0
              ? Math.round((user.stats.gamesWon / user.stats.gamesPlayed) * 100)
              : 0,
          totalWagered: user.stats.totalWagered.toString(),
          totalWon: user.stats.totalWon.toString(),
          totalLost: user.stats.totalLost.toString(),
          biggestWin: user.stats.biggestWin.toString(),
        }
      : null,
  }
}

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { stats: true },
  })
  if (!user) throw new ApiError(401, 'unauthorized')
  return NextResponse.json({ user: userDto(user) })
})

const patchSchema = z.object({
  nickname: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  avatarUrl: z.string().url().max(300).nullable().optional(),
  locale: z.enum(['ru', 'en']).optional(),
  rotateClientSeed: z.boolean().optional(),
})

export const PATCH = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireUser(req)
  const body = await parseBody(req, patchSchema)

  const data: Record<string, unknown> = {}
  if (body.nickname !== undefined) data.nickname = body.nickname
  if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl
  if (body.locale !== undefined) data.locale = body.locale
  if (body.rotateClientSeed) {
    const { randomBytes } = await import('crypto')
    data.clientSeed = randomBytes(16).toString('hex')
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
      include: { stats: true },
    })
    return NextResponse.json({ user: userDto(user) })
  } catch {
    throw new ApiError(409, 'nickname_taken')
  }
})
