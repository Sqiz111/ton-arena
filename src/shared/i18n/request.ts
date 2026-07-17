import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

export const LOCALES = ['ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get('NEXT_LOCALE')?.value
  const locale: Locale = LOCALES.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
