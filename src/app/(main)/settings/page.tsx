'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Moon, Sun, Globe, Bell, Shield, UserCog, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const t = useTranslations()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { user, isAuthenticated, connect, logout } = useAuth()
  const queryClient = useQueryClient()
  const [nickname, setNickname] = useState('')
  const [notifications, setNotifications] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const patchMe = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.code ?? 'error')
      return data
    },
    onSuccess: () => {
      setMessage('Сохранено')
      setTimeout(() => setMessage(null), 2000)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: Error) => setMessage(`${t('common.error')}: ${e.message}`),
  })

  const setLocale = (locale: 'ru' | 'en') => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${365 * 24 * 3600}; samesite=strict`
    if (isAuthenticated) patchMe.mutate({ locale })
    router.refresh()
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
      {message && (
        <div className="glass px-4 py-2.5 text-sm font-medium text-success">{message}</div>
      )}

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {t('settings.theme')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {(
            [
              ['dark', t('settings.themeDark'), Moon],
              ['light', t('settings.themeLight'), Sun],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition',
                theme === value
                  ? 'gradient-primary text-white shadow-lg'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            {t('settings.language')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {(
            [
              ['ru', 'Русский'],
              ['en', 'English'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setLocale(value)}
              className={cn(
                'flex-1 rounded-xl py-3 text-sm font-semibold transition',
                user?.locale === value
                  ? 'gradient-primary text-white shadow-lg'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10',
              )}
            >
              {label}
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            {t('settings.notifications')}
          </CardTitle>
          <CardDescription>Уведомления о победах и завершении выводов</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            onClick={() => setNotifications((v) => !v)}
            className={cn(
              'relative h-7 w-12 rounded-full transition-colors',
              notifications ? 'bg-primary' : 'bg-white/10',
            )}
          >
            <span
              className={cn(
                'absolute top-1 h-5 w-5 rounded-full bg-white transition-all',
                notifications ? 'left-6' : 'left-1',
              )}
            />
          </button>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-4 w-4" />
            {t('settings.account')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Никнейм
            </label>
            <div className="flex gap-2">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={user?.nickname}
                className="glass flex-1 px-3 py-2.5 text-sm outline-none focus:border-primary/50"
              />
              <Button
                disabled={nickname.length < 3 || patchMe.isPending}
                onClick={() => patchMe.mutate({ nickname })}
              >
                Сохранить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            {t('settings.security')}
          </CardTitle>
          <CardDescription>
            Client seed участвует в генерации результатов ваших соло-игр. Смените его в любой
            момент — прошлые результаты останутся проверяемыми.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="secondary"
            onClick={() => patchMe.mutate({ rotateClientSeed: true })}
            disabled={patchMe.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            Сменить client seed
          </Button>
          <Button variant="destructive" onClick={() => void logout()}>
            {t('common.disconnect')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
