import type { Namespace } from 'socket.io'
import type { WheelRoomTier } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { logger } from '../../src/lib/logger'
import { BalanceService } from '../../src/services/balance.service'
import { ConfigService } from '../../src/services/config.service'
import { CONFIG_KEYS, playerColor } from '../../src/shared/constants'
import {
  generateServerSeed,
  wheelBetsHash,
  wheelWinningTicket,
} from '../../src/services/fair'
import type { WheelStateDto, WheelBetDto, WheelTier } from '../../src/types/socket'
import { broadcastWin } from '../socket/live.gateway'

const SPIN_DURATION_MS = 9_000
const RESULT_LINGER_MS = 5_000
const MIN_PLAYERS = 2

const TIER_MAX_KEY: Record<WheelTier, string> = {
  LOW: CONFIG_KEYS.wheelMaxBetLow,
  MID: CONFIG_KEYS.wheelMaxBetMid,
  HIGH: CONFIG_KEYS.wheelMaxBetHigh,
}

interface RoomState {
  roundId: string
  bettingTimer: NodeJS.Timeout | null
}

/**
 * Per-tier wheel state machine:
 * WAITING → (2nd distinct bettor) BETTING(window) → SPINNING → COMPLETED → new round.
 * Every transition persists to DB before broadcasting. Money never lives only in memory.
 */
export class WheelRoomManager {
  private rooms = new Map<WheelTier, RoomState>()
  private nsp: Namespace | null = null
  private stopped = false
  private activeSpins = new Map<WheelTier, Promise<void>>()

  attach(nsp: Namespace) {
    this.nsp = nsp
  }

  async start(): Promise<void> {
    await this.recoverInterrupted()
    for (const tier of ['LOW', 'MID', 'HIGH'] as WheelTier[]) {
      await this.ensureOpenRound(tier)
    }
    logger.info('wheel room manager started')
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const [, room] of this.rooms) {
      if (room.bettingTimer) clearTimeout(room.bettingTimer)
    }
    // Let in-flight spins settle before refunding what's left — otherwise a
    // concurrent settle could double-pay on top of our refunds.
    await Promise.allSettled(this.activeSpins.values())
    // Cancel open rounds with refunds so no money is stuck.
    await this.recoverInterrupted()
  }

  /** Cancel any BETTING/SPINNING/WAITING rounds and refund all bets. */
  private async recoverInterrupted(): Promise<void> {
    const open = await prisma.wheelRound.findMany({
      where: { status: { in: ['WAITING', 'BETTING', 'SPINNING'] } },
      include: { bets: true },
    })
    for (const round of open) {
      await prisma.$transaction(async (tx) => {
        // Claim-by-status: if a live spin settles concurrently, skip.
        const claimed = await tx.wheelRound.updateMany({
          where: { id: round.id, status: { in: ['WAITING', 'BETTING', 'SPINNING'] } },
          data: { status: 'CANCELLED', completedAt: new Date() },
        })
        if (claimed.count !== 1) return
        for (const bet of round.bets) {
          await BalanceService.applyEntry(tx, bet.userId, 'REFUND', bet.amount, {
            refType: 'wheel_round',
            refId: round.id,
          })
        }
      })
      logger.info({ roundId: round.id, refunds: round.bets.length }, 'wheel round cancelled+refunded')
    }
  }

  private async ensureOpenRound(tier: WheelTier): Promise<string> {
    const existing = this.rooms.get(tier)
    if (existing) return existing.roundId

    const last = await prisma.wheelRound.findFirst({
      where: { tier: tier as WheelRoomTier },
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true },
    })
    const { seed, hash } = generateServerSeed()
    const round = await prisma.wheelRound.create({
      data: {
        tier: tier as WheelRoomTier,
        roundNumber: (last?.roundNumber ?? 0) + 1,
        status: 'WAITING',
        serverSeed: seed, // stored but NOT exposed until completion
        serverSeedHash: hash,
      },
    })
    this.rooms.set(tier, { roundId: round.id, bettingTimer: null })
    await this.broadcastState(tier)
    return round.id
  }

  /** Bet placement — the only concurrent entry point. */
  async placeBet(tier: WheelTier, userId: string, amount: bigint): Promise<void> {
    const room = this.rooms.get(tier)
    if (!room) throw new Error('room_not_ready')

    const [minBet, maxBet] = await Promise.all([
      ConfigService.getBigInt(CONFIG_KEYS.minBet),
      ConfigService.getBigInt(TIER_MAX_KEY[tier]),
    ])
    if (amount < minBet) throw new Error('below_min_bet')

    let startBettingWindow = false

    await prisma.$transaction(async (tx) => {
      // Lock the round row: ticket ranges must never overlap.
      const roundRows = await tx.$queryRaw<
        Array<{ id: string; status: string; potAmount: bigint }>
      >`SELECT id, status, "potAmount" FROM "WheelRound" WHERE id = ${room.roundId} FOR UPDATE`
      if (roundRows.length !== 1) throw new Error('round_not_found')
      const round = roundRows[0]
      if (round.status !== 'WAITING' && round.status !== 'BETTING') {
        throw new Error('betting_closed')
      }

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.isBlocked) throw new Error('user_blocked')

      // Per-user total in this round must respect the tier cap.
      if (maxBet > 0n) {
        const agg = await tx.wheelBet.aggregate({
          where: { roundId: room.roundId, userId },
          _sum: { amount: true },
        })
        if ((agg._sum.amount ?? 0n) + amount > maxBet) throw new Error('over_max_bet')
      }

      await BalanceService.applyEntry(tx, userId, 'BET', -amount, {
        refType: 'wheel_round',
        refId: room.roundId,
      })

      const ticketFrom = round.potAmount + 1n
      const ticketTo = round.potAmount + amount
      await tx.wheelBet.create({
        data: { roundId: room.roundId, userId, amount, ticketFrom, ticketTo },
      })

      const distinct = await tx.wheelBet.findMany({
        where: { roundId: room.roundId },
        select: { userId: true },
        distinct: ['userId'],
      })

      if (round.status === 'WAITING' && distinct.length >= MIN_PLAYERS) {
        const windowSec = await ConfigService.getInt(CONFIG_KEYS.wheelBettingWindowSec)
        await tx.wheelRound.update({
          where: { id: room.roundId },
          data: {
            status: 'BETTING',
            potAmount: ticketTo,
            bettingEndsAt: new Date(Date.now() + windowSec * 1000),
          },
        })
        startBettingWindow = true
      } else {
        await tx.wheelRound.update({
          where: { id: room.roundId },
          data: { potAmount: ticketTo },
        })
      }
    })

    if (startBettingWindow) this.armBettingTimer(tier)
    await this.broadcastState(tier)
  }

  private armBettingTimer(tier: WheelTier): void {
    const room = this.rooms.get(tier)
    if (!room || room.bettingTimer) return
    void (async () => {
      const round = await prisma.wheelRound.findUnique({ where: { id: room.roundId } })
      if (!round?.bettingEndsAt) return
      const delay = Math.max(0, round.bettingEndsAt.getTime() - Date.now())
      room.bettingTimer = setTimeout(() => {
        const p = this.spin(tier).finally(() => this.activeSpins.delete(tier))
        this.activeSpins.set(tier, p)
      }, delay)
    })()
  }

  /** Lock bets, pick winner, broadcast the spin, then pay out. */
  private async spin(tier: WheelTier): Promise<void> {
    if (this.stopped) return
    const room = this.rooms.get(tier)
    if (!room) return
    room.bettingTimer = null

    try {
      // Atomically close betting BEFORE reading bets: any placeBet that commits
      // after this point sees SPINNING and is rejected, so no bet can be
      // debited yet excluded from the winner selection.
      const closed = await prisma.wheelRound.updateMany({
        where: { id: room.roundId, status: 'BETTING' },
        data: { status: 'SPINNING' },
      })
      if (closed.count !== 1) return // already handled elsewhere (recovery/stop)

      const round = await prisma.wheelRound.findUniqueOrThrow({
        where: { id: room.roundId },
        include: {
          bets: {
            orderBy: { createdAt: 'asc' },
            include: { user: { select: { nickname: true } } },
          },
        },
      })

      const betsHash = wheelBetsHash(
        round.bets.map((b) => ({ id: b.id, userId: b.userId, amount: b.amount })),
      )
      const totalTickets = round.potAmount
      const winningTicket = wheelWinningTicket(round.serverSeed!, round.id, betsHash, totalTickets)
      const winningBet = round.bets.find(
        (b) => b.ticketFrom <= winningTicket && winningTicket <= b.ticketTo,
      )
      if (!winningBet) throw new Error('no winning bet — invariant violated')

      const feeBps = BigInt(await ConfigService.getInt(CONFIG_KEYS.platformFeeBps))
      const feeAmount = (round.potAmount * feeBps) / 10_000n
      const payout = round.potAmount - feeAmount

      await prisma.wheelRound.update({
        where: { id: round.id },
        data: {
          betsHash,
          winningTicket,
          winnerUserId: winningBet.userId,
          feeAmount,
        },
      })

      this.nsp?.to(`wheel:${tier}`).emit('wheel:spin', {
        roundId: round.id,
        winningTicket: winningTicket.toString(),
        winnerUserId: winningBet.userId,
        winnerNickname: winningBet.user.nickname,
        totalTickets: totalTickets.toString(),
        spinDurationMs: SPIN_DURATION_MS,
        serverSeed: round.serverSeed!,
        betsHash,
        potAmount: round.potAmount.toString(),
        feeAmount: feeAmount.toString(),
        payout: payout.toString(),
      })

      // Wait for the client animation, then settle.
      await new Promise((r) => setTimeout(r, SPIN_DURATION_MS + 500))

      await prisma.$transaction(async (tx) => {
        // Guard against a concurrent stop()/recovery having CANCELLED the round.
        const still = await tx.wheelRound.updateMany({
          where: { id: round.id, status: 'SPINNING' },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })
        if (still.count !== 1) throw new Error('round_no_longer_spinning')

        await BalanceService.applyEntry(tx, winningBet.userId, 'WIN', payout, {
          refType: 'wheel_round',
          refId: round.id,
        })
        // Stats for all participants
        const byUser = new Map<string, bigint>()
        for (const b of round.bets) {
          byUser.set(b.userId, (byUser.get(b.userId) ?? 0n) + b.amount)
        }
        for (const [uid, wagered] of byUser) {
          const won = uid === winningBet.userId ? payout : 0n
          await tx.userStats.update({
            where: { userId: uid },
            data: {
              gamesPlayed: { increment: 1 },
              gamesWon: won > 0n ? { increment: 1 } : undefined,
              totalWagered: { increment: wagered },
              totalWon: { increment: won },
              totalLost: { increment: won >= wagered ? 0n : wagered - won },
            },
          })
          if (won > 0n) {
            await tx.$executeRaw`
              UPDATE "UserStats" SET "biggestWin" = GREATEST("biggestWin", ${won})
              WHERE "userId" = ${uid}
            `
          }
        }
      })

      broadcastWin({
        nickname: winningBet.user.nickname,
        gameType: 'wheel',
        amount: payout.toString(),
      })

      const { AchievementService } = await import('../../src/services/achievement.service')
      void AchievementService.onGameFinished(winningBet.userId, 'wheel', winningBet.amount, payout)

      await new Promise((r) => setTimeout(r, RESULT_LINGER_MS))
    } catch (e) {
      logger.error({ tier, err: (e as Error).message }, 'wheel spin failed')
      // Don't leave money frozen in a SPINNING round until next restart —
      // refund immediately if the round wasn't settled.
      try {
        const stuck = await prisma.wheelRound.findUnique({
          where: { id: room.roundId },
          include: { bets: true },
        })
        if (stuck && (stuck.status === 'SPINNING' || stuck.status === 'BETTING')) {
          await prisma.$transaction(async (tx) => {
            const claimed = await tx.wheelRound.updateMany({
              where: { id: stuck.id, status: { in: ['SPINNING', 'BETTING'] } },
              data: { status: 'CANCELLED', completedAt: new Date() },
            })
            if (claimed.count !== 1) return
            for (const bet of stuck.bets) {
              await BalanceService.applyEntry(tx, bet.userId, 'REFUND', bet.amount, {
                refType: 'wheel_round',
                refId: stuck.id,
              })
            }
          })
          logger.warn({ roundId: stuck.id }, 'wheel round refunded after spin failure')
        }
      } catch (refundErr) {
        logger.error(
          { tier, err: (refundErr as Error).message },
          'wheel refund-after-failure also failed; recovery on restart will handle it',
        )
      }
    } finally {
      // Open the next round regardless — recovery handles stuck money.
      this.rooms.delete(tier)
      if (!this.stopped) {
        await this.ensureOpenRound(tier)
      }
    }
  }

  async buildState(tier: WheelTier): Promise<WheelStateDto | null> {
    const room = this.rooms.get(tier)
    if (!room) return null
    const round = await prisma.wheelRound.findUnique({
      where: { id: room.roundId },
      include: {
        bets: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { nickname: true, avatarUrl: true } } },
        },
      },
    })
    if (!round) return null

    const [minBet, maxBet] = await Promise.all([
      ConfigService.get(CONFIG_KEYS.minBet),
      ConfigService.get(TIER_MAX_KEY[tier]),
    ])

    const bets: WheelBetDto[] = round.bets.map((b) => ({
      id: b.id,
      userId: b.userId,
      nickname: b.user.nickname,
      avatarUrl: b.user.avatarUrl,
      amount: b.amount.toString(),
      ticketFrom: b.ticketFrom.toString(),
      ticketTo: b.ticketTo.toString(),
      color: playerColor(b.userId),
    }))

    return {
      roundId: round.id,
      tier,
      roundNumber: round.roundNumber,
      status: round.status,
      serverSeedHash: round.serverSeedHash,
      bets,
      potAmount: round.potAmount.toString(),
      bettingEndsAt: round.bettingEndsAt?.toISOString() ?? null,
      maxBet,
      minBet,
      serverTime: new Date().toISOString(),
    }
  }

  async broadcastState(tier: WheelTier): Promise<void> {
    const state = await this.buildState(tier)
    if (state) this.nsp?.to(`wheel:${tier}`).emit('wheel:state', state)
  }
}

export const wheelRoomManager = new WheelRoomManager()
