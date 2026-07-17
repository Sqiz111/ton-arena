'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Banknote,
  Settings2,
  BarChart3,
  ScrollText,
  Gamepad2,
  Ban,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

type Tab = 'analytics' | 'users' | 'withdrawals' | 'games' | 'config' | 'audit'

const TABS: Array<{ key: Tab; label: string; icon: typeof Users }> = [
  { key: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { key: 'users', label: 'Пользователи', icon: Users },
  { key: 'withdrawals', label: 'Выводы', icon: Banknote },
  { key: 'games', label: 'Игры', icon: Gamepad2 },
  { key: 'config', label: 'Конфигурация', icon: Settings2 },
  { key: 'audit', label: 'Логи', icon: ScrollText },
]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.code ?? 'error')
  return data
}

const CONFIG_LABELS: Record<string, string> = {
  platform_fee_bps: 'Комиссия платформы (базисные пункты, 500 = 5%)',
  min_bet: 'Минимальная ставка (нанотоны)',
  min_withdrawal: 'Минимальный вывод (нанотоны)',
  min_deposit: 'Минимальный депозит (нанотоны)',
  wheel_max_bet_LOW: 'Макс. ставка — маленькое колесо (нанотоны)',
  wheel_max_bet_MID: 'Макс. ставка — среднее колесо (нанотоны)',
  wheel_max_bet_HIGH: 'Макс. ставка — огромное колесо (0 = без лимита)',
  wheel_betting_window_sec: 'Окно ставок колеса (секунды)',
  withdrawal_auto_limit: 'Порог авто-вывода (нанотоны)',
  mines_rtp_bps: 'RTP Mines (базисные пункты, 9900 = 99%)',
  plinko_rtp_bps: 'RTP Plinko (базисные пункты, 9900 = 99%)',
}

function Analytics() {
  const { data } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () =>
      api<{
        dau: number
        mau: number
        totalUsers: number
        turnover24h: string
        deposits24h: string
        withdrawals24h: string
        feeRevenue: string
        games: Record<string, number>
      }>('/api/admin/analytics'),
    refetchInterval: 30_000,
  })
  if (!data) return <p className="text-muted-foreground">Загрузка…</p>

  const cards = [
    ['DAU', data.dau],
    ['MAU', data.mau],
    ['Всего юзеров', data.totalUsers],
    ['Оборот 24ч', `${formatTon(data.turnover24h)} TON`],
    ['Депозиты 24ч', `${formatTon(data.deposits24h)} TON`],
    ['Выводы 24ч', `${formatTon(data.withdrawals24h)} TON`],
    ['Доход с комиссий', `${formatTon(data.feeRevenue)} TON`],
  ] as const

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Сыграно игр</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Object.entries(data.games).map(([game, count]) => (
            <div key={game} className="rounded-xl bg-white/[0.03] px-4 py-3 text-center">
              <div className="text-xl font-bold">{count}</div>
              <div className="text-xs capitalize text-muted-foreground">{game}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function UsersTab() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['admin-users', q],
    queryFn: () =>
      api<{
        users: Array<{
          id: string
          nickname: string
          tonAddress: string
          balance: string
          isBlocked: boolean
          gamesPlayed: number
          createdAt: string
        }>
      }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  })
  const patch = useMutation({
    mutationFn: (body: { userId: string; action: string }) =>
      api('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по нику или адресу…"
        className="glass w-full px-3 py-2.5 text-sm outline-none focus:border-primary/50"
      />
      <div className="space-y-2">
        {data?.users.map((u) => (
          <Card key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                {u.nickname}
                {u.isBlocked && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                    BLOCKED
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">{u.tonAddress}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-sm">
                <div className="font-bold">{formatTon(u.balance)} TON</div>
                <div className="text-xs text-muted-foreground">{u.gamesPlayed} игр</div>
              </div>
              <Button
                size="sm"
                variant={u.isBlocked ? 'success' : 'destructive'}
                onClick={() => patch.mutate({ userId: u.id, action: u.isBlocked ? 'unblock' : 'block' })}
              >
                <Ban className="h-3.5 w-3.5" />
                {u.isBlocked ? 'Разблок.' : 'Блок.'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function WithdrawalsTab() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin-withdrawals'],
    queryFn: () =>
      api<{
        withdrawals: Array<{
          id: string
          nickname: string
          amount: string
          toAddress: string
          status: string
          createdAt: string
        }>
      }>('/api/admin/withdrawals'),
    refetchInterval: 15_000,
  })
  const patch = useMutation({
    mutationFn: (body: { withdrawalId: string; action: 'approve' | 'reject' }) =>
      api('/api/admin/withdrawals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-withdrawals'] }),
  })

  return (
    <div className="space-y-2">
      {data?.withdrawals.map((w) => (
        <Card key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold">
              {w.nickname} · {formatTon(w.amount)} TON
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{w.toAddress}</div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-bold',
                w.status === 'CONFIRMED'
                  ? 'bg-success/15 text-success'
                  : w.status === 'APPROVAL_REQUIRED'
                    ? 'bg-warning/15 text-warning'
                    : w.status === 'FAILED' || w.status === 'REJECTED'
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-white/10 text-muted-foreground',
              )}
            >
              {w.status}
            </span>
            {w.status === 'APPROVAL_REQUIRED' && (
              <>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => patch.mutate({ withdrawalId: w.id, action: 'approve' })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => patch.mutate({ withdrawalId: w.id, action: 'reject' })}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}

function GamesTab() {
  const [type, setType] = useState<'wheel' | 'matches' | 'solo'>('wheel')
  const { data } = useQuery({
    queryKey: ['admin-games', type],
    queryFn: () =>
      api<{ games: Array<Record<string, string | number | null>> }>(
        `/api/admin/games?type=${type}`,
      ),
  })
  return (
    <div className="space-y-4">
      <div className="glass flex gap-1 p-1">
        {(
          [
            ['wheel', 'Рулетка'],
            ['matches', 'PvP-матчи'],
            ['solo', 'Соло'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setType(k)}
            className={cn(
              'flex-1 rounded-xl py-2 text-sm font-semibold transition',
              type === k ? 'gradient-primary text-white' : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {data?.games.map((g) => (
          <div
            key={g.id as string}
            className="glass flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {(g.id as string).slice(0, 10)}…
            </span>
            <span className="font-semibold">{(g.tier ?? g.gameType) as string}</span>
            <span>{g.status as string}</span>
            <span className="font-bold">
              {formatTon((g.pot ?? g.bet ?? '0') as string)} TON
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(g.createdAt as string).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfigTab() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api<{ config: Record<string, string> }>('/api/admin/config'),
  })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const put = useMutation({
    mutationFn: (body: { key: string; value: string }) =>
      api('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-config'] }),
  })

  if (!data) return <p className="text-muted-foreground">Загрузка…</p>

  return (
    <div className="space-y-3">
      {Object.entries(data.config).map(([key, value]) => (
        <Card key={key} className="px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {CONFIG_LABELS[key] ?? key}
          </label>
          <div className="flex gap-2">
            <input
              value={drafts[key] ?? value}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              className="glass flex-1 px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              disabled={(drafts[key] ?? value) === value || put.isPending}
              onClick={() => put.mutate({ key, value: drafts[key] })}
            >
              Сохранить
            </Button>
          </div>
        </Card>
      ))}
      {put.isError && <p className="text-sm text-destructive">{(put.error as Error).message}</p>}
    </div>
  )
}

function AuditTab() {
  const { data } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () =>
      api<{
        logs: Array<{
          id: string
          actorType: string
          action: string
          meta: unknown
          createdAt: string
        }>
      }>('/api/admin/audit'),
  })
  return (
    <div className="space-y-1.5">
      {data?.logs.map((l) => (
        <div key={l.id} className="glass px-4 py-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{l.action}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(l.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
            {l.actorType} · {JSON.stringify(l.meta)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('analytics')

  // Auth probe: analytics 401 → login redirect.
  const probe = useQuery({
    queryKey: ['admin-probe'],
    queryFn: async () => {
      const res = await fetch('/api/admin/analytics', { credentials: 'include' })
      if (res.status === 401) {
        window.location.href = '/admin/login'
        throw new Error('unauthorized')
      }
      return true
    },
    retry: false,
  })

  if (!probe.data) {
    return <div className="flex min-h-dvh items-center justify-center text-muted-foreground">Загрузка…</div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">TON Arena — Админ-панель</h1>
      <div className="glass flex flex-wrap gap-1 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
              tab === key ? 'gradient-primary text-white shadow-lg' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <Analytics />}
      {tab === 'users' && <UsersTab />}
      {tab === 'withdrawals' && <WithdrawalsTab />}
      {tab === 'games' && <GamesTab />}
      {tab === 'config' && <ConfigTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}
