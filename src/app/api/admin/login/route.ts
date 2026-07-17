import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import argon2 from 'argon2'
import { prisma } from '@/lib/prisma'
import {
  withErrors,
  parseBody,
  jsonError,
  enforceRateLimit,
  clientIp,
  assertSameOrigin,
} from '@/lib/api'
import { RATE_RULES } from '@/lib/rate-limit'
import { signAdminSession, sessionCookieOptions, ADMIN_COOKIE_NAME } from '@/lib/jwt'
import { auditAdmin } from '@/lib/admin'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
})

export const POST = withErrors(async (req: NextRequest) => {
  assertSameOrigin(req)
  enforceRateLimit('auth', clientIp(req), RATE_RULES.auth)
  const body = await parseBody(req, schema)

  const admin = await prisma.adminUser.findUnique({ where: { email: body.email } })
  // Verify against a dummy hash when the account is missing (timing safety).
  const hash =
    admin?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const valid = await argon2.verify(hash, body.password).catch(() => false)
  if (!admin || !valid) return jsonError(401, 'invalid_credentials')

  const token = await signAdminSession({ adminId: admin.id, role: admin.role })
  await auditAdmin(admin.id, 'admin.login', {}, clientIp(req))

  const res = NextResponse.json({ admin: { id: admin.id, email: admin.email, role: admin.role } })
  res.cookies.set(ADMIN_COOKIE_NAME, token, sessionCookieOptions(12 * 3600))
  return res
})
