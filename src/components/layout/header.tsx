'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Wallet, User, Settings, Gamepad2, Home, Dice5, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { formatTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', key: 'home', icon: Home },
  { href: '/games/online', key: 'online', icon: Gamepad2 },
  { href: '/games/solo', key: 'solo', icon: Dice5 },
  { href: '/profile', key: 'profile', icon: User },
  { href: '/settings', key: 'settings', icon: Settings },
] as const

export function Header() {
  const t = useTranslations()
  const pathname = usePathname()
  const { user, isAuthenticated, connect, logout, authError } = useAuth()

  return (
    <>
      {authError && (
        <div className="bg-destructive/90 px-4 py-2 text-center text-sm font-medium text-white">
          {authError === 'wrong_network' ? t('auth.wrongNetwork') : t('auth.proofFailed')}
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="gradient-primary flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-white shadow-lg shadow-blue-500/30">
              T
            </div>
            <span className="hidden text-lg font-bold tracking-tight sm:block">
              TON <span className="text-gradient">Arena</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, key }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'relative rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                    active && 'text-foreground',
                  )}
                >
                  {t(`nav.${key}`)}
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-x-2 -bottom-[1px] h-0.5 rounded-full bg-primary"
                    />
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated && user ? (
              <>
                <Link
                  href="/wallet"
                  className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold transition hover:border-primary/40"
                >
                  <Wallet className="h-4 w-4 shrink-0 text-primary" />
                  <span className="max-w-[30vw] truncate tabular-nums">
                    {formatTon(user.balance)} TON
                  </span>
                </Link>
                {/* Icon-only logout on phones, text on wider screens */}
                <Button variant="ghost" size="sm" onClick={() => void logout()}>
                  <LogOut className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">{t('common.disconnect')}</span>
                </Button>
              </>
            ) : (
              <Button onClick={connect} size="sm" className="sm:h-10 sm:px-5 sm:text-sm">
                <Wallet className="h-4 w-4" />
                <span className="whitespace-nowrap">{t('common.connect')}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom navigation (safe-area aware for iOS / Telegram Mini App) */}
      <nav
        className="glass-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around py-2 md:hidden"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {NAV_ITEMS.map(({ href, key, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              {t(`nav.${key}`)}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
