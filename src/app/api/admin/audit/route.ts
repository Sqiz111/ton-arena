import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors } from '@/lib/api'
import { requireAdmin } from '@/lib/admin'

export const GET = withErrors(async (req: NextRequest) => {
  await requireAdmin(req)
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      actorType: l.actorType,
      actorId: l.actorId,
      action: l.action,
      meta: l.meta,
      ip: l.ip,
      createdAt: l.createdAt.toISOString(),
    })),
  })
})
