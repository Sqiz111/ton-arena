import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { BalanceService } from '@/services/balance.service'
import { ConfigService } from '@/services/config.service'
import { CONFIG_KEYS } from '@/shared/constants'
import { MinesService } from '@/services/mines.service'
import { AchievementService } from '@/services/achievement.service'
import {
  generateServerSeed,
  plinkoPath,
  plinkoSlot,
  plinkoMultiplier,
  type PlinkoConfig,
} from '@/services/fair'

export interface PlinkoResultDto {
  id: string
  betAmount: string
  config: PlinkoConfig
  path: number[]
  slot: number
  multiplier: number
  payout: string
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
}

const VALID_ROWS = [8, 12, 16]

export const PlinkoService = {
  /** One drop: debit bet, derive path, credit payout — single transaction. */
  async play(userId: string, betAmount: bigint, config: PlinkoConfig): Promise<PlinkoResultDto> {
    if (!VALID_ROWS.includes(config.rows)) throw new ApiError(400, 'invalid_rows')
    if (!['low', 'medium', 'high'].includes(config.risk)) throw new ApiError(400, 'invalid_risk')
    const minBet = await ConfigService.getBigInt(CONFIG_KEYS.minBet)
    if (betAmount < minBet) throw new ApiError(400, 'below_min_bet')
    // Snapshot RTP into the game config so verification stays reproducible.
    const rtpBps = await ConfigService.getInt(CONFIG_KEYS.plinkoRtpBps)
    const cfg: PlinkoConfig = { risk: config.risk, rows: config.rows, rtpBps }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.isBlocked) throw new ApiError(403, 'user_blocked')

      await tx.user.update({ where: { id: userId }, data: { soloNonce: { increment: 1 } } })
      const nonce = user.soloNonce + 1
      const { seed, hash } = generateServerSeed()

      const path = plinkoPath(cfg, seed, user.clientSeed, nonce)
      const slot = plinkoSlot(path)
      const multiplier = plinkoMultiplier(cfg, slot)
      const payout = (betAmount * BigInt(Math.round(multiplier * 10000))) / 10000n

      const game = await tx.soloGame.create({
        data: {
          userId,
          gameType: 'PLINKO',
          status: 'COMPLETED',
          betAmount,
          payoutAmount: payout,
          serverSeed: seed,
          serverSeedHash: hash,
          clientSeed: user.clientSeed,
          nonce,
          config: cfg as unknown as Prisma.InputJsonValue,
          state: { path, slot, multiplier },
          finishedAt: new Date(),
        },
      })

      await BalanceService.applyEntry(tx, userId, 'BET', -betAmount, {
        refType: 'solo_game',
        refId: game.id,
      })
      if (payout > 0n) {
        await BalanceService.applyEntry(tx, userId, 'WIN', payout, {
          refType: 'solo_game',
          refId: game.id,
        })
      }
      await MinesService.recordStats(tx, userId, betAmount, payout)

      void AchievementService.onGameFinished(userId, 'plinko', betAmount, payout)
      void AchievementService.onPlinkoResult(userId, multiplier)

      return {
        id: game.id,
        betAmount: betAmount.toString(),
        config: cfg,
        path,
        slot,
        multiplier,
        payout: payout.toString(),
        serverSeed: seed,
        serverSeedHash: hash,
        clientSeed: user.clientSeed,
        nonce,
      }
    })
  },
}
