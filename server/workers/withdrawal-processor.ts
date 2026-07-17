import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { BalanceService } from '@/services/balance.service'
import { TonService } from '@/services/ton.service'

const LOOP_INTERVAL_MS = 5_000
const CONFIRM_POLL_MS = 3_000
const CONFIRM_TIMEOUT_MS = 120_000

/**
 * Processes withdrawals strictly one at a time — the ONLY code that signs
 * from the hot wallet, so wallet seqno races are structurally impossible.
 * Balance was already debited at request time (POST /api/withdrawals).
 */
export class WithdrawalProcessor {
  private timer: NodeJS.Timeout | null = null
  private busy = false

  start() {
    if (this.timer) return
    void this.recoverStuck()
    this.timer = setInterval(() => void this.tick(), LOOP_INTERVAL_MS)
    this.timer.unref()
    logger.info('withdrawal processor started')
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Rows stuck in PROCESSING/SENT after a crash.
   * PROCESSING (no transfer signed yet, or signed but unsent) → refund.
   * SENT → seqno consumed is treated as confirmed ONLY together with a manual
   * review entry in the audit log, because a foreign transfer from the same
   * wallet could also bump the seqno.
   */
  private async recoverStuck(): Promise<void> {
    try {
      const stuck = await prisma.withdrawal.findMany({
        where: { status: { in: ['PROCESSING', 'SENT'] } },
      })
      if (stuck.length === 0) return
      const currentSeqno = await TonService.getSeqno()
      for (const w of stuck) {
        if (w.status === 'SENT' && w.seqno !== null && currentSeqno > w.seqno) {
          // Likely confirmed, but flag for admin review instead of silently
          // trusting the seqno (another transfer could have consumed it).
          await prisma.withdrawal.update({
            where: { id: w.id },
            data: { status: 'CONFIRMED', processedAt: new Date() },
          })
          await prisma.auditLog.create({
            data: {
              actorType: 'system',
              action: 'withdrawal.confirmed_by_seqno_after_crash',
              meta: { withdrawalId: w.id, seqno: w.seqno, note: 'verify on-chain manually' },
            },
          })
          logger.warn({ id: w.id }, 'stuck withdrawal confirmed by seqno — flagged for review')
        } else {
          await this.fail(w.id, w.userId, w.amount, 'recovered_after_crash')
        }
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'withdrawal recovery failed')
    }
  }

  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.processNext()
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'withdrawal tick failed')
    } finally {
      this.busy = false
    }
  }

  private async processNext(): Promise<void> {
    // Claim exactly one PENDING row (skip APPROVAL_REQUIRED — admin gate).
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Withdrawal" SET status = 'PROCESSING'
      WHERE id = (
        SELECT id FROM "Withdrawal"
        WHERE status = 'PENDING'
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
    if (claimed.length === 0) return

    const withdrawal = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: claimed[0].id },
    })

    try {
      const seqno = await TonService.getSeqno()
      await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { seqno } })
      await TonService.sendTon(withdrawal.toAddress, withdrawal.amount, seqno)
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'SENT' },
      })
      await this.awaitConfirmation(withdrawal.id, seqno)
    } catch (e) {
      logger.error({ id: withdrawal.id, err: (e as Error).message }, 'withdrawal send failed')
      await this.fail(withdrawal.id, withdrawal.userId, withdrawal.amount, (e as Error).message)
    }
  }

  private async awaitConfirmation(withdrawalId: string, sentSeqno: number): Promise<void> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS))
      try {
        const current = await TonService.getSeqno()
        if (current > sentSeqno) {
          await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { status: 'CONFIRMED', processedAt: new Date() },
          })
          logger.info({ id: withdrawalId }, 'withdrawal confirmed')
          return
        }
      } catch {
        /* transient RPC failure — keep polling */
      }
    }
    // Timed out: leave as SENT; recovery on next boot resolves it via seqno.
    logger.warn({ id: withdrawalId }, 'withdrawal confirmation timed out (left as SENT)')
  }

  private async fail(
    withdrawalId: string,
    userId: string,
    amount: bigint,
    reason: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'FAILED', failReason: reason.slice(0, 500), processedAt: new Date() },
      })
      await BalanceService.applyEntry(tx, userId, 'WITHDRAWAL_REFUND', amount, {
        refType: 'withdrawal',
        refId: withdrawalId,
      })
    })
  }
}

export const withdrawalProcessor = new WithdrawalProcessor()
