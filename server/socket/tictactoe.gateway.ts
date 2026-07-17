import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { prisma } from '../../src/lib/prisma'
import { logger } from '../../src/lib/logger'
import { rateLimit, RATE_RULES } from '../../src/lib/rate-limit'
import { MatchService } from '../../src/services/match.service'
import { fairCoinFlip } from '../../src/services/fair'
import { MOVE_TIMEOUT_SEC } from '../../src/shared/constants'
import { matchmaking } from '../engines/MatchmakingService'
import { tttCreate, tttApplyMove, type TttState } from '../engines/TicTacToeEngine'
import { broadcastWin } from './live.gateway'

interface LiveMatch {
  matchId: string
  player1Id: string
  player2Id: string
  state: TttState
  moveIndex: number
  moveTimer: NodeJS.Timeout | null
  deadline: number
}

const liveMatches = new Map<string, LiveMatch>() // matchId -> state
const userToMatch = new Map<string, string>() // userId -> matchId

const queueSchema = z.object({
  betAmount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n),
})
const moveSchema = z.object({ matchId: z.string(), cell: z.number().int().min(0).max(8) })
const idSchema = z.object({ matchId: z.string() })

export function registerTicTacToeGateway(io: Server) {
  const nsp = io.of('/tictactoe')

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
    const turnUserId = match.state.turn === 1 ? match.player1Id : match.player2Id

    for (const [userId, mark] of [
      [match.player1Id, 1],
      [match.player2Id, 2],
    ] as const) {
      const opponentId = mark === 1 ? match.player2Id : match.player1Id
      const opponent = byId.get(opponentId)
      nsp.to(`user:${userId}`).emit('ttt:state', {
        matchId: match.matchId,
        board: match.state.board,
        yourMark: mark,
        turnUserId,
        deadline: new Date(match.deadline).toISOString(),
        status: 'IN_PROGRESS',
        opponent: { nickname: opponent?.nickname ?? '?', avatarUrl: opponent?.avatarUrl ?? null },
        betAmount: dbMatch.betAmount.toString(),
      })
    }
  }

  async function finish(match: LiveMatch, winnerUserId: string | null) {
    if (match.moveTimer) clearTimeout(match.moveTimer)
    liveMatches.delete(match.matchId)
    userToMatch.delete(match.player1Id)
    userToMatch.delete(match.player2Id)

    try {
      const { payout } = await MatchService.settle(match.matchId, winnerUserId)
      nsp.to(`user:${match.player1Id}`).to(`user:${match.player2Id}`).emit('ttt:game_over', {
        matchId: match.matchId,
        winnerUserId,
        payout: payout.toString(),
        board: match.state.board,
      })
      if (winnerUserId && payout > 0n) {
        const winner = await prisma.user.findUnique({ where: { id: winnerUserId } })
        if (winner) {
          broadcastWin({ nickname: winner.nickname, gameType: 'tictactoe', amount: payout.toString() })
        }
      }
    } catch (e) {
      logger.error({ matchId: match.matchId, err: (e as Error).message }, 'ttt settle failed')
    }
  }

  function armMoveTimer(match: LiveMatch) {
    if (match.moveTimer) clearTimeout(match.moveTimer)
    match.deadline = Date.now() + MOVE_TIMEOUT_SEC * 1000
    match.moveTimer = setTimeout(() => {
      // Timeout = forfeit: the player whose turn it is loses.
      const loser = match.state.turn === 1 ? match.player1Id : match.player2Id
      const winner = loser === match.player1Id ? match.player2Id : match.player1Id
      void finish(match, winner)
    }, MOVE_TIMEOUT_SEC * 1000)
  }

  matchmaking.onMatch('TICTACTOE', (a, b) => {
    void (async () => {
      try {
        const match = await MatchService.createMatch('TICTACTOE', a.betAmount, a.userId, b.userId)
        const first = fairCoinFlip(match.serverSeed, match.id) === 0 ? 1 : 2
        const live: LiveMatch = {
          matchId: match.id,
          player1Id: a.userId,
          player2Id: b.userId,
          state: tttCreate(first),
          moveIndex: 0,
          moveTimer: null,
          deadline: 0,
        }
        liveMatches.set(match.id, live)
        userToMatch.set(a.userId, match.id)
        userToMatch.set(b.userId, match.id)
        armMoveTimer(live)

        for (const uid of [a.userId, b.userId]) {
          nsp.to(`user:${uid}`).emit('ttt:matched', { matchId: match.id })
        }
        await emitState(live)
      } catch (e) {
        // Debit failed for one side: notify both, then requeue only players
        // who can actually afford the bet (avoids a broke player cycling
        // honest opponents out of the queue).
        const code = (e as Error).message
        for (const uid of [a.userId, b.userId]) {
          nsp.to(`user:${uid}`).emit('ttt:error', { code })
        }
        const users = await prisma.user.findMany({
          where: { id: { in: [a.userId, b.userId] }, isBlocked: false },
          select: { id: true, balance: true },
        })
        for (const entry of [a, b]) {
          const u = users.find((x) => x.id === entry.userId)
          if (u && u.balance >= entry.betAmount) {
            const requeued = matchmaking.enqueue('TICTACTOE', entry.userId, entry.betAmount)
            if (requeued) nsp.to(`user:${entry.userId}`).emit('ttt:queued', {})
          }
        }
      }
    })()
  })

  nsp.on('connection', (socket: Socket) => {
    const userId = socket.data.userId
    if (userId) void socket.join(`user:${userId}`)

    socket.on('ttt:queue', (raw) => {
      if (!userId) return socket.emit('ttt:error', { code: 'unauthorized' })
      const parsed = queueSchema.safeParse(raw)
      if (!parsed.success) return socket.emit('ttt:error', { code: 'validation_error' })
      if (!rateLimit('bet', userId, RATE_RULES.bet)) {
        return socket.emit('ttt:error', { code: 'rate_limited' })
      }
      if (userToMatch.has(userId)) return socket.emit('ttt:error', { code: 'already_in_match' })
      const queued = matchmaking.enqueue('TICTACTOE', userId, BigInt(parsed.data.betAmount))
      if (queued) socket.emit('ttt:queued', {})
    })

    socket.on('ttt:cancel_queue', () => {
      if (userId) matchmaking.dequeue('TICTACTOE', userId)
      socket.emit('ttt:queue_cancelled', {})
    })

    socket.on('ttt:move', (raw) => {
      if (!userId) return
      const parsed = moveSchema.safeParse(raw)
      if (!parsed.success) return socket.emit('ttt:error', { code: 'validation_error' })
      const match = liveMatches.get(parsed.data.matchId)
      if (!match) return socket.emit('ttt:error', { code: 'match_not_found' })
      const num = playerNum(match, userId)
      if (!num) return socket.emit('ttt:error', { code: 'not_a_player' })

      const result = tttApplyMove(match.state, num, parsed.data.cell)
      if (!result.ok) return socket.emit('ttt:error', { code: result.error })

      match.state = result.state
      match.moveIndex++
      void MatchService.recordMove(match.matchId, userId, match.moveIndex, {
        cell: parsed.data.cell,
      })
      void MatchService.saveSnapshot(match.matchId, {
        board: match.state.board,
        turn: match.state.turn,
      })

      if (result.state.status === 'WIN') {
        void emitState(match).then(() =>
          finish(match, result.state.winner === 1 ? match.player1Id : match.player2Id),
        )
      } else if (result.state.status === 'DRAW') {
        void emitState(match).then(() => finish(match, null))
      } else {
        armMoveTimer(match)
        void emitState(match)
      }
    })

    socket.on('ttt:resign', (raw) => {
      if (!userId) return
      const parsed = idSchema.safeParse(raw)
      if (!parsed.success) return
      const match = liveMatches.get(parsed.data.matchId)
      if (!match || !playerNum(match, userId)) return
      const winner = match.player1Id === userId ? match.player2Id : match.player1Id
      void finish(match, winner)
    })

    socket.on('ttt:resync', (raw) => {
      if (!userId) return
      const parsed = idSchema.safeParse(raw)
      if (!parsed.success) return
      const match = liveMatches.get(parsed.data.matchId)
      if (match && playerNum(match, userId)) void emitState(match)
    })

    socket.on('disconnect', () => {
      if (userId) matchmaking.dequeue('TICTACTOE', userId)
      // In-match disconnect: the move timer already enforces forfeit.
    })
  })
}

/** For reconnect UX: which live match does this user belong to? */
export function tttActiveMatchFor(userId: string): string | null {
  return userToMatch.get(userId) ?? null
}
