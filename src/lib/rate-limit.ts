/**
 * In-memory token-bucket rate limiter, keyed by arbitrary string (userId / IP).
 * Good enough for a single-process deployment; swap for Redis when scaling out.
 */

interface Bucket {
  tokens: number
  updatedAt: number
}

export interface RateLimitRule {
  /** Max tokens (burst capacity). */
  capacity: number
  /** Tokens refilled per second. */
  refillPerSec: number
}

const buckets = new Map<string, Bucket>()

// Periodic cleanup so the map does not grow unbounded.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let cleanupTimer: NodeJS.Timeout | null = null
function ensureCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, b] of buckets) {
      if (now - b.updatedAt > CLEANUP_INTERVAL_MS) buckets.delete(key)
    }
  }, CLEANUP_INTERVAL_MS)
  cleanupTimer.unref()
}

/** Returns true if the action is allowed, false if rate-limited. */
export function rateLimit(scope: string, key: string, rule: RateLimitRule): boolean {
  ensureCleanup()
  const id = `${scope}:${key}`
  const now = Date.now()
  const bucket = buckets.get(id) ?? { tokens: rule.capacity, updatedAt: now }
  const elapsed = (now - bucket.updatedAt) / 1000
  bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsed * rule.refillPerSec)
  bucket.updatedAt = now
  if (bucket.tokens < 1) {
    buckets.set(id, bucket)
    return false
  }
  bucket.tokens -= 1
  buckets.set(id, bucket)
  return true
}

export const RATE_RULES = {
  auth: { capacity: 10, refillPerSec: 0.2 },
  bet: { capacity: 20, refillPerSec: 2 },
  withdrawal: { capacity: 3, refillPerSec: 0.05 },
  api: { capacity: 60, refillPerSec: 10 },
} satisfies Record<string, RateLimitRule>
