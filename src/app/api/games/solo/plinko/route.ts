import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrors, requireUser, parseBody, assertSameOrigin, enforceRateLimit } from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { PlinkoService } from '@/services/plinko.service'

const playSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  risk: z.enum(['low', 'medium', 'high']),
  rows: z.union([z.literal(8), z.literal(12), z.literal(16)]),
})

export const POST = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireUser(req)
  enforceRateLimit('bet', session.userId, RATE_RULES.bet)
  const body = await parseBody(req, playSchema)
  const result = await PlinkoService.play(session.userId, BigInt(body.amount), {
    risk: body.risk,
    rows: body.rows,
  })
  return NextResponse.json({ result })
})
