import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrors, requireUser } from '@/lib/api'

export const GET = withErrors(async (req: NextRequest) => {
  const session = await requireUser(req)
  const [all, mine] = await Promise.all([
    prisma.achievement.findMany({ select: { code: true } }),
    prisma.userAchievement.findMany({ where: { userId: session.userId } }),
  ])
  const unlocked = new Map(mine.map((a) => [a.code, a.unlockedAt]))
  return NextResponse.json({
    achievements: all.map((a) => ({
      code: a.code,
      unlockedAt: unlocked.get(a.code)?.toISOString() ?? null,
    })),
  })
})
