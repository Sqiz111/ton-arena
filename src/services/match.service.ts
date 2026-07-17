import type { GameType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { BalanceService } from '@/services/balance.service'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS } from '@/shared/constants'
import { generateServerSeed } from '@/services/fair'

/**
 * Money + persistence layer shared by battleship and tictactoe gateways.
 * Engine state lives in memory; every mutation snapshots to Match.stateSnapshot.
 */
export const MatchService = {
  /** Create a match debiting both players atomically. Throws if either lacks funds. */
  async createMatch(
    gameType: GameType,
    betAmount: bigint,
    player1Id: string,
    player2Id: string,
  ) {
    const { seed } = generateServerSeed()
    return prisma.$transaction(async (tx) => {
      // Lock in deterministic order to avoid deadlocks.
      const [firstId, secondId] = [player1Id, player2Id].sort()
      for (const uid of [firstId, secondId]) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: uid } })
        if (user.isBlocked) throw new Error('user_blocked')
      }

      const match = await tx.match.create({
        data: {
          gameType,
          status: 'IN_PROGRESS',
          betAmount,
          potAmount: betAmount * 2n,
          player1Id,
          player2Id,
          serverSeed: seed,
        },
      })
      for (const uid of [firstId, secondId]) {
        await BalanceService.applyEntry(tx, uid, 'BET', -betAmount, {
          refType: 'match',
          refId: match.id,
        })
      }
      return match
    })
  },

  async saveSnapshot(matchId: string, snapshot: unknown): Promise<void> {
    await prisma.match.update({
      where: { id: matchId },
      data: { stateSnapshot: snapshot as Prisma.InputJsonValue },
    })
  },

  async recordMove(
    matchId: string,
    userId: string,
    moveIndex: number,
    payload: unknown,
    result?: unknown,
  ): Promise<void> {
    await prisma.matchMove.create({
      data: {
        matchId,
        userId,
        moveIndex,
        payload: payload as Prisma.InputJsonValue,
        result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
  },

  /** Winner takes pot minus fee; draw refunds both bets in full. */
  async settle(matchId: string, winnerUserId: string | null): Promise<{ payout: bigint }> {
    return prisma.$transaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } })
      if (match.status === 'COMPLETED' || match.status === 'CANCELLED') {
        return { payout: 0n } // idempotent: already settled
      }

      let payout = 0n
      let feeAmount = 0n

      if (winnerUserId) {
        const feeBps = BigInt(await ConfigService.getInt(CONFIG_KEYS.platformFeeBps))
        feeAmount = (match.potAmount * feeBps) / 10_000n
        payout = match.potAmount - feeAmount
        await BalanceService.applyEntry(tx, winnerUserId, 'WIN', payout, {
          refType: 'match',
          refId: matchId,
        })
      } else {
        // Draw — full refund, no fee.
        for (const uid of [match.player1Id, match.player2Id!]) {
          await BalanceService.applyEntry(tx, uid, 'REFUND', match.betAmount, {
            refType: 'match',
            refId: matchId,
          })
        }
      }

      await tx.match.update({
        where: { id: matchId },
        data: { status: 'COMPLETED', winnerUserId, feeAmount, completedAt: new Date() },
      })

      // Stats
      for (const uid of [match.player1Id, match.player2Id!]) {
        const won = uid === winnerUserId ? payout : 0n
        const wagered = match.betAmount
        const isDraw = winnerUserId === null
        await tx.userStats.update({
          where: { userId: uid },
          data: {
            gamesPlayed: { increment: 1 },
            gamesWon: won > 0n ? { increment: 1 } : undefined,
            totalWagered: { increment: wagered },
            totalWon: { increment: isDraw ? 0n : won },
            totalLost: { increment: isDraw || won > 0n ? 0n : wagered },
          },
        })
        if (won > 0n) {
          await tx.$executeRaw`
            UPDATE "UserStats" SET "biggestWin" = GREATEST("biggestWin", ${won})
            WHERE "userId" = ${uid}
          `
        }
      }

      return { payout }
    })
  },

  /** Cancel an unstarted/broken match with full refunds. */
  async cancel(matchId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } })
      if (match.status === 'COMPLETED' || match.status === 'CANCELLED') return
      for (const uid of [match.player1Id, match.player2Id].filter(Boolean) as string[]) {
        await BalanceService.applyEntry(tx, uid, 'REFUND', match.betAmount, {
          refType: 'match',
          refId: matchId,
        })
      }
      await tx.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      })
    })
  },

  /** Boot-time recovery: cancel and refund every live match. */
  async recoverInterrupted(): Promise<void> {
    const open = await prisma.match.findMany({
      where: { status: { in: ['MATCHMAKING', 'PLACING', 'IN_PROGRESS'] } },
      select: { id: true },
    })
    for (const m of open) {
      await this.cancel(m.id)
    }
  },
}
