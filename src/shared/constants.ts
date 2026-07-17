/**
 * Platform constants and PlatformConfig keys. Values that admins can change
 * at runtime live in the PlatformConfig table; these are the keys + defaults.
 */
import { toNano } from './ton-format'

export const CONFIG_KEYS = {
  platformFeeBps: 'platform_fee_bps',
  minBet: 'min_bet',
  minWithdrawal: 'min_withdrawal',
  minDeposit: 'min_deposit',
  wheelMaxBetLow: 'wheel_max_bet_LOW',
  wheelMaxBetMid: 'wheel_max_bet_MID',
  wheelMaxBetHigh: 'wheel_max_bet_HIGH', // "0" = unlimited
  wheelBettingWindowSec: 'wheel_betting_window_sec',
  withdrawalAutoLimit: 'withdrawal_auto_limit',
  depositCursor: 'deposit_cursor',
  minesRtpBps: 'mines_rtp_bps',
  plinkoRtpBps: 'plinko_rtp_bps',
} as const

/** Base RTP of the built-in payout tables/formulas, in basis points. */
export const BASE_RTP_BPS = 9900

export const CONFIG_DEFAULTS: Record<string, string> = {
  [CONFIG_KEYS.platformFeeBps]: '500', // 5%
  [CONFIG_KEYS.minBet]: toNano(0.1).toString(),
  [CONFIG_KEYS.minWithdrawal]: toNano(1).toString(),
  [CONFIG_KEYS.minDeposit]: toNano(0.5).toString(),
  [CONFIG_KEYS.wheelMaxBetLow]: toNano(10).toString(),
  [CONFIG_KEYS.wheelMaxBetMid]: toNano(50).toString(),
  [CONFIG_KEYS.wheelMaxBetHigh]: '0',
  [CONFIG_KEYS.wheelBettingWindowSec]: '30',
  [CONFIG_KEYS.withdrawalAutoLimit]: toNano(100).toString(),
  [CONFIG_KEYS.minesRtpBps]: String(BASE_RTP_BPS), // 99%
  [CONFIG_KEYS.plinkoRtpBps]: String(BASE_RTP_BPS), // 99%
}

export const MOVE_TIMEOUT_SEC = 30

/** Fixed 12-color palette for wheel players, assigned by hash of userId. */
export const PLAYER_COLORS = [
  '#3B82F6',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#06B6D4',
  '#84CC16',
  '#A855F7',
  '#EAB308',
] as const

export function playerColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length]
}

/** XP required to reach a given level (simple quadratic curve). */
export function xpForLevel(level: number): number {
  return 100 * (level - 1) * (level - 1)
}

export function levelFromXp(xp: number): number {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  return level
}
