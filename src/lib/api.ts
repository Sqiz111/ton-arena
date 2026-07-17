import { NextRequest, NextResponse } from 'next/server'
import { ZodSchema } from 'zod'
import { SESSION_COOKIE_NAME, verifyUserSession, type UserSession } from '@/lib/jwt'
import { rateLimit, type RateLimitRule } from '@/lib/rate-limit'
import { getEnv } from '@/lib/config'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export function jsonError(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, message: message ?? code } }, { status })
}

/** Wraps a route handler with uniform error handling. */
export function withErrors<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (e) {
      if (e instanceof ApiError) return jsonError(e.status, e.code, e.message)
      console.error('[api]', e)
      return jsonError(500, 'internal_error')
    }
  }
}

/** Extract and verify the user session cookie; throws 401 when absent. */
export async function requireUser(req: NextRequest): Promise<UserSession> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = token ? await verifyUserSession(token) : null
  if (!session) throw new ApiError(401, 'unauthorized')
  return session
}

/** Origin check for mutating requests (CSRF defence in depth). */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin')
  if (!origin) return // non-browser clients / same-origin GET
  const expected = new URL(getEnv().NEXT_PUBLIC_APP_URL).origin
  if (origin !== expected) throw new ApiError(403, 'bad_origin')
}

/** Parse + validate a JSON body against a zod schema; throws 400 on mismatch. */
export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new ApiError(400, 'invalid_json')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, 'validation_error', parsed.error.issues[0]?.message)
  }
  return parsed.data
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

export function enforceRateLimit(scope: string, key: string, rule: RateLimitRule): void {
  if (!rateLimit(scope, key, rule)) throw new ApiError(429, 'rate_limited')
}
