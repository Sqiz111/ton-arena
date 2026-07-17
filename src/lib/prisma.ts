import { PrismaClient } from '@prisma/client'

// Single client per process: custom server, Next route handlers and workers
// all share this pool. The globalThis guard survives dev-mode module reloads.
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma

/** Transaction client type accepted by every service method. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
