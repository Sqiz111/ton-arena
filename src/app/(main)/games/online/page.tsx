'use client'

import { useTranslations } from 'next-intl'
import { GameCards } from '@/features/home/game-cards'

export default function OnlineGamesPage() {
  const t = useTranslations()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.online')}</h1>
        <p className="mt-1 text-muted-foreground">{t('games.online')}</p>
      </div>
      <GameCards filter="pvp" />
    </div>
  )
}
