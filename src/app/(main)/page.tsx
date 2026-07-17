'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { GameCards } from '@/features/home/game-cards'
import { WinsTicker } from '@/features/home/wins-ticker'
import { Wallet, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { formatTon } from '@/shared/ton-format'

export default function HomePage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl">
        <div className="gradient-card glass-strong relative px-6 py-12 text-center sm:px-12 sm:py-16">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            {t('home.title').split(' TON')[0]} <span className="text-gradient">TON</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            {t('home.subtitle')}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            {isAuthenticated && user ? (
              <Link href="/wallet">
                <Button size="xl" variant="secondary" className="glass-strong">
                  <Wallet className="h-5 w-5 text-primary" />
                  {t('common.balance')}: {formatTon(user.balance)} TON
                </Button>
              </Link>
            ) : (
              <Button size="xl" onClick={connect}>
                <Wallet className="h-5 w-5" />
                {t('common.connect')}
              </Button>
            )}
            <Link href="/fair">
              <Button size="xl" variant="ghost" className="text-muted-foreground">
                <ShieldCheck className="h-5 w-5 text-success" />
                {t('nav.fair')}
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <WinsTicker />

      {/* Games */}
      <section>
        <h2 className="mb-4 text-2xl font-bold tracking-tight">{t('home.popularGames')}</h2>
        <GameCards />
      </section>
    </div>
  )
}
