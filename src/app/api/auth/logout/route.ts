import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/jwt'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE_NAME, '', sessionCookieOptions(0))
  return res
}
