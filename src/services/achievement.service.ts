import { prisma } from '@/lib/prisma'
import { toNano } from '@/shared/ton-format'

/**
 * Awards are idempotent (composite PK) and never throw into the game path.
 */
export const AchievementService = {
  async award(userId: string, code: string): Promise<void> {
    try {
      await prisma.userAchievement.createMany({
        data: [{ userId, code }],
        skipDuplicates: true,
      })
    } catch {
      /* achievements must never break gameplay */
    }
  },

  /** Called after any completed game (win = payout > bet). */
  async onGameFinished(userId: string, gameType: string, bet: bigint, payout: bigint) {
    await this.award(userId, 'FIRST_GAME')
    if (payout > bet) await this.award(userId, 'FIRST_WIN')
    if (bet >= toNano(50)) await this.award(userId, 'HIGH_ROLLER')

    const stats = await prisma.userStats.findUnique({ where: { userId } })
    if (stats && stats.gamesPlayed >= 100) await this.award(userId, 'VETERAN')

    if (payout > bet) {
      const winsOfType = {
        wheel: 'WHEEL_MASTER',
        battleship: 'ADMIRAL',
        tictactoe: 'STRATEGIST',
      } as Record<string, string>
      const code = winsOfType[gameType]
      if (code) {
        const wins =
          gameType === 'wheel'
            ? await prisma.wheelRound.count({ where: { winnerUserId: userId } })
            : await prisma.match.count({
                where: {
                  winnerUserId: userId,
                  gameType: gameType === 'battleship' ? 'BATTLESHIP' : 'TICTACTOE',
                },
              })
        if (wins >= 10) await this.award(userId, code)
      }
    }
  },

  async onDeposit(userId: string): Promise<void> {
    await this.award(userId, 'FIRST_DEPOSIT')
  },

  async onMinesCashout(userId: string, revealedCount: number): Promise<void> {
    if (revealedCount >= 10) await this.award(userId, 'SAPPER')
  },

  async onPlinkoResult(userId: string, multiplier: number): Promise<void> {
    if (multiplier >= 100) await this.award(userId, 'LUCKY_DROP')
  },
}
