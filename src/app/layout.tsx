import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'TON Arena', template: '%s — TON Arena' },
  description: 'PvP и соло-игры на TON с проверяемой честностью',
}

export const viewport: Viewport = {
  themeColor: '#0F172A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1, // prevents accidental pinch-zoom breaking the game UI in mini-app webviews
  viewportFit: 'cover', // enables env(safe-area-inset-*) inside Telegram/iOS webviews
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  const messages = await getMessages()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <Providers manifestUrl={`${appUrl}/tonconnect-manifest.json`}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
