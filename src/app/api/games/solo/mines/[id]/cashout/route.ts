import { NextRequest, NextResponse } from 'next/server'
import { withErrors, requireUser, assertSameOrigin, enforceRateLimit } from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { MinesService } from '@/services/mines.service'

export const POST = withErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req)
    const session = await requireUser(req)
    enforceRateLimit('bet', session.userId, RATE_RULES.bet)
    const { id } = await ctx.params
    const game = await MinesService.cashout(session.userId, id)
    return NextResponse.json({ game })
  },
)
