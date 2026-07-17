'use client'

import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'
import { PLINKO_MULTIPLIERS, type PlinkoRisk } from '@/shared/plinko-tables'
import { BASE_RTP_BPS } from '@/shared/constants'

interface PlinkoResult {
  id: string
  path: number[]
  slot: number
  multiplier: number
  payout: string
}

interface ActiveBall {
  key: number
  path: number[]
  slot: number
  multiplier: number
  payout: string
}

const BOARD = 440 // px logical size, scaled by viewBox

export default function PlinkoPage() {
  const t = useTranslations()
  const { isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const [bet, setBet] = useState('1')
  const [risk, setRisk] = useState<PlinkoRisk>('medium')
  const [rows, setRows] = useState<8 | 12 | 16>(12)
  const [balls, setBalls] = useState<ActiveBall[]>([])
  const [lastHit, setLastHit] = useState<{ slot: number; at: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ballKey = useRef(0)

  // Current RTP scale so the multiplier strip matches actual payouts.
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => {
      const res = await fetch('/api/config/public')
      if (!res.ok) throw new Error('config_unavailable')
      return (await res.json()) as { plinkoRtpBps: number }
    },
    staleTime: 60_000,
  })
  const rtpScale = (publicConfig?.plinkoRtpBps ?? BASE_RTP_BPS) / BASE_RTP_BPS

  const multipliers = PLINKO_MULTIPLIERS[risk][rows].map(
    (m) => Math.round(m * rtpScale * 100) / 100,
  )

  // Peg lattice geometry: row r has r+3 pegs (classic layout starts with 3).
  const geometry = useMemo(() => {
    const pad = 24
    const usable = BOARD - pad * 2
    const rowGap = usable / (rows + 1)
    const pegRows: Array<Array<{ x: number; y: number }>> = []
    for (let r = 0; r < rows; r++) {
      const count = r + 3
      const y = pad + rowGap * (r + 1)
      const gap = usable / (rows + 2)
      const width = (count - 1) * gap
      const startX = BOARD / 2 - width / 2
      pegRows.push(Array.from({ length: count }, (_, i) => ({ x: startX + i * gap, y })))
    }
    const slotGap = usable / (rows + 2)
    const slotsWidth = rows * slotGap
    const slotStartX = BOARD / 2 - slotsWidth / 2
    const slots = Array.from({ length: rows + 1 }, (_, i) => ({
      x: slotStartX + i * slotGap,
      y: BOARD - 8,
    }))
    return { pegRows, slots, slotGap }
  }, [rows])

  /** Ball waypoints derived from the server-provided path. */
  const ballKeyframes = (path: number[]) => {
    const xs: number[] = [BOARD / 2]
    const ys: number[] = [8]
    let offset = 0 // rights minus lefts so far
    path.forEach((dir, r) => {
      offset += dir === 1 ? 1 : -1
      const row = geometry.pegRows[r]
      const centerIdx = (row.length - 1) / 2
      // Position between pegs after bouncing at row r
      const x = BOARD / 2 + (offset / 2) * (geometry.slotGap * 1)
      xs.push(x)
      ys.push(row[Math.round(centerIdx)].y + geometry.slotGap * 0.1)
    })
    const slot = path.reduce<number>((a, d) => a + d, 0)
    xs.push(geometry.slots[slot].x)
    ys.push(BOARD - 16)
    return { xs, ys }
  }

  const drop = useMutation({
    mutationFn: async (): Promise<PlinkoResult> => {
      setError(null)
      const res = await fetch('/api/games/solo/plinko', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: parseTon(bet).toString(), risk, rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.code ?? 'error')
      return data.result
    },
    onSuccess: (r) => {
      const key = ballKey.current++
      setBalls((prev) => [
        ...prev,
        { key, path: r.path, slot: r.slot, multiplier: r.multiplier, payout: r.payout },
      ])
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('games.plinko')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  const dropDuration = 0.28 * rows

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDot className="h-5 w-5 text-emerald-400" />
            {t('games.plinko')}
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
              inputMode="decimal"
              className="glass w-full px-3 py-2.5 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Риск
            </label>
            <div className="flex gap-1.5">
              {(['low', 'medium', 'high'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-2 text-xs font-semibold uppercase transition',
                    risk === r
                      ? 'gradient-primary text-white'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Ряды
            </label>
            <div className="flex gap-1.5">
              {([8, 12, 16] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRows(r)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition',
                    rows === r
                      ? 'gradient-primary text-white'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" size="lg" onClick={() => drop.mutate()} disabled={drop.isPending}>
            {t('common.play')}
          </Button>
        </CardContent>
      </Card>

      {/* Board */}
      <Card className="overflow-hidden p-4">
        <svg viewBox={`0 0 ${BOARD} ${BOARD}`} className="w-full">
          {/* Pegs */}
          {geometry.pegRows.map((row, r) =>
            row.map((peg, i) => (
              <circle key={`${r}-${i}`} cx={peg.x} cy={peg.y} r={3} fill="#475569" />
            )),
          )}
          {/* Balls */}
          {balls.map((ball) => {
            const { xs, ys } = ballKeyframes(ball.path)
            return (
              <motion.circle
                key={ball.key}
                r={7}
                fill="#3B82F6"
                initial={{ cx: xs[0], cy: ys[0] }}
                animate={{ cx: xs, cy: ys }}
                transition={{
                  duration: dropDuration,
                  ease: 'easeIn',
                  times: xs.map((_, i) => i / (xs.length - 1)),
                }}
                onAnimationComplete={() => {
                  setBalls((prev) => prev.filter((b) => b.key !== ball.key))
                  setLastHit({ slot: ball.slot, at: Date.now() })
                }}
                style={{ filter: 'drop-shadow(0 0 6px rgba(59,130,246,0.8))' }}
              />
            )
          })}
        </svg>
        {/* Multiplier slots */}
        <div className="mt-1 flex gap-1">
          {multipliers.map((m, i) => (
            <motion.div
              key={`${risk}-${rows}-${i}`}
              animate={
                lastHit?.slot === i
                  ? { scale: [1, 1.25, 1], backgroundColor: ['#1E293B', '#3B82F6', '#1E293B'] }
                  : {}
              }
              transition={{ duration: 0.5 }}
              className={cn(
                'flex-1 rounded-md py-1.5 text-center text-[10px] font-bold sm:text-xs',
                m >= 10
                  ? 'bg-destructive/20 text-destructive'
                  : m >= 2
                    ? 'bg-warning/20 text-warning'
                    : m >= 1
                      ? 'bg-success/15 text-success'
                      : 'bg-white/5 text-muted-foreground',
              )}
            >
              {m}×
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  )
}
