import { SignJWT, jwtVerify } from 'jose'
import { getEnv } from './config'

const USER_COOKIE = 'session'
const ADMIN_COOKIE = 'admin_session'
const USER_TTL = '30d'
const ADMIN_TTL = '12h'

export const SESSION_COOKIE_NAME = USER_COOKIE
export const ADMIN_COOKIE_NAME = ADMIN_COOKIE

export interface UserSession {
  userId: string
  tonAddress: string
}

export interface AdminSession {
  adminId: string
  role: 'SUPERADMIN' | 'MODERATOR'
}

function secret(kind: 'user' | 'admin'): Uint8Array {
  const env = getEnv()
  return new TextEncoder().encode(kind === 'user' ? env.JWT_SECRET : env.ADMIN_JWT_SECRET)
}

export async function signUserSession(payload: UserSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(USER_TTL)
    .sign(secret('user'))
}

export async function verifyUserSession(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret('user'))
    if (typeof payload.userId !== 'string' || typeof payload.tonAddress !== 'string') return null
    return { userId: payload.userId, tonAddress: payload.tonAddress }
  } catch {
    return null
  }
}

export async function signAdminSession(payload: AdminSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ADMIN_TTL)
    .sign(secret('admin'))
}

export async function verifyAdminSession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret('admin'))
    if (typeof payload.adminId !== 'string') return null
    return { adminId: payload.adminId, role: payload.role as AdminSession['role'] }
  } catch {
    return null
  }
}

/** Cookie attributes shared by user and admin sessions. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
