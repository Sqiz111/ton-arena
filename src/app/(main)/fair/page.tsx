'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Game = 'mines' | 'plinko' | 'wheel'

export default function FairPage() {
  const t = useTranslations()
  const [game, setGame] = useState<Game>('mines')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }))

  const verify = async () => {
    setError(null)
    setResult(null)
    try {
      const body: Record<string, unknown> = { game, serverSeed: fields.serverSeed ?? '' }
      if (game === 'mines') {
        Object.assign(body, {
          clientSeed: fields.clientSeed ?? '',
          nonce: parseInt(fields.nonce ?? '0', 10),
          gridSize: parseInt(fields.gridSize ?? '5', 10),
          mines: parseInt(fields.mines ?? '5', 10),
        })
      } else if (game === 'plinko') {
        Object.assign(body, {
          clientSeed: fields.clientSeed ?? '',
          nonce: parseInt(fields.nonce ?? '0', 10),
          risk: fields.risk ?? 'medium',
          rows: parseInt(fields.rows ?? '12', 10),
        })
        if (fields.rtpBps) Object.assign(body, { rtpBps: parseInt(fields.rtpBps, 10) })
      } else {
        Object.assign(body, {
          roundId: fields.roundId ?? '',
          betsHash: fields.betsHash ?? '',
          totalTickets: fields.totalTickets ?? '1',
        })
      }
      const res = await fetch('/api/games/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? 'error')
      setResult(JSON.stringify(data, null, 2))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const inputCls = 'glass w-full px-3 py-2 font-mono text-xs outline-none focus:border-primary/50'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-success" />
        <h1 className="mt-2 text-2xl font-bold">{t('nav.fair')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Как это работает</CardTitle>
          <CardDescription className="space-y-2 leading-relaxed">
            До начала каждой игры мы публикуем SHA-256 хэш серверного сида — так мы фиксируем
            результат заранее и не можем его изменить. После игры сид раскрывается, и вы можете
            воспроизвести результат: Mines и Plinko используют HMAC-SHA256(serverSeed,
            clientSeed:nonce), рулетка — HMAC-SHA256(serverSeed, roundId:betsHash), где betsHash
            привязывает исход к финальному списку ставок. Проверьте любую свою игру ниже.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Верификатор</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="glass flex gap-1 p-1">
            {(['mines', 'plinko', 'wheel'] as const).map((g) => (
              <button
                key={g}
                onClick={() => {
                  setGame(g)
                  setResult(null)
                }}
                className={cn(
                  'flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition',
                  game === g ? 'gradient-primary text-white' : 'text-muted-foreground',
                )}
              >
                {g}
              </button>
            ))}
          </div>

          <input
            placeholder="Server seed (раскрытый)"
            value={fields.serverSeed ?? ''}
            onChange={(e) => set('serverSeed', e.target.value)}
            className={inputCls}
          />

          {game !== 'wheel' && (
            <>
              <input
                placeholder="Client seed"
                value={fields.clientSeed ?? ''}
                onChange={(e) => set('clientSeed', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="Nonce"
                value={fields.nonce ?? ''}
                onChange={(e) => set('nonce', e.target.value)}
                className={inputCls}
              />
            </>
          )}
          {game === 'mines' && (
            <div className="flex gap-2">
              <input
                placeholder="Размер поля (5/7)"
                value={fields.gridSize ?? ''}
                onChange={(e) => set('gridSize', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="Мины"
                value={fields.mines ?? ''}
                onChange={(e) => set('mines', e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {game === 'plinko' && (
            <div className="flex gap-2">
              <input
                placeholder="Риск (low/medium/high)"
                value={fields.risk ?? ''}
                onChange={(e) => set('risk', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="Ряды (8/12/16)"
                value={fields.rows ?? ''}
                onChange={(e) => set('rows', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="RTP bps (из config игры)"
                value={fields.rtpBps ?? ''}
                onChange={(e) => set('rtpBps', e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {game === 'wheel' && (
            <>
              <input
                placeholder="Round ID"
                value={fields.roundId ?? ''}
                onChange={(e) => set('roundId', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="Bets hash"
                value={fields.betsHash ?? ''}
                onChange={(e) => set('betsHash', e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="Total tickets (= банк в нанотонах)"
                value={fields.totalTickets ?? ''}
                onChange={(e) => set('totalTickets', e.target.value)}
                className={inputCls}
              />
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={() => void verify()}>
            Проверить
          </Button>

          {result && (
            <pre className="glass overflow-auto p-4 text-xs leading-relaxed text-success">
              {result}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
