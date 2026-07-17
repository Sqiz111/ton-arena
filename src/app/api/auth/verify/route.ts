import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthService } from '@/services/auth.service'
import {
  withErrors,
  parseBody,
  jsonError,
  enforceRateLimit,
  clientIp,
  assertSameOrigin,
} from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { signUserSession, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/jwt'
import { getEnv } from '@/lib/config'

const bodySchema = z.object({
  address: z.string().min(1),
  network: z.string(),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  proof: z.object({
    timestamp: z.number().int(),
    domain: z.object({ lengthBytes: z.number().int(), value: z.string() }),
    signature: z.string(),
    payload: z.string(),
    stateInit: z.string().optional(),
  }),
})

export const POST = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  enforceRateLimit('auth', clientIp(req), RATE_RULES.auth)
  const body = await parseBody(req, bodySchema)

  const env = getEnv()
  const expectedDomain = new URL(env.NEXT_PUBLIC_APP_URL).host
  const user = await AuthService.verifyAndLogin(body, expectedDomain, env.TON_NETWORK)
  if (!user) return jsonError(401, 'proof_invalid', 'TON proof verification failed')
  if (user.isBlocked) return jsonError(403, 'user_blocked')

  const token = await signUserSession({ userId: user.id, tonAddress: user.tonAddress })
  const res = NextResponse.json({
    user: {
      id: user.id,
      nickname: user.nickname,
      tonAddress: user.tonAddress,
      balance: user.balance.toString(),
    },
  })
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(30 * 24 * 3600))
  return res
})
