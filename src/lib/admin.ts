import { NextRequest } from 'next/server'
import { ADMIN_COOKIE_NAME, verifyAdminSession, type AdminSession } from '@/lib/jwt'
import { ApiError } from '@/lib/api'
import { prisma } from '@/lib/prisma'

export async function requireAdmin(req: NextRequest): Promise<AdminSession> {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) throw new ApiError(401, 'unauthorized')
  return session
}

export async function auditAdmin(
  adminId: string,
  action: string,
  meta?: Record<string, unknown>,
  ip?: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: 'admin',
      actorId: adminId,
      action,
      meta: meta as never,
      ip,
    },
  })
}
