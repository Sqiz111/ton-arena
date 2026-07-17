import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors } from '@/lib/api'

export const GET = withErrors(async () => {
  const entries = await prisma.ledgerEntry.findMany({
    where: { type: 'WIN' },
    orderBy: { createdAt: 'desc' },
    take: 12,
    include: { user: { select: { nickname: true } } },
  })
  return NextResponse.json({
    wins: entries.map((e) => ({
      nickname: e.user.nickname,
      gameType: e.refType ?? 'game',
      amount: e.amount.toString(),
    })),
  })
})
