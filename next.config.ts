import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // BigInt-safe: Prisma runs only server-side; nothing to configure client-side.
  serverExternalPackages: ['@prisma/client', 'argon2', 'pino'],
}

export default withNextIntl(nextConfig)
