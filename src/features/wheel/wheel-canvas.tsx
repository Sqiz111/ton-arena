'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, useAnimate } from 'framer-motion'
import type { WheelBetDto, WheelSpinDto } from '@/types/socket'
import { formatTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

const SIZE = 340
const R = SIZE / 2

interface Sector {
  bet: WheelBetDto
  startAngle: number // degrees
  endAngle: number
  share: number
}

/** Aggregate bets per user into contiguous sectors proportional to total tickets. */
function buildSectors(bets: WheelBetDto[], potAmount: string): Sector[] {
  const pot = BigInt(potAmount || '0')
  if (pot === 0n) return []
  const byUser = new Map<string, { bet: WheelBetDto; total: bigint }>()
  for (const b of bets) {
    const cur = byUser.get(b.userId)
    if (cur) cur.total += BigInt(b.amount)
    else byUser.set(b.userId, { bet: b, total: BigInt(b.amount) })
  }
  let angle = 0
  const sectors: Sector[] = []
  for (const { bet, total } of byUser.values()) {
    const share = Number((total * 10_000n) / pot) / 10_000
    const sweep = share * 360
    sectors.push({ bet, startAngle: angle, endAngle: angle + sweep, share })
    angle += sweep
  }
  return sectors
}

function arcPath(startDeg: number, endDeg: number, r: number): string {
  // SVG angles: 0° at 12 o'clock, clockwise
  const toXY = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [R + r * Math.cos(rad), R + r * Math.sin(rad)]
  }
  const [x1, y1] = toXY(startDeg)
  const [x2, y2] = toXY(endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${R} ${R} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

/**
 * Ticket → wheel angle mapping used for landing: the winning ticket's position
 * inside its user's aggregated sector, matching the server's ticket ranges.
 */
function ticketAngle(spin: WheelSpinDto, bets: WheelBetDto[], sectors: Sector[]): number {
  const ticket = BigInt(spin.winningTicket)
  const winnerBets = bets.filter((b) => b.userId === spin.winnerUserId)
  const sector = sectors.find((s) => s.bet.userId === spin.winnerUserId)
  if (!sector || winnerBets.length === 0) return 0
  // Offset of the ticket within the user's total tickets
  let before = 0n
  let total = 0n
  for (const b of winnerBets) {
    const from = BigInt(b.ticketFrom)
    const to = BigInt(b.ticketTo)
    total += to - from + 1n
    if (ticket > to) before += to - from + 1n
    else if (ticket >= from) before += ticket - from
  }
  const frac = total > 0n ? Number((before * 10_000n) / total) / 10_000 : 0.5
  return sector.startAngle + frac * (sector.endAngle - sector.startAngle)
}

export function WheelCanvas({
  bets,
  potAmount,
  spin,
  onSpinEnd,
}: {
  bets: WheelBetDto[]
  potAmount: string
  spin: WheelSpinDto | null
  onSpinEnd?: () => void
}) {
  const [scope, animate] = useAnimate()
  const [spinning, setSpinning] = useState(false)
  const sectors = useMemo(() => buildSectors(bets, potAmount), [bets, potAmount])

  useEffect(() => {
    if (!spin || spinning) return
    setSpinning(true)
    const landing = ticketAngle(spin, bets, sectors)
    // Pointer is at the top; rotate so the landing angle ends under it.
    const target = 360 * 6 + (360 - landing)
    void animate(
      scope.current,
      { rotate: target },
      { duration: spin.spinDurationMs / 1000, ease: [0.12, 0.8, 0.22, 1] },
    ).then(() => {
      onSpinEnd?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin])

  // Reset rotation for a new round.
  useEffect(() => {
    if (!spin && scope.current) {
      setSpinning(false)
      void animate(scope.current, { rotate: 0 }, { duration: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin])

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      {/* Pointer */}
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
        <div className="h-0 w-0 border-x-[10px] border-t-[16px] border-x-transparent border-t-warning drop-shadow-lg" />
      </div>

      <motion.div ref={scope} className="h-full w-full">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full drop-shadow-2xl">
          <circle cx={R} cy={R} r={R - 2} fill="#1E293B" stroke="rgba(255,255,255,0.08)" />
          {sectors.length === 0 ? (
            <circle cx={R} cy={R} r={R - 10} fill="#0F172A" />
          ) : sectors.length === 1 ? (
            <circle cx={R} cy={R} r={R - 10} fill={sectors[0].bet.color} opacity={0.85} />
          ) : (
            sectors.map((s) => (
              <path
                key={s.bet.userId}
                d={arcPath(s.startAngle, s.endAngle, R - 10)}
                fill={s.bet.color}
                opacity={0.85}
                stroke="#0F172A"
                strokeWidth={2}
              />
            ))
          )}
          {/* Percent labels */}
          {sectors.map((s) => {
            if (s.share < 0.04) return null
            const mid = ((s.startAngle + s.endAngle) / 2 - 90) * (Math.PI / 180)
            const lr = R * 0.62
            return (
              <text
                key={`label-${s.bet.userId}`}
                x={R + lr * Math.cos(mid)}
                y={R + lr * Math.sin(mid)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-white text-[13px] font-bold"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
              >
                {(s.share * 100).toFixed(0)}%
              </text>
            )
          })}
          <circle cx={R} cy={R} r={R * 0.3} fill="#0F172A" stroke="rgba(255,255,255,0.1)" strokeWidth={2} />
        </svg>
      </motion.div>

      {/* Center pot display (does not rotate) */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Банк
        </span>
        <span
          className={cn(
            'text-xl font-extrabold tracking-tight',
            spinning && 'animate-pulse text-warning',
          )}
        >
          {formatTon(potAmount)} TON
        </span>
      </div>
    </div>
  )
}
