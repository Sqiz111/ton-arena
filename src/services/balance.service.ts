import type { LedgerType } from '@prisma/client'
import { prisma, type Tx } from '@/lib/prisma'

export class InsufficientBalanceError extends Error {
  constructor() {
    super('insufficient_balance')
  }
}

export interface LedgerRef {
  refType?: string
  refId?: string
}

/**
 * The ONLY code path allowed to mutate User.balance.
 * Locks the user row, validates the invariant, appends a ledger entry
 * and updates the cached balance — all inside the caller's transaction.
 */
export const BalanceService = {
  async applyEntry(
    tx: Tx,
    userId: string,
    type: LedgerType,
    amount: bigint, // signed: credit > 0, debit < 0
    ref: LedgerRef = {},
  ): Promise<{ balanceAfter: bigint }> {
    // Row lock — serializes concurrent balance changes per user.
    const rows = await tx.$queryRaw<Array<{ balance: bigint }>>`
      SELECT balance FROM "User" WHERE id = ${userId} FOR UPDATE
    `
    if (rows.length !== 1) throw new Error('user_not_found')

    const balanceAfter = rows[0].balance + amount
    if (balanceAfter < 0n) throw new InsufficientBalanceError()

    await tx.ledgerEntry.create({
      data: {
        userId,
        type,
        amount,
        balanceAfter,
        refType: ref.refType,
        refId: ref.refId,
      },
    })
    await tx.user.update({ where: { id: userId }, data: { balance: balanceAfter } })

    return { balanceAfter }
  },

  /** Convenience wrapper when the caller has no ambient transaction. */
  async apply(
    userId: string,
    type: LedgerType,
    amount: bigint,
    ref: LedgerRef = {},
  ): Promise<{ balanceAfter: bigint }> {
    return prisma.$transaction((tx) => this.applyEntry(tx, userId, type, amount, ref))
  },

  /** Audit helper: recompute a user's balance from the ledger. */
  async recomputeFromLedger(userId: string): Promise<bigint> {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { userId },
      _sum: { amount: true },
    })
    return agg._sum.amount ?? 0n
  },
}
