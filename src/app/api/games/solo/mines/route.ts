import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  withErrors,
  requireUser,
  parseBody,
  assertSameOrigin,
  enforceRateLimit,
} from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { MinesService } from '@/services/mines.service'

const startSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  gridSize: z.number().int(),
  mines: z.number().int(),
})

export const POST = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireUser(req)
  enforceRateLimit('bet', session.userId, RATE_RULES.bet)
  const body = await parseBody(req, startSchema)
  const game = await MinesService.start(session.userId, BigInt(body.amount), {
    gridSize: body.gridSize,
    mines: body.mines,
  })
  return NextResponse.json({ game })
})

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const game = await MinesService.getActive(session.userId)
  return NextResponse.json({ game })
})
