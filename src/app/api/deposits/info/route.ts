import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser, ApiError } from '@/lib/api'
import { TonService } from '@/services/ton.service'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS } from '@/shared/constants'

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user) throw new ApiError(401, 'unauthorized')

  const [address, minDeposit] = await Promise.all([
    TonService.getHotWalletAddress().catch(() => null),
    ConfigService.get(CONFIG_KEYS.minDeposit),
  ])
  if (!address) throw new ApiError(503, 'deposits_unavailable', 'Hot wallet is not configured')

  return NextResponse.json({
    address,
    memo: user.depositMemo,
    minDeposit,
  })
})
