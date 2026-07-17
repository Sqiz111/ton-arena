import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  withErrors,
  requireUser,
  parseBody,
  assertSameOrigin,
  enforceRateLimit,
  ApiError,
} from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { BalanceService } from '@/services/balance.service'
import { TonService } from '@/services/ton.service'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS } from '@/shared/constants'

const createSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, 'amount must be positive'),
  toAddress: z.string().min(1),
})

export const POST = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireUser(req)
  enforceRateLimit('withdrawal', session.userId, RATE_RULES.withdrawal)
  const body = await parseBody(req, createSchema)

  if (!TonService.isValidAddress(body.toAddress)) {
    throw new ApiError(400, 'invalid_address')
  }
  const amount = BigInt(body.amount)
  const minWithdrawal = await ConfigService.getBigInt(CONFIG_KEYS.minWithdrawal)
  if (amount < minWithdrawal) {
    throw new ApiError(400, 'below_min_withdrawal', `Minimum is ${minWithdrawal} nanoton`)
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user || user.isBlocked) throw new ApiError(403, 'user_blocked')

  const autoLimit = await ConfigService.getBigInt(CONFIG_KEYS.withdrawalAutoLimit)
  const status = amount > autoLimit ? 'APPROVAL_REQUIRED' : 'PENDING'

  // Debit immediately so pending withdrawals can't be double-spent.
  const withdrawal = await prisma.$transaction(async (tx) => {
    const w = await tx.withdrawal.create({
      data: { userId: session.userId, amount, toAddress: body.toAddress, status },
    })
    await BalanceService.applyEntry(tx, session.userId, 'WITHDRAWAL', -amount, {
      refType: 'withdrawal',
      refId: w.id,
    })
    return w
  })

  await prisma.auditLog.create({
    data: {
      actorType: 'user',
      actorId: session.userId,
      action: 'withdrawal.create',
      meta: { withdrawalId: withdrawal.id, amount: amount.toString(), status },
    },
  })

  return NextResponse.json({
    withdrawal: {
      id: withdrawal.id,
      amount: withdrawal.amount.toString(),
      toAddress: withdrawal.toAddress,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt.toISOString(),
    },
  })
})

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: w.amount.toString(),
      toAddress: w.toAddress,
      status: w.status,
      txHash: w.txHash,
      createdAt: w.createdAt.toISOString(),
    })),
  })
})
