import type { Server } from 'socket.io'
import { z } from 'zod'
import { rateLimit, RATE_RULES } from '../../src/lib/rate-limit'
import { wheelRoomManager } from '../engines/WheelRoomManager'
import type { WheelTier } from '../../src/types/socket'

const tierSchema = z.object({ tier: z.enum(['LOW', 'MID', 'HIGH']) })
const betSchema = z.object({
  tier: z.enum(['LOW', 'MID', 'HIGH']),
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n),
})

export function registerWheelGateway(io: Server) {
  const nsp = io.of('/wheel')
  wheelRoomManager.attach(nsp)

  nsp.on('connection', (socket) => {
    socket.on('wheel:join', async (raw) => {
      const parsed = tierSchema.safeParse(raw)
      if (!parsed.success) return
      const tier = parsed.data.tier as WheelTier
      // Leave other tier rooms — one room per socket.
      for (const room of socket.rooms) {
        if (room.startsWith('wheel:')) void socket.leave(room)
      }
      await socket.join(`wheel:${tier}`)
      const state = await wheelRoomManager.buildState(tier)
      if (state) socket.emit('wheel:state', state)
    })

    socket.on('wheel:leave', (raw) => {
      const parsed = tierSchema.safeParse(raw)
      if (!parsed.success) return
      void socket.leave(`wheel:${parsed.data.tier}`)
    })

    socket.on('wheel:bet', async (raw) => {
      const userId = socket.data.userId
      if (!userId) {
        socket.emit('wheel:error', { code: 'unauthorized' })
        return
      }
      const parsed = betSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit('wheel:error', { code: 'validation_error' })
        return
      }
      if (!rateLimit('bet', userId, RATE_RULES.bet)) {
        socket.emit('wheel:error', { code: 'rate_limited' })
        return
      }
      try {
        await wheelRoomManager.placeBet(
          parsed.data.tier as WheelTier,
          userId,
          BigInt(parsed.data.amount),
        )
      } catch (e) {
        socket.emit('wheel:error', { code: (e as Error).message })
      }
    })
  })
}
