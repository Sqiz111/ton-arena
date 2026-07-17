'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { X, Circle, Loader2, Flag } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSocketEvents } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatTon, parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

interface TttState {
  matchId: string
  board: (0 | 1 | 2)[]
  yourMark: 1 | 2
  turnUserId: string
  deadline: string
  opponent: { nickname: string; avatarUrl: string | null }
  betAmount: string
}

interface GameOver {
  matchId: string
  winnerUserId: string | null
  payout: string
  board: (0 | 1 | 2)[]
}

type Phase = 'idle' | 'queued' | 'playing' | 'over'

export default function TicTacToePage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('idle')
  const [bet, setBet] = useState('1')
  const [state, setState] = useState<TttState | null>(null)
  const [over, setOver] = useState<GameOver | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)

  const socket = useSocketEvents('/tictactoe', {
    'ttt:queued': () => setPhase('queued'),
    'ttt:queue_cancelled': () => setPhase('idle'),
    'ttt:matched': () => {
      setOver(null)
      setPhase('playing')
    },
    'ttt:state': (s: TttState) => {
      setState(s)
      setPhase('playing')
    },
    'ttt:game_over': (g: GameOver) => {
      setOver(g)
      setPhase('over')
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    'ttt:error': (e: { code: string }) => {
      setError(e.code)
      if (e.code === 'unauthorized' || e.code === 'insufficient_balance') setPhase('idle')
    },
  })

  // Countdown from server deadline
  useEffect(() => {
    if (!state || phase !== 'playing') return
    const id = setInterval(() => {
      setTimeLeft(Math.max(0, Math.ceil((new Date(state.deadline).getTime() - Date.now()) / 1000)))
    }, 250)
    return () => clearInterval(id)
  }, [state, phase])

  const myTurn = state && user ? state.turnUserId === user.id : false
  const board = over?.board ?? state?.board ?? Array(9).fill(0)

  const queue = () => {
    setError(null)
    try {
      socket.emit('ttt:queue', { betAmount: parseTon(bet).toString() })
    } catch {
      setError('invalid_amount')
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('games.tictactoe')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-center text-2xl font-bold">{t('games.tictactoe')}</h1>

      {(phase === 'idle' || phase === 'queued') && (
        <Card>
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
                onClick={() => socket.emit('ttt:cancel_queue')}
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                Поиск соперника… (отменить)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {(phase === 'playing' || phase === 'over') && state && (
        <>
          <Card className="flex items-center justify-between px-5 py-3">
            <div className="text-sm">
              <div className="font-semibold">{state.opponent.nickname}</div>
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
                {myTurn ? `Ваш ход · ${timeLeft}s` : `Ход соперника · ${timeLeft}s`}
              </div>
            )}
          </Card>

          <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2">
            {board.map((cell: 0 | 1 | 2, i: number) => (
              <motion.button
                key={i}
                whileHover={myTurn && cell === 0 && phase === 'playing' ? { scale: 1.04 } : {}}
                whileTap={myTurn && cell === 0 && phase === 'playing' ? { scale: 0.96 } : {}}
                disabled={!myTurn || cell !== 0 || phase !== 'playing'}
                onClick={() => socket.emit('ttt:move', { matchId: state.matchId, cell: i })}
                className={cn(
                  'glass flex aspect-square items-center justify-center',
                  myTurn && cell === 0 && phase === 'playing' && 'hover:border-primary/40',
                )}
              >
                <AnimatePresence>
                  {cell !== 0 && (
                    <motion.div
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      {cell === 1 ? (
                        <X className={cn('h-12 w-12', state.yourMark === 1 ? 'text-primary' : 'text-destructive')} strokeWidth={3} />
                      ) : (
                        <Circle className={cn('h-10 w-10', state.yourMark === 2 ? 'text-primary' : 'text-destructive')} strokeWidth={3} />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            ))}
          </div>

          {phase === 'playing' && (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => socket.emit('ttt:resign', { matchId: state.matchId })}
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
                className={cn(
                  'glass-strong px-6 py-5 text-center',
                  over.winnerUserId === user?.id
                    ? 'border-success/30'
                    : over.winnerUserId
                      ? 'border-destructive/30'
                      : '',
                )}
              >
                <div className="text-lg font-bold">
                  {over.winnerUserId === null
                    ? 'Ничья — ставки возвращены'
                    : over.winnerUserId === user?.id
                      ? `Победа! +${formatTon(over.payout)} TON`
                      : 'Поражение'}
                </div>
                <Button
                  className="mt-4"
                  onClick={() => {
                    setPhase('idle')
                    setState(null)
                    setOver(null)
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
