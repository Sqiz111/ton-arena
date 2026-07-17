/** Shared client/server Socket.IO event contracts. All amounts = nanoton strings. */

export type WheelTier = 'LOW' | 'MID' | 'HIGH'

export interface WheelBetDto {
  id: string
  userId: string
  nickname: string
  avatarUrl: string | null
  amount: string
  ticketFrom: string
  ticketTo: string
  color: string
}

export interface WheelStateDto {
  roundId: string
  tier: WheelTier
  roundNumber: number
  status: 'WAITING' | 'BETTING' | 'SPINNING' | 'COMPLETED' | 'CANCELLED'
  serverSeedHash: string
  bets: WheelBetDto[]
  potAmount: string
  bettingEndsAt: string | null // ISO
  maxBet: string // "0" = unlimited
  minBet: string
  serverTime: string // ISO, for client clock-offset estimation
}

export interface WheelSpinDto {
  roundId: string
  winningTicket: string
  winnerUserId: string
  winnerNickname: string
  totalTickets: string
  spinDurationMs: number
  serverSeed: string
  betsHash: string
  potAmount: string
  feeAmount: string
  payout: string
}

export interface WheelServerToClient {
  'wheel:state': (state: WheelStateDto) => void
  'wheel:spin': (spin: WheelSpinDto) => void
  'wheel:error': (err: { code: string; message?: string }) => void
}

export interface WheelClientToServer {
  'wheel:join': (payload: { tier: WheelTier }) => void
  'wheel:leave': (payload: { tier: WheelTier }) => void
  'wheel:bet': (payload: { tier: WheelTier; amount: string }) => void
}

// ── Matches (battleship / tictactoe) ──

export type MatchPhase = 'MATCHMAKING' | 'PLACING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface TttStateDto {
  matchId: string
  board: (0 | 1 | 2)[] // 0 empty, 1 = player1 mark, 2 = player2 mark
  yourMark: 1 | 2
  turnUserId: string
  deadline: string // ISO
  status: MatchPhase
  opponent: { nickname: string; avatarUrl: string | null }
  betAmount: string
  winnerUserId?: string | null
  payout?: string
}

export interface ShipDto {
  x: number
  y: number
  length: number
  horizontal: boolean
}

export interface BsStateDto {
  matchId: string
  phase: 'PLACING' | 'IN_PROGRESS' | 'COMPLETED'
  yourBoard: ShipDto[] | null
  yourShots: Array<{ x: number; y: number; hit: boolean }>
  opponentShots: Array<{ x: number; y: number; hit: boolean }>
  turnUserId: string | null
  deadline: string | null
  opponent: { nickname: string; avatarUrl: string | null }
  youPlaced: boolean
  opponentPlaced: boolean
  betAmount: string
  winnerUserId?: string | null
  payout?: string
  revealBoard?: ShipDto[]
}

export interface LiveWin {
  nickname: string
  gameType: string
  amount: string
}
