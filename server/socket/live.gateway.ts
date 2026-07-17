import type { Server } from 'socket.io'

export interface LiveWinEvent {
  nickname: string
  gameType: string
  amount: string // nanotons
}

let ioRef: Server | null = null

/** Default namespace: recent-wins ticker + live counters for the Home page. */
export function registerLiveGateway(io: Server) {
  ioRef = io
}

/** Called by game services after a payout to feed the home-page ticker. */
export function broadcastWin(event: LiveWinEvent) {
  ioRef?.emit('live:win', event)
}
