# TON Arena

Игровая платформа на блокчейне TON: PvP-рулетка, морской бой, крестики-нолики, Mines и Plinko с внутренним балансом, пополнением/выводом через TON и проверяемой честностью (provably fair).

> ⚠️ **Юридическое примечание.** Платформа с играми на реальные средства является азартной игрой и в большинстве юрисдикций требует лицензии. Ответственность за соответствие законодательству лежит на операторе. Для разработки и тестов используйте `TON_NETWORK=testnet`.

## Стек

- **Frontend:** React 19, Next.js 15 (App Router), TypeScript, TailwindCSS 4, Framer Motion, shadcn/ui-подход, Zustand, TanStack Query, next-intl (RU/EN), next-themes
- **Backend:** Node.js (custom server: Next + Socket.IO в одном процессе), Prisma + PostgreSQL, Socket.IO
- **Blockchain:** TON Connect (@tonconnect/ui-react), @ton/ton + @ton/core + @ton/crypto, toncenter API
- **Инфраструктура:** Docker / docker-compose, ESLint, Prettier, vitest

## Быстрый старт (разработка)

Требования: Node.js 20+, Docker Desktop.

```bash
# 1. Установка зависимостей
npm install

# 2. Конфигурация
cp .env.example .env
#    - сгенерируйте JWT_SECRET и ADMIN_JWT_SECRET: openssl rand -hex 32
#    - TON_NETWORK=testnet для разработки
#    - TONCENTER_API_KEY: получите у https://t.me/tonapibot
#    - HOT_WALLET_MNEMONIC: 24 слова кошелька платформы (без него депозиты/выводы отключены)

# 3. База данных
docker compose up -d postgres
npx prisma migrate dev      # создаёт схему
npm run db:seed             # конфиг, ачивки, админ

# 4. Запуск (Next + Socket.IO + воркеры на одном порту)
npm run dev
```

Сайт: http://localhost:3000 · Админка: http://localhost:3000/admin/login (после сида: `admin@tonarena.local` / `admin12345` — **смените сразу**).

## Продакшен через Docker

```bash
docker compose --profile full up --build
```

Поднимает Postgres + приложение (миграции применяются автоматически). Все секреты — через `.env`.

## Скрипты

| Команда | Действие |
|---|---|
| `npm run dev` | dev-сервер (tsx watch, webpack) |
| `npm run build` | `next build` + компиляция custom-сервера |
| `npm start` | продакшен-запуск из `dist/` |
| `npm test` | vitest (fair-алгоритмы, движки, математика комиссий) |
| `npm run db:migrate` | prisma migrate dev |
| `npm run db:seed` | сид данных |
| `npm run db:studio` | Prisma Studio |
| `npm run lint` / `format` | ESLint / Prettier |

## Архитектура

```
server/            composition root: Next + Socket.IO + движки + воркеры
  engines/         WheelRoomManager, Battleship/TicTacToe движки (чистые), Matchmaking
  socket/          gateways (wheel, battleship, tictactoe) + auth middleware
  workers/         deposit-watcher (poll toncenter), withdrawal-processor (один подписант)
src/
  app/             страницы + REST API route handlers
  services/        application-слой: Balance, Mines, Plinko, Match, Auth, Ton, fair/
  lib/             инфраструктура: prisma, config (zod-env), jwt, rate-limit
  features/        UI-фичи по доменам
  shared/          ton-format (BigInt↔string), константы, i18n
prisma/            схема, миграции, seed
```

**Ключевые инварианты:**

- Деньги — `BigInt` наноТОНы в БД; в JSON — только строки.
- Любое изменение баланса проходит через `BalanceService.applyEntry` (row lock + append-only ledger + кэш баланса) — другого пути нет.
- Выводы подписывает **единственный** цикл-процессор (seqno-гонки исключены структурно). Балансы дебетуются при создании заявки.
- Депозиты идемпотентны по `(txHash, lt)`.
- Все исходы игр вычисляет сервер; клиент только анимирует.
- Краш-восстановление: прерванные раунды/матчи отменяются с полным рефандом при старте.

## Provably Fair

- Хэш серверного сида публикуется **до** игры, сид раскрывается после.
- **Mines:** Fisher–Yates по потоку HMAC-SHA256(serverSeed, `mines:clientSeed:nonce:i`).
- **Plinko:** направление на каждом ряду = бит HMAC-байта; таблицы множителей ~99% RTP.
- **Wheel:** `winningTicket = HMAC(serverSeed, roundId:betsHash) mod pot + 1`; betsHash фиксирует список ставок — исход неизвестен даже оператору до закрытия ставок. 1 нанотон = 1 тикет, вероятность точно пропорциональна ставке.
- Публичный верификатор: страница `/fair` и `POST /api/games/verify`.

## Безопасность

zod-валидация всех входов (REST + socket), httpOnly SameSite=Strict cookies + origin-check (CSRF), rate limiting (token bucket), полная проверка ton_proof (подпись, домен, timestamp, stateInit→адрес), аудит-лог, mnemonic только из env, порог авто-вывода с одобрением админа.
