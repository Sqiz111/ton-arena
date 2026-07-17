import { prisma } from '@/lib/prisma'
import { CONFIG_DEFAULTS } from '@/shared/constants'

const CACHE_TTL_MS = 10_000
const cache = new Map<string, { value: string; at: number }>()

/** Runtime platform config stored in PlatformConfig, with a short in-memory cache. */
export const ConfigService = {
  async get(key: string): Promise<string> {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
    const row = await prisma.platformConfig.findUnique({ where: { key } })
    const value = row?.value ?? CONFIG_DEFAULTS[key] ?? ''
    cache.set(key, { value, at: Date.now() })
    return value
  },

  async getBigInt(key: string): Promise<bigint> {
    return BigInt(await this.get(key))
  },

  async getInt(key: string): Promise<number> {
    return parseInt(await this.get(key), 10)
  },

  async set(key: string, value: string): Promise<void> {
    await prisma.platformConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
    cache.set(key, { value, at: Date.now() })
  },

  invalidate(key?: string): void {
    if (key) cache.delete(key)
    else cache.clear()
  },
}
