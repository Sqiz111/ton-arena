import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { BalanceService } from '@/services/balance.service'
import { ConfigService } from '@/services/config.service'
import { TonService } from '@/services/ton.service'
import { CONFIG_KEYS } from '@/shared/constants'

const POLL_INTERVAL_MS = 10_000

/**
 * Polls the hot wallet for incoming transfers and credits user balances.
 * Idempotency: unique (txHash, lt) on Deposit; re-processing a seen tx is a no-op.
 */
export class DepositWatcher {
  private timer: NodeJS.Timeout | null = null
  private running = false

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS)
    this.timer.unref()
    logger.info('deposit watcher started')
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.running) return // skip overlapping ticks
    this.running = true
    try {
      await this.processNewTransactions()
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'deposit watcher tick failed')
    } finally {
      this.running = false
    }
  }

  private async processNewTransactions(): Promise<void> {
    const cursorStr = await ConfigService.get(CONFIG_KEYS.depositCursor)
    const cursor = cursorStr ? BigInt(cursorStr) : 0n
    const minDeposit = await ConfigService.getBigInt(CONFIG_KEYS.minDeposit)

    const txs = await TonService.getIncomingTransactions(cursor)
    // Process oldest-first so the cursor only ever moves forward past committed work.
    const fresh = txs.sort((a, b) => (a.lt < b.lt ? -1 : 1))

    for (const tx of fresh) {
      if (tx.comment) {
        const user = await prisma.user.findUnique({ where: { depositMemo: tx.comment } })
        if (user && tx.amount >= minDeposit) {
          await this.creditDeposit(user.id, tx)
        } else {
          await prisma.auditLog.create({
            data: {
              actorType: 'system',
              action: 'deposit.unmatched',
              meta: {
                txHash: tx.txHash,
                lt: tx.lt.toString(),
                from: tx.fromAddress,
                amount: tx.amount.toString(),
                comment: tx.comment,
                reason: user ? 'below_min_deposit' : 'unknown_memo',
              },
            },
          })
        }
      }
      // Advance the cursor only after the tx above is fully committed.
      await ConfigService.set(CONFIG_KEYS.depositCursor, tx.lt.toString())
    }
  }

  private async creditDeposit(
    userId: string,
    tx: { txHash: string; lt: bigint; fromAddress: string; amount: bigint; comment: string },
  ): Promise<void> {
    await prisma.$transaction(async (dbtx) => {
      // Insert first — the unique constraint is the idempotency gate.
      const existing = await dbtx.deposit.findUnique({
        where: { txHash_lt: { txHash: tx.txHash, lt: tx.lt } },
      })
      if (existing) return

      const deposit = await dbtx.deposit.create({
        data: {
          userId,
          amount: tx.amount,
          txHash: tx.txHash,
          lt: tx.lt,
          fromAddress: tx.fromAddress,
          comment: tx.comment,
        },
      })
      await BalanceService.applyEntry(dbtx, userId, 'DEPOSIT', tx.amount, {
        refType: 'deposit',
        refId: deposit.id,
      })
    })
    logger.info({ userId, amount: tx.amount.toString() }, 'deposit credited')
    const { AchievementService } = await import('../../src/services/achievement.service')
    void AchievementService.onDeposit(userId)
  }
}

export const depositWatcher = new DepositWatcher()
