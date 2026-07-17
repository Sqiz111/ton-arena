import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { BalanceService } from '@/services/balance.service'
import { ConfigService } from '@/services/config.service'
import { AchievementService } from '@/services/achievement.service'
import { CONFIG_KEYS } from '@/shared/constants'
import {
  generateServerSeed,
  minesPlacement,
  minesMultiplier,
  type MinesConfig,
} from '@/services/fair'

export interface MinesStateDto {
  id: string
  status: 'ACTIVE' | 'CASHED_OUT' | 'BUSTED'
  betAmount: string
  config: MinesConfig
  revealed: number[]
  multiplier: number
  potentialPayout: string
  serverSeedHash: string
  /** Only present after the game ends. */
  serverSeed?: string
  mines?: number[]
  payout?: string
}

interface MinesState {
  revealed: number[]
}

const GRID_SIZES = [5, 7] as const
const MAX_ACTIVE_PER_USER = 1

function toDto(
  game: {
    id: string
    status: string
    betAmount: bigint
    payoutAmount: bigint
    serverSeed: string
    serverSeedHash: string
    clientSeed: string
    nonce: number
    config: Prisma.JsonValue
    state: Prisma.JsonValue
  },
  revealEnded: boolean,
): MinesStateDto {
  const cfg = game.config as unknown as MinesConfig
  const state = game.state as unknown as MinesState
  const multiplier = minesMultiplier(cfg, state.revealed.length)
  const dto: MinesStateDto = {
    id: game.id,
    status: game.status as MinesStateDto['status'],
    betAmount: game.betAmount.toString(),
    config: cfg,
    revealed: state.revealed,
    multiplier,
    potentialPayout: ((game.betAmount * BigInt(Math.round(multiplier * 10000))) / 10000n).toString(),
    serverSeedHash: game.serverSeedHash,
  }
  if (revealEnded) {
    dto.serverSeed = game.serverSeed
    dto.mines = [...minesPlacement(cfg, game.serverSeed, game.clientSeed, game.nonce)]
    dto.payout = game.payoutAmount.toString()
  }
  return dto
}

export const MinesService = {
  async start(userId: string, betAmount: bigint, config: MinesConfig): Promise<MinesStateDto> {
    const cells = config.gridSize * config.gridSize
    if (!GRID_SIZES.includes(config.gridSize as (typeof GRID_SIZES)[number])) {
      throw new ApiError(400, 'invalid_grid_size')
    }
    if (config.mines < 1 || config.mines > cells - 1) {
      throw new ApiError(400, 'invalid_mine_count')
    }
    const minBet = await ConfigService.getBigInt(CONFIG_KEYS.minBet)
    if (betAmount < minBet) throw new ApiError(400, 'below_min_bet')
    // Snapshot RTP so an admin change mid-game never affects active games.
    const rtpBps = await ConfigService.getInt(CONFIG_KEYS.minesRtpBps)
    const cfg: MinesConfig = { gridSize: config.gridSize, mines: config.mines, rtpBps }

    const game = await prisma.$transaction(async (tx) => {
      const active = await tx.soloGame.count({
        where: { userId, gameType: 'MINES', status: 'ACTIVE' },
      })
      if (active >= MAX_ACTIVE_PER_USER) throw new ApiError(409, 'game_already_active')

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.isBlocked) throw new ApiError(403, 'user_blocked')

      // Per-user nonce increments with every solo bet.
      await tx.user.update({ where: { id: userId }, data: { soloNonce: { increment: 1 } } })
      const { seed, hash } = generateServerSeed()

      const created = await tx.soloGame.create({
        data: {
          userId,
          gameType: 'MINES',
          status: 'ACTIVE',
          betAmount,
          serverSeed: seed,
          serverSeedHash: hash,
          clientSeed: user.clientSeed,
          nonce: user.soloNonce + 1,
          config: cfg as unknown as Prisma.InputJsonValue,
          state: { revealed: [] },
        },
      })
      await BalanceService.applyEntry(tx, userId, 'BET', -betAmount, {
        refType: 'solo_game',
        refId: created.id,
      })
      return created
    })

    return toDto(game, false)
  },

  async reveal(userId: string, gameId: string, cell: number): Promise<MinesStateDto> {
    return prisma.$transaction(async (tx) => {
      // Lock the game row to serialize concurrent reveals.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "SoloGame" WHERE id = ${gameId} AND "userId" = ${userId} FOR UPDATE
      `
      if (rows.length !== 1) throw new ApiError(404, 'game_not_found')
      const game = await tx.soloGame.findUniqueOrThrow({ where: { id: gameId } })
      if (game.status !== 'ACTIVE') throw new ApiError(409, 'game_not_active')

      const cfg = game.config as unknown as MinesConfig
      const state = game.state as unknown as MinesState
      const cells = cfg.gridSize * cfg.gridSize
      if (!Number.isInteger(cell) || cell < 0 || cell >= cells) {
        throw new ApiError(400, 'invalid_cell')
      }
      if (state.revealed.includes(cell)) throw new ApiError(400, 'cell_already_revealed')

      const mines = minesPlacement(cfg, game.serverSeed, game.clientSeed, game.nonce)

      if (mines.has(cell)) {
        const busted = await tx.soloGame.update({
          where: { id: gameId },
          data: { status: 'BUSTED', finishedAt: new Date(), state: { revealed: state.revealed } },
        })
        await this.recordStats(tx, userId, game.betAmount, 0n)
        return toDto(busted, true)
      }

      const revealed = [...state.revealed, cell]
      const safeCells = cells - cfg.mines

      if (revealed.length === safeCells) {
        // Full clear — auto cashout at max multiplier.
        return this.settle(tx, userId, game, cfg, revealed)
      }

      const updated = await tx.soloGame.update({
        where: { id: gameId },
        data: { state: { revealed } },
      })
      return toDto(updated, false)
    })
  },

  async cashout(userId: string, gameId: string): Promise<MinesStateDto> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "SoloGame" WHERE id = ${gameId} AND "userId" = ${userId} FOR UPDATE
      `
      if (rows.length !== 1) throw new ApiError(404, 'game_not_found')
      const game = await tx.soloGame.findUniqueOrThrow({ where: { id: gameId } })
      if (game.status !== 'ACTIVE') throw new ApiError(409, 'game_not_active')

      const cfg = game.config as unknown as MinesConfig
      const state = game.state as unknown as MinesState
      if (state.revealed.length === 0) throw new ApiError(400, 'nothing_revealed')

      return this.settle(tx, userId, game, cfg, state.revealed)
    })
  },

  /** Shared final-payout path (cashout and full clear). */
  async settle(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    game: { id: string; betAmount: bigint },
    cfg: MinesConfig,
    revealed: number[],
  ): Promise<MinesStateDto> {
    const multiplier = minesMultiplier(cfg, revealed.length)
    const payout = (game.betAmount * BigInt(Math.round(multiplier * 10000))) / 10000n

    const updated = await tx.soloGame.update({
      where: { id: game.id },
      data: {
        status: 'CASHED_OUT',
        payoutAmount: payout,
        finishedAt: new Date(),
        state: { revealed },
      },
    })
    await BalanceService.applyEntry(tx, userId, 'WIN', payout, {
      refType: 'solo_game',
      refId: game.id,
    })
    await this.recordStats(tx, userId, game.betAmount, payout)
    // Fire-and-forget: achievements must not break or slow the payout path.
    void AchievementService.onGameFinished(userId, 'mines', game.betAmount, payout)
    void AchievementService.onMinesCashout(userId, revealed.length)
    return toDto(updated, true)
  },

  async recordStats(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    wagered: bigint,
    won: bigint,
  ): Promise<void> {
    const lost = won >= wagered ? 0n : wagered - won
    await tx.userStats.update({
      where: { userId },
      data: {
        gamesPlayed: { increment: 1 },
        gamesWon: won > wagered ? { increment: 1 } : undefined,
        totalWagered: { increment: wagered },
        totalWon: { increment: won },
        totalLost: { increment: lost },
      },
    })
    // biggestWin needs a compare-and-set
    if (won > 0n) {
      await tx.$executeRaw`
        UPDATE "UserStats" SET "biggestWin" = GREATEST("biggestWin", ${won})
        WHERE "userId" = ${userId}
      `
    }
    // XP: 10 per game + 1 per 0.1 TON wagered (capped per game)
    const xpGain = 10 + Math.min(100, Number(wagered / 100_000_000n))
    await tx.$executeRaw`
      UPDATE "User" SET xp = xp + ${xpGain},
        level = FLOOR(SQRT((xp + ${xpGain}) / 100.0)) + 1
      WHERE id = ${userId}
    `
  },

  async getActive(userId: string): Promise<MinesStateDto | null> {
    const game = await prisma.soloGame.findFirst({
      where: { userId, gameType: 'MINES', status: 'ACTIVE' },
    })
    return game ? toDto(game, false) : null
  },
}
