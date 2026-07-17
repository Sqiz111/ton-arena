'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Trophy } from 'lucide-react'
import { io, type Socket } from 'socket.io-client'
import { formatTon } from '@/shared/ton-format'

interface WinItem {
  id: number
  nickname: string
  gameType: string
  amount: string
}

let liveSocket: Socket | null = null
function getLiveSocket(): Socket {
  liveSocket ??= io({ withCredentials: true })
  return liveSocket
}

export function WinsTicker() {
  const t = useTranslations()
  const [wins, setWins] = useState<WinItem[]>([])

  useEffect(() => {
    // Seed with recent wins from REST, then live-append from the socket.
    void fetch('/api/stats/recent-wins')
      .then((r) => (r.ok ? r.json() : { wins: [] }))
      .then((data: { wins: Omit<WinItem, 'id'>[] }) => {
        setWins(data.wins.map((w, i) => ({ ...w, id: i })))
      })
      .catch(() => {})

    const socket = getLiveSocket()
    let counter = 10_000
    const onWin = (w: Omit<WinItem, 'id'>) => {
      setWins((prev) => [{ ...w, id: counter++ }, ...prev].slice(0, 12))
    }
    socket.on('live:win', onWin)
    return () => {
      socket.off('live:win', onWin)
    }
  }, [])

  if (wins.length === 0) return null

  return (
    <div className="glass flex items-center gap-3 overflow-hidden px-4 py-2.5">
      <div className="flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-warning">
        <Trophy className="h-4 w-4" />
        <span className="hidden sm:inline">{t('home.recentWins')}</span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div className="flex gap-6">
          <AnimatePresence initial={false}>
            {wins.slice(0, 6).map((w) => (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex shrink-0 items-center gap-1.5 text-sm"
              >
                <span className="font-medium">{w.nickname}</span>
                <span className="text-muted-foreground">{t('home.won')}</span>
                <span className="font-bold text-success">+{formatTon(w.amount)} TON</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
