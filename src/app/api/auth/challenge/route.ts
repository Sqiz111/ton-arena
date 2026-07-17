import { NextRequest, NextResponse } from 'next/server'
import { AuthService } from '@/services/auth.service'
import { withErrors, enforceRateLimit, clientIp } from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'

export const POST = withErrors(async (req: NextRequest) => {
  enforceRateLimit('auth', clientIp(req), RATE_RULES.auth)
  const payload = await AuthService.createChallenge()
  return NextResponse.json({ payload })
})
