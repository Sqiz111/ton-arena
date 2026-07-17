import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrors, requireUser, parseBody, assertSameOrigin, enforceRateLimit } from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { MinesService } from '@/services/mines.service'

const revealSchema = z.object({ cell: z.number().int().min(0) })

export const POST = withErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(req)
    const session = await requireUser(req)
    enforceRateLimit('bet', session.userId, RATE_RULES.bet)
    const { id } = await ctx.params
    const body = await parseBody(req, revealSchema)
    const game = await MinesService.reveal(session.userId, id, body.cell)
    return NextResponse.json({ game })
  },
)
