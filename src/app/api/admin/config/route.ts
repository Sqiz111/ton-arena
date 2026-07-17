import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withErrors, parseBody, assertSameOrigin, clientIp, ApiError } from '@/lib/api'
import { requireAdmin, auditAdmin } from '@/lib/admin'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS, CONFIG_DEFAULTS } from '@/shared/constants'

const EDITABLE_KEYS = new Set<string>(
  Object.values(CONFIG_KEYS).filter((k) => k !== CONFIG_KEYS.depositCursor),
)

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)
  const rows = await prisma.platformConfig.findMany()
  const values = new Map(rows.map((r) => [r.key, r.value]))
  const config: Record<string, string> = {}
  for (const key of EDITABLE_KEYS) {
    config[key] = values.get(key) ?? CONFIG_DEFAULTS[key] ?? ''
  }
  return NextResponse.json({ config })
})

const putSchema = z.object({
  key: z.string(),
  value: z.string().regex(/^\d+$/, 'value must be a non-negative integer string'),
})

export const PUT = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  const session = await requireAdmin(req)
  if (session.role !== 'SUPERADMIN') throw new ApiError(403, 'superadmin_only')
  const body = await parseBody(req, putSchema)
  if (!EDITABLE_KEYS.has(body.key)) throw new ApiError(400, 'unknown_key')

  // Sanity bound for the fee: max 20%.
  if (body.key === CONFIG_KEYS.platformFeeBps && parseInt(body.value, 10) > 2000) {
    throw new ApiError(400, 'fee_too_high')
  }

  // Sanity bounds for RTP: 50%–100%.
  const RTP_KEYS: string[] = [CONFIG_KEYS.minesRtpBps, CONFIG_KEYS.plinkoRtpBps]
  if (RTP_KEYS.includes(body.key)) {
    const v = parseInt(body.value, 10)
    if (v < 5000 || v > 10000) throw new ApiError(400, 'rtp_out_of_range')
  }

  await ConfigService.set(body.key, body.value)
  await auditAdmin(session.adminId, 'config.update', { key: body.key, value: body.value }, clientIp(req))
  return NextResponse.json({ ok: true })
})
