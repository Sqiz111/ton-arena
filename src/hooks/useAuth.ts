'use client'

import { useEffect, useRef } from 'react'
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface MeUser {
  id: string
  nickname: string
  avatarUrl: string | null
  tonAddress: string
  depositMemo: string
  balance: string
  xp: number
  level: number
  locale: string
  createdAt: string
  stats: {
    gamesPlayed: number
    gamesWon: number
    winRate: number
    totalWagered: string
    totalWon: string
    totalLost: string
    biggestWin: string
  } | null
}

async function fetchMe(): Promise<MeUser | null> {
  const res = await fetch('/api/me', { credentials: 'include' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error('me_failed')
  const data = await res.json()
  return data.user
}

/**
 * Orchestrates TON Connect <-> backend session:
 *  - requests a ton_proof challenge before the wallet connects
 *  - on wallet connect with proof, POSTs /api/auth/verify to set the session cookie
 *  - exposes the authenticated user via React Query ['me']
 */
export function useAuth() {
  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()
  const queryClient = useQueryClient()
  const verifying = useRef(false)

  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe })

  // Attach a fresh challenge payload whenever the connect modal may open.
  useEffect(() => {
    if (!tonConnectUI) return
    let cancelled = false

    async function refreshPayload() {
      tonConnectUI.setConnectRequestParameters({ state: 'loading' })
      try {
        const res = await fetch('/api/auth/challenge', { method: 'POST' })
        const { payload } = await res.json()
        if (!cancelled) {
          tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof: payload } })
        }
      } catch {
        if (!cancelled) tonConnectUI.setConnectRequestParameters(null)
      }
    }

    // Only needed while there is no active wallet session.
    if (!wallet) void refreshPayload()
    return () => {
      cancelled = true
    }
  }, [tonConnectUI, wallet])

  // When the wallet connects and carries a ton_proof, exchange it for a session.
  useEffect(() => {
    if (!wallet || verifying.current) return
    const proof =
      wallet.connectItems?.tonProof && 'proof' in wallet.connectItems.tonProof
        ? wallet.connectItems.tonProof.proof
        : null
    if (!proof) return
    if (meQuery.data) return // already authenticated

    verifying.current = true
    void (async () => {
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            address: wallet.account.address,
            network: wallet.account.chain,
            publicKey: wallet.account.publicKey,
            proof: {
              timestamp: proof.timestamp,
              domain: proof.domain,
              signature: proof.signature,
              payload: proof.payload,
              stateInit: wallet.account.walletStateInit,
            },
          }),
        })
        if (res.ok) {
          await queryClient.invalidateQueries({ queryKey: ['me'] })
        } else {
          // Proof rejected — drop the wallet connection to avoid a broken state.
          await tonConnectUI.disconnect().catch(() => {})
        }
      } catch {
        // Network hiccup: leave the wallet connected; the user can retry by
        // reconnecting. Swallowing here prevents an unhandled rejection loop.
      } finally {
        verifying.current = false
      }
    })()
  }, [wallet, meQuery.data, queryClient, tonConnectUI])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    try {
      await tonConnectUI.disconnect()
    } catch {
      /* wallet may already be disconnected */
    }
    queryClient.setQueryData(['me'], null)
  }

  return {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    isAuthenticated: !!meQuery.data,
    walletConnected: !!wallet,
    connect: () => tonConnectUI.openModal(),
    logout,
  }
}
