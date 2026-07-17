'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Flag, RotateCw, Shuffle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSocketEvents } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatTon, parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

const SIZE = 10
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]

interface Ship {
  x: number
  y: number
  length: number
  horizontal: boolean
}

interface Shot {
  x: number
  y: number
  hit: boolean
}

interface BsState {
  matchId: string
  phase: 'PLACING' | 'IN_PROGRESS' | 'COMPLETED'
  yourBoard: Ship[] | null
  yourShots: Shot[]
  opponentShots: Shot[]
  turnUserId: string | null
  deadline: string | null
  opponent: { nickname: string; avatarUrl: string | null }
  youPlaced: boolean
  opponentPlaced: boolean
  betAmount: string
}

interface GameOver {
  matchId: string
  winnerUserId: string | null
  payout: string
  revealBoard: Ship[]
}

type Phase = 'idle' | 'queued' | 'placing' | 'playing' | 'over'

function shipCells(ship: Ship): Array<{ x: number; y: number }> {
  return Array.from({ length: ship.length }, (_, i) => ({
    x: ship.x + (ship.horizontal ? i : 0),
    y: ship.y + (ship.horizontal ? 0 : i),
  }))
}

function canPlace(ships: Ship[], candidate: Ship): boolean {
  const cells = shipCells(candidate)
  if (cells.some((c) => c.x < 0 || c.y < 0 || c.x >= SIZE || c.y >= SIZE)) return false
  const occupied = new Set(ships.flatMap((s) => shipCells(s).map((c) => `${c.x},${c.y}`)))
  for (const { x, y } of cells) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (occupied.has(`${x + dx},${y + dy}`)) return false
      }
    }
  }
  return true
}

function randomFleet(): Ship[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ships: Ship[] = []
    let failed = false
    for (const length of FLEET) {
      let placed = false
      for (let tries = 0; tries < 200; tries++) {
        const horizontal = Math.random() < 0.5
        const ship: Ship = {
          x: Math.floor(Math.random() * (horizontal ? SIZE - length + 1 : SIZE)),
          y: Math.floor(Math.random() * (horizontal ? SIZE : SIZE - length + 1)),
          length,
          horizontal,
        }
        if (canPlace(ships, ship)) {
          ships.push(ship)
          placed = true
          break
        }
      }
      if (!placed) {
        failed = true
        break
      }
    }
    if (!failed) return ships
  }
  throw new Error('fleet generation failed')
}

function Grid({
  title,
  ships,
  shots,
  interactive,
  onCell,
  highlightLast,
}: {
  title: string
  ships: Ship[] | null
  shots: Shot[]
  interactive: boolean
  onCell?: (x: number, y: number) => void
  highlightLast?: Shot | null
}) {
  const shipSet = useMemo(
    () => new Set((ships ?? []).flatMap((s) => shipCells(s).map((c) => `${c.x},${c.y}`))),
    [ships],
  )
  const shotMap = useMemo(() => {
    const m = new Map<string, Shot>()
    for (const s of shots) m.set(`${s.x},${s.y}`, s)
    return m
  }, [shots])

  return (
    <div>
      <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0,1fr))` }}
      >
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const x = i % SIZE
          const y = Math.floor(i / SIZE)
          const key = `${x},${y}`
          const shot = shotMap.get(key)
          const isShip = shipSet.has(key)
          const isLast = highlightLast && highlightLast.x === x && highlightLast.y === y
          return (
            <motion.button
              key={key}
              disabled={!interactive || !!shot}
              onClick={() => onCell?.(x, y)}
              whileHover={interactive && !shot ? { scale: 1.12 } : {}}
              animate={isLast ? { scale: [1, 1.4, 1] } : {}}
              className={cn(
                'relative aspect-square rounded-[4px] transition-colors',
                isShip ? 'bg-primary/50' : 'bg-white/[0.05]',
                interactive && !shot && 'hover:bg-primary/25',
                shot && shot.hit && 'bg-destructive/70',
                shot && !shot.hit && 'bg-slate-600/60',
              )}
            >
              {shot && !shot.hit && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-white/70">
                  •
                </span>
              )}
              {shot?.hit && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 flex items-center justify-center text-[10px]"
                >
                  ✕
                </motion.span>
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

export default function BattleshipPage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('idle')
  const [bet, setBet] = useState('1')
  const [state, setState] = useState<BsState | null>(null)
  const [over, setOver] = useState<GameOver | null>(null)
  const [draft, setDraft] = useState<Ship[]>(() => [])
  const [error, setError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [lastShot, setLastShot] = useState<Shot | null>(null)

  const socket = useSocketEvents('/battleship', {
    'bs:queued': () => setPhase('queued'),
    'bs:queue_cancelled': () => setPhase('idle'),
    'bs:matched': () => {
      setOver(null)
      setDraft(randomFleet())
      setPhase('placing')
    },
    'bs:state': (s: BsState) => {
      setState(s)
      if (s.phase === 'PLACING') setPhase('placing')
      else if (s.phase === 'IN_PROGRESS') setPhase('playing')
    },
    'bs:shot_result': (r: { x: number; y: number; hit: boolean }) => {
      setLastShot({ x: r.x, y: r.y, hit: r.hit })
    },
    'bs:game_over': (g: GameOver) => {
      setOver(g)
      setPhase('over')
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    'bs:cancelled': () => {
      setPhase('idle')
      setState(null)
    },
    'bs:error': (e: { code: string }) => setError(e.code),
  })

  useEffect(() => {
    if (!state?.deadline || (phase !== 'playing' && phase !== 'placing')) return
    const id = setInterval(() => {
      setTimeLeft(
        Math.max(0, Math.ceil((new Date(state.deadline!).getTime() - Date.now()) / 1000)),
      )
    }, 250)
    return () => clearInterval(id)
  }, [state, phase])

  const myTurn = state && user ? state.turnUserId === user.id : false

  const queue = useCallback(() => {
    setError(null)
    try {
      socket.emit('bs:queue', { betAmount: parseTon(bet).toString() })
    } catch {
      setError('invalid_amount')
    }
  }, [socket, bet])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('games.battleship')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-center text-2xl font-bold">{t('games.battleship')}</h1>

      {(phase === 'idle' || phase === 'queued') && (
        <Card className="mx-auto max-w-md">
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('common.bet')} (TON)
              </label>
              <input
                value={bet}
                onChange={(e) => setBet(e.target.value)}
                disabled={phase === 'queued'}
                inputMode="decimal"
                className="glass w-full px-3 py-2.5 text-sm outline-none focus:border-primary/50"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {phase === 'idle' ? (
              <Button className="w-full" size="lg" onClick={queue}>
                Найти соперника
              </Button>
            ) : (
              <Button
                className="w-full"
                size="lg"
                variant="secondary"
                onClick={() => socket.emit('bs:cancel_queue')}
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                Поиск соперника… (отменить)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'placing' && state && (
        <Card className="mx-auto max-w-md">
          <CardContent className="space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              Расставьте корабли · осталось {timeLeft}s
              {state.youPlaced && ' · ожидание соперника…'}
            </div>
            <Grid title="Ваше поле" ships={draft} shots={[]} interactive={false} />
            {!state.youPlaced && (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setDraft(randomFleet())}>
                  <Shuffle className="h-4 w-4" />
                  Случайно
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => socket.emit('bs:place_ships', { matchId: state.matchId, ships: draft })}
                >
                  <RotateCw className="h-4 w-4" />
                  Готово
                </Button>
              </div>
            )}
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {(phase === 'playing' || phase === 'over') && state && (
        <>
          <Card className="flex items-center justify-between px-5 py-3">
            <div className="text-sm">
              <div className="font-semibold">vs {state.opponent.nickname}</div>
              <div className="text-muted-foreground">
                Банк: {formatTon((BigInt(state.betAmount) * 2n).toString())} TON
              </div>
            </div>
            {phase === 'playing' && (
              <div
                className={cn(
                  'rounded-xl px-4 py-2 text-sm font-bold',
                  myTurn ? 'bg-success/15 text-success' : 'bg-white/5 text-muted-foreground',
                )}
              >
                {myTurn ? `Ваш выстрел · ${timeLeft}s` : `Ход соперника · ${timeLeft}s`}
              </div>
            )}
          </Card>

          <div className="grid gap-6 sm:grid-cols-2">
            <Card className="p-4">
              <Grid
                title="Поле соперника"
                ships={over?.revealBoard ?? null}
                shots={state.yourShots}
                interactive={phase === 'playing' && myTurn}
                onCell={(x, y) => socket.emit('bs:shoot', { matchId: state.matchId, x, y })}
                highlightLast={lastShot}
              />
            </Card>
            <Card className="p-4">
              <Grid
                title="Ваше поле"
                ships={state.yourBoard}
                shots={state.opponentShots}
                interactive={false}
              />
            </Card>
          </div>

          {/* Move history */}
          {state.yourShots.length > 0 && (
            <Card className="px-4 py-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                История ходов
              </div>
              <div className="flex flex-wrap gap-1.5">
                {state.yourShots.slice(-20).map((s, i) => (
                  <span
                    key={i}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                      s.hit ? 'bg-destructive/20 text-destructive' : 'bg-white/5 text-muted-foreground',
                    )}
                  >
                    {String.fromCharCode(65 + s.x)}{s.y + 1}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {phase === 'playing' && (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => socket.emit('bs:resign', { matchId: state.matchId })}
            >
              <Flag className="h-4 w-4" />
              Сдаться
            </Button>
          )}

          <AnimatePresence>
            {over && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-strong px-6 py-5 text-center"
              >
                <div className="text-lg font-bold">
                  {over.winnerUserId === user?.id
                    ? `Победа! +${formatTon(over.payout)} TON`
                    : 'Поражение'}
                </div>
                <Button
                  className="mt-4"
                  onClick={() => {
                    setPhase('idle')
                    setState(null)
                    setOver(null)
                    setLastShot(null)
                  }}
                >
                  Играть ещё
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}
