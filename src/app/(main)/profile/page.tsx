'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import {
  Trophy,
  Gamepad2,
  TrendingUp,
  TrendingDown,
  Crown,
  Calendar,
  Award,
  Lock,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

interface GameItem {
  id: string
  gameType: string
  bet: string
  payout: string
  won: boolean
  createdAt: string
}

interface AchievementItem {
  code: string
  unlockedAt: string | null
}

const ACHIEVEMENT_LABELS: Record<string, string> = {
  FIRST_GAME: 'Первая игра',
  FIRST_WIN: 'Первая победа',
  FIRST_DEPOSIT: 'Первый депозит',
  HIGH_ROLLER: 'Хайроллер',
  WHEEL_MASTER: 'Мастер колеса',
  ADMIRAL: 'Адмирал',
  STRATEGIST: 'Стратег',
  SAPPER: 'Сапёр',
  LUCKY_DROP: 'Счастливый шар',
  VETERAN: 'Ветеран',
}

const GAME_LABELS: Record<string, string> = {
  WHEEL: 'Рулетка',
  BATTLESHIP: 'Морской бой',
  TICTACTOE: 'Крестики-нолики',
  MINES: 'Mines',
  PLINKO: 'Plinko',
}

export default function ProfilePage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()
  const [tab, setTab] = useState<'games' | 'achievements'>('games')

  const games = useQuery({
    queryKey: ['my-games'],
    queryFn: async (): Promise<GameItem[]> =>
      (await (await fetch('/api/me/games', { credentials: 'include' })).json()).games,
    enabled: isAuthenticated,
  })

  const achievements = useQuery({
    queryKey: ['my-achievements'],
    queryFn: async (): Promise<AchievementItem[]> =>
      (await (await fetch('/api/me/achievements', { credentials: 'include' })).json())
        .achievements,
    enabled: isAuthenticated,
  })

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  const stats = user.stats

  const statCards = [
    { icon: Gamepad2, label: t('profile.gamesPlayed'), value: `${stats?.gamesPlayed ?? 0}` },
    { icon: Trophy, label: t('profile.winRate'), value: `${stats?.winRate ?? 0}%` },
    {
      icon: TrendingUp,
      label: t('profile.totalWon'),
      value: `${formatTon(stats?.totalWon ?? '0')} TON`,
      className: 'text-success',
    },
    {
      icon: TrendingDown,
      label: t('profile.totalLost'),
      value: `${formatTon(stats?.totalLost ?? '0')} TON`,
      className: 'text-destructive',
    },
    {
      icon: Crown,
      label: t('profile.biggestWin'),
      value: `${formatTon(stats?.biggestWin ?? '0')} TON`,
      className: 'text-warning',
    },
    {
      icon: Calendar,
      label: t('profile.registered'),
      value: new Date(user.createdAt).toLocaleDateString(),
    },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header card */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="gradient-card flex flex-col items-center gap-4 py-8 sm:flex-row sm:px-8">
          <div className="gradient-primary flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-black text-white shadow-xl shadow-blue-500/30">
            {user.nickname.slice(0, 1).toUpperCase()}
          </div>
          <div className="text-center sm:text-left">
            <h1 className="text-2xl font-bold">{user.nickname}</h1>
            <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
              {user.tonAddress}
            </p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
              {t('profile.level')} {user.level}
              <span className="text-xs text-primary/70">· {user.xp} XP</span>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {statCards.map(({ icon: Icon, label, value, className }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="p-4">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <div className={cn('mt-2 text-lg font-bold', className)}>{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="glass flex gap-1 p-1">
        {(
          [
            ['games', t('profile.history')],
            ['achievements', t('profile.achievements')],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'flex-1 rounded-xl py-2.5 text-sm font-semibold transition',
              tab === k
                ? 'gradient-primary text-white shadow-lg'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'games' ? (
        <Card>
          <CardContent className="space-y-2">
            {games.data?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Пока нет игр</p>
            )}
            {games.data?.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-2.5"
              >
                <div>
                  <div className="text-sm font-semibold">{GAME_LABELS[g.gameType] ?? g.gameType}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(g.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('text-sm font-bold', g.won ? 'text-success' : 'text-destructive')}>
                    {g.won ? `+${formatTon(g.payout)}` : `−${formatTon(g.bet)}`} TON
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('common.bet')}: {formatTon(g.bet)} TON
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {achievements.data?.map((a, i) => (
            <motion.div
              key={a.code}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card
                className={cn(
                  'flex flex-col items-center gap-2 p-4 text-center',
                  !a.unlockedAt && 'opacity-40',
                )}
              >
                {a.unlockedAt ? (
                  <Award className="h-8 w-8 text-warning" />
                ) : (
                  <Lock className="h-8 w-8 text-muted-foreground" />
                )}
                <div className="text-xs font-semibold">
                  {ACHIEVEMENT_LABELS[a.code] ?? a.code}
                </div>
                {a.unlockedAt && (
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(a.unlockedAt).toLocaleDateString()}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
