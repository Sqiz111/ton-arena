import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { CONFIG_DEFAULTS } from '../src/shared/constants'

const prisma = new PrismaClient()

const ACHIEVEMENTS = [
  'FIRST_GAME',
  'FIRST_WIN',
  'FIRST_DEPOSIT',
  'HIGH_ROLLER', // single bet >= 50 TON
  'WHEEL_MASTER', // 10 wheel wins
  'ADMIRAL', // 10 battleship wins
  'STRATEGIST', // 10 tictactoe wins
  'SAPPER', // mines cashout with 10+ opened cells
  'LUCKY_DROP', // plinko max multiplier
  'VETERAN', // 100 games played
]

async function main() {
  // Platform config defaults (upsert keeps admin-edited values intact)
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await prisma.platformConfig.upsert({
      where: { key },
      update: {},
      create: { key, value },
    })
  }

  // Achievements
  for (const code of ACHIEVEMENTS) {
    await prisma.achievement.upsert({ where: { code }, update: {}, create: { code } })
  }

  // Default admin. Credentials come from env in production; the dev fallback
  // (admin@tonarena.local / admin12345) is refused when NODE_ENV=production.
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@tonarena.local'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin12345'
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && !process.env.ADMIN_PASSWORD) {
    console.warn('ADMIN_PASSWORD not set — skipping admin seeding in production')
  } else {
    const existing = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
    if (!existing) {
      await prisma.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash: await argon2.hash(adminPassword),
          role: 'SUPERADMIN',
        },
      })
      console.log(`Seeded admin: ${adminEmail}`)
    }
  }

  console.log('Seed complete')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
