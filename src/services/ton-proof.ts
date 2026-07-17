/**
 * TON Connect ton_proof verification.
 * Spec: https://docs.ton.org/develop/dapps/ton-connect/sign
 *
 * The wallet signs: sha256("ton-proof-item-v2/" ++ address ++ appDomain ++ timestamp ++ payload)
 * wrapped as sha256(0xffff ++ "ton-connect" ++ messageHash) with the wallet's ed25519 key.
 */
import { createHash } from 'crypto'
import { Address, Cell, contractAddress, loadStateInit } from '@ton/core'
import { sign, signVerify } from '@ton/crypto'

export interface TonProofPayload {
  address: string // raw "0:hex"
  network: string // "-239" mainnet | "-3" testnet
  publicKey: string // hex
  proof: {
    timestamp: number
    domain: { lengthBytes: number; value: string }
    signature: string // base64
    payload: string // our nonce payload
    stateInit?: string // base64 BoC
  }
}

const PROOF_TTL_SEC = 15 * 60

export function assembleProofMessage(p: TonProofPayload): Buffer {
  const address = Address.parse(p.address)
  const wc = Buffer.alloc(4)
  wc.writeInt32BE(address.workChain)

  const ts = Buffer.alloc(8)
  ts.writeBigUInt64LE(BigInt(p.proof.timestamp))

  const dl = Buffer.alloc(4)
  dl.writeUInt32LE(p.proof.domain.lengthBytes)

  const msg = Buffer.concat([
    Buffer.from('ton-proof-item-v2/'),
    wc,
    address.hash,
    dl,
    Buffer.from(p.proof.domain.value),
    ts,
    Buffer.from(p.proof.payload),
  ])

  return Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect'),
    createHash('sha256').update(msg).digest(),
  ])
}

/**
 * Full verification: network, signature, domain, timestamp freshness and (when
 * stateInit is present) that the claimed public key controls the claimed address.
 */
export function verifyTonProof(
  p: TonProofPayload,
  expectedDomain: string,
  expectedNetwork: 'mainnet' | 'testnet',
): boolean {
  // 0. Network binding: a testnet wallet must not authenticate on mainnet —
  // the same pubkey can control a different address there.
  const expectedChain = expectedNetwork === 'mainnet' ? '-239' : '-3'
  if (p.network !== expectedChain) return false

  // 1. Freshness
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - p.proof.timestamp) > PROOF_TTL_SEC) return false

  // 2. Domain binding
  if (p.proof.domain.value !== expectedDomain) return false
  if (p.proof.domain.lengthBytes !== Buffer.byteLength(p.proof.domain.value)) return false

  // 3. Address <-> publicKey binding via stateInit when provided
  if (p.proof.stateInit) {
    try {
      const cell = Cell.fromBase64(p.proof.stateInit)
      const stateInit = loadStateInit(cell.beginParse())
      const derived = contractAddress(Address.parse(p.address).workChain, stateInit)
      if (!derived.equals(Address.parse(p.address))) return false
    } catch {
      return false
    }
  }

  // 4. Ed25519 signature over the assembled message
  try {
    const message = createHash('sha256').update(assembleProofMessage(p)).digest()
    return signVerify(message, Buffer.from(p.proof.signature, 'base64'), Buffer.from(p.publicKey, 'hex'))
  } catch {
    return false
  }
}

/** Test helper: produce a valid signature for a given secret key. */
export function signProofForTest(p: TonProofPayload, secretKey: Buffer): string {
  const message = createHash('sha256').update(assembleProofMessage(p)).digest()
  return sign(message, secretKey).toString('base64')
}
