import type { Socket } from 'socket.io'
import { verifyUserSession } from '../../src/lib/jwt'
import { SESSION_COOKIE_NAME } from '../../src/lib/jwt'

declare module 'socket.io' {
  interface SocketData {
    userId: string | null
    tonAddress: string | null
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

/**
 * Reads the session cookie from the handshake. Unauthenticated sockets are
 * allowed (spectators); gateways check socket.data.userId before mutations.
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void) {
  const cookies = parseCookies(socket.handshake.headers.cookie)
  const token = cookies[SESSION_COOKIE_NAME]
  const session = token ? await verifyUserSession(token) : null
  socket.data.userId = session?.userId ?? null
  socket.data.tonAddress = session?.tonAddress ?? null
  next()
}
