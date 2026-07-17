'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bomb, Gem, Banknote } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTon, parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

interface MinesGame {
  id: string
  status: 'ACTIVE' | 'CASHED_OUT' | 'BUSTED'
  betAmount: string
  config: { gridSize: number; mines: number }
  revealed: number[]
  multiplier: number
  potentialPayout: string
  mines?: number[]
  payout?: string
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.code ?? 'error')
  return data
}

const MINE_OPTIONS = [3, 5, 10, 15, 24]

export default function MinesPage() {
  const t = useTranslations()
  const { isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const [bet, setBet] = useState('1')
  const [mineCount, setMineCount] = useState(5)
  const [gridSize, setGridSize] = useState(5)
  const [lastResult, setLastResult] = useState<MinesGame | null>(null)
  const [error, setError] = useState<string | null>(null)

  const active = useQuery({
    queryKey: ['mines-active'],
    queryFn: async () => (await api<{ game: MinesGame | null }>('/api/games/solo/mines')).game,
    enabled: isAuthenticated,
  })

  const game = active.data ?? null
  const cells = (game?.config.gridSize ?? gridSize) ** 2
  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['mines-active'] })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  const start = useMutation({
    mutationFn: async () => {
      setError(null)
      setLastResult(null)
      return (
        await api<{ game: MinesGame }>('/api/games/solo/mines', {
          amount: parseTon(bet).toString(),
          gridSize,
          mines: mineCount,
        })
      ).game
    },
    onSuccess: invalidateAll,
    onError: (e: Error) => setError(e.message),
  })

  const reveal = useMutation({
    mutationFn: async (cell: number) =>
      (await api<{ game: MinesGame }>(`/api/games/solo/mines/${game!.id}/reveal`, { cell })).game,
    onSuccess: (g) => {
      if (g.status !== 'ACTIVE') setLastResult(g)
      invalidateAll()
    },
    onError: (e: Error) => setError(e.message),
  })

  const cashout = useMutation({
    mutationFn: async () =>
      (await api<{ game: MinesGame }>(`/api/games/solo/mines/${game!.id}/cashout`, {})).game,
    onSuccess: (g) => {
      setLastResult(g)
      invalidateAll()
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('games.mines')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  const display = game ?? lastResult
  const displayCells = display ? display.config.gridSize ** 2 : cells

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]">
      {/* Controls */}
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bomb className="h-5 w-5 text-amber-400" />
            {t('games.mines')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('common.bet')} (TON)
            </label>
            <input
              value={bet}
              onChange={(e) => setBet(e.target.value)}
              disabled={!!game}
              inputMode="decimal"
              className="glass w-full px-3 py-2.5 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Мины
            </label>
            <div className="flex flex-wrap gap-1.5">
              {MINE_OPTIONS.filter((m) => m < gridSize * gridSize).map((m) => (
                <button
                  key={m}
                  onClick={() => setMineCount(m)}
                  disabled={!!game}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition',
                    mineCount === m
                      ? 'gradient-primary text-white'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Поле
            </label>
            <div className="flex gap-1.5">
              {[5, 7].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setGridSize(s)
                    if (mineCount >= s * s) setMineCount(5)
                  }}
                  disabled={!!game}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition',
                    gridSize === s
                      ? 'gradient-primary text-white'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {s}×{s}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!game ? (
            <Button className="w-full" size="lg" onClick={() => start.mutate()} disabled={start.isPending}>
              {t('common.play')}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="glass px-4 py-3 text-center">
                <div className="text-xs text-muted-foreground">Множитель</div>
                <motion.div
                  key={game.multiplier}
                  initial={{ scale: 1.3, color: '#22C55E' }}
                  animate={{ scale: 1, color: '#F8FAFC' }}
                  className="text-2xl font-extrabold"
                >
                  ×{game.multiplier.toFixed(2)}
                </motion.div>
                <div className="text-sm text-success">
                  {formatTon(game.potentialPayout)} TON
                </div>
              </div>
              <Button
                className="w-full"
                size="lg"
                variant="success"
                disabled={game.revealed.length === 0 || cashout.isPending}
                onClick={() => cashout.mutate()}
              >
                <Banknote className="h-5 w-5" />
                Cash Out
              </Button>
            </div>
          )}

          {lastResult && (
            <div
              className={cn(
                'rounded-xl px-4 py-3 text-center text-sm font-semibold',
                lastResult.status === 'CASHED_OUT'
                  ? 'bg-success/15 text-success'
                  : 'bg-destructive/15 text-destructive',
              )}
            >
              {lastResult.status === 'CASHED_OUT'
                ? `Выигрыш +${formatTon(lastResult.payout ?? '0')} TON`
                : 'Мина! Ставка сгорела'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grid */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${display?.config.gridSize ?? gridSize}, minmax(0,1fr))`,
        }}
      >
        {Array.from({ length: displayCells }, (_, i) => {
          const revealed = display?.revealed.includes(i) ?? false
          const isMine = display?.mines?.includes(i) ?? false
          const ended = !!display && display.status !== 'ACTIVE'
          return (
            <motion.button
              key={`${display?.id ?? 'idle'}-${i}`}
              whileHover={game && !revealed ? { scale: 1.05 } : undefined}
              whileTap={game && !revealed ? { scale: 0.95 } : undefined}
              disabled={!game || revealed || reveal.isPending}
              onClick={() => reveal.mutate(i)}
              className={cn(
                'relative aspect-square rounded-xl border transition-colors duration-200',
                revealed
                  ? 'border-success/40 bg-success/10'
                  : ended && isMine
                    ? 'border-destructive/40 bg-destructive/15'
                    : 'glass hover:border-primary/40',
              )}
            >
              <AnimatePresence>
                {revealed && (
                  <motion.div
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <Gem className="h-1/2 w-1/2 text-success" />
                  </motion.div>
                )}
                {ended && isMine && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.3, 1] }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <Bomb className="h-1/2 w-1/2 text-destructive" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
