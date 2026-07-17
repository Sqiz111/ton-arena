import { NextResponse } from 'next/server'
import { withErrors } from '@/lib/api'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS } from '@/shared/constants'

/** Public (unauthenticated) subset of platform config needed by game UIs. */
export const GET = withErrors(async () => {
  const [minesRtpBps, plinkoRtpBps] = await Promise.all([
    ConfigService.getInt(CONFIG_KEYS.minesRtpBps),
    ConfigService.getInt(CONFIG_KEYS.plinkoRtpBps),
  ])
  return NextResponse.json({ minesRtpBps, plinkoRtpBps })
})
