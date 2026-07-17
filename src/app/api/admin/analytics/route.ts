import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)

  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000)
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

  const [dau, mau, totalUsers, wagered24h, deposits24h, withdrawals24h, fees, gamesByType] =
    await Promise.all([
      prisma.ledgerEntry
        .groupBy({ by: ['userId'], where: { createdAt: { gte: dayAgo } } })
        .then((r) => r.length),
      prisma.ledgerEntry
        .groupBy({ by: ['userId'], where: { createdAt: { gte: monthAgo } } })
        .then((r) => r.length),
      prisma.user.count(),
      prisma.ledgerEntry.aggregate({
        where: { type: 'BET', createdAt: { gte: dayAgo } },
        _sum: { amount: true },
      }),
      prisma.deposit.aggregate({
        where: { createdAt: { gte: dayAgo } },
        _sum: { amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: { createdAt: { gte: dayAgo }, status: { in: ['SENT', 'CONFIRMED'] } },
        _sum: { amount: true },
      }),
      Promise.all([
        prisma.wheelRound.aggregate({ _sum: { feeAmount: true } }),
        prisma.match.aggregate({ _sum: { feeAmount: true } }),
      ]),
      Promise.all([
        prisma.wheelRound.count({ where: { status: 'COMPLETED' } }),
        prisma.match.count({ where: { status: 'COMPLETED', gameType: 'BATTLESHIP' } }),
        prisma.match.count({ where: { status: 'COMPLETED', gameType: 'TICTACTOE' } }),
        prisma.soloGame.count({ where: { gameType: 'MINES', status: { not: 'ACTIVE' } } }),
        prisma.soloGame.count({ where: { gameType: 'PLINKO' } }),
      ]),
    ])

  const [wheelFees, matchFees] = fees
  const [wheel, battleship, tictactoe, mines, plinko] = gamesByType

  return NextResponse.json({
    dau,
    mau,
    totalUsers,
    turnover24h: (-(wagered24h._sum.amount ?? 0n)).toString(),
    deposits24h: (deposits24h._sum.amount ?? 0n).toString(),
    withdrawals24h: (withdrawals24h._sum.amount ?? 0n).toString(),
    feeRevenue: (
      (wheelFees._sum.feeAmount ?? 0n) + (matchFees._sum.feeAmount ?? 0n)
    ).toString(),
    games: { wheel, battleship, tictactoe, mines, plinko },
  })
})
