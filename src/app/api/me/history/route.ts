import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser } from '@/lib/api'

const querySchema = z.object({
  cursor: z.string().optional(),
  type: z
    .enum(['DEPOSIT', 'WITHDRAWAL', 'WITHDRAWAL_REFUND', 'BET', 'WIN', 'REFUND', 'ADMIN_ADJUST'])
    .optional(),
})

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const params = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams))

  const entries = await prisma.ledgerEntry.findMany({
    where: { userId: session.userId, ...(params.type ? { type: params.type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
    ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
  })

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount.toString(),
      balanceAfter: e.balanceAfter.toString(),
      refType: e.refType,
      refId: e.refId,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor: entries.length === 30 ? entries[entries.length - 1].id : null,
  })
})
