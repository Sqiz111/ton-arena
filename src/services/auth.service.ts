import { randomBytes } from 'crypto'
import { Address } from '@ton/core'
import { prisma } from '@/lib/prisma'
import { verifyTonProof, type TonProofPayload } from './ton-proof'

const NONCE_TTL_MS = 15 * 60 * 1000

function randomToken(prefix: string, len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no confusable chars
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return `${prefix}-${out}`
}

export const AuthService = {
  /** Create a one-time ton_proof challenge payload. */
  async createChallenge(): Promise<string> {
    const payload = randomBytes(24).toString('hex')
    await prisma.authNonce.create({
      data: { payload, expiresAt: new Date(Date.now() + NONCE_TTL_MS) },
    })
    return payload
  },

  /**
   * Verify a ton_proof, consume the nonce and upsert the user.
   * Returns the user or null when verification fails.
   */
  async verifyAndLogin(
    proof: TonProofPayload,
    expectedDomain: string,
    expectedNetwork: 'mainnet' | 'testnet',
  ) {
    // Opportunistic cleanup so the nonce table doesn't grow unbounded.
    void prisma.authNonce
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
      .catch(() => {})

    // Nonce must exist, be unexpired and unused — consume atomically.
    const nonce = await prisma.authNonce.updateMany({
      where: {
        payload: proof.proof.payload,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    })
    if (nonce.count !== 1) return null

    if (!verifyTonProof(proof, expectedDomain, expectedNetwork)) return null

    const tonAddress = Address.parse(proof.address).toRawString()

    const existing = await prisma.user.findUnique({ where: { tonAddress } })
    if (existing) return existing

    // First connect — auto-create profile with unique nickname/memo.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.user.create({
          data: {
            tonAddress,
            nickname: `player_${randomToken('', 5).slice(1).toLowerCase()}`,
            depositMemo: randomToken('TA'),
            clientSeed: randomBytes(16).toString('hex'),
            stats: { create: {} },
          },
        })
      } catch (e: unknown) {
        // Unique collision on nickname/memo — retry with new randoms.
        if (attempt === 4) throw e
      }
    }
    throw new Error('unreachable')
  },
}
