import { Address, internal, toNano as coreToNano, fromNano } from '@ton/core'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import { getEnv, TONCENTER_ENDPOINTS } from '@/lib/config'
import { logger } from '@/lib/logger'

export interface IncomingTx {
  txHash: string
  lt: bigint
  fromAddress: string
  amount: bigint
  comment: string
}

let client: TonClient | null = null

export function getTonClient(): TonClient {
  if (client) return client
  const env = getEnv()
  client = new TonClient({
    endpoint: TONCENTER_ENDPOINTS[env.TON_NETWORK],
    apiKey: env.TONCENTER_API_KEY || undefined,
  })
  return client
}

interface HotWallet {
  contract: WalletContractV4
  secretKey: Buffer
  address: Address
}

let hotWallet: HotWallet | null = null

export async function getHotWallet(): Promise<HotWallet> {
  if (hotWallet) return hotWallet
  const env = getEnv()
  if (!env.HOT_WALLET_MNEMONIC) throw new Error('HOT_WALLET_MNEMONIC is not configured')
  const keyPair = await mnemonicToPrivateKey(env.HOT_WALLET_MNEMONIC.trim().split(/\s+/))
  const contract = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
  hotWallet = { contract, secretKey: keyPair.secretKey, address: contract.address }
  return hotWallet
}

export const TonService = {
  /** Normalized (raw) address string used as the User.tonAddress key. */
  normalizeAddress(addr: string): string {
    return Address.parse(addr).toRawString()
  },

  isValidAddress(addr: string): boolean {
    try {
      Address.parse(addr)
      return true
    } catch {
      return false
    }
  },

  async getHotWalletAddress(): Promise<string> {
    const env = getEnv()
    const wallet = await getHotWallet()
    return wallet.address.toString({ bounceable: false, testOnly: env.TON_NETWORK === 'testnet' })
  },

  /**
   * Incoming transfers to the hot wallet with lt > sinceLt, paginated until
   * exhaustion so bursts larger than one page are never skipped.
   */
  async getIncomingTransactions(sinceLt: bigint, pageSize = 50): Promise<IncomingTx[]> {
    const wallet = await getHotWallet()
    const client = getTonClient()
    const incoming: IncomingTx[] = []
    let beforeLt: string | undefined
    let beforeHash: string | undefined

    // Walk backwards (newest → oldest) until we pass the cursor.
    for (let page = 0; page < 40; page++) {
      const txs = await client.getTransactions(wallet.address, {
        limit: pageSize,
        archival: true,
        ...(beforeLt && beforeHash ? { lt: beforeLt, hash: beforeHash } : {}),
      })
      if (txs.length === 0) break

      let passedCursor = false
      for (const tx of txs) {
        if (tx.lt <= sinceLt) {
          passedCursor = true
          break
        }
        const msg = tx.inMessage
        if (!msg || msg.info.type !== 'internal') continue
        const amount = msg.info.value.coins
        if (amount <= 0n) continue

        // Text comment: body starts with 32-bit op = 0
        let comment = ''
        try {
          const slice = msg.body.beginParse()
          if (slice.remainingBits >= 32 && slice.loadUint(32) === 0) {
            comment = slice.loadStringTail().trim()
          }
        } catch {
          /* not a text comment */
        }

        incoming.push({
          txHash: tx.hash().toString('hex'),
          lt: tx.lt,
          fromAddress: msg.info.src.toString(),
          amount,
          comment,
        })
      }
      if (passedCursor || txs.length < pageSize) break
      const oldest = txs[txs.length - 1]
      beforeLt = oldest.lt.toString()
      beforeHash = oldest.hash().toString('base64')
    }
    return incoming
  },

  async getSeqno(): Promise<number> {
    const wallet = await getHotWallet()
    return getTonClient().open(wallet.contract).getSeqno()
  },

  /**
   * Send TON from the hot wallet. MUST only be called from the single
   * withdrawal-processor loop (seqno serialization).
   */
  async sendTon(toAddress: string, amountNano: bigint, seqno: number): Promise<void> {
    const wallet = await getHotWallet()
    const opened = getTonClient().open(wallet.contract)
    await opened.sendTransfer({
      seqno,
      secretKey: wallet.secretKey,
      messages: [
        internal({
          to: Address.parse(toAddress),
          value: amountNano,
          bounce: false,
          body: 'TON Arena withdrawal',
        }),
      ],
    })
    logger.info({ toAddress, amount: fromNano(amountNano), seqno }, 'withdrawal transfer sent')
  },

  async getHotWalletBalance(): Promise<bigint> {
    const wallet = await getHotWallet()
    return getTonClient().getBalance(wallet.address)
  },
}

// re-export for convenience in scripts
export { coreToNano }
