import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrors, parseBody } from '@/lib/api'
import {
  sha256Hex,
  minesPlacement,
  plinkoPath,
  plinkoSlot,
  plinkoMultiplier,
  wheelWinningTicket,
} from '@/services/fair'

const schema = z.discriminatedUnion('game', [
  z.object({
    game: z.literal('mines'),
    serverSeed: z.string(),
    clientSeed: z.string(),
    nonce: z.number().int(),
    gridSize: z.number().int().min(2).max(10),
    mines: z.number().int().min(1),
  }),
  z.object({
    game: z.literal('plinko'),
    serverSeed: z.string(),
    clientSeed: z.string(),
    nonce: z.number().int(),
    risk: z.enum(['low', 'medium', 'high']),
    rows: z.union([z.literal(8), z.literal(12), z.literal(16)]),
    rtpBps: z.number().int().min(5000).max(10000).optional(),
  }),
  z.object({
    game: z.literal('wheel'),
    serverSeed: z.string(),
    roundId: z.string(),
    betsHash: z.string(),
    totalTickets: z
      .string()
      .regex(/^\d+$/)
      .refine((s) => BigInt(s) > 0n, 'totalTickets must be positive'),
  }),
])

export const POST = withErrors(async (req: NextRequest) => {
  const body = await parseBody(req, schema)

  switch (body.game) {
    case 'mines': {
      const mines = minesPlacement(
        { gridSize: body.gridSize, mines: body.mines },
        body.serverSeed,
        body.clientSeed,
        body.nonce,
      )
      return NextResponse.json({
        serverSeedHash: sha256Hex(body.serverSeed),
        mines: [...mines].sort((a, b) => a - b),
      })
    }
    case 'plinko': {
      const cfg = { risk: body.risk, rows: body.rows, rtpBps: body.rtpBps }
      const path = plinkoPath(cfg, body.serverSeed, body.clientSeed, body.nonce)
      const slot = plinkoSlot(path)
      return NextResponse.json({
        serverSeedHash: sha256Hex(body.serverSeed),
        path,
        slot,
        multiplier: plinkoMultiplier(cfg, slot),
      })
    }
    case 'wheel': {
      const ticket = wheelWinningTicket(
        body.serverSeed,
        body.roundId,
        body.betsHash,
        BigInt(body.totalTickets),
      )
      return NextResponse.json({
        serverSeedHash: sha256Hex(body.serverSeed),
        winningTicket: ticket.toString(),
      })
    }
  }
})
