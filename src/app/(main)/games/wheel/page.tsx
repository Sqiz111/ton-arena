'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { Trophy, Users, Timer } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSocketEvents } from '@/hooks/useSocket'
import { useWheelStore } from '@/store/wheel.store'
import { WheelCanvas } from '@/features/wheel/wheel-canvas'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatTon, parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'
import type { WheelStateDto, WheelSpinDto, WheelTier } from '@/types/socket'

const TIERS: Array<{ key: WheelTier; label: string; sub: string }> = [
  { key: 'LOW', label: 'Маленькое', sub: 'до 10 TON' },
  { key: 'MID', label: 'Среднее', sub: 'до 50 TON' },
  { key: 'HIGH', label: 'Огромное', sub: 'без лимита' },
]

function Countdown({ endsAt, offset }: { endsAt: string; offset: number }) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    const tick = () => {
      const remaining = new Date(endsAt).getTime() - (Date.now() + offset)
      setLeft(Math.max(0, Math.ceil(remaining / 1000)))
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [endsAt, offset])
  return (
    <div className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
      <Timer className="h-5 w-5 text-warning" />
      {left}s
    </div>
  )
}

export default function WheelPage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const { tier, state, spin, clockOffset, setTier, applyState, applySpin } = useWheelStore()
  const [amount, setAmount] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [winner, setWinner] = useState<WheelSpinDto | null>(null)

  const socket = useSocketEvents(
    '/wheel',
    {
      'wheel:state': (s: WheelStateDto) => applyState(s),
      'wheel:spin': (sp: WheelSpinDto) => {
        setWinner(null)
        applySpin(sp)
      },
      'wheel:error': (e: { code: string }) => setError(e.code),
    },
    (sock) => sock.emit('wheel:join', { tier }),
  )

  useEffect(() => {
    socket.emit('wheel:join', { tier })
    setWinner(null)
    setError(null)
  }, [tier, socket])

  const placeBet = () => {
    setError(null)
    try {
      const nano = parseTon(amount)
      socket.emit('wheel:bet', { tier, amount: nano.toString() })
    } catch {
      setError('invalid_amount')
    }
  }

  const players = useMemo(() => {
    if (!state) return []
    const byUser = new Map<string, { nickname: string; color: string; total: bigint }>()
    for (const b of state.bets) {
      const cur = byUser.get(b.userId)
      if (cur) cur.total += BigInt(b.amount)
      else byUser.set(b.userId, { nickname: b.nickname, color: b.color, total: BigInt(b.amount) })
    }
    const pot = BigInt(state.potAmount || '1')
    return [...byUser.entries()]
      .map(([userId, p]) => ({
        userId,
        ...p,
        share: pot > 0n ? Number((p.total * 1000n) / pot) / 10 : 0,
      }))
      .sort((a, b) => (a.total > b.total ? -1 : 1))
  }, [state])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Tier tabs */}
      <div className="glass flex gap-1 p-1">
        {TIERS.map(({ key, label, sub }) => (
          <button
            key={key}
            onClick={() => setTier(key)}
            className={cn(
              'flex flex-1 flex-col items-center rounded-xl py-2.5 transition',
              tier === key
                ? 'gradient-primary text-white shadow-lg'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="text-sm font-bold">{label}</span>
            <span className={cn('text-[11px]', tier === key ? 'text-white/70' : '')}>{sub}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Wheel + status */}
        <Card className="relative flex flex-col items-center gap-4 py-8">
          <div className="flex h-8 items-center">
            {state?.status === 'BETTING' && state.bettingEndsAt ? (
              <Countdown endsAt={state.bettingEndsAt} offset={clockOffset} />
            ) : state?.status === 'SPINNING' || spin ? (
              <span className="animate-pulse text-sm font-semibold text-warning">
                Крутим колесо…
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Ожидание игроков ({players.length}/2+)
              </span>
            )}
          </div>

          <WheelCanvas
            bets={state?.bets ?? []}
            potAmount={state?.potAmount ?? '0'}
            spin={spin}
            onSpinEnd={() => {
              if (spin) setWinner(spin)
              void queryClient.invalidateQueries({ queryKey: ['me'] })
            }}
          />

          <AnimatePresence>
            {winner && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-strong absolute inset-x-8 bottom-6 flex items-center justify-center gap-3 px-6 py-4"
              >
                <Trophy className="h-6 w-6 text-warning" />
                <div>
                  <div className="font-bold">{winner.winnerNickname}</div>
                  <div className="text-sm text-success">
                    +{formatTon(winner.payout)} TON
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Bet panel + players */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3">
              {isAuthenticated ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t('common.bet')} (TON)
                    </label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      className="glass w-full px-3 py-2.5 text-sm outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    {['0.5', '1', '5', '10'].map((v) => (
                      <button
                        key={v}
                        onClick={() => setAmount(v)}
                        className="flex-1 rounded-lg bg-white/5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-white/10"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={placeBet}
                    disabled={!state || (state.status !== 'WAITING' && state.status !== 'BETTING')}
                  >
                    {t('common.bet')}
                  </Button>
                  {user && (
                    <p className="text-center text-xs text-muted-foreground">
                      {t('common.balance')}: {formatTon(user.balance)} TON
                    </p>
                  )}
                </>
              ) : (
                <Button className="w-full" size="lg" onClick={connect}>
                  {t('common.connect')}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-primary" />
                Игроки ({players.length})
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {players.map((p) => (
                    <motion.div
                      key={p.userId}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="flex-1 truncate text-sm font-medium">{p.nickname}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {formatTon(p.total)} TON
                      </span>
                      <span className="w-12 text-right text-sm font-bold tabular-nums text-primary">
                        {p.share.toFixed(1)}%
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {players.length === 0 && (
                  <p className="py-3 text-center text-sm text-muted-foreground">
                    Сделайте первую ставку
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {state && (
            <p className="break-all px-2 text-[10px] leading-relaxed text-muted-foreground">
              Seed hash: {state.serverSeedHash}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
