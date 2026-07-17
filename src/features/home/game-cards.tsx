'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { LoaderPinwheel, Ship, Grid3X3, Bomb, CircleDot, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const GAMES = [
  {
    slug: 'wheel',
    href: '/games/wheel',
    icon: LoaderPinwheel,
    accent: 'from-blue-500/25 to-blue-900/10 hover:shadow-blue-500/20',
    iconColor: 'text-blue-400',
    pvp: true,
    featured: true,
  },
  {
    slug: 'battleship',
    href: '/games/battleship',
    icon: Ship,
    accent: 'from-cyan-500/20 to-slate-900/10 hover:shadow-cyan-500/20',
    iconColor: 'text-cyan-400',
    pvp: true,
    featured: false,
  },
  {
    slug: 'tictactoe',
    href: '/games/tictactoe',
    icon: Grid3X3,
    accent: 'from-violet-500/20 to-slate-900/10 hover:shadow-violet-500/20',
    iconColor: 'text-violet-400',
    pvp: true,
    featured: false,
  },
  {
    slug: 'mines',
    href: '/games/mines',
    icon: Bomb,
    accent: 'from-amber-500/20 to-slate-900/10 hover:shadow-amber-500/20',
    iconColor: 'text-amber-400',
    pvp: false,
    featured: false,
  },
  {
    slug: 'plinko',
    href: '/games/plinko',
    icon: CircleDot,
    accent: 'from-emerald-500/20 to-slate-900/10 hover:shadow-emerald-500/20',
    iconColor: 'text-emerald-400',
    pvp: false,
    featured: false,
  },
] as const

export function GameCards({ filter }: { filter?: 'pvp' | 'solo' }) {
  const t = useTranslations()
  const games = GAMES.filter((g) =>
    filter === 'pvp' ? g.pvp : filter === 'solo' ? !g.pvp : true,
  )

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {games.map((game, i) => {
        const Icon = game.icon
        return (
          <motion.div
            key={game.slug}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.45, ease: 'easeOut' }}
            whileHover={{ y: -4 }}
            className={cn(game.featured && !filter && 'sm:col-span-2 lg:col-span-1')}
          >
            <Link
              href={game.href}
              className={cn(
                'glass group relative block overflow-hidden bg-gradient-to-br p-6 transition-shadow duration-300 hover:shadow-2xl',
                game.accent,
              )}
            >
              <div className="flex items-start justify-between">
                <div
                  className={cn(
                    'rounded-2xl bg-white/5 p-3.5 transition-transform duration-300 group-hover:scale-110',
                    game.iconColor,
                  )}
                >
                  <Icon className="h-8 w-8" />
                </div>
                {game.pvp && (
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                    PvP
                  </span>
                )}
              </div>
              <h3 className="mt-4 text-xl font-bold">{t(`games.${game.slug}`)}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                {t(`games.${game.slug}Desc`)}
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                {t('home.playNow')}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          </motion.div>
        )
      })}
    </div>
  )
}
