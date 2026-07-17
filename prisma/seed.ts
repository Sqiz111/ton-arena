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

  // Default admin (change the password immediately in production)
  const adminEmail = 'admin@tonarena.local'
  const existing = await prisma.adminUser.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('admin12345'),
        role: 'SUPERADMIN',
      },
    })
    console.log(`Seeded admin: ${adminEmail} / admin12345`)
  }

  console.log('Seed complete')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
