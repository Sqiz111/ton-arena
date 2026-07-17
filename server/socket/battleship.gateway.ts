import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { prisma } from '../../src/lib/prisma'
import { logger } from '../../src/lib/logger'
import { rateLimit, RATE_RULES } from '../../src/lib/rate-limit'
import { MatchService } from '../../src/services/match.service'
import { fairCoinFlip } from '../../src/services/fair'
import { MOVE_TIMEOUT_SEC } from '../../src/shared/constants'
import { matchmaking } from '../engines/MatchmakingService'
import {
  bsCreate,
  bsPlaceShips,
  bsShoot,
  bsToJson,
  type BsState,
  type Ship,
} from '../engines/BattleshipEngine'
import { broadcastWin } from './live.gateway'

const PLACING_TIMEOUT_SEC = 90

interface LiveMatch {
  matchId: string
  player1Id: string
  player2Id: string
  state: BsState
  moveIndex: number
  timer: NodeJS.Timeout | null
  deadline: number
}

const liveMatches = new Map<string, LiveMatch>()
const userToMatch = new Map<string, string>()

const queueSchema = z.object({
  betAmount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n),
})
const shipSchema = z.object({
  x: z.number().int().min(0).max(9),
  y: z.number().int().min(0).max(9),
  length: z.number().int().min(1).max(4),
  horizontal: z.boolean(),
})
const placeSchema = z.object({ matchId: z.string(), ships: z.array(shipSchema).length(10) })
const shootSchema = z.object({
  matchId: z.string(),
  x: z.number().int().min(0).max(9),
  y: z.number().int().min(0).max(9),
})
const idSchema = z.object({ matchId: z.string() })

export function registerBattleshipGateway(io: Server) {
  const nsp = io.of('/battleship')

  function playerNum(match: LiveMatch, userId: string): 1 | 2 | null {
    return match.player1Id === userId ? 1 : match.player2Id === userId ? 2 : null
  }

  async function emitState(match: LiveMatch) {
    const users = await prisma.user.findMany({
      where: { id: { in: [match.player1Id, match.player2Id] } },
      select: { id: true, nickname: true, avatarUrl: true },
    })
    const dbMatch = await prisma.match.findUniqueOrThrow({ where: { id: match.matchId } })
    const byId = new Map(users.map((u) => [u.id, u]))
    const s = match.state
    const turnUserId =
      s.status === 'IN_PROGRESS' ? (s.turn === 1 ? match.player1Id : match.player2Id) : null

    for (const num of [1, 2] as const) {
      const userId = num === 1 ? match.player1Id : match.player2Id
      const opponentId = num === 1 ? match.player2Id : match.player1Id
      const opponent = byId.get(opponentId)
      const me = s.players[num - 1]
      nsp.to(`user:${userId}`).emit('bs:state', {
        matchId: match.matchId,
        phase: s.status === 'WIN' ? 'COMPLETED' : s.status,
        yourBoard: me?.ships ?? null,
        yourShots: s.shots[num - 1],
        opponentShots: s.shots[num === 1 ? 1 : 0],
        turnUserId,
        deadline: match.deadline ? new Date(match.deadline).toISOString() : null,
        opponent: { nickname: opponent?.nickname ?? '?', avatarUrl: opponent?.avatarUrl ?? null },
        youPlaced: !!s.players[num - 1],
        opponentPlaced: !!s.players[num === 1 ? 1 : 0],
        betAmount: dbMatch.betAmount.toString(),
      })
    }
  }

  async function finish(match: LiveMatch, winnerUserId: string | null) {
    if (match.timer) clearTimeout(match.timer)
    liveMatches.delete(match.matchId)
    userToMatch.delete(match.player1Id)
    userToMatch.delete(match.player2Id)

    try {
      const { payout } = await MatchService.settle(match.matchId, winnerUserId)
      // Reveal the loser's remaining board to the winner (and vice versa).
      for (const num of [1, 2] as const) {
        const userId = num === 1 ? match.player1Id : match.player2Id
        const opponentBoard = match.state.players[num === 1 ? 1 : 0]?.ships ?? []
        nsp.to(`user:${userId}`).emit('bs:game_over', {
          matchId: match.matchId,
          winnerUserId,
          payout: payout.toString(),
          revealBoard: opponentBoard,
        })
      }
      if (winnerUserId && payout > 0n) {
        const winner = await prisma.user.findUnique({ where: { id: winnerUserId } })
        if (winner) {
          broadcastWin({ nickname: winner.nickname, gameType: 'battleship', amount: payout.toString() })
        }
      }
    } catch (e) {
      logger.error({ matchId: match.matchId, err: (e as Error).message }, 'bs settle failed')
    }
  }

  function armTimer(match: LiveMatch, seconds: number, onExpire: () => void) {
    if (match.timer) clearTimeout(match.timer)
    match.deadline = Date.now() + seconds * 1000
    match.timer = setTimeout(onExpire, seconds * 1000)
  }

  function armMoveTimer(match: LiveMatch) {
    armTimer(match, MOVE_TIMEOUT_SEC, () => {
      const loser = match.state.turn === 1 ? match.player1Id : match.player2Id
      const winner = loser === match.player1Id ? match.player2Id : match.player1Id
      void finish(match, winner)
    })
  }

  matchmaking.onMatch('BATTLESHIP', (a, b) => {
    void (async () => {
      try {
        const match = await MatchService.createMatch('BATTLESHIP', a.betAmount, a.userId, b.userId)
        const first = fairCoinFlip(match.serverSeed, match.id) === 0 ? 1 : 2
        const live: LiveMatch = {
          matchId: match.id,
          player1Id: a.userId,
          player2Id: b.userId,
          state: bsCreate(first),
          moveIndex: 0,
          timer: null,
          deadline: 0,
        }
        liveMatches.set(match.id, live)
        userToMatch.set(a.userId, match.id)
        userToMatch.set(b.userId, match.id)
        // Placement window: either player failing to place forfeits (draw = cancel).
        armTimer(live, PLACING_TIMEOUT_SEC, () => {
          const placed1 = !!live.state.players[0]
          const placed2 = !!live.state.players[1]
          if (placed1 === placed2) {
            // Nobody (or both — impossible here) placed: cancel with refunds.
            liveMatches.delete(live.matchId)
            userToMatch.delete(live.player1Id)
            userToMatch.delete(live.player2Id)
            void MatchService.cancel(live.matchId).then(() => {
              for (const uid of [live.player1Id, live.player2Id]) {
                nsp.to(`user:${uid}`).emit('bs:cancelled', { matchId: live.matchId })
              }
            })
          } else {
            void finish(live, placed1 ? live.player1Id : live.player2Id)
          }
        })

        for (const uid of [a.userId, b.userId]) {
          nsp.to(`user:${uid}`).emit('bs:matched', { matchId: match.id })
        }
        await emitState(live)
      } catch (e) {
        // Debit failed for one side: notify both, then requeue only players
        // who can actually afford the bet.
        const code = (e as Error).message
        for (const uid of [a.userId, b.userId]) {
          nsp.to(`user:${uid}`).emit('bs:error', { code })
        }
        const users = await prisma.user.findMany({
          where: { id: { in: [a.userId, b.userId] }, isBlocked: false },
          select: { id: true, balance: true },
        })
        for (const entry of [a, b]) {
          const u = users.find((x) => x.id === entry.userId)
          if (u && u.balance >= entry.betAmount) {
            const requeued = matchmaking.enqueue('BATTLESHIP', entry.userId, entry.betAmount)
            if (requeued) nsp.to(`user:${entry.userId}`).emit('bs:queued', {})
          }
        }
      }
    })()
  })

  nsp.on('connection', (socket: Socket) => {
    const userId = socket.data.userId
    if (userId) void socket.join(`user:${userId}`)

    socket.on('bs:queue', (raw) => {
      if (!userId) return socket.emit('bs:error', { code: 'unauthorized' })
      const parsed = queueSchema.safeParse(raw)
      if (!parsed.success) return socket.emit('bs:error', { code: 'validation_error' })
      if (!rateLimit('bet', userId, RATE_RULES.bet)) {
        return socket.emit('bs:error', { code: 'rate_limited' })
      }
      if (userToMatch.has(userId)) return socket.emit('bs:error', { code: 'already_in_match' })
      const queued = matchmaking.enqueue('BATTLESHIP', userId, BigInt(parsed.data.betAmount))
      if (queued) socket.emit('bs:queued', {})
    })

    socket.on('bs:cancel_queue', () => {
      if (userId) matchmaking.dequeue('BATTLESHIP', userId)
      socket.emit('bs:queue_cancelled', {})
    })

    socket.on('bs:place_ships', (raw) => {
      if (!userId) return
      const parsed = placeSchema.safeParse(raw)
      if (!parsed.success) return socket.emit('bs:error', { code: 'validation_error' })
      const match = liveMatches.get(parsed.data.matchId)
      if (!match) return socket.emit('bs:error', { code: 'match_not_found' })
      const num = playerNum(match, userId)
      if (!num) return socket.emit('bs:error', { code: 'not_a_player' })

      const result = bsPlaceShips(match.state, num, parsed.data.ships as Ship[])
      if (!result.ok) return socket.emit('bs:error', { code: result.error })

      match.state = result.state
      match.moveIndex++
      void MatchService.recordMove(match.matchId, userId, match.moveIndex, {
        type: 'placement',
      })
      void MatchService.saveSnapshot(match.matchId, bsToJson(match.state))

      if (result.state.status === 'IN_PROGRESS') {
        armMoveTimer(match)
      }
      void emitState(match)
    })

    socket.on('bs:shoot', (raw) => {
      if (!userId) return
      const parsed = shootSchema.safeParse(raw)
      if (!parsed.success) return socket.emit('bs:error', { code: 'validation_error' })
      const match = liveMatches.get(parsed.data.matchId)
      if (!match) return socket.emit('bs:error', { code: 'match_not_found' })
      const num = playerNum(match, userId)
      if (!num) return socket.emit('bs:error', { code: 'not_a_player' })

      const result = bsShoot(match.state, num, parsed.data.x, parsed.data.y)
      if (!result.ok) return socket.emit('bs:error', { code: result.error })

      match.state = result.state
      match.moveIndex++
      void MatchService.recordMove(
        match.matchId,
        userId,
        match.moveIndex,
        { x: parsed.data.x, y: parsed.data.y },
        { hit: result.extra.hit, sunk: !!result.extra.sunk },
      )
      void MatchService.saveSnapshot(match.matchId, bsToJson(match.state))

      // Per-shot animation event for both players.
      for (const uid of [match.player1Id, match.player2Id]) {
        nsp.to(`user:${uid}`).emit('bs:shot_result', {
          matchId: match.matchId,
          byUserId: userId,
          x: parsed.data.x,
          y: parsed.data.y,
          hit: result.extra.hit,
          sunk: result.extra.sunk,
        })
      }

      if (result.extra.gameOver) {
        void emitState(match).then(() => finish(match, userId))
      } else {
        armMoveTimer(match)
        void emitState(match)
      }
    })

    socket.on('bs:resign', (raw) => {
      if (!userId) return
      const parsed = idSchema.safeParse(raw)
      if (!parsed.success) return
      const match = liveMatches.get(parsed.data.matchId)
      if (!match || !playerNum(match, userId)) return
      const winner = match.player1Id === userId ? match.player2Id : match.player1Id
      void finish(match, winner)
    })

    socket.on('bs:resync', (raw) => {
      if (!userId) return
      const parsed = idSchema.safeParse(raw)
      if (!parsed.success) return
      const match = liveMatches.get(parsed.data.matchId)
      if (match && playerNum(match, userId)) void emitState(match)
    })

    socket.on('disconnect', () => {
      if (userId) matchmaking.dequeue('BATTLESHIP', userId)
    })
  })
}

export function bsActiveMatchFor(userId: string): string | null {
  return userToMatch.get(userId) ?? null
}
