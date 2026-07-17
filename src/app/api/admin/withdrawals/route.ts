import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withErrors, parseBody, assertSameOrigin, clientIp, ApiError } from '@/lib/api'
import { requireAdmin, auditAdmin } from '@/lib/admin'
import { BalanceService } from '@/services/balance.service'

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)
  const status = req.nextUrl.searchParams.get('status')
  const withdrawals = await prisma.withdrawal.findMany({
    where: status ? { status: status as never } : {},
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { nickname: true } } },
  })
  return NextResponse.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      nickname: w.user.nickname,
      amount: w.amount.toString(),
      toAddress: w.toAddress,
      status: w.status,
      txHash: w.txHash,
      failReason: w.failReason,
      createdAt: w.createdAt.toISOString(),
    })),
  })
})

const patchSchema = z.object({
  withdrawalId: z.string(),
  action: z.enum(['approve', 'reject']),
})

export const PATCH = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireAdmin(req)
  const body = await parseBody(req, patchSchema)

  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: body.withdrawalId } })
  if (!withdrawal) throw new ApiError(404, 'not_found')
  if (withdrawal.status !== 'APPROVAL_REQUIRED') throw new ApiError(409, 'not_awaiting_approval')

  if (body.action === 'approve') {
    // Move to PENDING — the processor loop picks it up.
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'PENDING' },
    })
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'REJECTED', processedAt: new Date() },
      })
      await BalanceService.applyEntry(tx, withdrawal.userId, 'WITHDRAWAL_REFUND', withdrawal.amount, {
        refType: 'withdrawal',
        refId: withdrawal.id,
      })
    })
  }

  await auditAdmin(
    session.adminId,
    `withdrawal.${body.action}`,
    { withdrawalId: withdrawal.id, amount: withdrawal.amount.toString() },
    clientIp(req),
  )
  return NextResponse.json({ ok: true })
})
