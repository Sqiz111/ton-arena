/**
 * TON Arena — composition root.
 * Hosts Next.js and Socket.IO on one HTTP server, boots game engines
 * and background workers, handles graceful shutdown.
 */
import { createServer } from 'http'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'
import { parse } from 'url'

// Load .env before any src/ import reads process.env
import { config as loadDotenv } from 'dotenv'
loadDotenv()

import { getEnv } from '../src/lib/config'
import { logger } from '../src/lib/logger'
import { prisma } from '../src/lib/prisma'
import { socketAuthMiddleware } from './socket/auth'

async function main() {
  const env = getEnv()
  const dev = env.NODE_ENV !== 'production'

  const app = next({ dev, dir: process.cwd() })
  await app.prepare()
  const handle = app.getRequestHandler()
  const nextUpgrade = app.getUpgradeHandler()

  const httpServer = createServer((req, res) => {
    handle(req, res, parse(req.url ?? '/', true))
  })

  const io = new SocketIOServer(httpServer, {
    transports: ['websocket', 'polling'],
    cors: { origin: env.NEXT_PUBLIC_APP_URL, credentials: true },
  })
  // io.use() only covers the default namespace — game namespaces need it too.
  io.use(socketAuthMiddleware)
  for (const nsp of ['/wheel', '/battleship', '/tictactoe']) {
    io.of(nsp).use(socketAuthMiddleware)
  }

  // Route upgrades: /socket.io -> Socket.IO (handled internally), rest -> Next HMR.
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '/')
    if (pathname?.startsWith('/socket.io')) return // socket.io attaches its own listener
    nextUpgrade(req, socket, head)
  })

  // ── Gateways & workers are registered here as phases land ──
  const stoppables: Array<() => Promise<void> | void> = []

  const { registerLiveGateway } = await import('./socket/live.gateway')
  registerLiveGateway(io)

  const { registerWheelGateway } = await import('./socket/wheel.gateway')
  const { wheelRoomManager } = await import('./engines/WheelRoomManager')
  registerWheelGateway(io)
  await wheelRoomManager.start()
  stoppables.push(() => wheelRoomManager.stop())

  const { registerTicTacToeGateway } = await import('./socket/tictactoe.gateway')
  const { registerBattleshipGateway } = await import('./socket/battleship.gateway')
  const { MatchService } = await import('../src/services/match.service')
  await MatchService.recoverInterrupted() // refund matches left over from a crash
  registerTicTacToeGateway(io)
  registerBattleshipGateway(io)

  if (env.HOT_WALLET_MNEMONIC) {
    const { depositWatcher } = await import('./workers/deposit-watcher')
    const { withdrawalProcessor } = await import('./workers/withdrawal-processor')
    depositWatcher.start()
    withdrawalProcessor.start()
    stoppables.push(() => depositWatcher.stop())
    stoppables.push(() => withdrawalProcessor.stop())
  } else {
    logger.warn('HOT_WALLET_MNEMONIC not set — deposit/withdrawal workers disabled')
  }

  httpServer.listen(env.PORT, () => {
    logger.info(`TON Arena ready on http://localhost:${env.PORT} (network: ${env.TON_NETWORK})`)
  })

  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`${signal} received, shutting down…`)
    for (const stop of stoppables) {
      try {
        await stop()
      } catch (e) {
        logger.error(e, 'error during shutdown step')
      }
    }
    io.close()
    httpServer.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((e) => {
  logger.error(e, 'fatal boot error')
  process.exit(1)
})
