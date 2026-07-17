import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  // Never log secrets even if an object accidentally contains them.
  redact: ['mnemonic', 'HOT_WALLET_MNEMONIC', 'password', 'passwordHash', 'token'],
})
