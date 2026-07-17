import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET: z.string().min(32),
  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  TONCENTER_API_KEY: z.string().optional().default(''),
  HOT_WALLET_MNEMONIC: z.string().optional().default(''),
  WITHDRAWAL_AUTO_LIMIT: z.coerce.bigint().nonnegative().default(100_000_000_000n),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/** Zod-validated environment. Throws early with a readable message if misconfigured. */
export function getEnv(): Env {
  if (cached) return cached
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

export const TONCENTER_ENDPOINTS = {
  mainnet: 'https://toncenter.com/api/v2/jsonRPC',
  testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
} as const
