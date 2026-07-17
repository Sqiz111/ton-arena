'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowDownToLine, ArrowUpFromLine, Copy, Check, Clock, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { formatTon, parseTon } from '@/shared/ton-format'
import { cn } from '@/lib/utils'

interface DepositInfo {
  address: string
  memo: string
  minDeposit: string
}

interface WithdrawalItem {
  id: string
  amount: string
  toAddress: string
  status: string
  txHash: string | null
  createdAt: string
}

interface DepositItem {
  id: string
  amount: string
  txHash: string
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'text-success',
  SENT: 'text-primary',
  PENDING: 'text-warning',
  APPROVAL_REQUIRED: 'text-warning',
  PROCESSING: 'text-primary',
  FAILED: 'text-destructive',
  REJECTED: 'text-destructive',
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="glass flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-mono text-sm transition hover:border-primary/40"
      >
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </div>
  )
}

export default function WalletPage() {
  const t = useTranslations()
  const { user, isAuthenticated, connect } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const depositInfo = useQuery({
    queryKey: ['deposit-info'],
    queryFn: async (): Promise<DepositInfo> => {
      const res = await fetch('/api/deposits/info', { credentials: 'include' })
      if (!res.ok) throw new Error('unavailable')
      return res.json()
    },
    enabled: isAuthenticated,
    retry: false,
  })

  const withdrawals = useQuery({
    queryKey: ['withdrawals'],
    queryFn: async (): Promise<WithdrawalItem[]> =>
      (await (await fetch('/api/withdrawals', { credentials: 'include' })).json()).withdrawals,
    enabled: isAuthenticated,
  })

  const deposits = useQuery({
    queryKey: ['deposits'],
    queryFn: async (): Promise<DepositItem[]> =>
      (await (await fetch('/api/deposits', { credentials: 'include' })).json()).deposits,
    enabled: isAuthenticated,
  })

  const withdraw = useMutation({
    mutationFn: async () => {
      setError(null)
      const nano = parseTon(amount)
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: nano.toString(), toAddress }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error?.code ?? 'error')
      }
    },
    onSuccess: () => {
      setAmount('')
      void queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('auth.connectTitle')}</h1>
        <p className="text-muted-foreground">{t('auth.connectHint')}</p>
        <Button size="lg" onClick={connect}>
          {t('common.connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="gradient-card text-center">
          <CardDescription>{t('common.balance')}</CardDescription>
          <div className="mt-1 text-4xl font-extrabold tracking-tight">
            {user ? formatTon(user.balance, 4) : '—'} <span className="text-gradient">TON</span>
          </div>
        </Card>
      </motion.div>

      <div className="glass flex gap-1 p-1">
        {(['deposit', 'withdraw'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition',
              tab === k ? 'gradient-primary text-white shadow-lg' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {k === 'deposit' ? (
              <ArrowDownToLine className="h-4 w-4" />
            ) : (
              <ArrowUpFromLine className="h-4 w-4" />
            )}
            {t(`common.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'deposit' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('common.deposit')}</CardTitle>
            <CardDescription>
              {depositInfo.data
                ? `Отправьте TON на адрес ниже, ОБЯЗАТЕЛЬНО указав комментарий (memo). Минимум: ${formatTon(depositInfo.data.minDeposit)} TON`
                : depositInfo.isError
                  ? 'Пополнение временно недоступно'
                  : t('common.loading')}
            </CardDescription>
          </CardHeader>
          {depositInfo.data && (
            <CardContent className="space-y-4">
              <div className="flex justify-center rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={`ton://transfer/${depositInfo.data.address}?text=${depositInfo.data.memo}`}
                  size={180}
                />
              </div>
              <CopyField label="Адрес" value={depositInfo.data.address} />
              <CopyField label="Комментарий (memo) — обязательно!" value={depositInfo.data.memo} />
            </CardContent>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('common.withdraw')}</CardTitle>
            <CardDescription>Средства будут отправлены на указанный TON-адрес</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                TON адрес
              </label>
              <input
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder="UQ… / EQ…"
                className="glass w-full px-3 py-2.5 font-mono text-sm outline-none transition focus:border-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Сумма (TON)
              </label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1.5"
                inputMode="decimal"
                className="glass w-full px-3 py-2.5 text-sm outline-none transition focus:border-primary/50"
              />
            </div>
            {error && <p className="text-sm text-destructive">{t('common.error')}: {error}</p>}
            <Button
              className="w-full"
              size="lg"
              disabled={!amount || !toAddress || withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {withdraw.isPending ? t('common.loading') : t('common.withdraw')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>{tab === 'deposit' ? t('profile.deposits') : t('profile.withdrawals')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(tab === 'deposit' ? deposits.data : withdrawals.data)?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Пока пусто</p>
          )}
          {tab === 'deposit'
            ? deposits.data?.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-success" />
                    <span className="text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="font-semibold text-success">+{formatTon(d.amount)} TON</span>
                </div>
              ))
            : withdrawals.data?.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    {w.status === 'CONFIRMED' ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : w.status === 'FAILED' || w.status === 'REJECTED' ? (
                      <X className="h-4 w-4 text-destructive" />
                    ) : (
                      <Clock className="h-4 w-4 text-warning" />
                    )}
                    <span className={cn('text-xs font-medium', STATUS_STYLES[w.status])}>
                      {w.status}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(w.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="font-semibold">−{formatTon(w.amount)} TON</span>
                </div>
              ))}
        </CardContent>
      </Card>
    </div>
  )
}
