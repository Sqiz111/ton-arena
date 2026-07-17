import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser } from '@/lib/api'

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const deposits = await prisma.deposit.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    deposits: deposits.map((d) => ({
      id: d.id,
      amount: d.amount.toString(),
      txHash: d.txHash,
      createdAt: d.createdAt.toISOString(),
    })),
  })
})
