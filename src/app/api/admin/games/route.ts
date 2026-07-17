import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)
  const type = req.nextUrl.searchParams.get('type') ?? 'wheel'

  if (type === 'wheel') {
    const rounds = await prisma.wheelRound.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { bets: true } } },
    })
    return NextResponse.json({
      games: rounds.map((r) => ({
        id: r.id,
        tier: r.tier,
        roundNumber: r.roundNumber,
        status: r.status,
        pot: r.potAmount.toString(),
        fee: r.feeAmount.toString(),
        bets: r._count.bets,
        winnerUserId: r.winnerUserId,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  }

  if (type === 'matches') {
    const matches = await prisma.match.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({
      games: matches.map((m) => ({
        id: m.id,
        gameType: m.gameType,
        status: m.status,
        pot: m.potAmount.toString(),
        fee: m.feeAmount.toString(),
        winnerUserId: m.winnerUserId,
        createdAt: m.createdAt.toISOString(),
      })),
    })
  }

  const solo = await prisma.soloGame.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { nickname: true } } },
  })
  return NextResponse.json({
    games: solo.map((g) => ({
      id: g.id,
      gameType: g.gameType,
      status: g.status,
      nickname: g.user.nickname,
      bet: g.betAmount.toString(),
      payout: g.payoutAmount.toString(),
      createdAt: g.createdAt.toISOString(),
    })),
  })
})
