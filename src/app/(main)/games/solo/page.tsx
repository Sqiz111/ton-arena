'use client'

import { useTranslations } from 'next-intl'
import { GameCards } from '@/features/home/game-cards'

export default function SoloGamesPage() {
  const t = useTranslations()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.solo')}</h1>
        <p className="mt-1 text-muted-foreground">{t('games.solo')}</p>
      </div>
      <GameCards filter="solo" />
    </div>
  )
}
