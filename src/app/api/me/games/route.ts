import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser } from '@/lib/api'

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)

  const [solo, wheelBets, matches] = await Promise.all([
    prisma.soloGame.findMany({
      where: { userId: session.userId, status: { not: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.wheelBet.findMany({
      where: { userId: session.userId, round: { status: 'COMPLETED' } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { round: true },
    }),
    prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: session.userId }, { player2Id: session.userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ])

  const games = [
    ...solo.map((g) => ({
      id: g.id,
      gameType: g.gameType,
      bet: g.betAmount.toString(),
      payout: g.payoutAmount.toString(),
      won: g.payoutAmount > g.betAmount,
      createdAt: g.createdAt.toISOString(),
    })),
    ...wheelBets.map((b) => ({
      id: b.id,
      gameType: 'WHEEL' as const,
      bet: b.amount.toString(),
      payout:
        b.round.winnerUserId === session.userId
          ? (b.round.potAmount - b.round.feeAmount).toString()
          : '0',
      won: b.round.winnerUserId === session.userId,
      createdAt: b.createdAt.toISOString(),
    })),
    ...matches.map((m) => ({
      id: m.id,
      gameType: m.gameType,
      bet: m.betAmount.toString(),
      payout:
        m.winnerUserId === session.userId
          ? (m.potAmount - m.feeAmount).toString()
          : m.winnerUserId === null
            ? m.betAmount.toString() // draw refund
            : '0',
      won: m.winnerUserId === session.userId,
      createdAt: m.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50)

  return NextResponse.json({ games })
})
