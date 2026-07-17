import type { GameType } from '@prisma/client'

export interface QueueEntry {
  userId: string
  betAmount: bigint
  enqueuedAt: number
}

type MatchFoundHandler = (a: QueueEntry, b: QueueEntry) => void

/**
 * In-memory FIFO matchmaking per (gameType, betAmount). Money is NOT debited
 * here — MatchService.createMatch does that atomically when a pair is found.
 */
export class MatchmakingService {
  private queues = new Map<string, QueueEntry[]>()
  private handlers = new Map<GameType, MatchFoundHandler>()

  onMatch(gameType: GameType, handler: MatchFoundHandler) {
    this.handlers.set(gameType, handler)
  }

  private key(gameType: GameType, betAmount: bigint): string {
    return `${gameType}:${betAmount}`
  }

  /** Returns true if queued, false if immediately matched. */
  enqueue(gameType: GameType, userId: string, betAmount: bigint): boolean {
    const key = this.key(gameType, betAmount)
    const queue = this.queues.get(key) ?? []

    // A user can't queue twice or match with themselves.
    this.dequeue(gameType, userId)

    const waiting = (this.queues.get(key) ?? []).find((e) => e.userId !== userId)
    if (waiting) {
      const queueNow = this.queues.get(key)!
      this.queues.set(
        key,
        queueNow.filter((e) => e.userId !== waiting.userId),
      )
      this.handlers.get(gameType)?.(waiting, { userId, betAmount, enqueuedAt: Date.now() })
      return false
    }

    queue.push({ userId, betAmount, enqueuedAt: Date.now() })
    this.queues.set(key, queue)
    return true
  }

  /** Remove a user from every queue of the given game. */
  dequeue(gameType: GameType, userId: string): void {
    for (const [key, queue] of this.queues) {
      if (!key.startsWith(`${gameType}:`)) continue
      const filtered = queue.filter((e) => e.userId !== userId)
      if (filtered.length !== queue.length) this.queues.set(key, filtered)
    }
  }
}

export const matchmaking = new MatchmakingService()
